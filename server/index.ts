// Only disable TLS certificate check in development
if (process.env.NODE_ENV === "development") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}


import express, { raw, type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { storage } from "./storage";
import { startReminderScheduler } from "./reminders";

const app = express();
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// Initialize Stripe schema and sync on startup (SAFE FOR PROD)
async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("DATABASE_URL not set, skipping Stripe initialization");
    return;
  }

  const isReplit = !!process.env.REPL_ID;
  const shouldRunMigrations = process.env.RUN_STRIPE_MIGRATIONS === "true";

  // 🔴 Never run stripe-replit-sync unless explicitly allowed
  if (!shouldRunMigrations) {
    console.log(
      "Stripe migrations disabled (RUN_STRIPE_MIGRATIONS != true)"
    );
    return;
  }

  // 🔴 stripe-replit-sync is Replit-only
  if (!isReplit) {
    console.log(
      "stripe-replit-sync is Replit-only, skipping Stripe initialization"
    );
    return;
  }

  try {
    console.log("Running Stripe schema migrations...");
    await runMigrations({
      databaseUrl,
      schema: "stripe",
    });
    console.log("Stripe schema ready");

    const stripeSync = await getStripeSync();

    console.log("Syncing Stripe data...");
    stripeSync
      .syncBackfill()
      .then(() => console.log("Stripe data synced"))
      .catch((err: any) =>
        console.error("Error syncing Stripe data:", err)
      );
  } catch (error) {
    console.error("Failed to initialize Stripe:", error);
  }
}


// Stripe webhook route MUST come before express.json
app.post(
  "/api/stripe/webhook",
  raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;

      if (!Buffer.isBuffer(req.body)) {
        console.error("STRIPE WEBHOOK ERROR: req.body is not a Buffer");
        return res.status(500).json({ error: "Webhook processing error" });
      }

      await WebhookHandlers.processWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error.message);
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

// JSON middleware for all other routes
app.use(
  express.json({
    limit: "50mb",
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    if (path.startsWith("/api")) {
      const isPollingRequest =
        req.method === "GET" &&
        (path.match(/^\/api\/session\/[^/]+$/) ||
          path.match(/^\/api\/session\/[^/]+\/siblings$/) ||
          path === "/api/credits" ||
          path === "/api/auth/user" ||
          path === "/api/user/me");

      if (isPollingRequest) return;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await initStripe();

  const server = await registerRoutes(app);

  app.use(
    (err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      throw err;
    }
  );

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT);
  
  if (!port) {
    throw new Error("PORT environment variable not set");
  }
  
  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`🚀 Server listening on port ${port}`);
    }
  );


  const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const cleaned = await storage.cleanupExpiredCache();
      if (cleaned > 0) {
        log(`[CACHE] Cleaned up ${cleaned} expired entries`);
      }
    } catch (error) {
      console.error("[CACHE] Cleanup error:", error);
    }
  }, CACHE_CLEANUP_INTERVAL);

  storage
    .cleanupExpiredCache()
    .then((count) => {
      if (count > 0)
        log(`[CACHE] Initial cleanup: removed ${count} entries`);
    })
    .catch((err) =>
      console.error("[CACHE] Initial cleanup error:", err)
    );

  startReminderScheduler();
})();
