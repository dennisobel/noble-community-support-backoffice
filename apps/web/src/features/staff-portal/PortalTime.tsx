import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AvailabilityDayDTO, LeaveRequestDTO } from "@shared/dto";
import { LEAVE_TYPES, PAID_LEAVE_TYPES, type LeaveType } from "@shared/enums";
import { addDays } from "@shared/logic/time";
import { errorMessage } from "@/api/client";
import {
  usePortalAvailability,
  usePortalLeave,
  usePortalTimesheets,
  useRequestLeave,
  useSetPortalAvailability,
  useWithdrawLeave,
} from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import AvailabilityEditor from "@/features/staff/AvailabilityEditor";
import { leaveDates } from "@/features/staff/StaffLeave";
import { minutesText } from "@/features/payroll/pay-ui";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { Chip, Empty, Section, type Tone } from "./kit";

/* ───────────── Availability ───────────── */

/** The days and hours the worker can be rostered. The office sees a warning when a shift falls outside. */
export function PortalAvailability() {
  const availability = usePortalAvailability();
  const save = useSetPortalAvailability();
  const notify = useNotify();
  const [days, setDays] = useState<AvailabilityDayDTO[] | null>(null);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");

  const stamp = availability.data?.updatedAt;
  useEffect(() => {
    if (!availability.data) return;
    setDays(availability.data.days);
    setNote(availability.data.note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, Boolean(availability.data)]);

  if (availability.isError)
    return (
      <ErrorBlock
        error={availability.error}
        onRetry={() => void availability.refetch()}
      />
    );
  if (!availability.data || !days) return <LoadingBlock />;

  const submit = async () => {
    setProblem("");
    try {
      await save.mutateAsync({ days, note });
      notify("Availability saved.");
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  return (
    <>
      <p className="mb-3 text-[12px] leading-5 text-[#5d6c73]">
        {availability.data.set
          ? "Your coordinator sees this when they build the roster."
          : "Tell your coordinator when you can work. Until you do, they assume you are free at any time."}
      </p>
      <div className="portal-card">
        <AvailabilityEditor
          days={days}
          onChange={setDays}
          disabled={save.isPending}
        />
        <label className="portal-field !mb-0 mt-3">
          Anything else they should know
          <input
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="e.g. School pick-up on Thursdays"
          />
        </label>
      </div>
      {problem && (
        <p className="mt-3 rounded-lg bg-[#fbe6e3] px-3 py-2.5 text-[11px] leading-4 text-[#9c3c34]">
          {problem}
        </p>
      )}
      <div className="portal-sticky">
        <button
          type="button"
          className="portal-primary"
          disabled={save.isPending}
          onClick={() => void submit()}
        >
          {save.isPending ? "Saving…" : "Save availability"}
        </button>
      </div>
    </>
  );
}

/* ───────────── Time off ───────────── */

const leaveTone = (status: LeaveRequestDTO["status"]): Tone =>
  status === "Approved"
    ? "ok"
    : status === "Pending"
      ? "info"
      : status === "Declined"
        ? "danger"
        : "muted";

/** Ask for leave or mark days as unavailable, and see what the office decided. */
export function PortalLeave() {
  const leave = usePortalLeave();
  const request = useRequestLeave();
  const withdraw = useWithdrawLeave();
  const notify = useNotify();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState("");
  const [form, setForm] = useState({
    type: "Annual leave" as LeaveType,
    from: "",
    to: "",
    partDay: false,
    startTime: "09:00",
    endTime: "13:00",
    hours: "",
    reason: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const paid = PAID_LEAVE_TYPES.includes(form.type);
  const oneDay = Boolean(form.from) && (form.to || form.from) === form.from;

  const submit = async () => {
    setProblem("");
    try {
      const saved = await request.mutateAsync({
        type: form.type,
        from: form.from,
        to: form.to || form.from,
        startTime: form.partDay && oneDay ? form.startTime : "",
        endTime: form.partDay && oneDay ? form.endTime : "",
        hours: paid && form.hours ? Number(form.hours) : undefined,
        reason: form.reason,
      });
      notify(
        saved.status === "Approved"
          ? "Saved. Nothing was rostered then, so no approval was needed."
          : "Request sent to the office."
      );
      setAdding(false);
      setForm(current => ({ ...current, from: "", to: "", reason: "", hours: "" }));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  if (adding)
    return (
      <>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold text-[#16323a]">
            Ask for time off
          </h2>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#54636b]"
            onClick={() => setAdding(false)}
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </div>
        <form
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="portal-field">
            What kind
            <select
              value={form.type}
              onChange={event => set("type", event.target.value as LeaveType)}
            >
              {LEAVE_TYPES.map(type => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="portal-field">
              First day
              <input
                required
                type="date"
                value={form.from}
                onChange={event => set("from", event.target.value)}
              />
            </label>
            <label className="portal-field">
              Last day
              <input
                type="date"
                min={form.from}
                value={form.to}
                onChange={event => set("to", event.target.value)}
              />
            </label>
          </div>
          {oneDay && (
            <label className="mb-3 flex items-center gap-2 text-[12px] text-[#41555d]">
              <input
                type="checkbox"
                className="accent-[#12766f]"
                checked={form.partDay}
                onChange={event => set("partDay", event.target.checked)}
              />
              Only part of the day
            </label>
          )}
          {oneDay && form.partDay && (
            <div className="grid grid-cols-2 gap-3">
              <label className="portal-field">
                Away from
                <input
                  type="time"
                  value={form.startTime}
                  onChange={event => set("startTime", event.target.value)}
                />
              </label>
              <label className="portal-field">
                Until
                <input
                  type="time"
                  value={form.endTime}
                  onChange={event => set("endTime", event.target.value)}
                />
              </label>
            </div>
          )}
          {paid && (
            <label className="portal-field">
              Paid hours you are asking for
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={form.hours}
                onChange={event => set("hours", event.target.value)}
                placeholder="Leave blank if you are not sure"
              />
            </label>
          )}
          <label className="portal-field">
            Reason
            <textarea
              rows={3}
              value={form.reason}
              onChange={event => set("reason", event.target.value)}
              placeholder="Optional"
            />
          </label>
          {problem && (
            <p className="mb-3 rounded-lg bg-[#fbe6e3] px-3 py-2.5 text-[11px] leading-4 text-[#9c3c34]">
              {problem}
            </p>
          )}
          <div className="portal-sticky space-y-2">
            <button
              type="submit"
              className="portal-primary"
              disabled={request.isPending}
            >
              {request.isPending ? "Sending…" : "Send request"}
            </button>
            <button
              type="button"
              className="portal-secondary"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </>
    );

  return (
    <>
      {leave.isPending ? (
        <LoadingBlock />
      ) : leave.isError ? (
        <ErrorBlock error={leave.error} onRetry={() => void leave.refetch()} />
      ) : leave.data.length ? (
        leave.data.map(item => (
          <div key={item.id} className="portal-card mb-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[13px] text-[#16323a]">{item.type}</b>
              <Chip tone={leaveTone(item.status)}>{item.status}</Chip>
            </div>
            <p className="mt-1 text-[11px] text-[#5d6c73]">
              {leaveDates(item)}
              {item.hours > 0 && ` · ${item.hours} paid hours`}
            </p>
            {item.decisionNote && (
              <p className="mt-1.5 text-[11px] leading-4 text-[#6d7c82]">
                {item.decisionNote}
              </p>
            )}
            {item.clashes.length > 0 &&
              (item.status === "Pending" || item.status === "Approved") && (
                <p className="mt-1.5 text-[11px] leading-4 text-[#8a6224]">
                  You are still rostered on {item.clashes.length} shift
                  {item.clashes.length === 1 ? "" : "s"} in these dates. The
                  office will sort that out.
                </p>
              )}
            {(item.status === "Pending" || item.status === "Approved") &&
              !item.payRunId && (
                <button
                  type="button"
                  className="mt-2 !text-[11px] !font-bold text-[#a33a33]"
                  disabled={withdraw.isPending}
                  onClick={() =>
                    withdraw.mutate(item.id, {
                      onSuccess: () => notify("Request withdrawn."),
                      onError: error => notify(errorMessage(error), "error"),
                    })
                  }
                >
                  Withdraw
                </button>
              )}
          </div>
        ))
      ) : (
        <Empty>
          No time off yet. Ask for leave here, or mark a day you cannot work.
        </Empty>
      )}
      <div className="portal-sticky">
        <button
          type="button"
          className="portal-primary"
          onClick={() => {
            setProblem("");
            setAdding(true);
          }}
        >
          <Plus size={16} /> Ask for time off
        </button>
      </div>
    </>
  );
}

/* ───────────── Timesheets ───────────── */

const sheetTone = (status: string): Tone =>
  status === "Approved" || status === "In pay run"
    ? "ok"
    : status === "Awaiting approval" || status === "In progress"
      ? "info"
      : status === "No sign-on"
        ? "warn"
        : "muted";

/** The worker's hours for a pay period and where each timesheet stands. Hours only, never amounts. */
export function PortalTimesheets() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const sheets = usePortalTimesheets(date);

  if (sheets.isError)
    return (
      <ErrorBlock error={sheets.error} onRetry={() => void sheets.refetch()} />
    );
  if (!sheets.data) return <LoadingBlock label="Loading your hours…" />;
  const { period, rows, totals } = sheets.data;
  const worked = rows.filter(
    row => row.status !== "Upcoming" && row.status !== "Cancelled"
  );

  return (
    <>
      <div className="portal-card mb-4 flex items-center gap-2">
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#3c565c]"
          onClick={() => setDate(addDays(period.from, -1))}
          aria-label="Previous pay period"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <b className="block text-[12px] text-[#16323a]">{period.label}</b>
          <small className="text-[10px] text-[#7a888d]">
            {period.length} pay period{period.current ? " · this one" : ""}
          </small>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#3c565c]"
          onClick={() => setDate(addDays(period.to, 1))}
          aria-label="Next pay period"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <div className="portal-stat">
          <b>{totals.approvedHours}</b>
          <span>Hours approved</span>
        </div>
        <div className="portal-stat">
          <b>{totals.awaiting}</b>
          <span>With the office</span>
        </div>
        <div className="portal-stat">
          <b>{totals.missing}</b>
          <span>No sign-on</span>
        </div>
      </div>

      <Section title="Shifts in this period">
        {worked.length ? (
          worked.map(row => (
            <div key={row.id} className="portal-card mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[13px] text-[#16323a]">
                  {prettyDate(row.date)}
                </b>
                <Chip tone={sheetTone(row.status)}>
                  {row.status === "In pay run" ? "Paid" : row.status}
                </Chip>
              </div>
              <p className="mt-1 text-[11px] text-[#5d6c73]">
                {row.serviceName} · {row.clients}
              </p>
              <p className="mt-1 text-[11px] text-[#7a888d]">
                Rostered {row.rostered.start}–{row.rostered.end}
                {row.actual &&
                  ` · you recorded ${row.actual.start}–${row.actual.end ?? "…"}`}
              </p>
              {(row.status === "Approved" || row.status === "In pay run") && (
                <p className="mt-1 text-[11px] font-semibold text-[#2f5b56]">
                  Approved: {row.paid.start}–{row.paid.end} ·{" "}
                  {minutesText(row.paid.minutes)}
                  {row.approval?.note && (
                    <span className="block font-normal text-[#6d7c82]">
                      {row.approval.note}
                    </span>
                  )}
                </p>
              )}
              {row.status === "No sign-on" && (
                <p className="mt-1 text-[11px] leading-4 text-[#8a6224]">
                  You did not sign on for this shift in the app. If you worked
                  it, tell the office so they can enter the hours.
                </p>
              )}
            </div>
          ))
        ) : (
          <Empty>No worked shifts in this pay period.</Empty>
        )}
      </Section>
    </>
  );
}
