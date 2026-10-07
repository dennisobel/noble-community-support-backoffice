import { CalendarOff, Check, Plus, TriangleAlert, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import type { LeaveRequestDTO } from "@shared/dto";
import { LEAVE_TYPES, PAID_LEAVE_TYPES, type LeaveType } from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useCancelLeave,
  useDecideLeave,
  useLeave,
  useRecordLeave,
  useStaff,
} from "@/api/hooks";
import {
  Avatar,
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { formatDateTime, prettyDate, shortDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const FILTERS = [
  ["Pending", "Waiting for an answer"],
  ["Approved", "Approved"],
  ["all", "Everything"],
] as const;

/** "12 Oct 2026 – 14 Oct 2026 · 3 days", or one day with its hours. */
export function leaveDates(request: LeaveRequestDTO): string {
  if (request.from === request.to)
    return request.startTime && request.endTime
      ? `${prettyDate(request.from)}, ${request.startTime}–${request.endTime}`
      : prettyDate(request.from);
  return `${prettyDate(request.from)} – ${prettyDate(request.to)} · ${request.days} days`;
}

/** Record time off on someone's behalf, approved in the same step if the office already agreed. */
function RecordLeaveDrawer({ onClose }: { onClose: () => void }) {
  const staff = useStaff({ status: "all" });
  const record = useRecordLeave();
  const notify = useNotify();
  const [form, setForm] = useState({
    staffId: "",
    type: "Annual leave" as LeaveType,
    from: "",
    to: "",
    partDay: false,
    startTime: "09:00",
    endTime: "13:00",
    hours: "",
    reason: "",
    approve: true,
  });
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const paid = PAID_LEAVE_TYPES.includes(form.type);
  const oneDay = Boolean(form.from) && (form.to || form.from) === form.from;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const saved = await record.mutateAsync({
        staffId: form.staffId,
        type: form.type,
        from: form.from,
        to: form.to || form.from,
        startTime: form.partDay && oneDay ? form.startTime : "",
        endTime: form.partDay && oneDay ? form.endTime : "",
        hours: paid && form.hours ? Number(form.hours) : undefined,
        reason: form.reason,
        approve: form.approve,
      });
      notify(
        saved.clashes.length
          ? `Recorded. ${saved.staffName} is still on ${saved.clashes.length} rostered shift${saved.clashes.length === 1 ? "" : "s"} in those dates.`
          : `Time off recorded for ${saved.staffName}.`,
        saved.clashes.length ? "info" : "success"
      );
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      onClose={onClose}
      eyebrow="Leave & time off"
      title="Record time off"
      subtitle="For leave agreed in person or over the phone. Workers can also ask from their portal."
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" form="leave-form" loading={record.isPending}>
            <Check size={14} />
            Record time off
          </Btn>
        </div>
      }
    >
      <form id="leave-form" className="space-y-4" onSubmit={submit}>
        <Panel title="Who and when">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <label className="label sm:col-span-2">
              Team member <span className="text-red-600">*</span>
              <select
                required
                className="select mt-1"
                value={form.staffId}
                onChange={event => set("staffId", event.target.value)}
              >
                <option value="">Choose someone…</option>
                {(staff.data ?? []).map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label sm:col-span-2">
              Type
              <select
                className="select mt-1"
                value={form.type}
                onChange={event => set("type", event.target.value as LeaveType)}
              >
                {LEAVE_TYPES.map(type => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="label">
              First day <span className="text-red-600">*</span>
              <input
                required
                type="date"
                className="input mt-1"
                value={form.from}
                onChange={event => set("from", event.target.value)}
              />
            </label>
            <label className="label">
              Last day
              <input
                type="date"
                className="input mt-1"
                min={form.from}
                value={form.to}
                onChange={event => set("to", event.target.value)}
              />
              <span className="field-help block font-normal">
                Leave blank for a single day.
              </span>
            </label>
            {oneDay && (
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-xs text-[#52666f]">
                  <input
                    type="checkbox"
                    className="accent-[#147f79]"
                    checked={form.partDay}
                    onChange={event => set("partDay", event.target.checked)}
                  />
                  Only part of the day
                </label>
                {form.partDay && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-[#63757d]">
                    <input
                      type="time"
                      className="input !w-[120px]"
                      value={form.startTime}
                      aria-label="Away from"
                      onChange={event => set("startTime", event.target.value)}
                    />
                    to
                    <input
                      type="time"
                      className="input !w-[120px]"
                      value={form.endTime}
                      aria-label="Away until"
                      onChange={event => set("endTime", event.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>
        <Panel title="Details">
          <div className="space-y-4 p-5">
            {paid && (
              <label className="label">
                Paid hours
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="input mt-1 !w-[140px] block"
                  value={form.hours}
                  onChange={event => set("hours", event.target.value)}
                  placeholder="e.g. 7.6"
                />
                <span className="field-help block font-normal">
                  Goes into the pay run for the period the leave starts in, for
                  full-time and part-time staff. Leave it blank if nothing is to
                  be paid.
                </span>
              </label>
            )}
            <label className="label">
              Reason
              <textarea
                className="textarea mt-1 !min-h-[70px]"
                value={form.reason}
                onChange={event => set("reason", event.target.value)}
              />
            </label>
            <label className="flex items-start gap-2 rounded-md bg-[#f5f8f7] p-3 text-xs text-[#586c74]">
              <input
                type="checkbox"
                className="mt-0.5 accent-[#147f79]"
                checked={form.approve}
                onChange={event => set("approve", event.target.checked)}
              />
              <span>
                <b className="block text-[#405761]">Approve it now</b>
                <small className="mt-1 block text-[10px] text-[#839097]">
                  Untick to leave it waiting for someone else to decide.
                </small>
              </span>
            </label>
          </div>
        </Panel>
        <FormAlert message={error} />
      </form>
    </Drawer>
  );
}

/** One request: what was asked, what it clashes with, and the decision. */
function LeaveCard({ request }: { request: LeaveRequestDTO }) {
  const decide = useDecideLeave();
  const cancel = useCancelLeave();
  const notify = useNotify();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const open = request.status === "Pending" || request.status === "Approved";

  const answer = async (decision: "Approved" | "Declined") => {
    setError("");
    try {
      await decide.mutateAsync({
        id: request.id,
        decision,
        note,
        rev: request.rev,
      });
      notify(
        `${request.staffName}'s ${request.type.toLowerCase()} ${decision.toLowerCase()}.`
      );
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const withdraw = async () => {
    setError("");
    try {
      await cancel.mutateAsync(request.id);
      notify("Time off cancelled.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <div className="panel p-5">
      <div className="flex items-start gap-3">
        <Avatar name={request.staffName} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[#354a56]">
            {request.staffName}
          </div>
          <div className="mt-1 text-xs text-[#52666f]">
            <b className="text-[#3d525c]">{request.type}</b> ·{" "}
            {leaveDates(request)}
            {request.hours > 0 && ` · ${request.hours} paid hours`}
          </div>
        </div>
        <Status value={request.status} />
      </div>

      {request.reason && (
        <p className="mt-3 whitespace-pre-line text-xs leading-5 text-[#63757d]">
          {request.reason}
        </p>
      )}

      {open && request.clashes.length > 0 && (
        <div className="mt-3 rounded-md border border-[#f3e2bd] bg-[#fff8e8] p-3 text-xs text-[#8a6224]">
          <div className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert size={13} />
            Still rostered on {request.clashes.length} shift
            {request.clashes.length === 1 ? "" : "s"} in these dates
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {request.clashes.slice(0, 5).map(clash => (
              <li key={clash.shiftId}>
                {shortDate(clash.date)} {clash.start}–{clash.end} ·{" "}
                {clash.clients} ({clash.shiftId})
              </li>
            ))}
          </ul>
          <Link
            href="/app/roster"
            className="mt-2 inline-block font-semibold text-[#8a6224] underline"
          >
            Reassign them in the roster
          </Link>
        </div>
      )}

      {request.status === "Pending" ? (
        <div className="mt-4 border-t border-[#edf0ef] pt-4">
          <label className="label">
            Note to the worker
            <input
              className="input mt-1"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Btn
              variant="secondary"
              onClick={() => void answer("Declined")}
              loading={decide.isPending}
            >
              <X size={14} />
              Decline
            </Btn>
            <Btn
              onClick={() => void answer("Approved")}
              loading={decide.isPending}
            >
              <Check size={14} />
              Approve
            </Btn>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0ef] pt-3">
          <p className="text-[10px] leading-4 text-[#849198]">
            {request.decidedBy
              ? `${request.status} by ${request.decidedBy.name} · ${formatDateTime(request.decidedAt)}`
              : `Asked ${formatDateTime(request.requestedAt)}`}
            {request.decisionNote && (
              <span className="block text-[#63757d]">
                {request.decisionNote}
              </span>
            )}
            {request.payRunId && (
              <span className="block">Paid in {request.payRunId}</span>
            )}
          </p>
          {request.status === "Approved" && !request.payRunId && (
            <Btn
              variant="quiet"
              className="!h-8 !px-2 text-[11px]"
              onClick={() => void withdraw()}
              loading={cancel.isPending}
            >
              Cancel this time off
            </Btn>
          )}
        </div>
      )}
      <FormAlert message={error} />
    </div>
  );
}

/** Leave and time off across the team: what is waiting for an answer, and what is booked. */
export default function StaffLeave() {
  const [filter, setFilter] =
    useState<(typeof FILTERS)[number][0]>("Pending");
  const leave = useLeave({ status: filter });
  const [recording, setRecording] = useState(false);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1.5 !text-[11px] !font-semibold ${
                filter === key
                  ? "bg-[#e3f1ee] text-[#12766f]"
                  : "border border-[#dde5e2] bg-white text-[#63757d]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Btn onClick={() => setRecording(true)}>
          <Plus size={14} />
          Record time off
        </Btn>
      </div>

      {leave.isError && (
        <ErrorBlock error={leave.error} onRetry={() => leave.refetch()} />
      )}
      {leave.isPending ? (
        <LoadingBlock />
      ) : leave.data?.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {leave.data.map(request => (
            <LeaveCard key={request.id} request={request} />
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            icon={<CalendarOff size={19} />}
            title={
              filter === "Pending"
                ? "Nothing waiting for an answer"
                : "No time off recorded"
            }
            text="Workers ask for leave from their portal, under Schedule. You can also record it here."
          />
        </Panel>
      )}

      {recording && <RecordLeaveDrawer onClose={() => setRecording(false)} />}
    </>
  );
}
