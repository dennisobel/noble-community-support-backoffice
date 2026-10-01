import type { ServiceUnit } from "../enums";
import { lineSubtotalCents, roundQuantity } from "./money";
import { durationHours } from "./time";

export interface BillableLineCents {
  label: string;
  unit: string;
  quantity: number;
  rateCents: number;
  subtotalCents: number;
}

export interface BillingService {
  name: string;
  unit: ServiceUnit;
  rateCents: number;
  transportEnabled: boolean;
}

export interface BillingInput {
  start: string;
  end: string;
  km: number;
  quantity?: number | null;
}

export const TRAVEL_LABEL = "Provider travel";

/**
 * Billable lines for a service record:
 * - the service line (hours for hourly services, otherwise the entered quantity, default 1)
 * - a provider travel line when kilometres are recorded and the service allows transport.
 */
export function computeBillables(
  input: BillingInput,
  service: BillingService,
  travelRateCents: number
): BillableLineCents[] {
  const quantity =
    service.unit === "Hour"
      ? durationHours(input.start, input.end)
      : roundQuantity(input.quantity ?? 1);
  const lines: BillableLineCents[] = [
    {
      label: service.name,
      unit: service.unit,
      quantity,
      rateCents: service.rateCents,
      subtotalCents: lineSubtotalCents(quantity, service.rateCents),
    },
  ];
  const km = roundQuantity(input.km || 0);
  if (km > 0 && service.transportEnabled) {
    lines.push({
      label: TRAVEL_LABEL,
      unit: "Kilometre",
      quantity: km,
      rateCents: travelRateCents,
      subtotalCents: lineSubtotalCents(km, travelRateCents),
    });
  }
  return lines;
}

export function totalCents(lines: Array<{ subtotalCents: number }>): number {
  return lines.reduce((sum, line) => sum + line.subtotalCents, 0);
}
