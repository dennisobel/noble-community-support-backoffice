import { ChevronRight, Clock, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import type { ExpiryState } from "@shared/enums";
import type { PortalShiftDTO } from "@shared/dto";
import { prettyDate } from "@/lib/format";

/** Tone → the chip class in index.css. */
export type Tone = "ok" | "warn" | "danger" | "info" | "muted";

export function Chip({
  tone = "muted",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`portal-chip portal-chip-${tone}`}>{children}</span>;
}

/** Shared colour language for statuses across the portal. */
export function toneFor(value: string): Tone {
  switch (value) {
    case "Approved":
    case "Confirmed":
    case "Closed":
    case "Reviewed":
      return "ok";
    case "Submitted":
    case "Planned":
    case "Awaiting review":
      return "info";
    case "Returned":
    case "Needs attention":
    case "On leave":
      return "warn";
    case "Cancelled":
    case "Critical":
    case "Major":
      return "danger";
    default:
      return "muted";
  }
}

export const expiryTone = (state: ExpiryState | null): Tone =>
  state === "expired"
    ? "danger"
    : state === "urgent"
      ? "warn"
      : state === "soon"
        ? "info"
        : "ok";

export function expiryLabel(
  state: ExpiryState | null,
  daysLeft: number | null
): string {
  if (state === "expired")
    return daysLeft === null
      ? "Expired"
      : `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago`;
  if (daysLeft === null) return "No expiry";
  if (daysLeft === 0) return "Expires today";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[.07em] text-[#67767c]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="portal-empty">{children}</p>;
}

/** One shift, as a tappable row. Used on the home screen and the schedule. */
export function ShiftCard({ shift }: { shift: PortalShiftDTO }) {
  const running = Boolean(
    shift.timesheet.startedAt && !shift.timesheet.endedAt
  );
  return (
    <Link href={`/staff/shifts/${shift.id}`} className="portal-card mb-2 block">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13px] text-[#16323a]">{shift.serviceName}</b>
            {running ? (
              <Chip tone="ok">On shift</Chip>
            ) : (
              <Chip tone={toneFor(shift.status)}>{shift.status}</Chip>
            )}
            {shift.recordId && <Chip tone="info">Note written</Chip>}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#5d6c73]">
            <Clock size={12} />
            {prettyDate(shift.date)} · {shift.start}–{shift.end} · {shift.hours}{" "}
            hr
          </p>
          {shift.location && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#7a888d]">
              <MapPin size={12} />
              {shift.location}
            </p>
          )}
          {shift.participants.length > 0 && (
            <p className="mt-1.5 text-[11px] font-semibold text-[#2f5b56]">
              {shift.participants.map(person => person.preferred).join(", ")}
            </p>
          )}
        </div>
        <ChevronRight size={16} className="mt-1 shrink-0 text-[#9aa7ab]" />
      </div>
    </Link>
  );
}
