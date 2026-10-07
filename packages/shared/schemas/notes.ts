import { z } from "zod";
import { searchText, text, ymd } from "./common";

export const NOTE_LIMITS = {
  title: 200,
  labels: 8,
  labelLength: 30,
  /** The note's stored JSON, in bytes. */
  contentBytes: 400_000,
  /** Pictures one note can hold. */
  images: 60,
  /** One picture, in bytes (the app shrinks phone photos well below this first). */
  imageBytes: 10 * 1024 * 1024,
} as const;

/** A label is a short word or phrase in lower case. A leading # is dropped, so "#Visits" and "visits" are one label. */
export const noteLabel = z
  .string()
  .trim()
  .transform(value => value.replace(/^#+/, "").trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(1, { error: "A label cannot be empty." })
      .max(NOTE_LIMITS.labelLength, {
        error: `Keep labels under ${NOTE_LIMITS.labelLength} characters.`,
      })
  );

export const noteLabels = z
  .array(noteLabel)
  .max(NOTE_LIMITS.labels, {
    error: `Use at most ${NOTE_LIMITS.labels} labels per note.`,
  })
  .transform(list => [...new Set(list)]);

/** The editor's JSON. The server rebuilds it from known pieces, so here it only has to be an object. */
export const noteContent = z.record(z.string(), z.unknown());

export const noteCreateSchema = z.object({
  title: text(NOTE_LIMITS.title).optional(),
  labels: noteLabels.optional(),
});

export const notePatchSchema = z.object({
  title: text(NOTE_LIMITS.title).optional(),
  content: noteContent.optional(),
  labels: noteLabels.optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** The revision the editor last saw; a mismatch means another device saved in between. */
  rev: z.number().int().min(0).optional(),
});
export type NotePatchInput = z.input<typeof notePatchSchema>;

export const noteListQuery = z.object({
  q: searchText,
  label: z
    .string()
    .trim()
    .toLowerCase()
    .max(NOTE_LIMITS.labelLength)
    .optional(),
  archived: z.enum(["true", "false"]).default("false"),
});

export const myDayQuery = z.object({ date: ymd.optional() });
