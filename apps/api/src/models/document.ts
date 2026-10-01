import { model, Schema, type Types } from "mongoose";
import { DOCUMENT_SCOPES, type DocumentScope } from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface DocumentFileSub {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface DocumentDoc {
  _id: Types.ObjectId;
  scope: DocumentScope;
  participantId: Types.ObjectId | null;
  folderKey: string;
  title: string;
  notes: string;
  docDate: string | null;
  kind: "file" | "template-slot";
  slotKey: string | null;
  file: DocumentFileSub | null;
  uploadedBy: ActorRefSub | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const documentFileSchema = new Schema<DocumentFileSub>(
  {
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false }
);

const documentSchema = new Schema<DocumentDoc>(
  {
    scope: { type: String, enum: DOCUMENT_SCOPES, required: true },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      default: null,
    },
    folderKey: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: "" },
    docDate: { type: String, default: null },
    kind: { type: String, enum: ["file", "template-slot"], default: "file" },
    slotKey: { type: String, default: null },
    file: { type: documentFileSchema, default: null },
    uploadedBy: { type: actorSchema, default: null },
    deletedAt: { type: Date, default: null },
  },
  baseOptions
);
documentSchema.index({ scope: 1, participantId: 1, folderKey: 1 });
documentSchema.index(
  { slotKey: 1 },
  { unique: true, partialFilterExpression: { kind: "template-slot" } }
);

export const DocumentModel = model<DocumentDoc>(
  "Document",
  documentSchema,
  "documents"
);
