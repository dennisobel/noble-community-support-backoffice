import { describe, expect, it } from "vitest";
import type { EmploymentType, PayCode } from "@shared/enums";
import {
  DEFAULT_AWARD_RULES,
  interpretPay,
  payPeriodContaining,
  shiftCostNotes,
  type AwardRules,
  type InterpretResult,
  type WorkPeriod,
} from "@shared/logic/award";
import {
  addBusinessDays,
  easterSunday,
  nationalHolidays,
} from "@shared/logic/holidays";
import { localParts, zonedInstant } from "@shared/logic/time";

/*
 * The pay engine against the SCHADS rules, at $30.00 an hour so the sums can be read off.
 * The standard rate and the per-kilometre allowance are round test figures, not award values.
 */

const MON = "2026-10-05";
const TUE = "2026-10-06";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const BASE = 3000;

const RULES: AwardRules = {
  ...DEFAULT_AWARD_RULES,
  standardRateWeeklyCents: 120_000,
  vehicleAllowanceCentsPerKm: 100,
};

const at = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** A period of work from clock times; a finish before the start means the next day. */
function shift(
  key: string,
  date: string,
  start: string,
  end: string,
  extra: Partial<WorkPeriod> = {}
): WorkPeriod {
  const startMin = at(start);
  const endMin = at(end) <= startMin ? at(end) + 1440 : at(end);
  return {
    key,
    date,
    startMin,
    endMin,
    breakMinutes: 0,
    baseRateCents: BASE,
    ...extra,
  };
}

function pay(
  employmentType: EmploymentType,
  periods: WorkPeriod[],
  options: { holidays?: string[]; windowDays?: number; rules?: AwardRules } = {}
): InterpretResult {
  return interpretPay({
    employmentType,
    periods,
    rules: options.rules ?? RULES,
    publicHolidays: options.holidays ?? [],
    windowStart: MON,
    windowDays: options.windowDays ?? 7,
  });
}

/** Minutes and cents paid under one code, added up across the lines. */
function line(result: InterpretResult, code: PayCode, key?: string) {
  const lines = result.lines.filter(
    item => item.code === code && (!key || item.key === key)
  );
  return {
    count: lines.length,
    minutes: lines.reduce((sum, item) => sum + item.minutes, 0),
    cents: lines.reduce((sum, item) => sum + item.amountCents, 0),
    pct: lines[0]?.pct,
  };
}

describe("ordinary hours and loadings", () => {
  it("pays a weekday shift at the ordinary rate, less the unpaid break", () => {
    const result = pay("Part-time", [
      shift("a", MON, "09:00", "17:00", { breakMinutes: 30 }),
    ]);
    expect(line(result, "ORD")).toMatchObject({ minutes: 450, cents: 22_500 });
    expect(result.totals).toMatchObject({
      workedMinutes: 450,
      ordinaryMinutes: 450,
      overtimeMinutes: 0,
      grossCents: 22_500,
    });
    expect(result.flags).toEqual([]);
  });

  it("adds the casual loading to ordinary hours", () => {
    const result = pay("Casual", [shift("a", MON, "09:00", "17:00")]);
    expect(line(result, "ORD")).toMatchObject({
      minutes: 480,
      cents: 30_000,
      pct: 125,
    });
  });

  it("pays Saturday, Sunday and public holiday rates, with the loading on top for casuals", () => {
    const week = [
      shift("sat", SAT, "09:00", "13:00"),
      shift("sun", SUN, "09:00", "13:00"),
      shift("hol", TUE, "09:00", "13:00"),
    ];
    const permanent = pay("Part-time", week, { holidays: [TUE] });
    expect(line(permanent, "SAT")).toMatchObject({ cents: 18_000, pct: 150 });
    expect(line(permanent, "SUN")).toMatchObject({ cents: 24_000, pct: 200 });
    expect(line(permanent, "PH")).toMatchObject({ cents: 30_000, pct: 250 });

    const casual = pay("Casual", week, { holidays: [TUE] });
    expect(line(casual, "SAT").pct).toBe(175);
    expect(line(casual, "SUN").pct).toBe(225);
    expect(line(casual, "PH")).toMatchObject({ cents: 33_000, pct: 275 });
  });

  it("puts the afternoon loading on the whole of a shift that finishes after 8 pm", () => {
    const late = pay("Part-time", [shift("a", MON, "14:00", "22:00")]);
    expect(line(late, "AFT")).toMatchObject({
      minutes: 480,
      cents: 27_000,
      pct: 112.5,
    });
    // Finishing at 8 pm exactly is still a day shift.
    const day = pay("Part-time", [shift("a", MON, "12:00", "20:00")]);
    expect(line(day, "AFT").count).toBe(0);
    expect(line(day, "ORD").minutes).toBe(480);
  });

  it("treats a shift that starts before 6 am or runs past midnight as a night shift", () => {
    const early = pay("Part-time", [shift("a", MON, "05:00", "13:00")]);
    expect(line(early, "NGT")).toMatchObject({ minutes: 480, pct: 115 });

    // The roster holds an overnight shift as two halves; they are paid as one night shift.
    const overnight = pay("Part-time", [
      shift("a", MON, "22:00", "23:59"),
      shift("b", TUE, "00:00", "06:00"),
    ]);
    expect(line(overnight, "NGT").minutes).toBe(119 + 360);
    expect(line(overnight, "AFT").count).toBe(0);
    expect(line(overnight, "MIN").count).toBe(0);
    expect(line(overnight, "BRK").count).toBe(0);
    expect(overnight.flags).toEqual([]);
  });

  it("splits a Friday night shift at midnight: night loading, then the Saturday rate", () => {
    const result = pay("Part-time", [shift("a", FRI, "20:00", "04:00")]);
    expect(line(result, "NGT")).toMatchObject({ minutes: 240, pct: 115 });
    expect(line(result, "SAT")).toMatchObject({ minutes: 240, pct: 150 });
  });
});

describe("overtime", () => {
  it("starts after ten hours in a day, at 150% for two hours and 200% after", () => {
    const result = pay("Part-time", [shift("a", MON, "06:00", "19:00")]);
    expect(line(result, "ORD").minutes).toBe(600);
    expect(line(result, "OT1")).toMatchObject({ minutes: 120, cents: 9_000 });
    expect(line(result, "OT2")).toMatchObject({ minutes: 60, cents: 6_000 });
    expect(result.totals.overtimeMinutes).toBe(180);
  });

  it("starts after 38 hours in a week, and after 76 in a fortnight", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", FRI];
    const week = days.map((date, index) =>
      shift(`d${index}`, date, "08:00", "16:00")
    );
    const weekly = pay("Part-time", week);
    expect(weekly.totals.ordinaryMinutes).toBe(38 * 60);
    expect(line(weekly, "OT1", "d4").minutes).toBe(120);

    const fortnightly = pay("Part-time", week, { windowDays: 14 });
    expect(fortnightly.totals.overtimeMinutes).toBe(0);
  });

  it("pays overtime on a Sunday at 200% and on a public holiday at 250%, with no casual loading", () => {
    const sunday = pay("Casual", [shift("a", SUN, "06:00", "18:00")]);
    expect(line(sunday, "SUN")).toMatchObject({ minutes: 600, pct: 225 });
    expect(line(sunday, "OTS")).toMatchObject({ minutes: 120, pct: 200 });

    const holiday = pay("Casual", [shift("a", MON, "06:00", "18:00")], {
      holidays: [MON],
    });
    expect(line(holiday, "OTP")).toMatchObject({ minutes: 120, pct: 250 });

    const loaded = pay("Casual", [shift("a", MON, "06:00", "18:00")], {
      rules: { ...RULES, casualLoadingOnOvertime: true },
    });
    expect(line(loaded, "OT1").pct).toBe(175);
  });

  it("counts a full-timer's time beyond the rostered hours as overtime", () => {
    const result = pay("Full-time", [
      shift("a", MON, "08:00", "17:00", { rosteredMinutes: 480 }),
    ]);
    expect(line(result, "ORD").minutes).toBe(480);
    expect(line(result, "OT1").minutes).toBe(60);
  });
});

describe("minimum engagement and broken shifts", () => {
  it("tops a short shift up to two hours for part-time and casual staff only", () => {
    const casual = pay("Casual", [shift("a", SAT, "10:00", "11:00")]);
    expect(line(casual, "SAT")).toMatchObject({ minutes: 60, cents: 5_250 });
    expect(line(casual, "MIN")).toMatchObject({
      minutes: 60,
      cents: 5_250,
      pct: 175,
    });
    // Paid for two hours, but only one was worked.
    expect(casual.totals).toMatchObject({ workedMinutes: 60, paidMinutes: 120 });

    const fullTime = pay("Full-time", [shift("a", SAT, "10:00", "11:00")]);
    expect(line(fullTime, "MIN").count).toBe(0);
  });

  it("pays the broken shift allowance once for a day with an unpaid break", () => {
    const result = pay("Part-time", [
      shift("a", MON, "08:00", "10:00"),
      shift("b", MON, "14:00", "16:00"),
    ]);
    expect(line(result, "ORD").minutes).toBe(240);
    // 1.7% of the $1,200.00 test standard rate
    expect(line(result, "BRK")).toMatchObject({ count: 1, cents: 2_040 });
    expect(result.totals.allowanceCents).toBe(2_040);
  });

  it("pays the higher allowance for two breaks and says it needs agreement", () => {
    const result = pay("Part-time", [
      shift("a", MON, "07:00", "09:00"),
      shift("b", MON, "11:00", "13:00"),
      shift("c", MON, "16:00", "18:00"),
    ]);
    expect(line(result, "BRK")).toMatchObject({ count: 1, cents: 2_700 });
    expect(result.flags.map(flag => flag.message).join(" ")).toContain(
      "agreement"
    );
  });

  it("pays double time for work past the 12-hour span of a broken shift", () => {
    const result = pay("Part-time", [
      shift("a", MON, "06:00", "08:00"),
      shift("b", MON, "17:00", "20:00"),
    ]);
    expect(line(result, "ORD").minutes).toBe(180);
    expect(line(result, "SPAN")).toMatchObject({
      minutes: 120,
      cents: 12_000,
      pct: 200,
    });
  });

  it("does not call a meal-break gap a broken shift", () => {
    const result = pay("Part-time", [
      shift("a", MON, "09:00", "11:00"),
      shift("b", MON, "11:30", "13:30"),
    ]);
    expect(line(result, "BRK").count).toBe(0);
    expect(line(result, "ORD").minutes).toBe(240);
  });

  it("says so when the standard rate has not been entered", () => {
    const result = pay(
      "Part-time",
      [shift("a", MON, "08:00", "10:00"), shift("b", MON, "14:00", "16:00")],
      { rules: DEFAULT_AWARD_RULES }
    );
    expect(line(result, "BRK").cents).toBe(0);
    expect(result.flags[0].message).toContain("standard rate is not set");
  });
});

describe("sleepovers, kilometres and breaks between shifts", () => {
  it("pays a sleepover as an allowance, and work during it at overtime rates for at least an hour", () => {
    const quiet = pay("Part-time", [
      shift("eve", MON, "18:00", "22:00"),
      shift("sleep", MON, "22:00", "06:00", { sleepover: true }),
      shift("morn", TUE, "06:00", "10:00"),
    ]);
    // 4.9% of the $1,200.00 test standard rate
    expect(line(quiet, "SLP")).toMatchObject({ count: 1, cents: 5_880 });
    expect(quiet.totals.workedMinutes).toBe(480);
    // The night between the two shifts was a sleepover, not a short break.
    expect(quiet.flags).toEqual([]);

    const disturbed = pay("Part-time", [
      shift("sleep", MON, "22:00", "06:00", {
        sleepover: true,
        activeMinutes: 20,
      }),
    ]);
    expect(line(disturbed, "OT1")).toMatchObject({ minutes: 60, cents: 4_500 });
  });

  it("pays the vehicle allowance per kilometre", () => {
    const result = pay("Part-time", [
      shift("a", MON, "09:00", "12:00", { kilometres: 12.5 }),
    ]);
    expect(line(result, "KM").cents).toBe(1_250);
    expect(result.totals.grossCents).toBe(9_000 + 1_250);
  });

  it("flags less than ten hours between one shift and the next", () => {
    const result = pay("Part-time", [
      shift("late", MON, "14:00", "22:00"),
      shift("early", TUE, "06:00", "10:00"),
    ]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({
      key: "early",
      afterKey: "late",
      restMinutes: 480,
      level: "warning",
    });
  });

  it("describes a shift's cost in words for the roster", () => {
    const result = pay("Casual", [shift("draft", SAT, "10:00", "11:00")]);
    const notes = shiftCostNotes(result, "draft", RULES).join("; ");
    expect(notes).toContain("Saturday, paid at 175%");
    expect(notes).toContain("under the 2-hour minimum");
    expect(notes).not.toContain("$");
  });
});

describe("pay periods, holidays and clock times", () => {
  it("finds the pay period a date falls in, counting from an anchor", () => {
    expect(payPeriodContaining("2026-10-07", "2024-01-01", 7)).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(payPeriodContaining("2026-10-07", "2024-01-01", 14)).toEqual({
      from: "2026-10-05",
      to: "2026-10-18",
    });
    expect(payPeriodContaining("2023-12-31", "2024-01-01", 7)).toEqual({
      from: "2023-12-25",
      to: "2023-12-31",
    });
  });

  it("works out Easter and the national holidays", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    const year = nationalHolidays(2026);
    expect(year.find(day => day.name === "Good Friday")?.date).toBe(
      "2026-04-03"
    );
    expect(year.find(day => day.name === "Easter Monday")?.date).toBe(
      "2026-04-06"
    );
    expect(year).toHaveLength(7);
  });

  it("counts business days around weekends and public holidays", () => {
    const none = new Set<string>();
    // Friday + 1 business day is Monday
    expect(addBusinessDays(FRI, 1, none)).toBe("2026-10-12");
    expect(addBusinessDays(MON, 5, none)).toBe("2026-10-12");
    expect(addBusinessDays(MON, 5, new Set([TUE]))).toBe("2026-10-13");
  });

  it("converts between an instant and the clock in the workspace timezone", () => {
    const instant = zonedInstant("2026-07-01", 9 * 60 + 30, "Australia/Adelaide");
    expect(instant.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(localParts("Australia/Adelaide", instant)).toEqual({
      date: "2026-07-01",
      minutes: 570,
    });
    // Daylight saving: Adelaide is UTC+10:30 in January
    expect(
      localParts("Australia/Adelaide", new Date("2026-01-15T13:45:00.000Z"))
    ).toEqual({ date: "2026-01-16", minutes: 15 });
  });
});
