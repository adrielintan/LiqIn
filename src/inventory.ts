import type { Response } from "express";
import fs from "node:fs/promises";
import type { AuthenticatedRequest } from "./auth.js";
import { pool } from "./db.js";

type FieldInput = {
  label?: unknown;
  name?: unknown;
  type?: unknown;
  options?: unknown;
  precision?: unknown;
  showInDashboard?: unknown;
  placeholder?: unknown;
};

function userId(request: AuthenticatedRequest): string {
  if (!request.user) throw new Error("Authenticated user is missing.");
  return request.user.id;
}

function normalizeFields(input: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) throw new Error("Fields must be an array.");
  return input.map((field: FieldInput, index) => {
    if (typeof field !== "object" || field === null || typeof field.label !== "string" || typeof field.name !== "string" || typeof field.type !== "string") {
      throw new Error(`Field ${index + 1} is invalid.`);
    }
    const options = Array.isArray(field.options) && field.options.every(option => typeof option === "string") ? field.options : [];
    const precision = field.type === "currency" ? 2 : field.type === "decimal" ? Math.min(8, Math.max(0, Number(field.precision) || 0)) : null;
    return {
      label: field.label.trim(),
      fieldName: field.name.trim(),
      fieldType: field.type,
      fieldOrder: index,
      showInDashboard: field.showInDashboard === true,
      precision,
      options,
      placeholder: typeof field.placeholder === "string" ? field.placeholder : null
    };
  });
}

function respondError(response: Response, error: unknown): void {
  response.status(400).json({ error: error instanceof Error ? error.message : "Invalid inventory data." });
}

async function recordItemActivity(userId: string, itemId: string, action: "added" | "modified" | "deleted", itemName: string, groupName: string): Promise<void> {
  await pool.query(
    "INSERT INTO item_activity (user_id, item_id, action, item_name, group_name) VALUES ($1, $2, $3, $4, $5)",
    [userId, itemId, action, itemName, groupName]
  );
}

export async function listActivity(request: AuthenticatedRequest, response: Response): Promise<void> {
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const result = await pool.query(
    `SELECT id, item_id AS "itemId", action, item_name AS "itemName", group_name AS "groupName", created_at AS "createdAt"
     FROM item_activity
     WHERE user_id = $1 AND ($2 = '' OR item_name ILIKE '%' || $2 || '%' OR group_name ILIKE '%' || $2 || '%')
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId(request), search]
  );
  response.json({ activity: result.rows });
}

export async function listInventory(request: AuthenticatedRequest, response: Response): Promise<void> {
  const id = userId(request);
  const groups = await pool.query(
    `SELECT g.id, g.name, COALESCE(json_agg(json_build_object(
      'label', f.label, 'name', f.field_name, 'type', f.field_type,
      'precision', f.precision, 'options', f.options, 'showInDashboard', f.show_in_dashboard,
      'placeholder', f.placeholder
    ) ORDER BY f.field_order) FILTER (WHERE f.id IS NOT NULL), '[]') AS fields
     FROM groups g LEFT JOIN group_fields f ON f.group_id = g.id
     WHERE g.user_id = $1 GROUP BY g.id ORDER BY g.name`,
    [id]
  );
  const items = await pool.query(
    `SELECT i.id, i.name, g.name AS "group", i.quantity, i.values,
       CASE WHEN im.item_id IS NULL THEN NULL ELSE '/api/items/' || i.id || '/image/thumbnail' END AS "thumbnailUrl",
       CASE WHEN im.item_id IS NULL THEN NULL ELSE '/api/items/' || i.id || '/image/original' END AS "imageUrl"
     FROM items i JOIN groups g ON g.id = i.group_id
     LEFT JOIN item_images im ON im.item_id = i.id
     WHERE g.user_id = $1 ORDER BY i.created_at DESC`,
    [id]
  );
  response.json({ groups: groups.rows, items: items.rows });
}

export async function resetInventory(request: AuthenticatedRequest, response: Response): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const images = await client.query(
      "SELECT im.original_path, im.thumbnail_path FROM item_images im JOIN items i ON i.id = im.item_id JOIN groups g ON g.id = i.group_id WHERE g.user_id = $1",
      [userId(request)]
    );
    await client.query("DELETE FROM items USING groups WHERE items.group_id = groups.id AND groups.user_id = $1", [userId(request)]);
    await client.query("DELETE FROM groups WHERE user_id = $1", [userId(request)]);
    await client.query("COMMIT");
    await Promise.allSettled(images.rows.flatMap(row => [fs.unlink(row.original_path), fs.unlink(row.thumbnail_path)]));
    response.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function importInventory(request: AuthenticatedRequest, response: Response): Promise<void> {
  try {
    const backup = request.body;
    if (!backup || backup.version !== 1 || !Array.isArray(backup.items) || !backup.groups || typeof backup.groups !== "object") {
      throw new Error("This file is not a valid LiqIn backup.");
    }
    if (!backup.items.every((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.name === "string" && typeof candidate.group === "string";
    })) {
      throw new Error("The backup contains an invalid item.");
    }
    const groupEntries = Object.entries(backup.groups as Record<string, unknown>);
    const groups = groupEntries.map(([name, fields]) => ({ name, fields: normalizeFields(fields) }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const oldImages = await client.query(
        "SELECT im.original_path, im.thumbnail_path FROM item_images im JOIN items i ON i.id = im.item_id JOIN groups g ON g.id = i.group_id WHERE g.user_id = $1",
        [userId(request)]
      );
      await client.query("DELETE FROM items USING groups WHERE items.group_id = groups.id AND groups.user_id = $1", [userId(request)]);
      await client.query("DELETE FROM groups WHERE user_id = $1", [userId(request)]);
      const groupIds = new Map<string, string>();
      for (const group of groups) {
        const result = await client.query("INSERT INTO groups (user_id, name) VALUES ($1, $2) RETURNING id", [userId(request), group.name]);
        groupIds.set(group.name, result.rows[0].id);
        await replaceFields(client, result.rows[0].id, group.fields);
      }
      const importedItems = [];
      for (const [sourceIndex, item] of backup.items.entries()) {
        const groupId = groupIds.get(item.group);
        if (!groupId) throw new Error(`The item "${item.name}" references an unknown group.`);
        const result = await client.query(
          `INSERT INTO items (group_id, name, quantity, values) VALUES ($1, $2, GREATEST(0, COALESCE($3::integer, 1)), COALESCE($4::jsonb, '{}'::jsonb))
           RETURNING id, name, group_id, quantity, values`,
          [groupId, item.name.trim(), item.quantity, JSON.stringify(item.values || {})]
        );
        importedItems.push({ ...result.rows[0], group: item.group, sourceIndex });
        await client.query(
          "INSERT INTO item_activity (user_id, item_id, action, item_name, group_name) VALUES ($1, $2, 'added', $3, $4)",
          [userId(request), result.rows[0].id, result.rows[0].name, item.group]
        );
      }
      await client.query("COMMIT");
      await Promise.allSettled(oldImages.rows.flatMap(row => [fs.unlink(row.original_path), fs.unlink(row.thumbnail_path)]));
      response.status(201).json({ items: importedItems });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    respondError(response, error);
  }
}

async function replaceFields(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, groupId: string, fields: Array<Record<string, unknown>>): Promise<void> {
  await client.query("DELETE FROM group_fields WHERE group_id = $1", [groupId]);
  for (const field of fields) {
    await client.query(
      `INSERT INTO group_fields (group_id, label, field_name, field_type, field_order, show_in_dashboard, precision, options, placeholder)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [groupId, field.label, field.fieldName, field.fieldType, field.fieldOrder, field.showInDashboard, field.precision, JSON.stringify(field.options), field.placeholder]
    );
  }
}

export async function createGroup(request: AuthenticatedRequest, response: Response): Promise<void> {
  try {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (!name) throw new Error("Group name is required.");
    const fields = normalizeFields(request.body?.fields || []);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("INSERT INTO groups (user_id, name) VALUES ($1, $2) RETURNING id, name", [userId(request), name]);
      await replaceFields(client, result.rows[0].id, fields);
      await client.query("COMMIT");
      response.status(201).json({ group: { ...result.rows[0], fields } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    respondError(response, error);
  }
}

export async function updateGroup(request: AuthenticatedRequest, response: Response): Promise<void> {
  try {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (!name) throw new Error("Group name is required.");
    const fields = normalizeFields(request.body?.fields || []);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("UPDATE groups SET name = $1, updated_at = now() WHERE user_id = $2 AND name = $3 RETURNING id, name", [name, userId(request), decodeURIComponent(String(request.params.name))]);
      if (!result.rows[0]) throw new Error("Group not found.");
      await replaceFields(client, result.rows[0].id, fields);
      await client.query("COMMIT");
      response.json({ group: { ...result.rows[0], fields } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    respondError(response, error);
  }
}

export async function deleteGroup(request: AuthenticatedRequest, response: Response): Promise<void> {
  try {
    const result = await pool.query("DELETE FROM groups WHERE user_id = $1 AND name = $2", [userId(request), decodeURIComponent(String(request.params.name))]);
    if (!result.rowCount) {
      response.status(404).json({ error: "Group not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23503") {
      response.status(409).json({ error: "Remove the group's items before deleting it." });
      return;
    }
    throw error;
  }
}

export async function createItem(request: AuthenticatedRequest, response: Response): Promise<void> {
  try {
    const { name, group, quantity, values } = request.body || {};
    if (typeof name !== "string" || !name.trim() || typeof group !== "string") throw new Error("Item name and group are required.");
    const result = await pool.query(
      `INSERT INTO items (group_id, name, quantity, values)
       SELECT id, $1, GREATEST(0, COALESCE($3::integer, 1)), COALESCE($4::jsonb, '{}'::jsonb)
       FROM groups WHERE user_id = $2 AND name = $5
       RETURNING id, name, quantity, values`,
      [name.trim(), userId(request), quantity, JSON.stringify(values || {}), group]
    );
    if (!result.rows[0]) throw new Error("Group not found.");
    await recordItemActivity(userId(request), result.rows[0].id, "added", result.rows[0].name, group);
    response.status(201).json({ item: { ...result.rows[0], group } });
  } catch (error) {
    respondError(response, error);
  }
}

export async function updateItem(request: AuthenticatedRequest, response: Response): Promise<void> {
  try {
    const { name, group, quantity, values } = request.body || {};
    const result = await pool.query(
      `UPDATE items i SET group_id = target.id, name = $1, quantity = GREATEST(0, COALESCE($2::integer, 1)), values = COALESCE($3::jsonb, '{}'::jsonb), updated_at = now()
       FROM groups current_group, groups target
       WHERE i.id = $4 AND i.group_id = current_group.id AND current_group.user_id = $5 AND target.user_id = $5 AND target.name = $6
       RETURNING i.id, i.name, i.quantity, i.values, target.name AS "group"`,
      [name, quantity, JSON.stringify(values || {}), request.params.id, userId(request), group]
    );
    if (!result.rows[0]) throw new Error("Item not found.");
    await recordItemActivity(userId(request), result.rows[0].id, "modified", result.rows[0].name, result.rows[0].group);
    response.json({ item: result.rows[0] });
  } catch (error) {
    respondError(response, error);
  }
}

export async function deleteItem(request: AuthenticatedRequest, response: Response): Promise<void> {
  const itemId = String(request.params.id);
  const image = await pool.query("SELECT original_path, thumbnail_path FROM item_images WHERE item_id = $1", [itemId]);
  const item = await pool.query(
    `SELECT i.name, g.name AS "group" FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1 AND g.user_id = $2`,
    [itemId, userId(request)]
  );
  const result = await pool.query("DELETE FROM items i USING groups g WHERE i.id = $1 AND i.group_id = g.id AND g.user_id = $2", [itemId, userId(request)]);
  if (!result.rowCount) {
    response.status(404).json({ error: "Item not found." });
    return;
  }
  await recordItemActivity(userId(request), itemId, "deleted", item.rows[0].name, item.rows[0].group);
  await Promise.allSettled(image.rows.flatMap(row => [fs.unlink(row.original_path), fs.unlink(row.thumbnail_path)]));
  response.status(204).end();
}
