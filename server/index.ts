// Only disable TLS certificate check in development
if (process.env.NODE_ENV === "development") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import express, { raw, type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./vite";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";
import { WebhookHandlers } from "./webhookHandlers";
import { storage } from "./storage";
import { startReminderScheduler } from "./reminders";

const app = express();
app.use(cookieParser());

// Health & basic root check
app.get("/health", (_req, res) => res.status(200).send("OK"));
app.get("/", (_req, res) => res.status(200).send("App is running"));

// Initialize Stripe schema and sync
async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("DATABASE_URL not set, skipping Stripe initialization");
    return;
  }

  const isReplit = !!process.env.REPL_ID;
  const shouldRunMigrations = process.env.RUN_STRIPE_MIGRATIONS === "true";

  if (!shouldRunMigrations) {
    console.log("Stripe migrations disabled");
    return;
  }

  if (!isReplit) {
    console.log("stripe-replit-sync is Replit-only, skipping");
    return;
  }

  try {
    console.log("Running Stripe schema migrations...");
    await runMigrations({ databaseUrl, schema: "stripe" });

    const stripeSync = await getStripeSync();
    stripeSync.syncBackfill().catch(console.error);
    console.log("Stripe sync complete");
  } catch (error) {
    console.error("Stripe initialization failed:", error);
  }
}

// Stripe webhook route
app.post(
  "/api/stripe/webhook",
  raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ error: "Missing stripe-signature" });

    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error.message);
      res.status(400).json({ error: "Webhook processing error" });
    }
  }
);

// JSON middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: false }));

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) {
      log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });
  next();
});

(async () => {
  await initStripe();

  // Register API routes
  await registerRoutes(app);

  // Serve frontend static files (Vite build output)
  serveStatic(app);

  // Start server
  const port = Number(process.env.PORT);
  if (!port) throw new Error("PORT environment variable not set");

  app.listen(port, "0.0.0.0", () => log(`🚀 Server listening on port ${port}`));

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
  });

  // Background jobs
  setInterval(() => storage.cleanupExpiredCache().catch(console.error), 60 * 60 * 1000);
  startReminderScheduler();
})();
