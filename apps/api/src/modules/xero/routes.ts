import { Router, type Request, type Response } from "express";
import { xeroSettingsSchema } from "@shared/schemas/xero";
import { config } from "../../config";
import { AppError } from "../../lib/errors";
import { ctx, parse } from "../../lib/http";
import { logger } from "../../lib/logger";
import { codeParam } from "../../lib/mappers";
import { XeroApiError } from "./client";
import {
  beginXeroConnect,
  completeXeroConnect,
  disconnectXero,
  enqueueXeroPoll,
  requestXeroSync,
  saveXeroSettings,
  xeroOptions,
  xeroStatus,
} from "./service";

/** Admin endpoints, mounted under /integrations/xero behind the Admin session. */
export function xeroRouter(): Router {
  const router = Router();
  router.get("/status", async (_req, res) => {
    res.json(await xeroStatus());
  });
  router.post("/connect", async (req, res) => {
    res.json(await beginXeroConnect(ctx(req)));
  });
  router.post("/disconnect", async (req, res) => {
    res.json(await disconnectXero(ctx(req)));
  });
  router.get("/options", async (_req, res) => {
    res.json(await xeroOptions());
  });
  router.put("/settings", async (req, res) => {
    res.json(
      await saveXeroSettings(parse(xeroSettingsSchema, req.body), ctx(req))
    );
  });
  /* "Check Xero now": queues the same payment check the 15-minute timer runs. */
  router.post("/sync", async (_req, res) => {
    await enqueueXeroPoll();
    res.json(await xeroStatus());
  });
  router.post("/invoices/:id/sync", async (req, res) => {
    res.json(await requestXeroSync(codeParam(req, "INV", "Invoice")));
  });
  return router;
}

/**
 * Where Xero sends the browser after the sign-in. It carries no session (the one-time `state`
 * is the credential), and it answers with a redirect back into Settings, never a JSON page.
 */
export async function xeroCallback(req: Request, res: Response): Promise<void> {
  const back = (outcome: "connected" | "error", message?: string) =>
    res.redirect(
      302,
      `${config().appUrl}/app/settings/accounting?xero=${outcome}${message ? `&message=${encodeURIComponent(message)}` : ""}`
    );
  try {
    await completeXeroConnect(req.query);
    back("connected");
  } catch (error) {
    logger().warn({ err: error }, "Xero sign-in did not complete");
    back(
      "error",
      error instanceof AppError || error instanceof XeroApiError
        ? error.message
        : "Could not connect to Xero. Try again."
    );
  }
}
