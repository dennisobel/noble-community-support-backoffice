import { Check, CheckCheck, Clock, Info, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { TimesheetDTO, TimesheetTimesDTO } from "@shared/dto";
import { errorMessage } from "@/api/client";
import {
  useApproveCleanTimesheets,
  useApproveTimesheet,
  useStaffPay,
  useTimesheetDetail,
  useTimesheets,
  useUnapproveTimesheet,
} from "@/api/hooks";
import {
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  InfoNote,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { formatDateTime, money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { hoursText, Kpi, minutesText, PayLines, PeriodNav } from "./pay-ui";

const span = (times: TimesheetTimesDTO) =>
  `${times.start}–${times.end}${times.overnight ? " (next day)" : ""}`;

/** Review one worker's hours for one shift: what was planned, what they recorded, what gets paid. */
function TimesheetDrawer({
  id,
  onClose,
}: {
  id: { shiftId: string; staffId: string };
  onClose: () => void;
}) {
  const detail = useTimesheetDetail(id);
  const approve = useApproveTimesheet();
  const unapprove = useUnapproveTimesheet();
  const notify = useNotify();
  const [form, setForm] = useState<{
    start: string;
    end: string;
    overnight: boolean;
    breakMinutes: string;
    kilometres: string;
    active: string;
    note: string;
    payCancelled: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const data = detail.data;

  // Start from what would be paid; pick it up again whenever the saved timesheet changes.
  const version = data
    ? `${data.status}|${data.paid.start}|${data.paid.end}|${data.approval?.at ?? ""}`
    : "";
  useEffect(() => {
    if (!data) return;
    setForm({
      start: data.paid.start,
      end: data.paid.end,
      overnight: data.paid.overnight,
      breakMinutes: String(data.paid.breakMinutes),
      kilometres: data.kilometres ? String(data.kilometres) : "",
      active: data.sleepoverActiveMinutes
        ? String(data.sleepoverActiveMinutes)
        : "",
      note: data.approval?.note ?? "",
      payCancelled: data.payCancelled,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const use = (times: TimesheetTimesDTO) =>
    setForm(current =>
      current
        ? {
            ...current,
            start: times.start,
            end: times.end,
            overnight: times.overnight,
            breakMinutes: String(times.breakMinutes),
          }
        : current
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setError("");
    try {
      await approve.mutateAsync({
        ...id,
        start: form.start,
        end: form.end,
        overnight: form.overnight,
        breakMinutes: Number(form.breakMinutes) || 0,
        kilometres: Number(form.kilometres) || 0,
        sleepoverActiveMinutes: Number(form.active) || 0,
        payCancelled: form.payCancelled,
        note: form.note,
      });
      notify("Hours approved.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const withdraw = async () => {
    setError("");
    try {
      await unapprove.mutateAsync(id);
      notify("Approval withdrawn.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const locked = data?.status === "In pay run";
  const cancelled = data?.shiftStatus === "Cancelled";
  const set = <K extends keyof NonNullable<typeof form>>(
    key: K,
    value: NonNullable<typeof form>[K]
  ) => setForm(current => (current ? { ...current, [key]: value } : current));

  return (
    <Drawer
      onClose={onClose}
      wide
      eyebrow={data ? `${prettyDate(data.date)} · ${data.shiftId}` : "Timesheet"}
      title={data ? data.staffName : "Loading…"}
      subtitle={data ? `${data.serviceName} · ${data.clients}` : undefined}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
          {data?.status === "Approved" && (
            <Btn
              variant="secondary"
              onClick={() => void withdraw()}
              loading={unapprove.isPending}
            >
              <RotateCcw size={13} />
              Withdraw approval
            </Btn>
          )}
          {data && !locked && (
            <Btn
              type="submit"
              form="timesheet-form"
              loading={approve.isPending}
            >
              <Check size={14} />
              {data.status === "Approved" ? "Save changes" : "Approve hours"}
            </Btn>
          )}
        </div>
      }
    >
      {detail.isError ? (
        <ErrorBlock error={detail.error} onRetry={() => detail.refetch()} />
      ) : !data || !form ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <Panel title="Planned and recorded">
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                  Rostered
                </div>
                <div className="mt-1 text-sm font-semibold text-[#3d525c]">
                  {span(data.rostered)}
                </div>
                <div className="text-[11px] text-[#7b8990]">
                  {minutesText(data.rostered.minutes)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                  Recorded by the worker
                </div>
                {data.actual ? (
                  <>
                    <div className="mt-1 text-sm font-semibold text-[#3d525c]">
                      {data.actual.start}–{data.actual.end ?? "still on shift"}
                    </div>
                    <div className="text-[11px] text-[#7b8990]">
                      {data.actual.minutes === null
                        ? `Signed on ${formatDateTime(data.actual.startedAt)}`
                        : `${minutesText(data.actual.minutes)}${data.actual.breakMinutes ? ` after a ${data.actual.breakMinutes} min break` : ""}`}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-xs leading-5 text-[#7b8990]">
                    No sign-on from the portal. Enter the hours below if the
                    shift was worked.
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                  Status
                </div>
                <div className="mt-1.5">
                  <Status value={data.status} />
                </div>
                {data.approval && (
                  <div className="mt-1 text-[10px] leading-4 text-[#849198]">
                    {data.approval.by?.name ?? "Approved"} ·{" "}
                    {formatDateTime(data.approval.at)}
                  </div>
                )}
              </div>
              {data.workerNote && (
                <p className="rounded-md bg-[#f5f8f7] p-3 text-xs leading-5 text-[#586c74] sm:col-span-3">
                  <b className="text-[#405761]">Worker's note:</b>{" "}
                  {data.workerNote}
                </p>
              )}
            </div>
          </Panel>

          <form id="timesheet-form" onSubmit={submit}>
            <Panel
              title="Hours to pay"
              action={
                locked ? undefined : (
                  <span className="flex gap-2">
                    <Btn
                      variant="quiet"
                      className="!h-7 !px-2 text-[11px]"
                      onClick={() => use(data.rostered)}
                    >
                      Use rostered
                    </Btn>
                    {data.actual?.end && (
                      <Btn
                        variant="quiet"
                        className="!h-7 !px-2 text-[11px]"
                        onClick={() =>
                          use({
                            start: data.actual!.start,
                            end: data.actual!.end!,
                            overnight: data.actual!.overnight,
                            breakMinutes: data.actual!.breakMinutes,
                            minutes: data.actual!.minutes ?? 0,
                          })
                        }
                      >
                        Use recorded
                      </Btn>
                    )}
                  </span>
                )
              }
            >
              <fieldset
                disabled={locked}
                className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4"
              >
                <label className="label">
                  Start
                  <input
                    required
                    type="time"
                    className="input mt-1"
                    value={form.start}
                    onChange={event => set("start", event.target.value)}
                  />
                </label>
                <label className="label">
                  Finish
                  <input
                    required
                    type="time"
                    className="input mt-1"
                    value={form.end}
                    onChange={event => set("end", event.target.value)}
                  />
                </label>
                <label className="label">
                  Unpaid break (min)
                  <input
                    type="number"
                    min="0"
                    max="600"
                    className="input mt-1"
                    value={form.breakMinutes}
                    onChange={event => set("breakMinutes", event.target.value)}
                  />
                </label>
                <label className="label">
                  Kilometres
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input mt-1"
                    value={form.kilometres}
                    onChange={event => set("kilometres", event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="col-span-2 flex items-center gap-2 text-xs text-[#52666f] sm:col-span-4">
                  <input
                    type="checkbox"
                    className="accent-[#147f79]"
                    checked={form.overnight}
                    onChange={event => set("overnight", event.target.checked)}
                  />
                  Finished the next day
                </label>
                {data.payAs === "Sleepover" && (
                  <label className="label col-span-2">
                    Minutes worked during the sleepover
                    <input
                      type="number"
                      min="0"
                      max="720"
                      className="input mt-1"
                      value={form.active}
                      onChange={event => set("active", event.target.value)}
                      placeholder="0"
                    />
                    <span className="field-help block font-normal">
                      Paid at overtime rates for at least an hour. The night
                      itself is the sleepover allowance.
                    </span>
                  </label>
                )}
                {cancelled && (
                  <label className="col-span-2 flex items-start gap-2 rounded-md bg-[#fff8e8] p-3 text-xs text-[#8a6224] sm:col-span-4">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#147f79]"
                      checked={form.payCancelled}
                      onChange={event =>
                        set("payCancelled", event.target.checked)
                      }
                    />
                    <span>
                      <b className="block">Pay this cancelled shift</b>
                      <span className="mt-0.5 block text-[11px]">
                        For a shift the client cancelled at short notice, where
                        the worker is still owed the hours.
                      </span>
                    </span>
                  </label>
                )}
                <label className="label col-span-2 sm:col-span-4">
                  Note
                  <input
                    className="input mt-1"
                    value={form.note}
                    onChange={event => set("note", event.target.value)}
                    placeholder="Why the hours differ from the roster, if they do"
                  />
                </label>
              </fieldset>
              {locked && (
                <p className="border-t border-[#edf0ef] px-5 py-3 text-[11px] text-[#7b8990]">
                  These hours are in pay run {data.payRunId}. Reopen the pay run
                  to change them.
                </p>
              )}
            </Panel>
          </form>
          <FormAlert message={error} />

          <Panel
            title="How these hours are paid"
            action={
              <span className="text-sm font-semibold text-[#223644]">
                {data.costed ? money(data.gross) : "Not costed"}
              </span>
            }
          >
            <div className="space-y-3 p-5">
              {!data.costed && <InfoNote>{data.costNote}</InfoNote>}
              {data.flags.map(flag => (
                <div
                  key={flag.message}
                  className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                    flag.level === "warning"
                      ? "bg-[#fff8e8] text-[#8a6224]"
                      : "bg-[#eef5fb] text-[#2f5c86]"
                  }`}
                >
                  <Info size={13} className="mt-0.5 shrink-0" />
                  {flag.message}
                </div>
              ))}
              <PayLines lines={data.lines} />
              <p className="text-[10px] leading-4 text-[#9aa5a8]">
                Worked out from the{" "}
                {data.approval ? "approved hours" : "hours shown above"} and
                the rest of {data.staffName}'s pay period, using the Pay rules.
                Change the hours and save to see the new breakdown.
              </p>
            </div>
          </Panel>
        </div>
      )}
    </Drawer>
  );
}

/** Every rostered shift in a pay period, against what was recorded and what will be paid. */
export default function TimesheetsTab() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [staffId, setStaffId] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const list = useTimesheets({ date, staffId: staffId || undefined, cancelled });
  const people = useStaffPay();
  const approveClean = useApproveCleanTimesheets();
  const notify = useNotify();
  const [open, setOpen] = useState<{ shiftId: string; staffId: string } | null>(
    null
  );

  const rows = list.data?.rows ?? [];
  const clean = rows.filter(row => row.clean).length;

  const approveAll = async () => {
    try {
      const result = await approveClean.mutateAsync({
        date: list.data?.period.from,
        staffId: staffId || undefined,
      });
      notify(
        result.left
          ? `${result.approved} approved. ${result.left} differ from the roster and need a look.`
          : `${result.approved} timesheet${result.approved === 1 ? "" : "s"} approved.`
      );
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  const variance = (row: TimesheetDTO) =>
    row.status === "Upcoming" || row.status === "Cancelled" ? (
      "—"
    ) : row.varianceMinutes === 0 ? (
      <span className="text-[#849198]">As rostered</span>
    ) : (
      <span
        className={
          row.varianceMinutes > 0 ? "text-[#9a6419]" : "text-[#276696]"
        }
      >
        {row.varianceMinutes > 0 ? "+" : ""}
        {minutesText(row.varianceMinutes)}
      </span>
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {list.data ? (
          <PeriodNav period={list.data.period} onChange={setDate} />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="select h-[38px] !w-[190px]"
            value={staffId}
            onChange={event => setStaffId(event.target.value)}
            aria-label="Filter by team member"
          >
            <option value="">Everyone</option>
            {(people.data ?? []).map(person => (
              <option key={person.staffId} value={person.staffId}>
                {person.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-[#63757d]">
            <input
              type="checkbox"
              className="accent-[#147f79]"
              checked={cancelled}
              onChange={event => setCancelled(event.target.checked)}
            />
            Show cancelled shifts
          </label>
          <Btn
            onClick={() => void approveAll()}
            loading={approveClean.isPending}
            disabled={!clean}
            title="Approves the signed-off timesheets whose times match the roster within the tolerance set in Pay rules"
          >
            <CheckCheck size={14} />
            Approve {clean || ""} that match the roster
          </Btn>
        </div>
      </div>

      {list.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="Waiting for approval"
            value={list.data.totals.awaiting}
            tone={list.data.totals.awaiting ? "warn" : undefined}
          />
          <Kpi
            label="No sign-on"
            value={list.data.totals.missing}
            tone={list.data.totals.missing ? "warn" : undefined}
          />
          <Kpi label="Approved" value={list.data.totals.approved} />
          <Kpi
            label="Approved hours"
            value={`${hoursText(list.data.totals.approvedHours)} of ${hoursText(list.data.totals.rosteredHours)}`}
          />
        </div>
      )}

      {list.isError && (
        <ErrorBlock error={list.error} onRetry={() => list.refetch()} />
      )}
      <Panel>
        {list.isPending ? (
          <LoadingBlock />
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Worker</th>
                  <th>Shift</th>
                  <th>Rostered</th>
                  <th>Recorded</th>
                  <th>To pay</th>
                  <th>Difference</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">
                      {prettyDate(row.date)}
                    </td>
                    <td className="font-semibold text-[#40535e]">
                      {row.staffName}
                    </td>
                    <td>
                      <span className="block text-xs">{row.clients}</span>
                      <span className="block text-[10px] text-[#849198]">
                        {row.serviceName}
                        {row.payAs === "Sleepover" && " · sleepover"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {span(row.rostered)}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {row.actual
                        ? `${row.actual.start}–${row.actual.end ?? "…"}`
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap text-xs font-semibold text-[#3d525c]">
                      {row.status === "Upcoming" || row.status === "Cancelled"
                        ? "—"
                        : minutesText(row.paid.minutes)}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {variance(row)}
                    </td>
                    <td>
                      <Status value={row.status} />
                    </td>
                    <td>
                      <Btn
                        variant="secondary"
                        className="!h-8 !px-2 text-[11px]"
                        onClick={() =>
                          setOpen({ shiftId: row.shiftId, staffId: row.staffId })
                        }
                      >
                        {row.status === "Awaiting approval" ||
                        row.status === "No sign-on"
                          ? "Review"
                          : "Open"}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Clock size={19} />}
            title="No shifts in this pay period"
            text="Timesheets come from the roster: each worker on each shift appears here."
          />
        )}
      </Panel>

      {open && <TimesheetDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
