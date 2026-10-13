import { z } from "zod";
import {
  HEALTH_FLAGS,
  INCIDENT_FLAGS,
  RECORD_STATUSES,
  SUPPORT_PROVIDED,
} from "../enums";
import { MESSAGES } from "../messages";
import {
  hm,
  money,
  objectId,
  pagination,
  recordId,
  rev,
  searchText,
  shiftId,
  text,
  voiceNoteId,
  ymd,
} from "./common";

const note = text(5000).optional();

/** The written part of a progress note. Nothing is required until the note is submitted. */
const noteShape = {
  supportTypes: z
    .array(z.enum(SUPPORT_PROVIDED))
    .max(SUPPORT_PROVIDED.length)
    .optional(),
  support: note,
  summary: note,
  goals: z.array(text(300).min(1)).max(30).optional(),
  outcome: note,
  achievements: note,
  health: z.array(z.enum(HEALTH_FLAGS)).max(HEALTH_FLAGS.length).optional(),
  healthDetails: text(2000).optional(),
  incident: z
    .array(z.enum(INCIDENT_FLAGS))
    .max(INCIDENT_FLAGS.length)
    .optional(),
  incidentDetails: text(2000).optional(),
  followUp: note,
};

const recordShape = {
  clientId: objectId,
  staffId: objectId,
  serviceId: objectId,
  date: ymd,
  start: hm,
  end: hm,
  location: text(200).optional(),
  ...noteShape,
  km: z
    .number({ error: "Enter the kilometres as a number." })
    .min(0)
    .max(5000)
    .optional(),
  quantity: z
    .number({ error: "Enter the quantity as a number." })
    .min(0)
    .max(10_000)
    .nullable()
    .optional(),
  confirmed: z.boolean().optional(),
  voiceNoteId: voiceNoteId.nullable().optional(),
  shiftId: shiftId.nullable().optional(),
};

export const recordCreateSchema = z.object(recordShape);
export type RecordCreateInput = z.input<typeof recordCreateSchema>;

export const recordUpdateSchema = z
  .object(recordShape)
  .omit({ shiftId: true })
  .partial()
  .extend({ rev, applyVoiceDraft: z.boolean().optional() });
export type RecordUpdateInput = z.input<typeof recordUpdateSchema>;

export const recordReturnSchema = z.object({
  reason: z.string().trim().min(1, { error: MESSAGES.returnReason }).max(2000),
  rev,
});

/** Correcting a note that has already been submitted: the changed sections, and why. */
export const recordAmendSchema = z.object({
  ...noteShape,
  reason: z
    .string()
    .trim()
    .min(1, { error: "Say why the note is being amended." })
    .max(1000),
  /** The worker's request this amendment answers, when there is one. */
  requestId: objectId.optional(),
  rev,
});
export type RecordAmendInput = z.input<typeof recordAmendSchema>;

export const amendmentRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: "Say what needs to change and why." })
    .max(1000),
});
export type AmendmentRequestInput = z.input<typeof amendmentRequestSchema>;

export const amendmentDeclineSchema = z.object({
  note: text(500).optional(),
});

export const billablesAdjustSchema = z.object({
  lines: z
    .array(
      z.object({
        index: z.number().int().min(0),
        quantity: z
          .number({ error: "Enter a valid quantity." })
          .min(0)
          .max(10_000)
          .optional(),
        rate: money("Enter a valid non-negative rate.").optional(),
      })
    )
    .min(1),
  rev,
});

const statusList = z
  .string()
  .optional()
  .transform(value =>
    value
      ? value
          .split(",")
          .map(item => item.trim())
          .filter(Boolean)
      : []
  )
  .pipe(z.array(z.enum(RECORD_STATUSES)));

export const recordListQuery = z.object({
  status: statusList,
  clientId: objectId.optional(),
  staffId: objectId.optional(),
  serviceId: objectId.optional(),
  team: text(120).optional(),
  q: searchText,
  from: ymd.optional(),
  to: ymd.optional(),
  /** Amended notes, notes flagging a health concern or incident, or notes with a request waiting. */
  flag: z.enum(["amended", "attention", "requests"]).optional(),
  sort: z.enum(["-date", "date", "-updatedAt", "updatedAt"]).default("-date"),
  ...pagination,
});

export const recordCountsQuery = z.object({ clientId: objectId.optional() });

export const notesOverviewQuery = z.object({
  clientId: objectId.optional(),
  staffId: objectId.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});
export type NotesOverviewQuery = z.input<typeof notesOverviewQuery>;

export const recordIdParam = z.object({ id: recordId });
