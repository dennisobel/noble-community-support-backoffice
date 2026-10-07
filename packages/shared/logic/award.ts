import type { EmploymentType, PayCode } from "../enums";
import { addDays, daysBetween, minutesOf, weekdayIndex } from "./time";

/**
 * Turns the hours a support worker was paid for into pay lines under the SCHADS Award
 * (Social, Community, Home Care and Disability Services Industry Award, MA000100).
 *
 * It is one pure function so the roster warnings, the timesheet breakdown and the pay run all
 * apply exactly the same rules. Every percentage and threshold is a setting: the award changes,
 * and each July the dollar amounts do. Nothing here knows a dollar value of its own.
 *
 * Worked out here: ordinary hours, the casual loading, Saturday, Sunday and public holiday rates,
 * afternoon and night shift loadings, daily and weekly (or fortnightly) overtime with its two tiers,
 * the minimum engagement, broken shifts (the allowance and the 12-hour span), sleepovers and the
 * per-kilometre vehicle allowance. Flagged for a person rather than paid: a short break between
 * shifts, and a broken shift that needs the worker's agreement.
 */

export interface AwardRules {
  /** Paid on top of the ordinary rate to casual employees instead of leave, as a percentage. */
  casualLoadingPct: number;
  /** Ordinary hours worked on these days, as a percentage of the ordinary rate. */
  saturdayPct: number;
  sundayPct: number;
  publicHolidayPct: number;
  /** A weekday shift finishing after the span ends and by midnight earns this on the whole shift. */
  afternoonLoadingPct: number;
  /** A weekday shift finishing after midnight or starting before the span opens earns this. */
  nightLoadingPct: number;
  /** The span of ordinary hours for a day worker, as HH:mm. */
  spanStart: string;
  spanEnd: string;
  /** Hours in one day before overtime starts. */
  overtimeDailyHours: number;
  /** Ordinary hours in a week before overtime starts (doubled for a fortnightly pay period). */
  overtimeWeeklyHours: number;
  overtimeFirstPct: number;
  /** How many overtime hours are paid at the first rate before the higher one applies. */
  overtimeFirstHours: number;
  overtimeAfterPct: number;
  overtimeSundayPct: number;
  overtimePublicHolidayPct: number;
  /** Whether casuals also get their loading on overtime hours. */
  casualLoadingOnOvertime: boolean;
  /** The least a part-time or casual worker is paid for one period of work, in hours. */
  minimumEngagementHours: number;
  /** A gap no longer than this between two periods of work is a meal break, not a broken shift. */
  brokenShiftGapMinutes: number;
  brokenShiftSpanHours: number;
  brokenShiftBeyondSpanPct: number;
  /** Allowances defined by the award as a percentage of the weekly standard rate. */
  brokenShiftOneBreakPct: number;
  brokenShiftTwoBreaksPct: number;
  sleepoverAllowancePct: number;
  /** Work during a sleepover is paid for at least this long. */
  sleepoverMinimumMinutes: number;
  restBetweenShiftsHours: number;
  annualLeaveLoadingPct: number;
  /** The award's weekly "standard rate" in cents. 0 means it has not been entered yet. */
  standardRateWeeklyCents: number;
  /** Paid per kilometre driven in the worker's own vehicle, in cents. 0 means not entered yet. */
  vehicleAllowanceCentsPerKm: number;
}

/**
 * The award's percentages and thresholds for disability support work. The two dollar amounts are
 * left at zero on purpose: they change every July and must come from the current pay guide.
 */
export const DEFAULT_AWARD_RULES: AwardRules = {
  casualLoadingPct: 25,
  saturdayPct: 150,
  sundayPct: 200,
  publicHolidayPct: 250,
  afternoonLoadingPct: 12.5,
  nightLoadingPct: 15,
  spanStart: "06:00",
  spanEnd: "20:00",
  overtimeDailyHours: 10,
  overtimeWeeklyHours: 38,
  overtimeFirstPct: 150,
  overtimeFirstHours: 2,
  overtimeAfterPct: 200,
  overtimeSundayPct: 200,
  overtimePublicHolidayPct: 250,
  casualLoadingOnOvertime: false,
  minimumEngagementHours: 2,
  brokenShiftGapMinutes: 60,
  brokenShiftSpanHours: 12,
  brokenShiftBeyondSpanPct: 200,
  brokenShiftOneBreakPct: 1.7,
  brokenShiftTwoBreaksPct: 2.25,
  sleepoverAllowancePct: 4.9,
  sleepoverMinimumMinutes: 60,
  restBetweenShiftsHours: 10,
  annualLeaveLoadingPct: 17.5,
  standardRateWeeklyCents: 0,
  vehicleAllowanceCentsPerKm: 0,
};

export const PAY_CODE_LABELS: Record<PayCode, string> = {
  ORD: "Ordinary hours",
  AFT: "Afternoon shift",
  NGT: "Night shift",
  SAT: "Saturday",
  SUN: "Sunday",
  PH: "Public holiday",
  OT1: "Overtime",
  OT2: "Overtime",
  OTS: "Overtime on a Sunday",
  OTP: "Overtime on a public holiday",
  SPAN: "Beyond the 12-hour span",
  MIN: "Minimum engagement top-up",
  BRK: "Broken shift allowance",
  SLP: "Sleepover allowance",
  KM: "Vehicle allowance",
  LEAVE: "Leave",
  LOAD: "Annual leave loading",
  ADJ: "Adjustment",
};

const OVERTIME_CODES: readonly PayCode[] = ["OT1", "OT2", "OTS", "OTP"];
const ORDINARY_CODES: readonly PayCode[] = [
  "ORD",
  "AFT",
  "NGT",
  "SAT",
  "SUN",
  "PH",
  "SPAN",
];

/** One stretch of paid time: a rostered shift as it was worked and approved. */
export interface WorkPeriod {
  /** Ties the pay lines back to where they came from (the shift id). */
  key: string;
  /** The local date the period starts on. */
  date: string;
  /** Minutes past midnight on `date`. */
  startMin: number;
  /** Later than `startMin`; more than 1440 when the period runs past midnight. */
  endMin: number;
  /** Unpaid break taken inside the period. */
  breakMinutes: number;
  /** Paid as a sleepover allowance instead of by the hour. */
  sleepover?: boolean;
  /** Time spent working during a sleepover. */
  activeMinutes?: number;
  kilometres?: number;
  /** The rostered length, when known. A full-timer's time beyond it is overtime. */
  rosteredMinutes?: number;
  /** The worker's ordinary hourly rate on this date, in cents. */
  baseRateCents: number;
}

export interface PayLine {
  key: string;
  date: string;
  code: PayCode;
  label: string;
  /** Paid time on this line; 0 for allowances. */
  minutes: number;
  /** A count that is not time, such as kilometres. */
  units: number | null;
  /** Percentage of the ordinary rate; 0 for allowances. */
  pct: number;
  /** The hourly (or per-unit) rate paid, in cents. */
  rateCents: number;
  amountCents: number;
  /** The rule that produced this line, in plain words. */
  why: string;
}

export interface PayFlag {
  key: string;
  date: string;
  level: "info" | "warning";
  message: string;
  /** For a short break between shifts: the shift that came before, and how long the break was. */
  afterKey?: string;
  restMinutes?: number;
}

export interface InterpretInput {
  employmentType: EmploymentType;
  periods: WorkPeriod[];
  rules: AwardRules;
  publicHolidays: Iterable<string>;
  /** The first day of an overtime window. Windows repeat from here in both directions. */
  windowStart: string;
  /** 7 for a weekly pay period, 14 for a fortnightly one. */
  windowDays: number;
}

export interface PayTotals {
  /** Time actually worked (a minimum-engagement top-up is paid but not worked). */
  workedMinutes: number;
  paidMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  allowanceCents: number;
  grossCents: number;
}

export interface InterpretResult {
  lines: PayLine[];
  flags: PayFlag[];
  totals: PayTotals;
}

const DAY = 1440;

type DayType = "weekday" | "saturday" | "sunday" | "holiday";
type ShiftType = "day" | "afternoon" | "night";

interface Rate {
  code: PayCode;
  pct: number;
  why: string;
}

interface Interval {
  key: string;
  a: number;
  b: number;
  base: number;
}

interface Block {
  a: number;
  b: number;
  firstKey: string;
  lastKey: string;
  intervals: Interval[];
  rostered: number;
  rosteredKnown: boolean;
}

const trim = (value: number) => String(Math.round(value * 100) / 100);

/** "8 h 30 min" from 510 minutes. */
export function hoursLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function sumTotals(lines: PayLine[]): PayTotals {
  const totals: PayTotals = {
    workedMinutes: 0,
    paidMinutes: 0,
    ordinaryMinutes: 0,
    overtimeMinutes: 0,
    allowanceCents: 0,
    grossCents: 0,
  };
  for (const line of lines) {
    totals.grossCents += line.amountCents;
    if (ORDINARY_CODES.includes(line.code)) {
      totals.ordinaryMinutes += line.minutes;
      totals.workedMinutes += line.minutes;
      totals.paidMinutes += line.minutes;
    } else if (OVERTIME_CODES.includes(line.code)) {
      totals.overtimeMinutes += line.minutes;
      totals.workedMinutes += line.minutes;
      totals.paidMinutes += line.minutes;
    } else if (line.code === "MIN" || line.code === "LEAVE") {
      totals.paidMinutes += line.minutes;
    } else {
      totals.allowanceCents += line.amountCents;
    }
  }
  return totals;
}

export function interpretPay(input: InterpretInput): InterpretResult {
  const { rules, employmentType } = input;
  const holidays = new Set(input.publicHolidays);
  const casual = employmentType === "Casual";
  const origin = input.windowStart;
  const windowMinutes = Math.max(1, Math.round(input.windowDays)) * DAY;
  const windowLimit =
    rules.overtimeWeeklyHours * 60 * (Math.max(1, input.windowDays) / 7);
  const windowWord =
    input.windowDays >= 14
      ? `${trim(rules.overtimeWeeklyHours * (input.windowDays / 7))} hours in the fortnight`
      : `${trim(rules.overtimeWeeklyHours)} hours in the week`;
  const spanStartMin = minutesOf(rules.spanStart);
  const spanEndMin = minutesOf(rules.spanEnd);
  const gap = Math.max(0, rules.brokenShiftGapMinutes);
  const loading = casual
    ? ` plus the ${trim(rules.casualLoadingPct)}% casual loading`
    : "";

  const absolute = (date: string, minutes: number) =>
    daysBetween(origin, date) * DAY + minutes;
  const dateAt = (t: number) => addDays(origin, Math.floor(t / DAY));
  const dayTypeAt = (t: number): DayType => {
    const date = dateAt(t);
    if (holidays.has(date)) return "holiday";
    const weekday = weekdayIndex(date);
    return weekday === 5 ? "saturday" : weekday === 6 ? "sunday" : "weekday";
  };

  const flags: PayFlag[] = [];
  const merged = new Map<string, { line: PayLine; base: number }>();
  /** Adds minutes to the line for this period, date and rate, creating it the first time. */
  const addTime = (
    key: string,
    t: number,
    rate: Rate,
    minutes: number,
    base: number
  ) => {
    if (minutes <= 0) return;
    const date = dateAt(t);
    const id = `${key}|${date}|${rate.code}|${rate.pct}|${base}|${rate.why}`;
    const existing = merged.get(id);
    if (existing) {
      existing.line.minutes += minutes;
      return;
    }
    merged.set(id, {
      base,
      line: {
        key,
        date,
        code: rate.code,
        label: `${PAY_CODE_LABELS[rate.code]} (${trim(rate.pct)}%)`,
        minutes,
        units: null,
        pct: rate.pct,
        rateCents: Math.round((base * rate.pct) / 100),
        amountCents: 0,
        why: rate.why,
      },
    });
  };
  const extras: PayLine[] = [];
  const addAllowance = (
    key: string,
    date: string,
    code: PayCode,
    label: string,
    amountCents: number,
    why: string,
    units: number | null = null,
    rateCents = amountCents
  ) =>
    extras.push({
      key,
      date,
      code,
      label,
      minutes: 0,
      units,
      pct: 0,
      rateCents,
      amountCents,
      why,
    });

  const ordinaryRate = (dayType: DayType, shiftType: ShiftType): Rate => {
    const withLoading = (code: PayCode, pct: number, why: string): Rate => ({
      code,
      pct: casual ? pct + rules.casualLoadingPct : pct,
      why: `${why}${loading}.`,
    });
    if (dayType === "holiday")
      return withLoading(
        "PH",
        rules.publicHolidayPct,
        `Worked on a public holiday: ${trim(rules.publicHolidayPct)}% of the ordinary rate`
      );
    if (dayType === "sunday")
      return withLoading(
        "SUN",
        rules.sundayPct,
        `Worked on a Sunday: ${trim(rules.sundayPct)}% of the ordinary rate`
      );
    if (dayType === "saturday")
      return withLoading(
        "SAT",
        rules.saturdayPct,
        `Worked on a Saturday: ${trim(rules.saturdayPct)}% of the ordinary rate`
      );
    if (shiftType === "night")
      return withLoading(
        "NGT",
        100 + rules.nightLoadingPct,
        `Night shift (finishes after midnight or starts before ${rules.spanStart}): a ${trim(rules.nightLoadingPct)}% loading on the whole shift`
      );
    if (shiftType === "afternoon")
      return withLoading(
        "AFT",
        100 + rules.afternoonLoadingPct,
        `Afternoon shift (finishes after ${rules.spanEnd}): a ${trim(rules.afternoonLoadingPct)}% loading on the whole shift`
      );
    return withLoading("ORD", 100, "Ordinary hours at the ordinary rate");
  };

  const overtimeLoading =
    casual && rules.casualLoadingOnOvertime ? rules.casualLoadingPct : 0;
  const overtimeRate = (
    dayType: DayType,
    tier: 1 | 2,
    reason: string
  ): Rate => {
    if (dayType === "holiday")
      return {
        code: "OTP",
        pct: rules.overtimePublicHolidayPct + overtimeLoading,
        why: `Overtime on a public holiday (${reason}): ${trim(rules.overtimePublicHolidayPct)}%.`,
      };
    if (dayType === "sunday")
      return {
        code: "OTS",
        pct: rules.overtimeSundayPct + overtimeLoading,
        why: `Overtime on a Sunday (${reason}): ${trim(rules.overtimeSundayPct)}%.`,
      };
    return tier === 1
      ? {
          code: "OT1",
          pct: rules.overtimeFirstPct + overtimeLoading,
          why: `Overtime (${reason}): ${trim(rules.overtimeFirstPct)}% for the first ${trim(rules.overtimeFirstHours)} hours.`,
        }
      : {
          code: "OT2",
          pct: rules.overtimeAfterPct + overtimeLoading,
          why: `Overtime (${reason}): ${trim(rules.overtimeAfterPct)}% after the first ${trim(rules.overtimeFirstHours)} hours.`,
        };
  };

  const shiftTypeOf = (a: number, b: number): ShiftType => {
    const midnight = Math.floor(a / DAY) * DAY;
    if (b > midnight + DAY || a - midnight < spanStartMin) return "night";
    if (b - midnight > spanEndMin) return "afternoon";
    return "day";
  };

  const timed = input.periods
    .filter(period => period.endMin > period.startMin)
    .map(period => ({
      period,
      a: absolute(period.date, period.startMin),
      b: absolute(period.date, period.endMin),
    }))
    .sort((x, y) => x.a - y.a || x.b - y.b);

  /* Periods of work joined into blocks: a gap no longer than a meal break does not split a shift. */
  const blocks: Block[] = [];
  for (const { period, a, b } of timed) {
    if (period.sleepover) continue;
    const last = blocks[blocks.length - 1];
    const joins = last !== undefined && a - last.b <= gap;
    // Time already paid in the block before is never paid twice.
    const start = joins && a < last.b ? last.b : a;
    if (start > a)
      flags.push({
        key: period.key,
        date: period.date,
        level: "warning",
        message:
          "This overlaps the shift before it. The overlap is paid once.",
      });
    const length = Math.max(0, b - start);
    const unpaid = Math.min(Math.max(0, period.breakMinutes), length);
    const firstHalf = Math.floor((length - unpaid) / 2);
    const intervals: Interval[] = (
      unpaid
        ? [
            { a: start, b: start + firstHalf },
            { a: start + firstHalf + unpaid, b },
          ]
        : [{ a: start, b }]
    )
      .filter(interval => interval.b > interval.a)
      .map(interval => ({
        ...interval,
        key: period.key,
        base: period.baseRateCents,
      }));
    const rostered = period.rosteredMinutes ?? 0;
    if (joins) {
      last.b = Math.max(last.b, b);
      last.lastKey = period.key;
      last.intervals.push(...intervals);
      last.rostered += rostered;
      last.rosteredKnown = last.rosteredKnown && rostered > 0;
    } else {
      blocks.push({
        a,
        b,
        firstKey: period.key,
        lastKey: period.key,
        intervals,
        rostered,
        rosteredKnown: rostered > 0,
      });
    }
  }

  /* Blocks starting on the same day are one shift; more than one block makes it a broken shift. */
  const shifts: Block[][] = [];
  for (const block of blocks) {
    const current = shifts[shifts.length - 1];
    if (current && Math.floor(current[0].a / DAY) === Math.floor(block.a / DAY))
      current.push(block);
    else shifts.push([block]);
  }

  const windowOrdinary = new Map<number, number>();
  for (const shift of shifts) {
    const breaks = shift.length - 1;
    const spanLimit = shift[0].a + rules.brokenShiftSpanHours * 60;
    const cap = rules.overtimeDailyHours * 60;
    const rostered = shift.reduce((sum, block) => sum + block.rostered, 0);
    const rosteredKnown = shift.every(block => block.rosteredKnown);
    // A full-timer's ordinary hours for the day are the ones they were rostered.
    const useRostered =
      employmentType === "Full-time" && rosteredKnown && rostered < cap;
    const dailyLimit = useRostered ? rostered : cap;
    const dailyReason = useRostered
      ? "beyond the rostered hours"
      : `over ${trim(rules.overtimeDailyHours)} hours in the day`;
    let worked = 0;
    let firstTierLeft = rules.overtimeFirstHours * 60;

    for (const block of shift) {
      const shiftType = shiftTypeOf(block.a, block.b);
      let blockPaid = 0;
      let lastSlice: { t: number; key: string; base: number } | null = null;

      for (const interval of block.intervals) {
        let t = interval.a;
        while (t < interval.b) {
          let end = Math.min(interval.b, (Math.floor(t / DAY) + 1) * DAY);
          if (breaks > 0 && t < spanLimit && spanLimit < end) end = spanLimit;
          const length = end - t;
          const dayType = dayTypeAt(t);
          const beyondSpan = breaks > 0 && t >= spanLimit;
          const windowIndex = Math.floor(t / windowMinutes);
          const usedInWindow = windowOrdinary.get(windowIndex) ?? 0;
          const dailyLeft = dailyLimit - worked;
          const windowLeft = windowLimit - usedInWindow;
          const ordinary = Math.max(0, Math.min(length, dailyLeft, windowLeft));
          const overtime = length - ordinary;
          const spanRate: Rate = {
            code: "SPAN",
            pct: rules.brokenShiftBeyondSpanPct + overtimeLoading,
            why: `Worked more than ${trim(rules.brokenShiftSpanHours)} hours after a broken shift began: ${trim(rules.brokenShiftBeyondSpanPct)}%.`,
          };
          /** Past the span of a broken shift everything is paid at the span rate, unless it already earns more. */
          const pay = (rate: Rate, minutes: number) =>
            addTime(
              interval.key,
              t,
              beyondSpan && spanRate.pct > rate.pct ? spanRate : rate,
              minutes,
              interval.base
            );

          if (ordinary > 0) {
            pay(ordinaryRate(dayType, shiftType), ordinary);
            windowOrdinary.set(windowIndex, usedInWindow + ordinary);
          }
          if (overtime > 0) {
            const reason =
              dailyLeft <= windowLeft ? dailyReason : `over ${windowWord}`;
            if (dayType === "holiday" || dayType === "sunday") {
              pay(overtimeRate(dayType, 1, reason), overtime);
            } else {
              const first = Math.min(overtime, Math.max(0, firstTierLeft));
              pay(overtimeRate(dayType, 1, reason), first);
              pay(overtimeRate(dayType, 2, reason), overtime - first);
              firstTierLeft -= first;
            }
          }
          worked += length;
          blockPaid += length;
          lastSlice = { t, key: interval.key, base: interval.base };
          t = end;
        }
      }

      const minimum = rules.minimumEngagementHours * 60;
      if (
        employmentType !== "Full-time" &&
        lastSlice &&
        blockPaid > 0 &&
        blockPaid < minimum
      ) {
        const usual = ordinaryRate(dayTypeAt(lastSlice.t), shiftType);
        addTime(
          lastSlice.key,
          lastSlice.t,
          {
            code: "MIN",
            pct: usual.pct,
            why: `Shorter than the ${trim(rules.minimumEngagementHours)}-hour minimum for a part-time or casual worker, so the shortfall is paid at the rate of the shift.`,
          },
          minimum - blockPaid,
          lastSlice.base
        );
      }
    }

    if (breaks > 0) {
      const second = shift[1];
      const date = dateAt(shift[0].a);
      const twoBreaks = breaks >= 2;
      const pct = twoBreaks
        ? rules.brokenShiftTwoBreaksPct
        : rules.brokenShiftOneBreakPct;
      addAllowance(
        second.firstKey,
        date,
        "BRK",
        twoBreaks
          ? "Broken shift allowance (2 breaks)"
          : "Broken shift allowance (1 break)",
        Math.round((rules.standardRateWeeklyCents * pct) / 100),
        `${shift.length} periods of work in one day with ${twoBreaks ? "unpaid breaks" : "an unpaid break"} between them: ${trim(pct)}% of the standard rate.`
      );
      if (!rules.standardRateWeeklyCents)
        flags.push({
          key: second.firstKey,
          date,
          level: "warning",
          message:
            "The standard rate is not set in Pay rules, so the broken shift allowance is $0.",
        });
      if (twoBreaks)
        flags.push({
          key: shift[2].firstKey,
          date,
          level: breaks > 2 ? "warning" : "info",
          message:
            breaks > 2
              ? "More than two unpaid breaks in one shift. The award allows two at most."
              : "A broken shift with two unpaid breaks needs the worker's agreement.",
        });
    }
  }

  /* Sleepovers: an allowance for the night, and overtime rates for any time spent working. */
  const sleepovers: Array<{
    a: number;
    b: number;
    key: string;
    base: number;
    active: number;
  }> = [];
  for (const { period, a, b } of timed) {
    if (!period.sleepover) continue;
    const last = sleepovers[sleepovers.length - 1];
    if (last && a - last.b <= gap) {
      last.b = Math.max(last.b, b);
      last.active += period.activeMinutes ?? 0;
    } else {
      sleepovers.push({
        a,
        b,
        key: period.key,
        base: period.baseRateCents,
        active: period.activeMinutes ?? 0,
      });
    }
  }
  for (const sleepover of sleepovers) {
    const date = dateAt(sleepover.a);
    addAllowance(
      sleepover.key,
      date,
      "SLP",
      PAY_CODE_LABELS.SLP,
      Math.round(
        (rules.standardRateWeeklyCents * rules.sleepoverAllowancePct) / 100
      ),
      `Sleepover: ${trim(rules.sleepoverAllowancePct)}% of the standard rate for the night.`
    );
    if (!rules.standardRateWeeklyCents)
      flags.push({
        key: sleepover.key,
        date,
        level: "warning",
        message:
          "The standard rate is not set in Pay rules, so the sleepover allowance is $0.",
      });
    if (sleepover.active > 0) {
      const paid = Math.max(sleepover.active, rules.sleepoverMinimumMinutes);
      const dayType = dayTypeAt(sleepover.a);
      const reason = "work during a sleepover";
      if (dayType === "holiday" || dayType === "sunday") {
        addTime(
          sleepover.key,
          sleepover.a,
          overtimeRate(dayType, 1, reason),
          paid,
          sleepover.base
        );
      } else {
        const first = Math.min(paid, rules.overtimeFirstHours * 60);
        addTime(
          sleepover.key,
          sleepover.a,
          overtimeRate(dayType, 1, reason),
          first,
          sleepover.base
        );
        addTime(
          sleepover.key,
          sleepover.a,
          overtimeRate(dayType, 2, reason),
          paid - first,
          sleepover.base
        );
      }
    }
  }

  /* Kilometres driven in the worker's own vehicle. */
  for (const { period } of timed) {
    const km = period.kilometres ?? 0;
    if (km <= 0) continue;
    addAllowance(
      period.key,
      period.date,
      "KM",
      `Vehicle allowance (${trim(km)} km)`,
      Math.round(km * rules.vehicleAllowanceCentsPerKm),
      "Kilometres driven in the worker's own vehicle, at the per-kilometre allowance.",
      km,
      rules.vehicleAllowanceCentsPerKm
    );
    if (!rules.vehicleAllowanceCentsPerKm)
      flags.push({
        key: period.key,
        date: period.date,
        level: "warning",
        message:
          "The per-kilometre allowance is not set in Pay rules, so kilometres are paid at $0.",
      });
  }

  /* The break between one shift and the next. A sleepover in between is not a gap in the roster. */
  for (let index = 1; index < shifts.length; index += 1) {
    const before = shifts[index - 1];
    const next = shifts[index];
    const ended = before[before.length - 1].b;
    const rest = next[0].a - ended;
    if (rest >= rules.restBetweenShiftsHours * 60) continue;
    const slept = sleepovers.some(
      sleepover =>
        sleepover.a >= ended - gap && sleepover.b <= next[0].a + gap
    );
    if (slept) continue;
    flags.push({
      key: next[0].firstKey,
      date: dateAt(next[0].a),
      level: "warning",
      message: `Only ${hoursLabel(rest)} since the previous shift ended. The award asks for a ${trim(rules.restBetweenShiftsHours)}-hour break.`,
      afterKey: before[before.length - 1].lastKey,
      restMinutes: rest,
    });
  }

  // Hours × the ordinary rate × the percentage, rounded to the cent once per line.
  const lines = [...merged.values()].map(({ line, base }) => ({
    ...line,
    amountCents: Math.round((line.minutes * base * line.pct) / 6000),
  }));
  const all = [...lines, ...extras].sort(
    (x, y) =>
      x.date.localeCompare(y.date) ||
      x.key.localeCompare(y.key) ||
      rank(x.code) - rank(y.code)
  );
  return { lines: all, flags, totals: sumTotals(all) };
}

const ORDER: readonly PayCode[] = [
  "ORD",
  "AFT",
  "NGT",
  "SAT",
  "SUN",
  "PH",
  "SPAN",
  "OT1",
  "OT2",
  "OTS",
  "OTP",
  "MIN",
  "SLP",
  "BRK",
  "KM",
  "LEAVE",
  "LOAD",
  "ADJ",
];
const rank = (code: PayCode) => ORDER.indexOf(code);

/**
 * What a rostered shift will cost, in words, for the roster's warnings. No dollar amounts:
 * the people who build rosters do not all see pay rates.
 */
export function shiftCostNotes(
  result: InterpretResult,
  key: string,
  rules: AwardRules
): string[] {
  const lines = result.lines.filter(line => line.key === key);
  const has = (code: PayCode) => lines.find(line => line.code === code);
  const notes: string[] = [];
  const holiday = has("PH");
  const sunday = has("SUN");
  const saturday = has("SAT");
  if (holiday)
    notes.push(`is on a public holiday, paid at ${trim(holiday.pct)}%`);
  else if (sunday) notes.push(`is on a Sunday, paid at ${trim(sunday.pct)}%`);
  else if (saturday)
    notes.push(`is on a Saturday, paid at ${trim(saturday.pct)}%`);
  const night = has("NGT");
  const afternoon = has("AFT");
  if (night)
    notes.push(
      `counts as a night shift (${trim(rules.nightLoadingPct)}% loading)`
    );
  else if (afternoon)
    notes.push(
      `counts as an afternoon shift (${trim(rules.afternoonLoadingPct)}% loading)`
    );
  const overtime = lines
    .filter(line => OVERTIME_CODES.includes(line.code))
    .reduce((sum, line) => sum + line.minutes, 0);
  if (overtime) notes.push(`includes ${hoursLabel(overtime)} of overtime`);
  if (has("SPAN"))
    notes.push(
      `runs past the ${trim(rules.brokenShiftSpanHours)}-hour span of a broken shift (paid at ${trim(rules.brokenShiftBeyondSpanPct)}%)`
    );
  if (has("MIN"))
    notes.push(
      `is under the ${trim(rules.minimumEngagementHours)}-hour minimum, so ${trim(rules.minimumEngagementHours)} hours are paid`
    );
  if (has("BRK"))
    notes.push("makes a broken shift, so the broken shift allowance applies");
  return notes;
}

/** The pay period that holds `date`, counting whole periods from an anchor date. */
export function payPeriodContaining(
  date: string,
  anchor: string,
  days: number
): { from: string; to: string } {
  const length = Math.max(1, Math.round(days));
  const index = Math.floor(daysBetween(anchor, date) / length);
  const from = addDays(anchor, index * length);
  return { from, to: addDays(from, length - 1) };
}
