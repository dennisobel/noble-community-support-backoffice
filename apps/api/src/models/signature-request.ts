import { model, Schema, type Types } from "mongoose";
import {
  SIGNATURE_EVENT_TYPES,
  SIGNATURE_FIELD_TYPES,
  SIGNATURE_STATUSES,
  SIGNER_STATUSES,
  type SignatureEventType,
  type SignatureFieldType,
  type SignatureStatus,
  type SignerStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface SignatureFileSub {
  storageKey: string;
  originalName: string;
  size: number;
  sha256: string;
}

export interface SignaturePageSub {
  /** Size in PDF points as displayed (a page turned sideways is already swapped). */
  width: number;
  height: number;
}

export interface SignerSub {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  /** The team member this signer is, when they added themselves; they sign in the app, not from an emailed link. */
  userId?: string | null;
  /** The secret in this person's signing link. Null until the request is sent. */
  token: string | null;
  status: SignerStatus;
  viewedAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  declineReason: string;
  /** Where the person was when they agreed and signed (kept for the completion certificate). */
  ip: string;
  userAgent: string;
  signatureKey: string | null;
  signatureSha256: string | null;
  emailedAt: Date | null;
}

export interface SignatureFieldSub {
  id: string;
  signerId: string;
  type: SignatureFieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string;
  /** Text, an ISO date or "true"; empty until the signer finishes. A signature box keeps its picture on the signer. */
  value: string;
}

export interface SignatureEventSub {
  at: Date;
  type: SignatureEventType;
  signerId: string | null;
  /** A team member, or the signer's name for what they did through their link. */
  by: string;
  detail: string;
  ip: string;
  userAgent: string;
}

export interface SignatureRequestDoc {
  _id: Types.ObjectId;
  title: string;
  message: string;
  status: SignatureStatus;
  participantId: Types.ObjectId | null;
  /** Client folder the signed copy is filed under when it is finished. */
  folderKey: string;
  document: SignatureFileSub;
  pages: SignaturePageSub[];
  signers: SignerSub[];
  fields: SignatureFieldSub[];
  events: SignatureEventSub[];
  signed: (SignatureFileSub & { completedAt: Date }) | null;
  filedDocumentId: Types.ObjectId | null;
  /** Set while a finished copy is being built, so two signers finishing together build it once. */
  sealClaimedAt: Date | null;
  sentAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  createdBy: ActorRefSub | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<SignatureFileSub>(
  {
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false }
);

const signerSchema = new Schema<SignerSub>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "" },
    roleLabel: { type: String, default: "" },
    userId: { type: String, default: null },
    token: { type: String, default: null },
    status: { type: String, enum: SIGNER_STATUSES, default: "pending" },
    viewedAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    declineReason: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    signatureKey: { type: String, default: null },
    signatureSha256: { type: String, default: null },
    emailedAt: { type: Date, default: null },
  },
  { _id: false }
);

const fieldSchema = new Schema<SignatureFieldSub>(
  {
    id: { type: String, required: true },
    signerId: { type: String, required: true },
    type: { type: String, enum: SIGNATURE_FIELD_TYPES, required: true },
    page: { type: Number, required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    w: { type: Number, required: true },
    h: { type: Number, required: true },
    required: { type: Boolean, default: true },
    label: { type: String, default: "" },
    value: { type: String, default: "" },
  },
  { _id: false }
);

const eventSchema = new Schema<SignatureEventSub>(
  {
    at: { type: Date, required: true },
    type: { type: String, enum: SIGNATURE_EVENT_TYPES, required: true },
    signerId: { type: String, default: null },
    by: { type: String, default: "" },
    detail: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { _id: false }
);

const signatureRequestSchema = new Schema<SignatureRequestDoc>(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, default: "" },
    status: { type: String, enum: SIGNATURE_STATUSES, default: "draft" },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    folderKey: { type: String, default: "agreement" },
    document: { type: fileSchema, required: true },
    pages: {
      type: [
        new Schema<SignaturePageSub>(
          {
            width: { type: Number, required: true },
            height: { type: Number, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    signers: { type: [signerSchema], default: [] },
    fields: { type: [fieldSchema], default: [] },
    events: { type: [eventSchema], default: [] },
    signed: {
      type: new Schema(
        {
          storageKey: { type: String, required: true },
          originalName: { type: String, required: true },
          size: { type: Number, required: true },
          sha256: { type: String, required: true },
          completedAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    filedDocumentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      default: null,
    },
    sealClaimedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdBy: { type: actorSchema, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
// A signing link is a credential, so each token must belong to exactly one signer.
signatureRequestSchema.index(
  { "signers.token": 1 },
  {
    unique: true,
    partialFilterExpression: { "signers.token": { $type: "string" } },
  }
);
signatureRequestSchema.index({ status: 1, updatedAt: -1 });
signatureRequestSchema.index({ participantId: 1, updatedAt: -1 });

export const SignatureRequest = model<SignatureRequestDoc>(
  "SignatureRequest",
  signatureRequestSchema,
  "signature_requests"
);
