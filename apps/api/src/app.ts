import { randomUUID } from "node:crypto";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { API_PREFIX } from "@shared/const";
import { config } from "./config";
import { logger } from "./lib/logger";
import { apiNotFound, errorHandler } from "./middleware/errors";
import { cors } from "./middleware/security";
import { apiRouter } from "./routes";

const LINK_TOKEN = new RegExp("/public/([a-z]+)/[A-Za-z0-9_-]{24,64}");

export function createApp(): Express {
  const cfg = config();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);

  app.use(
    pinoHttp({
      logger: logger(),
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id =
          typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      customLogLevel: (_req, res, error) =>
        error || res.statusCode >= 500
          ? "error"
          : res.statusCode >= 400
            ? "warn"
            : "info",
      autoLogging: {
        ignore: req => Boolean(req.url?.startsWith(`${API_PREFIX}/health`)),
      },
      serializers: {
        // A share or signing link carries its secret in the path, so it is never written to the log.
        req: req => ({
          id: req.id,
          method: req.method,
          url: String(req.url ?? "").replace(LINK_TOKEN, "/public/$1/[link]"),
        }),
        res: res => ({ statusCode: res.statusCode }),
      },
    })
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "same-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
  // Before the body is read, so the browser's pre-request check is answered without any other work.
  app.use(API_PREFIX, cors);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use(API_PREFIX, apiRouter());
  app.use("/api", apiNotFound);

  // Optional single-container mode: serve the built React app with a history fallback.
  if (cfg.staticDir) {
    const staticDir = cfg.staticDir;
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
