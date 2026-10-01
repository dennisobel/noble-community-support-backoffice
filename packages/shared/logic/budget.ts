import type { RecordStatus, ShiftStatus } from "../enums";

export type BudgetStatus =
  | "Plan expired"
  | "Over allocation"
  | "Low balance"
  | "Within plan";

export interface BudgetRecordInput {
  date: string;
  status: RecordStatus;
  category: string;
  totalCents: number;
}

export interface BudgetShiftInput {
  id?: string;
  date: string;
  status: ShiftStatus;
  category: string;
  /** Cost attributed to this participant (hours × service rate). */
  costCents: number;
}

export interface BudgetMetricsInput {
  planStart: string;
  planEnd: string;
  today: string;
  categories: Array<{ name: string; allocationCents: number }>;
  records: BudgetRecordInput[];
  shifts: BudgetShiftInput[];
}

export interface CategoryMetricsCents {
  name: string;
  allocationCents: number;
  usedCents: number;
  pendingCents: number;
  committedCents: number;
  remainingCents: number;
}

export interface BudgetMetricsCents {
  categories: CategoryMetricsCents[];
  allocationCents: number;
  usedCents: number;
  pendingCents: number;
  committedCents: number;
  remainingCents: number;
  status: BudgetStatus;
}

export const LOW_BALANCE_RATIO = 0.15;

export function budgetStatus(
  planEnd: string,
  today: string,
  remainingCents: number,
  allocationCents: number
): BudgetStatus {
  if (planEnd < today) return "Plan expired";
  if (remainingCents < 0) return "Over allocation";
  if (remainingCents < allocationCents * LOW_BALANCE_RATIO)
    return "Low balance";
  return "Within plan";
}

/**
 * Budget metrics for one participant's plan, as of `today`:
 * used = Approved + Invoiced records, pending = Submitted records, committed = future Planned/Confirmed shifts.
 * Only items dated inside the plan window count. Activity in a category the plan does not fund is shown
 * as an extra category with a zero allocation so it is never silently ignored.
 */
export function computeBudgetMetrics(
  input: BudgetMetricsInput
): BudgetMetricsCents {
  const inWindow = (date: string) =>
    date >= input.planStart && date <= input.planEnd;
  const rows = new Map<string, CategoryMetricsCents>();
  const row = (name: string) => {
    let existing = rows.get(name);
    if (!existing) {
      existing = {
        name,
        allocationCents: 0,
        usedCents: 0,
        pendingCents: 0,
        committedCents: 0,
        remainingCents: 0,
      };
      rows.set(name, existing);
    }
    return existing;
  };
  for (const category of input.categories)
    row(category.name).allocationCents += category.allocationCents;

  for (const record of input.records) {
    if (!inWindow(record.date)) continue;
    if (record.status === "Approved" || record.status === "Invoiced")
      row(record.category).usedCents += record.totalCents;
    else if (record.status === "Submitted")
      row(record.category).pendingCents += record.totalCents;
  }
  for (const shift of input.shifts) {
    if (!inWindow(shift.date) || shift.date < input.today) continue;
    if (shift.status !== "Planned" && shift.status !== "Confirmed") continue;
    row(shift.category).committedCents += shift.costCents;
  }

  const categories = [...rows.values()].map(category => ({
    ...category,
    remainingCents:
      category.allocationCents -
      category.usedCents -
      category.pendingCents -
      category.committedCents,
  }));
  const sum = (key: keyof Omit<CategoryMetricsCents, "name">) =>
    categories.reduce((total, category) => total + category[key], 0);
  const allocationCents = sum("allocationCents");
  const remainingCents = sum("remainingCents");
  return {
    categories,
    allocationCents,
    usedCents: sum("usedCents"),
    pendingCents: sum("pendingCents"),
    committedCents: sum("committedCents"),
    remainingCents,
    status: budgetStatus(
      input.planEnd,
      input.today,
      remainingCents,
      allocationCents
    ),
  };
}
