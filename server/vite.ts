import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: true as const,
    },
    appType: "custom",
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
  });

  app.use(vite.middlewares);

  // Only in dev we do HTML transforms
  if (process.env.NODE_ENV !== "production") {
    app.use("*", async (req, res, next) => {
      // Skip API routes
      if (req.path.startsWith("/api") || req.path.startsWith("/health")) return next();

      const url = req.originalUrl;

      try {
        const clientTemplate = path.resolve(__dirname, "..", "client", "index.html");
        let template = await fs.promises.readFile(clientTemplate, "utf-8");
        template = template.replace(
          `src="/src/main.tsx"`,
          `src="/src/main.tsx?v=${nanoid()}"`
        );
        const page = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(page);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }
}

export function serveStatic(app: Express) {
  // Use process.cwd() to always start from the project root (/app on Railway)
  const distPath = path.resolve(process.cwd(), "dist", "public");

  if (!fs.existsSync(distPath)) {
    // If we can't find dist/public, check the root dist as a fallback
    const fallbackPath = path.resolve(process.cwd(), "dist");
    if (!fs.existsSync(path.join(fallbackPath, "index.html"))) {
       throw new Error(`Could not find index.html in ${distPath} or ${fallbackPath}`);
    }
  }

  app.use(express.static(distPath));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") return next();
    // Try to serve index.html from the public subfolder first
    const indexPath = path.join(distPath, "index.html");
    res.sendFile(indexPath);
  });
}
