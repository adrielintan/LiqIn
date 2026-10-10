import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined
});

export async function checkDatabase(): Promise<void> {
  await pool.query("SELECT 1");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS item_activity (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      item_id UUID,
      action TEXT NOT NULL CHECK (action IN ('added', 'modified', 'deleted')),
      item_name TEXT NOT NULL,
      group_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS item_activity_user_created_idx ON item_activity(user_id, created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS item_activity_user_item_name_idx ON item_activity(user_id, item_name)");
}
