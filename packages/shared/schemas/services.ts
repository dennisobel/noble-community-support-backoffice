import { z } from "zod";
import { SERVICE_UNITS, TRANSPORT_UNITS } from "../enums";
import { MESSAGES } from "../messages";
import { money, requiredText, rev, text } from "./common";

const serviceShape = {
  name: requiredText(120, MESSAGES.serviceName),
  unit: z.enum(SERVICE_UNITS),
  rate: money(MESSAGES.serviceRate),
  transport: z.boolean(),
  transportUnit: z.enum(TRANSPORT_UNITS).nullable().optional(),
  active: z.boolean(),
  budgetCategory: requiredText(80, MESSAGES.serviceCategory),
  supportItemNumber: text(40).optional(),
};

export const serviceCreateSchema = z.object(serviceShape);
export type ServiceCreateInput = z.input<typeof serviceCreateSchema>;

export const serviceUpdateSchema = z
  .object(serviceShape)
  .partial()
  .extend({ rev });
export type ServiceUpdateInput = z.input<typeof serviceUpdateSchema>;

export const serviceListQuery = z.object({
  active: z.enum(["true", "false", "all"]).default("all"),
});
