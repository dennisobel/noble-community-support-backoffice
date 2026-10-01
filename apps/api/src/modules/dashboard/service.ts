import { Router } from "express";
import type { DashboardDTO } from "@shared/dto";
import type { RecordStatus } from "@shared/enums";
import { addDays } from "@shared/logic/time";
import { workspaceToday } from "../../lib/workspace";
import {
  Activity,
  Participant,
  RosterShift,
  ServiceRecord,
  type ActivityDoc,
  type RosterShiftDoc,
  type ServiceRecordDoc,
} from "../../models";
import { toActivityDTO } from "../activity/service";
import { invoiceSummary } from "../invoices/service";
import { participantLookup } from "../participants/service";
import { countRecords } from "../records/service";

const QUEUE_ORDER: Record<string, number> = {
  Returned: 0,
  Submitted: 1,
  Draft: 2,
};
const COMPLETE: RecordStatus[] = ["Submitted", "Approved", "Invoiced"];

export async function dashboard(): Promise<DashboardDTO> {
  const today = await workspaceToday();
  const [
    counts,
    activeParticipants,
    queue,
    shifts,
    todayRecords,
    weekRecords,
    billing,
    activity,
  ] = await Promise.all([
    countRecords(),
    Participant.countDocuments({ status: "Active" }),
    ServiceRecord.find({ status: { $in: ["Returned", "Submitted", "Draft"] } })
      .sort({ updatedAt: -1 })
      .limit(40)
      .select("_id clientId status date correction updatedAt")
      .lean<ServiceRecordDoc[]>(),
    RosterShift.find({ date: today, status: { $ne: "Cancelled" } })
      .sort({ start: 1 })
      .limit(3)
      .lean<RosterShiftDoc[]>(),
    ServiceRecord.find({ date: today })
      .sort({ start: 1 })
      .limit(3)
      .lean<ServiceRecordDoc[]>(),
    ServiceRecord.find({ date: { $gte: addDays(today, -6), $lte: today } })
      .select("status")
      .lean<Array<{ status: RecordStatus }>>(),
    invoiceSummary(),
    Activity.find({ action: { $not: /^auth\./ } })
      .sort({ at: -1 })
      .limit(5)
      .lean<ActivityDoc[]>(),
  ]);

  const actionQueue = [...queue]
    .sort(
      (a, b) =>
        QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status] ||
        b.updatedAt.getTime() - a.updatedAt.getTime()
    )
    .slice(0, 4);
  const participants = await participantLookup([
    ...actionQueue.map(record => record.clientId),
    ...shifts.flatMap(shift => shift.clientIds),
    ...todayRecords.map(record => record.clientId),
  ]);
  const name = (id: unknown) =>
    participants.get(String(id))?.preferred ?? "Unknown";

  const complete = weekRecords.filter(record =>
    COMPLETE.includes(record.status)
  ).length;
  return {
    today,
    kpis: {
      awaitingReview: counts.Submitted,
      needsCompletion: counts.Draft + counts.Returned,
      readyToInvoice: counts.Approved,
      activeParticipants,
    },
    actionQueue: actionQueue.map(record => ({
      recordId: record._id,
      status: record.status,
      clientName: name(record.clientId),
      date: record.date,
      correction: record.correction ?? "",
    })),
    todayShifts: shifts.length
      ? shifts.map(shift => ({
          id: shift._id,
          kind: "shift" as const,
          start: shift.start,
          end: shift.end,
          title: `${shift.clientIds.map(name).join(", ")} · ${shift.type}`,
          location: shift.location ?? "",
          recordId: null,
        }))
      : todayRecords.map(record => ({
          id: record._id,
          kind: "record" as const,
          start: record.start,
          end: record.end,
          title: `${name(record.clientId)} · ${record.type}`,
          location: record.location ?? "",
          recordId: record._id,
        })),
    documentationHealth: {
      complete,
      total: weekRecords.length,
      completePct: weekRecords.length
        ? Math.round((complete / weekRecords.length) * 100)
        : 0,
    },
    billing: {
      awaitingInvoice: counts.Approved,
      draftInvoices: billing.drafts,
      outstanding: billing.outstanding,
    },
    recentActivity: activity.map(toActivityDTO),
  };
}

export function dashboardRouter(): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.json(await dashboard());
  });
  return router;
}
