import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Lock,
  LockOpen,
  Plus,
  Trash2,
  TriangleAlert,
  WalletCards,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import type { PayRunDTO, PayRunItemDTO } from "@shared/dto";
import { downloadFile, errorMessage } from "@/api/client";
import {
  useAddPayAdjustment,
  useCreatePayRun,
  useDeletePayRun,
  usePayRun,
  usePayRunAction,
  usePayRuns,
  useRemovePayAdjustment,
  useTimesheets,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  FormAlert,
  InfoNote,
  LoadingBlock,
  Panel,
  Status,
} from "@/components/app/ui";
import { formatDateTime, money } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { hoursText, Kpi, PayLines, PeriodNav } from "./pay-ui";

/** One person in a pay run: their totals, and on opening, every line and adjustment behind them. */
function RunItem({ run, item }: { run: PayRunDTO; item: PayRunItemDTO }) {
  const [open, setOpen] = useState(false);
  const add = useAddPayAdjustment();
  const remove = useRemovePayAdjustment();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const draft = run.status === "Draft";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await add.mutateAsync({
        id: run.id,
        staffId: item.staffId,
        label: label.trim(),
        amount: Number(amount),
      });
      setLabel("");
      setAmount("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <>
      <tr
        className="cursor-pointer"
        onClick={() => setOpen(current => !current)}
      >
        <td>
          <span className="flex items-center gap-2 font-semibold text-[#40535e]">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {item.staffName}
            {item.flags.length > 0 && (
              <TriangleAlert size={13} className="text-[#c98a2c]" />
            )}
          </span>
          <span className="ml-[22px] block text-[10px] text-[#849198]">
            {[item.employmentType, item.classificationName, item.payrollId]
              .filter(Boolean)
              .join(" · ") || "No employment details"}
          </span>
        </td>
        <td className="text-right text-xs">{money(item.baseRate)}</td>
        <td className="text-right text-xs">{hoursText(item.ordinaryHours)}</td>
        <td className="text-right text-xs">
          {item.overtimeHours ? hoursText(item.overtimeHours) : "—"}
        </td>
        <td className="text-right text-xs">
          {item.allowances ? money(item.allowances) : "—"}
        </td>
        <td className="text-right text-xs">
          {item.adjustmentsTotal ? money(item.adjustmentsTotal) : "—"}
        </td>
        <td className="text-right font-semibold text-[#223644]">
          {money(item.gross)}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="!bg-[#fafcfb] !p-4">
            {item.flags.map(flag => (
              <div
                key={flag}
                className="mb-2 flex items-start gap-2 rounded-md bg-[#fff8e8] px-3 py-2 text-xs text-[#8a6224]"
              >
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                {flag}
              </div>
            ))}
            <div className="panel">
              <PayLines lines={item.lines} showDate />
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[.06em] text-[#849198]">
                Adjustments
              </div>
              {item.adjustments.length === 0 && !draft && (
                <p className="text-xs text-[#7b8990]">None.</p>
              )}
              {item.adjustments.map(row => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 border-b border-[#edf0ef] py-1.5 text-xs text-[#52666f] last:border-0"
                >
                  <span>
                    {row.label}
                    <span className="ml-2 text-[10px] text-[#9aa5a8]">
                      {row.by?.name} · {formatDateTime(row.at)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 font-semibold">
                    {money(row.amount)}
                    {draft && (
                      <button
                        type="button"
                        className="icon-btn !h-7 !w-7"
                        aria-label={`Remove ${row.label}`}
                        onClick={() =>
                          remove.mutate({ id: run.id, adjustmentId: row.id })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {draft && (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={submit}
                >
                  <label className="label !mb-0 flex-1">
                    Add an allowance or correction
                    <input
                      required
                      className="input mt-1"
                      value={label}
                      onChange={event => setLabel(event.target.value)}
                      placeholder="e.g. First aid allowance, on-call, back pay"
                    />
                  </label>
                  <label className="label !mb-0">
                    Amount ($)
                    <input
                      required
                      type="number"
                      step="0.01"
                      className="input mt-1 !w-[120px] block"
                      value={amount}
                      onChange={event => setAmount(event.target.value)}
                      placeholder="−10 to deduct"
                    />
                  </label>
                  <Btn type="submit" variant="secondary" loading={add.isPending}>
                    <Plus size={14} />
                    Add
                  </Btn>
                </form>
              )}
              <FormAlert message={error} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function RunDetail({ id }: { id: string }) {
  const run = usePayRun(id);
  const action = usePayRunAction();
  const remove = useDeletePayRun();
  const notify = useNotify();
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState<"finalise" | "reopen" | "delete" | null>(
    null
  );
  const [error, setError] = useState("");

  if (run.isError)
    return <ErrorBlock error={run.error} onRetry={() => run.refetch()} />;
  if (!run.data) return <LoadingBlock />;
  const data = run.data;
  const draft = data.status === "Draft";

  const act = async () => {
    setError("");
    try {
      if (confirm === "delete") {
        await remove.mutateAsync(data.id);
        notify("Draft pay run deleted.");
        navigate("/app/payroll/runs");
      } else if (confirm) {
        await action.mutateAsync({ id: data.id, action: confirm, rev: data.rev });
        notify(
          confirm === "finalise"
            ? `${data.id} finalised. Its timesheets are now locked.`
            : `${data.id} reopened.`
        );
      }
      setConfirm(null);
    } catch (failure) {
      setError(errorMessage(failure));
      setConfirm(null);
    }
  };
  const exportCsv = async (detail: "summary" | "lines") => {
    try {
      await downloadFile(
        `/payroll/pay-runs/${data.id}/export`,
        `${data.id}-${detail}.csv`,
        { detail }
      );
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/payroll/runs"
          className="flex items-center gap-1.5 text-xs font-semibold text-[#12766f]"
        >
          <ArrowLeft size={14} />
          All pay runs
        </Link>
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" onClick={() => void exportCsv("summary")}>
            <Download size={14} />
            Summary CSV
          </Btn>
          <Btn variant="secondary" onClick={() => void exportCsv("lines")}>
            <Download size={14} />
            Every line CSV
          </Btn>
          {draft ? (
            <>
              <Btn variant="danger" onClick={() => setConfirm("delete")}>
                <Trash2 size={14} />
                Delete draft
              </Btn>
              <Btn onClick={() => setConfirm("finalise")}>
                <Lock size={14} />
                Finalise
              </Btn>
            </>
          ) : (
            <Btn variant="secondary" onClick={() => setConfirm("reopen")}>
              <LockOpen size={14} />
              Reopen
            </Btn>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="panel px-4 py-3">
          <div className="text-[10px] uppercase tracking-[.07em] text-[#849198]">
            {data.id}
          </div>
          <div className="mt-1 text-sm font-semibold text-[#223644]">
            {data.label}
          </div>
          <div className="mt-1.5">
            <Status value={data.status} />
          </div>
        </div>
        <Kpi label="People" value={data.staffCount} />
        <Kpi label="Paid hours" value={hoursText(data.hours)} />
        <Kpi label="Gross pay" value={money(data.gross)} />
      </div>

      {data.warnings.map(warning => (
        <div
          key={warning}
          className="mb-2 flex items-start gap-2 rounded-md border border-[#f3e2bd] bg-[#fff8e8] px-3 py-2.5 text-xs text-[#8a6224]"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {warning}
        </div>
      ))}
      <FormAlert message={error} />

      <Panel className="mt-3">
        {data.items.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="text-right">Ordinary rate</th>
                  <th className="text-right">Ordinary</th>
                  <th className="text-right">Overtime</th>
                  <th className="text-right">Allowances</th>
                  <th className="text-right">Adjustments</th>
                  <th className="text-right">Gross pay</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(item => (
                  <RunItem key={item.staffId} run={data} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nothing in this run yet"
            text="Approve timesheets for the period and they appear here."
          />
        )}
      </Panel>
      <InfoNote className="mt-4">
        This is gross pay: hours and allowances under the award, before tax and
        super. {draft
          ? "A draft is worked out again each time it is opened, so it always matches the approved timesheets."
          : `Finalised ${formatDateTime(data.finalisedAt)}${data.finalisedBy ? ` by ${data.finalisedBy.name}` : ""}. The figures are kept as they were.`}
      </InfoNote>

      {confirm && (
        <ConfirmModal
          title={
            confirm === "finalise"
              ? `Finalise ${data.id}?`
              : confirm === "reopen"
                ? `Reopen ${data.id}?`
                : `Delete ${data.id}?`
          }
          body={
            confirm === "finalise"
              ? `This keeps the figures as they are now (${money(data.gross)} for ${data.staffCount} ${data.staffCount === 1 ? "person" : "people"}) and locks the timesheets and leave it pays, so they cannot be paid again.`
              : confirm === "reopen"
                ? "The timesheets and leave in this run are unlocked and the figures are worked out again. Only do this if the run has not been paid."
                : "The draft is removed. The approved timesheets stay approved and can go into a new run."
          }
          confirmLabel={
            confirm === "finalise"
              ? "Finalise"
              : confirm === "reopen"
                ? "Reopen"
                : "Delete draft"
          }
          danger={confirm === "delete"}
          busy={action.isPending || remove.isPending}
          onConfirm={() => void act()}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/** Start a run for a pay period, and the runs already made. */
function RunList() {
  const runs = usePayRuns();
  const create = useCreatePayRun();
  const notify = useNotify();
  const [, navigate] = useLocation();
  const [date, setDate] = useState<string | undefined>(undefined);
  // The timesheet totals for the chosen period say whether a run is worth starting.
  const period = useTimesheets({ date });

  const start = async () => {
    try {
      const run = await create.mutateAsync({ date: period.data?.period.from });
      navigate(`/app/payroll/runs/${run.id}`);
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  const totals = period.data?.totals;
  return (
    <>
      <Panel title="Start a pay run" className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          {period.data ? (
            <PeriodNav period={period.data.period} onChange={setDate} />
          ) : (
            <LoadingBlock className="!py-2" />
          )}
          <div className="flex flex-wrap items-center gap-4">
            {totals && (
              <p className="text-xs leading-5 text-[#63757d]">
                <b className="text-[#3d525c]">{totals.approved}</b> approved
                {totals.awaiting + totals.missing > 0 && (
                  <span className="text-[#9a6419]">
                    {" "}
                    · {totals.awaiting + totals.missing} still to approve
                  </span>
                )}
              </p>
            )}
            <Btn
              onClick={() => void start()}
              loading={create.isPending}
              disabled={!totals?.approved}
            >
              <Plus size={14} />
              Start pay run
            </Btn>
          </div>
        </div>
      </Panel>

      {runs.isError && (
        <ErrorBlock error={runs.error} onRetry={() => runs.refetch()} />
      )}
      <Panel title="Pay runs">
        {runs.isPending ? (
          <LoadingBlock />
        ) : runs.data?.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Pay period</th>
                  <th>Status</th>
                  <th className="text-right">People</th>
                  <th className="text-right">Paid hours</th>
                  <th className="text-right">Gross pay</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.data.map(run => (
                  <tr key={run.id}>
                    <td className="font-semibold text-[#40535e]">{run.id}</td>
                    <td>{run.label}</td>
                    <td>
                      <Status value={run.status} />
                    </td>
                    <td className="text-right">{run.staffCount}</td>
                    <td className="text-right">{hoursText(run.hours)}</td>
                    <td className="text-right font-semibold">
                      {money(run.gross)}
                    </td>
                    <td>
                      <Link href={`/app/payroll/runs/${run.id}`}>
                        <Btn
                          variant="secondary"
                          className="!h-8 !px-2 text-[11px]"
                        >
                          Open
                        </Btn>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<WalletCards size={19} />}
            title="No pay runs yet"
            text="Approve the timesheets for a pay period, then start a run to work out everyone's gross pay."
          />
        )}
      </Panel>
    </>
  );
}

export default function PayRunsTab({ id }: { id?: string }) {
  return id ? <RunDetail id={id} /> : <RunList />;
}
