import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";
import { config } from "./config.js";

export type AuthenticatedRequest = Request & { user?: { id: string; username: string; email: string } };

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else {
        const expected = Buffer.from(expectedHex, "hex");
        resolve(expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey));
      }
    });
  });
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(response: Response, token: string): void {
  const maxAge = config.sessionTtlDays * 24 * 60 * 60;
  response.setHeader("Set-Cookie", `${config.sessionCookieName}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${config.nodeEnv === "production" ? "; Secure" : ""}`);
}

function readCookie(request: Request): string | undefined {
  const header = request.headers.cookie || "";
  const entry = header.split(";").map(value => value.trim()).find(value => value.startsWith(`${config.sessionCookieName}=`));
  return entry?.slice(config.sessionCookieName.length + 1);
}

export async function register(request: Request, response: Response): Promise<void> {
  const { username, email, password } = request.body as Record<string, unknown>;
  if (typeof username !== "string" || username.trim().length < 3 || typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    response.status(400).json({ error: "Username, email, and a password of at least 8 characters are required." });
    return;
  }
  try {
    const passwordHash = await hashPassword(password);
    const result = await pool.query("INSERT INTO app_users (username, email, password_hash) VALUES ($1, lower($2), $3) RETURNING id, username, email", [username.trim(), email.trim(), passwordHash]);
    await createSession(result.rows[0].id, response);
    response.status(201).json({ user: result.rows[0] });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "That username or email address is already registered." });
      return;
    }
    throw error;
  }
}

export async function login(request: Request, response: Response): Promise<void> {
  const { identifier, password } = request.body as Record<string, unknown>;
  if (typeof identifier !== "string" || typeof password !== "string") {
    response.status(400).json({ error: "Username/email and password are required." });
    return;
  }
  const result = await pool.query("SELECT id, username, email, password_hash FROM app_users WHERE lower(username) = lower($1) OR email = lower($1)", [identifier.trim()]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    response.status(401).json({ error: "The username/email or password is incorrect." });
    return;
  }
  await createSession(user.id, response);
  response.json({ user: { id: user.id, username: user.username, email: user.email } });
}

async function createSession(userId: string, response: Response): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  await pool.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)", [userId, tokenHash(token), expiresAt]);
  setSessionCookie(response, token);
}

export async function requireUser(request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> {
  try {
    const token = readCookie(request);
    if (!token) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    const result = await pool.query("SELECT u.id, u.username, u.email FROM sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()", [tokenHash(token)]);
    if (!result.rows[0]) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    request.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

export async function currentUser(request: AuthenticatedRequest, response: Response): Promise<void> {
  response.json({ user: request.user });
}

export async function logout(request: Request, response: Response): Promise<void> {
  const token = readCookie(request);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  response.setHeader("Set-Cookie", `${config.sessionCookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  response.status(204).end();
}

export async function changePassword(request: AuthenticatedRequest, response: Response): Promise<void> {
  const { currentPassword, newPassword, confirmPassword } = request.body as Record<string, unknown>;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof confirmPassword !== "string" || newPassword.length < 8) {
    response.status(400).json({ error: "Current password and a new password of at least 8 characters are required." });
    return;
  }
  if (newPassword !== confirmPassword) {
    response.status(400).json({ error: "The new passwords do not match." });
    return;
  }
  if (newPassword === currentPassword) {
    response.status(400).json({ error: "The new password must be different." });
    return;
  }
  const result = await pool.query("SELECT password_hash FROM app_users WHERE id = $1", [request.user?.id]);
  if (!result.rows[0] || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
    response.status(400).json({ error: "The current password is incorrect." });
    return;
  }
  await pool.query("UPDATE app_users SET password_hash = $1, updated_at = now() WHERE id = $2", [await hashPassword(newPassword), request.user?.id]);
  response.status(204).end();
}
