import { Router, type Request } from "express";
import { z } from "zod";
import { revOnly } from "@shared/schemas/common";
import {
  payAdjustmentSchema,
  payPeriodQuery,
  payRateSchema,
  payRunCreateSchema,
  paySettingsSchema,
  timesheetApproveSchema,
  timesheetBulkSchema,
} from "@shared/schemas/payroll";
import { contentDisposition, ctx, parse } from "../../lib/http";
import { codeParam, objectIdParam } from "../../lib/mappers";
import {
  addAdjustment,
  createPayRun,
  deletePayRun,
  exportPayRun,
  finalisePayRun,
  getPayRun,
  listPayRuns,
  removeAdjustment,
  reopenPayRun,
} from "./payruns";
import {
  getPaySettings,
  listClassificationOptions,
  listStaffPay,
  periodAround,
  setPayRate,
  updatePaySettings,
} from "./settings";
import {
  approveClean,
  approveTimesheet,
  getTimesheet,
  listTimesheets,
  unapproveTimesheet,
} from "./timesheets";

const shiftId = (req: Request) => codeParam(req, "SH", "Timesheet", "shiftId");
const staffId = (req: Request) => objectIdParam(req, "staffId", "Timesheet");
const runId = (req: Request) => codeParam(req, "PR", "Pay run");

const timesheetQuery = payPeriodQuery.extend({
  cancelled: z.enum(["true", "false"]).optional(),
});
const exportQuery = z.object({
  detail: z.enum(["summary", "lines"]).default("summary"),
});

/** Timesheets, pay runs and the pay rules behind them. */
export function payrollRouter(): Router {
  const router = Router();

  /* Pay rules */
  router.get("/settings", async (_req, res) => {
    res.json(await getPaySettings());
  });
  router.put("/settings", async (req, res) => {
    res.json(
      await updatePaySettings(parse(paySettingsSchema, req.body), ctx(req))
    );
  });
  /* Names only: the Staff page needs the list to choose from, never the rates. */
  router.get("/classifications", async (_req, res) => {
    res.json(await listClassificationOptions());
  });
  router.get("/period", async (req, res) => {
    res.json(await periodAround(parse(payPeriodQuery, req.query).date));
  });
  router.get("/staff", async (_req, res) => {
    res.json(await listStaffPay());
  });
  router.put("/staff/:staffId/rate", async (req, res) => {
    res.json(
      await setPayRate(
        objectIdParam(req, "staffId", "Team member"),
        parse(payRateSchema, req.body),
        ctx(req)
      )
    );
  });

  /* Timesheets */
  router.get("/timesheets", async (req, res) => {
    const { cancelled, ...query } = parse(timesheetQuery, req.query);
    res.json(await listTimesheets(query, { cancelled: cancelled === "true" }));
  });
  router.post("/timesheets/approve-clean", async (req, res) => {
    res.json(
      await approveClean(parse(timesheetBulkSchema, req.body ?? {}), ctx(req))
    );
  });
  router.get("/timesheets/:shiftId/:staffId", async (req, res) => {
    res.json(await getTimesheet(shiftId(req), staffId(req)));
  });
  router.post("/timesheets/:shiftId/:staffId/approve", async (req, res) => {
    res.json(
      await approveTimesheet(
        shiftId(req),
        staffId(req),
        parse(timesheetApproveSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/timesheets/:shiftId/:staffId/unapprove", async (req, res) => {
    res.json(await unapproveTimesheet(shiftId(req), staffId(req), ctx(req)));
  });

  /* Pay runs */
  router.get("/pay-runs", async (_req, res) => {
    res.json(await listPayRuns());
  });
  router.post("/pay-runs", async (req, res) => {
    res
      .status(201)
      .json(
        await createPayRun(parse(payRunCreateSchema, req.body ?? {}), ctx(req))
      );
  });
  router.get("/pay-runs/:id", async (req, res) => {
    res.json(await getPayRun(runId(req)));
  });
  router.get("/pay-runs/:id/export", async (req, res) => {
    const { detail } = parse(exportQuery, req.query);
    const file = await exportPayRun(runId(req), detail);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      contentDisposition("attachment", file.filename)
    );
    res.send(file.csv);
  });
  router.post("/pay-runs/:id/adjustments", async (req, res) => {
    res
      .status(201)
      .json(
        await addAdjustment(
          runId(req),
          parse(payAdjustmentSchema, req.body),
          ctx(req)
        )
      );
  });
  router.delete("/pay-runs/:id/adjustments/:adjustmentId", async (req, res) => {
    res.json(
      await removeAdjustment(
        runId(req),
        objectIdParam(req, "adjustmentId", "Adjustment")
      )
    );
  });
  router.post("/pay-runs/:id/finalise", async (req, res) => {
    res.json(
      await finalisePayRun(
        runId(req),
        parse(revOnly, req.body ?? {}).rev,
        ctx(req)
      )
    );
  });
  router.post("/pay-runs/:id/reopen", async (req, res) => {
    res.json(await reopenPayRun(runId(req), ctx(req)));
  });
  router.delete("/pay-runs/:id", async (req, res) => {
    await deletePayRun(runId(req), ctx(req));
    res.status(204).end();
  });

  return router;
}
