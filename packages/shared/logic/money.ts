/** Money is stored as integer cents; the API speaks dollars with at most two decimals. */

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Subtotal of a line in cents, rounded to the nearest cent. */
export function lineSubtotalCents(quantity: number, rateCents: number): number {
  return Math.round(quantity * rateCents);
}

export function roundQuantity(quantity: number): number {
  return Math.round(quantity * 100) / 100;
}

export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function formatMoney(dollars: number): string {
  return currency.format(dollars);
}
