import { Types } from "mongoose";
import type { z } from "zod";
import type { TrackingSessionDTO } from "@shared/dto";
import {
  TRACKING_INTERVALS,
  TRACKING_MIN_MOVE_M,
  TRACKING_STALE_SEC,
  TRACKING_STATIONARY_KPH,
} from "@shared/enums";
import {
  appendTrailPoint,
  distanceMeters,
  toKilometres,
  type GeoPoint,
} from "@shared/logic/geo";
import { initialsOf } from "@shared/logic/ndis";
import { MESSAGES } from "@shared/messages";
import type {
  trackingPingSchema,
  trackingStartSchema,
  trackingStopSchema,
} from "@shared/schemas/staff-portal";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { isoRequired } from "../../lib/mappers";
import {
  LogbookEntry,
  Participant,
  RosterShift,
  Staff,
  TrackingSession,
  type ParticipantDoc,
  type RosterShiftDoc,
  type StaffDoc,
  type TrackingSessionDoc,
} from "../../models";
import { workspaceToday } from "../../lib/workspace";

/** A cap on stored points, so a forgotten session cannot grow without bound. */
const MAX_POINTS = 6_000;

export function toTrackingDTO(
  session: TrackingSessionDoc,
  lookups: { staffName: string; participantNames: string[] },
  now = Date.now()
): TrackingSessionDTO {
  const lastPingAt = session.lastPingAt ? session.lastPingAt.getTime() : null;
  const stale =
    lastPingAt === null || now - lastPingAt > TRACKING_STALE_SEC * 1000;
  const running = session.status !== "Ended";
  const speed = session.currentSpeedKph;
  return {
    id: String(session._id),
    shiftId: session.shiftId ?? null,
    staffId: String(session.staffId),
    staffName: lookups.staffName,
    staffInitials: initialsOf(lookups.staffName),
    participantNames: lookups.participantNames,
    status: session.status,
    startedAt: isoRequired(session.startedAt),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    lastPingAt: session.lastPingAt ? session.lastPingAt.toISOString() : null,
    durationMinutes: session.endedAt
      ? Math.max(
          0,
          Math.round(
            (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000
          )
        )
      : Math.max(0, Math.round((now - session.startedAt.getTime()) / 60_000)),
    distanceMetres: Math.round(session.distanceMetres),
    kilometres: toKilometres(session.distanceMetres),
    currentSpeedKph: speed ?? null,
    stationary: speed === null ? true : speed < TRACKING_STATIONARY_KPH,
    signalLost: running && stale,
    startLocation: session.startLocation ?? null,
    lastLocation: session.lastLocation ?? null,
    trail: session.points.map(point => ({
      at: point.at.toISOString(),
      lat: point.lat,
      lng: point.lng,
      accuracy: point.accuracy ?? null,
      speedKph: point.speedKph ?? null,
    })),
    notes: session.notes ?? "",
  };
}

export async function trackingDTO(
  session: TrackingSessionDoc,
  now?: number
): Promise<TrackingSessionDTO> {
  const [staff, participants] = await Promise.all([
    Staff.findById(session.staffId)
      .select("name")
      .lean<Pick<StaffDoc, "name">>(),
    session.participantIds.length
      ? Participant.find({ _id: { $in: session.participantIds } })
          .select("preferred name")
          .lean<Array<Pick<ParticipantDoc, "preferred" | "name">>>()
      : Promise.resolve([]),
  ]);
  return toTrackingDTO(
    session,
    {
      staffName: staff?.name ?? "Unknown staff member",
      participantNames: participants.map(
        participant => participant.preferred || participant.name
      ),
    },
    now
  );
}

/** A worker may only run one session at a time; the portal reads this to resume after a reload. */
/** A worker may only run one session at a time; the portal reads this to resume after a reload. */
export function activeSessionFor(
  staffId: string
): Promise<TrackingSessionDoc | null> {
  return TrackingSession.findOne({ staffId, status: { $ne: "Ended" } })
    .sort({ startedAt: -1 })
    .lean<TrackingSessionDoc>();
}

export async function startTracking(
  staffId: string,
  input: z.output<typeof trackingStartSchema>,
  ctx: RequestContext
): Promise<TrackingSessionDTO> {
  const running = await activeSessionFor(staffId);
  if (running)
    throw errors.conflict("TRACKING_ALREADY_RUNNING", MESSAGES.trackingRunning);
  let shift: RosterShiftDoc | null = null;
  if (input.shiftId) {
    shift = await RosterShift.findById(input.shiftId).lean<RosterShiftDoc>();
    if (!shift || !shift.staffIds.some(id => String(id) === staffId))
      throw errors.notFound("Shift");
  }
  const now = new Date();
  const start = input.location ?? null;
  const created = await TrackingSession.create({
    shiftId: input.shiftId ?? null,
    staffId: new Types.ObjectId(staffId),
    participantIds: shift?.clientIds ?? [],
    status: "Active",
    startedAt: now,
    lastPingAt: input.location ? now : null,
    startLocation: start,
    lastLocation: start,
    points: input.location
      ? [
          {
            at: now,
            lat: input.location.lat,
            lng: input.location.lng,
            accuracy: input.accuracy ?? null,
            speedKph: null,
          },
        ]
      : [],
  });
  if (input.shiftId)
    await RosterShift.updateOne(
      { _id: input.shiftId, status: "Planned" },
      { $set: { status: "Confirmed" } }
    );
  await logActivity({
    actor: ctx.actor,
    action: "tracking.started",
    entityType: "tracking",
    entityId: String(created._id),
    summary: `started live tracking${shift ? ` for ${shift.type}` : ""}`,
    ip: ctx.ip,
  });
  return trackingDTO(created.toObject<TrackingSessionDoc>());
}

/** Halves the resolution of a very long trail while keeping the first and last fixes. */
function thin(points: TrackingSessionDoc["points"]) {
  const kept = points.filter((_point, index) => index % 2 === 1);
  const last = points[points.length - 1];
  if (last && kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/**
 * Appends a batch of location fixes. Distances are recomputed here from the raw points:
 * jitter is dropped and impossible jumps are clamped, so a bad GPS fix can never inflate
 * the kilometres that end up on a service record or a KM logbook entry.
 */
export async function addPings(
  staffId: string,
  sessionId: string,
  input: z.output<typeof trackingPingSchema>
): Promise<TrackingSessionDTO & { nextIntervalSec: number }> {
  const session = await TrackingSession.findOne({
    _id: sessionId,
    staffId,
  }).lean<TrackingSessionDoc>();
  if (!session) throw errors.notFound("Tracking session");
  if (session.status === "Ended")
    throw errors.invalidState(MESSAGES.trackingNotRunning);

  const trail: GeoPoint[] = session.points.map(point => ({
    lat: point.lat,
    lng: point.lng,
  }));
  const stored = [...session.points];
  let distance = session.distanceMetres;
  let previousAt = session.lastPingAt?.getTime() ?? session.startedAt.getTime();
  let speed = session.currentSpeedKph;
  for (const ping of input.pings) {
    const at = ping.at ? new Date(ping.at) : new Date();
    const point: GeoPoint = { lat: ping.lat, lng: ping.lng };
    const last = trail[trail.length - 1];
    const moved = last ? distanceMeters(last, point) : 0;
    const seconds = Math.max(1, (at.getTime() - previousAt) / 1000);
    const gpsSpeed = ping.speedKph ?? moved / 1000 / (seconds / 3600);
    const next = appendTrailPoint(trail, point, {
      minMoveM: TRACKING_MIN_MOVE_M,
      maxSpeedKph: 160,
      sinceMs: seconds * 1000,
    });
    if (next.length === trail.length && trail.length) {
      // Stationary drift: keep the newest speed reading so the map still feels alive.
      speed = Math.min(gpsSpeed, TRACKING_STATIONARY_KPH);
      continue;
    }
    trail.push(point);
    stored.push({
      at,
      lat: point.lat,
      lng: point.lng,
      accuracy: ping.accuracy ?? null,
      speedKph: Math.round(gpsSpeed * 10) / 10,
    });
    distance += moved;
    speed = gpsSpeed;
    previousAt = at.getTime();
  }
  const lastPoint = stored[stored.length - 1] ?? null;
  const update: Record<string, unknown> = {
    distanceMetres: Math.round(distance),
    currentSpeedKph: speed === null ? null : Math.round(speed * 10) / 10,
    lastPingAt: new Date(),
    points: stored.length > MAX_POINTS ? thin(stored) : stored,
  };
  if (lastPoint)
    update.lastLocation = { lat: lastPoint.lat, lng: lastPoint.lng };
  const updated = await TrackingSession.findOneAndUpdate(
    { _id: sessionId, status: { $ne: "Ended" } },
    { $set: update },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.invalidState(MESSAGES.trackingNotRunning);
  const dto = await trackingDTO(updated as TrackingSessionDoc);
  return {
    ...dto,
    nextIntervalSec: dto.stationary
      ? TRACKING_INTERVALS.idleSec
      : TRACKING_INTERVALS.movingSec,
  };
}

/**
 * Writes the distance a finished job measured into the worker's KM logbook, so the
 * kilometres they can claim are the ones actually travelled. Called once per session:
 * the trackingId keeps a repeated stop from logging the same trip twice, and a job that
 * never moved (or was ended straight away) leaves no entry at all.
 */
async function recordTrackedKilometres(
  session: TrackingSessionDoc
): Promise<void> {
  const kilometres = toKilometres(session.distanceMetres);
  if (kilometres <= 0) return;
  if (await LogbookEntry.exists({ trackingId: session._id })) return;
  const shift = session.shiftId
    ? await RosterShift.findById(session.shiftId).lean<RosterShiftDoc>()
    : null;
  await LogbookEntry.create({
    staffId: session.staffId,
    participantId: session.participantIds?.[0] ?? null,
    shiftId: session.shiftId ?? null,
    trackingId: session._id,
    date: shift?.date ?? (await workspaceToday()),
    type: "Kilometres",
    fromLocation: shift?.location ?? "",
    toLocation: "",
    purpose: shift?.type ?? "Tracked job",
    kilometres,
    notes: "Measured by live tracking.",
  });
}

export async function stopTracking(
  staffId: string,
  sessionId: string,
  input: z.output<typeof trackingStopSchema>,
  ctx: RequestContext
): Promise<TrackingSessionDTO> {
  const session = await TrackingSession.findOne({
    _id: sessionId,
    staffId,
  }).lean<TrackingSessionDoc>();
  if (!session) throw errors.notFound("Tracking session");
  if (session.status === "Ended") return trackingDTO(session);
  const now = new Date();
  const update: Record<string, unknown> = {
    status: "Ended",
    endedAt: now,
    stoppedBy: ctx.actor,
    notes: input.notes ?? session.notes ?? "",
    currentSpeedKph: null,
    durationMinutes: Math.max(
      0,
      Math.round((now.getTime() - session.startedAt.getTime()) / 60_000)
    ),
  };
  if (input.location) {
    update.lastLocation = input.location;
    update.points = [
      ...session.points,
      {
        at: now,
        lat: input.location.lat,
        lng: input.location.lng,
        accuracy: null,
        speedKph: null,
      },
    ];
  }
  const updated = await TrackingSession.findOneAndUpdate(
    { _id: sessionId, status: { $ne: "Ended" } },
    { $set: update },
    { returnDocument: "after", lean: true }
  );
  const finished = (updated ?? session) as TrackingSessionDoc;
  await recordTrackedKilometres(finished);
  await logActivity({
    actor: ctx.actor,
    action: "tracking.ended",
    entityType: "tracking",
    entityId: sessionId,
    summary: `finished a tracked job (${toKilometres(session.distanceMetres)} km)`,
    ip: ctx.ip,
  });
  return trackingDTO(finished);
}
