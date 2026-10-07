import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type {
  AwardRulesDTO,
  PayClassificationDTO,
  PayClassificationOptionDTO,
  PayPeriodDTO,
  PaySettingsDTO,
  StaffPayDTO,
} from "@shared/dto";
import {
  DEFAULT_AWARD_RULES,
  payPeriodContaining,
  type AwardRules,
} from "@shared/logic/award";
import { fromCents, toCents } from "@shared/logic/money";
import { addDays, prettyDate } from "@shared/logic/time";
import type { payRateSchema, paySettingsSchema } from "@shared/schemas/payroll";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, assertRev, iso } from "../../lib/mappers";
import { workspaceToday } from "../../lib/workspace";
import {
  DEFAULT_PAY_ANCHOR,
  PAY_SETTINGS_ID,
  PaySettings,
  Staff,
  type PayClassificationSub,
  type PaySettingsDoc,
  type StaffDoc,
} from "../../models";

/** The one pay settings document, created with the award defaults the first time it is asked for. */
export async function paySettingsDoc(): Promise<PaySettingsDoc> {
  const existing =
    await PaySettings.findById(PAY_SETTINGS_ID).lean<PaySettingsDoc>();
  if (existing) return existing;
  await PaySettings.updateOne(
    { _id: PAY_SETTINGS_ID },
    {
      $setOnInsert: {
        rules: { ...DEFAULT_AWARD_RULES },
        classifications: [],
        publicHolidays: [],
        payPeriod: { length: "Fortnightly", anchor: DEFAULT_PAY_ANCHOR },
        toleranceMinutes: 10,
        updatedBy: null,
        rev: 0,
      },
    },
    { upsert: true }
  );
  const created =
    await PaySettings.findById(PAY_SETTINGS_ID).lean<PaySettingsDoc>();
  if (!created) throw new Error("Pay settings could not be created");
  return created;
}

/** A rule added to the award defaults after a workspace saved its settings still gets a value. */
export const rulesOf = (doc: PaySettingsDoc): AwardRules => ({
  ...DEFAULT_AWARD_RULES,
  ...(doc.rules ?? {}),
});

export const periodDays = (doc: PaySettingsDoc) =>
  doc.payPeriod?.length === "Weekly" ? 7 : 14;

/** The hourly rate in force on a date: the newest one that has started. */
export function rateOn(
  classification: PayClassificationSub | undefined,
  date: string
): number | null {
  if (!classification) return null;
  const started = classification.rates
    .filter(rate => rate.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return started.length ? started[0].hourlyCents : null;
}

/** Everything the pay engine needs from the settings, read once per request. */
export interface PayContext {
  doc: PaySettingsDoc;
  rules: AwardRules;
  holidays: Set<string>;
  classifications: Map<string, PayClassificationSub>;
  windowDays: number;
  toleranceMinutes: number;
}

export async function payContext(): Promise<PayContext> {
  const doc = await paySettingsDoc();
  return {
    doc,
    rules: rulesOf(doc),
    holidays: new Set((doc.publicHolidays ?? []).map(holiday => holiday.date)),
    classifications: new Map(
      (doc.classifications ?? []).map(item => [item.id, item])
    ),
    windowDays: periodDays(doc),
    toleranceMinutes: doc.toleranceMinutes ?? 10,
  };
}

/** The dates listed as public holidays, for anything that counts business days. */
export async function publicHolidaySet(): Promise<Set<string>> {
  return (await payContext()).holidays;
}

/** A worker's ordinary hourly rate on a date: their own agreed rate, or their classification's. */
export function baseRateOn(
  staff: Pick<StaffDoc, "employment">,
  date: string,
  context: Pick<PayContext, "classifications">
): number | null {
  const override = staff.employment?.payRateOverrideCents;
  if (override !== null && override !== undefined && override > 0)
    return override;
  const id = staff.employment?.classificationId;
  return id ? rateOn(context.classifications.get(id), date) : null;
}

export function periodFor(
  doc: PaySettingsDoc,
  date: string,
  today: string
): PayPeriodDTO {
  const { from, to } = payPeriodContaining(
    date,
    doc.payPeriod?.anchor ?? DEFAULT_PAY_ANCHOR,
    periodDays(doc)
  );
  return {
    from,
    to,
    length: doc.payPeriod?.length ?? "Fortnightly",
    label: `${prettyDate(from)} – ${prettyDate(to)}`,
    current: today >= from && today <= to,
  };
}

function toRulesDTO(rules: AwardRules): AwardRulesDTO {
  const { standardRateWeeklyCents, vehicleAllowanceCentsPerKm, ...rest } =
    rules;
  return {
    ...rest,
    standardRateWeekly: fromCents(standardRateWeeklyCents),
    vehicleAllowancePerKm: fromCents(vehicleAllowanceCentsPerKm),
  };
}

function toClassificationDTO(
  item: PayClassificationSub,
  today: string,
  staffCount: number
): PayClassificationDTO {
  const current = rateOn(item, today);
  return {
    id: item.id,
    name: item.name,
    rates: [...item.rates]
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
      .map(rate => ({
        effectiveFrom: rate.effectiveFrom,
        hourly: fromCents(rate.hourlyCents),
      })),
    currentRate: current === null ? null : fromCents(current),
    staffCount,
  };
}

/** What still has to be entered before the amounts a pay run shows can be relied on. */
async function setupGaps(
  context: PayContext,
  today: string,
  staff: StaffDoc[]
): Promise<string[]> {
  const gaps: string[] = [];
  const rated = [...context.classifications.values()].some(
    item => (rateOn(item, today) ?? 0) > 0
  );
  if (!rated)
    gaps.push(
      "No classification has an hourly rate yet. Add the rates from the current pay guide."
    );
  if (!context.rules.standardRateWeeklyCents)
    gaps.push(
      "The weekly standard rate is not entered, so broken shift and sleepover allowances are $0."
    );
  if (!context.rules.vehicleAllowanceCentsPerKm)
    gaps.push(
      "The per-kilometre vehicle allowance is not entered, so kilometres are paid at $0."
    );
  const year = today.slice(0, 4);
  if (![...context.holidays].some(date => date.startsWith(year)))
    gaps.push(
      `No public holidays are listed for ${year}, so no shift is paid at the public holiday rate.`
    );
  const unready = staff.filter(
    member =>
      member.status === "Active" &&
      (!member.employment?.kind || !baseRateOn(member, today, context))
  ).length;
  if (unready)
    gaps.push(
      `${unready} active team member${unready === 1 ? " has" : "s have"} no employment type or pay rate.`
    );
  return gaps;
}

export async function getPaySettings(): Promise<PaySettingsDTO> {
  const [context, today, staff] = await Promise.all([
    payContext(),
    workspaceToday(),
    Staff.find({}).select("status employment").lean<StaffDoc[]>(),
  ]);
  const { doc } = context;
  const counts = new Map<string, number>();
  for (const member of staff) {
    const id = member.employment?.classificationId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    rules: toRulesDTO(context.rules),
    classifications: (doc.classifications ?? [])
      .map(item => toClassificationDTO(item, today, counts.get(item.id) ?? 0))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true })),
    publicHolidays: [...(doc.publicHolidays ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(holiday => ({ date: holiday.date, name: holiday.name })),
    payPeriod: {
      length: doc.payPeriod?.length ?? "Fortnightly",
      anchor: doc.payPeriod?.anchor ?? DEFAULT_PAY_ANCHOR,
    },
    toleranceMinutes: context.toleranceMinutes,
    missing: await setupGaps(context, today, staff),
    updatedAt: iso(doc.updatedAt),
    updatedBy: actorDTO(doc.updatedBy),
    rev: doc.rev ?? 0,
  };
}

export async function updatePaySettings(
  input: z.output<typeof paySettingsSchema>,
  ctx: RequestContext
): Promise<PaySettingsDTO> {
  const doc = await paySettingsDoc();
  assertRev({ rev: doc.rev ?? 0 }, input.rev);
  const $set: Record<string, unknown> = { updatedBy: ctx.actor };

  if (input.rules) {
    const { standardRateWeekly, vehicleAllowancePerKm, ...rest } = input.rules;
    const rules: AwardRules = { ...rulesOf(doc), ...rest };
    if (standardRateWeekly !== undefined)
      rules.standardRateWeeklyCents = toCents(standardRateWeekly);
    if (vehicleAllowancePerKm !== undefined)
      rules.vehicleAllowanceCentsPerKm = toCents(vehicleAllowancePerKm);
    $set.rules = rules;
  }

  if (input.classifications) {
    const known = new Set((doc.classifications ?? []).map(item => item.id));
    const next: PayClassificationSub[] = input.classifications.map(item => {
      const dates = new Set(item.rates.map(rate => rate.effectiveFrom));
      if (dates.size !== item.rates.length)
        throw errors.validation(
          `${item.name} has two rates starting on the same date. Keep one.`
        );
      return {
        // Only an id this workspace issued is kept; anything else is a new classification.
        id: item.id && known.has(item.id) ? item.id : randomUUID().slice(0, 8),
        name: item.name,
        rates: item.rates
          .map(rate => ({
            effectiveFrom: rate.effectiveFrom,
            hourlyCents: toCents(rate.hourly),
          }))
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
      };
    });
    const kept = new Set(next.map(item => item.id));
    for (const removed of (doc.classifications ?? []).filter(
      item => !kept.has(item.id)
    )) {
      const inUse = await Staff.countDocuments({
        "employment.classificationId": removed.id,
      });
      if (inUse)
        throw errors.conflict(
          "CONFLICT",
          `“${removed.name}” is still the classification of ${inUse} team member${inUse === 1 ? "" : "s"}. Move them to another one before removing it.`
        );
    }
    $set.classifications = next;
  }

  if (input.publicHolidays) {
    const byDate = new Map(
      input.publicHolidays.map(holiday => [holiday.date, holiday.name])
    );
    $set.publicHolidays = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, name]) => ({ date, name }));
  }
  if (input.payPeriod) $set.payPeriod = input.payPeriod;
  if (input.toleranceMinutes !== undefined)
    $set.toleranceMinutes = input.toleranceMinutes;

  const updated = await PaySettings.findOneAndUpdate(
    { _id: PAY_SETTINGS_ID, rev: doc.rev ?? 0 },
    { $set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "payroll.settings_updated",
    entityType: "paySettings",
    entityId: PAY_SETTINGS_ID,
    summary: "updated the pay rules",
    meta: { fields: Object.keys(input).filter(key => key !== "rev") },
    ip: ctx.ip,
  });
  return getPaySettings();
}

/** Classification names without their rates, for whoever edits a team member's employment. */
export async function listClassificationOptions(): Promise<
  PayClassificationOptionDTO[]
> {
  const doc = await paySettingsDoc();
  return (doc.classifications ?? [])
    .map(item => ({ id: item.id, name: item.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

function toStaffPayDTO(
  member: StaffDoc,
  context: PayContext,
  today: string
): StaffPayDTO {
  const employment = member.employment;
  const classification = employment?.classificationId
    ? context.classifications.get(employment.classificationId)
    : undefined;
  const base = baseRateOn(member, today, context);
  const override = employment?.payRateOverrideCents ?? null;
  const missing = !employment?.kind
    ? "No employment type"
    : !base
      ? classification
        ? "The classification has no rate yet"
        : "No classification or agreed rate"
      : "";
  return {
    staffId: String(member._id),
    name: member.name,
    status: member.status,
    employmentType: employment?.kind ?? null,
    classificationId: classification ? classification.id : null,
    classificationName: classification?.name ?? "",
    contractedHours: employment?.contractedHours ?? 0,
    payrollId: employment?.payrollId ?? "",
    payRateOverride: override ? fromCents(override) : null,
    baseRate: base ? fromCents(base) : null,
    missing,
  };
}

/** The team as payroll sees it: who is ready to be paid, and at what rate. */
export async function listStaffPay(): Promise<StaffPayDTO[]> {
  const [context, today, staff] = await Promise.all([
    payContext(),
    workspaceToday(),
    Staff.find({}).sort({ name: 1 }).lean<StaffDoc[]>(),
  ]);
  return staff.map(member => toStaffPayDTO(member, context, today));
}

export async function setPayRate(
  staffId: string,
  input: z.output<typeof payRateSchema>,
  ctx: RequestContext
): Promise<StaffPayDTO> {
  const cents =
    input.payRateOverride === null ? null : toCents(input.payRateOverride);
  const updated = await Staff.findOneAndUpdate(
    { _id: staffId },
    {
      $set: { "employment.payRateOverrideCents": cents || null },
      $inc: { rev: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("Team member");
  await logActivity({
    actor: ctx.actor,
    action: "payroll.rate_changed",
    entityType: "staff",
    entityId: staffId,
    // The amount stays out of the audit summary: more people read the log than see pay rates.
    summary: cents
      ? `set an agreed pay rate for ${updated.name}`
      : `removed the agreed pay rate for ${updated.name}`,
    ip: ctx.ip,
  });
  return toStaffPayDTO(
    updated as StaffDoc,
    await payContext(),
    await workspaceToday()
  );
}

/** The pay period holding a date (today when none is given), and the one either side for the arrows. */
export async function periodAround(date?: string): Promise<{
  period: PayPeriodDTO;
  previous: string;
  next: string;
}> {
  const [doc, today] = await Promise.all([paySettingsDoc(), workspaceToday()]);
  const period = periodFor(doc, date ?? today, today);
  return {
    period,
    previous: addDays(period.from, -1),
    next: addDays(period.to, 1),
  };
}
