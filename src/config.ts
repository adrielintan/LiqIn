import path from "node:path";

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port,
  databaseUrl: process.env.DATABASE_URL || "postgresql://liqin:liqin_dev_password@localhost:5432/liqin",
  databaseSsl: booleanFromEnv(process.env.DATABASE_SSL, false),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "./uploads"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "liqin_session",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30)
};
