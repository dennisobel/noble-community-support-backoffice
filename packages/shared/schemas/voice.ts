import { z } from "zod";
import { AUDIO_UPLOAD } from "../const";
import { DETAIL_LEVELS, NOTE_SECTIONS, NOTE_TEMPLATES } from "../enums";
import { MESSAGES } from "../messages";
import {
  objectId,
  pagination,
  recordId,
  requiredText,
  rev,
  searchText,
  text,
} from "./common";

/** Multipart text fields arrive as strings. */
export const voiceUploadFields = z.object({
  clientId: objectId,
  title: requiredText(160, "Give the recording a title."),
  recordId: z.union([recordId, z.literal("")]).optional(),
  durationSec: z.coerce
    .number()
    .int()
    .min(1, { error: "Record a short clip before saving." })
    .max(AUDIO_UPLOAD.maxDurationSec),
});

export const voicePatchSchema = z.object({
  title: requiredText(160, "Give the recording a title.").optional(),
  recordId: recordId.nullable().optional(),
  rev,
});

export const transcriptPatchSchema = z.object({
  text: z.string().max(50_000),
  rev,
});

export const generateDraftSchema = z.object({
  template: z.enum(NOTE_TEMPLATES),
  sections: z
    .array(z.enum(NOTE_SECTIONS))
    .min(1, { error: MESSAGES.generationSections }),
  detailLevel: z.enum(DETAIL_LEVELS),
  transcriptOnly: z.boolean(),
});
export type GenerateDraftInput = z.input<typeof generateDraftSchema>;

const section = text(5000).optional();
export const draftPatchSchema = z.object({
  support: section,
  response: section,
  outcome: section,
  observations: section,
  followUp: section,
  rev,
});

export const attachSchema = z.object({
  recordId,
  applyDraft: z.boolean(),
  rev,
});

export const voiceListQuery = z.object({
  clientId: objectId.optional(),
  status: z
    .enum(["active", "Saved", "Draft ready", "Archived", "all"])
    .default("active"),
  range: z.enum(["any", "today", "recent"]).default("any"),
  q: searchText,
  ...pagination,
});
