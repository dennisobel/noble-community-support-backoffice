import type { Types } from "mongoose";
import type { z } from "zod";
import { initialsOf } from "@shared/logic/ndis";
import { MESSAGES } from "@shared/messages";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import {
  Participant,
  Staff,
  type ParticipantDoc,
  type StaffDoc,
} from "../../models";

/** Reports are locked once an Admin has reviewed them. */
function assertEditable(status: string): void {
  if (status === "Reviewed" || status === "Closed")
    throw errors.invalidState(MESSAGES.reportLocked(status));
}

export type ReportLookups = {
  staff: Map<string, StaffDoc>;
  participants: Map<string, ParticipantDoc>;
};

export async function reportLookups(rows: {
  staffIds: Array<string | Types.ObjectId>;
  participantIds: Array<string | Types.ObjectId | null>;
}): Promise<ReportLookups> {
  const staffIds = [...new Set(rows.staffIds.map(String))];
  const participantIds = [
    ...new Set(
      rows.participantIds
        .filter((id): id is string | Types.ObjectId => Boolean(id))
        .map(String)
    ),
  ];
  const [staff, participants] = await Promise.all([
    Staff.find({ _id: { $in: staffIds } }).lean<StaffDoc[]>(),
    participantIds.length
      ? Participant.find({ _id: { $in: participantIds } }).lean<
          ParticipantDoc[]
        >()
      : Promise.resolve([]),
  ]);
  return {
    staff: new Map(staff.map(member => [String(member._id), member])),
    participants: new Map(
      participants.map(participant => [String(participant._id), participant])
    ),
  };
}

export const nameOf = (lookups: ReportLookups, staffId: unknown) =>
  lookups.staff.get(String(staffId))?.name ?? "Unknown";

export const participantNameOf = (
  lookups: ReportLookups,
  participantId: unknown
) => {
  if (!participantId) return "";
  const participant = lookups.participants.get(String(participantId));
  return participant?.preferred ?? participant?.name ?? "";
};

export const staffInitials = initialsOf;

export type { RequestContext };

/* ───────────── Incident reports ───────────── */

import type {
  AbcReportDTO,
  IncidentReportDTO,
  LogbookEntryDTO,
} from "@shared/dto";
import type {
  abcCreateSchema,
  abcUpdateSchema,
  incidentCreateSchema,
  incidentUpdateSchema,
  logbookCreateSchema,
  logbookUpdateSchema,
  portalReportQuery,
  reportStatusSchema,
} from "@shared/schemas/staff-portal";
import { escapeRegex } from "../../lib/http";
import { actorDTO, assertRev, isoRequired } from "../../lib/mappers";
import {
  AbcReport,
  IncidentReport,
  LogbookEntry,
  TrackingSession,
  type AbcReportDoc,
  type IncidentReportDoc,
  type LogbookEntryDoc,
} from "../../models";

export function toIncidentDTO(
  report: IncidentReportDoc,
  lookups: ReportLookups
): IncidentReportDTO {
  const participantId = report.participantId
    ? String(report.participantId)
    : null;
  return {
    id: String(report._id),
    staffId: String(report.staffId),
    staffName: nameOf(lookups, report.staffId),
    participantId,
    participantName: participantNameOf(lookups, report.participantId),
    shiftId: report.shiftId ?? null,
    date: report.date,
    time: report.time,
    location: report.location ?? "",
    category: report.category,
    severity: report.severity,
    description: report.description,
    injuries: report.injuries ?? "",
    medicalAttention: Boolean(report.medicalAttention),
    medicalDetails: report.medicalDetails ?? "",
    witness: report.witness ?? "",
    immediateActions: report.immediateActions ?? "",
    notified: report.notified ?? [],
    followUp: report.followUp ?? "",
    status: report.status,
    reviewNote: report.reviewNote ?? "",
    reviewedBy: actorDTO(report.reviewedBy),
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    created: isoRequired(report.createdAt),
    updated: isoRequired(report.updatedAt),
    rev: report.rev ?? 0,
  };
}

function reportFilter(
  staffId: string,
  query: z.output<typeof portalReportQuery>
) {
  const filter: Record<string, unknown> = { staffId };
  if (query.status) filter.status = query.status;
  if (query.participantId) filter.participantId = query.participantId;
  if (query.from || query.to) {
    const range: Record<string, string> = {};
    if (query.from) range.$gte = query.from;
    if (query.to) range.$lte = query.to;
    filter.date = range;
  }
  return { filter, q: query.q?.trim() ?? "" };
}

export async function listIncidents(
  staffId: string,
  query: z.output<typeof portalReportQuery>
): Promise<IncidentReportDTO[]> {
  const { filter, q } = reportFilter(staffId, query);
  const rows = await IncidentReport.find(filter)
    .sort({ date: -1, time: -1 })
    .limit(200)
    .lean<IncidentReportDoc[]>();
  const lookups = await reportLookups({
    staffIds: rows.map(row => row.staffId),
    participantIds: rows.map(row => row.participantId),
  });
  const items = rows.map(row => toIncidentDTO(row, lookups));
  if (!q) return items;
  const needle = new RegExp(escapeRegex(q), "i");
  return items.filter(item =>
    [item.description, item.category, item.participantName, item.location]
      .join(" ")
      .match(needle)
  );
}

function blankToNull(value: unknown): Types.ObjectId | null {
  if (!value) return null;
  return value as Types.ObjectId;
}

export async function getIncident(staffId: string, id: string) {
  const report = await IncidentReport.findOne({
    _id: id,
    staffId,
  }).lean<IncidentReportDoc>();
  if (!report) throw errors.notFound("Incident report");
  const lookups = await reportLookups({
    staffIds: [report.staffId],
    participantIds: [report.participantId],
  });
  return toIncidentDTO(report, lookups);
}

export async function createIncident(
  staffId: string,
  input: z.output<typeof incidentCreateSchema>,
  ctx: RequestContext
) {
  const created = await IncidentReport.create({
    staffId,
    participantId: blankToNull(input.participantId),
    shiftId: input.shiftId || null,
    date: input.date,
    time: input.time,
    location: input.location ?? "",
    category: input.category,
    severity: input.severity ?? "Minor",
    description: input.description,
    injuries: input.injuries ?? "",
    medicalAttention: input.medicalAttention ?? false,
    medicalDetails: input.medicalDetails ?? "",
    witness: input.witness ?? "",
    immediateActions: input.immediateActions ?? "",
    notified: input.notified ?? [],
    followUp: input.followUp ?? "",
    reportedBy: ctx.actor,
    status: "Draft",
  });
  await logActivity({
    actor: ctx.actor,
    action: "incident.created",
    entityType: "incident",
    entityId: String(created._id),
    summary: `logged an incident (${input.category})`,
    ip: ctx.ip,
  });
  return getIncident(staffId, String(created._id));
}

export async function updateIncident(
  staffId: string,
  id: string,
  input: z.output<typeof incidentUpdateSchema>,
  ctx: RequestContext
) {
  const current = await IncidentReport.findOne({
    _id: id,
    staffId,
  }).lean<IncidentReportDoc>();
  if (!current) throw errors.notFound("Incident report");
  assertEditable(current.status);
  assertRev(current, input.rev);
  const $set: Record<string, unknown> = {};
  for (const key of [
    "date",
    "time",
    "location",
    "category",
    "severity",
    "description",
    "injuries",
    "medicalAttention",
    "medicalDetails",
    "witness",
    "immediateActions",
    "notified",
    "followUp",
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  if (input.participantId !== undefined)
    $set.participantId = blankToNull(input.participantId);
  if (input.shiftId !== undefined) $set.shiftId = input.shiftId || null;
  const updated = await IncidentReport.findOneAndUpdate(
    { _id: id, rev: current.rev },
    { $set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  void ctx;
  return getIncident(staffId, id);
}

/** Moves an incident forward: the worker submits, the back office reviews/closes. */
export async function setIncidentStatus(
  staffId: string | null,
  id: string,
  input: z.output<typeof reportStatusSchema>,
  ctx: RequestContext,
  admin = false
) {
  const filter: Record<string, unknown> = { _id: id };
  if (!admin) filter.staffId = staffId;
  const current =
    await IncidentReport.findOne(filter).lean<IncidentReportDoc>();
  if (!current) throw errors.notFound("Incident report");
  assertRev(current, input.rev);
  if (!admin && input.status !== "Submitted" && input.status !== "Draft")
    throw errors.forbidden(
      "Only the back office can review or close a report."
    );
  const updated = await IncidentReport.findOneAndUpdate(
    { _id: id, rev: current.rev },
    {
      $set: {
        status: input.status,
        reviewNote: admin ? (input.note ?? "") : current.reviewNote,
        reviewedBy: admin ? ctx.actor : current.reviewedBy,
        reviewedAt: admin ? new Date() : current.reviewedAt,
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  const lookups = await reportLookups({
    staffIds: [updated.staffId],
    participantIds: [updated.participantId],
  });
  return toIncidentDTO(updated as IncidentReportDoc, lookups);
}

/** Back-office queue across every worker: most urgent first. */
export async function listIncidentsAdmin(): Promise<IncidentReportDTO[]> {
  const rows = await IncidentReport.find({})
    .sort({ date: -1 })
    .limit(400)
    .lean<IncidentReportDoc[]>();
  const lookups = await reportLookups({
    staffIds: rows.map(row => row.staffId),
    participantIds: rows.map(row => row.participantId),
  });
  return rows.map(row => toIncidentDTO(row, lookups));
}

export async function getIncidentAdmin(id: string) {
  const report = await IncidentReport.findById(id).lean<IncidentReportDoc>();
  if (!report) throw errors.notFound("Incident report");
  const lookups = await reportLookups({
    staffIds: [report.staffId],
    participantIds: [report.participantId],
  });
  return toIncidentDTO(report, lookups);
}

/* ───────────── ABC reports ───────────── */

export function toAbcDTO(
  report: AbcReportDoc,
  lookups: ReportLookups
): AbcReportDTO {
  return {
    id: String(report._id),
    staffId: String(report.staffId),
    staffName: nameOf(lookups, report.staffId),
    participantId: report.participantId ? String(report.participantId) : null,
    participantName: participantNameOf(lookups, report.participantId),
    shiftId: report.shiftId ?? null,
    date: report.date,
    time: report.time,
    location: report.location ?? "",
    behaviour: report.behaviour,
    intensity: report.intensity,
    durationMinutes: report.durationMinutes,
    antecedent: report.antecedent,
    behaviourDescription: report.behaviourDescription,
    consequence: report.consequence,
    staffResponse: report.staffResponse ?? "",
    outcome: report.outcome ?? "",
    preventionPlan: report.preventionPlan ?? "",
    status: report.status,
    reviewNote: report.reviewNote ?? "",
    reviewedBy: actorDTO(report.reviewedBy),
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    created: isoRequired(report.createdAt),
    updated: isoRequired(report.updatedAt),
    rev: report.rev ?? 0,
  };
}

export async function listAbcReports(
  staffId: string,
  query: z.output<typeof portalReportQuery>
) {
  const { filter, q } = reportFilter(staffId, query);
  const rows = await AbcReport.find(filter)
    .sort({ date: -1, time: -1 })
    .limit(200)
    .lean<AbcReportDoc[]>();
  const lookups = await reportLookups({
    staffIds: rows.map(row => row.staffId),
    participantIds: rows.map(row => row.participantId),
  });
  const items = rows.map(row => toAbcDTO(row, lookups));
  if (!q) return items;
  const needle = new RegExp(escapeRegex(q), "i");
  return items.filter(item =>
    [
      item.antecedent,
      item.behaviourDescription,
      item.consequence,
      item.behaviour,
      item.participantName,
    ]
      .join(" ")
      .match(needle)
  );
}

export async function getAbcReport(staffId: string, id: string) {
  const report = await AbcReport.findOne({
    _id: id,
    staffId,
  }).lean<AbcReportDoc>();
  if (!report) throw errors.notFound("ABC report");
  const lookups = await reportLookups({
    staffIds: [report.staffId],
    participantIds: [report.participantId],
  });
  return toAbcDTO(report, lookups);
}

export async function createAbcReport(
  staffId: string,
  input: z.output<typeof abcCreateSchema>,
  ctx: RequestContext
) {
  const created = await AbcReport.create({
    staffId,
    participantId: blankToNull(input.participantId),
    shiftId: input.shiftId || null,
    date: input.date,
    time: input.time,
    location: input.location ?? "",
    behaviour: input.behaviour,
    intensity: input.intensity ?? 3,
    durationMinutes: input.durationMinutes ?? 0,
    antecedent: input.antecedent,
    behaviourDescription: input.behaviourDescription,
    consequence: input.consequence,
    staffResponse: input.staffResponse ?? "",
    outcome: input.outcome ?? "",
    preventionPlan: input.preventionPlan ?? "",
    status: "Draft",
  });
  await logActivity({
    actor: ctx.actor,
    action: "abc.created",
    entityType: "abc",
    entityId: String(created._id),
    summary: `logged an ABC report (${input.behaviour})`,
    ip: ctx.ip,
  });
  return getAbcReport(staffId, String(created._id));
}

export async function updateAbcReport(
  staffId: string,
  id: string,
  input: z.output<typeof abcUpdateSchema>,
  ctx: RequestContext
) {
  const current = await AbcReport.findOne({
    _id: id,
    staffId,
  }).lean<AbcReportDoc>();
  if (!current) throw errors.notFound("ABC report");
  assertEditable(current.status);
  assertRev(current, input.rev);
  const $set: Record<string, unknown> = {};
  for (const key of [
    "date",
    "time",
    "location",
    "behaviour",
    "intensity",
    "durationMinutes",
    "antecedent",
    "behaviourDescription",
    "consequence",
    "staffResponse",
    "outcome",
    "preventionPlan",
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  if (input.participantId !== undefined)
    $set.participantId = blankToNull(input.participantId);
  if (input.shiftId !== undefined) $set.shiftId = input.shiftId || null;
  const updated = await AbcReport.findOneAndUpdate(
    { _id: id, rev: current.rev },
    { $set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  void ctx;
  return getAbcReport(staffId, id);
}

export async function setAbcStatus(
  staffId: string | null,
  id: string,
  input: z.output<typeof reportStatusSchema>,
  ctx: RequestContext,
  admin = false
) {
  const filter: Record<string, unknown> = { _id: id };
  if (!admin) filter.staffId = staffId;
  const current = await AbcReport.findOne(filter).lean<AbcReportDoc>();
  if (!current) throw errors.notFound("ABC report");
  assertRev(current, input.rev);
  if (!admin && input.status !== "Submitted" && input.status !== "Draft")
    throw errors.forbidden(
      "Only the back office can review or close a report."
    );
  const updated = await AbcReport.findOneAndUpdate(
    { _id: id, rev: current.rev },
    {
      $set: {
        status: input.status,
        reviewNote: admin ? (input.note ?? "") : current.reviewNote,
        reviewedBy: admin ? ctx.actor : current.reviewedBy,
        reviewedAt: admin ? new Date() : current.reviewedAt,
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  const lookups = await reportLookups({
    staffIds: [updated.staffId],
    participantIds: [updated.participantId],
  });
  return toAbcDTO(updated as AbcReportDoc, lookups);
}

export async function listAbcAdmin(): Promise<AbcReportDTO[]> {
  const rows = await AbcReport.find({})
    .sort({ date: -1 })
    .limit(400)
    .lean<AbcReportDoc[]>();
  const lookups = await reportLookups({
    staffIds: rows.map(row => row.staffId),
    participantIds: rows.map(row => row.participantId),
  });
  return rows.map(row => toAbcDTO(row, lookups));
}

export async function getAbcAdmin(id: string) {
  const report = await AbcReport.findById(id).lean<AbcReportDoc>();
  if (!report) throw errors.notFound("ABC report");
  const lookups = await reportLookups({
    staffIds: [report.staffId],
    participantIds: [report.participantId],
  });
  return toAbcDTO(report, lookups);
}

/* ───────────── KM logbook ───────────── */

export async function toLogbookDTO(
  entry: LogbookEntryDoc,
  lookups: ReportLookups
): Promise<LogbookEntryDTO> {
  const tracked = entry.trackingId
    ? await TrackingSession.findById(entry.trackingId)
        .select("distanceMetres")
        .lean<{ distanceMetres: number }>()
    : null;
  return {
    id: String(entry._id),
    staffId: String(entry.staffId),
    staffName: nameOf(lookups, entry.staffId),
    participantId: entry.participantId ? String(entry.participantId) : null,
    participantName: participantNameOf(lookups, entry.participantId),
    shiftId: entry.shiftId ?? null,
    trackingId: entry.trackingId ? String(entry.trackingId) : null,
    date: entry.date,
    type: entry.type,
    fromLocation: entry.fromLocation ?? "",
    toLocation: entry.toLocation ?? "",
    purpose: entry.purpose ?? "",
    kilometres: entry.kilometres ?? 0,
    odometerStart: entry.odometerStart ?? null,
    odometerEnd: entry.odometerEnd ?? null,
    trackedKilometres: tracked
      ? Math.round(tracked.distanceMetres / 100) / 10
      : null,
    notes: entry.notes ?? "",
    created: isoRequired(entry.createdAt),
    updated: isoRequired(entry.updatedAt),
    rev: entry.rev ?? 0,
  };
}

export async function listLogbook(
  staffId: string,
  query: z.output<typeof portalReportQuery>
): Promise<LogbookEntryDTO[]> {
  const { filter } = reportFilter(staffId, query);
  const rows = await LogbookEntry.find(filter)
    .sort({ date: -1 })
    .limit(200)
    .lean<LogbookEntryDoc[]>();
  const lookups = await reportLookups({
    staffIds: rows.map(row => row.staffId),
    participantIds: rows.map(row => row.participantId),
  });
  return Promise.all(rows.map(row => toLogbookDTO(row, lookups)));
}

export async function getLogbookEntry(staffId: string, id: string) {
  const entry = await LogbookEntry.findOne({
    _id: id,
    staffId,
  }).lean<LogbookEntryDoc>();
  if (!entry) throw errors.notFound("Logbook entry");
  const lookups = await reportLookups({
    staffIds: [entry.staffId],
    participantIds: [entry.participantId],
  });
  return toLogbookDTO(entry, lookups);
}

export async function createLogbookEntry(
  staffId: string,
  input: z.output<typeof logbookCreateSchema>,
  ctx: RequestContext
) {
  const created = await LogbookEntry.create({
    staffId,
    participantId: blankToNull(input.participantId),
    shiftId: input.shiftId || null,
    trackingId: input.trackingId ? (input.trackingId as string) : null,
    date: input.date,
    type: input.type ?? "Kilometres",
    fromLocation: input.fromLocation ?? "",
    toLocation: input.toLocation ?? "",
    purpose: input.purpose ?? "",
    kilometres: input.kilometres ?? 0,
    odometerStart: input.odometerStart ?? null,
    odometerEnd: input.odometerEnd ?? null,
    notes: input.notes ?? "",
  });
  await logActivity({
    actor: ctx.actor,
    action: "logbook.created",
    entityType: "logbook",
    entityId: String(created._id),
    summary: `logged ${input.kilometres ?? 0} km for ${input.date}`,
    ip: ctx.ip,
  });
  return getLogbookEntry(staffId, String(created._id));
}

export async function updateLogbookEntry(
  staffId: string,
  id: string,
  input: z.output<typeof logbookUpdateSchema>,
  ctx: RequestContext
) {
  const current = await LogbookEntry.findOne({
    _id: id,
    staffId,
  }).lean<LogbookEntryDoc>();
  if (!current) throw errors.notFound("Logbook entry");
  assertRev(current, input.rev);
  const $set: Record<string, unknown> = {};
  for (const key of [
    "date",
    "type",
    "fromLocation",
    "toLocation",
    "purpose",
    "kilometres",
    "odometerStart",
    "odometerEnd",
    "notes",
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  if (input.participantId !== undefined)
    $set.participantId = blankToNull(input.participantId);
  if (input.shiftId !== undefined) $set.shiftId = input.shiftId || null;
  if (input.trackingId !== undefined)
    $set.trackingId = input.trackingId ? (input.trackingId as string) : null;
  const updated = await LogbookEntry.findOneAndUpdate(
    { _id: id, rev: current.rev },
    { $set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  void ctx;
  return getLogbookEntry(staffId, id);
}

export async function deleteLogbookEntry(
  staffId: string,
  id: string,
  ctx: RequestContext
): Promise<void> {
  const deleted = await LogbookEntry.findOneAndDelete({ _id: id, staffId });
  if (!deleted) throw errors.notFound("Logbook entry");
  await logActivity({
    actor: ctx.actor,
    action: "logbook.deleted",
    entityType: "logbook",
    entityId: id,
    summary: "removed a logbook entry",
    ip: ctx.ip,
  });
}

export async function listLogbookAdmin(): Promise<LogbookEntryDTO[]> {
  const rows = await LogbookEntry.find({})
    .sort({ date: -1 })
    .limit(1000)
    .lean<LogbookEntryDoc[]>();
  const lookups = await reportLookups({
    staffIds: rows.map(row => row.staffId),
    participantIds: rows.map(row => row.participantId),
  });
  return Promise.all(rows.map(row => toLogbookDTO(row, lookups)));
}

export async function getLogbookAdmin(id: string) {
  const entry = await LogbookEntry.findById(id).lean<LogbookEntryDoc>();
  if (!entry) throw errors.notFound("Logbook entry");
  const lookups = await reportLookups({
    staffIds: [entry.staffId],
    participantIds: [entry.participantId],
  });
  return toLogbookDTO(entry, lookups);
}

export { getLogbookAdmin as getLogbookAdminEntry };
