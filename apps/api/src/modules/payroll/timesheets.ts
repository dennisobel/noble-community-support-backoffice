import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  PayFlagDTO,
  PayLineDTO,
  TimesheetDetailDTO,
  TimesheetDTO,
  TimesheetListDTO,
  TimesheetTimesDTO,
} from "@shared/dto";
import type { TimesheetStatus } from "@shared/enums";
import {
  interpretPay,
  sumTotals,
  type InterpretResult,
  type PayLine,
  type WorkPeriod,
} from "@shared/logic/award";
import { fromCents } from "@shared/logic/money";
import {
  addDays,
  daysBetween,
  hmOf,
  hoursOf,
  localParts,
  minutesOf,
} from "@shared/logic/time";
import type {
  payPeriodQuery,
  timesheetApproveSchema,
  timesheetBulkSchema,
} from "@shared/schemas/payroll";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, iso } from "../../lib/mappers";
import { workspaceTimezone, workspaceToday } from "../../lib/workspace";
import {
  LogbookEntry,
  RosterShift,
  Service,
  Staff,
  type RosterShiftDoc,
  type ServiceDoc,
  type ShiftTimesheetSub,
  type StaffDoc,
} from "../../models";
import { participantLookup } from "../participants/service";
import { staffLookup } from "../records/service";
import {
  baseRateOn,
  payContext,
  periodFor,
  type PayContext,
} from "./settings";

/*
 * A timesheet is one worker on one rostered shift. Nothing is copied out of the roster: the
 * worker's sign-on and sign-off and the office's approval both live on the shift, so a change
 * to the roster can never leave a stale timesheet behind.
 */

/** Clock times as minutes past midnight on the shift's date; an end past 1440 is the next day. */
export interface Times {
  startMin: number;
  endMin: number;
  breakMinutes: number;
}

const DAY = 1440;

export const paidMinutes = (times: Times) =>
  Math.max(0, times.endMin - times.startMin - times.breakMinutes);

const toTimesDTO = (times: Times): TimesheetTimesDTO => ({
  start: hmOf(times.startMin),
  end: hmOf(times.endMin),
  overnight: times.endMin >= DAY,
  breakMinutes: times.breakMinutes,
  minutes: paidMinutes(times),
});

export interface SheetRow {
  shift: RosterShiftDoc;
  staffId: string;
  sheet: ShiftTimesheetSub | null;
  rostered: Times;
  /** What the worker recorded. `ended` is false while they are still on shift. */
  actual: (Times & { ended: boolean }) | null;
  /** The approved hours, or the hours approving now would pay. */
  paid: Times;
  status: TimesheetStatus;
  clean: boolean;
  sleepover: boolean;
  /** Kilometres to pay: the approved figure, else what the worker logged for the shift. */
  kilometres: number;
}

interface RowEnv {
  timezone: string;
  today: string;
  toleranceMinutes: number;
  services: Map<string, ServiceDoc>;
  /** Kilometres from the worker's logbook, by shift and worker. */
  logged: Map<string, number>;
}

const rowId = (shiftId: string, staffId: string) => `${shiftId}:${staffId}`;

function buildRow(
  shift: RosterShiftDoc,
  staffId: string,
  env: RowEnv
): SheetRow {
  const sheet =
    shift.timesheets?.find(row => String(row.staffId) === staffId) ?? null;
  const rostered: Times = {
    startMin: minutesOf(shift.start),
    endMin: minutesOf(shift.end),
    breakMinutes: 0,
  };

  let actual: SheetRow["actual"] = null;
  if (sheet?.startedAt) {
    const local = localParts(env.timezone, sheet.startedAt);
    // A sign-on just before midnight for a shift dated the next day is paid from midnight.
    const startMin = Math.max(
      0,
      daysBetween(shift.date, local.date) * DAY + local.minutes
    );
    const elapsed = sheet.endedAt
      ? Math.max(
          0,
          Math.round(
            (sheet.endedAt.getTime() - sheet.startedAt.getTime()) / 60_000
          )
        )
      : 0;
    actual = {
      startMin,
      endMin: startMin + elapsed,
      breakMinutes: Math.min(sheet.breakMinutes ?? 0, elapsed),
      ended: Boolean(sheet.endedAt),
    };
  }

  const near = (a: number, b: number) =>
    Math.abs(a - b) <= env.toleranceMinutes;
  let paid: Times = rostered;
  let clean = false;
  if (sheet?.approved) {
    paid = {
      startMin: minutesOf(sheet.approved.start),
      endMin:
        minutesOf(sheet.approved.end) + (sheet.approved.overnight ? DAY : 0),
      breakMinutes: sheet.approved.breakMinutes ?? 0,
    };
  } else if (actual?.ended && actual.endMin > actual.startMin) {
    // Close enough to the roster is paid as rostered; anything further out is paid as worked.
    const startOk = near(actual.startMin, rostered.startMin);
    const endOk = near(actual.endMin, rostered.endMin);
    paid = {
      startMin: startOk ? rostered.startMin : actual.startMin,
      endMin: endOk ? rostered.endMin : actual.endMin,
      breakMinutes: actual.breakMinutes,
    };
    clean = startOk && endOk;
  }

  const cancelled = shift.status === "Cancelled" && !sheet?.payCancelled;
  const status: TimesheetStatus = cancelled
    ? "Cancelled"
    : sheet?.approved
      ? sheet.payRunId
        ? "In pay run"
        : "Approved"
      : actual?.ended
        ? "Awaiting approval"
        : actual
          ? "In progress"
          : shift.date < env.today
            ? "No sign-on"
            : "Upcoming";

  const service = env.services.get(String(shift.serviceId));
  const recorded = sheet?.kilometres ?? 0;
  return {
    shift,
    staffId,
    sheet,
    rostered,
    actual,
    paid,
    status,
    clean: clean && status === "Awaiting approval",
    sleepover: service?.payAs === "Sleepover",
    kilometres:
      sheet?.approved || recorded > 0
        ? recorded
        : (env.logged.get(rowId(shift._id, staffId)) ?? 0),
  };
}

/** Every worker-on-shift row between two dates, oldest first. */
export async function loadRows(
  from: string,
  to: string,
  options: { staffId?: string; toleranceMinutes?: number } = {}
): Promise<SheetRow[]> {
  const filter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (options.staffId) filter.staffIds = options.staffId;
  const shifts = await RosterShift.find(filter)
    .sort({ date: 1, start: 1 })
    .lean<RosterShiftDoc[]>();
  const [services, logbook, timezone, today, context] = await Promise.all([
    Service.find({
      _id: { $in: [...new Set(shifts.map(shift => String(shift.serviceId)))] },
    }).lean<ServiceDoc[]>(),
    LogbookEntry.find({ shiftId: { $in: shifts.map(shift => shift._id) } })
      .select("shiftId staffId kilometres")
      .lean<
        Array<{
          shiftId: string | null;
          staffId: Types.ObjectId;
          kilometres: number;
        }>
      >(),
    workspaceTimezone(),
    workspaceToday(),
    options.toleranceMinutes === undefined ? payContext() : null,
  ]);
  const logged = new Map<string, number>();
  for (const entry of logbook) {
    if (!entry.shiftId) continue;
    const key = rowId(entry.shiftId, String(entry.staffId));
    logged.set(key, (logged.get(key) ?? 0) + (entry.kilometres ?? 0));
  }
  const env: RowEnv = {
    timezone,
    today,
    toleranceMinutes:
      options.toleranceMinutes ?? context?.toleranceMinutes ?? 10,
    services: new Map(services.map(service => [String(service._id), service])),
    logged,
  };
  return shifts.flatMap(shift =>
    shift.staffIds
      .map(String)
      .filter(id => !options.staffId || id === options.staffId)
      .map(id => buildRow(shift, id, env))
  );
}

interface RowLookups {
  staff: Map<string, StaffDoc>;
  clients: Map<string, { preferred: string; name: string }>;
  services: Map<string, string>;
}

async function rowLookups(rows: SheetRow[]): Promise<RowLookups> {
  const serviceIds = [...new Set(rows.map(row => String(row.shift.serviceId)))];
  const [staff, clients, services] = await Promise.all([
    staffLookup(rows.map(row => row.staffId)),
    participantLookup(rows.flatMap(row => row.shift.clientIds)),
    Service.find({ _id: { $in: serviceIds } })
      .select("name")
      .lean<Array<{ _id: Types.ObjectId; name: string }>>(),
  ]);
  return {
    staff,
    clients,
    services: new Map(
      services.map(service => [String(service._id), service.name])
    ),
  };
}

function toTimesheetDTO(row: SheetRow, lookups: RowLookups): TimesheetDTO {
  const { shift, sheet } = row;
  return {
    id: rowId(shift._id, row.staffId),
    shiftId: shift._id,
    staffId: row.staffId,
    staffName: lookups.staff.get(row.staffId)?.name ?? "Unknown",
    date: shift.date,
    clients: shift.clientIds
      .map(id => lookups.clients.get(String(id))?.preferred ?? "Participant")
      .join(", "),
    serviceName: lookups.services.get(String(shift.serviceId)) ?? shift.type,
    payAs: row.sleepover ? "Sleepover" : "Hours worked",
    location: shift.location ?? "",
    status: row.status,
    shiftStatus: shift.status,
    rostered: toTimesDTO(row.rostered),
    actual:
      row.actual && sheet?.startedAt
        ? {
            startedAt: sheet.startedAt.toISOString(),
            endedAt: iso(sheet.endedAt),
            start: hmOf(row.actual.startMin),
            end: row.actual.ended ? hmOf(row.actual.endMin) : null,
            overnight: row.actual.ended && row.actual.endMin >= DAY,
            breakMinutes: row.actual.breakMinutes,
            minutes: row.actual.ended ? paidMinutes(row.actual) : null,
          }
        : null,
    paid: toTimesDTO(row.paid),
    varianceMinutes: paidMinutes(row.paid) - paidMinutes(row.rostered),
    kilometres: row.kilometres,
    sleepoverActiveMinutes: sheet?.sleepoverActiveMinutes ?? 0,
    payCancelled: Boolean(sheet?.payCancelled),
    workerNote: sheet?.notes ?? "",
    approval: sheet?.approved
      ? {
          by: actorDTO(sheet.approved.by),
          at: iso(sheet.approved.at),
          note: sheet.approved.note ?? "",
        }
      : null,
    payRunId: sheet?.payRunId ?? null,
    clean: row.clean,
  };
}

export async function listTimesheets(
  query: z.output<typeof payPeriodQuery>,
  options: { cancelled?: boolean } = {}
): Promise<TimesheetListDTO> {
  const [context, today] = await Promise.all([payContext(), workspaceToday()]);
  const period = periodFor(context.doc, query.date ?? today, today);
  const rows = (
    await loadRows(period.from, period.to, {
      staffId: query.staffId,
      toleranceMinutes: context.toleranceMinutes,
    })
  ).filter(row => options.cancelled || row.status !== "Cancelled");
  const lookups = await rowLookups(rows);
  const count = (...statuses: TimesheetStatus[]) =>
    rows.filter(row => statuses.includes(row.status)).length;
  const live = rows.filter(row => row.status !== "Cancelled");
  return {
    period,
    rows: rows.map(row => toTimesheetDTO(row, lookups)),
    totals: {
      awaiting: count("Awaiting approval"),
      approved: count("Approved", "In pay run"),
      missing: count("No sign-on"),
      inProgress: count("In progress"),
      approvedHours: hoursOf(
        rows
          .filter(row => row.status === "Approved" || row.status === "In pay run")
          .reduce((sum, row) => sum + paidMinutes(row.paid), 0)
      ),
      rosteredHours: hoursOf(
        live.reduce((sum, row) => sum + paidMinutes(row.rostered), 0)
      ),
    },
  };
}

/* ───────────── Costing: rows through the award engine ───────────── */

export const toLineDTO = (line: PayLine): PayLineDTO => ({
  shiftId: line.key,
  date: line.date,
  code: line.code,
  label: line.label,
  hours: hoursOf(line.minutes),
  units: line.units,
  pct: line.pct,
  rate: fromCents(line.rateCents),
  amount: fromCents(line.amountCents),
  why: line.why,
});

export const toFlagDTO = (flag: {
  key: string;
  level: "info" | "warning";
  message: string;
}): PayFlagDTO => ({
  shiftId: flag.key,
  level: flag.level,
  message: flag.message,
});

export function toWorkPeriod(row: SheetRow, baseRateCents: number): WorkPeriod {
  return {
    key: row.shift._id,
    date: row.shift.date,
    startMin: row.paid.startMin,
    endMin: row.paid.endMin,
    breakMinutes: row.paid.breakMinutes,
    sleepover: row.sleepover,
    activeMinutes: row.sheet?.sleepoverActiveMinutes ?? 0,
    kilometres: row.kilometres,
    rosteredMinutes: paidMinutes(row.rostered),
    baseRateCents,
  };
}

/**
 * Runs one worker's rows for a pay period through the award. `rows` may start a day early so a
 * shift that runs on from the night before is joined up; only lines for `keys` are returned.
 */
export function costRows(
  staff: Pick<StaffDoc, "employment">,
  rows: SheetRow[],
  period: { from: string },
  context: PayContext,
  keys: Set<string>
): InterpretResult & { costed: boolean } {
  const kind = staff.employment?.kind ?? null;
  let costed = Boolean(kind);
  const periods = rows.map(row => {
    const base = baseRateOn(staff, row.shift.date, context);
    if (!base) costed = false;
    return toWorkPeriod(row, base ?? 0);
  });
  const result = interpretPay({
    // With no employment type recorded the hours are still shown, at no loading and no rate.
    employmentType: kind ?? "Part-time",
    periods,
    rules: context.rules,
    publicHolidays: context.holidays,
    windowStart: period.from,
    windowDays: context.windowDays,
  });
  const lines = result.lines.filter(line => keys.has(line.key));
  return {
    lines,
    flags: result.flags.filter(flag => keys.has(flag.key)),
    totals: sumTotals(lines),
    costed,
  };
}

const payable = (row: SheetRow) =>
  row.status !== "Cancelled" && row.status !== "Upcoming";

async function findRow(
  shiftId: string,
  staffId: string
): Promise<{ row: SheetRow; context: PayContext; today: string }> {
  const shift = await RosterShift.findById(shiftId).lean<RosterShiftDoc>();
  if (!shift || !shift.staffIds.some(id => String(id) === staffId))
    throw errors.notFound("Timesheet");
  const [context, today] = await Promise.all([payContext(), workspaceToday()]);
  const rows = await loadRows(shift.date, shift.date, {
    staffId,
    toleranceMinutes: context.toleranceMinutes,
  });
  const row = rows.find(candidate => candidate.shift._id === shiftId);
  if (!row) throw errors.notFound("Timesheet");
  return { row, context, today };
}

/** One timesheet with the pay lines its hours produce, in the setting of the worker's whole period. */
export async function getTimesheet(
  shiftId: string,
  staffId: string
): Promise<TimesheetDetailDTO> {
  const { row, context, today } = await findRow(shiftId, staffId);
  const period = periodFor(context.doc, row.shift.date, today);
  const [staff, periodRows] = await Promise.all([
    Staff.findById(staffId).lean<StaffDoc>(),
    loadRows(addDays(period.from, -1), period.to, {
      staffId,
      toleranceMinutes: context.toleranceMinutes,
    }),
  ]);
  if (!staff) throw errors.notFound("Team member");
  // A cancelled shift is costed too, so the office can see what paying it would come to.
  const counted = periodRows.filter(
    other => payable(other) || other.shift._id === shiftId
  );
  const cost = costRows(staff, counted, period, context, new Set([shiftId]));
  const lookups = await rowLookups([row]);
  return {
    ...toTimesheetDTO(row, lookups),
    lines: cost.lines.map(toLineDTO),
    flags: cost.flags.map(toFlagDTO),
    gross: fromCents(cost.totals.grossCents),
    costed: cost.costed,
    costNote: cost.costed
      ? ""
      : !staff.employment?.kind
        ? `${staff.name} has no employment type yet, so the hours are shown without pay. Set it in their Staff profile.`
        : `${staff.name} has no pay rate yet, so the hours are shown without pay. Give their classification a rate in Pay rules.`,
  };
}

/* ───────────── Approval ───────────── */

function assertUnlocked(row: SheetRow): void {
  if (row.sheet?.payRunId)
    throw errors.invalidState(
      `These hours are in pay run ${row.sheet.payRunId}. Reopen the pay run to change them.`
    );
}

/** Writes one worker's timesheet row back to its shift, keeping what the worker recorded. */
async function saveSheet(
  row: SheetRow,
  changes: Partial<ShiftTimesheetSub>,
  completeShift: boolean
): Promise<void> {
  const { shift } = row;
  const staffObjectId = shift.staffIds.find(id => String(id) === row.staffId)!;
  const current: ShiftTimesheetSub = row.sheet ?? {
    staffId: staffObjectId,
    startedAt: null,
    endedAt: null,
    breakMinutes: 0,
    kilometres: 0,
    notes: "",
  };
  const others = (shift.timesheets ?? []).filter(
    sheet => String(sheet.staffId) !== row.staffId
  );
  const $set: Record<string, unknown> = {
    timesheets: [...others, { ...current, ...changes }],
  };
  if (
    completeShift &&
    (shift.status === "Planned" || shift.status === "Confirmed")
  )
    $set.status = "Completed";
  await RosterShift.updateOne({ _id: shift._id }, { $set, $inc: { rev: 1 } });
}

export async function approveTimesheet(
  shiftId: string,
  staffId: string,
  input: z.output<typeof timesheetApproveSchema>,
  ctx: RequestContext
): Promise<TimesheetDetailDTO> {
  const { row, today } = await findRow(shiftId, staffId);
  assertUnlocked(row);
  const { shift } = row;
  const payCancelled = Boolean(input.payCancelled);
  if (shift.status === "Cancelled" && !payCancelled)
    throw errors.invalidState(
      "This shift was cancelled. Choose to pay the cancelled shift if the worker is owed for it."
    );
  if (shift.date > today)
    throw errors.invalidState(
      "This shift has not happened yet, so there are no hours to approve."
    );
  if (row.status === "In progress")
    throw errors.invalidState(
      "The worker is still signed on to this shift. Approve it once they have signed off."
    );
  const startMin = minutesOf(input.start);
  const endMin = minutesOf(input.end) + (input.overnight ? DAY : 0);
  const length = endMin - startMin;
  if (length <= 0)
    throw errors.validation(
      "Choose a finish time later than the start, or tick that it finished the next day.",
      [{ path: "end", message: "The finish must be after the start." }]
    );
  const breakMinutes = input.breakMinutes ?? 0;
  if (breakMinutes >= length)
    throw errors.validation("The break is as long as the shift.", [
      { path: "breakMinutes", message: "Enter a shorter break." },
    ]);
  await saveSheet(
    row,
    {
      approved: {
        start: input.start,
        end: input.end,
        overnight: Boolean(input.overnight),
        breakMinutes,
        note: input.note ?? "",
        by: ctx.actor,
        at: new Date(),
      },
      kilometres: input.kilometres ?? row.kilometres,
      sleepoverActiveMinutes: row.sleepover
        ? (input.sleepoverActiveMinutes ?? 0)
        : 0,
      payCancelled: shift.status === "Cancelled" && payCancelled,
    },
    true
  );
  const name = (await Staff.findById(staffId).select("name").lean<StaffDoc>())
    ?.name;
  await logActivity({
    actor: ctx.actor,
    action: "timesheet.approved",
    entityType: "shift",
    entityId: shiftId,
    summary: `approved ${hoursOf(length - breakMinutes)} h for ${name ?? "a worker"} on ${shiftId}`,
    ip: ctx.ip,
  });
  return getTimesheet(shiftId, staffId);
}

export async function unapproveTimesheet(
  shiftId: string,
  staffId: string,
  ctx: RequestContext
): Promise<TimesheetDetailDTO> {
  const { row } = await findRow(shiftId, staffId);
  assertUnlocked(row);
  if (!row.sheet?.approved)
    throw errors.invalidState("These hours have not been approved.");
  await saveSheet(row, { approved: null, payCancelled: false }, false);
  await logActivity({
    actor: ctx.actor,
    action: "timesheet.unapproved",
    entityType: "shift",
    entityId: shiftId,
    summary: `withdrew the approval of hours on ${shiftId}`,
    ip: ctx.ip,
  });
  return getTimesheet(shiftId, staffId);
}

/** Approves every signed-off timesheet in the period that matches the roster within the tolerance. */
export async function approveClean(
  input: z.output<typeof timesheetBulkSchema>,
  ctx: RequestContext
): Promise<{ approved: number; left: number }> {
  const [context, today] = await Promise.all([payContext(), workspaceToday()]);
  const period = periodFor(context.doc, input.date ?? today, today);
  const rows = await loadRows(period.from, period.to, {
    staffId: input.staffId,
    toleranceMinutes: context.toleranceMinutes,
  });
  const waiting = rows.filter(row => row.status === "Awaiting approval");
  const clean = waiting.filter(row => row.clean);
  for (const row of clean) {
    await saveSheet(
      row,
      {
        approved: {
          start: hmOf(row.paid.startMin),
          end: hmOf(row.paid.endMin),
          overnight: row.paid.endMin >= DAY,
          breakMinutes: row.paid.breakMinutes,
          note: "",
          by: ctx.actor,
          at: new Date(),
        },
        kilometres: row.kilometres,
      },
      true
    );
  }
  if (clean.length)
    await logActivity({
      actor: ctx.actor,
      action: "timesheet.approved_bulk",
      entityType: "payPeriod",
      entityId: period.from,
      summary: `approved ${clean.length} timesheet${clean.length === 1 ? "" : "s"} that matched the roster`,
      ip: ctx.ip,
    });
  return { approved: clean.length, left: waiting.length - clean.length };
}

/** How many signed-off timesheets are waiting for the office, for the notification bell. */
export async function countAwaitingTimesheets(): Promise<number> {
  const today = await workspaceToday();
  // Sign-offs older than five weeks have been through a pay run or are a deliberate exception.
  const shifts = await RosterShift.find({
    date: { $gte: addDays(today, -35), $lte: today },
    status: { $ne: "Cancelled" },
    timesheets: { $elemMatch: { endedAt: { $ne: null }, approved: null } },
  })
    .select("timesheets")
    .lean<Array<Pick<RosterShiftDoc, "timesheets">>>();
  return shifts.reduce(
    (total, shift) =>
      total +
      shift.timesheets.filter(sheet => sheet.endedAt && !sheet.approved).length,
    0
  );
}

/** A worker's own timesheets for a pay period: hours and where each one stands, never amounts. */
export async function listOwnTimesheets(
  staffId: string,
  date?: string
): Promise<TimesheetListDTO> {
  return listTimesheets({ date, staffId });
}
