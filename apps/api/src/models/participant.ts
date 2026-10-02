import { model, Schema, type Types } from "mongoose";
import {
  PARTICIPANT_STATUSES,
  type Kyc,
  type ParticipantStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface ParticipantDoc {
  _id: Types.ObjectId;
  clientNumber: number;
  name: string;
  preferred: string;
  ndis: string;
  dob: string | null;
  phone: string;
  email: string;
  address: string;
  planStart: string | null;
  planEnd: string | null;
  manager: string;
  managerEmail: string;
  nominee: string;
  coordinatorName: string;
  coordinatorOrg: string;
  coordinatorPhone: string;
  coordinatorEmail: string;
  emergencyName: string;
  emergencyPhone: string;
  alerts: string[];
  goals: string[];
  communication: string;
  mobility: string;
  transport: string;
  support: string;
  risks: string;
  allergies: string;
  preferences: string;
  kyc: Kyc;
  status: ParticipantStatus;
  archivedAt: Date | null;
  archivedReason: string;
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<ParticipantDoc>(
  {
    clientNumber: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    preferred: { type: String, required: true, trim: true },
    ndis: { type: String, required: true, unique: true },
    dob: { type: String, default: null },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    planStart: { type: String, default: null },
    planEnd: { type: String, default: null },
    manager: { type: String, default: "" },
    managerEmail: { type: String, default: "" },
    nominee: { type: String, default: "" },
    coordinatorName: { type: String, default: "" },
    coordinatorOrg: { type: String, default: "" },
    coordinatorPhone: { type: String, default: "" },
    coordinatorEmail: { type: String, default: "" },
    emergencyName: { type: String, default: "" },
    emergencyPhone: { type: String, default: "" },
    alerts: { type: [String], default: [] },
    goals: { type: [String], default: [] },
    communication: { type: String, default: "" },
    mobility: { type: String, default: "" },
    transport: { type: String, default: "" },
    support: { type: String, default: "" },
    risks: { type: String, default: "" },
    allergies: { type: String, default: "" },
    preferences: { type: String, default: "" },
    kyc: {
      serviceAgreement: { type: Boolean, default: false },
      consentForms: { type: Boolean, default: false },
      supportPlan: { type: Boolean, default: false },
      riskInformationReviewed: { type: Boolean, default: false },
      transportRequirementsConfirmed: { type: Boolean, default: false },
    },
    status: { type: String, enum: PARTICIPANT_STATUSES, default: "Active" },
    archivedAt: { type: Date, default: null },
    archivedReason: { type: String, default: "" },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
participantSchema.index({ status: 1, name: 1 });

export const Participant = model<ParticipantDoc>(
  "Participant",
  participantSchema,
  "participants"
);
