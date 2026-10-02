import { z } from "zod";
import { text } from "./common";

/**
 * The ledger choices an invoice needs. Each is picked from a list read from the Xero
 * organisation itself, so only codes that exist there can be chosen from the app.
 */
export const xeroSettingsSchema = z.object({
  /** The revenue account every invoice line is posted to. */
  salesAccountCode: text(60),
  /** Tax type for invoices without GST (most NDIS supports are GST-free). */
  taxTypeGstFree: text(60),
  /** Tax type for invoices that carry GST. */
  taxTypeTaxable: text(60),
  /** Bank account a payment marked as paid here is recorded against. Blank leaves payments to Xero. */
  paymentAccountCode: text(60),
});
export type XeroSettingsInput = z.input<typeof xeroSettingsSchema>;
