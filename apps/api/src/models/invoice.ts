import { model, Schema, type Types } from "mongoose";
import {
  INVOICE_STATUSES,
  XERO_SYNC_STATES,
  type InvoiceStatus,
  type XeroSyncState,
} from "@shared/enums";
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
  /** The service's NDIS support item number, copied when the invoice was raised. */
  itemCode?: string;
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
  /** Free text under "Reference"; defaults to the participant and their NDIS number. */
  reference: string;
  /** Snapshotted with the invoice, so changing the account later never rewrites an issued one. */
  bank: {
    accountName: string;
    bsb: string;
    accountNumber: string;
    payInstruction: string;
  };
  /** Read-only public link. The token is the secret; clearing it revokes every copy. */
  share: { token: string | null; enabled: boolean; createdAt: Date | null };
  /** Where this invoice stands in Xero. Written only by the Xero sync, and it never bumps `rev`. */
  xero?: {
    invoiceId: string | null;
    state: XeroSyncState;
    /** Why it needs attention, or a note such as "Paid here, not in Xero". */
    message: string;
    syncedAt: Date | null;
    paymentId: string | null;
    /** Opens the invoice in Xero. Built once, when the invoice is first linked. */
    url: string;
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
    reference: { type: String, default: "" },
    bank: {
      accountName: { type: String, default: "" },
      bsb: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      payInstruction: { type: String, default: "" },
    },
    share: {
      token: { type: String, default: null },
      enabled: { type: Boolean, default: false },
      createdAt: { type: Date, default: null },
    },
    xero: {
      invoiceId: { type: String, default: null },
      state: { type: String, enum: XERO_SYNC_STATES, default: "none" },
      message: { type: String, default: "" },
      syncedAt: { type: Date, default: null },
      paymentId: { type: String, default: null },
      url: { type: String, default: "" },
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
        itemCode: { type: String, default: "" },
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
// Sparse: only shared invoices hold a token, and it must be unique to be a usable secret.
invoiceSchema.index(
  { "share.token": 1 },
  {
    unique: true,
    partialFilterExpression: { "share.token": { $type: "string" } },
  }
);
invoiceSchema.index({ status: 1, issue: -1 });
invoiceSchema.index({ clientId: 1, issue: -1 });

export const Invoice = model<InvoiceDoc>("Invoice", invoiceSchema, "invoices");
