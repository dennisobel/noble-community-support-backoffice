import type { ClientBudget, RosterShift, ServiceRecord } from "./mock-data";
import type { serviceRates } from "./mock-data";

export type RateTable = typeof serviceRates;

export function durationHours(start: string, end: string) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 6) / 10);
}

export function budgetCategoryFor(serviceType: string) {
  if (serviceType === "Daily living skills") return "Daily living skills";
  if (serviceType === "Support coordination") return "Support coordination";
  return "Community participation";
}

export function shiftCostPerParticipant(shift: Pick<RosterShift, "start" | "end" | "type">, rates: RateTable) {
  const rate = rates.find(item => item.name === shift.type)?.rate ?? 68.3;
  return Math.round(durationHours(shift.start, shift.end) * rate * 100) / 100;
}

export function recordTotal(record: ServiceRecord) {
  return record.billables.reduce((sum, line) => sum + line.subtotal, 0);
}

export function computeBudgetMetrics(
  clientId: string,
  budget: ClientBudget,
  records: ServiceRecord[],
  shifts: RosterShift[],
  rates: RateTable,
  today: string,
  excludeShiftId?: string
) {
  const categories = budget.categories.map(category => {
    const relevantRecords = records.filter(record => record.clientId === clientId && budgetCategoryFor(record.type) === category.name);
    const relevantShifts = shifts.filter(shift => shift.id !== excludeShiftId && shift.clientIds.includes(clientId) && budgetCategoryFor(shift.type) === category.name && shift.date >= today && shift.status !== "Completed");
    const used = relevantRecords.filter(record => record.status === "Approved" || record.status === "Invoiced").reduce((sum, record) => sum + recordTotal(record), 0);
    const pending = relevantRecords.filter(record => record.status === "Submitted").reduce((sum, record) => sum + recordTotal(record), 0);
    const committed = relevantShifts.reduce((sum, shift) => sum + shiftCostPerParticipant(shift, rates), 0);
    return { ...category, used, pending, committed, remaining: category.allocation - used - pending - committed };
  });
  const allocation = categories.reduce((sum, category) => sum + category.allocation, 0);
  const used = categories.reduce((sum, category) => sum + category.used, 0);
  const pending = categories.reduce((sum, category) => sum + category.pending, 0);
  const committed = categories.reduce((sum, category) => sum + category.committed, 0);
  return { categories, allocation, used, pending, committed, remaining: allocation - used - pending - committed };
}
