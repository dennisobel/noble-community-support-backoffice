import {
  AlertTriangle,
  CalendarDays,
  Check,
  CircleDollarSign,
  History,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ParticipantDTO } from "@shared/dto";
import { addDays } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import { errorMessage } from "@/api/client";
import {
  useAdjustBudget,
  useBudget,
  useBudgetAdjustments,
  useMeta,
  useSetupBudget,
  useUpdatePlanWindow,
  useWorkspace,
} from "@/api/hooks";
import {
  Btn,
  ErrorBlock,
  FormAlert,
  InfoNote,
  LoadingBlock,
  Panel,
} from "@/components/app/ui";
import { formatDateTime, money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

function SetupForm({
  participant,
  mode,
  onDone,
}: {
  participant: ParticipantDTO;
  mode: "setup" | "renew";
  onDone: () => void;
}) {
  const notify = useNotify();
  const meta = useMeta();
  const workspace = useWorkspace();
  const setup = useSetupBudget();
  const today = meta.data?.today ?? new Date().toISOString().slice(0, 10);
  const categories = workspace.data?.budgetCategories ?? [];
  const defaultStart =
    mode === "renew" && participant.planEnd
      ? addDays(participant.planEnd, 1)
      : (participant.planStart ?? today);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(
    mode === "setup" && participant.planEnd
      ? participant.planEnd
      : addDays(addDays(defaultStart, 365), -1)
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!start || !end || end < start) return setError(MESSAGES.budgetDates);
    if (!confirmed) return setError(MESSAGES.budgetConfirm);
    const rows = categories.map(name => ({
      name,
      allocation: Number(amounts[name] || 0),
    }));
    if (
      rows.some(
        row => !Number.isFinite(row.allocation) || row.allocation < 0
      ) ||
      rows.every(row => row.allocation === 0)
    )
      return setError(MESSAGES.budgetPositive);
    try {
      await setup.mutateAsync({
        clientId: participant.id,
        renew: mode === "renew",
        planStart: start,
        planEnd: end,
        categories: rows,
        confirmedAgainstPlan: true,
      });
      notify(
        mode === "renew"
          ? `${participant.preferred}’s new plan budget is active.`
          : `Plan budget added to ${participant.preferred}’s client profile.`
      );
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Panel
      title={
        mode === "renew"
          ? `Renew ${participant.preferred}’s plan`
          : `Set up ${participant.preferred}’s plan budget`
      }
    >
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="label">
            Plan start
            <input
              className="input mt-1"
              type="date"
              value={start}
              onChange={event => setStart(event.target.value)}
            />
          </label>
          <label className="label">
            Plan end
            <input
              className="input mt-1"
              type="date"
              value={end}
              onChange={event => setEnd(event.target.value)}
            />
          </label>
        </div>
        <div>
          <h4 className="label mb-2">Plan funding by support category (AUD)</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {categories.map(category => (
              <label key={category} className="label">
                {category}
                <input
                  className="input mt-1"
                  type="number"
                  min="0"
                  step="100"
                  value={amounts[category] ?? ""}
                  onChange={event =>
                    setAmounts(values => ({
                      ...values,
                      [category]: event.target.value,
                    }))
                  }
                  placeholder="0.00"
                />
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-start gap-2 rounded-md border border-[#e5ece9] bg-[#f8faf9] p-3 text-[11px] text-[#556b72]">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={event => setConfirmed(event.target.checked)}
            className="mt-0.5 accent-[#147f79]"
          />
          <span>
            I checked these dates and funding amounts against the approved plan
            document.
          </span>
        </label>
        <FormAlert message={error} />
        <div className="flex flex-wrap gap-2">
          <Btn onClick={save} loading={setup.isPending}>
            <Check size={14} />
            {mode === "renew" ? "Start the new plan" : "Save client budget"}
          </Btn>
          <Btn variant="secondary" onClick={onDone}>
            Cancel
          </Btn>
        </div>
        {mode === "renew" && (
          <p className="text-[10px] text-[#87949a]">
            The current plan is kept as history; spend from now on counts
            against the new plan window.
          </p>
        )}
      </div>
    </Panel>
  );
}

export default function BudgetManager({
  participant,
}: {
  participant: ParticipantDTO;
}) {
  const notify = useNotify();
  const budget = useBudget(participant.id);
  const history = useBudgetAdjustments(participant.id);
  const adjust = useAdjustBudget();
  const plan = useUpdatePlanWindow();
  const [setupMode, setSetupMode] = useState<"setup" | "renew" | null>(null);
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState("");
  const [allocation, setAllocation] = useState("");
  const [reason, setReason] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [planEditing, setPlanEditing] = useState(false);
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setSetupMode(null);
    setEditing(false);
    setPlanEditing(false);
  }, [participant.id]);

  if (budget.isPending) return <LoadingBlock label="Loading plan budget…" />;
  if (budget.isError)
    return <ErrorBlock error={budget.error} onRetry={() => budget.refetch()} />;
  const data = budget.data;

  if (!data.budget || !data.metrics) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-[#e7ecea] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#fff4de] text-[#a6782d]">
                <AlertTriangle size={17} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#344854]">
                  No plan budget on file
                </h3>
                <p className="mt-1 max-w-xl text-xs leading-5 text-[#76858b]">
                  Create the funding summary from {participant.preferred}’s
                  approved plan. The budget is stored against this client only.
                </p>
              </div>
            </div>
            <Btn onClick={() => setSetupMode(setupMode ? null : "setup")}>
              <Plus size={14} />
              {setupMode ? "Close setup" : "Set up plan budget"}
            </Btn>
          </div>
        </div>
        {setupMode && (
          <SetupForm
            participant={participant}
            mode="setup"
            onDone={() => setSetupMode(null)}
          />
        )}
        <InfoNote>
          Budgets, records and documents stay attached to{" "}
          {participant.preferred}.
        </InfoNote>
      </div>
    );
  }

  const { budget: current, metrics } = data;
  const statusClass =
    metrics.status === "Plan expired" || metrics.status === "Over allocation"
      ? "badge-danger"
      : metrics.status === "Low balance"
        ? "badge-returned"
        : "badge-approved";
  const summary = [
    {
      label: "Plan allocation",
      value: metrics.allocation,
      icon: WalletCards,
      color: "#3f8278",
      bg: "#edf4f2",
    },
    {
      label: "Approved / invoiced",
      value: metrics.used,
      icon: Check,
      color: "#397a5d",
      bg: "#e8f5ee",
    },
    {
      label: "Awaiting review",
      value: metrics.pending,
      icon: SlidersHorizontal,
      color: "#4b7b9c",
      bg: "#edf4fa",
    },
    {
      label: "Scheduled",
      value: metrics.committed,
      icon: CalendarDays,
      color: "#a6782d",
      bg: "#fff4de",
    },
    {
      label: "Available",
      value: metrics.remaining,
      icon: CircleDollarSign,
      color: metrics.remaining < 0 ? "#a64d47" : "#6c5d9b",
      bg: metrics.remaining < 0 ? "#fbeceb" : "#f0edfa",
    },
  ];

  const beginAdjust = () => {
    const first = current.categories[0];
    setCategory(first?.name ?? "");
    setAllocation(String(first?.allocation ?? ""));
    setReason("");
    setAdjustError("");
    setEditing(true);
  };
  const saveAdjust = async () => {
    setAdjustError("");
    const amount = Number(allocation);
    if (!allocation.trim() || !Number.isFinite(amount) || amount < 0)
      return setAdjustError(MESSAGES.budgetAmount);
    if (!reason.trim()) return setAdjustError(MESSAGES.budgetReason);
    try {
      await adjust.mutateAsync({
        clientId: participant.id,
        category,
        allocation: amount,
        reason,
        rev: current.rev,
      });
      notify(`Updated ${category} allocation for ${participant.preferred}.`);
      setEditing(false);
    } catch (failure) {
      setAdjustError(errorMessage(failure));
    }
  };
  const savePlan = async () => {
    if (!planStart || !planEnd || planEnd < planStart)
      return notify(MESSAGES.budgetDates, "error");
    try {
      await plan.mutateAsync({
        clientId: participant.id,
        planStart,
        planEnd,
        rev: current.rev,
      });
      notify("Plan period updated.");
      setPlanEditing(false);
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="panel-title">{participant.preferred}’s plan budget</h3>
          <p className="mt-1 text-[11px] text-[#819097]">
            Client record · {participant.name} · NDIS {participant.ndis} · as of{" "}
            {prettyDate(metrics.asOf)}
          </p>
        </div>
        <span className={`badge ${statusClass}`}>{metrics.status}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {summary.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="panel p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#7c8990]">{label}</span>
              <span
                className="grid h-8 w-8 place-items-center rounded-md"
                style={{ background: bg, color }}
              >
                <Icon size={15} />
              </span>
            </div>
            <div
              className={`mt-2 text-lg font-semibold tracking-tight ${label === "Available" && value < 0 ? "text-[#a84540]" : "text-[#263d48]"}`}
            >
              {money(value)}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Panel
          title={`Adjust ${participant.preferred}’s plan allocation`}
          className="border-[#cfe1dc]"
          action={
            <button
              className="icon-btn"
              aria-label="Close allocation adjustment"
              onClick={() => setEditing(false)}
            >
              <X size={16} />
            </button>
          }
        >
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            <label className="label">
              Support category
              <select
                className="select mt-1"
                value={category}
                onChange={event => {
                  setCategory(event.target.value);
                  setAllocation(
                    String(
                      current.categories.find(
                        item => item.name === event.target.value
                      )?.allocation ?? ""
                    )
                  );
                }}
              >
                {current.categories.map(item => (
                  <option key={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="label">
              New allocation (AUD)
              <input
                className="input mt-1"
                type="number"
                min="0"
                step="100"
                value={allocation}
                onChange={event => setAllocation(event.target.value)}
              />
            </label>
            <label className="label sm:col-span-2">
              Reason for change
              <textarea
                className="textarea mt-1 !min-h-[70px]"
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder="e.g. Updated plan allocation confirmed on 28 Sep"
              />
            </label>
            <div className="sm:col-span-2">
              <FormAlert message={adjustError} />
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Btn onClick={saveAdjust} loading={adjust.isPending}>
                <Check size={14} />
                Save {participant.preferred}’s allocation
              </Btn>
              <Btn variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      {setupMode === "renew" && (
        <SetupForm
          participant={participant}
          mode="renew"
          onDone={() => setSetupMode(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_.8fr]">
        <Panel
          title="Funding by support category"
          action={
            <Btn
              variant="secondary"
              className="!h-8 !px-2.5 text-[10px]"
              onClick={beginAdjust}
            >
              <SlidersHorizontal size={13} />
              Adjust allocations
            </Btn>
          }
        >
          <div className="divide-y divide-[#edf0ef]">
            {metrics.categories.map(row => {
              const committedUse = row.used + row.pending + row.committed;
              const utilization =
                row.allocation > 0
                  ? Math.min(
                      100,
                      Math.max(0, (committedUse / row.allocation) * 100)
                    )
                  : committedUse > 0
                    ? 100
                    : 0;
              const barColor =
                row.remaining < 0
                  ? "#c36c62"
                  : row.remaining < row.allocation * 0.15
                    ? "#d09b45"
                    : "#58a197";
              return (
                <div key={row.name} className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-xs font-semibold text-[#354b57]">
                      {row.name}
                      {row.allocation === 0 && committedUse > 0 && (
                        <span className="ml-2 text-[10px] font-normal text-[#a84540]">
                          not funded in this plan
                        </span>
                      )}
                    </h4>
                    <span
                      className={`text-xs font-semibold ${row.remaining < 0 ? "text-[#a84540]" : "text-[#2d746b]"}`}
                    >
                      {money(row.remaining)} available
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#eaf0ee]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${utilization}%`, background: barColor }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] sm:grid-cols-4">
                    {[
                      ["Allocated", row.allocation],
                      ["Used", row.used],
                      ["Under review", row.pending],
                      ["Scheduled", row.committed],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <span className="block text-[#849198]">{label}</span>
                        <b className="mt-0.5 block text-[#50636b]">
                          {money(value as number)}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Plan details">
          <div className="space-y-4 p-5">
            <div>
              <div className="label">Plan period</div>
              {planEditing ? (
                <div className="mt-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input"
                      type="date"
                      value={planStart}
                      onChange={event => setPlanStart(event.target.value)}
                      aria-label="Plan start"
                    />
                    <input
                      className="input"
                      type="date"
                      value={planEnd}
                      onChange={event => setPlanEnd(event.target.value)}
                      aria-label="Plan end"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Btn
                      className="!h-8"
                      onClick={savePlan}
                      loading={plan.isPending}
                    >
                      Save
                    </Btn>
                    <Btn
                      className="!h-8"
                      variant="secondary"
                      onClick={() => setPlanEditing(false)}
                    >
                      Cancel
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-between gap-2 text-xs font-medium text-[#465b65]">
                  <span>
                    {prettyDate(current.planStart)} –{" "}
                    {prettyDate(current.planEnd)}
                  </span>
                  <button
                    className="text-[10px] font-semibold text-[#277c76]"
                    onClick={() => {
                      setPlanStart(current.planStart);
                      setPlanEnd(current.planEnd);
                      setPlanEditing(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
            <div>
              <div className="label">Plan manager</div>
              <div className="mt-1 text-xs text-[#5c6e76]">
                {participant.manager || "Not recorded"}
              </div>
            </div>
            <div>
              <div className="label">Budget confirmed against plan</div>
              <div className="mt-1 text-xs text-[#5c6e76]">
                {formatDateTime(current.confirmedAgainstPlanAt)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn
                variant="secondary"
                className="!h-8 text-[11px]"
                onClick={() => setShowHistory(value => !value)}
              >
                <History size={13} />
                Change history
              </Btn>
              <Btn
                variant="secondary"
                className="!h-8 text-[11px]"
                onClick={() => setSetupMode("renew")}
              >
                <RefreshCw size={13} />
                Renew plan
              </Btn>
            </div>
            <div className="rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[10px] leading-4 text-[#496663]">
              Used comes from approved and invoiced records in this plan period.
              Records under review and upcoming shifts are shown separately as
              estimates.
            </div>
          </div>
        </Panel>
      </div>

      {showHistory && (
        <Panel title="Allocation change history">
          <div className="divide-y divide-[#edf0ef]">
            {history.data?.map(entry => (
              <div
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-xs"
              >
                <div>
                  <b className="text-[#40535e]">{entry.category}</b>:{" "}
                  {money(entry.oldAllocation)} → {money(entry.newAllocation)}
                  <p className="mt-1 text-[11px] text-[#687982]">
                    {entry.reason}
                  </p>
                </div>
                <span className="text-[10px] text-[#87949a]">
                  {entry.by?.name ?? "Unknown"} · {formatDateTime(entry.at)}
                </span>
              </div>
            ))}
            {history.data && !history.data.length && (
              <p className="px-5 py-4 text-xs text-[#87949a]">
                No allocation changes yet.
              </p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
