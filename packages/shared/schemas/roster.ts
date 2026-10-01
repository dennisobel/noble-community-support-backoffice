import { z } from "zod";
import { SHIFT_RATIOS, SHIFT_STATUSES } from "../enums";
import { hm, objectId, rev, text, ymd } from "./common";

const shiftShape = {
  date: ymd,
  start: hm,
  end: hm,
  ratio: z.enum(SHIFT_RATIOS),
  clientIds: z.array(objectId).max(20),
  staffIds: z.array(objectId).max(10),
  serviceId: objectId,
  location: text(200).optional(),
  notes: text(1000).optional(),
};

export const shiftCreateSchema = z.object(shiftShape);
export type ShiftCreateInput = z.input<typeof shiftCreateSchema>;

export const shiftUpdateSchema = z.object(shiftShape).partial().extend({ rev });
export type ShiftUpdateInput = z.input<typeof shiftUpdateSchema>;

export const shiftStatusSchema = z.object({
  status: z.enum(SHIFT_STATUSES),
  rev,
});

export const shiftListQuery = z.object({
  from: ymd,
  to: ymd,
  ratio: z.enum(SHIFT_RATIOS).optional(),
  clientId: objectId.optional(),
  staffId: objectId.optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
});
