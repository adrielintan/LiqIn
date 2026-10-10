import fs from "node:fs/promises";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";
import { changePassword, currentUser, login, logout, register, requireUser } from "./auth.js";
import { createGroup, createItem, deleteGroup, deleteItem, importInventory, listInventory, resetInventory, updateGroup, updateItem } from "./inventory.js";
import { downloadImage, uploadImage } from "./images.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet(config.httpsEnabled ? undefined : {
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: null
    }
  },
  strictTransportSecurity: false
}));
app.use(express.json({ limit: "25mb" }));

app.post("/api/auth/register", register);
app.post("/api/auth/login", login);
app.post("/api/auth/logout", logout);
app.get("/api/auth/me", requireUser, currentUser);
app.post("/api/auth/password", requireUser, changePassword);
app.get("/api/inventory", requireUser, listInventory);
app.delete("/api/inventory", requireUser, resetInventory);
app.post("/api/inventory/import", requireUser, importInventory);
app.post("/api/groups", requireUser, createGroup);
app.put("/api/groups/:name", requireUser, updateGroup);
app.delete("/api/groups/:name", requireUser, deleteGroup);
app.post("/api/items", requireUser, createItem);
app.put("/api/items/:id", requireUser, updateItem);
app.delete("/api/items/:id", requireUser, deleteItem);
app.post("/api/items/:id/image", requireUser, uploadImage);
app.get("/api/items/:id/image/:kind", requireUser, downloadImage);

app.get("/health", async (_request, response, next) => {
  try {
    await checkDatabase();
    response.json({ status: "ok", database: "ok" });
  } catch (error) {
    next(error);
  }
});

app.get("/ready", async (_request, response, next) => {
  try {
    await fs.access(config.uploadDir);
    await checkDatabase();
    response.json({ status: "ready" });
  } catch (error) {
    next(error);
  }
});

app.use(express.static("public", { index: "index.html" }));

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

async function start(): Promise<void> {
  await fs.mkdir(config.uploadDir, { recursive: true });
  await checkDatabase();
  app.listen(config.port, () => {
    console.log(`LiqIn API listening on port ${config.port}`);
  });
}

start().catch(error => {
  console.error("Unable to start LiqIn:", error);
  process.exitCode = 1;
});
