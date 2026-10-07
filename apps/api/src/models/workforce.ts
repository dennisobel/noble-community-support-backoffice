import { model, Schema, type Types } from "mongoose";
import {
  AVAILABILITY_MODES,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  type AvailabilityMode,
  type LeaveStatus,
  type LeaveType,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

/* The days and hours a worker has said they can be rostered, one row per day of the week. */

export interface AvailabilityDaySub {
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  mode: AvailabilityMode;
  from: string;
  to: string;
}

export interface StaffAvailabilityDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  days: AvailabilityDaySub[];
  note: string;
  updatedBy: ActorRefSub | null;
  createdAt: Date;
  updatedAt: Date;
}

const availabilitySchema = new Schema<StaffAvailabilityDoc>(
  {
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      unique: true,
    },
    days: [
      {
        _id: false,
        day: { type: Number, required: true, min: 0, max: 6 },
        mode: { type: String, enum: AVAILABILITY_MODES, default: "Any time" },
        from: { type: String, default: "" },
        to: { type: String, default: "" },
      },
    ],
    note: { type: String, default: "" },
    updatedBy: { type: actorSchema, default: null },
  },
  baseOptions
);

export const StaffAvailability = model<StaffAvailabilityDoc>(
  "StaffAvailability",
  availabilitySchema,
  "staff_availability"
);

/* Leave and other time off: asked for by the worker (or recorded by the office) and decided by the office. */

export interface LeaveRequestDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  type: LeaveType;
  from: string;
  to: string;
  /** Set when the time off is only part of one day. */
  startTime: string | null;
  endTime: string | null;
  /** Paid hours asked for; 0 for unpaid time off. */
  hours: number;
  reason: string;
  status: LeaveStatus;
  requestedBy: ActorRefSub | null;
  decidedBy: ActorRefSub | null;
  decidedAt: Date | null;
  decisionNote: string;
  /** The finalised pay run that paid these hours, so they are never paid twice. */
  payRunId: string | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const leaveRequestSchema = new Schema<LeaveRequestDoc>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
    type: { type: String, enum: LEAVE_TYPES, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    hours: { type: Number, default: 0, min: 0 },
    reason: { type: String, default: "" },
    status: { type: String, enum: LEAVE_STATUSES, default: "Pending" },
    requestedBy: { type: actorSchema, default: null },
    decidedBy: { type: actorSchema, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "" },
    payRunId: { type: String, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
leaveRequestSchema.index({ staffId: 1, from: 1 });
leaveRequestSchema.index({ status: 1, from: 1 });
leaveRequestSchema.index({ from: 1, to: 1 });

export const LeaveRequest = model<LeaveRequestDoc>(
  "LeaveRequest",
  leaveRequestSchema,
  "leave_requests"
);
