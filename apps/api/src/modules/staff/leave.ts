import type { Types } from "mongoose";
import type { z } from "zod";
import type { LeaveClashDTO, LeaveRequestDTO } from "@shared/dto";
import { PAID_LEAVE_TYPES } from "@shared/enums";
import { daysBetween, prettyDate, timesOverlap } from "@shared/logic/time";
import type {
  leaveCreateSchema,
  leaveDecisionSchema,
  leaveListQuery,
} from "@shared/schemas/workforce";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, assertRev, iso, isoRequired } from "../../lib/mappers";
import { workspaceToday } from "../../lib/workspace";
import {
  LeaveRequest,
  RosterShift,
  Staff,
  type LeaveRequestDoc,
  type RosterShiftDoc,
  type StaffDoc,
} from "../../models";
import { participantLookup } from "../participants/service";
import { staffLookup } from "../records/service";

/*
 * Leave and other time off. A worker asks from the portal (or the office records it for them);
 * the office decides. Approving never changes the roster by itself: the shifts the person is
 * still on are listed so someone can reassign them, and the roster warns from then on.
 */

type Dates = Pick<LeaveRequestDoc, "from" | "to" | "startTime" | "endTime">;

/** The shifts someone is still rostered on inside a stretch of time off. */
async function clashesFor(
  requests: Array<Dates & { staffId: string | Types.ObjectId; status: string }>
): Promise<Map<number, LeaveClashDTO[]>> {
  const open = requests
    .map((request, index) => ({ request, index }))
    .filter(
      ({ request }) =>
        request.status === "Pending" || request.status === "Approved"
    );
  const result = new Map<number, LeaveClashDTO[]>();
  if (!open.length) return result;
  const from = open.map(row => row.request.from).sort()[0];
  const to = open
    .map(row => row.request.to)
    .sort()
    .reverse()[0];
  const shifts = await RosterShift.find({
    staffIds: { $in: open.map(row => row.request.staffId) },
    date: { $gte: from, $lte: to },
    status: { $in: ["Planned", "Confirmed"] },
  })
    .sort({ date: 1, start: 1 })
    .lean<RosterShiftDoc[]>();
  if (!shifts.length) return result;
  const clients = await participantLookup(
    shifts.flatMap(shift => shift.clientIds)
  );
  for (const { request, index } of open) {
    const clashing = shifts.filter(
      shift =>
        shift.staffIds.some(id => String(id) === String(request.staffId)) &&
        shift.date >= request.from &&
        shift.date <= request.to &&
        (!request.startTime ||
          !request.endTime ||
          timesOverlap(shift.start, shift.end, request.startTime, request.endTime))
    );
    if (clashing.length)
      result.set(
        index,
        clashing.map(shift => ({
          shiftId: shift._id,
          date: shift.date,
          start: shift.start,
          end: shift.end,
          clients: shift.clientIds
            .map(id => clients.get(String(id))?.preferred ?? "Participant")
            .join(", "),
        }))
      );
  }
  return result;
}

async function toDTOs(requests: LeaveRequestDoc[]): Promise<LeaveRequestDTO[]> {
  const [staff, clashes] = await Promise.all([
    staffLookup(requests.map(request => request.staffId)),
    clashesFor(requests),
  ]);
  return requests.map((request, index) => ({
    id: String(request._id),
    staffId: String(request.staffId),
    staffName: staff.get(String(request.staffId))?.name ?? "Unknown",
    type: request.type,
    from: request.from,
    to: request.to,
    startTime: request.startTime ?? null,
    endTime: request.endTime ?? null,
    days: daysBetween(request.from, request.to) + 1,
    hours: request.hours ?? 0,
    reason: request.reason ?? "",
    status: request.status,
    requestedBy: actorDTO(request.requestedBy),
    requestedAt: isoRequired(request.createdAt),
    decidedBy: actorDTO(request.decidedBy),
    decidedAt: iso(request.decidedAt),
    decisionNote: request.decisionNote ?? "",
    clashes: clashes.get(index) ?? [],
    payRunId: request.payRunId ?? null,
    rev: request.rev ?? 0,
  }));
}

const toDTO = async (request: LeaveRequestDoc) => (await toDTOs([request]))[0];

/** Every request, the ones waiting for a decision first, then the soonest. */
export async function listLeave(
  query: z.output<typeof leaveListQuery>
): Promise<LeaveRequestDTO[]> {
  const filter: Record<string, unknown> = {};
  if (query.status !== "all") filter.status = query.status;
  if (query.staffId) filter.staffId = query.staffId;
  if (query.from) filter.to = { $gte: query.from };
  if (query.to) filter.from = { $lte: query.to };
  const requests = await LeaveRequest.find(filter)
    .sort({ from: -1 })
    .limit(400)
    .lean<LeaveRequestDoc[]>();
  const rank = { Pending: 0, Approved: 1, Declined: 2, Cancelled: 3 } as const;
  return toDTOs(
    requests.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.status === "Pending"
          ? a.from.localeCompare(b.from)
          : b.from.localeCompare(a.from))
    )
  );
}

/** A worker's own requests, newest first. */
export async function listOwnLeave(
  staffId: string
): Promise<LeaveRequestDTO[]> {
  const requests = await LeaveRequest.find({ staffId })
    .sort({ from: -1 })
    .limit(100)
    .lean<LeaveRequestDoc[]>();
  return toDTOs(requests);
}

export async function countPendingLeave(): Promise<number> {
  return LeaveRequest.countDocuments({ status: "Pending" });
}

/**
 * Records time off. From the portal it waits for the office, except a plain "Unavailable" with
 * nothing rostered on those dates: nobody needs to approve someone not being free.
 */
export async function requestLeave(
  staffId: string,
  input: z.output<typeof leaveCreateSchema>,
  ctx: RequestContext,
  options: { office?: boolean; approve?: boolean } = {}
): Promise<LeaveRequestDTO> {
  const staff = await Staff.findById(staffId).lean<StaffDoc>();
  if (!staff) throw errors.notFound("Team member");
  const overlapping = await LeaveRequest.findOne({
    staffId,
    status: { $in: ["Pending", "Approved"] },
    from: { $lte: input.to },
    to: { $gte: input.from },
  }).lean<LeaveRequestDoc>();
  if (overlapping)
    throw errors.conflict(
      "CONFLICT",
      `There is already ${overlapping.status === "Approved" ? "approved" : "a request for"} time off from ${prettyDate(overlapping.from)} to ${prettyDate(overlapping.to)}. Change or cancel that one first.`
    );
  const startTime = input.startTime || null;
  const endTime = input.endTime || null;
  const clashes = await clashesFor([
    {
      staffId,
      status: "Pending",
      from: input.from,
      to: input.to,
      startTime,
      endTime,
    },
  ]);
  const clear = !clashes.size;
  const selfServe = !options.office && input.type === "Unavailable" && clear;
  const approved = selfServe || Boolean(options.office && options.approve);
  const created = await LeaveRequest.create({
    staffId,
    type: input.type,
    from: input.from,
    to: input.to,
    startTime,
    endTime,
    hours: PAID_LEAVE_TYPES.includes(input.type) ? (input.hours ?? 0) : 0,
    reason: input.reason ?? "",
    status: approved ? "Approved" : "Pending",
    requestedBy: ctx.actor,
    decidedBy: approved && options.office ? ctx.actor : null,
    decidedAt: approved ? new Date() : null,
    decisionNote: selfServe
      ? "Nothing was rostered on these dates, so no approval was needed."
      : "",
  });
  await logActivity({
    actor: ctx.actor,
    action: "leave.requested",
    entityType: "leave",
    entityId: String(created._id),
    summary: options.office
      ? `recorded ${input.type.toLowerCase()} for ${staff.name} (${prettyDate(input.from)} to ${prettyDate(input.to)})`
      : `asked for ${input.type.toLowerCase()} from ${prettyDate(input.from)} to ${prettyDate(input.to)}`,
    ip: ctx.ip,
  });
  return toDTO(created.toObject<LeaveRequestDoc>());
}

export async function decideLeave(
  id: string,
  input: z.output<typeof leaveDecisionSchema>,
  ctx: RequestContext
): Promise<LeaveRequestDTO> {
  const current = await LeaveRequest.findById(id).lean<LeaveRequestDoc>();
  if (!current) throw errors.notFound("Leave request");
  assertRev({ rev: current.rev ?? 0 }, input.rev);
  if (current.status !== "Pending")
    throw errors.invalidState(
      `This request has already been ${current.status.toLowerCase()}.`
    );
  const updated = await LeaveRequest.findOneAndUpdate(
    { _id: id, status: "Pending" },
    {
      $set: {
        status: input.decision,
        decidedBy: ctx.actor,
        decidedAt: new Date(),
        decisionNote: input.note ?? "",
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  const name = (await staffLookup([current.staffId])).get(
    String(current.staffId)
  )?.name;
  await logActivity({
    actor: ctx.actor,
    action:
      input.decision === "Approved" ? "leave.approved" : "leave.declined",
    entityType: "leave",
    entityId: id,
    summary: `${input.decision === "Approved" ? "approved" : "declined"} ${name ?? "a worker"}'s ${current.type.toLowerCase()} (${prettyDate(current.from)} to ${prettyDate(current.to)})`,
    ip: ctx.ip,
  });
  return toDTO(updated as LeaveRequestDoc);
}

/**
 * Withdraws a request. A worker can withdraw their own until the first day arrives; the office
 * can cancel any that has not been paid.
 */
export async function cancelLeave(
  id: string,
  ctx: RequestContext,
  ownStaffId?: string
): Promise<LeaveRequestDTO> {
  const filter: Record<string, unknown> = { _id: id };
  if (ownStaffId) filter.staffId = ownStaffId;
  const current = await LeaveRequest.findOne(filter).lean<LeaveRequestDoc>();
  if (!current) throw errors.notFound("Leave request");
  if (current.status !== "Pending" && current.status !== "Approved")
    throw errors.invalidState(
      `This request is already ${current.status.toLowerCase()}.`
    );
  if (current.payRunId)
    throw errors.invalidState(
      `These hours were paid in pay run ${current.payRunId}, so the request cannot be cancelled.`
    );
  if (
    ownStaffId &&
    current.status === "Approved" &&
    current.from <= (await workspaceToday())
  )
    throw errors.invalidState(
      "This time off has already started. Ask the office to change it."
    );
  const updated = await LeaveRequest.findOneAndUpdate(
    { _id: id, status: current.status },
    { $set: { status: "Cancelled" }, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "leave.cancelled",
    entityType: "leave",
    entityId: id,
    summary: `cancelled ${current.type.toLowerCase()} from ${prettyDate(current.from)} to ${prettyDate(current.to)}`,
    ip: ctx.ip,
  });
  return toDTO(updated as LeaveRequestDoc);
}
