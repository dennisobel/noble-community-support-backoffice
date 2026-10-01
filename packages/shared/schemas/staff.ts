import { z } from "zod";
import { STAFF_STATUSES } from "../enums";
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
