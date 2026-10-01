import { model, Schema, type Types } from "mongoose";
import { TRACKING_STATUSES, type TrackingStatus } from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface TrackingPointSub {
  at: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  speedKph: number | null;
}

/**
 * One live-tracking run. Created when the worker taps "Start job" on a shift and closed
 * when they finish; the trail is what the back-office dashboard draws on the Mapbox map
 * and what the KM logbook reads its distance from. Distances are always computed on the
 * server from the raw points, so a client can never claim kilometres it did not travel.
 */
export interface TrackingSessionDoc {
  _id: Types.ObjectId;
  shiftId: string | null;
  staffId: Types.ObjectId;
  participantIds: Types.ObjectId[];
  status: TrackingStatus;
  startedAt: Date;
  endedAt: Date | null;
  lastPingAt: Date | null;
  durationMinutes: number;
  distanceMetres: number;
  currentSpeedKph: number | null;
  startLocation: { lat: number; lng: number } | null;
  lastLocation: { lat: number; lng: number } | null;
  points: TrackingPointSub[];
  notes: string;
  stoppedBy: ActorRefSub | null;
  createdAt: Date;
  updatedAt: Date;
}

const pointSchema = new Schema<TrackingPointSub>(
  {
    at: { type: Date, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    speedKph: { type: Number, default: null },
  },
  { _id: false }
);

const trackingSessionSchema = new Schema<TrackingSessionDoc>(
  {
    shiftId: { type: String, default: null },
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true,
    },
    participantIds: [{ type: Schema.Types.ObjectId, ref: "Participant" }],
    status: { type: String, enum: TRACKING_STATUSES, default: "Active" },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    lastPingAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: 0 },
    distanceMetres: { type: Number, default: 0 },
    currentSpeedKph: { type: Number, default: null },
    startLocation: {
      type: new Schema<{ lat: number; lng: number }>(
        { lat: Number, lng: Number },
        { _id: false }
      ),
      default: null,
    },
    lastLocation: {
      type: new Schema<{ lat: number; lng: number }>(
        { lat: Number, lng: Number },
        { _id: false }
      ),
      default: null,
    },
    points: { type: [pointSchema], default: [] },
    notes: { type: String, default: "" },
    stoppedBy: { type: actorSchema, default: null },
  },
  baseOptions
);
trackingSessionSchema.index({ status: 1, lastPingAt: -1 });
trackingSessionSchema.index({ staffId: 1, startedAt: -1 });
trackingSessionSchema.index({ shiftId: 1 });

export const TrackingSession = model<TrackingSessionDoc>(
  "TrackingSession",
  trackingSessionSchema,
  "tracking_sessions"
);
