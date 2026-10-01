import type { Types } from "mongoose";
import type { z } from "zod";
import type { Paginated, ParticipantDTO, WithWarnings } from "@shared/dto";
import { EMPTY_KYC } from "@shared/enums";
import { formatNdis, normalizeNdis } from "@shared/logic/ndis";
import { planLabel } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import type {
  participantArchiveSchema,
  participantCreateSchema,
  participantKycSchema,
  participantListQuery,
  participantUpdateSchema,
} from "@shared/schemas/participants";
import { logActivity } from "../../lib/audit";
import { withTransaction } from "../../lib/db";
import { nextIds } from "../../lib/counters";
import { errors, isDuplicateKey } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import { assertRev, iso, isoRequired } from "../../lib/mappers";
import { workspaceToday } from "../../lib/workspace";
import {
  Budget,
  Participant,
  RosterShift,
  ServiceRecord,
  type ParticipantDoc,
} from "../../models";

export function toParticipantDTO(p: ParticipantDoc): ParticipantDTO {
  const emergency = [p.emergencyName, p.emergencyPhone]
    .filter(Boolean)
    .join(" · ");
  return {
    id: String(p._id),
    clientNumber: p.clientNumber,
    name: p.name,
    preferred: p.preferred,
    ndis: formatNdis(p.ndis),
    dob: p.dob ?? null,
    phone: p.phone ?? "",
    email: p.email ?? "",
    address: p.address ?? "",
    plan: planLabel(p.planStart, p.planEnd),
    planStart: p.planStart ?? null,
    planEnd: p.planEnd ?? null,
    manager: p.manager ?? "",
    managerEmail: p.managerEmail ?? "",
    nominee: p.nominee ?? "",
    emergency,
    emergencyName: p.emergencyName ?? "",
    emergencyPhone: p.emergencyPhone ?? "",
    alerts: p.alerts ?? [],
    goals: p.goals ?? [],
    communication: p.communication ?? "",
    mobility: p.mobility ?? "",
    transport: p.transport ?? "",
    support: p.support ?? "",
    risks: p.risks ?? "",
    allergies: p.allergies ?? "",
    preferences: p.preferences ?? "",
    kyc: { ...EMPTY_KYC, ...(p.kyc ?? {}) },
    status: p.status,
    archivedAt: iso(p.archivedAt),
    archivedReason: p.archivedReason ?? "",
    createdAt: isoRequired(p.createdAt),
    updatedAt: isoRequired(p.updatedAt),
    rev: p.rev ?? 0,
  };
}

const ndisTaken = () =>
  errors.conflict("NDIS_DUPLICATE", MESSAGES.ndisDuplicate, [
    { path: "ndis", message: MESSAGES.ndisDuplicate },
  ]);
const blankToNull = (value: string | null | undefined) =>
  value ? value : null;

export async function getParticipantDoc(
  id: string | Types.ObjectId
): Promise<ParticipantDoc> {
  const participant = await Participant.findById(id).lean<ParticipantDoc>();
  if (!participant) throw errors.notFound("Participant");
  return participant;
}

/** Loads an Active participant or explains why it cannot be used for new work. */
export async function requireActiveParticipant(
  id: string | Types.ObjectId,
  action = "receive new service records"
): Promise<ParticipantDoc> {
  const participant = await getParticipantDoc(id);
  if (participant.status !== "Active")
    throw errors.validation(
      `${participant.preferred} is archived and cannot ${action}.`
    );
  return participant;
}

export async function participantLookup(
  ids: Array<string | Types.ObjectId>
): Promise<Map<string, ParticipantDoc>> {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  const docs = await Participant.find({ _id: { $in: unique } }).lean<
    ParticipantDoc[]
  >();
  return new Map(docs.map(doc => [String(doc._id), doc]));
}

export async function listParticipants(
  query: z.output<typeof participantListQuery>
): Promise<Paginated<ParticipantDTO>> {
  const filter: Record<string, unknown> = {};
  if (query.status !== "all") filter.status = query.status;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    const or: Record<string, unknown>[] = [
      { name: pattern },
      { preferred: pattern },
    ];
    const digits = normalizeNdis(query.q);
    if (digits.length >= 3) or.push({ ndis: new RegExp(escapeRegex(digits)) });
    filter.$or = or;
  }
  const [items, total] = await Promise.all([
    Participant.find(filter)
      .sort({ name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ParticipantDoc[]>(),
    Participant.countDocuments(filter),
  ]);
  return {
    items: items.map(toParticipantDTO),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function createParticipant(
  input: z.output<typeof participantCreateSchema>,
  ctx: RequestContext
): Promise<ParticipantDTO> {
  if (await Participant.exists({ ndis: input.ndis })) throw ndisTaken();
  try {
    const clientNumber = await nextIds.clientNumber();
    const created = await Participant.create({
      clientNumber,
      name: input.name,
      preferred: input.preferred,
      ndis: input.ndis,
      dob: input.dob,
      phone: input.phone,
      email: input.email,
      address: input.address,
      planStart: blankToNull(input.planStart),
      planEnd: blankToNull(input.planEnd),
      manager: input.manager ?? "",
      managerEmail: input.managerEmail ?? "",
      nominee: input.nominee ?? "",
      emergencyName: input.emergencyName,
      emergencyPhone: input.emergencyPhone,
      alerts: input.alerts ?? [],
      goals: input.goals ?? [],
      communication: input.communication ?? "",
      mobility: input.mobility ?? "",
      transport: input.transport ?? "",
      support: input.support ?? "",
      risks: input.risks ?? "",
      allergies: input.allergies ?? "",
      preferences: input.preferences ?? "",
      kyc: { ...EMPTY_KYC, ...(input.kyc ?? {}) },
      createdBy: ctx.actor,
    });
    await logActivity({
      actor: ctx.actor,
      action: "participant.created",
      entityType: "participant",
      entityId: String(created._id),
      participantId: created._id,
      summary: `added participant ${created.preferred}`,
      ip: ctx.ip,
    });
    return toParticipantDTO(created.toObject<ParticipantDoc>());
  } catch (error) {
    if (isDuplicateKey(error)) throw ndisTaken();
    throw error;
  }
}

export async function updateParticipant(
  id: string,
  input: z.output<typeof participantUpdateSchema>,
  ctx: RequestContext
): Promise<ParticipantDTO> {
  const current = await getParticipantDoc(id);
  assertRev(current, input.rev);
  const $set: Record<string, unknown> = {};
  const keys = [
    "name",
    "preferred",
    "ndis",
    "dob",
    "phone",
    "email",
    "address",
    "manager",
    "managerEmail",
    "nominee",
    "emergencyName",
    "emergencyPhone",
    "alerts",
    "goals",
    "communication",
    "mobility",
    "transport",
    "support",
    "risks",
    "allergies",
    "preferences",
  ] as const;
  for (const key of keys) if (input[key] !== undefined) $set[key] = input[key];
  if (input.planStart !== undefined)
    $set.planStart = blankToNull(input.planStart);
  if (input.planEnd !== undefined) $set.planEnd = blankToNull(input.planEnd);
  const planStart =
    input.planStart !== undefined
      ? blankToNull(input.planStart)
      : current.planStart;
  const planEnd =
    input.planEnd !== undefined ? blankToNull(input.planEnd) : current.planEnd;
  if (planStart && planEnd && planEnd < planStart) {
    throw errors.validation(MESSAGES.planDates, [
      { path: "planEnd", message: MESSAGES.planDates },
    ]);
  }
  if (
    input.ndis &&
    input.ndis !== current.ndis &&
    (await Participant.exists({ ndis: input.ndis, _id: { $ne: current._id } }))
  )
    throw ndisTaken();

  try {
    const updated = await withTransaction(async session => {
      const doc = await Participant.findOneAndUpdate(
        { _id: id, rev: current.rev },
        { $set, $inc: { rev: 1 } },
        { returnDocument: "after", lean: true, session }
      );
      if (!doc) throw errors.stale();
      // Keep the current plan budget's window in step with the profile's plan dates.
      if (
        (input.planStart !== undefined || input.planEnd !== undefined) &&
        planStart &&
        planEnd
      ) {
        await Budget.updateOne(
          { clientId: current._id, isCurrent: true },
          { $set: { planStart, planEnd }, $inc: { rev: 1 } },
          { session }
        );
      }
      return doc as ParticipantDoc;
    });
    await logActivity({
      actor: ctx.actor,
      action: "participant.updated",
      entityType: "participant",
      entityId: id,
      participantId: current._id,
      summary: `updated ${updated.preferred}'s profile`,
      meta: { fields: Object.keys($set) },
      ip: ctx.ip,
    });
    return toParticipantDTO(updated);
  } catch (error) {
    if (isDuplicateKey(error)) throw ndisTaken();
    throw error;
  }
}

export async function updateKyc(
  id: string,
  input: z.output<typeof participantKycSchema>,
  ctx: RequestContext
): Promise<ParticipantDTO> {
  const current = await getParticipantDoc(id);
  assertRev(current, input.rev);
  const $set: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input))
    if (key !== "rev" && typeof value === "boolean") $set[`kyc.${key}`] = value;
  const updated = await Participant.findOneAndUpdate(
    { _id: id, rev: current.rev },
    { $set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "participant.kyc_updated",
    entityType: "participant",
    entityId: id,
    participantId: current._id,
    summary: `updated ${current.preferred}'s onboarding checklist`,
    meta: $set,
    ip: ctx.ip,
  });
  return toParticipantDTO(updated as ParticipantDoc);
}

export async function archiveParticipant(
  id: string,
  input: z.output<typeof participantArchiveSchema>,
  ctx: RequestContext
): Promise<WithWarnings<ParticipantDTO>> {
  const current = await getParticipantDoc(id);
  assertRev(current, input.rev);
  if (current.status === "Archived")
    throw errors.invalidState(`${current.preferred} is already archived.`);
  const today = await workspaceToday();
  const [upcomingShifts, openRecords] = await Promise.all([
    RosterShift.countDocuments({
      clientIds: current._id,
      date: { $gte: today },
      status: { $in: ["Planned", "Confirmed"] },
    }),
    ServiceRecord.countDocuments({
      clientId: current._id,
      status: { $in: ["Draft", "Returned", "Submitted"] },
    }),
  ]);
  const warnings: string[] = [];
  if (upcomingShifts) {
    warnings.push(
      `${upcomingShifts} upcoming shift${upcomingShifts === 1 ? " still includes" : "s still include"} ${current.preferred}. Cancel or reassign them in the roster.`
    );
  }
  if (openRecords)
    warnings.push(
      `${openRecords} service record${openRecords === 1 ? " is" : "s are"} still open (draft, returned or awaiting review).`
    );
  const updated = await Participant.findOneAndUpdate(
    { _id: id, rev: current.rev },
    {
      $set: {
        status: "Archived",
        archivedAt: new Date(),
        archivedReason: input.reason ?? "",
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "participant.archived",
    entityType: "participant",
    entityId: id,
    participantId: current._id,
    summary: `archived ${current.preferred}'s profile`,
    meta: input.reason ? { reason: input.reason } : undefined,
    ip: ctx.ip,
  });
  return { ...toParticipantDTO(updated as ParticipantDoc), warnings };
}

export async function restoreParticipant(
  id: string,
  ctx: RequestContext
): Promise<ParticipantDTO> {
  const current = await getParticipantDoc(id);
  if (current.status === "Active")
    throw errors.invalidState(`${current.preferred} is already active.`);
  const updated = await Participant.findOneAndUpdate(
    { _id: id, rev: current.rev },
    {
      $set: { status: "Active", archivedAt: null, archivedReason: "" },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "participant.restored",
    entityType: "participant",
    entityId: id,
    participantId: current._id,
    summary: `restored ${current.preferred}'s profile`,
    ip: ctx.ip,
  });
  return toParticipantDTO(updated as ParticipantDoc);
}
