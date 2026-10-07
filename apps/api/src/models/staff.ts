import { model, Schema, type Types } from "mongoose";
import {
  EMPLOYMENT_TYPES,
  STAFF_STATUSES,
  type EmploymentType,
  type StaffStatus,
} from "@shared/enums";
import { baseOptions } from "./common";

/** How someone is employed. The office keeps this; it decides which award rules apply to their pay. */
export interface StaffEmploymentSub {
  /** Full-time, part-time or casual. Named `kind` because Mongoose reserves `type` inside a schema. */
  kind: EmploymentType | null;
  /** An entry in the Pay rules classification list. */
  classificationId: string | null;
  /** Hours a week they are engaged for. */
  contractedHours: number;
  /** Their employee number in the payroll system. */
  payrollId: string;
  /** A rate agreed with this person that replaces the classification's, in cents. */
  payRateOverrideCents: number | null;
}

export interface StaffDoc {
  _id: Types.ObjectId;
  name: string;
  position: string;
  team: string;
  email: string;
  phone: string;
  status: StaffStatus;
  notes: string;
  userId: Types.ObjectId | null;
  /** True while the worker transports participants, which makes the vehicle checks mandatory. */
  transportsParticipants: boolean;
  employment?: StaffEmploymentSub;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const staffSchema = new Schema<StaffDoc>(
  {
    name: { type: String, required: true, trim: true },
    position: { type: String, required: true, trim: true },
    team: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: "" },
    status: { type: String, enum: STAFF_STATUSES, default: "Active" },
    notes: { type: String, default: "" },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    transportsParticipants: { type: Boolean, default: false },
    employment: {
      kind: { type: String, enum: [...EMPLOYMENT_TYPES, null], default: null },
      classificationId: { type: String, default: null },
      contractedHours: { type: Number, default: 0, min: 0 },
      payrollId: { type: String, default: "" },
      payRateOverrideCents: { type: Number, default: null },
    },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
staffSchema.index({ email: 1 }, { unique: true });
staffSchema.index({ status: 1, name: 1 });

export const Staff = model<StaffDoc>("Staff", staffSchema, "staff");
