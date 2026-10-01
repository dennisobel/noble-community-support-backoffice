import { z } from "zod";
import { REPORT_EXPORTS, REPORT_PERIODS } from "../enums";
import { text, ymd } from "./common";

export const reportQuery = z
  .object({
    period: z.enum(REPORT_PERIODS).default("last30"),
    from: ymd.optional(),
    to: ymd.optional(),
    team: text(120).optional(),
  })
  .refine(
    value =>
      value.period !== "custom" ||
      (value.from && value.to && value.from <= value.to),
    {
      error: "Choose a start and end date for a custom period.",
      path: ["from"],
    }
  );

export const reportExportQuery = z.intersection(
  reportQuery,
  z.object({ report: z.enum(REPORT_EXPORTS) })
);

export const searchQuery = z.object({ q: z.string().trim().min(1).max(100) });
