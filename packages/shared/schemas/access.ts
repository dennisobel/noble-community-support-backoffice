import { z } from "zod";
import { ACCESS_MODULES, OFFICE_ROLES } from "../enums";
import { password } from "./auth";
import { email, requiredText, text } from "./common";

/** Anyone who is not the first Admin asks for access here; an Admin approves them and decides what they can open. */
export const registerSchema = z.object({
  name: requiredText(120, "Enter your full name."),
  email,
  password,
  /** What they need Noble for, to help the Admin decide. */
  message: text(500).optional(),
});
export type RegisterInput = z.input<typeof registerSchema>;

const modules = z.array(z.enum(ACCESS_MODULES)).max(ACCESS_MODULES.length);

/**
 * Approving is where the role and the modules are chosen. Admins get every module, so none are
 * listed. Nothing ticked is fine: everyone approved still gets My day and Notes.
 */
export const approveUserSchema = z.object({
  role: z.enum(OFFICE_ROLES),
  modules,
});
export type ApproveUserInput = z.input<typeof approveUserSchema>;

export const declineUserSchema = z.object({ note: text(300).optional() });

export const updateUserAccessSchema = z.object({
  role: z.enum(OFFICE_ROLES).optional(),
  modules: modules.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
export type UpdateUserAccessInput = z.input<typeof updateUserAccessSchema>;
