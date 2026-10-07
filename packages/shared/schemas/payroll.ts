import { z } from "zod";
import { PAY_PERIOD_LENGTHS } from "../enums";
import { hasAtMostTwoDecimals } from "../logic/money";
import { hm, money, objectId, requiredText, rev, text, ymd } from "./common";

const percent = (max = 1000) =>
  z
    .number({ error: "Enter a percentage." })
    .min(0, { error: "A percentage cannot be negative." })
    .max(max, { error: `Enter ${max}% or less.` });
const hours = (max: number) =>
  z
    .number({ error: "Enter the hours as a number." })
    .min(0, { error: "Hours cannot be negative." })
    .max(max, { error: `Enter ${max} hours or fewer.` });

/** Every award percentage and threshold, plus the two dollar amounts that change each July. */
export const awardRulesSchema = z.object({
  casualLoadingPct: percent(100),
  saturdayPct: percent(),
  sundayPct: percent(),
  publicHolidayPct: percent(),
  afternoonLoadingPct: percent(100),
  nightLoadingPct: percent(100),
  spanStart: hm,
  spanEnd: hm,
  overtimeDailyHours: hours(24),
  overtimeWeeklyHours: hours(80),
  overtimeFirstPct: percent(),
  overtimeFirstHours: hours(12),
  overtimeAfterPct: percent(),
  overtimeSundayPct: percent(),
  overtimePublicHolidayPct: percent(),
  casualLoadingOnOvertime: z.boolean(),
  minimumEngagementHours: hours(8),
  brokenShiftGapMinutes: z.number().int().min(0).max(240),
  brokenShiftSpanHours: hours(24),
  brokenShiftBeyondSpanPct: percent(),
  brokenShiftOneBreakPct: percent(100),
  brokenShiftTwoBreaksPct: percent(100),
  sleepoverAllowancePct: percent(100),
  sleepoverMinimumMinutes: z.number().int().min(0).max(480),
  restBetweenShiftsHours: hours(24),
  annualLeaveLoadingPct: percent(100),
  /** The award's weekly standard rate, in dollars. 0 means "not entered yet". */
  standardRateWeekly: money("Enter the weekly standard rate."),
  /** Dollars per kilometre. 0 means "not entered yet". */
  vehicleAllowancePerKm: money("Enter the per-kilometre allowance."),
});
export type AwardRulesInput = z.input<typeof awardRulesSchema>;

const classification = z.object({
  /** Missing for a classification being added. */
  id: text(60).optional(),
  name: requiredText(80, "Give the classification a name."),
  rates: z
    .array(
      z.object({
        effectiveFrom: ymd,
        hourly: money("Enter the hourly rate."),
      })
    )
    .max(40),
});

export const paySettingsSchema = z.object({
  rules: awardRulesSchema.partial().optional(),
  classifications: z
    .array(classification)
    .max(80)
    .refine(
      list =>
        new Set(list.map(item => item.name.trim().toLowerCase())).size ===
        list.length,
      { error: "Each classification can appear only once." }
    )
    .optional(),
  publicHolidays: z
    .array(
      z.object({
        date: ymd,
        name: requiredText(80, "Name the public holiday."),
      })
    )
    .max(300)
    .optional(),
  payPeriod: z
    .object({
      length: z.enum(PAY_PERIOD_LENGTHS),
      /** The first day of any one pay period; every other period is counted from it. */
      anchor: ymd,
    })
    .optional(),
  /** Sign-on or sign-off this close to the roster is paid as rostered. */
  toleranceMinutes: z.number().int().min(0).max(60).optional(),
  rev,
});
export type PaySettingsInput = z.input<typeof paySettingsSchema>;

/** Any date inside the pay period being looked at; today's period when missing. */
export const payPeriodQuery = z.object({
  date: ymd.optional(),
  staffId: objectId.optional(),
});

/** The hours the office agrees to pay for one worker on one shift. */
export const timesheetApproveSchema = z.object({
  start: hm,
  end: hm,
  /** The finish time is on the day after the shift's date. */
  overnight: z.boolean().optional(),
  breakMinutes: z
    .number({ error: "Enter the break in minutes." })
    .int()
    .min(0)
    .max(600)
    .optional(),
  kilometres: z.number().min(0).max(5000).optional(),
  /** Time spent working during a sleepover. */
  sleepoverActiveMinutes: z.number().int().min(0).max(720).optional(),
  /** Pay a shift the client cancelled at short notice. */
  payCancelled: z.boolean().optional(),
  note: text(500).optional(),
});
export type TimesheetApproveInput = z.input<typeof timesheetApproveSchema>;

export const timesheetBulkSchema = z.object({
  date: ymd.optional(),
  staffId: objectId.optional(),
});

export const payRunCreateSchema = z.object({ date: ymd.optional() });

export const payAdjustmentSchema = z.object({
  staffId: objectId,
  label: requiredText(80, "Say what the adjustment is for."),
  /** Dollars; negative takes money off. */
  amount: z
    .number({ error: "Enter an amount." })
    .min(-100_000)
    .max(100_000)
    .refine(hasAtMostTwoDecimals, { error: "Use at most two decimal places." })
    .refine(value => value !== 0, { error: "Enter an amount other than zero." }),
});
export type PayAdjustmentInput = z.input<typeof payAdjustmentSchema>;

/** A pay rate agreed with one worker that replaces their classification's rate. null removes it. */
export const payRateSchema = z.object({
  payRateOverride: z.union([money("Enter the hourly rate."), z.null()]),
});
