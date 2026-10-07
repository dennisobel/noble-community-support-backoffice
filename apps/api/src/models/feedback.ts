import { model, Schema, type Types } from "mongoose";
import {
  FEEDBACK_AREAS,
  FEEDBACK_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_RELATIONSHIPS,
  FEEDBACK_SATISFACTION,
  FEEDBACK_STATUSES,
  type FeedbackArea,
  type FeedbackChannel,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackRelationship,
  type FeedbackSatisfaction,
  type FeedbackStatus,
} from "@shared/enums";
import {
  actorSchema,
  baseOptions,
  historySchema,
  type ActorRefSub,
  type HistorySub,
} from "./common";

/* A complaint, compliment or suggestion, from the day it arrives to the day it is closed. */

export interface FeedbackActionSub {
  _id: Types.ObjectId;
  description: string;
  owner: string;
  due: string | null;
  doneAt: Date | null;
  doneBy: ActorRefSub | null;
}

export interface FeedbackCaseDoc {
  /** FB-0001 */
  _id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  area: FeedbackArea;
  channel: FeedbackChannel;
  summary: string;
  details: string;
  desiredOutcome: string;
  /** Who or what it is about, as the public form's sender put it. */
  aboutText: string;
  raisedBy: {
    name: string;
    relationship: FeedbackRelationship;
    phone: string;
    email: string;
    anonymous: boolean;
    wantsContact: boolean;
  };
  participantId: Types.ObjectId | null;
  staffId: Types.ObjectId | null;
  incidentId: Types.ObjectId | null;
  owner: ActorRefSub | null;
  receivedOn: string;
  acknowledgeBy: string;
  resolveBy: string;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  outcome: string;
  satisfaction: FeedbackSatisfaction;
  improvementNeeded: boolean;
  improvement: string;
  actions: FeedbackActionSub[];
  history: HistorySub[];
  viaPublicForm: boolean;
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const feedbackCaseSchema = new Schema<FeedbackCaseDoc>(
  {
    _id: { type: String, required: true },
    kind: { type: String, enum: FEEDBACK_KINDS, required: true },
    status: { type: String, enum: FEEDBACK_STATUSES, default: "New" },
    priority: { type: String, enum: FEEDBACK_PRIORITIES, default: "Medium" },
    area: { type: String, enum: FEEDBACK_AREAS, default: "Service delivery" },
    channel: { type: String, enum: FEEDBACK_CHANNELS, default: "Phone" },
    summary: { type: String, required: true, trim: true },
    details: { type: String, required: true },
    desiredOutcome: { type: String, default: "" },
    aboutText: { type: String, default: "" },
    raisedBy: {
      name: { type: String, default: "" },
      relationship: {
        type: String,
        enum: FEEDBACK_RELATIONSHIPS,
        default: "Participant",
      },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      anonymous: { type: Boolean, default: false },
      wantsContact: { type: Boolean, default: true },
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: "IncidentReport",
      default: null,
    },
    owner: { type: actorSchema, default: null },
    receivedOn: { type: String, required: true },
    acknowledgeBy: { type: String, required: true },
    resolveBy: { type: String, required: true },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    outcome: { type: String, default: "" },
    satisfaction: {
      type: String,
      enum: FEEDBACK_SATISFACTION,
      default: "Not asked",
    },
    improvementNeeded: { type: Boolean, default: false },
    improvement: { type: String, default: "" },
    actions: [
      {
        description: { type: String, required: true },
        owner: { type: String, default: "" },
        due: { type: String, default: null },
        doneAt: { type: Date, default: null },
        doneBy: { type: actorSchema, default: null },
      },
    ],
    history: { type: [historySchema], default: [] },
    viaPublicForm: { type: Boolean, default: false },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
feedbackCaseSchema.index({ status: 1, receivedOn: -1 });
feedbackCaseSchema.index({ participantId: 1, receivedOn: -1 });

export const FeedbackCase = model<FeedbackCaseDoc>(
  "FeedbackCase",
  feedbackCaseSchema,
  "feedback_cases"
);
