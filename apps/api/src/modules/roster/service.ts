import type { z } from "zod";
import type {
  RosterShiftDTO,
  ServiceRecordDTO,
  ShiftValidationDTO,
  WithWarnings,
} from "@shared/dto";
import type { ShiftRatio, ShiftStatus } from "@shared/enums";
import { initialsOf } from "@shared/logic/ndis";
import { findOverlaps, ratioError } from "@shared/logic/roster";
import { durationHours } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import type {
  shiftCreateSchema,
  shiftListQuery,
  shiftStatusSchema,
  shiftUpdateSchema,
} from "@shared/schemas/roster";
import { logActivity } from "../../lib/audit";
import { nextIds } from "../../lib/counters";
import { withTransaction } from "../../lib/db";
import { AppError, errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { assertRev, isoRequired } from "../../lib/mappers";
import {
  Participant,
  RosterShift,
  Service,
  ServiceRecord,
  Staff,
  type ParticipantDoc,
  type RosterShiftDoc,
  type ServiceDoc,
  type StaffDoc,
} from "../../models";
import { projectShiftImpact } from "../budgets/service";
import { participantLookup } from "../participants/service";
import { createRecord, staffLookup } from "../records/service";

export async function shiftsToDTOs(
  shifts: RosterShiftDoc[]
): Promise<RosterShiftDTO[]> {
  const [participants, staff] = await Promise.all([
    participantLookup(shifts.flatMap(shift => shift.clientIds)),
    staffLookup(shifts.flatMap(shift => shift.staffIds)),
  ]);
  return shifts.map(shift => ({
    id: shift._id,
    date: shift.date,
    start: shift.start,
    end: shift.end,
    hours: durationHours(shift.start, shift.end),
    ratio: shift.ratio,
    clientIds: shift.clientIds.map(String),
    staffIds: shift.staffIds.map(String),
    clients: shift.clientIds.map(id => {
      const participant = participants.get(String(id));
      return {
        id: String(id),
        name: participant?.name ?? "Unknown",
        preferred: participant?.preferred ?? "Unknown",
      };
    }),
    staff: shift.staffIds.map(id => {
      const member = staff.get(String(id));
      return {
        id: String(id),
        name: member?.name ?? "Unknown",
        initials: member ? initialsOf(member.name) : "?",
      };
    }),
    serviceId: String(shift.serviceId),
    type: shift.type,
    location: shift.location ?? "",
    notes: shift.notes ?? "",
    status: shift.status,
    recordIds: shift.recordIds ?? [],
    createdAt: isoRequired(shift.createdAt),
    updatedAt: isoRequired(shift.updatedAt),
    rev: shift.rev ?? 0,
  }));
}

async function shiftToDTO(shift: RosterShiftDoc): Promise<RosterShiftDTO> {
  return (await shiftsToDTOs([shift]))[0];
}

export async function getShiftDoc(id: string): Promise<RosterShiftDoc> {
  const shift = await RosterShift.findById(id).lean<RosterShiftDoc>();
  if (!shift) throw errors.notFound("Shift");
  return shift;
}

export async function listShifts(
  query: z.output<typeof shiftListQuery>
): Promise<RosterShiftDTO[]> {
  const filter: Record<string, unknown> = {
    date: { $gte: query.from, $lte: query.to },
  };
  if (query.ratio) filter.ratio = query.ratio;
  if (query.clientId) filter.clientIds = query.clientId;
  if (query.staffId) filter.staffIds = query.staffId;
  if (query.status) filter.status = query.status;
  const shifts = await RosterShift.find(filter)
    .sort({ date: 1, start: 1 })
    .lean<RosterShiftDoc[]>();
  return shiftsToDTOs(shifts);
}

interface ShiftDraft {
  date: string;
  start: string;
  end: string;
  ratio: ShiftRatio;
  clientIds: string[];
  staffIds: string[];
  serviceId: string;
  location: string;
  notes: string;
}

interface ShiftCheck {
  problems: AppError[];
  warnings: string[];
  service: ServiceDoc | null;
}

/** Applies every roster rule. Problems block saving; warnings (budget impact) are informational. */
async function checkShift(
  draft: ShiftDraft,
  excludeId?: string,
  options: { skipWarnings?: boolean } = {}
): Promise<ShiftCheck> {
  const problems: AppError[] = [];
  if (durationHours(draft.start, draft.end) <= 0)
    problems.push(
      errors.validation(MESSAGES.shiftTimes, [
        { path: "end", message: MESSAGES.shiftTimes },
      ])
    );
  const ratio = ratioError(
    draft.ratio,
    draft.clientIds.length,
    draft.staffIds.length
  );
  if (ratio)
    problems.push(
      errors.validation(ratio, [{ path: "ratio", message: ratio }])
    );

  const [participants, staff, service] = await Promise.all([
    Participant.find({ _id: { $in: draft.clientIds } }).lean<
      ParticipantDoc[]
    >(),
    Staff.find({ _id: { $in: draft.staffIds } }).lean<StaffDoc[]>(),
    Service.findById(draft.serviceId).lean<ServiceDoc>(),
  ]);
  if (participants.length !== draft.clientIds.length)
    problems.push(errors.notFound("Participant"));
  if (staff.length !== draft.staffIds.length)
    problems.push(errors.notFound("Team member"));
  for (const participant of participants) {
    if (participant.status !== "Active")
      problems.push(
        errors.validation(
          `${participant.preferred} is archived and cannot be rostered.`
        )
      );
  }
  for (const member of staff) {
    if (member.status !== "Active")
      problems.push(
        errors.validation(
          `${member.name} is ${member.status.toLowerCase()} and cannot be assigned.`
        )
      );
  }
  if (!service) problems.push(errors.notFound("Service"));
  else if (!service.active)
    problems.push(
      errors.validation(
        `${service.name} is inactive. Choose an active service.`
      )
    );

  if (durationHours(draft.start, draft.end) > 0) {
    const candidates = await RosterShift.find({
      date: draft.date,
      status: { $ne: "Cancelled" },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      $or: [
        { clientIds: { $in: draft.clientIds } },
        { staffIds: { $in: draft.staffIds } },
      ],
    }).lean<RosterShiftDoc[]>();
    const overlaps = findOverlaps(
      { ...draft, id: excludeId },
      candidates.map(shift => ({
        id: shift._id,
        date: shift.date,
        start: shift.start,
        end: shift.end,
        clientIds: shift.clientIds.map(String),
        staffIds: shift.staffIds.map(String),
        status: shift.status,
      }))
    );
    if (overlaps.participantConflict) {
      const id = overlaps.participantConflict.id;
      problems.push(
        errors.conflict("SHIFT_OVERLAP", MESSAGES.shiftParticipantOverlap(id), {
          shiftId: id,
          resource: "participant",
        })
      );
    }
    if (overlaps.staffConflict) {
      const id = overlaps.staffConflict.id;
      problems.push(
        errors.conflict("SHIFT_OVERLAP", MESSAGES.shiftStaffOverlap(id), {
          shiftId: id,
          resource: "staff",
        })
      );
    }
  }
  const warnings =
    problems.length || options.skipWarnings || !service
      ? []
      : await projectShiftImpact(
          participants,
          {
            date: draft.date,
            start: draft.start,
            end: draft.end,
            serviceId: draft.serviceId,
          },
          excludeId
        );
  return { problems, warnings, service };
}

function normalise(
  input: Partial<ShiftDraft>,
  base?: RosterShiftDoc
): ShiftDraft {
  return {
    date: input.date ?? base?.date ?? "",
    start: input.start ?? base?.start ?? "",
    end: input.end ?? base?.end ?? "",
    ratio: input.ratio ?? base?.ratio ?? "1:1",
    clientIds: [
      ...new Set(input.clientIds ?? base?.clientIds.map(String) ?? []),
    ],
    staffIds: [...new Set(input.staffIds ?? base?.staffIds.map(String) ?? [])],
    serviceId: input.serviceId ?? (base ? String(base.serviceId) : ""),
    location: input.location ?? base?.location ?? "",
    notes: input.notes ?? base?.notes ?? "",
  };
}

export async function validateShift(
  input: z.output<typeof shiftCreateSchema>,
  excludeId?: string
): Promise<ShiftValidationDTO> {
  const { problems, warnings } = await checkShift(normalise(input), excludeId);
  return { errors: problems.map(problem => problem.message), warnings };
}

export async function createShift(
  input: z.output<typeof shiftCreateSchema>,
  ctx: RequestContext
): Promise<WithWarnings<RosterShiftDTO>> {
  const draft = normalise(input);
  const { problems, warnings, service } = await checkShift(draft);
  if (problems.length || !service)
    throw problems[0] ?? errors.notFound("Service");
  const shift = await withTransaction(async session => {
    const id = await nextIds.shift(session);
    const [created] = await RosterShift.create(
      [
        {
          _id: id,
          ...draft,
          type: service.name,
          status: "Planned",
          recordIds: [],
          createdBy: ctx.actor,
        },
      ],
      { session }
    );
    return created.toObject<RosterShiftDoc>();
  });
  await logActivity({
    actor: ctx.actor,
    action: "shift.created",
    entityType: "shift",
    entityId: shift._id,
    summary: `added ${shift._id} to the roster`,
    ip: ctx.ip,
  });
  return { ...(await shiftToDTO(shift)), warnings };
}

export async function updateShift(
  id: string,
  input: z.output<typeof shiftUpdateSchema>,
  ctx: RequestContext
): Promise<WithWarnings<RosterShiftDTO>> {
  const current = await getShiftDoc(id);
  if (current.status === "Completed")
    throw errors.invalidState("Completed shifts are locked.");
  assertRev(current, input.rev);
  const draft = normalise(input, current);
  const { problems, warnings, service } = await checkShift(draft, id);
  if (problems.length || !service)
    throw problems[0] ?? errors.notFound("Service");
  const updated = await RosterShift.findOneAndUpdate(
    { _id: id, rev: current.rev, status: { $ne: "Completed" } },
    { $set: { ...draft, type: service.name }, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "shift.updated",
    entityType: "shift",
    entityId: id,
    summary: `updated ${id} in the roster`,
    ip: ctx.ip,
  });
  return { ...(await shiftToDTO(updated as RosterShiftDoc)), warnings };
}

const TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  Planned: ["Confirmed", "Completed", "Cancelled"],
  Confirmed: ["Planned", "Completed", "Cancelled"],
  Completed: [],
  Cancelled: ["Planned"],
};

export async function changeShiftStatus(
  id: string,
  input: z.output<typeof shiftStatusSchema>,
  ctx: RequestContext
): Promise<RosterShiftDTO> {
  const current = await getShiftDoc(id);
  assertRev(current, input.rev);
  if (!TRANSITIONS[current.status].includes(input.status)) {
    throw errors.invalidState(
      `A ${current.status.toLowerCase()} shift cannot be marked ${input.status.toLowerCase()}.`
    );
  }
  if (current.status === "Cancelled") {
    // Restoring a cancelled shift must not create a double booking.
    const { problems } = await checkShift(normalise({}, current), id, {
      skipWarnings: true,
    });
    if (problems.length) throw problems[0];
  }
  const updated = await RosterShift.findOneAndUpdate(
    { _id: id, rev: current.rev, status: current.status },
    { $set: { status: input.status }, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "shift.status_changed",
    entityType: "shift",
    entityId: id,
    summary: `marked ${id} as ${input.status.toLowerCase()}`,
    ip: ctx.ip,
  });
  return shiftToDTO(updated as RosterShiftDoc);
}

export async function deleteShift(
  id: string,
  ctx: RequestContext
): Promise<void> {
  const current = await getShiftDoc(id);
  if (
    !["Planned", "Cancelled"].includes(current.status) ||
    current.recordIds.length
  ) {
    throw errors.invalidState(
      "Only planned or cancelled shifts without service records can be deleted."
    );
  }
  const result = await RosterShift.deleteOne({ _id: id, rev: current.rev });
  if (!result.deletedCount) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "shift.deleted",
    entityType: "shift",
    entityId: id,
    summary: `deleted ${id} from the roster`,
    ip: ctx.ip,
  });
}

/** Creates one Draft service record per participant of a completed shift (skipping any that already exist). */
export async function createRecordsFromShift(
  id: string,
  ctx: RequestContext
): Promise<ServiceRecordDTO[]> {
  const shift = await getShiftDoc(id);
  if (shift.status !== "Completed")
    throw errors.invalidState(
      "Mark the shift as completed before creating service records."
    );
  const created: ServiceRecordDTO[] = [];
  for (const clientId of shift.clientIds) {
    if (await ServiceRecord.exists({ shiftId: id, clientId })) continue;
    created.push(
      await createRecord(
        {
          clientId: String(clientId),
          staffId: String(shift.staffIds[0]),
          serviceId: String(shift.serviceId),
          date: shift.date,
          start: shift.start,
          end: shift.end,
          location: shift.location,
          shiftId: id,
        },
        ctx
      )
    );
  }
  return created;
}
