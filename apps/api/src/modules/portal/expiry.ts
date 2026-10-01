import type { Types } from "mongoose";
import { prettyDate } from "@shared/logic/time";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { enqueueJob, registerJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { sendMail } from "../../lib/mailer";
import { workspaceToday } from "../../lib/workspace";
import {
  Staff,
  StaffDocument,
  User,
  type StaffDoc,
  type StaffDocumentDoc,
} from "../../models";
import { expiryInfo, reminderThreshold } from "./checklist";

export interface ExpirySweepResult {
  today: string;
  checked: number;
  expired: number;
  remindersSent: number;
  notifiedDocuments: Array<{
    documentId: string;
    staffName: string;
    title: string;
    daysLeft: number | null;
  }>;
}

const PORTAL_DOCS = "/staff/profile";

interface SweepState extends ExpirySweepResult {
  admins: Array<{ email: string; name: string }>;
}

function describeDays(daysLeft: number | null): string {
  if (daysLeft === null || daysLeft < 0) return "expired";
  return `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

function digestLines(state: SweepState): string {
  return state.notifiedDocuments
    .map(
      row => `• ${row.staffName}: ${row.title} — ${describeDays(row.daysLeft)}`
    )
    .join("\n");
}

function digestHtml(state: SweepState): string {
  return state.notifiedDocuments
    .map(
      row =>
        `<li><b>${row.staffName}</b>: ${row.title} — ${describeDays(row.daysLeft)}</li>`
    )
    .join("");
}

async function markNotified(
  documentId: Types.ObjectId | string,
  today: string,
  days: number | null
): Promise<void> {
  await StaffDocument.updateOne(
    { _id: documentId },
    { $set: { lastNotifiedOn: today, lastNotifiedDays: days } }
  );
}

async function sendReminder(
  member: StaffDoc,
  document: StaffDocumentDoc,
  daysLeft: number,
  threshold: number,
  today: string,
  state: SweepState
): Promise<void> {
  const emailed = await sendMail({
    to: member.email,
    subject: `Your ${document.title} ${describeDays(daysLeft)}`,
    text: `Hi ${member.name},\n\nYour "${document.title}" on file ${describeDays(daysLeft)} (on ${document.expiry}). Please renew it and upload the new document from your staff portal:\n\n${config().appUrl}${PORTAL_DOCS}\n`,
    html: `<p>Hi ${member.name},</p><p>Your &ldquo;${document.title}&rdquo; on file ${describeDays(daysLeft)} (on ${document.expiry}). Please renew it and upload the new document from your staff portal:</p><p><a href="${config().appUrl}${PORTAL_DOCS}">Open my documents</a></p>`,
  }).catch(error => {
    logger().error({ err: error }, "Expiry reminder email failed");
    return false;
  });
  await markNotified(document._id, today, threshold);
  if (emailed || !config().production) {
    state.remindersSent += 1;
    state.notifiedDocuments.push({
      documentId: String(document._id),
      staffName: member.name,
      title: document.title,
      daysLeft,
    });
    await logActivity({
      actor: null,
      action: "staff.expiry_reminder",
      entityType: "staff",
      entityId: String(member._id),
      summary: `reminded ${member.name} that ${document.title} ${describeDays(daysLeft)}`,
      ip: "cron",
    });
  }
}

async function sendExpired(
  member: StaffDoc,
  document: StaffDocumentDoc,
  today: string,
  state: SweepState
): Promise<void> {
  if (document.lastNotifiedOn === today) return;
  const emailed = await sendMail({
    to: member.email,
    subject: `Action needed: your ${document.title} has expired`,
    text: `Hi ${member.name},\n\nYour "${document.title}" expired on ${document.expiry}. Please renew it and upload the new document from your staff portal:\n\n${config().appUrl}${PORTAL_DOCS}\n`,
    html: `<p>Hi ${member.name},</p><p>Your &ldquo;${document.title}&rdquo; expired on ${document.expiry}. Please renew it and upload the new document from your staff portal:</p><p><a href="${config().appUrl}${PORTAL_DOCS}">Open my documents</a></p>`,
  }).catch(error => {
    logger().error({ err: error }, "Expiry email failed");
    return false;
  });
  await markNotified(document._id, today, null);
  if (emailed || !config().production) {
    state.remindersSent += 1;
    state.notifiedDocuments.push({
      documentId: String(document._id),
      staffName: member.name,
      title: document.title,
      daysLeft: null,
    });
    await logActivity({
      actor: null,
      action: "staff.document_expired",
      entityType: "staff",
      entityId: String(member._id),
      summary: `${document.title} expired`,
      ip: "cron",
    });
  }
}

/**
 * The daily expiry sweep. Every morning the API finds every held document with an
 * expiry inside a reminder threshold (or past it), emails the worker once per
 * threshold, and sends one digest to every Admin. `lastNotifiedOn` /
 * `lastNotifiedDays` stop the same reminder going out twice.
 */
export async function runExpirySweep(
  todayOverride?: string
): Promise<ExpirySweepResult> {
  const today = todayOverride ?? (await workspaceToday());
  const candidates = await StaffDocument.find({
    deletedAt: null,
    expiry: { $ne: null },
    $or: [{ lastNotifiedOn: { $ne: today } }, { lastNotifiedOn: null }],
  })
    .sort({ expiry: 1 })
    .lean<StaffDocumentDoc[]>();

  const staffIds = [
    ...new Set(candidates.map(document => String(document.staffId))),
  ];
  const [members, admins] = await Promise.all([
    Staff.find({ _id: { $in: staffIds } }).lean<StaffDoc[]>(),
    User.find({ role: "admin", status: "active" })
      .select("email name")
      .lean<Array<{ email: string; name: string }>>(),
  ]);
  const staffById = new Map(
    members.map(member => [String(member._id), member])
  );

  const state: SweepState = {
    today,
    checked: candidates.length,
    expired: 0,
    remindersSent: 0,
    notifiedDocuments: [],
    admins,
  };

  for (const document of candidates) {
    const member = staffById.get(String(document.staffId));
    if (!member) continue;
    const info = expiryInfo(document.expiry, today);
    if (info.daysLeft === null) continue;
    if (info.daysLeft < 0) {
      state.expired += 1;
      await sendExpired(member, document, today, state);
      continue;
    }
    const threshold = reminderThreshold(info.daysLeft);
    if (threshold === null) continue;
    if (
      document.lastNotifiedOn === today ||
      document.lastNotifiedDays === threshold
    )
      continue;
    await sendReminder(
      member,
      document,
      info.daysLeft,
      threshold,
      today,
      state
    );
  }

  if (state.notifiedDocuments.length && state.admins.length) {
    const recipients = state.admins.map(admin => admin.email).join(", ");
    const emailed = await sendMail({
      to: recipients,
      subject: `Document expiry digest — ${prettyDate(today)}`,
      text: `Hi,\n\nThe following team documents need attention:\n\n${digestLines(state)}\n\nOpen the Staff directory to review them.\n`,
      html: `<p>Hi,</p><p>The following team documents need attention:</p><ul>${digestHtml(state)}</ul><p>Open the Staff directory to review them.</p>`,
    }).catch(error => {
      logger().error({ err: error }, "Expiry digest email failed");
      return false;
    });
    if (emailed) state.remindersSent += 1;
    else if (!config().production)
      logger().info({ lines: digestLines(state) }, "Expiry digest (no SMTP)");
  }

  const { admins: _admins, ...result } = state;
  void _admins;
  return result;
}

/** Queues the sweep through the background-job system (the cron tick is just this). */
export function enqueueExpirySweep(): Promise<void> {
  return enqueueJob("expiry-alerts", { at: new Date().toISOString() }, 1);
}

registerJob("expiry-alerts", async () => {
  const result = await runExpirySweep();
  logger().info(
    { checked: result.checked, reminders: result.remindersSent },
    "Document expiry sweep completed"
  );
});
