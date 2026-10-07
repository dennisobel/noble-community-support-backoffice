import type { z } from "zod";
import type { AvailabilityDayDTO, AvailabilityDTO } from "@shared/dto";
import type { availabilitySchema } from "@shared/schemas/workforce";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, iso } from "../../lib/mappers";
import {
  Staff,
  StaffAvailability,
  type StaffAvailabilityDoc,
} from "../../models";

/** Until a pattern is set, every day reads "Any time" and the roster raises no warning. */
const openWeek = (): AvailabilityDayDTO[] =>
  Array.from({ length: 7 }, (_, day) => ({
    day,
    mode: "Any time" as const,
    from: "",
    to: "",
  }));

function toAvailabilityDTO(
  staffId: string,
  doc: StaffAvailabilityDoc | null
): AvailabilityDTO {
  const stored = new Map((doc?.days ?? []).map(day => [day.day, day]));
  return {
    staffId,
    set: Boolean(doc),
    days: openWeek().map(day => {
      const saved = stored.get(day.day);
      return saved
        ? {
            day: day.day,
            mode: saved.mode,
            from: saved.mode === "Set hours" ? saved.from : "",
            to: saved.mode === "Set hours" ? saved.to : "",
          }
        : day;
    }),
    note: doc?.note ?? "",
    updatedAt: iso(doc?.updatedAt),
    updatedBy: actorDTO(doc?.updatedBy),
  };
}

export async function getAvailability(
  staffId: string
): Promise<AvailabilityDTO> {
  if (!(await Staff.exists({ _id: staffId })))
    throw errors.notFound("Team member");
  return toAvailabilityDTO(
    staffId,
    await StaffAvailability.findOne({ staffId }).lean<StaffAvailabilityDoc>()
  );
}

/** Set by the worker from the portal, or by the office on their behalf. */
export async function setAvailability(
  staffId: string,
  input: z.output<typeof availabilitySchema>,
  ctx: RequestContext
): Promise<AvailabilityDTO> {
  const staff = await Staff.findById(staffId)
    .select("name")
    .lean<{ name: string }>();
  if (!staff) throw errors.notFound("Team member");
  const saved = await StaffAvailability.findOneAndUpdate(
    { staffId },
    {
      $set: {
        days: [...input.days]
          .sort((a, b) => a.day - b.day)
          .map(day => ({
            day: day.day,
            mode: day.mode,
            from: day.mode === "Set hours" ? (day.from ?? "") : "",
            to: day.mode === "Set hours" ? (day.to ?? "") : "",
          })),
        note: input.note ?? "",
        updatedBy: ctx.actor,
      },
    },
    { upsert: true, returnDocument: "after", lean: true }
  );
  await logActivity({
    actor: ctx.actor,
    action: "staff.availability_updated",
    entityType: "staff",
    entityId: staffId,
    summary: `updated ${staff.name}'s availability`,
    ip: ctx.ip,
  });
  return toAvailabilityDTO(staffId, saved as StaffAvailabilityDoc);
}
