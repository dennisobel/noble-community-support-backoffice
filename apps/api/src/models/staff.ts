import { model, Schema, type Types } from "mongoose";
import { STAFF_STATUSES, type StaffStatus } from "@shared/enums";
import { baseOptions } from "./common";

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
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
staffSchema.index({ email: 1 }, { unique: true });
staffSchema.index({ status: 1, name: 1 });

export const Staff = model<StaffDoc>("Staff", staffSchema, "staff");
