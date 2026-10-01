import { Router } from "express";
import { authenticate, requireRole } from "./middleware/auth";
import { noStore, originCheck } from "./middleware/security";
import { activityRouter } from "./modules/activity/service";
import { authRouter } from "./modules/auth/routes";
import { budgetsRouter } from "./modules/budgets/routes";
import { dashboardRouter } from "./modules/dashboard/service";
import { documentsRouter } from "./modules/documents/routes";
import { invoicesRouter } from "./modules/invoices/routes";
import { notificationsRouter } from "./modules/notifications/service";
import { participantsRouter } from "./modules/participants/routes";
import {
  getAbcAdmin,
  getIncidentAdmin,
  listAbcAdmin,
  listIncidentsAdmin,
  listLogbookAdmin,
  getLogbookAdminEntry,
  setAbcStatus,
  setIncidentStatus,
} from "./modules/portal/reports";
import { trackingRouter } from "./modules/tracking/routes";
import { portalRouter } from "./modules/portal/routes";
import { recordsRouter } from "./modules/records/routes";
import { reportsRouter } from "./modules/reports/service";
import { rosterRouter } from "./modules/roster/routes";
import { searchRouter } from "./modules/search/service";
import { servicesRouter } from "./modules/services/routes";
import { settingsRouter } from "./modules/settings/routes";
import { staffRouter } from "./modules/staff/routes";
import { getMeta, healthRouter } from "./modules/system/routes";
import { voiceRouter } from "./modules/voice/routes";

/** Every route under /api/v1. Only /health, /meta and the public /auth endpoints are reachable without a session. */
export function apiRouter(): Router {
  const router = Router();
  router.use(noStore);
  router.use(originCheck);

  router.use("/health", healthRouter());
  router.get("/meta", async (_req, res) => {
    res.json(await getMeta());
  });
  router.use("/auth", authRouter());

  /*
   * Worker portal, mounted before the back office. The Admin router below is mounted at the
   * root, so its requireRole("admin") would otherwise reject portal requests before they
   * ever reached this router.
   */
  const portal = Router();
  portal.use(authenticate, requireRole("staff"));
  portal.use(portalRouter());
  router.use("/portal", portal);

  const secured = Router();
  secured.use(authenticate, requireRole("admin"));
  secured.use("/settings", settingsRouter());
  secured.use("/staff", staffRouter());
  secured.use("/services", servicesRouter());
  secured.use("/participants", participantsRouter());
  secured.use("/service-records", recordsRouter());
  secured.use("/roster", rosterRouter());
  secured.use("/invoices", invoicesRouter());
  secured.use("/voice-notes", voiceRouter());
  secured.use("/activity", activityRouter());
  secured.use("/dashboard", dashboardRouter());
  secured.use("/reports", reportsRouter());
  secured.use("/notifications", notificationsRouter());
  secured.use("/search", searchRouter());
  secured.use("/tracking", trackingRouter());
  secured.use(reportReviewRouter());
  // Routers that span several prefixes (budgets and documents live partly under /participants/:id).
  secured.use(budgetsRouter());
  secured.use(documentsRouter());
  router.use(secured);
  return router;
}

import { ctx, parse } from "./lib/http";
import { objectIdParam } from "./lib/mappers";
import { reportStatusSchema } from "@shared/schemas/staff-portal";

/** Admin read/review endpoints for worker-submitted incidents, ABC reports and logbooks. */
function reportReviewRouter(): Router {
  const router = Router();
  router.get("/incidents", async (_req, res) => {
    res.json(await listIncidentsAdmin());
  });
  router.get("/incidents/:id", async (req, res) => {
    res.json(
      await getIncidentAdmin(objectIdParam(req, "id", "Incident report"))
    );
  });
  router.post("/incidents/:id/status", async (req, res) => {
    res.json(
      await setIncidentStatus(
        null,
        objectIdParam(req, "id", "Incident report"),
        parse(reportStatusSchema, req.body),
        ctx(req),
        true
      )
    );
  });
  router.get("/abc-reports", async (_req, res) => {
    res.json(await listAbcAdmin());
  });
  router.get("/abc-reports/:id", async (req, res) => {
    res.json(await getAbcAdmin(objectIdParam(req, "id", "ABC report")));
  });
  router.post("/abc-reports/:id/status", async (req, res) => {
    res.json(
      await setAbcStatus(
        null,
        objectIdParam(req, "id", "ABC report"),
        parse(reportStatusSchema, req.body),
        ctx(req),
        true
      )
    );
  });
  router.get("/logbook", async (_req, res) => {
    res.json(await listLogbookAdmin());
  });
  router.get("/logbook/:id", async (req, res) => {
    res.json(
      await getLogbookAdminEntry(objectIdParam(req, "id", "Logbook entry"))
    );
  });
  return router;
}
