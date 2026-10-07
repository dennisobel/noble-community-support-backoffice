import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import type { z } from "zod";
import {
  FEEDBACK_ACKNOWLEDGE_BUSINESS_DAYS,
  FEEDBACK_RESOLVE_DAYS,
} from "@shared/const";
import type {
  FeedbackCaseDTO,
  FeedbackFormDTO,
  FeedbackListDTO,
  FeedbackOptionsDTO,
  FeedbackSummaryDTO,
  PublicFeedbackFormDTO,
  PublicFeedbackResultDTO,
} from "@shared/dto";
import type { FeedbackStatus } from "@shared/enums";
import { addBusinessDays } from "@shared/logic/holidays";
import { addDays, prettyDate } from "@shared/logic/time";
import type {
  feedbackActionPatchSchema,
  feedbackActionSchema,
  feedbackCreateSchema,
  feedbackFormSchema,
  feedbackListQuery,
  feedbackStatusSchema,
  feedbackUpdateSchema,
  publicFeedbackSchema,
} from "@shared/schemas/feedback";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { nextIds } from "../../lib/counters";
import { errors } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import {
  actorDTO,
  assertRev,
  historyDTO,
  historyEntry,
  iso,
  isoRequired,
} from "../../lib/mappers";
import {
  getWorkspace,
  invalidateWorkspaceCache,
  workspaceToday,
} from "../../lib/workspace";
import {
  FeedbackCase,
  IncidentReport,
  Participant,
  Staff,
  User,
  Workspace,
  WORKSPACE_ID,
  type ActorRefSub,
  type FeedbackCaseDoc,
  type IncidentReportDoc,
  type ParticipantDoc,
  type StaffDoc,
} from "../../models";
import { publicHolidaySet } from "../payroll/settings";

/*
 * The complaints and feedback register. A case moves New → Acknowledged → Investigating →
 * Resolved → Closed, with a date to acknowledge by and a date to resolve by from the moment it
 * arrives. Anything that has to be done as a result is an action on the case, and anything that
 * has to change for good is its improvement note.
 */

const OPEN: FeedbackStatus[] = ["New", "Acknowledged", "Investigating"];

interface Names {
  participants: Map<string, string>;
  staff: Map<string, string>;
}

async function namesFor(cases: FeedbackCaseDoc[]): Promise<Names> {
  const ids = (key: "participantId" | "staffId") => [
    ...new Set(cases.map(item => item[key]).filter(Boolean).map(String)),
  ];
  const [participants, staff] = await Promise.all([
    Participant.find({ _id: { $in: ids("participantId") } })
      .select("name preferred")
      .lean<ParticipantDoc[]>(),
    Staff.find({ _id: { $in: ids("staffId") } })
      .select("name")
      .lean<StaffDoc[]>(),
  ]);
  return {
    participants: new Map(
      participants.map(item => [String(item._id), item.preferred || item.name])
    ),
    staff: new Map(staff.map(item => [String(item._id), item.name])),
  };
}

/** The step that is waiting, and the date it is due by. Nothing is due once a case is resolved. */
function dueOf(
  item: FeedbackCaseDoc,
  today: string
): FeedbackSummaryDTO["due"] {
  if (item.status === "New")
    return {
      label: "Acknowledge",
      date: item.acknowledgeBy,
      overdue: item.acknowledgeBy < today,
    };
  if (item.status === "Acknowledged" || item.status === "Investigating")
    return {
      label: "Resolve",
      date: item.resolveBy,
      overdue: item.resolveBy < today,
    };
  return null;
}

function toSummaryDTO(
  item: FeedbackCaseDoc,
  names: Names,
  today: string
): FeedbackSummaryDTO {
  const participantId = item.participantId ? String(item.participantId) : null;
  const staffId = item.staffId ? String(item.staffId) : null;
  return {
    id: item._id,
    kind: item.kind,
    status: item.status,
    priority: item.priority,
    area: item.area,
    channel: item.channel,
    summary: item.summary,
    receivedOn: item.receivedOn,
    raisedByName: item.raisedBy?.anonymous
      ? "Anonymous"
      : item.raisedBy?.name || "Not given",
    relationship: item.raisedBy?.relationship ?? "Other",
    participantId,
    participantName: participantId
      ? (names.participants.get(participantId) ?? "")
      : "",
    staffId,
    staffName: staffId ? (names.staff.get(staffId) ?? "") : "",
    owner: actorDTO(item.owner),
    acknowledgeBy: item.acknowledgeBy,
    resolveBy: item.resolveBy,
    due: dueOf(item, today),
    openActions: (item.actions ?? []).filter(action => !action.doneAt).length,
    viaPublicForm: Boolean(item.viaPublicForm),
    createdAt: isoRequired(item.createdAt),
    updatedAt: isoRequired(item.updatedAt),
  };
}

async function incidentLabel(id: Types.ObjectId | null): Promise<string> {
  if (!id) return "";
  const incident = await IncidentReport.findById(id)
    .select("date category")
    .lean<Pick<IncidentReportDoc, "date" | "category">>();
  return incident ? `${prettyDate(incident.date)} · ${incident.category}` : "";
}

async function toCaseDTO(item: FeedbackCaseDoc): Promise<FeedbackCaseDTO> {
  const [names, today, label] = await Promise.all([
    namesFor([item]),
    workspaceToday(),
    incidentLabel(item.incidentId),
  ]);
  return {
    ...toSummaryDTO(item, names, today),
    details: item.details,
    desiredOutcome: item.desiredOutcome ?? "",
    aboutText: item.aboutText ?? "",
    raisedBy: {
      name: item.raisedBy?.name ?? "",
      relationship: item.raisedBy?.relationship ?? "Other",
      phone: item.raisedBy?.phone ?? "",
      email: item.raisedBy?.email ?? "",
      anonymous: Boolean(item.raisedBy?.anonymous),
      wantsContact: item.raisedBy?.wantsContact ?? true,
    },
    incidentId: item.incidentId ? String(item.incidentId) : null,
    incidentLabel: label,
    acknowledgedAt: iso(item.acknowledgedAt),
    resolvedAt: iso(item.resolvedAt),
    closedAt: iso(item.closedAt),
    outcome: item.outcome ?? "",
    satisfaction: item.satisfaction ?? "Not asked",
    improvementNeeded: Boolean(item.improvementNeeded),
    improvement: item.improvement ?? "",
    actions: (item.actions ?? []).map(action => ({
      id: String(action._id),
      description: action.description,
      owner: action.owner ?? "",
      due: action.due ?? null,
      doneAt: iso(action.doneAt),
      doneBy: actorDTO(action.doneBy),
      overdue: Boolean(action.due && !action.doneAt && action.due < today),
    })),
    history: historyDTO(item.history),
    rev: item.rev ?? 0,
  };
}

async function loadCase(id: string): Promise<FeedbackCaseDoc> {
  const item = await FeedbackCase.findById(id).lean<FeedbackCaseDoc>();
  if (!item) throw errors.notFound("Feedback");
  return item;
}

/* ───────────── The public form's link ───────────── */

async function formDTO(): Promise<FeedbackFormDTO> {
  const form = (await getWorkspace()).feedbackForm;
  const open = Boolean(form?.enabled && form.token);
  return {
    enabled: open,
    url: open ? `${config().appUrl}/feedback/${form!.token}` : null,
  };
}

/** Turns the public form on or off. Turning it off, or asking for a new link, stops the old one. */
export async function setFeedbackForm(
  input: z.output<typeof feedbackFormSchema>,
  ctx: RequestContext
): Promise<FeedbackFormDTO> {
  const current = (await getWorkspace()).feedbackForm;
  const token =
    input.enabled && (input.regenerate || !current?.token)
      ? randomBytes(24).toString("base64url")
      : (current?.token ?? null);
  await Workspace.updateOne(
    { _id: WORKSPACE_ID },
    { $set: { feedbackForm: { enabled: input.enabled, token } } }
  );
  invalidateWorkspaceCache();
  await logActivity({
    actor: ctx.actor,
    action: "feedback.form_changed",
    entityType: "workspace",
    entityId: WORKSPACE_ID,
    summary: input.enabled
      ? input.regenerate
        ? "issued a new public feedback link"
        : "turned the public feedback form on"
      : "turned the public feedback form off",
    ip: ctx.ip,
  });
  return formDTO();
}

/* ───────────── The register ───────────── */

export async function listFeedback(
  query: z.output<typeof feedbackListQuery>
): Promise<FeedbackListDTO> {
  const filter: Record<string, unknown> = {};
  if (query.status === "open") filter.status = { $in: OPEN };
  else if (query.status !== "all") filter.status = query.status;
  if (query.kind) filter.kind = query.kind;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [
      { _id: pattern },
      { summary: pattern },
      { details: pattern },
      { "raisedBy.name": pattern },
    ];
  }
  const today = await workspaceToday();
  const [cases, open, closedRecently, form] = await Promise.all([
    FeedbackCase.find(filter)
      .sort({ receivedOn: -1, createdAt: -1 })
      .limit(300)
      .lean<FeedbackCaseDoc[]>(),
    FeedbackCase.find({ status: { $in: OPEN } })
      .select("status acknowledgeBy resolveBy")
      .lean<FeedbackCaseDoc[]>(),
    FeedbackCase.countDocuments({
      status: { $in: ["Resolved", "Closed"] },
      resolvedAt: { $gte: new Date(Date.now() - 30 * 86_400_000) },
    }),
    formDTO(),
  ]);
  const names = await namesFor(cases);
  const items = cases.map(item => toSummaryDTO(item, names, today));
  // The ones that are late come first, then the newest.
  items.sort(
    (a, b) =>
      Number(Boolean(b.due?.overdue)) - Number(Boolean(a.due?.overdue)) ||
      b.receivedOn.localeCompare(a.receivedOn)
  );
  return {
    items,
    totals: {
      open: open.length,
      overdue: open.filter(item => dueOf(item, today)?.overdue).length,
      unacknowledged: open.filter(item => item.status === "New").length,
      closedRecently,
    },
    form,
  };
}

export async function getFeedback(id: string): Promise<FeedbackCaseDTO> {
  return toCaseDTO(await loadCase(id));
}

/** What the "log feedback" form chooses from. */
export async function feedbackOptions(): Promise<FeedbackOptionsDTO> {
  const [owners, participants, staff, incidents] = await Promise.all([
    User.find({ role: { $ne: "staff" }, status: "active" })
      .select("name")
      .sort({ name: 1 })
      .lean<Array<{ _id: Types.ObjectId; name: string }>>(),
    Participant.find({ status: "Active" })
      .select("name preferred")
      .sort({ name: 1 })
      .lean<ParticipantDoc[]>(),
    Staff.find({ status: { $ne: "Inactive" } })
      .select("name")
      .sort({ name: 1 })
      .lean<StaffDoc[]>(),
    IncidentReport.find({ status: { $ne: "Draft" } })
      .select("date category")
      .sort({ date: -1 })
      .limit(100)
      .lean<Array<Pick<IncidentReportDoc, "_id" | "date" | "category">>>(),
  ]);
  return {
    owners: owners.map(user => ({ id: String(user._id), name: user.name })),
    participants: participants.map(item => ({
      id: String(item._id),
      name: item.name,
    })),
    staff: staff.map(item => ({ id: String(item._id), name: item.name })),
    incidents: incidents.map(item => ({
      id: String(item._id),
      label: `${prettyDate(item.date)} · ${item.category}`,
    })),
  };
}

async function ownerRef(id: string | null | undefined): Promise<ActorRefSub | null> {
  if (!id) return null;
  const user = await User.findOne({ _id: id, role: { $ne: "staff" } })
    .select("name")
    .lean<{ _id: Types.ObjectId; name: string }>();
  if (!user)
    throw errors.validation("Choose an owner who has a back-office account.", [
      { path: "ownerId", message: "Unknown owner." },
    ]);
  return { id: String(user._id), name: user.name };
}

/** The dates a case arriving on a day should be acknowledged and resolved by. */
async function dueDates(receivedOn: string) {
  return {
    acknowledgeBy: addBusinessDays(
      receivedOn,
      FEEDBACK_ACKNOWLEDGE_BUSINESS_DAYS,
      await publicHolidaySet()
    ),
    resolveBy: addDays(receivedOn, FEEDBACK_RESOLVE_DAYS),
  };
}

const ref = (value: string | null | undefined) =>
  value ? new Types.ObjectId(value) : null;

export async function createFeedback(
  input: z.output<typeof feedbackCreateSchema>,
  ctx: RequestContext
): Promise<FeedbackCaseDTO> {
  const today = await workspaceToday();
  const receivedOn = input.receivedOn ?? today;
  if (receivedOn > today)
    throw errors.validation("The received date cannot be in the future.", [
      { path: "receivedOn", message: "Choose today or an earlier date." },
    ]);
  const due = await dueDates(receivedOn);
  const owner = await ownerRef(input.ownerId);
  const id = await nextIds.feedback();
  const created = await FeedbackCase.create({
    _id: id,
    kind: input.kind,
    status: "New",
    priority: input.priority ?? (input.kind === "Complaint" ? "Medium" : "Low"),
    area: input.area ?? "Service delivery",
    channel: input.channel ?? "Phone",
    summary: input.summary,
    details: input.details,
    desiredOutcome: input.desiredOutcome ?? "",
    raisedBy: {
      name: input.raisedBy?.name ?? "",
      relationship: input.raisedBy?.relationship ?? "Participant",
      phone: input.raisedBy?.phone ?? "",
      email: input.raisedBy?.email ?? "",
      anonymous: input.raisedBy?.anonymous ?? false,
      wantsContact: input.raisedBy?.wantsContact ?? true,
    },
    participantId: ref(input.participantId),
    staffId: ref(input.staffId),
    incidentId: ref(input.incidentId),
    owner,
    receivedOn,
    acknowledgeBy: due.acknowledgeBy,
    resolveBy: input.resolveBy || due.resolveBy,
    history: [historyEntry(ctx.actor, "logged")],
    createdBy: ctx.actor,
  });
  await logActivity({
    actor: ctx.actor,
    action: "feedback.created",
    entityType: "feedback",
    entityId: id,
    // Not tied to the client: their activity feed is read by people who cannot open the register.
    summary: `logged a ${input.kind.toLowerCase()} (${id})`,
    ip: ctx.ip,
  });
  return toCaseDTO(created.toObject<FeedbackCaseDoc>());
}

export async function updateFeedback(
  id: string,
  input: z.output<typeof feedbackUpdateSchema>,
  ctx: RequestContext
): Promise<FeedbackCaseDTO> {
  const current = await loadCase(id);
  assertRev({ rev: current.rev ?? 0 }, input.rev);
  const $set: Record<string, unknown> = {};
  for (const key of [
    "kind",
    "channel",
    "summary",
    "details",
    "desiredOutcome",
    "area",
    "priority",
    "improvementNeeded",
    "improvement",
  ] as const)
    if (input[key] !== undefined) $set[key] = input[key];
  if (input.raisedBy)
    for (const [key, value] of Object.entries(input.raisedBy))
      if (value !== undefined) $set[`raisedBy.${key}`] = value;
  for (const key of ["participantId", "staffId", "incidentId"] as const)
    if (input[key] !== undefined) $set[key] = ref(input[key]);
  if (input.ownerId !== undefined) $set.owner = await ownerRef(input.ownerId);
  if (input.receivedOn && input.receivedOn !== current.receivedOn) {
    if (input.receivedOn > (await workspaceToday()))
      throw errors.validation("The received date cannot be in the future.", [
        { path: "receivedOn", message: "Choose today or an earlier date." },
      ]);
    const due = await dueDates(input.receivedOn);
    $set.receivedOn = input.receivedOn;
    $set.acknowledgeBy = due.acknowledgeBy;
    if (!input.resolveBy) $set.resolveBy = due.resolveBy;
  }
  if (input.resolveBy) $set.resolveBy = input.resolveBy;
  const ownerChanged =
    input.ownerId !== undefined &&
    (($set.owner as ActorRefSub | null)?.id ?? null) !==
      (current.owner?.id ?? null);
  const updated = await FeedbackCase.findOneAndUpdate(
    { _id: id, rev: current.rev ?? 0 },
    {
      $set,
      $inc: { rev: 1 },
      ...(ownerChanged
        ? {
            $push: {
              history: historyEntry(
                ctx.actor,
                "owner changed",
                ($set.owner as ActorRefSub | null)?.name ?? "No owner"
              ),
            },
          }
        : {}),
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "feedback.updated",
    entityType: "feedback",
    entityId: id,
    summary: `updated ${id}`,
    ip: ctx.ip,
  });
  return toCaseDTO(updated as FeedbackCaseDoc);
}

/** Moves a case along. Resolving or closing a complaint needs its outcome written down first. */
export async function setFeedbackStatus(
  id: string,
  input: z.output<typeof feedbackStatusSchema>,
  ctx: RequestContext
): Promise<FeedbackCaseDTO> {
  const current = await loadCase(id);
  assertRev({ rev: current.rev ?? 0 }, input.rev);
  if (input.status === current.status)
    throw errors.invalidState(`${id} is already ${current.status.toLowerCase()}.`);
  const outcome = input.outcome ?? current.outcome ?? "";
  const finishing = input.status === "Resolved" || input.status === "Closed";
  if (finishing && current.kind === "Complaint" && !outcome.trim())
    throw errors.validation(
      "Write down the outcome before resolving a complaint.",
      [{ path: "outcome", message: "Say what was found and decided." }]
    );
  const now = new Date();
  const $set: Record<string, unknown> = { status: input.status };
  if (input.outcome !== undefined) $set.outcome = input.outcome;
  if (input.satisfaction) $set.satisfaction = input.satisfaction;
  if (input.status !== "New" && !current.acknowledgedAt)
    $set.acknowledgedAt = now;
  if (finishing) {
    if (!current.resolvedAt) $set.resolvedAt = now;
    if (input.status === "Closed") $set.closedAt = now;
    else $set.closedAt = null;
  } else {
    // Reopened: the clock is running again.
    $set.resolvedAt = null;
    $set.closedAt = null;
    if (input.status === "New") $set.acknowledgedAt = null;
  }
  const reopened = !finishing && !OPEN.includes(current.status);
  const updated = await FeedbackCase.findOneAndUpdate(
    { _id: id, rev: current.rev ?? 0 },
    {
      $set,
      $push: {
        history: historyEntry(
          ctx.actor,
          reopened ? "reopened" : input.status.toLowerCase(),
          input.note
        ),
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "feedback.status_changed",
    entityType: "feedback",
    entityId: id,
    summary: `marked ${id} as ${input.status.toLowerCase()}`,
    ip: ctx.ip,
  });
  return toCaseDTO(updated as FeedbackCaseDoc);
}

export async function addFeedbackNote(
  id: string,
  note: string,
  ctx: RequestContext
): Promise<FeedbackCaseDTO> {
  const updated = await FeedbackCase.findOneAndUpdate(
    { _id: id },
    {
      $push: { history: historyEntry(ctx.actor, "note", note) },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("Feedback");
  return toCaseDTO(updated as FeedbackCaseDoc);
}

/* ───────────── Corrective actions ───────────── */

export async function addFeedbackAction(
  id: string,
  input: z.output<typeof feedbackActionSchema>,
  ctx: RequestContext
): Promise<FeedbackCaseDTO> {
  const updated = await FeedbackCase.findOneAndUpdate(
    { _id: id },
    {
      $push: {
        actions: {
          _id: new Types.ObjectId(),
          description: input.description,
          owner: input.owner ?? "",
          due: input.due || null,
          doneAt: null,
          doneBy: null,
        },
        history: historyEntry(ctx.actor, "action added", input.description),
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("Feedback");
  return toCaseDTO(updated as FeedbackCaseDoc);
}

export async function updateFeedbackAction(
  id: string,
  actionId: string,
  input: z.output<typeof feedbackActionPatchSchema>,
  ctx: RequestContext
): Promise<FeedbackCaseDTO> {
  const current = await loadCase(id);
  const action = current.actions.find(row => String(row._id) === actionId);
  if (!action) throw errors.notFound("Action");
  const $set: Record<string, unknown> = {};
  if (input.description) $set["actions.$.description"] = input.description;
  if (input.owner !== undefined) $set["actions.$.owner"] = input.owner;
  if (input.due !== undefined) $set["actions.$.due"] = input.due || null;
  const update: Record<string, unknown> = { $set, $inc: { rev: 1 } };
  if (input.done !== undefined && input.done !== Boolean(action.doneAt)) {
    $set["actions.$.doneAt"] = input.done ? new Date() : null;
    $set["actions.$.doneBy"] = input.done ? ctx.actor : null;
    update.$push = {
      history: historyEntry(
        ctx.actor,
        input.done ? "action done" : "action reopened",
        action.description
      ),
    };
  }
  const updated = await FeedbackCase.findOneAndUpdate(
    { _id: id, "actions._id": actionId },
    update,
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("Action");
  return toCaseDTO(updated as FeedbackCaseDoc);
}

export async function removeFeedbackAction(
  id: string,
  actionId: string
): Promise<FeedbackCaseDTO> {
  const updated = await FeedbackCase.findOneAndUpdate(
    { _id: id },
    { $pull: { actions: { _id: actionId } }, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("Feedback");
  return toCaseDTO(updated as FeedbackCaseDoc);
}

/** How many cases need someone: not yet acknowledged, or past the date they were due by. */
export async function countFeedbackNeedingAttention(): Promise<{
  unacknowledged: number;
  overdue: number;
}> {
  const today = await workspaceToday();
  const open = await FeedbackCase.find({ status: { $in: OPEN } })
    .select("status acknowledgeBy resolveBy")
    .lean<FeedbackCaseDoc[]>();
  return {
    unacknowledged: open.filter(item => item.status === "New").length,
    overdue: open.filter(item => dueOf(item, today)?.overdue).length,
  };
}

/* ───────────── The public form ───────────── */

async function openForm(token: string): Promise<boolean> {
  const form = (await getWorkspace()).feedbackForm;
  return Boolean(form?.enabled && form.token && form.token === token);
}

export async function publicFeedbackForm(
  token: string
): Promise<PublicFeedbackFormDTO> {
  const workspace = await getWorkspace();
  return { organisation: workspace.name, open: await openForm(token) };
}

/**
 * Feedback sent from the public link. It lands in the register as a new case with nothing
 * decided for the office: no owner, the default priority, and the sender's own words kept as
 * they wrote them.
 */
export async function submitPublicFeedback(
  token: string,
  input: z.output<typeof publicFeedbackSchema>,
  ip: string
): Promise<PublicFeedbackResultDTO> {
  if (!(await openForm(token))) throw errors.notFound("Feedback form");
  // A filled-in trap field means a script: answer as if it worked and keep nothing.
  if (input.website) return { reference: "FB-0000" };
  const receivedOn = await workspaceToday();
  const due = await dueDates(receivedOn);
  const id = await nextIds.feedback();
  const firstLine = input.details.split(/\r?\n/)[0].trim();
  const named = Boolean(input.name?.trim());
  await FeedbackCase.create({
    _id: id,
    kind: input.kind,
    status: "New",
    priority: input.kind === "Complaint" ? "Medium" : "Low",
    channel: "Online form",
    summary: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine,
    details: input.details,
    desiredOutcome: input.desiredOutcome ?? "",
    aboutText: input.about ?? "",
    raisedBy: {
      name: input.name ?? "",
      relationship: input.relationship ?? "Other",
      phone: input.phone ?? "",
      email: input.email ?? "",
      anonymous: !named,
      wantsContact: Boolean(
        input.wantsContact && (input.phone || input.email)
      ),
    },
    receivedOn,
    acknowledgeBy: due.acknowledgeBy,
    resolveBy: due.resolveBy,
    history: [historyEntry(null, "received from the public form")],
    viaPublicForm: true,
  });
  await logActivity({
    actor: null,
    action: "feedback.received",
    entityType: "feedback",
    entityId: id,
    summary: `received a ${input.kind.toLowerCase()} from the public form (${id})`,
    ip,
  });
  return { reference: id };
}
