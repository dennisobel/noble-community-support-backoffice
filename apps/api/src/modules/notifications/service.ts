import { Router } from "express";
import { z } from "zod";
import type { NotificationDTO, NotificationsDTO } from "@shared/dto";
import { formatMoney } from "@shared/logic/money";
import { addDays, prettyDate, zonedStartOfDay } from "@shared/logic/time";
import { parse, requireAuth } from "../../lib/http";
import { workspaceTimezone, workspaceToday } from "../../lib/workspace";
import {
  IncidentReport,
  Invoice,
  Participant,
  ServiceRecord,
  Staff,
  StaffApplication,
  StaffDocument,
  User,
  VoiceNote,
  type IncidentReportDoc,
  type InvoiceDoc,
  type ParticipantDoc,
  type ServiceRecordDoc,
  type StaffDoc,
  type StaffDocumentDoc,
  type UserDoc,
  type VoiceNoteDoc,
} from "../../models";
import { budgetOverview } from "../budgets/service";
import { participantLookup } from "../participants/service";
import { expiryInfo } from "../portal/checklist";

const STALE_DRAFT_DAYS = 3;

// Only Admins read the workspace notifications; workers get their own panel in the portal.
export async function notificationsFor(
  userId: string
): Promise<NotificationsDTO> {
  const [user, today, timezone] = await Promise.all([
    User.findById(userId)
      .select("preferences notificationsSeenAt")
      .lean<Pick<UserDoc, "preferences" | "notificationsSeenAt">>(),
    workspaceToday(),
    workspaceTimezone(),
  ]);
  const prefs = user?.preferences?.notifications;
  const enabled = (key: keyof NonNullable<typeof prefs>) =>
    prefs?.[key] ?? true;
  const items: NotificationDTO[] = [];
  const dayStart = (ymd: string) =>
    zonedStartOfDay(ymd, timezone).toISOString();

  if (enabled("recordReturned")) {
    const returned = await ServiceRecord.find({ status: "Returned" })
      .sort({ returnedAt: -1 })
      .limit(5)
      .lean<ServiceRecordDoc[]>();
    const names = await participantLookup(
      returned.map(record => record.clientId)
    );
    for (const record of returned) {
      items.push({
        key: `returned:${record._id}:${record.rev}`,
        type: "record_returned",
        severity: "warning",
        title: "Correction requested",
        message: `${record._id} for ${names.get(String(record.clientId))?.preferred ?? "a participant"} was returned for correction.`,
        link: `/app/records/${record._id}`,
        at: (record.returnedAt ?? record.updatedAt).toISOString(),
      });
    }
  }
  if (enabled("reviewQueue")) {
    const [submitted, latest, staleDrafts] = await Promise.all([
      ServiceRecord.countDocuments({ status: "Submitted" }),
      ServiceRecord.findOne({ status: "Submitted" })
        .sort({ submittedAt: -1 })
        .select("submittedAt updatedAt")
        .lean<ServiceRecordDoc>(),
      ServiceRecord.countDocuments({
        status: "Draft",
        updatedAt: {
          $lt: new Date(Date.now() - STALE_DRAFT_DAYS * 86_400_000),
        },
      }),
    ]);
    if (submitted) {
      items.push({
        key: `review:${submitted}`,
        type: "review_pending",
        severity: "info",
        title: "Records awaiting review",
        message: `${submitted} service record${submitted === 1 ? " is" : "s are"} waiting for review.`,
        link: "/app/review",
        at: (
          latest?.submittedAt ??
          latest?.updatedAt ??
          new Date()
        ).toISOString(),
      });
    }
    if (staleDrafts) {
      items.push({
        key: `drafts:${staleDrafts}`,
        type: "drafts_stale",
        severity: "info",
        title: "Drafts need completion",
        message: `${staleDrafts} draft record${staleDrafts === 1 ? " has" : "s have"} not been updated for ${STALE_DRAFT_DAYS}+ days.`,
        link: "/app/review?status=Draft",
        at: dayStart(today),
      });
    }
  }
  if (enabled("budgetAlerts")) {
    const ending = await Participant.find({
      status: "Active",
      planEnd: { $gte: today, $lte: addDays(today, 30) },
    })
      .select("preferred planEnd")
      .lean<ParticipantDoc[]>();
    for (const participant of ending) {
      items.push({
        key: `plan:${participant._id}:${participant.planEnd}`,
        type: "plan_ending",
        severity: "warning",
        title: "Plan ending soon",
        message: `${participant.preferred}'s plan ends on ${prettyDate(participant.planEnd)}.`,
        link: `/app/clients/${participant._id}/budget`,
        at: dayStart(addDays(participant.planEnd!, -30)),
      });
    }
    for (const budget of await budgetOverview()) {
      if (budget.status === "Within plan") continue;
      items.push({
        key: `budget:${budget.clientId}:${budget.status}`,
        type: "budget_alert",
        severity: budget.status === "Low balance" ? "warning" : "danger",
        title: budget.status,
        message: `${budget.clientName}: ${formatMoney(budget.remaining)} remaining in the current plan.`,
        link: `/app/clients/${budget.clientId}/budget`,
        at: dayStart(
          budget.status === "Plan expired" ? addDays(budget.planEnd, 1) : today
        ),
      });
    }
  }
  if (enabled("invoiceOverdue")) {
    const overdue = await Invoice.find({ status: "Sent", due: { $lt: today } })
      .sort({ due: 1 })
      .limit(10)
      .lean<InvoiceDoc[]>();
    for (const invoice of overdue) {
      items.push({
        key: `overdue:${invoice._id}`,
        type: "invoice_overdue",
        severity: "danger",
        title: "Invoice overdue",
        message: `${invoice._id} (${formatMoney(invoice.totalCents / 100)}) was due on ${prettyDate(invoice.due)}.`,
        link: `/app/invoices/${invoice._id}`,
        at: dayStart(addDays(invoice.due, 1)),
      });
    }
  }
  if (enabled("voiceDraftReady")) {
    const drafts = await VoiceNote.find({
      status: { $ne: "Archived" },
      "generation.status": "Draft ready",
      recordId: null,
    })
      .sort({ "generation.generatedAt": -1 })
      .limit(5)
      .lean<VoiceNoteDoc[]>();
    for (const voice of drafts) {
      items.push({
        key: `voice:${voice._id}`,
        type: "voice_draft_ready",
        severity: "info",
        title: "Voice draft ready",
        message: `${voice.title} has a draft note ready for review.`,
        link: `/app/voice/${voice._id}`,
        at: (voice.generation?.generatedAt ?? voice.updatedAt).toISOString(),
      });
    }
  }

  /* Workers waiting for access; staff documents expiring; incidents to review. */
  const [applications, incidents] = await Promise.all([
    StaffApplication.countDocuments({ status: "Pending" }),
    IncidentReport.find({ status: "Submitted" })
      .sort({ date: -1 })
      .limit(5)
      .lean<IncidentReportDoc[]>(),
  ]);
  if (applications) {
    items.push({
      key: `applications:${applications}`,
      type: "staff_application",
      severity: "info",
      title: "Workers waiting for approval",
      message: `${applications} sign-up${applications === 1 ? " is" : "s are"} waiting for portal access.`,
      link: "/app/staff?tab=applications",
      at: dayStart(today),
    });
  }
  if (incidents.length) {
    const staffDocs = await Staff.find({
      _id: { $in: incidents.map(incident => incident.staffId) },
    }).lean<StaffDoc[]>();
    const names = new Map(
      staffDocs.map(member => [String(member._id), member.name])
    );
    for (const incident of incidents) {
      items.push({
        key: `incident:${incident._id}`,
        type: "incident_submitted",
        severity:
          incident.severity === "Critical" || incident.severity === "Major"
            ? "danger"
            : "warning",
        title: `Incident reported (${incident.severity})`,
        message: `${names.get(String(incident.staffId)) ?? "A worker"} logged ${incident.category} on ${prettyDate(incident.date)}.`,
        link: `/app/incidents/${incident._id}`,
        at: incident.updatedAt.toISOString(),
      });
    }
  }
  const expiringDocuments = await StaffDocument.find({
    deletedAt: null,
    expiry: { $ne: null },
  })
    .sort({ expiry: 1 })
    .limit(20)
    .lean<StaffDocumentDoc[]>();
  if (expiringDocuments.length) {
    const staffDocs = await Staff.find({
      _id: { $in: expiringDocuments.map(document => document.staffId) },
    }).lean<StaffDoc[]>();
    const names = new Map(
      staffDocs.map(member => [String(member._id), member.name])
    );
    let shown = 0;
    for (const document of expiringDocuments) {
      const info = expiryInfo(document.expiry, today);
      if (!info.state || info.state === "ok") continue;
      items.push({
        key: `expiry:${document._id}:${document.expiry}`,
        type: "staff_document_expiring",
        severity: info.state === "expired" ? "danger" : "warning",
        title:
          info.state === "expired"
            ? "Staff document expired"
            : "Staff document expiring",
        message: `${names.get(String(document.staffId)) ?? "A worker"}: ${document.title} — ${info.daysLeft !== null && info.daysLeft >= 0 ? `expires ${prettyDate(document.expiry!)}` : `expired ${prettyDate(document.expiry!)}`}.`,
        link: `/app/staff/${document.staffId}/compliance`,
        at: dayStart(document.expiry!),
      });
      if (++shown >= 8) break;
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  const seenAt = user?.notificationsSeenAt
    ? user.notificationsSeenAt.toISOString()
    : null;
  return {
    items,
    seenAt,
    unread: items.filter(item => !seenAt || item.at > seenAt).length,
  };
}

export function notificationsRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await notificationsFor(requireAuth(req).user.id));
  });
  router.post("/read", async (req, res) => {
    parse(z.object({}).passthrough(), req.body ?? {});
    await User.updateOne(
      { _id: requireAuth(req).user.id },
      { $set: { notificationsSeenAt: new Date() } }
    );
    res.status(204).end();
  });
  return router;
}
