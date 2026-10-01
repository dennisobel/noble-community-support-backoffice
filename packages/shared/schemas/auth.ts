import { z } from "zod";
import { MESSAGES } from "../messages";
import { email, requiredText } from "./common";

export const MIN_PASSWORD_LENGTH = 8;

export const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, { error: MESSAGES.password(MIN_PASSWORD_LENGTH) })
  .max(200, { error: "Keep the password under 200 characters." });

export const signupSchema = z.object({
  name: requiredText(120, "Enter your full name."),
  email,
  password,
  setupCode: z.string().trim().max(200).optional(),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }).max(200),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20, { error: "This reset link is invalid." }).max(200),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, { error: "Enter your current password." })
    .max(200),
  newPassword: password,
});

export const updateMeSchema = z.object({
  name: requiredText(120, "Enter your full name.").optional(),
  email: email.optional(),
});
