import {
  AlertTriangle,
  CalendarDays,
  CalendarOff,
  ChevronRight,
  ClipboardList,
  Car,
  Info,
  MessagesSquare,
  NotebookPen,
  ShieldAlert,
} from "lucide-react";
import { Link } from "wouter";
import { usePortalHome } from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { greeting } from "@/lib/format";
import { Empty, Section, ShiftCard } from "./kit";

const ALERT_ICON = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
} as const;

const QUICK = [
  {
    href: "/staff/notes/new",
    label: "Write a progress note",
    icon: NotebookPen,
  },
  {
    href: "/staff/reports/incidents",
    label: "Report an incident",
    icon: ShieldAlert,
  },
  { href: "/staff/reports/abc", label: "Record an ABC", icon: ClipboardList },
  { href: "/staff/reports/logbook", label: "Add kilometres", icon: Car },
  {
    href: "/staff/schedule/time-off",
    label: "Ask for time off",
    icon: CalendarOff,
  },
  { href: "/staff/messages", label: "Message the office", icon: MessagesSquare },
];

/** The worker's landing screen: what is on today, what is overdue, and the quick actions. */
export default function PortalHome() {
  const home = usePortalHome();

  if (home.isPending) return <LoadingBlock label="Loading your day…" />;
  if (home.isError)
    return (
      <ErrorBlock error={home.error} onRetry={() => void home.refetch()} />
    );
  const data = home.data;

  return (
    <>
      <header className="mb-5">
        <h2 className="text-[22px] font-bold tracking-[-.02em] text-[#16323a]">
          {greeting()}, {data.greetingName}.
        </h2>
        <p className="mt-1 text-[12px] text-[#6d7c82]">
          {data.todayShifts.length
            ? `${data.todayShifts.length} shift${data.todayShifts.length === 1 ? "" : "s"} today · ${data.weekHours} hr this week`
            : "Nothing rostered today."}
        </p>
      </header>

      {data.alerts.length > 0 && (
        <div className="mb-5 space-y-2">
          {data.alerts.map(alert => {
            const Icon = ALERT_ICON[alert.severity] ?? Info;
            return (
              <Link
                key={alert.key}
                href={alert.link}
                className="portal-card flex items-start gap-3 !border-l-[3px]"
                style={{
                  borderLeftColor:
                    alert.severity === "danger"
                      ? "#a33a33"
                      : alert.severity === "warning"
                        ? "#c98a2c"
                        : "#3b6f9c",
                }}
              >
                <Icon
                  size={16}
                  className={
                    alert.severity === "danger"
                      ? "mt-0.5 shrink-0 text-[#a33a33]"
                      : alert.severity === "warning"
                        ? "mt-0.5 shrink-0 text-[#c98a2c]"
                        : "mt-0.5 shrink-0 text-[#3b6f9c]"
                  }
                />
                <span className="min-w-0 flex-1">
                  <b className="block text-[12px] text-[#1f3a42]">
                    {alert.title}
                  </b>
                  <small className="mt-0.5 block text-[11px] leading-4 text-[#6d7c82]">
                    {alert.message}
                  </small>
                </span>
                <ChevronRight
                  size={15}
                  className="mt-0.5 shrink-0 text-[#9aa7ab]"
                />
              </Link>
            );
          })}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="portal-stat">
          <b>{data.hoursThisMonth}</b>
          <span>Hours this month</span>
        </div>
        <div className="portal-stat">
          <b>{data.kmThisMonth}</b>
          <span>KM this month</span>
        </div>
        <div className="portal-stat">
          <b>{data.openNotes}</b>
          <span>Notes to write</span>
        </div>
        <div className="portal-stat">
          <b>{data.drafts.reports + data.drafts.notes}</b>
          <span>Drafts</span>
        </div>
      </div>

      <Section
        title="Today"
        action={
          <Link
            href="/staff/schedule"
            className="text-[11px] font-bold text-[#12766f]"
          >
            Full schedule
          </Link>
        }
      >
        {data.todayShifts.length ? (
          data.todayShifts.map(shift => (
            <ShiftCard key={shift.id} shift={shift} />
          ))
        ) : data.nextShift ? (
          <>
            <p className="mb-2 text-[11px] text-[#7a888d]">
              Nothing today. Next up:
            </p>
            <ShiftCard shift={data.nextShift} />
          </>
        ) : (
          <Empty>
            No upcoming shifts. Your coordinator will add them to the roster.
          </Empty>
        )}
      </Section>

      <Section title="Quick actions">
        <div className="portal-card !p-0">
          {QUICK.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="portal-row px-4 no-underline"
              >
                <Icon size={17} className="shrink-0 text-[#12766f]" />
                <span className="flex-1 text-[12px] font-semibold text-[#24444b]">
                  {item.label}
                </span>
                <ChevronRight size={15} className="text-[#9aa7ab]" />
              </Link>
            );
          })}
        </div>
      </Section>

      {data.weekShifts.length > 0 && (
        <Section
          title="Rest of the week"
          action={
            <span className="flex items-center gap-1 text-[11px] text-[#7a888d]">
              <CalendarDays size={12} />
              {data.weekHours} hr
            </span>
          }
        >
          {data.weekShifts.slice(0, 4).map(shift => (
            <ShiftCard key={shift.id} shift={shift} />
          ))}
        </Section>
      )}
    </>
  );
}
