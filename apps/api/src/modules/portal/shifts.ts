import type { z } from "zod";
import type { PortalShiftDTO } from "@shared/dto";
import { durationHours } from "@shared/logic/time";
import type { portalShiftQuery } from "@shared/schemas/staff-portal";
import { errors } from "../../lib/errors";
import {
  RosterShift,
  Service,
  TrackingSession,
  type ParticipantDoc,
  type RosterShiftDoc,
  type ServiceDoc,
  type TrackingSessionDoc,
} from "../../models";
import { participantLookup } from "../participants/service";
import { activeSessionFor, trackingDTO } from "./tracking";

interface ShiftLookups {
  participants: Map<string, ParticipantDoc>;
  services: Map<string, ServiceDoc>;
}

async function shiftLookups(shifts: RosterShiftDoc[]): Promise<ShiftLookups> {
  const [participants, services] = await Promise.all([
    participantLookup(shifts.flatMap(shift => shift.clientIds)),
    Service.find({
      _id: { $in: [...new Set(shifts.map(shift => String(shift.serviceId)))] },
    }).lean<ServiceDoc[]>(),
  ]);
  return {
    participants,
    services: new Map(services.map(service => [String(service._id), service])),
  };
}

export function toPortalShiftDTO(
  shift: RosterShiftDoc,
  staffId: string,
  lookups: ShiftLookups,
  tracking: PortalShiftDTO["tracking"] = null
): PortalShiftDTO {
  const timesheet = shift.timesheets?.find(
    row => String(row.staffId) === staffId
  );
  const workedMinutes =
    timesheet?.startedAt && timesheet.endedAt
      ? Math.max(
          0,
          Math.round(
            (timesheet.endedAt.getTime() - timesheet.startedAt.getTime()) /
              60_000
          ) - (timesheet.breakMinutes ?? 0)
        )
      : null;
  return {
    id: shift._id,
    date: shift.date,
    start: shift.start,
    end: shift.end,
    hours: durationHours(shift.start, shift.end),
    ratio: shift.ratio,
    status: shift.status,
    type: shift.type,
    location: shift.location ?? "",
    notes: shift.notes ?? "",
    serviceId: String(shift.serviceId),
    serviceName:
      lookups.services.get(String(shift.serviceId))?.name ?? shift.type,
    participants: shift.clientIds.map(id => {
      const participant = lookups.participants.get(String(id));
      return {
        id: String(id),
        name: participant?.name ?? "Participant",
        preferred: participant?.preferred ?? participant?.name ?? "Participant",
        alerts: participant?.alerts ?? [],
        goals: participant?.goals ?? [],
        communication: participant?.communication ?? "",
        mobility: participant?.mobility ?? "",
        risks: participant?.risks ?? "",
        allergies: participant?.allergies ?? "",
        address: participant?.address ?? "",
      };
    }),
    recordId: shift.recordIds?.[0] ?? null,
    timesheet: {
      startedAt: timesheet?.startedAt
        ? timesheet.startedAt.toISOString()
        : null,
      endedAt: timesheet?.endedAt ? timesheet.endedAt.toISOString() : null,
      breakMinutes: timesheet?.breakMinutes ?? 0,
      workedMinutes,
      kilometres: timesheet?.kilometres ?? 0,
      notes: timesheet?.notes ?? "",
    },
    tracking,
  };
}

/** The worker's running session, so the shift screen can resume after a reload. */
async function activeTrackingFor(staffId: string) {
  const session = await activeSessionFor(staffId);
  if (!session) return null;
  return { shiftId: session.shiftId, dto: await trackingDTO(session) };
}

export async function listPortalShifts(
  staffId: string,
  query: z.output<typeof portalShiftQuery>
): Promise<PortalShiftDTO[]> {
  const filter: Record<string, unknown> = { staffIds: staffId };
  const range: Record<string, string> = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lte = query.to;
  if (Object.keys(range).length) filter.date = range;
  if (!query.includeCancelled) filter.status = { $ne: "Cancelled" };
  const shifts = await RosterShift.find(filter)
    .sort({ date: 1, start: 1 })
    .lean<RosterShiftDoc[]>();
  const lookups = await shiftLookups(shifts);
  const active = await activeTrackingFor(staffId);
  return shifts.map(shift =>
    toPortalShiftDTO(
      shift,
      staffId,
      lookups,
      active && active.shiftId === shift._id ? active.dto : null
    )
  );
}

export async function getPortalShift(
  staffId: string,
  shiftId: string
): Promise<PortalShiftDTO> {
  const shift = await RosterShift.findById(shiftId).lean<RosterShiftDoc>();
  if (!shift || !shift.staffIds.some(id => String(id) === staffId))
    throw errors.notFound("Shift");
  const lookups = await shiftLookups([shift]);
  const active = await activeTrackingFor(staffId);
  // On one shift the worker should still see the route after finishing, not just while running.
  const session =
    active && active.shiftId === shift._id
      ? active.dto
      : await sessionForShift(staffId, shift._id);
  return toPortalShiftDTO(shift, staffId, lookups, session);
}

/** The most recent tracked job for this shift, running or finished. */
async function sessionForShift(staffId: string, shiftId: string) {
  const session = await TrackingSession.findOne({ staffId, shiftId })
    .sort({ startedAt: -1 })
    .lean<TrackingSessionDoc>();
  return session ? trackingDTO(session) : null;
}

export interface TimesheetInput {
  action: "start" | "stop" | "save";
  breakMinutes?: number;
  kilometres?: number;
  notes?: string;
}

/**
 * Timesheet sign-on/off. Starting a job also flips a Planned shift to Confirmed, so the
 * back office sees that the worker has actually begun at the same moment tracking starts.
 */
export async function updateTimesheet(
  staffId: string,
  shiftId: string,
  input: TimesheetInput
): Promise<PortalShiftDTO> {
  const shift = await RosterShift.findById(shiftId).lean<RosterShiftDoc>();
  if (!shift || !shift.staffIds.some(id => String(id) === staffId))
    throw errors.notFound("Shift");
  if (shift.status === "Cancelled")
    throw errors.invalidState(
      "This shift was cancelled, so there is nothing to sign on to."
    );
  const now = new Date();
  const current = shift.timesheets?.find(
    row => String(row.staffId) === staffId
  );
  const staffObjectId = shift.staffIds.find(id => String(id) === staffId)!;
  const next = {
    staffId: staffObjectId,
    startedAt: current?.startedAt ?? null,
    endedAt: current?.endedAt ?? null,
    breakMinutes: input.breakMinutes ?? current?.breakMinutes ?? 0,
    kilometres: input.kilometres ?? current?.kilometres ?? 0,
    notes: input.notes ?? current?.notes ?? "",
  };
  if (input.action === "start") next.startedAt = current?.startedAt ?? now;
  if (input.action === "stop") {
    next.startedAt = current?.startedAt ?? now;
    next.endedAt = now;
  }
  const others = (shift.timesheets ?? []).filter(
    row => String(row.staffId) !== staffId
  );
  await RosterShift.updateOne(
    { _id: shiftId },
    {
      $set: {
        timesheets: [...others, next],
        status:
          input.action === "stop"
            ? "Completed"
            : input.action === "start" && shift.status === "Planned"
              ? "Confirmed"
              : shift.status,
      },
    }
  );
  return getPortalShift(staffId, shiftId);
}
