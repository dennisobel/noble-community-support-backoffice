import { model, Schema, type Types } from "mongoose";
import {
  GENERATION_STATUSES,
  TRANSCRIPT_STATUSES,
  VOICE_STATUSES,
  type GenerationStatus,
  type TranscriptStatus,
  type VoiceStatus,
} from "@shared/enums";
import { actorSchema, baseOptions, type ActorRefSub } from "./common";

export interface VoiceDraftSub {
  support: string;
  response: string;
  outcome: string;
  observations: string;
  followUp: string;
}

export interface StoredFileSub {
  storageKey: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface VoiceNoteDoc {
  _id: string;
  clientId: Types.ObjectId;
  recordId: string | null;
  staffId: Types.ObjectId | null;
  recordedBy: ActorRefSub | null;
  title: string;
  durationSec: number;
  audio: StoredFileSub | null;
  transcript: {
    text: string;
    status: TranscriptStatus;
    provider: string | null;
    language: string | null;
    error: string | null;
    updatedAt: Date | null;
  };
  generation: {
    status: GenerationStatus;
    template: string | null;
    sections: string[];
    detailLevel: string | null;
    transcriptOnly: boolean;
    provider: string | null;
    model: string | null;
    error: string | null;
    generatedAt: Date | null;
  };
  draft: VoiceDraftSub | null;
  status: VoiceStatus;
  archivedAt: Date | null;
  rev: number;
  createdAt: Date;
  updatedAt: Date;
}

const draftSchema = new Schema<VoiceDraftSub>(
  {
    support: { type: String, default: "" },
    response: { type: String, default: "" },
    outcome: { type: String, default: "" },
    observations: { type: String, default: "" },
    followUp: { type: String, default: "" },
  },
  { _id: false }
);

export const storedFileSchema = new Schema<StoredFileSub>(
  {
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false }
);

const voiceNoteSchema = new Schema<VoiceNoteDoc>(
  {
    _id: { type: String, required: true },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: "Participant",
      required: true,
    },
    recordId: { type: String, default: null },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff", default: null },
    recordedBy: { type: actorSchema, default: null },
    title: { type: String, required: true },
    durationSec: { type: Number, default: 0 },
    audio: { type: storedFileSchema, default: null },
    transcript: {
      text: { type: String, default: "" },
      status: {
        type: String,
        enum: TRANSCRIPT_STATUSES,
        default: "Not transcribed",
      },
      provider: { type: String, default: null },
      language: { type: String, default: null },
      error: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },
    generation: {
      status: {
        type: String,
        enum: GENERATION_STATUSES,
        default: "Not generated",
      },
      template: { type: String, default: null },
      sections: { type: [String], default: [] },
      detailLevel: { type: String, default: null },
      transcriptOnly: { type: Boolean, default: false },
      provider: { type: String, default: null },
      model: { type: String, default: null },
      error: { type: String, default: null },
      generatedAt: { type: Date, default: null },
    },
    draft: { type: draftSchema, default: null },
    status: { type: String, enum: VOICE_STATUSES, default: "Saved" },
    archivedAt: { type: Date, default: null },
    rev: { type: Number, default: 0 },
  },
  baseOptions
);
voiceNoteSchema.index({ clientId: 1, createdAt: -1 });
voiceNoteSchema.index({ status: 1, createdAt: -1 });
voiceNoteSchema.index({ recordId: 1 });

export const VoiceNote = model<VoiceNoteDoc>(
  "VoiceNote",
  voiceNoteSchema,
  "voice_notes"
);
