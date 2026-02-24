import type { Express } from "express";
import { setupAuth as setupReplitAuth } from "./replitAuth";
import { setupAuth as setupGoogleAuth } from "./googleAuth";

function registerDisabledAuthRoutes(app: Express, reason: string) {
  console.warn(`[AUTH] Disabled: ${reason}`);

  app.get("/api/login", (_req, res) => {
    res.status(503).json({ message: "Authentication is not configured" });
  });
  app.get("/api/callback", (_req, res) => {
    res.status(503).json({ message: "Authentication is not configured" });
  });
  app.get("/api/logout", (_req, res) => {
    res.status(200).json({ success: true });
  });
  app.get("/api/auth/user", (_req, res) => {
    res.status(401).json({ message: "Not authenticated" });
  });
}

export async function setupAuth(app: Express) {
  const provider = (process.env.AUTH_PROVIDER || "none").trim().toLowerCase();

  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      registerDisabledAuthRoutes(app, "AUTH_PROVIDER=google but GOOGLE_CLIENT_ID is missing");
      return;
    }
    await setupGoogleAuth(app);
    return;
  }

  if (provider === "replit") {
    const replId = process.env.REPL_ID?.trim();
    if (!replId) {
      registerDisabledAuthRoutes(app, "AUTH_PROVIDER=replit but REPL_ID is missing");
      return;
    }
    await setupReplitAuth(app);
    return;
  }

  registerDisabledAuthRoutes(app, "AUTH_PROVIDER is not set to google or replit");
}

