import { model, Schema, type Types } from "mongoose";
import {
  RECORD_STATUSES,
  SERVICE_UNITS,
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
  support: string;
  response: string;
  outcome: string;
  observations: string;
  followUp: string;
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
    support: { type: String, default: "" },
    response: { type: String, default: "" },
    outcome: { type: String, default: "" },
    observations: { type: String, default: "" },
    followUp: { type: String, default: "" },
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

export const ServiceRecord = model<ServiceRecordDoc>(
  "ServiceRecord",
  serviceRecordSchema,
  "service_records"
);
