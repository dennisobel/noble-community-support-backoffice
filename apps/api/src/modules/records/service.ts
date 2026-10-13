import { Types, type ClientSession } from "mongoose";
import type { z } from "zod";
import type { Paginated, RecordCountsDTO, ServiceRecordDTO } from "@shared/dto";
import {
  NOTE_SECTIONS,
  RECORD_STATUSES,
  type NoteSection,
} from "@shared/enums";
import {
  computeBillables,
  totalCents as sumCents,
} from "@shared/logic/billing";
import {
  fromCents,
  lineSubtotalCents,
  roundQuantity,
  toCents,
} from "@shared/logic/money";
import { DEFAULT_TRAVEL_RATE_CENTS } from "@shared/const";
import {
  HEALTH_ALERTS,
  INCIDENT_ALERTS,
  NOTE_FIELDS,
  noteNeedsAttention,
  noteProblems,
  type NoteContent,
} from "@shared/logic/progress-note";
import { durationHours } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import type {
  billablesAdjustSchema,
  recordCreateSchema,
  recordListQuery,
  recordReturnSchema,
  recordUpdateSchema,
} from "@shared/schemas/records";
import { logActivity } from "../../lib/audit";
import { nextIds } from "../../lib/counters";
import { withTransaction } from "../../lib/db";
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
import { getWorkspace } from "../../lib/workspace";
import {
  Participant,
  RosterShift,
  Service,
  ServiceRecord,
  Staff,
  VoiceNote,
  type HistorySub,
  type ParticipantDoc,
  type ServiceDoc,
  type ServiceRecordDoc,
  type StaffDoc,
  type VoiceNoteDoc,
} from "../../models";
import {
  participantLookup,
  requireActiveParticipant,
} from "../participants/service";

export const EDITABLE_STATUSES = ["Draft", "Returned"] as const;
export const LOCKED_STATUSES = ["Submitted", "Approved", "Invoiced"] as const;

/* ───────────── Mapping ───────────── */

interface Lookups {
  participants: Map<string, ParticipantDoc>;
  staff: Map<string, StaffDoc>;
}

export async function staffLookup(
  ids: Array<string | Types.ObjectId>
): Promise<Map<string, StaffDoc>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const docs = await Staff.find({ _id: { $in: unique } }).lean<StaffDoc[]>();
  return new Map(docs.map(doc => [String(doc._id), doc]));
}

/** The progress note as it reads now. A note from before the shift summary was one box reads its two old boxes as one. */
export function noteContentOf(record: ServiceRecordDoc): NoteContent {
  return {
    supportTypes: record.supportTypes ?? [],
    support: record.support ?? "",
    summary: record.summary?.trim()
      ? record.summary
      : [record.response, record.observations]
          .filter(part => part?.trim())
          .join("\n\n"),
    goals: record.goals ?? [],
    outcome: record.outcome ?? "",
    achievements: record.achievements ?? "",
    health: record.health ?? [],
    healthDetails: record.healthDetails ?? "",
    incident: record.incident ?? [],
    incidentDetails: record.incidentDetails ?? "",
    followUp: record.followUp ?? "",
  };
}

export function toRecordDTO(
  record: ServiceRecordDoc,
  lookups: Lookups
): ServiceRecordDTO {
  const note = noteContentOf(record);
  const amendments = record.amendments ?? [];
  const participant = lookups.participants.get(String(record.clientId));
  const staff = lookups.staff.get(String(record.staffId));
  return {
    id: record._id,
    clientId: String(record.clientId),
    clientName: participant?.preferred ?? "Unknown",
    clientFullName: participant?.name ?? "Unknown participant",
    staffId: String(record.staffId),
    staffName: staff?.name ?? "Unassigned",
    serviceId: String(record.serviceId),
    type: record.type,
    budgetCategory: record.budgetCategory,
    unit: record.unit,
    date: record.date,
    start: record.start,
    end: record.end,
    hours: durationHours(record.start, record.end),
    location: record.location ?? "",
    ...note,
    attention: noteNeedsAttention(note),
    amended: amendments.length > 0,
    amendments: amendments.map(amendment => ({
      id: amendment.id,
      at: isoRequired(amendment.at),
      by: actorDTO(amendment.by),
      reason: amendment.reason,
      requestId: amendment.requestId ?? null,
      changes: (amendment.changes ?? []).map(change => ({
        field: change.field,
        label: change.label,
        before: change.before ?? "",
        after: change.after ?? "",
      })),
    })),
    amendmentRequests: (record.amendmentRequests ?? []).map(request => ({
      id: request.id,
      at: isoRequired(request.at),
      by: actorDTO(request.by),
      reason: request.reason,
      status: request.status,
      resolvedAt: iso(request.resolvedAt),
      resolvedBy: actorDTO(request.resolvedBy),
      resolution: request.resolution ?? "",
    })),
    km: record.km ?? 0,
    quantity: record.quantity ?? null,
    confirmed: Boolean(record.confirmed),
    status: record.status,
    correction: record.correction ?? "",
    billables: (record.billables ?? []).map(line => ({
      label: line.label,
      unit: line.unit,
      quantity: line.quantity,
      rate: fromCents(line.rateCents),
      subtotal: fromCents(line.subtotalCents),
    })),
    total: fromCents(record.totalCents ?? 0),
    billablesFrozen: Boolean(record.billablesFrozenAt),
    approvedBy: actorDTO(record.approvedBy),
    submittedAt: iso(record.submittedAt),
    submittedBy: actorDTO(record.submittedBy),
    reviewedAt: iso(record.reviewedAt),
    invoiceId: record.invoiceId ?? null,
    voiceId: record.voiceNoteId ?? null,
    shiftId: record.shiftId ?? null,
    history: historyDTO(record.history),
    created: isoRequired(record.createdAt),
    updated: isoRequired(record.updatedAt),
    rev: record.rev ?? 0,
  };
}

export async function recordsToDTOs(
  records: ServiceRecordDoc[]
): Promise<ServiceRecordDTO[]> {
  const [participants, staff] = await Promise.all([
    participantLookup(records.map(record => record.clientId)),
    staffLookup(records.map(record => record.staffId)),
  ]);
  return records.map(record => toRecordDTO(record, { participants, staff }));
}

export async function recordToDTO(
  record: ServiceRecordDoc
): Promise<ServiceRecordDTO> {
  return (await recordsToDTOs([record]))[0];
}

/* ───────────── Guards ───────────── */

export async function getRecordDoc(
  id: string,
  session?: ClientSession
): Promise<ServiceRecordDoc> {
  const record = await ServiceRecord.findById(id)
    .session(session ?? null)
    .lean<ServiceRecordDoc>();
  if (!record) throw errors.notFound("Service record");
  return record;
}

async function requireActiveStaff(
  id: string | Types.ObjectId
): Promise<StaffDoc> {
  const staff = await Staff.findById(id).lean<StaffDoc>();
  if (!staff) throw errors.notFound("Team member");
  if (staff.status !== "Active")
    throw errors.validation(
      `${staff.name} is ${staff.status.toLowerCase()}. Choose an active staff member.`
    );
  return staff;
}

async function getService(id: string | Types.ObjectId): Promise<ServiceDoc> {
  const service = await Service.findById(id).lean<ServiceDoc>();
  if (!service) throw errors.notFound("Service");
  return service;
}

async function requireActiveService(
  id: string | Types.ObjectId
): Promise<ServiceDoc> {
  const service = await getService(id);
  if (!service.active)
    throw errors.validation(
      `${service.name} is inactive. Choose an active service.`
    );
  return service;
}

function assertEditable(record: ServiceRecordDoc): void {
  if (!(EDITABLE_STATUSES as readonly string[]).includes(record.status)) {
    throw errors.invalidState(
      `This record is ${record.status.toLowerCase()} and locked from editing.`
    );
  }
}

/* ───────────── Billing ───────────── */

async function billablesFor(
  input: { start: string; end: string; km: number; quantity: number | null },
  service: ServiceDoc
) {
  const workspace = await getWorkspace();
  const lines = computeBillables(
    {
      start: input.start,
      end: input.end,
      km: input.km,
      quantity: input.quantity,
    },
    {
      name: service.name,
      unit: service.unit,
      rateCents: service.rateCents,
      transportEnabled: service.transportEnabled,
    },
    workspace.providerTravelRateCents ?? DEFAULT_TRAVEL_RATE_CENTS
  );
  return { billables: lines, totalCents: sumCents(lines) };
}

const quantityFor = (
  service: ServiceDoc,
  quantity: number | null | undefined
) => (service.unit === "Hour" ? null : (quantity ?? 1));

/* ───────────── Voice links (one-to-one, both directions) ───────────── */

async function linkVoice(
  recordId: string,
  clientId: Types.ObjectId,
  nextVoiceId: string | null,
  previousVoiceId: string | null,
  session: ClientSession
): Promise<void> {
  if (previousVoiceId && previousVoiceId !== nextVoiceId) {
    await VoiceNote.updateOne(
      { _id: previousVoiceId, recordId },
      { $set: { recordId: null }, $inc: { rev: 1 } },
      { session }
    );
  }
  if (!nextVoiceId || nextVoiceId === previousVoiceId) return;
  const voice = await VoiceNote.findById(nextVoiceId)
    .session(session)
    .lean<VoiceNoteDoc>();
  if (!voice) throw errors.notFound("Voice note");
  if (String(voice.clientId) !== String(clientId))
    throw errors.validation(
      "This recording belongs to a different participant."
    );
  if (voice.recordId && voice.recordId !== recordId) {
    const other = await ServiceRecord.findById(voice.recordId)
      .session(session)
      .select("status")
      .lean<{ status: string }>();
    if (
      other &&
      (LOCKED_STATUSES as readonly string[]).includes(other.status)
    ) {
      throw errors.conflict(
        "CONFLICT",
        `This recording is already linked to ${voice.recordId}, which is ${other.status.toLowerCase()}.`
      );
    }
    await ServiceRecord.updateOne(
      { _id: voice.recordId, voiceNoteId: nextVoiceId },
      { $set: { voiceNoteId: null }, $inc: { rev: 1 } },
      { session }
    );
  }
  await VoiceNote.updateOne(
    { _id: nextVoiceId },
    { $set: { recordId }, $inc: { rev: 1 } },
    { session }
  );
}

/** Only non-empty draft sections are applied so a partial draft never erases existing text. */
async function voiceDraftSections(
  voiceId: string
): Promise<Partial<Record<NoteSection, string>>> {
  const voice = await VoiceNote.findById(voiceId)
    .select("draft")
    .lean<Pick<VoiceNoteDoc, "draft">>();
  if (!voice?.draft)
    throw errors.validation("This recording has no generated draft to apply.");
  const sections: Partial<Record<NoteSection, string>> = {};
  for (const section of NOTE_SECTIONS) {
    const value = voice.draft[section]?.trim();
    if (value) sections[section] = value;
  }
  return sections;
}

const SPENT_SUMMARY = { response: "", observations: "" };

/** A recording's draft has five sections; the note takes "response" and "observations" as its one summary. */
export function noteFromDraft(
  draft: Partial<Record<NoteSection, string>>
): Partial<NoteContent> & Partial<typeof SPENT_SUMMARY> {
  const summary = [draft.response, draft.observations]
    .filter(Boolean)
    .join("\n\n");
  return {
    ...(draft.support ? { support: draft.support } : {}),
    ...(summary ? { summary, ...SPENT_SUMMARY } : {}),
    ...(draft.outcome ? { outcome: draft.outcome } : {}),
    ...(draft.followUp ? { followUp: draft.followUp } : {}),
  };
}

/* ───────────── Queries ───────────── */

const SORTS: Record<string, Record<string, 1 | -1>> = {
  "-date": { date: -1, start: -1, createdAt: -1 },
  date: { date: 1, start: 1, createdAt: 1 },
  "-updatedAt": { updatedAt: -1 },
  updatedAt: { updatedAt: 1 },
};

export async function listRecords(
  query: z.output<typeof recordListQuery>
): Promise<Paginated<ServiceRecordDTO>> {
  const and: Record<string, unknown>[] = [];
  if (query.status.length) and.push({ status: { $in: query.status } });
  if (query.clientId) and.push({ clientId: query.clientId });
  if (query.staffId) and.push({ staffId: query.staffId });
  if (query.serviceId) and.push({ serviceId: query.serviceId });
  if (query.team)
    and.push({
      staffId: { $in: await Staff.find({ team: query.team }).distinct("_id") },
    });
  if (query.from) and.push({ date: { $gte: query.from } });
  if (query.to) and.push({ date: { $lte: query.to } });
  if (query.flag === "amended") and.push({ "amendments.0": { $exists: true } });
  if (query.flag === "requests")
    and.push({ "amendmentRequests.status": "Open" });
  if (query.flag === "attention")
    and.push({
      $or: [
        { health: { $in: HEALTH_ALERTS } },
        { incident: { $in: INCIDENT_ALERTS } },
      ],
    });
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    const [participantIds, staffIds] = await Promise.all([
      Participant.find({
        $or: [{ name: pattern }, { preferred: pattern }],
      }).distinct("_id"),
      Staff.find({ name: pattern }).distinct("_id"),
    ]);
    and.push({
      $or: [
        { _id: pattern },
        { type: pattern },
        { location: pattern },
        { date: pattern },
        { summary: pattern },
        { support: pattern },
        { outcome: pattern },
        { followUp: pattern },
        { clientId: { $in: participantIds } },
        { staffId: { $in: staffIds } },
      ],
    });
  }
  const filter = and.length ? { $and: and } : {};
  const [items, total] = await Promise.all([
    ServiceRecord.find(filter)
      .sort(SORTS[query.sort] ?? SORTS["-date"])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ServiceRecordDoc[]>(),
    ServiceRecord.countDocuments(filter),
  ]);
  return {
    items: await recordsToDTOs(items),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function countRecords(
  clientId?: string
): Promise<RecordCountsDTO> {
  const match = clientId ? { clientId: new Types.ObjectId(clientId) } : {};
  const rows = await ServiceRecord.aggregate<{ _id: string; n: number }>([
    { $match: match },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(
    RECORD_STATUSES.map(status => [status, 0])
  ) as RecordCountsDTO;
  for (const row of rows)
    if (row._id in counts) counts[row._id as keyof RecordCountsDTO] = row.n;
  return counts;
}

export async function getRecord(id: string): Promise<ServiceRecordDTO> {
  return recordToDTO(await getRecordDoc(id));
}

/* ───────────── Commands ───────────── */

export async function createRecord(
  input: z.output<typeof recordCreateSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const participant = await requireActiveParticipant(input.clientId);
  await requireActiveStaff(input.staffId);
  const service = await requireActiveService(input.serviceId);
  const quantity = quantityFor(service, input.quantity);
  const km = roundQuantity(input.km ?? 0);
  const { billables, totalCents } = await billablesFor(
    { start: input.start, end: input.end, km, quantity },
    service
  );
  const now = new Date();
  const record = await withTransaction(async session => {
    const id = await nextIds.serviceRecord(session);
    const history: HistorySub[] = [
      historyEntry(
        ctx.actor,
        "created",
        input.voiceNoteId
          ? `Started from voice note ${input.voiceNoteId}`
          : undefined
      ),
    ];
    const [created] = await ServiceRecord.create(
      [
        {
          _id: id,
          clientId: participant._id,
          staffId: input.staffId,
          serviceId: service._id,
          shiftId: input.shiftId ?? null,
          voiceNoteId: input.voiceNoteId ?? null,
          type: service.name,
          budgetCategory: service.budgetCategory,
          unit: service.unit,
          date: input.date,
          start: input.start,
          end: input.end,
          location: input.location ?? "",
          km,
          quantity,
          supportTypes: input.supportTypes ?? [],
          support: input.support ?? "",
          summary: input.summary ?? "",
          goals: input.goals ?? [],
          outcome: input.outcome ?? "",
          achievements: input.achievements ?? "",
          health: input.health ?? [],
          healthDetails: input.healthDetails ?? "",
          incident: input.incident ?? [],
          incidentDetails: input.incidentDetails ?? "",
          followUp: input.followUp ?? "",
          confirmed: Boolean(input.confirmed),
          confirmedAt: input.confirmed ? now : null,
          billables,
          totalCents,
          status: "Draft",
          history,
          createdBy: ctx.actor,
        },
      ],
      { session }
    );
    if (input.voiceNoteId)
      await linkVoice(id, participant._id, input.voiceNoteId, null, session);
    if (input.shiftId) {
      const shift = await RosterShift.findById(input.shiftId)
        .session(session)
        .lean<{ clientIds: Types.ObjectId[] }>();
      if (!shift) throw errors.notFound("Shift");
      if (
        !shift.clientIds.some(
          clientId => String(clientId) === String(participant._id)
        )
      ) {
        throw errors.validation(
          "This shift does not include the selected participant."
        );
      }
      await RosterShift.updateOne(
        { _id: input.shiftId },
        { $addToSet: { recordIds: id } },
        { session }
      );
    }
    return created.toObject<ServiceRecordDoc>();
  });
  await logActivity({
    actor: ctx.actor,
    action: "record.created",
    entityType: "service_record",
    entityId: record._id,
    participantId: participant._id,
    summary: `created service record ${record._id}`,
    ip: ctx.ip,
  });
  return recordToDTO(record);
}

const EDIT_COLLAPSE_MS = 15 * 60_000;

export async function updateRecord(
  id: string,
  input: z.output<typeof recordUpdateSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await getRecordDoc(id);
  assertEditable(current);
  assertRev(current, input.rev);

  const clientChanged =
    input.clientId !== undefined && input.clientId !== String(current.clientId);
  const clientId = clientChanged
    ? (await requireActiveParticipant(input.clientId!))._id
    : current.clientId;
  if (input.staffId !== undefined && input.staffId !== String(current.staffId))
    await requireActiveStaff(input.staffId);
  const serviceChanged =
    input.serviceId !== undefined &&
    input.serviceId !== String(current.serviceId);
  const service = serviceChanged
    ? await requireActiveService(input.serviceId!)
    : await getService(current.serviceId);

  const merged = {
    start: input.start ?? current.start,
    end: input.end ?? current.end,
    km: roundQuantity(input.km ?? current.km ?? 0),
    quantity: quantityFor(
      service,
      input.quantity !== undefined ? input.quantity : current.quantity
    ),
  };
  const { billables, totalCents } = await billablesFor(merged, service);

  const $set: Record<string, unknown> = {
    type: service.name,
    budgetCategory: service.budgetCategory,
    unit: service.unit,
    km: merged.km,
    quantity: merged.quantity,
    billables,
    totalCents,
  };
  if (clientChanged) $set.clientId = clientId;
  for (const key of [
    "staffId",
    "serviceId",
    "date",
    "start",
    "end",
    "location",
    ...NOTE_FIELDS,
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  // Once the summary is saved as one box, the two old boxes it was read from are spent.
  if (input.summary !== undefined) Object.assign($set, SPENT_SUMMARY);
  if (input.confirmed !== undefined) {
    $set.confirmed = input.confirmed;
    $set.confirmedAt = input.confirmed
      ? (current.confirmedAt ?? new Date())
      : null;
  }

  // A recording belongs to one participant: moving the record to another participant detaches it.
  const nextVoiceId =
    input.voiceNoteId !== undefined
      ? input.voiceNoteId
      : clientChanged
        ? null
        : current.voiceNoteId;
  if (nextVoiceId !== current.voiceNoteId) $set.voiceNoteId = nextVoiceId;

  const notes: HistorySub[] = [];
  if (input.applyVoiceDraft && nextVoiceId) {
    Object.assign($set, noteFromDraft(await voiceDraftSections(nextVoiceId)));
    notes.push(
      historyEntry(
        ctx.actor,
        "draft_applied",
        `AI-assisted draft applied from ${nextVoiceId}; review before submitting.`
      )
    );
  }

  const last = current.history?.[current.history.length - 1];
  const collapse =
    last &&
    last.action === "updated" &&
    last.by?.id === ctx.actor.id &&
    Date.now() - new Date(last.at).getTime() < EDIT_COLLAPSE_MS;
  const update: Record<string, unknown> = { $set, $inc: { rev: 1 } };
  if (collapse && !notes.length)
    $set[`history.${current.history.length - 1}.at`] = new Date();
  else
    update.$push = {
      history: {
        $each: [
          ...notes,
          ...(collapse ? [] : [historyEntry(ctx.actor, "updated")]),
        ],
      },
    };

  const record = await withTransaction(async session => {
    const updated = await ServiceRecord.findOneAndUpdate(
      { _id: id, rev: current.rev, status: { $in: EDITABLE_STATUSES } },
      update,
      { returnDocument: "after", lean: true, session }
    );
    if (!updated) throw errors.stale();
    if (nextVoiceId !== current.voiceNoteId)
      await linkVoice(id, clientId, nextVoiceId, current.voiceNoteId, session);
    return updated as ServiceRecordDoc;
  });
  await logActivity({
    actor: ctx.actor,
    action: notes.length ? "record.draft_applied" : "record.updated",
    entityType: "service_record",
    entityId: id,
    participantId: record.clientId,
    summary: notes.length
      ? `applied an AI-assisted draft to ${id}`
      : `updated service record ${id}`,
    ip: ctx.ip,
  });
  return recordToDTO(record);
}

export async function submitRecord(
  id: string,
  rev: number | undefined,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await getRecordDoc(id);
  if (!(EDITABLE_STATUSES as readonly string[]).includes(current.status)) {
    throw errors.invalidState(
      `Only draft or returned records can be submitted. This record is ${current.status.toLowerCase()}.`
    );
  }
  assertRev(current, rev);
  if (!current.confirmed)
    throw errors.validation(MESSAGES.declaration, [
      { path: "confirmed", message: MESSAGES.declaration },
    ]);
  const problems = noteProblems(noteContentOf(current));
  if (problems.length)
    throw errors.validation(MESSAGES.incompleteNote, problems);
  const service = await getService(current.serviceId);
  if (
    service.unit === "Hour" &&
    durationHours(current.start, current.end) <= 0
  ) {
    throw errors.validation(MESSAGES.recordDuration, [
      { path: "end", message: MESSAGES.recordDuration },
    ]);
  }
  if ((current.km ?? 0) > 0 && !service.transportEnabled)
    throw errors.validation(MESSAGES.recordTransport, [
      { path: "km", message: MESSAGES.recordTransport },
    ]);
  const { billables, totalCents } = await billablesFor(
    {
      start: current.start,
      end: current.end,
      km: current.km ?? 0,
      quantity: current.quantity,
    },
    service
  );
  const now = new Date();
  const updated = await ServiceRecord.findOneAndUpdate(
    { _id: id, rev: current.rev, status: { $in: EDITABLE_STATUSES } },
    {
      $set: {
        status: "Submitted",
        submittedAt: now,
        submittedBy: ctx.actor,
        billables,
        totalCents,
        billablesFrozenAt: now,
        type: service.name,
        budgetCategory: service.budgetCategory,
      },
      $inc: { rev: 1 },
      $push: {
        history: historyEntry(
          ctx.actor,
          current.status === "Returned" ? "resubmitted" : "submitted"
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.submitted",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `submitted ${id} for review`,
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

async function requireSubmitted(
  id: string,
  rev: number | undefined
): Promise<ServiceRecordDoc> {
  const current = await getRecordDoc(id);
  if (current.status !== "Submitted")
    throw errors.invalidState(
      `Only submitted records can be reviewed. This record is ${current.status.toLowerCase()}.`
    );
  assertRev(current, rev);
  return current;
}

export async function approveRecord(
  id: string,
  rev: number | undefined,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await requireSubmitted(id, rev);
  const now = new Date();
  const updated = await ServiceRecord.findOneAndUpdate(
    { _id: id, rev: current.rev, status: "Submitted" },
    {
      $set: {
        status: "Approved",
        approvedBy: ctx.actor,
        reviewedAt: now,
        reviewedBy: ctx.actor,
        billablesFrozenAt: current.billablesFrozenAt ?? now,
      },
      $inc: { rev: 1 },
      $push: { history: historyEntry(ctx.actor, "approved") },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.approved",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `approved service record ${id}`,
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

export async function returnRecord(
  id: string,
  input: z.output<typeof recordReturnSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await requireSubmitted(id, input.rev);
  const now = new Date();
  const updated = await ServiceRecord.findOneAndUpdate(
    { _id: id, rev: current.rev, status: "Submitted" },
    {
      $set: {
        status: "Returned",
        correction: input.reason,
        returnedAt: now,
        reviewedAt: now,
        reviewedBy: ctx.actor,
        billablesFrozenAt: null,
      },
      $inc: { rev: 1 },
      $push: { history: historyEntry(ctx.actor, "returned", input.reason) },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.returned",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `returned ${id} for correction`,
    meta: { reason: input.reason },
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

export async function adjustBillables(
  id: string,
  input: z.output<typeof billablesAdjustSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  const current = await requireSubmitted(id, input.rev);
  const billables = current.billables.map(line => ({ ...line }));
  const changes: string[] = [];
  for (const change of input.lines) {
    const line = billables[change.index];
    if (!line)
      throw errors.validation(
        `Billable line ${change.index + 1} does not exist.`
      );
    if (change.quantity !== undefined)
      line.quantity = roundQuantity(change.quantity);
    if (change.rate !== undefined) line.rateCents = toCents(change.rate);
    line.subtotalCents = lineSubtotalCents(line.quantity, line.rateCents);
    changes.push(
      `${line.label}: ${line.quantity} × $${fromCents(line.rateCents).toFixed(2)}`
    );
  }
  const updated = await ServiceRecord.findOneAndUpdate(
    { _id: id, rev: current.rev, status: "Submitted" },
    {
      $set: { billables, totalCents: sumCents(billables) },
      $inc: { rev: 1 },
      $push: {
        history: historyEntry(
          ctx.actor,
          "billables_adjusted",
          changes.join("; ")
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "record.billables_adjusted",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `adjusted the billable lines on ${id}`,
    meta: { changes },
    ip: ctx.ip,
  });
  return recordToDTO(updated as ServiceRecordDoc);
}

export async function deleteRecord(
  id: string,
  ctx: RequestContext
): Promise<void> {
  const current = await getRecordDoc(id);
  if (current.status !== "Draft")
    throw errors.invalidState("Only draft records can be deleted.");
  await withTransaction(async session => {
    const result = await ServiceRecord.deleteOne(
      { _id: id, status: "Draft" },
      { session }
    );
    if (!result.deletedCount) throw errors.stale();
    if (current.voiceNoteId) {
      await VoiceNote.updateOne(
        { _id: current.voiceNoteId, recordId: id },
        { $set: { recordId: null }, $inc: { rev: 1 } },
        { session }
      );
    }
    if (current.shiftId)
      await RosterShift.updateOne(
        { _id: current.shiftId },
        { $pull: { recordIds: id } },
        { session }
      );
  });
  await logActivity({
    actor: ctx.actor,
    action: "record.deleted",
    entityType: "service_record",
    entityId: id,
    participantId: current.clientId,
    summary: `deleted draft record ${id}`,
    meta: { date: current.date, type: current.type },
    ip: ctx.ip,
  });
}
