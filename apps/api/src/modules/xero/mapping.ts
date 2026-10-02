import type { XeroOptionsDTO } from "@shared/dto";
import type { InvoiceDoc, XeroSettingsSub } from "../../models";

/* Pure Noble ↔ Xero translation. Nothing here touches the network or the database. */

export interface XeroPayment {
  PaymentID?: string;
  Date?: string;
  DateString?: string;
  Amount?: number;
  Reference?: string;
}

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Type?: string;
  Status: string;
  Total?: number;
  AmountDue?: number;
  AmountPaid?: number;
  FullyPaidOnDate?: string;
  FullyPaidOnDateString?: string;
  Payments?: XeroPayment[];
}

export const centsOf = (amount: unknown): number =>
  Math.round(Number(amount) * 100);

export const dollars = (cents: number): string =>
  `$${(Math.abs(cents) / 100).toFixed(2)}`;

const taxTypeFor = (
  invoice: Pick<InvoiceDoc, "taxRatePct">,
  settings: XeroSettingsSub
) => (invoice.taxRatePct > 0 ? settings.taxTypeTaxable : settings.taxTypeGstFree);

/** What an invoice needs before Xero will take it, as one sentence a person can act on. */
export function missingMapping(
  invoice: Pick<InvoiceDoc, "taxRatePct">,
  settings: XeroSettingsSub
): string | null {
  if (!settings.salesAccountCode)
    return "Choose a sales account in Settings → Accounting (Xero), then retry.";
  if (!taxTypeFor(invoice, settings))
    return invoice.taxRatePct > 0
      ? "Choose the tax type for invoices with GST in Settings → Accounting (Xero), then retry."
      : "Choose the tax type for GST-free invoices in Settings → Accounting (Xero), then retry.";
  return null;
}

export const toXeroContact = (
  invoice: Pick<InvoiceDoc, "recipient" | "recipientEmail">
) => ({
  Name: invoice.recipient.trim(),
  ...(invoice.recipientEmail ? { EmailAddress: invoice.recipientEmail } : {}),
});

/** A tax-exclusive, authorised sales invoice. Draft invoices never go to Xero, so this is always the issued one. */
export function toXeroInvoice(
  invoice: InvoiceDoc,
  contactId: string,
  settings: XeroSettingsSub,
  currency: string
) {
  const taxType = taxTypeFor(invoice, settings);
  return {
    Type: "ACCREC",
    Contact: { ContactID: contactId },
    InvoiceNumber: invoice._id,
    ...(invoice.reference ? { Reference: invoice.reference } : {}),
    Date: invoice.issue,
    DueDate: invoice.due,
    LineAmountTypes: "Exclusive",
    CurrencyCode: currency,
    Status: "AUTHORISED",
    LineItems: invoice.lines.map(line => ({
      Description: [line.itemCode?.trim(), line.label]
        .filter(Boolean)
        .join(" – "),
      Quantity: line.quantity,
      UnitAmount: line.rateCents / 100,
      AccountCode: settings.salesAccountCode,
      TaxType: taxType,
    })),
  };
}

/** Xero sends dates as `/Date(1518685950940+0000)/` or ISO text; either becomes `YYYY-MM-DD`. */
export function xeroDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const microsoft = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (microsoft)
    return new Date(Number(microsoft[1])).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function latestPayment(invoice: XeroInvoice): XeroPayment | null {
  const dated = (invoice.Payments ?? []).map(payment => ({
    payment,
    on: xeroDate(payment.DateString ?? payment.Date) ?? "",
  }));
  dated.sort((a, b) => b.on.localeCompare(a.on));
  return dated[0]?.payment ?? null;
}

export function paidOnOf(invoice: XeroInvoice): string | null {
  const payment = latestPayment(invoice);
  return (
    xeroDate(invoice.FullyPaidOnDateString ?? invoice.FullyPaidOnDate) ??
    xeroDate(payment?.DateString ?? payment?.Date)
  );
}

/** Opens the invoice inside the right Xero organisation, whichever one the person last used. */
export function invoiceUrl(shortCode: string, xeroInvoiceId: string): string {
  const view = `/AccountsReceivable/View.aspx?InvoiceID=${xeroInvoiceId}`;
  return shortCode
    ? `https://go.xero.com/organisationlogin/default.aspx?shortcode=${encodeURIComponent(shortCode)}&redirecturl=${encodeURIComponent(view)}`
    : `https://go.xero.com${view}`;
}

/**
 * Starting choices for a freshly connected organisation, taken from Xero's own defaults:
 * "Sales" (200), "GST Free Income" and "GST on Income". The person can change every one.
 */
export function suggestDefaults(
  options: XeroOptionsDTO
): Pick<XeroSettingsSub, "salesAccountCode" | "taxTypeGstFree" | "taxTypeTaxable"> {
  const rate = (type: string) =>
    options.taxRates.find(entry => entry.type === type)?.type;
  return {
    salesAccountCode:
      options.salesAccounts.find(account => account.code === "200")?.code ??
      options.salesAccounts[0]?.code ??
      "",
    taxTypeGstFree:
      rate("EXEMPTOUTPUT") ??
      options.taxRates.find(entry => entry.rate === 0)?.type ??
      "",
    taxTypeTaxable:
      rate("OUTPUT") ??
      options.taxRates.find(entry => entry.rate > 0)?.type ??
      "",
  };
}
