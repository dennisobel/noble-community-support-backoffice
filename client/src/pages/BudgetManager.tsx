import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Check, CircleDollarSign, Info, Plus, SlidersHorizontal, WalletCards } from "lucide-react";
import type { ClientBudget, Participant, RosterShift, ServiceRecord } from "@/lib/mock-data";
import { computeBudgetMetrics, type RateTable } from "@/lib/budget-math";

const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const dateLabel = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";

function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <div className="flex items-center justify-between gap-3 border-b border-[#e9eeec] px-5 py-4"><h2 className="panel-title">{title}</h2>{action}</div>}{children}</section>;
}
function Button({ children, onClick, variant = "primary", className = "", disabled = false }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet"; className?: string; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`}>{children}</button>;
}

export default function BudgetManager({ participant, budget, shifts, records, rates, today, onBudgetChange, notify }: {
  participant: Participant;
  budget?: ClientBudget;
  shifts: RosterShift[];
  records: ServiceRecord[];
  rates: RateTable;
  today: string;
  onBudgetChange: (budget: ClientBudget) => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editCategory, setEditCategory] = useState("");
  const [allocationInput, setAllocationInput] = useState("");
  const [reason, setReason] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStart, setSetupStart] = useState(participant.planStart ?? today);
  const [setupEnd, setSetupEnd] = useState(participant.planEnd ?? "");
  const [setupAmounts, setSetupAmounts] = useState(["", "", ""]);
  const [setupConfirmed, setSetupConfirmed] = useState(false);
  const setupCategories = ["Community participation", "Daily living skills", "Support coordination"];
  const metrics = useMemo(() => budget ? computeBudgetMetrics(participant.id, budget, records, shifts, rates, today) : null, [participant.id, budget, records, shifts, rates, today]);
  useEffect(() => {
    const start = participant.planStart ?? today;
    const endDate = new Date(`${start}T12:00:00`); endDate.setFullYear(endDate.getFullYear() + 1);
    setSetupStart(start); setSetupEnd(participant.planEnd ?? `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,"0")}-${String(endDate.getDate()).padStart(2,"0")}`);
    setSetupAmounts(["", "", ""]); setSetupConfirmed(false); setSetupOpen(false);
  }, [participant.id, participant.planStart, participant.planEnd, today]);

  const beginEdit = () => {
    if (!budget) return;
    const category = budget.categories[0];
    setEditCategory(category?.name ?? "");
    setAllocationInput(String(category?.allocation ?? ""));
    setReason("");
    setEditing(true);
  };
  const changeCategory = (name: string) => {
    setEditCategory(name);
    setAllocationInput(String(budget?.categories.find(category => category.name === name)?.allocation ?? ""));
  };
  const saveAdjustment = () => {
    if (!budget) return;
    const amount = Number(allocationInput);
    if (!Number.isFinite(amount) || amount < 0) { notify("Enter a valid non-negative allocation amount."); return; }
    if (!reason.trim()) { notify("Add a reason for this allocation change."); return; }
    onBudgetChange({ ...budget, categories: budget.categories.map(category => category.name === editCategory ? { ...category, allocation: amount } : category) });
    notify(`Updated ${editCategory} allocation for ${participant.preferred}.`);
    setEditing(false);
  };

  const saveInitialBudget = () => {
    if (!setupStart || !setupEnd || setupEnd < setupStart) { notify("Choose a valid plan start and end date."); return; }
    if (!setupConfirmed) { notify("Confirm the amounts against the approved client plan before saving."); return; }
    const amounts = setupAmounts.map(value => Number(value));
    if (amounts.some(value => !Number.isFinite(value) || value < 0) || amounts.every(value => value === 0)) { notify("Enter at least one positive category allocation."); return; }
    onBudgetChange({ clientId: participant.id, planStart: setupStart, planEnd: setupEnd, categories: setupCategories.map((name, index) => ({ name, allocation: amounts[index] })) });
    notify(`Plan budget added to ${participant.preferred}’s client profile.`); setSetupOpen(false);
  };

  if (!budget || !metrics) return <div className="space-y-4">
    <div className="rounded-md border border-[#e7ecea] bg-white p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#fff4de] text-[#a6782d]"><AlertTriangle size={17}/></span><div><h3 className="text-sm font-semibold text-[#344854]">No plan budget on file</h3><p className="mt-1 max-w-xl text-xs leading-5 text-[#76858b]">Create the funding summary from {participant.preferred}’s approved plan here in their client profile. The budget is stored against this client only.</p></div></div><Button onClick={() => setSetupOpen(value => !value)}><Plus size={14}/>{setupOpen ? "Close setup" : "Set up plan budget"}</Button></div></div>
    {setupOpen&&<Panel title={`Set up ${participant.preferred}’s plan budget`}><div className="space-y-5 p-5"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="label">Plan start<input className="input mt-1" type="date" value={setupStart} onChange={event => setSetupStart(event.target.value)}/></label><label className="label">Plan end<input className="input mt-1" type="date" value={setupEnd} onChange={event => setSetupEnd(event.target.value)}/></label></div><div><h4 className="label mb-2">Plan funding by support category (AUD)</h4><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{setupCategories.map((category, index) => <label key={category} className="label">{category}<input className="input mt-1" type="number" min="0" step="100" value={setupAmounts[index]} onChange={event => setSetupAmounts(values => values.map((value, position) => position === index ? event.target.value : value))} placeholder="0.00"/></label>)}</div></div><label className="flex items-start gap-2 rounded-md border border-[#e5ece9] bg-[#f8faf9] p-3 text-[11px] text-[#556b72]"><input type="checkbox" checked={setupConfirmed} onChange={event => setSetupConfirmed(event.target.checked)} className="mt-0.5 accent-[#147f79]"/><span>I checked these dates and funding amounts against the approved plan document.</span></label><div className="flex flex-wrap gap-2"><Button onClick={saveInitialBudget}><Check size={14}/>Save client budget</Button><Button variant="secondary" onClick={() => setSetupOpen(false)}>Cancel</Button></div></div></Panel>}
    <div className="rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[10px] leading-4 text-[#496663]"><Info size={13} className="mr-1.5 inline"/>This manager is available only from the selected client profile. Budgets, records and documents stay attached to {participant.preferred}.</div>
  </div>;

  const status = budget.planEnd < today ? "Plan expired" : metrics.remaining < 0 ? "Over allocation" : metrics.remaining < metrics.allocation * .15 ? "Low balance" : "Within plan";
  const statusClass = budget.planEnd < today || metrics.remaining < 0 ? "badge-danger" : metrics.remaining < metrics.allocation * .15 ? "badge-returned" : "badge-approved";
  const summary = [
    { label: "Plan allocation", value: metrics.allocation, icon: WalletCards, color: "#3f8278", bg: "#edf4f2" },
    { label: "Approved / invoiced", value: metrics.used, icon: Check, color: "#397a5d", bg: "#e8f5ee" },
    { label: "Awaiting review", value: metrics.pending, icon: SlidersHorizontal, color: "#4b7b9c", bg: "#edf4fa" },
    { label: "Scheduled", value: metrics.committed, icon: CalendarDays, color: "#a6782d", bg: "#fff4de" },
    { label: "Available", value: metrics.remaining, icon: CircleDollarSign, color: metrics.remaining < 0 ? "#a64d47" : "#6c5d9b", bg: metrics.remaining < 0 ? "#fbeceb" : "#f0edfa" },
  ];

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="panel-title">{participant.preferred}’s plan budget</h3><p className="mt-1 text-[11px] text-[#819097]">Client record · {participant.name} · NDIS {participant.ndis}</p></div><span className={`badge ${statusClass}`}>{status}</span></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{summary.map(({ label, value, icon: Icon, color, bg }) => <div key={label} className="panel p-4"><div className="flex items-center justify-between gap-2"><span className="text-[10px] text-[#7c8990]">{label}</span><span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: bg, color }}><Icon size={15}/></span></div><div className={`mt-2 text-lg font-semibold tracking-tight ${label === "Available" && value < 0 ? "text-[#a84540]" : "text-[#263d48]"}`}>{money(value)}</div></div>)}</div>

    {editing && <Panel title={`Adjust ${participant.preferred}’s plan allocation`} className="border-[#cfe1dc]" action={<button className="icon-btn" aria-label="Close allocation adjustment" onClick={() => setEditing(false)}>×</button>}><div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2"><label className="label">Support category<select className="select mt-1" value={editCategory} onChange={event => changeCategory(event.target.value)}>{budget.categories.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}</select></label><label className="label">New allocation (AUD)<input className="input mt-1" type="number" min="0" step="100" value={allocationInput} onChange={event => setAllocationInput(event.target.value)}/></label><label className="label sm:col-span-2">Reason for change<textarea className="textarea mt-1 !min-h-[70px]" value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Updated plan allocation confirmed on 28 Sep"/></label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={saveAdjustment}><Check size={14}/>Save {participant.preferred}’s allocation</Button><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div></div></Panel>}

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_.8fr]">
      <Panel title="Funding by support category" action={<Button variant="secondary" className="!h-8 !px-2.5 text-[10px]" onClick={beginEdit}><SlidersHorizontal size={13}/>Adjust allocations</Button>}>
        <div className="divide-y divide-[#edf0ef]">{metrics.categories.map(category => {
          const committedUse = category.used + category.pending + category.committed;
          const utilization = category.allocation > 0 ? Math.min(100, Math.max(0, committedUse / category.allocation * 100)) : 0;
          const barColor = category.remaining < 0 ? "#c36c62" : category.remaining < category.allocation * .15 ? "#d09b45" : "#58a197";
          return <div key={category.name} className="space-y-3 p-4 sm:p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-xs font-semibold text-[#354b57]">{category.name}</h4><span className={`text-xs font-semibold ${category.remaining < 0 ? "text-[#a84540]" : "text-[#2d746b]"}`}>{money(category.remaining)} available</span></div><div className="h-2 overflow-hidden rounded-full bg-[#eaf0ee]"><div className="h-full rounded-full transition-all" style={{ width: `${utilization}%`, background: barColor }}/></div><div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] sm:grid-cols-4"><div><span className="block text-[#849198]">Allocated</span><b className="mt-0.5 block text-[#50636b]">{money(category.allocation)}</b></div><div><span className="block text-[#849198]">Used</span><b className="mt-0.5 block text-[#50636b]">{money(category.used)}</b></div><div><span className="block text-[#849198]">Under review</span><b className="mt-0.5 block text-[#50636b]">{money(category.pending)}</b></div><div><span className="block text-[#849198]">Scheduled</span><b className="mt-0.5 block text-[#50636b]">{money(category.committed)}</b></div></div></div>;
        })}</div>
      </Panel>
      <Panel title="Plan details"><div className="space-y-4 p-5"><div><div className="label">Plan period</div><div className="mt-1 text-xs font-medium text-[#465b65]">{dateLabel(budget.planStart)} – {dateLabel(budget.planEnd)}</div></div><div><div className="label">Plan manager</div><div className="mt-1 text-xs text-[#5c6e76]">{participant.manager}</div></div><div><div className="label">Participant</div><div className="mt-1 text-xs text-[#5c6e76]">{participant.name} · {participant.preferred}</div></div><div className="rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[10px] leading-4 text-[#496663]">Used values come from this client’s approved and invoiced records. Pending notes and assigned shifts are shown separately as estimates.</div></div></Panel>
    </div>
    <div className="flex items-start gap-2 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]"><Info size={14} className="mt-0.5 shrink-0"/>This budget is tied to {participant.preferred}’s client record. Figures are fictional prototype estimates; reconcile them to the approved plan before operational use.</div>
  </div>;
}
