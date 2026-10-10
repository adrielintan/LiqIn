import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import type { Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith("image/"))
});

function imagePath(id: string, kind: "original" | "thumbnail"): string {
  return path.join(config.uploadDir, `${id}-${kind}.jpg`);
}

async function ownedItem(request: AuthenticatedRequest): Promise<boolean> {
  const itemId = String(request.params.id);
  const result = await pool.query(
    "SELECT 1 FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1 AND g.user_id = $2",
    [itemId, request.user?.id]
  );
  return Boolean(result.rows[0]);
}

export const uploadImage = [
  upload.single("image"),
  async (request: AuthenticatedRequest, response: Response): Promise<void> => {
    if (!request.file) {
      response.status(400).json({ error: "An image file is required." });
      return;
    }
    if (!(await ownedItem(request))) {
      response.status(404).json({ error: "Item not found." });
      return;
    }
    const itemId = String(request.params.id);
    const originalPath = imagePath(itemId, "original");
    const thumbnailPath = imagePath(itemId, "thumbnail");
    try {
      await fs.mkdir(config.uploadDir, { recursive: true });
      await sharp(request.file.buffer).rotate().jpeg({ quality: 90 }).toFile(originalPath);
      await sharp(request.file.buffer).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(thumbnailPath);
      const metadata = await fs.stat(originalPath);
      await pool.query(
        `INSERT INTO item_images (item_id, original_path, thumbnail_path, mime_type, file_size)
         VALUES ($1, $2, $3, 'image/jpeg', $4)
         ON CONFLICT (item_id) DO UPDATE SET original_path = EXCLUDED.original_path, thumbnail_path = EXCLUDED.thumbnail_path, mime_type = EXCLUDED.mime_type, file_size = EXCLUDED.file_size, created_at = now()`,
        [itemId, originalPath, thumbnailPath, metadata.size]
      );
      response.status(201).json({
        originalUrl: `/api/items/${encodeURIComponent(itemId)}/image/original`,
        thumbnailUrl: `/api/items/${encodeURIComponent(itemId)}/image/thumbnail`
      });
    } catch (error) {
      await Promise.allSettled([fs.unlink(originalPath), fs.unlink(thumbnailPath)]);
      throw error;
    }
  }
];

export async function downloadImage(request: AuthenticatedRequest, response: Response): Promise<void> {
  if (request.params.kind !== "original" && request.params.kind !== "thumbnail") {
    response.status(404).json({ error: "Image not found." });
    return;
  }
  if (!(await ownedItem(request))) {
    response.status(404).json({ error: "Image not found." });
    return;
  }
  const result = await pool.query(
    "SELECT original_path, thumbnail_path, mime_type FROM item_images WHERE item_id = $1",
    [String(request.params.id)]
  );
  const image = result.rows[0];
  if (!image) {
    response.status(404).json({ error: "Image not found." });
    return;
  }
  const filePath = request.params.kind === "original" ? image.original_path : image.thumbnail_path;
  response.type(image.mime_type);
  response.sendFile(path.resolve(filePath), { dotfiles: "deny" }, error => {
    if (error && !response.headersSent) {
      const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
      response.status(statusCode === 404 ? 404 : 500).json({ error: "Unable to read image." });
    }
  });
}
