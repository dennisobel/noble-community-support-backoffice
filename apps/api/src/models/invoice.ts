import { model, Schema, type Types } from "mongoose";
import { INVOICE_STATUSES, type InvoiceStatus } from "@shared/enums";
import {
  actorSchema,
  baseOptions,
  historySchema,
  type ActorRefSub,
  type HistorySub,
} from "./common";

export interface InvoiceLineSub {
  label: string;
  unit: string;
  quantity: number;
  rateCents: number;
  subtotalCents: number;
  recordId: string;
}

export interface InvoiceDoc {
  _id: string;
  clientId: Types.ObjectId;
  recordIds: string[];
  status: InvoiceStatus;
  title: string;
  recipient: string;
  recipientEmail: string;
  billTo: { name: string; address: string; ndis: string };
  supplier: {
    name: string;
    legalName: string;
    abn: string;
    address: string;
    phone: string;
    email: string;
  };
  issue: string;
  due: string;
  paymentTermsDays: number;
  lines: InvoiceLineSub[];
  subtotalCents: number;
  taxCents: number;
  taxRatePct: number;
  totalCents: number;
  notes: string;
  footer: string;
  paymentInstructions: string;
  sentAt: Date | null;
  emailedAt: Date | null;
  paidAt: Date | null;
  paidOn: string | null;
  paidReference: string;
  voidedAt: Date | null;
  voidReason: string;
  history: HistorySub[];
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<InvoiceDoc>(
  {
    _id: { type: String, required: true },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      required: true,
    },
    recordIds: { type: [String], default: [] },
    status: { type: String, enum: INVOICE_STATUSES, default: "Draft" },
    title: { type: String, default: "Invoice" },
    recipient: { type: String, default: "" },
    recipientEmail: { type: String, default: "" },
    billTo: { name: String, address: String, ndis: String },
    supplier: {
      name: String,
      legalName: String,
      abn: String,
      address: String,
      phone: String,
      email: String,
    },
    issue: { type: String, required: true },
    due: { type: String, required: true },
    paymentTermsDays: { type: Number, default: 14 },
    lines: [
      {
        _id: false,
        label: { type: String, required: true },
        unit: { type: String, required: true },
        quantity: { type: Number, required: true },
        rateCents: { type: Number, required: true },
        subtotalCents: { type: Number, required: true },
        recordId: { type: String, required: true },
      },
    ],
    subtotalCents: { type: Number, required: true },
    taxCents: { type: Number, required: true },
    taxRatePct: { type: Number, default: 0 },
    totalCents: { type: Number, required: true },
    notes: { type: String, default: "" },
    footer: { type: String, default: "" },
    paymentInstructions: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    emailedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paidOn: { type: String, default: null },
    paidReference: { type: String, default: "" },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: "" },
    history: { type: [historySchema], default: [] },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
invoiceSchema.index({ status: 1, issue: -1 });
invoiceSchema.index({ clientId: 1, issue: -1 });

export const Invoice = model<InvoiceDoc>("Invoice", invoiceSchema, "invoices");
