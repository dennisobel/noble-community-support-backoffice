import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "wouter";
import type { PortalShiftDTO } from "@shared/dto";
import { addDays, startOfWeek, todayIn } from "@shared/logic/time";
import { DEFAULT_TIMEZONE } from "@shared/const";
import { usePortalShifts } from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { Empty, ShiftCard } from "./kit";
import { PortalAvailability, PortalLeave, PortalTimesheets } from "./PortalTime";

const SECTIONS = [
  ["roster", "Roster"],
  ["availability", "Availability"],
  ["time-off", "Time off"],
  ["timesheets", "Timesheets"],
] as const;

/** Everything about the worker's time: when they are rostered, when they can work, and their hours. */
export default function PortalSchedule() {
  const params = useParams<{ section?: string }>();
  const section =
    SECTIONS.find(([key]) => key === params.section)?.[0] ?? "roster";
  return (
    <>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {SECTIONS.map(([key, label]) => (
          <Link
            key={key}
            href={key === "roster" ? "/staff/schedule" : `/staff/schedule/${key}`}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[11px] font-bold no-underline ${
              section === key
                ? "bg-[#12766f] text-white"
                : "border border-[#dbe4e0] bg-white text-[#54636b]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      {section === "roster" && <RosterWeek />}
      {section === "availability" && <PortalAvailability />}
      {section === "time-off" && <PortalLeave />}
      {section === "timesheets" && <PortalTimesheets />}
    </>
  );
}

const dayName = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-AU", {
    weekday: "long",
    timeZone: "UTC",
  });

/** The worker's roster, a week at a time. */
function RosterWeek() {
  const today = todayIn(DEFAULT_TIMEZONE);
  const [monday, setMonday] = useState(() => startOfWeek(today));
  const to = addDays(monday, 6);
  const shifts = usePortalShifts({ from: monday, to });

  const byDay = new Map<string, PortalShiftDTO[]>();
  for (const shift of shifts.data ?? []) {
    const day = byDay.get(shift.date) ?? [];
    day.push(shift);
    byDay.set(shift.date, day);
  }
  const hours = (shifts.data ?? []).reduce((sum, s) => sum + s.hours, 0);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));

  return (
    <>
      <div className="portal-card mb-4 flex items-center gap-2">
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#3c565c]"
          onClick={() => setMonday(current => addDays(current, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <b className="block text-[12px] text-[#16323a]">
            {prettyDate(monday)} – {prettyDate(to)}
          </b>
          <small className="text-[10px] text-[#7a888d]">
            {shifts.data?.length ?? 0} shift
            {(shifts.data?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {Math.round(hours * 10) / 10} hr
          </small>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#3c565c]"
          onClick={() => setMonday(current => addDays(current, 7))}
          aria-label="Next week"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {monday !== startOfWeek(today) && (
        <button
          type="button"
          className="portal-secondary mb-4"
          onClick={() => setMonday(startOfWeek(today))}
        >
          Back to this week
        </button>
      )}

      {shifts.isPending ? (
        <LoadingBlock label="Loading your roster…" />
      ) : shifts.isError ? (
        <ErrorBlock
          error={shifts.error}
          onRetry={() => void shifts.refetch()}
        />
      ) : !shifts.data.length ? (
        <Empty>No shifts rostered for this week.</Empty>
      ) : (
        days.map(day => {
          const list = byDay.get(day);
          if (!list?.length) return null;
          return (
            <section key={day} className="mb-4">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-[#67767c]">
                {dayName(day)}{" "}
                <span className="font-semibold text-[#9aa7ab]">
                  {prettyDate(day)}
                </span>
                {day === today && (
                  <span className="ml-2 rounded-full bg-[#e8f3f0] px-2 py-0.5 text-[9px] text-[#12766f]">
                    Today
                  </span>
                )}
              </h3>
              {list.map(shift => (
                <ShiftCard key={shift.id} shift={shift} />
              ))}
            </section>
          );
        })
      )}
    </>
  );
}
