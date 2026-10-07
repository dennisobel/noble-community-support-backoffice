import { z } from "zod";
import { AVAILABILITY_MODES, LEAVE_STATUSES, LEAVE_TYPES } from "../enums";
import { minutesOf } from "../logic/time";
import { hm, objectId, rev, text, ymd } from "./common";

/** "" means "no time given". */
const optionalHm = z.union([hm, z.literal("")]).optional();

/* ───────────── Availability ───────────── */

const availabilityDay = z
  .object({
    /** 0 = Monday … 6 = Sunday. */
    day: z.number().int().min(0).max(6),
    mode: z.enum(AVAILABILITY_MODES),
    from: optionalHm,
    to: optionalHm,
  })
  .refine(
    day =>
      day.mode !== "Set hours" ||
      Boolean(day.from && day.to && minutesOf(day.to) > minutesOf(day.from)),
    {
      error: "Choose a finish time later than the start time.",
      path: ["to"],
    }
  );

export const availabilitySchema = z.object({
  days: z
    .array(availabilityDay)
    .length(7, { error: "Set every day of the week." })
    .refine(days => new Set(days.map(day => day.day)).size === 7, {
      error: "Each day of the week can appear only once.",
    }),
  note: text(500).optional(),
});
export type AvailabilityInput = z.input<typeof availabilitySchema>;

/* ───────────── Leave and time off ───────────── */

const leaveShape = {
  type: z.enum(LEAVE_TYPES),
  from: ymd,
  to: ymd,
  /** Only for part of a single day: the hours they are away. */
  startTime: optionalHm,
  endTime: optionalHm,
  /** Paid hours being asked for (annual, personal and compassionate leave). */
  hours: z
    .number({ error: "Enter the hours as a number." })
    .min(0, { error: "Hours cannot be negative." })
    .max(400, { error: "Enter 400 hours or fewer." })
    .optional(),
  reason: text(1000).optional(),
};

interface LeaveDates {
  from: string;
  to: string;
  startTime?: string;
  endTime?: string;
}

const endsAfterStart = (leave: LeaveDates) => leave.to >= leave.from;
const partDayIsValid = (leave: LeaveDates) => {
  if (!leave.startTime && !leave.endTime) return true;
  return Boolean(
    leave.from === leave.to &&
      leave.startTime &&
      leave.endTime &&
      minutesOf(leave.endTime) > minutesOf(leave.startTime)
  );
};
const END_MESSAGE = {
  error: "The last day must be on or after the first day.",
  path: ["to"],
};
const PART_DAY_MESSAGE = {
  error:
    "Times only apply to a single day, and the finish must be later than the start.",
  path: ["endTime"],
};

export const leaveCreateSchema = z
  .object(leaveShape)
  .refine(endsAfterStart, END_MESSAGE)
  .refine(partDayIsValid, PART_DAY_MESSAGE);
export type LeaveCreateInput = z.input<typeof leaveCreateSchema>;

/** The office recording time off for someone, optionally approved in the same step. */
export const officeLeaveCreateSchema = z
  .object({ ...leaveShape, staffId: objectId, approve: z.boolean().optional() })
  .refine(endsAfterStart, END_MESSAGE)
  .refine(partDayIsValid, PART_DAY_MESSAGE);
export type OfficeLeaveCreateInput = z.input<typeof officeLeaveCreateSchema>;

export const leaveDecisionSchema = z.object({
  decision: z.enum(["Approved", "Declined"]),
  note: text(500).optional(),
  rev,
});
export type LeaveDecisionInput = z.input<typeof leaveDecisionSchema>;

export const leaveListQuery = z.object({
  status: z.enum([...LEAVE_STATUSES, "all"]).default("all"),
  staffId: objectId.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
});
