import { Router } from "express";
import mongoose from "mongoose";
import type { MetaDTO } from "@shared/dto";
import { config } from "../../config";
import { emailEnabled } from "../../lib/mailer";
import { storage } from "../../lib/storage";
import { getWorkspace } from "../../lib/workspace";
import { todayIn } from "@shared/logic/time";

export const APP_VERSION = process.env.APP_VERSION ?? "1.0.0";

export function healthRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });
  router.get("/ready", async (_req, res) => {
    const checks = { database: false, uploads: false };
    try {
      if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        checks.database = true;
      }
    } catch {
      checks.database = false;
    }
    checks.uploads = await storage.isWritable();
    const ready = checks.database && checks.uploads;
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "not_ready", checks });
  });
  return router;
}

export async function getMeta(): Promise<MetaDTO> {
  const cfg = config();
  const workspace = await getWorkspace();
  return {
    version: APP_VERSION,
    environment: cfg.env,
    today: todayIn(workspace.timezone),
    timezone: workspace.timezone,
    demoEnabled: cfg.demo.enabled && !cfg.production,
    features: {
      email: emailEnabled(),
      sttProvider: cfg.stt.provider,
      noteProvider: cfg.notes.provider,
      xero: false,
    },
  };
}
