import { model, Schema, type Types } from "mongoose";
import { baseOptions } from "./common";

/** A person's own note. Notes are private to their author: no query ever reads them across users. */
export interface NoteDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  /** The editor's JSON, rebuilt by the server from known nodes before it is stored. */
  content: Record<string, unknown>;
  /** The note's words, derived from `content`, for search and list previews. */
  text: string;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  imageCount: number;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<NoteDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, default: "" },
    content: {
      type: Schema.Types.Mixed,
      default: () => ({ type: "doc", content: [{ type: "paragraph" }] }),
    },
    text: { type: String, default: "" },
    labels: { type: [String], default: [] },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    imageCount: { type: Number, default: 0 },
    rev: { type: Number, default: 0 },
  },
  { ...baseOptions, minimize: false }
);
noteSchema.index({ userId: 1, archived: 1, pinned: -1, updatedAt: -1 });
noteSchema.index({ userId: 1, labels: 1 });

export const Note = model<NoteDoc>("Note", noteSchema, "notes");

/** A picture added to a note. The file lives in storage; only its owner can fetch it. */
export interface NoteImageDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  noteId: Types.ObjectId;
  storageKey: string;
  mimeType: string;
  bytes: number;
  createdAt: Date;
  updatedAt: Date;
}

const noteImageSchema = new Schema<NoteImageDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    bytes: { type: Number, required: true },
  },
  baseOptions
);
noteImageSchema.index({ noteId: 1 });

export const NoteImage = model<NoteImageDoc>(
  "NoteImage",
  noteImageSchema,
  "note_images"
);
