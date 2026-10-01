import { model, Schema, type Types } from "mongoose";
import {
  ABC_BEHAVIOURS,
  REPORT_STATUSES,
  type AbcBehaviour,
  type ReportStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

/** ABC (Antecedent / Behaviour / Consequence) behaviour-support recording. */
export interface AbcReportDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  participantId: Types.ObjectId | null;
  shiftId: string | null;
  date: string;
  time: string;
  location: string;
  behaviour: AbcBehaviour;
  intensity: number;
  durationMinutes: number;
  antecedent: string;
  behaviourDescription: string;
  consequence: string;
  staffResponse: string;
  outcome: string;
  preventionPlan: string;
  status: ReportStatus;
  reviewNote: string;
  reviewedBy: ActorRefSub | null;
  reviewedAt: Date | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const abcReportSchema = new Schema<AbcReportDoc>(
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
    behaviour: { type: String, enum: ABC_BEHAVIOURS, required: true },
    intensity: { type: Number, min: 1, max: 5, default: 3 },
    durationMinutes: { type: Number, min: 0, default: 0 },
    antecedent: { type: String, required: true },
    behaviourDescription: { type: String, required: true },
    consequence: { type: String, required: true },
    staffResponse: { type: String, default: "" },
    outcome: { type: String, default: "" },
    preventionPlan: { type: String, default: "" },
    status: { type: String, enum: REPORT_STATUSES, default: "Draft" },
    reviewNote: { type: String, default: "" },
    reviewedBy: { type: actorSchema, default: null },
    reviewedAt: { type: Date, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
abcReportSchema.index({ staffId: 1, date: -1 });
abcReportSchema.index({ participantId: 1, date: -1 });

export const AbcReport = model<AbcReportDoc>(
  "AbcReport",
  abcReportSchema,
  "abc_reports"
);
