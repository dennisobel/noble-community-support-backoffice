import { model, Schema, type Types } from "mongoose";
import {
  AMENDMENT_REQUEST_STATUSES,
  RECORD_STATUSES,
  SERVICE_UNITS,
  type AmendmentRequestStatus,
  type RecordStatus,
  type ServiceUnit,
} from "@shared/enums";
import {
  actorSchema,
  baseOptions,
  billableSchema,
  historySchema,
  type ActorRefSub,
  type BillableSub,
  type HistorySub,
} from "./common";

export interface NoteChangeSub {
  field: string;
  label: string;
  before: string;
  after: string;
}

/** A correction to a submitted note. The note itself holds the corrected text; this keeps what it replaced. */
export interface NoteAmendmentSub {
  id: string;
  at: Date;
  by: ActorRefSub | null;
  reason: string;
  requestId: string | null;
  changes: NoteChangeSub[];
}

export interface NoteAmendmentRequestSub {
  id: string;
  at: Date;
  by: ActorRefSub | null;
  reason: string;
  status: AmendmentRequestStatus;
  resolvedAt: Date | null;
  resolvedBy: ActorRefSub | null;
  resolution: string;
}

export interface ServiceRecordDoc {
  _id: string;
  clientId: Types.ObjectId;
  staffId: Types.ObjectId;
  serviceId: Types.ObjectId;
  shiftId: string | null;
  voiceNoteId: string | null;
  invoiceId: string | null;
  type: string;
  budgetCategory: string;
  unit: ServiceUnit;
  date: string;
  start: string;
  end: string;
  location: string;
  km: number;
  quantity: number | null;
  /** The progress note: what was ticked, and the details written beside it. */
  supportTypes: string[];
  support: string;
  summary: string;
  goals: string[];
  outcome: string;
  achievements: string;
  health: string[];
  healthDetails: string;
  incident: string[];
  incidentDetails: string;
  followUp: string;
  /** Where the shift summary lived before it was one box. Read through `summary`, never written now. */
  response: string;
  observations: string;
  amendments: NoteAmendmentSub[];
  amendmentRequests: NoteAmendmentRequestSub[];
  confirmed: boolean;
  confirmedAt: Date | null;
  billables: BillableSub[];
  totalCents: number;
  billablesFrozenAt: Date | null;
  status: RecordStatus;
  correction: string;
  submittedAt: Date | null;
  submittedBy: ActorRefSub | null;
  reviewedAt: Date | null;
  reviewedBy: ActorRefSub | null;
  approvedBy: ActorRefSub | null;
  returnedAt: Date | null;
  history: HistorySub[];
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const amendmentSchema = new Schema<NoteAmendmentSub>(
  {
    id: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: actorSchema, default: null },
    reason: { type: String, required: true },
    requestId: { type: String, default: null },
    changes: {
      type: [
        new Schema<NoteChangeSub>(
          {
            field: { type: String, required: true },
            label: { type: String, required: true },
            before: { type: String, default: "" },
            after: { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

const amendmentRequestSchema = new Schema<NoteAmendmentRequestSub>(
  {
    id: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: actorSchema, default: null },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: AMENDMENT_REQUEST_STATUSES,
      default: "Open",
    },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: actorSchema, default: null },
    resolution: { type: String, default: "" },
  },
  { _id: false }
);

const serviceRecordSchema = new Schema<ServiceRecordDoc>(
  {
    _id: { type: String, required: true },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      required: true,
    },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    shiftId: { type: String, default: null },
    voiceNoteId: { type: String, default: null },
    invoiceId: { type: String, default: null },
    type: { type: String, required: true },
    budgetCategory: { type: String, required: true },
    unit: { type: String, enum: SERVICE_UNITS, required: true },
    date: { type: String, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    location: { type: String, default: "" },
    km: { type: Number, default: 0 },
    quantity: { type: Number, default: null },
    supportTypes: { type: [String], default: [] },
    support: { type: String, default: "" },
    summary: { type: String, default: "" },
    goals: { type: [String], default: [] },
    outcome: { type: String, default: "" },
    achievements: { type: String, default: "" },
    health: { type: [String], default: [] },
    healthDetails: { type: String, default: "" },
    incident: { type: [String], default: [] },
    incidentDetails: { type: String, default: "" },
    followUp: { type: String, default: "" },
    response: { type: String, default: "" },
    observations: { type: String, default: "" },
    amendments: { type: [amendmentSchema], default: [] },
    amendmentRequests: { type: [amendmentRequestSchema], default: [] },
    confirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },
    billables: { type: [billableSchema], default: [] },
    totalCents: { type: Number, default: 0 },
    billablesFrozenAt: { type: Date, default: null },
    status: { type: String, enum: RECORD_STATUSES, default: "Draft" },
    correction: { type: String, default: "" },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: actorSchema, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: actorSchema, default: null },
    approvedBy: { type: actorSchema, default: null },
    returnedAt: { type: Date, default: null },
    history: { type: [historySchema], default: [] },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
serviceRecordSchema.index({ clientId: 1, date: -1 });
serviceRecordSchema.index({ status: 1, date: -1 });
serviceRecordSchema.index({ staffId: 1, date: -1 });
serviceRecordSchema.index({ invoiceId: 1 });
serviceRecordSchema.index({ date: -1 });
serviceRecordSchema.index({ shiftId: 1 });

export const ServiceRecord = model<ServiceRecordDoc>(
  "ServiceRecord",
  serviceRecordSchema,
  "service_records"
);
