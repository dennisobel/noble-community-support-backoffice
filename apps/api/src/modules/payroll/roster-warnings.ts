import { WEEKDAYS } from "@shared/enums";
import {
  hoursLabel,
  interpretPay,
  payPeriodContaining,
  shiftCostNotes,
  type WorkPeriod,
} from "@shared/logic/award";
import {
  addDays,
  minutesOf,
  prettyDate,
  timesOverlap,
  weekdayIndex,
} from "@shared/logic/time";
import {
  DEFAULT_PAY_ANCHOR,
  LeaveRequest,
  RosterShift,
  Service,
  StaffAvailability,
  type LeaveRequestDoc,
  type RosterShiftDoc,
  type ServiceDoc,
  type StaffAvailabilityDoc,
  type StaffDoc,
} from "../../models";
import { payContext } from "./settings";

interface DraftShift {
  date: string;
  start: string;
  end: string;
  staffIds: string[];
  serviceId: string;
}

const DRAFT = "draft";

function joinNotes(notes: string[]): string {
  if (notes.length <= 1) return notes.join("");
  return `${notes.slice(0, -1).join(", ")} and ${notes[notes.length - 1]}`;
}

/**
 * What the person building the roster should know about the people on a shift before it is
 * saved: time off, availability, and what the award makes of the shift (weekend and holiday
 * rates, overtime, the minimum engagement, a short break since the last shift). Never blocking,
 * and never a dollar amount, because not everyone who rosters can see pay rates.
 */
export async function workforceWarnings(
  draft: DraftShift,
  staff: StaffDoc[],
  excludeId?: string
): Promise<string[]> {
  if (!staff.length) return [];
  const ids = staff.map(member => member._id);
  const context = await payContext();
  const period = payPeriodContaining(
    draft.date,
    context.doc.payPeriod?.anchor ?? DEFAULT_PAY_ANCHOR,
    context.windowDays
  );
  const [leave, availability, shifts, services] = await Promise.all([
    LeaveRequest.find({
      staffId: { $in: ids },
      status: { $in: ["Approved", "Pending"] },
      from: { $lte: draft.date },
      to: { $gte: draft.date },
    }).lean<LeaveRequestDoc[]>(),
    StaffAvailability.find({ staffId: { $in: ids } }).lean<
      StaffAvailabilityDoc[]
    >(),
    // A day either side of the pay period, so the break before and after the shift is seen.
    RosterShift.find({
      staffIds: { $in: ids },
      status: { $ne: "Cancelled" },
      date: { $gte: addDays(period.from, -1), $lte: addDays(period.to, 1) },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean<RosterShiftDoc[]>(),
    Service.find({ payAs: "Sleepover" }).select("_id").lean<ServiceDoc[]>(),
  ]);
  const sleepovers = new Set(services.map(service => String(service._id)));
  const weekday = weekdayIndex(draft.date);
  const warnings: string[] = [];

  for (const member of staff) {
    const id = String(member._id);

    for (const request of leave.filter(row => String(row.staffId) === id)) {
      const partDay = request.startTime && request.endTime;
      if (
        partDay &&
        !timesOverlap(
          draft.start,
          draft.end,
          request.startTime!,
          request.endTime!
        )
      )
        continue;
      const what =
        request.type === "Unavailable"
          ? "is unavailable"
          : `has ${request.status === "Approved" ? "approved" : "asked for"} ${request.type.toLowerCase()}`;
      warnings.push(
        `${member.name} ${what} on ${prettyDate(draft.date)}${partDay ? ` (${request.startTime}–${request.endTime})` : ""}${request.status === "Pending" && request.type !== "Unavailable" ? ", not decided yet" : ""}.`
      );
    }

    const pattern = availability
      .find(row => String(row.staffId) === id)
      ?.days.find(day => day.day === weekday);
    if (pattern?.mode === "Not available")
      warnings.push(
        `${member.name} has said they are not available on ${WEEKDAYS[weekday]}s.`
      );
    else if (
      pattern?.mode === "Set hours" &&
      pattern.from &&
      pattern.to &&
      (minutesOf(draft.start) < minutesOf(pattern.from) ||
        minutesOf(draft.end) > minutesOf(pattern.to))
    )
      warnings.push(
        `${member.name} is only available ${pattern.from}–${pattern.to} on ${WEEKDAYS[weekday]}s.`
      );

    const toPeriod = (
      key: string,
      shift: { date: string; start: string; end: string; serviceId: string }
    ): WorkPeriod => ({
      key,
      date: shift.date,
      startMin: minutesOf(shift.start),
      endMin: minutesOf(shift.end),
      breakMinutes: 0,
      sleepover: sleepovers.has(shift.serviceId),
      rosteredMinutes: minutesOf(shift.end) - minutesOf(shift.start),
      baseRateCents: 0,
    });
    const result = interpretPay({
      employmentType: member.employment?.kind ?? "Casual",
      periods: [
        ...shifts
          .filter(shift => shift.staffIds.some(staffId => String(staffId) === id))
          .map(shift =>
            toPeriod(shift._id, { ...shift, serviceId: String(shift.serviceId) })
          ),
        toPeriod(DRAFT, draft),
      ],
      rules: context.rules,
      publicHolidays: context.holidays,
      windowStart: period.from,
      windowDays: context.windowDays,
    });
    const notes = shiftCostNotes(result, DRAFT, context.rules);
    if (notes.length)
      warnings.push(`${member.name}'s shift ${joinNotes(notes)}.`);
    for (const flag of result.flags) {
      // Money that is not set up is payroll's business, not the roster's.
      if (flag.key === DRAFT && !flag.message.includes("Pay rules"))
        warnings.push(`${member.name}: ${flag.message}`);
      // The same short break, seen from the earlier of the two shifts.
      else if (flag.afterKey === DRAFT && flag.restMinutes !== undefined)
        warnings.push(
          `${member.name}'s next shift (${flag.key}) starts only ${hoursLabel(flag.restMinutes)} after this one ends. The award asks for a ${context.rules.restBetweenShiftsHours}-hour break.`
        );
    }
  }
  return warnings;
}
