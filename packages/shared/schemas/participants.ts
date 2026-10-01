import { z } from "zod";
import { PARTICIPANT_STATUSES } from "../enums";
import { MESSAGES } from "../messages";
import { normalizeNdis } from "../logic/ndis";
import {
  email,
  optionalEmail,
  optionalYmd,
  pagination,
  requiredText,
  rev,
  searchText,
  text,
  ymd,
} from "./common";

export const ndis = z
  .string({ error: MESSAGES.ndis })
  .transform(normalizeNdis)
  .refine(value => value.length === 9, { error: MESSAGES.ndis });

export const kycSchema = z.object({
  serviceAgreement: z.boolean(),
  consentForms: z.boolean(),
  supportPlan: z.boolean(),
  riskInformationReviewed: z.boolean(),
  transportRequirementsConfirmed: z.boolean(),
});

const listItem = z.string().trim().min(1).max(300);
const longText = text(2000).optional();

const participantShape = {
  name: requiredText(160, "Enter the participant's legal name."),
  preferred: requiredText(80, "Enter the preferred name."),
  ndis,
  dob: ymd,
  phone: requiredText(40, "Enter a phone number."),
  email,
  address: requiredText(300, "Enter the residential address."),
  planStart: optionalYmd,
  planEnd: optionalYmd,
  manager: text(160).optional(),
  managerEmail: optionalEmail,
  nominee: text(160).optional(),
  emergencyName: requiredText(160, "Enter the emergency contact name."),
  emergencyPhone: requiredText(40, "Enter the emergency contact phone."),
  alerts: z.array(listItem).max(20).optional(),
  goals: z.array(listItem).max(20).optional(),
  communication: longText,
  mobility: longText,
  transport: longText,
  support: longText,
  risks: longText,
  allergies: longText,
  preferences: longText,
  kyc: kycSchema.optional(),
};

function checkPlanDates(
  value: { planStart?: string | null; planEnd?: string | null },
  ctx: z.RefinementCtx
) {
  if (value.planStart && value.planEnd && value.planEnd < value.planStart) {
    ctx.addIssue({
      code: "custom",
      message: MESSAGES.planDates,
      path: ["planEnd"],
    });
  }
}

export const participantCreateSchema = z
  .object(participantShape)
  .superRefine(checkPlanDates);
export type ParticipantCreateInput = z.input<typeof participantCreateSchema>;

export const participantUpdateSchema = z
  .object(participantShape)
  .omit({ kyc: true })
  .partial()
  .extend({ rev })
  .superRefine(checkPlanDates);
export type ParticipantUpdateInput = z.input<typeof participantUpdateSchema>;

export const participantKycSchema = kycSchema.partial().extend({ rev });

export const participantArchiveSchema = z.object({
  reason: text(500).optional(),
  rev,
});

export const participantListQuery = z.object({
  status: z.enum([...PARTICIPANT_STATUSES, "all"]).default("Active"),
  q: searchText,
  ...pagination,
});
