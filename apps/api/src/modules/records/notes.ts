import { Types } from "mongoose";
import type { z } from "zod";
import type {
  HandoverNoteDTO,
  MissingNoteDTO,
  NotesOverviewDTO,
  RelatedReportDTO,
  ServiceRecordDTO,
} from "@shared/dto";
import {
  HEALTH_ALERTS,
  INCIDENT_ALERTS,
  NOTE_FIELDS,
  noteChanges,
  noteProblems,
  type NoteContent,
} from "@shared/logic/progress-note";
import {
  addDays,
  minutesOf,
  todayIn,
  zonedInstant,
  zonedStartOfDay,
} from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import type {
  amendmentDeclineSchema,
  amendmentRequestSchema,
  notesOverviewQuery,
  recordAmendSchema,
} from "@shared/schemas/records";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { assertRev, historyEntry } from "../../lib/mappers";
import { getWorkspace } from "../../lib/workspace";
import {
  AbcReport,
  IncidentReport,
  RosterShift,
  ServiceRecord,
  type AbcReportDoc,
  type IncidentReportDoc,
  type NoteAmendmentRequestSub,
  type NoteAmendmentSub,
  type RosterShiftDoc,
  type ServiceRecordDoc,
} from "../../models";
import { participantLookup } from "../participants/service";
import { renderNotePdf } from "./pdf";
import {
  EDITABLE_STATUSES,
  LOCKED_STATUSES,
  getRecordDoc,
  noteContentOf,
  recordToDTO,
  staffLookup,
} from "./service";

const DAY_MS = 86_400_000;
const newId = () => new Types.ObjectId().toString();

/** A submitted note is a record: it is corrected through an amendment, never edited in place. */
function assertSubmitted(record: ServiceRecordDoc): void {
  if (!(LOCKED_STATUSES as readonly string[]).includes(record.status))
    throw errors.invalidState(
      "Only a submitted note is amended. A draft or returned note can simply be edited."
    );
}

/* ───────────── Reading ───────────── */

/** Incident and behaviour reports for the same shift, or by the same worker on the same day. */
async function relatedReports(
  record: ServiceRecordDoc
): Promise<RelatedReportDTO[]> {
  const same = {
    participantId: record.clientId,
    $or: [
      ...(record.shiftId ? [{ shiftId: record.shiftId }] : []),
      { staffId: record.staffId, date: record.date },
    ],
  };
  const [incidents, behaviours] = await Promise.all([
    IncidentReport.find(same)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean<IncidentReportDoc[]>(),
    AbcReport.find(same)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean<AbcReportDoc[]>(),
  ]);
  return [
    ...incidents.map(report => ({
      kind: "incident" as const,
      id: String(report._id),
      date: report.date,
      status: report.status,
      summary: `${report.category} · ${report.severity}`,
    })),
    ...behaviours.map(report => ({
      kind: "abc" as const,
      id: String(report._id),
      date: report.date,
      status: report.status,
      summary: report.behaviour,
    })),
  ];
}

/** One record with the formal reports that sit beside it. */
export async function getRecordDetail(id: string): Promise<ServiceRecordDTO> {
  const record = await getRecordDoc(id);
  const [dto, reports] = await Promise.all([
    recordToDTO(record),
    relatedReports(record),
  ]);
  return { ...dto, relatedReports: reports };
}

/** The last submitted notes about a participant: what the next worker reads before a shift. */
export async function recentNotesFor(
  participantId: string,
  limit = 5
): Promise<HandoverNoteDTO[]> {
  const records = await ServiceRecord.find({
    clientId: participantId,
    status: { $in: LOCKED_STATUSES },
  })
    .sort({ date: -1, start: -1 })
    .limit(limit)
    .lean<ServiceRecordDoc[]>();
  const staff = await staffLookup(records.map(record => record.staffId));
  return records.map(record => {
    const note = noteContentOf(record);
    return {
      id: record._id,
      date: record.date,
      type: record.type,
      staffName: staff.get(String(record.staffId))?.name ?? "Unassigned",
      summary: note.summary,
      followUp: note.followUp,
      health: note.health,
      healthDetails: note.healthDetails,
      incident: note.incident,
    };
  });
}

/* ───────────── Amendments ───────────── */

/**
 * Corrects the written part of a submitted note. The shift, the times and the billing are not
 * touched, so an invoice never moves. What each section said before is kept with who changed
 * it, when and why.
 */
export async function amendRecord(
  id: string,
  input: z.output<typeof recordAmendSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await getRecordDoc(id);
  assertSubmitted(current);
  assertRev(current, input.rev);

  const before = noteContentOf(current);
  const sent = Object.fromEntries(
    NOTE_FIELDS.filter(field => input[field] !== undefined).map(field => [
      field,
      input[field],
    ])
  ) as Partial<NoteContent>;
  const after: NoteContent = { ...before, ...sent };
  const changes = noteChanges(before, after);
  if (!changes.length)
    throw errors.validation(
      "Nothing was changed, so there is nothing to amend."
    );
  const problems = noteProblems(after);
  if (problems.length)
    throw errors.validation(MESSAGES.incompleteNote, problems);

  const request = input.requestId
    ? (current.amendmentRequests ?? []).find(
        item => item.id === input.requestId
      )
    : null;
  if (input.requestId && request?.status !== "Open")
    throw errors.invalidState(
      "That amendment request has already been dealt with."
    );

  const now = new Date();
  const amendment: NoteAmendmentSub = {
    id: newId(),
    at: now,
    by: ctx.actor,
    reason: input.reason,
    requestId: request?.id ?? null,
    changes,
  };
  const $set: Record<string, unknown> = {
    ...after,
    response: "",
    observations: "",
  };
  if (request) {
    $set["amendmentRequests.$[request].status"] = "Applied";
    $set["amendmentRequests.$[request].resolvedAt"] = now;
    $set["amendmentRequests.$[request].resolvedBy"] = ctx.actor;
    $set["amendmentRequests.$[request].resolution"] = input.reason;
  }
  const updated = await ServiceRecord.findOneAndUpdate(
    { _id: id, rev: current.rev, status: { $in: LOCKED_STATUSES } },
    {
      $set,
      $inc: { rev: 1 },
      $push: {
        amendments: amendment,
        history: historyEntry(ctx.actor, "amended", input.reason),
      },
    },
    {
      returnDocument: "after",
      lean: true,
      ...(request ? { arrayFilters: [{ "request.id": request.id }] } : {}),
    }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.amended",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `amended progress note ${id}: ${input.reason}`,
    meta: { sections: changes.map(change => change.label) },
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

/** A worker asking for their submitted note to be corrected. The note itself does not change. */
export async function requestAmendment(
  id: string,
  input: z.output<typeof amendmentRequestSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await getRecordDoc(id);
  assertSubmitted(current);
  if (
    (current.amendmentRequests ?? []).some(
      item => item.status === "Open" && item.by?.id === ctx.actor.id
    )
  )
    throw errors.invalidState(
      "You already have a request waiting on this note."
    );
  const request: NoteAmendmentRequestSub = {
    id: newId(),
    at: new Date(),
    by: ctx.actor,
    reason: input.reason,
    status: "Open",
    resolvedAt: null,
    resolvedBy: null,
    resolution: "",
  };
  const updated = await ServiceRecord.findOneAndUpdate(
    { _id: id, status: { $in: LOCKED_STATUSES } },
    {
      $inc: { rev: 1 },
      $push: {
        amendmentRequests: request,
        history: historyEntry(ctx.actor, "amendment_requested", input.reason),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.amendment_requested",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `asked for progress note ${id} to be amended`,
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

export async function declineAmendmentRequest(
  id: string,
  requestId: string,
  input: z.output<typeof amendmentDeclineSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await getRecordDoc(id);
  const request = (current.amendmentRequests ?? []).find(
    item => item.id === requestId
  );
  if (!request) throw errors.notFound("Amendment request");
  if (request.status !== "Open")
    throw errors.invalidState(
      "That amendment request has already been dealt with."
    );
  const note = input.note ?? "";
  const updated = await ServiceRecord.findOneAndUpdate(
    {
      _id: id,
      amendmentRequests: { $elemMatch: { id: requestId, status: "Open" } },
    },
    {
      $set: {
        "amendmentRequests.$.status": "Declined",
        "amendmentRequests.$.resolvedAt": new Date(),
        "amendmentRequests.$.resolvedBy": ctx.actor,
        "amendmentRequests.$.resolution": note,
      },
      $inc: { rev: 1 },
      $push: {
        history: historyEntry(
          ctx.actor,
          "amendment_declined",
          note || undefined
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.amendment_declined",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `declined an amendment request on progress note ${id}`,
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

/* ───────────── Dashboard ───────────── */

const MISSING_LIMIT = 100;

/** Rostered shifts that have finished without a note for one of their participants. */
async function missingNotes(
  range: { from: string; to: string },
  scope: { clientId?: string; staffId?: string },
  timezone: string,
  now: Date
): Promise<MissingNoteDTO[]> {
  const filter: Record<string, unknown> = {
    date: { $gte: range.from, $lte: range.to },
    status: { $ne: "Cancelled" },
    "clientIds.0": { $exists: true },
  };
  if (scope.clientId) filter.clientIds = new Types.ObjectId(scope.clientId);
  if (scope.staffId) filter.staffIds = new Types.ObjectId(scope.staffId);
  const shifts = await RosterShift.find(filter)
    .sort({ date: -1, start: -1 })
    .limit(1000)
    .lean<RosterShiftDoc[]>();
  const ended = shifts
    .map(shift => ({
      shift,
      endedAt: zonedInstant(shift.date, minutesOf(shift.end), timezone),
    }))
    .filter(item => item.endedAt <= now);
  if (!ended.length) return [];

  const noted = await ServiceRecord.find({
    shiftId: { $in: ended.map(item => item.shift._id) },
  })
    .select("shiftId clientId")
    .lean<Array<Pick<ServiceRecordDoc, "shiftId" | "clientId">>>();
  const has = new Set(
    noted.map(record => `${record.shiftId}|${record.clientId}`)
  );
  const [participants, staff] = await Promise.all([
    participantLookup(ended.flatMap(item => item.shift.clientIds)),
    staffLookup(ended.flatMap(item => item.shift.staffIds)),
  ]);

  const missing: MissingNoteDTO[] = [];
  for (const { shift, endedAt } of ended)
    for (const client of shift.clientIds) {
      if (scope.clientId && String(client) !== scope.clientId) continue;
      if (has.has(`${shift._id}|${client}`)) continue;
      const workers = shift.staffIds
        .map(member => staff.get(String(member))?.name)
        .filter(Boolean);
      missing.push({
        shiftId: shift._id,
        date: shift.date,
        start: shift.start,
        end: shift.end,
        type: shift.type,
        clientId: String(client),
        clientName:
          participants.get(String(client))?.name ?? "Unknown participant",
        staffId: shift.staffIds[0] ? String(shift.staffIds[0]) : null,
        staffName: workers.join(", ") || "Unassigned",
        overdue: now.getTime() - endedAt.getTime() > DAY_MS,
      });
    }
  return missing;
}

/**
 * The numbers a team leader watches: what was written today, what is still a draft, which shifts
 * have no note at all, and what is waiting for a person to look at it. Shifts are checked over a
 * date range (the last fortnight unless asked otherwise); a shift that has not finished is never
 * missing a note.
 */
export async function notesOverview(
  query: z.output<typeof notesOverviewQuery>
): Promise<NotesOverviewDTO> {
  const { timezone } = await getWorkspace();
  const now = new Date();
  const today = todayIn(timezone, now);
  const to = query.to && query.to < today ? query.to : today;
  const from = query.from && query.from <= to ? query.from : addDays(to, -13);
  const scope: Record<string, unknown> = {};
  if (query.clientId) scope.clientId = new Types.ObjectId(query.clientId);
  if (query.staffId) scope.staffId = new Types.ObjectId(query.staffId);

  const [
    completedToday,
    awaitingSubmission,
    needsReview,
    flagged,
    amendmentRequests,
    missing,
  ] = await Promise.all([
    ServiceRecord.countDocuments({
      ...scope,
      submittedAt: {
        $gte: zonedStartOfDay(today, timezone),
        $lt: zonedStartOfDay(addDays(today, 1), timezone),
      },
    }),
    ServiceRecord.countDocuments({
      ...scope,
      status: { $in: EDITABLE_STATUSES },
    }),
    ServiceRecord.countDocuments({ ...scope, status: "Submitted" }),
    ServiceRecord.countDocuments({
      ...scope,
      status: "Submitted",
      $or: [
        { health: { $in: HEALTH_ALERTS } },
        { incident: { $in: INCIDENT_ALERTS } },
      ],
    }),
    ServiceRecord.countDocuments({
      ...scope,
      "amendmentRequests.status": "Open",
    }),
    missingNotes(
      { from, to },
      { clientId: query.clientId, staffId: query.staffId },
      timezone,
      now
    ),
  ]);
  return {
    today,
    from,
    to,
    completedToday,
    awaitingSubmission,
    missing: missing.length,
    needsReview,
    flagged,
    amendmentRequests,
    missingNotes: missing.slice(0, MISSING_LIMIT),
  };
}

/* ───────────── Export ───────────── */

/** The note as a PDF for an authorised reader. Every export is written to the audit log. */
export async function recordPdf(
  id: string,
  ctx: RequestContext
): Promise<{ filename: string; buffer: Buffer }> {
  const record = await getRecordDoc(id);
  const [note, workspace] = await Promise.all([
    recordToDTO(record),
    getWorkspace(),
  ]);
  const buffer = await renderNotePdf(note, {
    organisation: workspace.name,
    timezone: workspace.timezone,
    exportedBy: ctx.actor.name,
  });
  await logActivity({
    actor: ctx.actor,
    action: "record.exported",
    entityType: "service_record",
    entityId: id,
    participantId: record.clientId,
    summary: `exported progress note ${id} as a PDF`,
    ip: ctx.ip,
  });
  return { filename: `progress-note-${id}.pdf`, buffer };
}
