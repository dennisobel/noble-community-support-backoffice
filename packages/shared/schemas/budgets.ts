import { z } from "zod";
import { MESSAGES } from "../messages";
import { money, requiredText, rev, ymd } from "./common";

const planWindow = {
  planStart: z.string({ error: MESSAGES.budgetDates }).pipe(ymd),
  planEnd: z.string({ error: MESSAGES.budgetDates }).pipe(ymd),
};

export const budgetSetupSchema = z
  .object({
    ...planWindow,
    categories: z
      .array(
        z.object({
          name: requiredText(80, "Enter a category name."),
          allocation: money(MESSAGES.budgetAmount),
        })
      )
      .min(1, { error: MESSAGES.budgetPositive })
      .max(12),
    confirmedAgainstPlan: z.literal(true, { error: MESSAGES.budgetConfirm }),
  })
  .superRefine((value, ctx) => {
    if (value.planEnd < value.planStart)
      ctx.addIssue({
        code: "custom",
        message: MESSAGES.budgetDates,
        path: ["planEnd"],
      });
    if (!value.categories.some(category => category.allocation > 0)) {
      ctx.addIssue({
        code: "custom",
        message: MESSAGES.budgetPositive,
        path: ["categories"],
      });
    }
    const names = value.categories.map(category => category.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: "custom",
        message: "Each category can appear only once.",
        path: ["categories"],
      });
    }
  });
export type BudgetSetupInput = z.input<typeof budgetSetupSchema>;

export const budgetAdjustSchema = z.object({
  category: requiredText(80, "Choose a support category."),
  allocation: money(MESSAGES.budgetAmount),
  reason: z.string().trim().min(1, { error: MESSAGES.budgetReason }).max(500),
  rev,
});
export type BudgetAdjustInput = z.input<typeof budgetAdjustSchema>;

export const budgetPlanSchema = z
  .object({ ...planWindow, rev })
  .refine(value => value.planEnd >= value.planStart, {
    error: MESSAGES.budgetDates,
    path: ["planEnd"],
  });
