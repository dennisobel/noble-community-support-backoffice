import { Router } from "express";
import { enforceModuleAccess } from "./middleware/access";
import { authenticate, requireOffice, requireRole } from "./middleware/auth";
import { noStore, originCheck } from "./middleware/security";
import { activityRouter } from "./modules/activity/service";
import { authRouter } from "./modules/auth/routes";
import { budgetsRouter } from "./modules/budgets/routes";
import { dashboardRouter } from "./modules/dashboard/service";
import { documentsRouter } from "./modules/documents/routes";
import { feedbackRouter, publicFeedbackRouter } from "./modules/feedback/routes";
import { invoicesRouter } from "./modules/invoices/routes";
import { publicInvoicesRouter } from "./modules/invoices/public";
import { publicSigningRouter } from "./modules/signatures/public";
import { signaturesRouter } from "./modules/signatures/routes";
import { notificationsRouter } from "./modules/notifications/service";
import { participantsRouter } from "./modules/participants/routes";
import { payrollRouter } from "./modules/payroll/routes";
import {
  getAbcAdmin,
  getIncidentAdmin,
  listAbcAdmin,
  listIncidentsAdmin,
  listLogbookAdmin,
  getLogbookAdminEntry,
  setAbcStatus,
  setIncidentReportable,
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
import { meRouter } from "./modules/me/service";
import { messagesRouter } from "./modules/messages/routes";
import { notesRouter } from "./modules/notes/routes";
import { usersRouter } from "./modules/users/routes";
import { voiceRouter } from "./modules/voice/routes";
import { xeroCallback, xeroRouter } from "./modules/xero/routes";

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
  /* Share links: no session, the token in the URL is the only credential. */
  router.use("/public", publicInvoicesRouter());
  /* Signing links work the same way: one signer, one private token, no session. */
  router.use("/public", publicSigningRouter());
  /* The feedback form the office publishes: anyone holding its link can send, nobody can read. */
  router.use("/public", publicFeedbackRouter());
  /* Personal notes: any signed-in role (office users and support workers), each person's own only. */
  router.use("/notes", authenticate, notesRouter());
  /* Messages: any signed-in role too, each person only the conversations they are in. */
  router.use("/messages", authenticate, messagesRouter());
  /* Xero sends the browser back here after sign-in: no session, the one-time state in the URL is the credential. */
  router.get("/integrations/xero/callback", xeroCallback);

  /*
   * Worker portal, mounted before the back office. The Admin router below is mounted at the
   * root, so its office-only guard would otherwise reject portal requests before they
   * ever reached this router.
   */
  const portal = Router();
  portal.use(authenticate, requireRole("staff"));
  portal.use(portalRouter());
  router.use("/portal", portal);

  const secured = Router();
  // Admins and approved office users; the access table decides what each may call (default: Admin only).
  secured.use(authenticate, requireOffice, enforceModuleAccess);
  secured.use("/users", usersRouter());
  secured.use("/me", meRouter());
  secured.use("/settings", settingsRouter());
  secured.use("/staff", staffRouter());
  secured.use("/payroll", payrollRouter());
  secured.use("/feedback", feedbackRouter());
  secured.use("/services", servicesRouter());
  secured.use("/participants", participantsRouter());
  secured.use("/service-records", recordsRouter());
  secured.use("/roster", rosterRouter());
  secured.use("/invoices", invoicesRouter());
  secured.use("/signatures", signaturesRouter());
  secured.use("/integrations/xero", xeroRouter());
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
import { incidentReportableSchema } from "@shared/schemas/feedback";
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
  router.post("/incidents/:id/reportable", async (req, res) => {
    res.json(
      await setIncidentReportable(
        objectIdParam(req, "id", "Incident report"),
        parse(incidentReportableSchema, req.body),
        ctx(req)
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
