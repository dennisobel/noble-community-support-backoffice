import type { Request } from "express";
import { Router } from "express";
import {
  abcCreateSchema,
  abcUpdateSchema,
  incidentCreateSchema,
  incidentUpdateSchema,
  logbookCreateSchema,
  logbookUpdateSchema,
  portalNoteCreateSchema,
  portalNoteUpdateSchema,
  portalReportQuery,
  reportStatusSchema,
  staffDetailsSchema,
  staffDocumentFields,
  staffDocumentPatchSchema,
  timesheetSchema,
  trackingPingSchema,
  trackingStartSchema,
  trackingStopSchema,
  portalShiftQuery,
} from "@shared/schemas/staff-portal";
import { revOnly } from "@shared/schemas/common";
import { payPeriodQuery } from "@shared/schemas/payroll";
import {
  availabilitySchema,
  leaveCreateSchema,
} from "@shared/schemas/workforce";
import { ctx, parse, requireAuth } from "../../lib/http";
import { codeParam, objectIdParam } from "../../lib/mappers";
import { sendStoredFile } from "../../lib/send-file";
import { storage } from "../../lib/storage";
import {
  cleanupUploads,
  documentFileUpload,
  INLINE_SAFE_TYPES,
} from "../../middleware/upload";
import {
  activeSessionFor,
  addPings,
  startTracking,
  stopTracking,
  trackingDTO,
} from "./tracking";
import { portalHome } from "./home";
import {
  addStaffDocument,
  deleteStaffDocument,
  getStaffDocument,
  portalProfile,
  updatePortalDetails,
  updateStaffDocument,
} from "./service";
import {
  createAbcReport,
  createIncident,
  createLogbookEntry,
  deleteLogbookEntry,
  getAbcReport,
  getIncident,
  getLogbookEntry,
  listAbcReports,
  listIncidents,
  listLogbook,
  setAbcStatus,
  setIncidentStatus,
  updateAbcReport,
  updateIncident,
  updateLogbookEntry,
} from "./reports";
import {
  createPortalNote,
  getPortalNote,
  listPortalNotes,
  submitPortalNote,
  updatePortalNote,
} from "./notes";
import { getPortalShift, listPortalShifts, updateTimesheet } from "./shifts";
import { listOwnTimesheets } from "../payroll/timesheets";
import { getAvailability, setAvailability } from "../staff/availability";
import { cancelLeave, listOwnLeave, requestLeave } from "../staff/leave";

/** The signed-in worker's team member id (the portal is staff-only). */
function me(req: Request): string {
  const staffId = requireAuth(req).user.staffId;
  if (!staffId)
    throw new Error("Staff portal access requires a worker account.");
  return staffId;
}

/** Query string values arrive as unknown; only pass through real strings. */
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

/** Mounted under /portal for signed-in staff accounts. */
export function portalRouter(): Router {
  const router = Router();

  router.get("/home", async (req, res) => {
    res.json(await portalHome(me(req)));
  });
  router.get("/shifts", async (req, res) => {
    res.json(
      await listPortalShifts(me(req), parse(portalShiftQuery, req.query))
    );
  });
  router.get("/shifts/:id", async (req, res) => {
    res.json(await getPortalShift(me(req), req.params.id as string));
  });
  router.post("/shifts/:id/timesheet", async (req, res) => {
    const input = parse(timesheetSchema, req.body ?? {});
    res.json(
      await updateTimesheet(me(req), req.params.id as string, {
        action: input.action,
        breakMinutes: input.breakMinutes,
        kilometres: input.kilometres,
        notes: input.notes,
      })
    );
  });

  /* When they can work, the time off they have asked for, and how their hours stand. */
  router.get("/availability", async (req, res) => {
    res.json(await getAvailability(me(req)));
  });
  router.put("/availability", async (req, res) => {
    res.json(
      await setAvailability(
        me(req),
        parse(availabilitySchema, req.body),
        ctx(req)
      )
    );
  });
  router.get("/leave", async (req, res) => {
    res.json(await listOwnLeave(me(req)));
  });
  router.post("/leave", async (req, res) => {
    res
      .status(201)
      .json(
        await requestLeave(
          me(req),
          parse(leaveCreateSchema, req.body),
          ctx(req)
        )
      );
  });
  router.post("/leave/:id/cancel", async (req, res) => {
    res.json(
      await cancelLeave(
        objectIdParam(req, "id", "Leave request"),
        ctx(req),
        me(req)
      )
    );
  });
  router.get("/timesheets", async (req, res) => {
    res.json(
      await listOwnTimesheets(me(req), parse(payPeriodQuery, req.query).date)
    );
  });

  router.get("/profile", async (req, res) => {
    res.json(await portalProfile(me(req)));
  });
  router.patch("/profile", async (req, res) => {
    res.json(
      await updatePortalDetails(
        me(req),
        parse(staffDetailsSchema, req.body),
        ctx(req)
      )
    );
  });

  router.post("/documents", documentFileUpload(), async (req, res) => {
    try {
      const fields = parse(staffDocumentFields, req.body ?? {});
      res
        .status(201)
        .json(await addStaffDocument(me(req), fields, req.file, ctx(req)));
    } finally {
      await cleanupUploads(req);
    }
  });
  router.patch("/documents/:id", async (req, res) => {
    res.json(
      await updateStaffDocument(
        me(req),
        objectIdParam(req, "id", "Document"),
        parse(staffDocumentPatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/documents/:id", async (req, res) => {
    await deleteStaffDocument(
      me(req),
      objectIdParam(req, "id", "Document"),
      ctx(req)
    );
    res.status(204).end();
  });
  router.get("/documents/:id/download", async (req, res) => {
    const document = await getStaffDocument(
      objectIdParam(req, "id", "Document"),
      me(req)
    );
    if (!document.file) throw new Error("Document has no file.");
    const inline =
      req.query.inline === "1" && INLINE_SAFE_TYPES.has(document.file.mimeType);
    await sendStoredFile(
      res,
      {
        absolutePath: storage.resolve(document.file.storageKey),
        originalName: document.file.originalName,
        mimeType: document.file.mimeType,
      },
      inline ? "inline" : "attachment"
    );
  });

  router.get("/incidents", async (req, res) => {
    res.json(await listIncidents(me(req), parse(portalReportQuery, req.query)));
  });
  router.post("/incidents", async (req, res) => {
    res
      .status(201)
      .json(
        await createIncident(
          me(req),
          parse(incidentCreateSchema, req.body),
          ctx(req)
        )
      );
  });
  router.get("/incidents/:id", async (req, res) => {
    res.json(
      await getIncident(me(req), objectIdParam(req, "id", "Incident report"))
    );
  });
  router.patch("/incidents/:id", async (req, res) => {
    res.json(
      await updateIncident(
        me(req),
        objectIdParam(req, "id", "Incident report"),
        parse(incidentUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/incidents/:id/status", async (req, res) => {
    res.json(
      await setIncidentStatus(
        me(req),
        objectIdParam(req, "id", "Incident report"),
        parse(reportStatusSchema, req.body),
        ctx(req)
      )
    );
  });

  router.get("/abc", async (req, res) => {
    res.json(
      await listAbcReports(me(req), parse(portalReportQuery, req.query))
    );
  });
  router.post("/abc", async (req, res) => {
    res
      .status(201)
      .json(
        await createAbcReport(
          me(req),
          parse(abcCreateSchema, req.body),
          ctx(req)
        )
      );
  });
  router.get("/abc/:id", async (req, res) => {
    res.json(
      await getAbcReport(me(req), objectIdParam(req, "id", "ABC report"))
    );
  });
  router.patch("/abc/:id", async (req, res) => {
    res.json(
      await updateAbcReport(
        me(req),
        objectIdParam(req, "id", "ABC report"),
        parse(abcUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/abc/:id/status", async (req, res) => {
    res.json(
      await setAbcStatus(
        me(req),
        objectIdParam(req, "id", "ABC report"),
        parse(reportStatusSchema, req.body),
        ctx(req)
      )
    );
  });

  router.get("/logbook", async (req, res) => {
    res.json(await listLogbook(me(req), parse(portalReportQuery, req.query)));
  });
  router.post("/logbook", async (req, res) => {
    res
      .status(201)
      .json(
        await createLogbookEntry(
          me(req),
          parse(logbookCreateSchema, req.body),
          ctx(req)
        )
      );
  });
  router.get("/logbook/:id", async (req, res) => {
    res.json(
      await getLogbookEntry(me(req), objectIdParam(req, "id", "Logbook entry"))
    );
  });
  router.patch("/logbook/:id", async (req, res) => {
    res.json(
      await updateLogbookEntry(
        me(req),
        objectIdParam(req, "id", "Logbook entry"),
        parse(logbookUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/logbook/:id", async (req, res) => {
    await deleteLogbookEntry(
      me(req),
      objectIdParam(req, "id", "Logbook entry"),
      ctx(req)
    );
    res.status(204).end();
  });

  /* Worker progress notes (service records authored by the worker themselves). */
  router.get("/notes", async (req, res) => {
    res.json(
      await listPortalNotes(me(req), {
        status: str(req.query.status),
        clientId: str(req.query.clientId),
        from: str(req.query.from),
        to: str(req.query.to),
        q: str(req.query.q),
      })
    );
  });
  router.post("/notes", async (req, res) => {
    res
      .status(201)
      .json(
        await createPortalNote(
          me(req),
          parse(portalNoteCreateSchema, req.body),
          ctx(req)
        )
      );
  });
  router.get("/notes/:id", async (req, res) => {
    res.json(
      await getPortalNote(me(req), codeParam(req, "SR", "Service record"))
    );
  });
  router.patch("/notes/:id", async (req, res) => {
    res.json(
      await updatePortalNote(
        me(req),
        codeParam(req, "SR", "Service record"),
        parse(portalNoteUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/notes/:id/submit", async (req, res) => {
    res.json(
      await submitPortalNote(
        me(req),
        codeParam(req, "SR", "Service record"),
        parse(revOnly, req.body ?? {}).rev,
        ctx(req)
      )
    );
  });

  /* Live tracking: start a job, send location fixes, resume after a reload, finish. */
  router.get("/tracking/active", async (req, res) => {
    const session = await activeSessionFor(me(req));
    res.json({ active: session ? await trackingDTO(session) : null });
  });
  router.post("/tracking/start", async (req, res) => {
    res
      .status(201)
      .json(
        await startTracking(
          me(req),
          parse(trackingStartSchema, req.body),
          ctx(req)
        )
      );
  });
  router.post("/tracking/:id/pings", async (req, res) => {
    res.json(
      await addPings(
        me(req),
        objectIdParam(req, "id", "Tracking session"),
        parse(trackingPingSchema, req.body)
      )
    );
  });
  router.post("/tracking/:id/stop", async (req, res) => {
    res.json(
      await stopTracking(
        me(req),
        objectIdParam(req, "id", "Tracking session"),
        parse(trackingStopSchema, req.body ?? {}),
        ctx(req)
      )
    );
  });

  return router;
}
