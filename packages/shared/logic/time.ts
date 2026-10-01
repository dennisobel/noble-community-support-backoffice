/** Business dates are "YYYY-MM-DD" strings and times are "HH:mm" strings in the workspace timezone. */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidYmd(value: string): boolean {
  const match = YMD.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isValidHm(value: string): boolean {
  return HM.test(value);
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Hours between two HH:mm times, rounded to the nearest 0.1 hour (6 minutes). Never negative. */
export function durationHours(start: string, end: string): number {
  if (!start || !end || !isValidHm(start) || !isValidHm(end)) return 0;
  return Math.max(0, Math.round((minutesOf(end) - minutesOf(start)) / 6) / 10);
}

export function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return (
    minutesOf(aStart) < minutesOf(bEnd) && minutesOf(aEnd) > minutesOf(bStart)
  );
}

function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(ymd: string, days: number): string {
  const date = ymdToUtcDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToYmd(date);
}

export function addMonths(ymd: string, months: number): string {
  const date = ymdToUtcDate(ymd);
  date.setUTCMonth(date.getUTCMonth() + months);
  return utcDateToYmd(date);
}

/** Monday of the ISO week containing the date. */
export function startOfWeek(ymd: string): string {
  const date = ymdToUtcDate(ymd);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(ymd, -offset);
}

export function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function startOfQuarter(ymd: string): string {
  const month = Number(ymd.slice(5, 7));
  const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${ymd.slice(0, 4)}-${String(quarterMonth).padStart(2, "0")}-01`;
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (ymdToUtcDate(toYmd).getTime() - ymdToUtcDate(fromYmd).getTime()) /
      86_400_000
  );
}

/** "Today" as YYYY-MM-DD in an IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return ymdIn(timeZone, now);
}

export function ymdIn(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hour of day (0-23) in the given timezone. */
export function hourIn(timeZone: string, instant: Date = new Date()): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return Number(value);
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant at which the given local calendar day starts in the timezone. */
export function zonedStartOfDay(ymd: string, timeZone: string): Date {
  const guess = ymdToUtcDate(ymd).getTime();
  const first = offsetMinutes(new Date(guess), timeZone);
  let instant = guess - first * 60_000;
  const second = offsetMinutes(new Date(instant), timeZone);
  if (second !== first) instant = guess - second * 60_000;
  return new Date(instant);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "29 Sep 2026" style label for a business date. */
export function prettyDate(ymd?: string | null): string {
  if (!ymd) return "—";
  return ymdToUtcDate(ymd).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "29 Sep" style label for a business date. */
export function shortDate(ymd?: string | null): string {
  if (!ymd) return "—";
  return ymdToUtcDate(ymd).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "01 Feb 2026 – 31 Jan 2027" or a fallback when the plan period is unknown. */
export function planLabel(
  planStart?: string | null,
  planEnd?: string | null
): string {
  if (!planStart || !planEnd) return "Plan dates to confirm";
  const format = (ymd: string) =>
    ymdToUtcDate(ymd).toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${format(planStart)} – ${format(planEnd)}`;
}

/** "01:42" from seconds. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}
