import { model, Schema, type Types } from "mongoose";
import { actorSchema, type ActorRefSub } from "./common";

/* Counters for human-readable business ids (SR-1049, INV-2026-092, VN-029, SH-2406, Client 006). */

export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  { _id: { type: String, required: true }, seq: { type: Number, default: 0 } },
  { versionKey: false }
);

export const Counter = model<CounterDoc>("Counter", counterSchema, "counters");

/* Append-only audit log. */

export interface ActivityDoc {
  _id: Types.ObjectId;
  at: Date;
  actor: ActorRefSub | null;
  action: string;
  entityType: string;
  entityId: string;
  participantId: Types.ObjectId | null;
  summary: string;
  meta: Record<string, unknown> | null;
  ip: string;
}

const activitySchema = new Schema<ActivityDoc>(
  {
    at: { type: Date, required: true },
    actor: { type: actorSchema, default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    summary: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: "" },
  },
  { versionKey: false }
);
activitySchema.index({ at: -1 });
activitySchema.index({ entityType: 1, entityId: 1, at: -1 });
activitySchema.index({ participantId: 1, at: -1 });

export const Activity = model<ActivityDoc>(
  "Activity",
  activitySchema,
  "activity_logs"
);

/* Background jobs (transcription, draft generation, document expiry reminders). */

export type JobType =
  | "transcribe"
  | "generate-draft"
  | "expiry-alerts"
  | "staff-invite";

export interface JobDoc {
  _id: Types.ObjectId;
  type: JobType;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobDoc>(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["queued", "running", "done", "failed"],
      default: "queued",
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    runAt: { type: Date, required: true },
    lockedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    partialFilterExpression: { status: "done" },
  }
);

export const Job = model<JobDoc>("Job", jobSchema, "jobs");
