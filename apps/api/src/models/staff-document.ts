import { model, Schema, type Types } from "mongoose";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";
import type { DocumentFileSub } from "./document";

/**
 * A file held against a worker's employee profile (passport, police check, first aid…).
 * `checklistKey` links it to the DSW checklist item it satisfies; `expiry` drives the
 * reminder cron and `lastNotifiedOn` stops the same reminder being sent twice a day.
 */
export interface StaffDocumentDoc {
  _id: Types.ObjectId;
  staffId: Types.ObjectId;
  checklistKey: string | null;
  title: string;
  notes: string;
  issued: string | null;
  expiry: string | null;
  file: DocumentFileSub | null;
  uploadedBy: ActorRefSub | null;
  lastNotifiedOn: string | null;
  lastNotifiedDays: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const staffDocumentSchema = new Schema<StaffDocumentDoc>(
  {
    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true,
    },
    checklistKey: { type: String, default: null },
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: "" },
    issued: { type: String, default: null },
    expiry: { type: String, default: null },
    file: {
      type: new Schema<DocumentFileSub>(
        {
          storageKey: { type: String, required: true },
          originalName: { type: String, required: true },
          mimeType: { type: String, required: true },
          size: { type: Number, required: true },
          sha256: { type: String, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    uploadedBy: { type: actorSchema, default: null },
    lastNotifiedOn: { type: String, default: null },
    lastNotifiedDays: { type: Number, default: null },
    deletedAt: { type: Date, default: null },
  },
  baseOptions
);
staffDocumentSchema.index({ staffId: 1, checklistKey: 1 });
staffDocumentSchema.index({ expiry: 1, deletedAt: 1 });

export const StaffDocument = model<StaffDocumentDoc>(
  "StaffDocument",
  staffDocumentSchema,
  "staff_documents"
);
