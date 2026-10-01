import { z } from "zod";
import { RECORD_STATUSES } from "../enums";
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

const recordShape = {
  clientId: objectId,
  staffId: objectId,
  serviceId: objectId,
  date: ymd,
  start: hm,
  end: hm,
  location: text(200).optional(),
  support: note,
  response: note,
  outcome: note,
  observations: note,
  followUp: note,
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
  sort: z.enum(["-date", "date", "-updatedAt", "updatedAt"]).default("-date"),
  ...pagination,
});

export const recordCountsQuery = z.object({ clientId: objectId.optional() });

export const recordIdParam = z.object({ id: recordId });
