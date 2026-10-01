import { model, Schema, type Types } from "mongoose";
import {
  SHIFT_RATIOS,
  SHIFT_STATUSES,
  type ShiftRatio,
  type ShiftStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface ShiftTimesheetSub {
  staffId: Types.ObjectId;
  /** Actual sign-on / sign-off written by the worker from the portal. */
  startedAt: Date | null;
  endedAt: Date | null;
  breakMinutes: number;
  kilometres: number;
  notes: string;
}

export interface RosterShiftDoc {
  _id: string;
  date: string;
  start: string;
  end: string;
  ratio: ShiftRatio;
  clientIds: Types.ObjectId[];
  staffIds: Types.ObjectId[];
  serviceId: Types.ObjectId;
  type: string;
  location: string;
  notes: string;
  status: ShiftStatus;
  recordIds: string[];
  timesheets: ShiftTimesheetSub[];
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const timesheetSchema = new Schema<ShiftTimesheetSub>(
  {
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    breakMinutes: { type: Number, default: 0, min: 0 },
    kilometres: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const rosterShiftSchema = new Schema<RosterShiftDoc>(
  {
    _id: { type: String, required: true },
    date: { type: String, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    ratio: { type: String, enum: SHIFT_RATIOS, required: true },
    clientIds: [{ type: Schema.Types.ObjectId, ref: "Participant" }],
    staffIds: [{ type: Schema.Types.ObjectId, ref: "Staff" }],
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    type: { type: String, required: true },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: { type: String, enum: SHIFT_STATUSES, default: "Planned" },
    recordIds: { type: [String], default: [] },
    timesheets: { type: [timesheetSchema], default: [] },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
rosterShiftSchema.index({ date: 1, status: 1 });
rosterShiftSchema.index({ clientIds: 1, date: 1 });
rosterShiftSchema.index({ staffIds: 1, date: 1 });

export const RosterShift = model<RosterShiftDoc>(
  "RosterShift",
  rosterShiftSchema,
  "roster_shifts"
);
