import { z } from "zod";
import { INVOICE_STATUSES } from "../enums";
import { MESSAGES } from "../messages";
import {
  objectId,
  pagination,
  recordId,
  rev,
  searchText,
  text,
  ymd,
} from "./common";

export const PAYMENT_TERMS = [7, 14, 30] as const;

export const invoiceCreateSchema = z.object({
  clientId: objectId,
  recordIds: z
    .array(recordId)
    .min(1, { error: MESSAGES.noInvoiceRecords })
    .max(200),
  issueDate: ymd.optional(),
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
  notes: text(1000).optional(),
});
export type InvoiceCreateInput = z.input<typeof invoiceCreateSchema>;

export const invoiceUpdateSchema = z.object({
  issueDate: ymd.optional(),
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
  notes: text(1000).optional(),
  rev,
});

export const invoiceMarkSentSchema = z.object({
  sendEmail: z.boolean().optional(),
  rev,
});
export const invoiceMarkPaidSchema = z.object({
  paidOn: ymd,
  reference: text(120).optional(),
  rev,
});
export const invoiceVoidSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, { error: "Add a reason for voiding this invoice." })
    .max(500),
  rev,
});

export const invoiceListQuery = z.object({
  status: z.enum([...INVOICE_STATUSES, "all"]).default("all"),
  clientId: objectId.optional(),
  q: searchText,
  ...pagination,
});
