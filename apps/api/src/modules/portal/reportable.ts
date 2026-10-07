import {
  REPORTABLE_FOLLOW_UP_BUSINESS_DAYS,
  REPORTABLE_NOTIFY_HOURS,
} from "@shared/const";
import type { IncidentReportableDTO } from "@shared/dto";
import { addBusinessDays } from "@shared/logic/holidays";
import { localParts, zonedInstant } from "@shared/logic/time";
import { iso } from "../../lib/mappers";
import type { IncidentReportableSub } from "../../models";

/** The one reportable incident that has five business days, unless it caused harm. */
const RESTRICTIVE_PRACTICE = "Unauthorised use of a restrictive practice";

export interface ReportableEnv {
  timezone: string;
  /** Public holidays, which are not business days. */
  holidays: ReadonlySet<string>;
}

/**
 * When each lodgement is due, counted from when key personnel became aware. A restrictive
 * practice that harmed nobody skips the 24-hour notification and has only the five-day report.
 */
export function reportableDeadlines(
  reportable: Pick<IncidentReportableSub, "kind" | "awareAt" | "harm">,
  env: ReportableEnv
): { notifyBy: Date | null; fiveDayBy: Date | null } {
  if (!reportable.awareAt) return { notifyBy: null, fiveDayBy: null };
  const aware = reportable.awareAt;
  const local = localParts(env.timezone, aware);
  // The same clock time, that many business days on.
  const fiveDayBy = zonedInstant(
    addBusinessDays(
      local.date,
      REPORTABLE_FOLLOW_UP_BUSINESS_DAYS,
      env.holidays
    ),
    local.minutes,
    env.timezone
  );
  const immediate = !(
    reportable.kind === RESTRICTIVE_PRACTICE && !reportable.harm
  );
  return {
    notifyBy: immediate
      ? new Date(aware.getTime() + REPORTABLE_NOTIFY_HOURS * 3_600_000)
      : null,
    fiveDayBy,
  };
}

export function toReportableDTO(
  reportable: IncidentReportableSub | undefined,
  env: ReportableEnv,
  now: Date = new Date()
): IncidentReportableDTO {
  const flagged = Boolean(reportable?.flagged);
  const { notifyBy, fiveDayBy } =
    flagged && reportable
      ? reportableDeadlines(reportable, env)
      : { notifyBy: null, fiveDayBy: null };
  const steps = [
    {
      label: "Immediate notification",
      due: notifyBy,
      done: reportable?.notifiedAt,
    },
    { label: "Five-day report", due: fiveDayBy, done: reportable?.fiveDayAt },
  ];
  const outstanding = steps.find(step => step.due && !step.done);
  return {
    flagged,
    type: reportable?.kind ?? null,
    awareAt: iso(reportable?.awareAt),
    harm: Boolean(reportable?.harm),
    notifyBy: iso(notifyBy),
    notifiedAt: iso(reportable?.notifiedAt),
    notifiedReference: reportable?.notifiedReference ?? "",
    fiveDayBy: iso(fiveDayBy),
    fiveDayAt: iso(reportable?.fiveDayAt),
    note: reportable?.note ?? "",
    next: outstanding?.due
      ? {
          label: outstanding.label,
          due: outstanding.due.toISOString(),
          overdue: outstanding.due.getTime() < now.getTime(),
        }
      : null,
  };
}
