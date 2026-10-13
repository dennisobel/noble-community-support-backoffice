import { z } from "zod";
import { DETAIL_LEVELS, NOTE_TEMPLATES } from "../enums";
import { isValidTimeZone } from "../logic/time";
import {
  email as emailSchema,
  money,
  requiredText,
  text,
} from "./common";

const abn = z
  .string()
  .transform(value => value.replace(/\D/g, ""))
  .refine(value => value.length === 0 || value.length === 11, {
    error: "Enter the 11-digit ABN.",
  });

export const workspacePatchSchema = z.object({
  name: requiredText(120, "Enter the organisation name.").optional(),
  legalName: text(160).optional(),
  abn: abn.optional(),
  address: text(300).optional(),
  phone: text(40).optional(),
  email: z
    .union([emailSchema, z.literal("")], {
      error: "Enter a valid accounts email address, or leave it blank.",
    })
    .optional(),
  timezone: z
    .string()
    .refine(isValidTimeZone, { error: "Choose a valid timezone." })
    .optional(),
  gst: z
    .object({
      registered: z.boolean(),
      ratePct: z
        .number({ error: "Enter a GST rate between 0 and 20." })
        .min(0, { error: "Enter a GST rate between 0 and 20." })
        .max(20, { error: "Enter a GST rate between 0 and 20." }),
    })
    .optional(),
  invoice: z
    .object({
      prefix: z
        .string()
        .trim()
        .min(1, { error: "Enter an invoice number prefix, e.g. INV." })
        .regex(/^[A-Z0-9]{1,8}$/, {
          error:
            "The invoice number prefix must be 1–8 capital letters or digits, with no spaces or symbols (e.g. INV).",
        }),
      defaultPaymentTermsDays: z
        .number({ error: "Enter payment terms as whole days, 0 to 120." })
        .int({ error: "Enter payment terms as whole days, 0 to 120." })
        .min(0, { error: "Enter payment terms as whole days, 0 to 120." })
        .max(120, { error: "Enter payment terms as whole days, 0 to 120." }),
      footer: text(500),
      paymentInstructions: text(1000),
    })
    .partial()
    .optional(),
  bank: z
    .object({
      accountName: text(160),
      // Australian BSB: six digits, usually written 123-456.
      bsb: z
        .string()
        .trim()
        .transform(value => value.replace(/[^0-9]/g, ""))
        .refine(value => value.length === 0 || value.length === 6, {
          error: "Enter the six-digit BSB, e.g. 067-873.",
        }),
      accountNumber: z
        .string()
        .trim()
        .transform(value => value.replace(/[^0-9]/g, ""))
        .refine(value => value.length === 0 || value.length <= 10, {
          error: "Enter the bank account number: up to 10 digits.",
        }),
      payInstruction: text(160),
    })
    .partial()
    .optional(),
  providerTravelRate: money(
    "Enter a valid non-negative travel rate."
  ).optional(),
  budgetCategories: z
    .array(requiredText(60, "Category names cannot be blank."))
    .min(1, { error: "Keep at least one budget category." })
    .max(12, { error: "Keep to 12 budget categories at most." })
    .refine(
      values =>
        new Set(values.map(value => value.toLowerCase())).size ===
        values.length,
      {
        error: "Each budget category can appear only once.",
      }
    )
    .optional(),
});
export type WorkspacePatchInput = z.input<typeof workspacePatchSchema>;

export const preferencesPatchSchema = z.object({
  voice: z
    .object({
      generationTemplate: z.enum(NOTE_TEMPLATES),
      detailLevel: z.enum(DETAIL_LEVELS),
      autoSaveRecordings: z.boolean(),
      useTranscriptOnly: z.boolean(),
      notifyDraftReady: z.boolean(),
    })
    .partial()
    .optional(),
  notifications: z
    .object({
      recordReturned: z.boolean(),
      reviewQueue: z.boolean(),
      budgetAlerts: z.boolean(),
      invoiceOverdue: z.boolean(),
      voiceDraftReady: z.boolean(),
    })
    .partial()
    .optional(),
});
export type PreferencesPatchInput = z.input<typeof preferencesPatchSchema>;
