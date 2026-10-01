import { z } from "zod";
import { MESSAGES } from "../messages";
import { hasAtMostTwoDecimals } from "../logic/money";
import { isValidHm, isValidYmd } from "../logic/time";

export const ymd = z
  .string()
  .refine(isValidYmd, { error: "Enter a valid date." });
export const hm = z
  .string()
  .refine(isValidHm, { error: "Enter a valid time (HH:mm)." });

/** Optional date input: "" and null both mean "not set". */
export const optionalYmd = z.union([ymd, z.literal(""), z.null()]).optional();

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, { error: "Invalid id." });
export const recordId = z
  .string()
  .regex(/^SR-\d+$/, { error: "Invalid service record id." });
export const voiceNoteId = z
  .string()
  .regex(/^VN-\d+$/, { error: "Invalid voice note id." });
export const shiftId = z
  .string()
  .regex(/^SH-\d+$/, { error: "Invalid shift id." });

export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Keep this under ${max} characters.` });
export const requiredText = (max: number, message: string) =>
  text(max).min(1, { error: message });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: MESSAGES.email }));

export const optionalEmail = z.union([email, z.literal("")]).optional();

/** Dollar amount, non-negative, at most two decimals. */
export const money = (message = "Enter a valid non-negative amount.") =>
  z
    .number({ error: message })
    .min(0, { error: message })
    .max(10_000_000, { error: message })
    .refine(hasAtMostTwoDecimals, { error: "Use at most two decimal places." });

export const rev = z.number().int().min(0).optional();

export const revOnly = z.object({ rev });

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export const searchText = z.string().trim().max(100).optional();
