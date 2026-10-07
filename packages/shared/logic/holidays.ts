import { addDays, weekdayIndex } from "./time";

/** Easter Sunday for a year (Gregorian calendar), as YYYY-MM-DD. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface Holiday {
  date: string;
  name: string;
}

/**
 * The public holidays every state and territory shares, on the dates they fall. States add their own
 * days and move a holiday that lands on a weekend, so this is a starting list, not the whole year.
 */
export function nationalHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    { date: `${year}-01-01`, name: "New Year's Day" },
    { date: `${year}-01-26`, name: "Australia Day" },
    { date: addDays(easter, -2), name: "Good Friday" },
    { date: addDays(easter, 1), name: "Easter Monday" },
    { date: `${year}-04-25`, name: "Anzac Day" },
    { date: `${year}-12-25`, name: "Christmas Day" },
    { date: `${year}-12-26`, name: "Boxing Day" },
  ];
}

/** Monday to Friday, and not a public holiday. */
export function isBusinessDay(
  ymd: string,
  holidays: ReadonlySet<string>
): boolean {
  return weekdayIndex(ymd) < 5 && !holidays.has(ymd);
}

/** The date `count` business days after `ymd` (the day itself is never counted). */
export function addBusinessDays(
  ymd: string,
  count: number,
  holidays: ReadonlySet<string>
): string {
  let day = ymd;
  let left = Math.max(0, Math.floor(count));
  while (left > 0) {
    day = addDays(day, 1);
    if (isBusinessDay(day, holidays)) left -= 1;
  }
  return day;
}
