import { model, Schema, type Types } from "mongoose";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  REPORT_STATUSES,
  type IncidentCategory,
  type IncidentSeverity,
  type ReportStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface IncidentReportDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  participantId: Types.ObjectId | null;
  shiftId: string | null;
  date: string;
  time: string;
  location: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  description: string;
  injuries: string;
  medicalAttention: boolean;
  medicalDetails: string;
  witness: string;
  immediateActions: string;
  notified: string[];
  followUp: string;
  reportedBy: ActorRefSub | null;
  status: ReportStatus;
  reviewNote: string;
  reviewedBy: ActorRefSub | null;
  reviewedAt: Date | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const incidentReportSchema = new Schema<IncidentReportDoc>(
  {
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    shiftId: { type: String, default: null },
    date: { type: String, required: true },
    time: { type: String, required: true },
    location: { type: String, default: "" },
    category: { type: String, enum: INCIDENT_CATEGORIES, required: true },
    severity: {
      type: String,
      enum: INCIDENT_SEVERITIES,
      default: "Minor",
    },
    description: { type: String, required: true },
    injuries: { type: String, default: "" },
    medicalAttention: { type: Boolean, default: false },
    medicalDetails: { type: String, default: "" },
    witness: { type: String, default: "" },
    immediateActions: { type: String, default: "" },
    notified: { type: [String], default: [] },
    followUp: { type: String, default: "" },
    reportedBy: { type: actorSchema, default: null },
    status: { type: String, enum: REPORT_STATUSES, default: "Draft" },
    reviewNote: { type: String, default: "" },
    reviewedBy: { type: actorSchema, default: null },
    reviewedAt: { type: Date, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
incidentReportSchema.index({ staffId: 1, date: -1 });
incidentReportSchema.index({ status: 1, date: -1 });

export const IncidentReport = model<IncidentReportDoc>(
  "IncidentReport",
  incidentReportSchema,
  "incident_reports"
);
