import { z } from "zod";
import { EMPLOYMENT_TYPES, STAFF_STATUSES } from "../enums";
import { email, requiredText, rev, searchText, text } from "./common";

const staffShape = {
  name: requiredText(120, "Enter the team member's name."),
  position: requiredText(120, "Enter a position."),
  team: requiredText(120, "Enter a team."),
  email,
  phone: text(40).optional(),
  status: z.enum(STAFF_STATUSES).optional(),
  notes: text(1000).optional(),
  /** Transporting participants makes the vehicle checklist items mandatory. */
  transportsParticipants: z.boolean().optional(),
  /** How they are employed. "" and null both mean "not recorded yet". */
  employmentType: z
    .union([z.enum(EMPLOYMENT_TYPES), z.literal(""), z.null()])
    .optional(),
  /** Their award classification, from the list in Pay rules. "" and null clear it. */
  classificationId: z.union([text(60), z.null()]).optional(),
  /** Hours a week they are engaged for (full-time and part-time). */
  contractedHours: z
    .number({ error: "Enter the contracted hours as a number." })
    .min(0, { error: "Contracted hours cannot be negative." })
    .max(80, { error: "Enter weekly hours of 80 or fewer." })
    .optional(),
  /** Their employee number in the payroll system, so an export lines up with it. */
  payrollId: text(40).optional(),
};

export const staffCreateSchema = z.object(staffShape);
export type StaffCreateInput = z.input<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object(staffShape).partial().extend({ rev });
export type StaffUpdateInput = z.input<typeof staffUpdateSchema>;

export const staffListQuery = z.object({
  status: z.enum([...STAFF_STATUSES, "all", "assignable"]).default("all"),
  team: text(120).optional(),
  q: searchText,
});
