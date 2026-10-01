import type { LiveTrackingDTO } from "@shared/dto";
import type { z } from "zod";
import type { liveTrackingQuery } from "@shared/schemas/staff-portal";
import { trackingDTO } from "../portal/tracking";
import { TrackingSession, type TrackingSessionDoc } from "../../models";

/**
 * The live-tracking dashboard: every running session, plus the recently finished ones
 * that teach the office what the day looked like. The client polls this endpoint; the
 * list responses carry a downsampled trail so polling stays cheap.
 */
export async function liveTracking(
  query: z.output<typeof liveTrackingQuery>
): Promise<LiveTrackingDTO> {
  const now = Date.now();
  const [active, recent] = await Promise.all([
    TrackingSession.find({ status: { $ne: "Ended" } })
      .sort({ startedAt: -1 })
      .lean<TrackingSessionDoc[]>(),
    TrackingSession.find({
      status: "Ended",
      endedAt: { $gte: new Date(now - query.historyHours * 3_600_000) },
    })
      .sort({ endedAt: -1 })
      .limit(30)
      .lean<TrackingSessionDoc[]>(),
  ]);
  const toDTO = async (session: TrackingSessionDoc) =>
    downsample(await trackingDTO(session, now));
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const daySessions = await TrackingSession.find({
    startedAt: { $gte: todayStart },
  }).lean<TrackingSessionDoc[]>();
  return {
    generatedAt: new Date(now).toISOString(),
    active: await Promise.all(active.map(session => toDTO(session))),
    recent: await Promise.all(recent.map(session => toDTO(session))),
    totals: {
      activeCount: active.length,
      kilometresToday:
        Math.round(
          daySessions.reduce(
            (total, session) => total + (session.distanceMetres ?? 0),
            0
          ) / 100
        ) / 10,
      sessionsToday: daySessions.length,
    },
  };
}

/** List responses carry a lighter trail; the full trail loads on demand. */
function downsample(session: import("@shared/dto").TrackingSessionDTO) {
  if (session.trail.length <= 120) return session;
  const step = Math.ceil(session.trail.length / 120);
  const trail = session.trail.filter((_point, index) => index % step === 0);
  const last = session.trail[session.trail.length - 1];
  if (last && trail[trail.length - 1] !== last) trail.push(last);
  return { ...session, trail };
}

export async function getTrackingSession(id: string) {
  const session = await TrackingSession.findById(id).lean<TrackingSessionDoc>();
  if (!session) throw new Error("Tracking session not found.");
  return trackingDTO(session);
}
