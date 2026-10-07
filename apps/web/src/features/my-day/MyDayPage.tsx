import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  MapPin,
  NotebookPen,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { addDays } from "@shared/logic/time";
import { useMeta, useMyDay } from "@/api/hooks";
import {
  Btn,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Panel,
  SectionHeading,
  Status,
} from "@/components/app/ui";
import { prettyDate } from "@/lib/format";

/** The signed-in person's own roster for the day. Everyone approved has this, whatever modules they were given. */
export default function MyDayPage() {
  const meta = useMeta();
  const [picked, setPicked] = useState<string | null>(null);
  const today = meta.data?.today;
  const date = picked ?? today;
  const day = useMyDay(date);

  return (
    <>
      <SectionHeading
        title="My day"
        subtitle="Your own shifts, and nobody else's."
        actions={
          <Link href="/app/notes">
            <Btn variant="secondary">
              <NotebookPen size={14} />
              My notes
            </Btn>
          </Link>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous day"
          disabled={!date}
          onClick={() => date && setPicked(addDays(date, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <b className="block text-sm text-[#344854]">
            {date ? prettyDate(date) : ""}
          </b>
          {date === today && (
            <span className="text-[11px] text-[#87949a]">Today</span>
          )}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next day"
          disabled={!date}
          onClick={() => date && setPicked(addDays(date, 1))}
        >
          <ChevronRight size={18} />
        </button>
        {date !== today && (
          <Btn variant="quiet" onClick={() => setPicked(null)}>
            Today
          </Btn>
        )}
      </div>

      {day.isPending && <LoadingBlock />}
      {day.isError && <ErrorBlock error={day.error} onRetry={() => day.refetch()} />}
      {day.data && !day.data.staff && (
        <Panel>
          <EmptyState
            title="No shifts to show yet"
            text={`Your roster comes from the Staff directory. Ask an Admin to add you under Staff with the email ${day.data.email}, and your shifts will appear here.`}
            icon={<CalendarCheck size={19} />}
          />
        </Panel>
      )}
      {day.data?.staff && day.data.shifts.length === 0 && (
        <Panel>
          <EmptyState
            title="Nothing rostered"
            text="You have no shifts on this day."
            icon={<CalendarCheck size={19} />}
          />
        </Panel>
      )}
      {day.data?.staff && day.data.shifts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-[#687982]">
            {day.data.shifts.length} shift{day.data.shifts.length > 1 ? "s" : ""} ·{" "}
            {day.data.hours} hours
          </p>
          {day.data.shifts.map(shift => (
            <article key={shift.id} className="panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-[#273946]">
                    {shift.start} – {shift.end}
                  </div>
                  <div className="text-[11px] text-[#87949a]">
                    {shift.hours} h · {shift.type}
                  </div>
                </div>
                <Status value={shift.status} />
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-[#4f626b]">
                <p className="flex gap-2">
                  <Users size={14} className="mt-0.5 flex-none" />
                  {shift.clients.map(c => c.preferred || c.name).join(", ") ||
                    "No participants"}
                </p>
                {shift.location && (
                  <p className="flex gap-2">
                    <MapPin size={14} className="mt-0.5 flex-none" />
                    {shift.location}
                  </p>
                )}
                {shift.staff.length > 1 && (
                  <p className="text-[#87949a]">
                    With{" "}
                    {shift.staff
                      .filter(member => member.id !== day.data.staff?.id)
                      .map(member => member.name)
                      .join(", ")}
                  </p>
                )}
                {shift.notes && (
                  <p className="rounded-md bg-[#f6f8f7] p-2.5">{shift.notes}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
