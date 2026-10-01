import { model, Schema, type Types } from "mongoose";
import {
  CHECKLIST_ITEM_STATUSES,
  type ChecklistItemStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface EmergencyContactSub {
  _id: Types.ObjectId;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  primary: boolean;
}

export interface ChecklistItemSub {
  key: string;
  status: ChecklistItemStatus;
  /** YYYY-MM-DD as printed on the document. */
  expiry: string | null;
  documentId: Types.ObjectId | null;
  reviewedAt: Date | null;
  reviewedBy: ActorRefSub | null;
  reviewNote: string;
}

/**
 * Everything the worker (and their KYC) adds on top of the plain directory entry:
 * next of kin, emergency contacts, transport details and the DSW checklist state.
 */
export interface StaffProfileDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  dateOfBirth: string | null;
  startDate: string | null;
  address: string;
  about: string;
  medicalNotes: string;
  nextOfKin: {
    name: string;
    relationship: string;
    phone: string;
    email: string;
    address: string;
  };
  emergencyContacts: EmergencyContactSub[];
  transport: {
    hasVehicle: boolean;
    licenceNumber: string;
    vehicle: string;
    registration: string;
  };
  checklist: ChecklistItemSub[];
  createdAt: Date;
  updatedAt: Date;
}

const emergencyContactSchema = new Schema<EmergencyContactSub>(
  {
    name: { type: String, required: true, trim: true },
    relationship: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    primary: { type: Boolean, default: false },
  },
  { _id: true }
);

const checklistItemSchema = new Schema<ChecklistItemSub>(
  {
    key: { type: String, required: true },
    status: {
      type: String,
      enum: CHECKLIST_ITEM_STATUSES,
      default: "Not started",
    },
    expiry: { type: String, default: null },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "StaffDocument",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: actorSchema, default: null },
    reviewNote: { type: String, default: "" },
  },
  { _id: false }
);

const staffProfileSchema = new Schema<StaffProfileDoc>(
  {
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      unique: true,
    },
    dateOfBirth: { type: String, default: null },
    startDate: { type: String, default: null },
    address: { type: String, default: "" },
    about: { type: String, default: "" },
    medicalNotes: { type: String, default: "" },
    nextOfKin: {
      name: { type: String, default: "" },
      relationship: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
    },
    emergencyContacts: { type: [emergencyContactSchema], default: [] },
    transport: {
      hasVehicle: { type: Boolean, default: false },
      licenceNumber: { type: String, default: "" },
      vehicle: { type: String, default: "" },
      registration: { type: String, default: "" },
    },
    checklist: { type: [checklistItemSchema], default: [] },
  },
  baseOptions
);
staffProfileSchema.index({ "checklist.expiry": 1 });

export const StaffProfile = model<StaffProfileDoc>(
  "StaffProfile",
  staffProfileSchema,
  "staff_profiles"
);
