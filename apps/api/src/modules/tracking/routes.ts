import { Router } from "express";
import { liveTrackingQuery } from "@shared/schemas/staff-portal";
import { parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { errors } from "../../lib/errors";
import { getTrackingSession, liveTracking } from "./service";

export function trackingRouter(): Router {
  const router = Router();
  router.get("/live", async (req, res) => {
    res.json(await liveTracking(parse(liveTrackingQuery, req.query)));
  });
  router.get("/:id", async (req, res) => {
    try {
      res.json(
        await getTrackingSession(objectIdParam(req, "id", "Tracking session"))
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found"))
        throw errors.notFound("Tracking session");
      throw error;
    }
  });
  return router;
}
