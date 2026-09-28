import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleDollarSign, Download, Info, SlidersHorizontal, WalletCards } from "lucide-react";
import type { ClientBudget, Participant, RosterShift, ServiceRecord, Staff } from "@/lib/mock-data";
import { computeBudgetMetrics, type RateTable } from "@/lib/budget-math";

const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <div className="flex items-center justify-between gap-3 border-b border-[#e9eeec] px-5 py-4"><h2 className="panel-title">{title}</h2>{action}</div>}{children}</section>;
}
function Button({ children, onClick, variant = "primary", className = "", disabled = false }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet"; className?: string; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`}>{children}</button>;
}

export default function BudgetManager({ participants, budgets, shifts, records, rates, today, onBudgetChange, notify, initialClient, onOpenProfile }: {
  participants: Participant[];
  budgets: ClientBudget[];
  shifts: RosterShift[];
  records: ServiceRecord[];
  rates: RateTable;
  today: string;
  onBudgetChange: (budget: ClientBudget) => void;
  notify: (message: string) => void;
  initialClient?: string;
  onOpenProfile?: (id: string) => void;
}) {
  const [selectedClient, setSelectedClient] = useState(initialClient ?? "All");
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [allocationInput, setAllocationInput] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => { setSelectedClient(initialClient ?? "All"); }, [initialClient]);

  const metricFor = (clientId: string) => {
    const budget = budgets.find(item => item.clientId === clientId);
    return budget ? computeBudgetMetrics(clientId, budget, records, shifts, rates, today) : null;
  };
  const visibleParticipants = selectedClient === "All" ? participants : participants.filter(person => person.id === selectedClient);
  const visibleMetrics = visibleParticipants.map(person => ({ person, budget: budgets.find(item => item.clientId === person.id), metrics: metricFor(person.id) })).filter(item => item.budget && item.metrics);
  const totals = useMemo(() => visibleMetrics.reduce((total, item) => ({ allocation: total.allocation + (item.metrics?.allocation ?? 0), used: total.used + (item.metrics?.used ?? 0), pending: total.pending + (item.metrics?.pending ?? 0), committed: total.committed + (item.metrics?.committed ?? 0), remaining: total.remaining + (item.metrics?.remaining ?? 0) }), { allocation: 0, used: 0, pending: 0, committed: 0, remaining: 0 }), [visibleMetrics]);
  const editBudget = editClientId ? budgets.find(item => item.clientId === editClientId) : undefined;

  const beginEdit = (budget: ClientBudget) => {
    setEditClientId(budget.clientId);
    setEditCategory(budget.categories[0]?.name ?? "Community participation");
    setAllocationInput(String(budget.categories[0]?.allocation ?? ""));
    setReason("");
  };
  const saveAdjustment = () => {
    if (!editBudget) return;
    const amount = Number(allocationInput);
    if (!Number.isFinite(amount) || amount < 0) { notify("Enter a valid non-negative allocation amount."); return; }
    if (!reason.trim()) { notify("Add a reason for this allocation change."); return; }
    const updated = { ...editBudget, categories: editBudget.categories.map(category => category.name === editCategory ? { ...category, allocation: amount } : category) };
    onBudgetChange(updated);
    notify(`Updated ${editCategory} allocation for ${participants.find(person => person.id === editClientId)?.preferred ?? "participant"}.`);
    setEditClientId(null);
  };

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-title serif">Participant budgets</h1><p className="page-subtitle">Plan allocations, approved usage, pending review and scheduled commitments.</p></div><div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="budget-participant-filter">Filter participant</label><select id="budget-participant-filter" className="select w-[205px]" value={selectedClient} onChange={event => setSelectedClient(event.target.value)}><option value="All">All participants</option>{participants.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select><Button variant="secondary" onClick={() => notify("Budget summary export is simulated for this prototype.")}><Download size={14}/>Export summary</Button></div></div>

    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[["Plan allocation", totals.allocation, WalletCards, "#edf4f2", "#3f8278"], ["Approved / invoiced", totals.used, Check, "#e8f5ee", "#397a5d"], ["Awaiting review", totals.pending, SlidersHorizontal, "#edf4fa", "#4b7b9c"], ["Scheduled", totals.committed, CircleDollarSign, "#fff4de", "#a6782d"], ["Available", totals.remaining, WalletCards, totals.remaining < 0 ? "#fbeceb" : "#f0edfa", totals.remaining < 0 ? "#a64d47" : "#6c5d9b"]].map(([label, amount, Icon, bg, fg]) => {
        const StatIcon = Icon as typeof WalletCards;
        return <div key={String(label)} className="panel p-4"><div className="flex items-center justify-between gap-2"><span className="text-[10px] text-[#7c8990]">{label as string}</span><span className="grid h-8 w-8 place-items-center rounded-md" style={{ background: String(bg), color: String(fg) }}><StatIcon size={15}/></span></div><div className="mt-2 text-xl font-semibold tracking-tight text-[#263d48]">{money(Number(amount))}</div></div>;
      })}
    </div>

    {visibleParticipants.length === 1 && visibleMetrics[0]?.metrics && visibleMetrics[0]?.budget && <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_330px]"><Panel title={`${visibleParticipants[0].preferred} · plan budget`} action={onOpenProfile && <button className="text-[11px] font-semibold text-[#277c76]" onClick={() => onOpenProfile(visibleParticipants[0].id)}>Participant profile <ArrowRight size={12} className="ml-1 inline"/></button>}><div className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-semibold text-[#354b57]">{visibleParticipants[0].name}</div><div className="mt-1 text-[11px] text-[#819097]">Plan period · {dateLabel(visibleMetrics[0].budget.planStart)} – {dateLabel(visibleMetrics[0].budget.planEnd)}</div></div><span className={`badge ${visibleMetrics[0].budget.planEnd < today ? "badge-danger" : visibleMetrics[0].metrics.remaining < 0 ? "badge-danger" : visibleMetrics[0].metrics.remaining < visibleMetrics[0].metrics.allocation * .15 ? "badge-returned" : "badge-approved"}`}>{visibleMetrics[0].budget.planEnd < today ? "Plan expired" : visibleMetrics[0].metrics.remaining < 0 ? "Over allocation" : visibleMetrics[0].metrics.remaining < visibleMetrics[0].metrics.allocation * .15 ? "Low balance" : "Within plan"}</span></div><div className="mt-5 flex items-end justify-between gap-4"><div><div className="text-[10px] text-[#849198]">Allocated</div><div className="mt-1 text-xl font-semibold">{money(visibleMetrics[0].metrics.allocation)}</div></div><div className="text-right"><div className="text-[10px] text-[#849198]">Available after commitments</div><div className="mt-1 text-xl font-semibold text-[#256d67]">{money(visibleMetrics[0].metrics.remaining)}</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e9efed]"><div className="h-full rounded-full bg-[#4c9d92] transition-all" style={{ width: `${Math.min(100, Math.max(0, (visibleMetrics[0].metrics.allocation - visibleMetrics[0].metrics.remaining) / Math.max(1, visibleMetrics[0].metrics.allocation) * 100))}%` }}/></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#7c8990]"><span>Used {money(visibleMetrics[0].metrics.used)}</span><span>Under review {money(visibleMetrics[0].metrics.pending)}</span><span>Scheduled {money(visibleMetrics[0].metrics.committed)}</span></div></div></Panel><Panel title="Allocation controls"><div className="p-5"><p className="text-[11px] leading-5 text-[#71818a]">Adjust category limits to match an authorised plan update. Every change requires a reason and remains local to this prototype.</p><div className="mt-4"><Button variant="secondary" className="w-full" onClick={() => beginEdit(visibleMetrics[0].budget!)}><SlidersHorizontal size={14}/>Adjust allocation</Button></div></div></Panel></div>}

    {editBudget && <Panel title={`Adjust allocation · ${participants.find(person => person.id === editClientId)?.preferred ?? "participant"}`} className="mb-5" action={<button className="icon-btn" aria-label="Close allocation adjustment" onClick={() => setEditClientId(null)}>×</button>}><div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2"><label className="label">Budget category<select className="select mt-1" value={editCategory} onChange={event => { setEditCategory(event.target.value); setAllocationInput(String(editBudget.categories.find(category => category.name === event.target.value)?.allocation ?? "")); }}><option value="" disabled>Select category</option>{editBudget.categories.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}</select></label><label className="label">New allocation (AUD)<input className="input mt-1" type="number" min="0" step="100" value={allocationInput} onChange={event => setAllocationInput(event.target.value)}/></label><label className="label sm:col-span-2">Reason for change<textarea className="textarea mt-1 !min-h-[70px]" value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Updated plan allocation confirmed on 28 Sep"/></label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={saveAdjustment}><Check size={14}/>Save allocation</Button><Button variant="secondary" onClick={() => setEditClientId(null)}>Cancel</Button></div></div></Panel>}

    <Panel title={selectedClient === "All" ? "Budget register" : `${visibleParticipants[0]?.preferred ?? "Participant"} · category breakdown`} action={<span className="text-[10px] text-[#849198]">AUD · demo allocations</span>}>
      {visibleMetrics.length === 0 ? <div className="p-6 text-center text-xs text-[#77858b]">No budget allocation is available for this participant.</div> : <div className="table-wrap"><table className="data-table min-w-[780px]"><thead><tr><th>Participant / category</th><th>Plan allocation</th><th>Approved / invoiced</th><th>Awaiting review</th><th>Scheduled</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{visibleMetrics.map(({ person, budget, metrics }) => metrics && budget && <Fragment key={person.id}><tr className="bg-[#f9fbfa]"><td><button className="text-left font-semibold text-[#354b57] hover:text-[#177f78]" onClick={() => setSelectedClient(person.id)}>{person.name}<small className="mt-1 block font-normal text-[#829097]">Plan ends {dateLabel(budget.planEnd)}</small></button></td><td className="font-semibold">{money(metrics.allocation)}</td><td>{money(metrics.used)}</td><td>{money(metrics.pending)}</td><td>{money(metrics.committed)}</td><td className={`font-semibold ${metrics.remaining < 0 ? "text-[#a84540]" : "text-[#2e7067]"}`}>{money(metrics.remaining)}</td><td><span className={`badge ${budget.planEnd < today ? "badge-danger" : metrics.remaining < 0 ? "badge-danger" : metrics.remaining < metrics.allocation * .15 ? "badge-returned" : "badge-approved"}`}>{budget.planEnd < today ? "Plan expired" : metrics.remaining < 0 ? "Over allocation" : metrics.remaining < metrics.allocation * .15 ? "Low balance" : "Within plan"}</span></td></tr>{selectedClient !== "All" && metrics.categories.map(category => <tr key={`${person.id}-${category.name}`}><td className="pl-8 text-xs">{category.name}</td><td>{money(category.allocation)}</td><td>{money(category.used)}</td><td>{money(category.pending)}</td><td>{money(category.committed)}</td><td className={category.remaining < 0 ? "font-semibold text-[#a84540]" : "text-[#52666f]"}>{money(category.remaining)}</td><td>{category.remaining < 0 && <span className="badge badge-danger">Review required</span>}</td></tr>)}</Fragment>)}</tbody></table></div>}
    </Panel>
    <div className="mt-4 flex items-start gap-2 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]"><Info size={14} className="mt-0.5 shrink-0"/>Used values include approved/invoiced service records; submitted records are shown separately as pending; planned/confirmed future shifts reserve an estimate. Figures are fictional and must be reconciled to the participant’s approved plan before real use.</div>
  </>;
}
