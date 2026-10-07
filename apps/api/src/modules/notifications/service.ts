import { Router } from "express";
import { z } from "zod";
import type { NotificationDTO, NotificationsDTO } from "@shared/dto";
import type { AccessModule } from "@shared/enums";
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
import { countFeedbackNeedingAttention } from "../feedback/service";
import { unreadConversations } from "../messages/service";
import { outstandingReportable } from "../portal/reports";
import { participantLookup } from "../participants/service";
import { countAwaitingTimesheets } from "../payroll/timesheets";
import { countPendingLeave } from "../staff/leave";
import { expiryInfo } from "../portal/checklist";

const STALE_DRAFT_DAYS = 3;

// Only Admins read the workspace notifications; workers get their own panel in the portal.
type NotificationType = NotificationDTO["type"];

/**
 * Which module each notification belongs to, so people only hear about what they can open.
 * "all" is for the few that are about the person themselves, whatever they can open.
 */
const NOTIFICATION_MODULE: Record<
  NotificationType,
  AccessModule | "admin" | "all"
> = {
  record_returned: "clients",
  review_pending: "clients",
  drafts_stale: "clients",
  plan_ending: "clients",
  budget_alert: "clients",
  invoice_overdue: "invoices",
  voice_draft_ready: "voice",
  staff_application: "staff",
  incident_submitted: "worker-reports",
  staff_document_expiring: "staff",
  access_request: "admin",
  leave_request: "staff",
  timesheets_pending: "payroll",
  feedback_open: "feedback",
  incident_reportable: "worker-reports",
  message_unread: "all",
};

/** Admins see everything; everyone else only the modules they have. */
export const notificationFilter =
  (user: { role: string; modules: readonly AccessModule[] }) =>
  (type: NotificationType): boolean => {
    if (user.role === "admin") return true;
    const module = NOTIFICATION_MODULE[type];
    if (module === "all") return true;
    return module !== "admin" && user.modules.includes(module);
  };

export async function notificationsFor(
  userId: string,
  canSee: (type: NotificationType) => boolean = () => true
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
  if (canSee("leave_request")) {
    const pending = await countPendingLeave();
    if (pending)
      items.push({
        key: `leave:${pending}`,
        type: "leave_request",
        severity: "info",
        title: "Time off to decide",
        message: `${pending} request${pending === 1 ? " is" : "s are"} waiting for an answer.`,
        link: "/app/staff/leave",
        at: dayStart(today),
      });
  }
  if (canSee("timesheets_pending")) {
    const awaiting = await countAwaitingTimesheets();
    if (awaiting)
      items.push({
        key: `timesheets:${awaiting}`,
        type: "timesheets_pending",
        severity: "info",
        title: "Timesheets to approve",
        message: `${awaiting} signed-off shift${awaiting === 1 ? " is" : "s are"} waiting for their hours to be approved.`,
        link: "/app/payroll",
        at: dayStart(today),
      });
  }
  const unreadMessages = await unreadConversations(userId);
  if (unreadMessages)
    items.push({
      key: `messages:${unreadMessages}`,
      type: "message_unread",
      severity: "info",
      title: "New messages",
      message: `${unreadMessages} conversation${unreadMessages === 1 ? " has" : "s have"} something new.`,
      link: "/app/messages",
      at: new Date().toISOString(),
    });
  if (canSee("feedback_open")) {
    const { unacknowledged, overdue } = await countFeedbackNeedingAttention();
    if (unacknowledged || overdue)
      items.push({
        key: `feedback:${unacknowledged}:${overdue}`,
        type: "feedback_open",
        severity: overdue ? "warning" : "info",
        title: overdue ? "Feedback past its due date" : "New feedback",
        message: [
          unacknowledged
            ? `${unacknowledged} not acknowledged yet`
            : "",
          overdue ? `${overdue} overdue` : "",
        ]
          .filter(Boolean)
          .join(", ")
          .concat("."),
        link: "/app/feedback",
        at: dayStart(today),
      });
  }
  if (canSee("incident_reportable")) {
    for (const incident of (await outstandingReportable()).slice(0, 5))
      items.push({
        key: `reportable:${incident.id}:${incident.label}`,
        type: "incident_reportable",
        severity: "danger",
        title: incident.overdue
          ? `${incident.label} is overdue`
          : `${incident.label} due`,
        message: `${incident.category}: lodge with the NDIS Commission by ${new Intl.DateTimeFormat(
          "en-AU",
          { dateStyle: "medium", timeStyle: "short", timeZone: timezone }
        ).format(new Date(incident.due))}.`,
        link: `/app/worker-reports/incidents?open=${incident.id}`,
        at: new Date().toISOString(),
      });
  }
  if (canSee("access_request")) {
    const waiting = await User.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean<Array<Pick<UserDoc, "createdAt">>>();
    if (waiting.length) {
      items.push({
        key: `access:${waiting.length}`,
        type: "access_request",
        severity: "info",
        title: "Access requests waiting",
        message: `${waiting.length} ${waiting.length === 1 ? "person has" : "people have"} asked for access to Noble.`,
        link: "/app/settings/users",
        at: waiting[0]!.createdAt.toISOString(),
      });
    }
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

  const shown = items
    .filter(item => canSee(item.type))
    .sort((a, b) => b.at.localeCompare(a.at));
  const seenAt = user?.notificationsSeenAt
    ? user.notificationsSeenAt.toISOString()
    : null;
  return {
    items: shown,
    seenAt,
    unread: shown.filter(item => !seenAt || item.at > seenAt).length,
  };
}

export function notificationsRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const { user } = requireAuth(req);
    res.json(await notificationsFor(user.id, notificationFilter(user)));
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
