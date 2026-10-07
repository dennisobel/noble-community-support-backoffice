import { z } from "zod";
import {
  SIGNATURE_FIELD_TYPES,
  SIGNATURE_STATUSES,
  type SignatureFieldType,
} from "../enums";
import {
  objectId,
  optionalEmail,
  requiredText,
  rev,
  searchText,
  text,
} from "./common";

export const SIGNATURE_LIMITS = {
  maxSigners: 10,
  maxFields: 200,
  maxPages: 100,
  defaultExpiryDays: 30,
  maxExpiryDays: 180,
  /** A drawn or typed signature, as decoded PNG bytes. */
  signatureBytes: 400_000,
  /** The widest and tallest signature picture accepted, in pixels. */
  signaturePixels: 2400,
} as const;

/** Size (in PDF points, 1/72 inch) and hint of a new box, before it is dragged or resized. */
export const SIGNATURE_FIELD_DEFAULTS: Record<
  SignatureFieldType,
  { w: number; h: number; label: string; name: string }
> = {
  signature: { w: 170, h: 46, label: "Sign here", name: "Signature" },
  date: { w: 100, h: 22, label: "Date", name: "Date signed" },
  text: { w: 200, h: 22, label: "Type here", name: "Text" },
  checkbox: { w: 18, h: 18, label: "Tick to agree", name: "Checkbox" },
};

/** Ids are made in the browser (so a new box can be edited before it is saved) and checked here. */
export const shortId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{6,24}$/, { error: "Invalid id." });

export const signerInput = z.object({
  id: shortId,
  name: requiredText(120, "Enter the signer's name."),
  email: optionalEmail,
  roleLabel: text(60).optional(),
  /** This signer is the person saving the draft, who will sign in the app instead of from a link. */
  me: z.boolean().optional(),
});

const unit = z.number().min(0).max(1);

export const signatureFieldInput = z
  .object({
    id: shortId,
    signerId: shortId,
    type: z.enum(SIGNATURE_FIELD_TYPES),
    page: z.number().int().min(1).max(SIGNATURE_LIMITS.maxPages),
    x: unit,
    y: unit,
    w: z.number().min(0.01).max(1),
    h: z.number().min(0.005).max(1),
    required: z.boolean(),
    label: text(80).optional(),
  })
  .refine(field => field.x + field.w <= 1.0001 && field.y + field.h <= 1.0001, {
    error: "Keep every box inside the page.",
    path: ["x"],
  });

/** Multipart text fields sent with the PDF when a request is started. */
export const signatureCreateFields = z.object({
  title: text(200).optional(),
  message: text(1000).optional(),
  participantId: z.union([objectId, z.literal("")]).optional(),
  folderKey: text(40).optional(),
});

/** Saving the layout of a draft: only what is present is changed. */
export const signatureDraftSchema = z.object({
  title: requiredText(200, "Enter a title.").optional(),
  message: text(1000).optional(),
  participantId: z.union([objectId, z.literal(""), z.null()]).optional(),
  folderKey: text(40).optional(),
  signers: z.array(signerInput).max(SIGNATURE_LIMITS.maxSigners).optional(),
  fields: z
    .array(signatureFieldInput)
    .max(SIGNATURE_LIMITS.maxFields)
    .optional(),
  rev,
});

export const signatureSendSchema = z.object({
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(SIGNATURE_LIMITS.maxExpiryDays)
    .optional(),
  emailSigners: z.boolean().optional(),
  rev,
});

export const signatureExtendSchema = z.object({
  days: z.number().int().min(1).max(SIGNATURE_LIMITS.maxExpiryDays),
});

export const signatureCancelSchema = z.object({ reason: text(300).optional() });

export const signatureListQuery = z.object({
  status: z.enum([...SIGNATURE_STATUSES, "expired", "all"]).default("all"),
  q: searchText,
  participantId: objectId.optional(),
});

/** The signing token: long enough that it cannot be guessed. */
export const signTokenParam = z
  .string()
  .regex(/^[A-Za-z0-9_-]{24,64}$/, { error: "Invalid signing link." });

export const signSubmitSchema = z.object({
  consent: z.literal(true, {
    error: "Tick the box to confirm you agree to sign electronically.",
  }),
  /** The drawn or typed signature as a PNG data URL (checked properly on the server). */
  signature: z.string().max(600_000).optional(),
  values: z
    .array(z.object({ fieldId: shortId, value: z.string().max(500) }))
    .max(SIGNATURE_LIMITS.maxFields)
    .default([]),
});
export type SignSubmitInput = z.input<typeof signSubmitSchema>;

export const signDeclineSchema = z.object({ reason: text(500).optional() });

export type SignatureDraftInput = z.input<typeof signatureDraftSchema>;
export type SignatureSendInput = z.input<typeof signatureSendSchema>;
