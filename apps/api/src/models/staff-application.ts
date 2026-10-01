import { model, Schema, type Types } from "mongoose";
import {
  STAFF_APPLICATION_STATUSES,
  type StaffApplicationStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

/** A worker who signed up themselves and is waiting for an Admin to approve access. */
export interface StaffApplicationDoc {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  position: string;
  team: string;
  suburb: string;
  experience: string;
  message: string;
  status: StaffApplicationStatus;
  reviewedAt: Date | null;
  reviewedBy: ActorRefSub | null;
  reviewNote: string;
  staffId: Types.ObjectId | null;
  userId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const staffApplicationSchema = new Schema<StaffApplicationDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: "" },
    position: { type: String, default: "" },
    team: { type: String, default: "" },
    suburb: { type: String, default: "" },
    experience: { type: String, default: "" },
    message: { type: String, default: "" },
    status: {
      type: String,
      enum: STAFF_APPLICATION_STATUSES,
      default: "Pending",
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: actorSchema, default: null },
    reviewNote: { type: String, default: "" },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  baseOptions
);
staffApplicationSchema.index({ status: 1, createdAt: -1 });
staffApplicationSchema.index({ email: 1, status: 1 });

export const StaffApplication = model<StaffApplicationDoc>(
  "StaffApplication",
  staffApplicationSchema,
  "staff_applications"
);
