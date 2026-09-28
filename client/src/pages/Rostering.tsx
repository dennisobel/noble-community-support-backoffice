import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleDollarSign, Clock3, MapPin, Plus, ShieldAlert, Users, X } from "lucide-react";
import type { ClientBudget, Participant, RosterShift, ServiceRecord, ShiftRatio, Staff } from "@/lib/mock-data";
import { computeBudgetMetrics, durationHours, shiftCostPerParticipant, type RateTable } from "@/lib/budget-math";

const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const minutes = (time: string) => { const [hours, mins] = time.split(":").map(Number); return hours * 60 + mins; };
function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) { return <section className={`panel ${className}`}>{(title || action) && <div className="flex items-center justify-between gap-3 border-b border-[#e9eeec] px-5 py-4"><h2 className="panel-title">{title}</h2>{action}</div>}{children}</section>; }
function Button({ children, onClick, variant = "primary", disabled = false, className = "" }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "quiet"; disabled?: boolean; className?: string }) { return <button type="button" onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`}>{children}</button>; }

const freshDraft = (today: string): RosterShift => ({ id: "NEW", date: today, start: "09:00", end: "11:00", ratio: "1:1", clientIds: ["p1"], staffIds: ["s1"], type: "Community participation", location: "", status: "Planned" });

export default function Rostering({ participants, staff, rates, shifts, budgets, records, role, today, onShiftsChange, notify, onOpenBudgets }: {
  participants: Participant[];
  staff: Staff[];
  rates: RateTable;
  shifts: RosterShift[];
  budgets: ClientBudget[];
  records: ServiceRecord[];
  role: Staff["role"];
  today: string;
  onShiftsChange: (next: RosterShift[]) => void;
  notify: (message: string) => void;
  onOpenBudgets: (clientId?: string) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [ratioFilter, setRatioFilter] = useState("All ratios");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RosterShift>(() => freshDraft(today));
  const [formError, setFormError] = useState("");
  const [budgetAcknowledged, setBudgetAcknowledged] = useState(false);
  useEffect(() => { if (role === "Staff") { setFormOpen(false); setEditId(null); } }, [role]);

  const weekDays = useMemo(() => {
    const monday = new Date(`${today}T12:00:00`);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weekOffset * 7);
    return Array.from({ length: 7 }, (_, index) => { const day = new Date(monday); day.setDate(monday.getDate() + index); return { date: isoDate(day), label: day.toLocaleDateString("en-AU", { weekday: "short" }), day: day.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) }; });
  }, [today, weekOffset]);
  const weekDates = weekDays.map(day => day.date);
  const weekShifts = shifts.filter(shift => weekDates.includes(shift.date));
  const visibleShifts = ratioFilter === "All ratios" ? weekShifts : weekShifts.filter(shift => shift.ratio === ratioFilter);
  const staffAvailable = staff.filter(person => person.status === "Active");
  const activeParticipants = participants.filter(person => person.status === "Active");
  const rate = rates.find(item => item.name === draft.type)?.rate ?? 68.3;
  const hours = durationHours(draft.start, draft.end);
  const perParticipantEstimate = Math.round(hours * rate * 100) / 100;
  const weekBudgetCommitment = weekShifts.filter(shift => shift.status !== "Completed").reduce((sum, shift) => sum + shiftCostPerParticipant(shift, rates) * shift.clientIds.length, 0);
  const weekStaffHours = weekShifts.reduce((sum, shift) => sum + durationHours(shift.start, shift.end) * shift.staffIds.length, 0);
  const weekParticipantCount = new Set(weekShifts.flatMap(shift => shift.clientIds)).size;
  const budgetRiskNames = draft.clientIds.filter(clientId => {
    const budget = budgets.find(item => item.clientId === clientId);
    if (!budget) return false;
    const metrics = computeBudgetMetrics(clientId, budget, records, shifts, rates, today, editId ?? undefined);
    return metrics.remaining - perParticipantEstimate < 0;
  }).map(clientId => participants.find(person => person.id === clientId)?.preferred ?? clientId);

  const startCreate = () => { setEditId(null); setDraft(freshDraft(today)); setFormError(""); setBudgetAcknowledged(false); setFormOpen(true); };
  const startEdit = (shift: RosterShift) => { setEditId(shift.id); setDraft({ ...shift, clientIds: [...shift.clientIds], staffIds: [...shift.staffIds] }); setFormError(""); setBudgetAcknowledged(false); setFormOpen(true); };
  const changeRatio = (ratio: ShiftRatio) => setDraft(current => {
    const nextClient = activeParticipants.find(person => !current.clientIds.includes(person.id))?.id;
    const nextStaff = staffAvailable.find(person => !current.staffIds.includes(person.id))?.id;
    if (ratio === "1:1") return { ...current, ratio, clientIds: current.clientIds.slice(0,1), staffIds: current.staffIds.slice(0,1), type: "Community participation" };
    if (ratio === "1:M") return { ...current, ratio, clientIds: current.clientIds.length >= 2 ? current.clientIds : [...current.clientIds, ...(nextClient ? [nextClient] : [])], staffIds: current.staffIds.slice(0,1), type: "Group community access" };
    return { ...current, ratio, clientIds: current.clientIds.length >= 2 ? current.clientIds : [...current.clientIds, ...(nextClient ? [nextClient] : [])], staffIds: current.staffIds.length >= 2 ? current.staffIds : [...current.staffIds, ...(nextStaff ? [nextStaff] : [])], type: "Group community access" };
  });
  const toggleMember = (kind: "clientIds" | "staffIds", id: string, checked: boolean) => setDraft(current => ({ ...current, [kind]: checked ? [...current[kind], id] : current[kind].filter(item => item !== id) }));
  const saveShift = () => {
    if (role === "Staff") { notify("Shift changes are read-only for the Staff role."); return; }
    setFormError("");
    if (!draft.date || hours <= 0) { setFormError("Choose a date and an end time later than the start time."); return; }
    if (draft.ratio === "1:1" && (draft.clientIds.length !== 1 || draft.staffIds.length !== 1)) { setFormError("A 1:1 shift requires exactly one participant and one staff member."); return; }
    if (draft.ratio === "1:M" && (draft.staffIds.length !== 1 || draft.clientIds.length < 2)) { setFormError("A 1:M shift requires one staff member and at least two participants."); return; }
    if (draft.ratio === "M:M" && (draft.staffIds.length < 2 || draft.clientIds.length < 2)) { setFormError("An M:M shift requires at least two staff members and two participants."); return; }
    if (!draft.clientIds.length || !draft.staffIds.length) { setFormError("Assign at least one participant and one available staff member."); return; }
    if (budgetRiskNames.length && !budgetAcknowledged) { setFormError(`The planned estimate may exceed remaining plan funds for ${budgetRiskNames.join(", ")}. Review budgets or acknowledge this exception.`); return; }
    const conflicts = shifts.filter(existing => existing.id !== editId && existing.date === draft.date && minutes(draft.start) < minutes(existing.end) && minutes(draft.end) > minutes(existing.start));
    const clientConflict = conflicts.find(existing => draft.clientIds.some(id => existing.clientIds.includes(id)));
    const staffConflict = conflicts.find(existing => draft.staffIds.some(id => existing.staffIds.includes(id)));
    if (clientConflict) { setFormError(`A participant is already rostered during this time (${clientConflict.id}). Resolve the overlap before saving.`); return; }
    if (staffConflict) { setFormError(`A staff member is already assigned during this time (${staffConflict.id}). Resolve the overlap before saving.`); return; }
    const nextId = editId ?? `SH-${String(Math.max(2400, ...shifts.map(shift => Number(shift.id.replace("SH-", "")) || 0)) + 1)}`;
    const value = { ...draft, id: nextId, status: editId ? draft.status : "Planned" as const };
    onShiftsChange(editId ? shifts.map(shift => shift.id === editId ? value : shift) : [value, ...shifts]);
    setFormOpen(false); setBudgetAcknowledged(false); notify(editId ? `${nextId} updated in the roster.` : `${nextId} added as a planned shift.`);
  };

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="page-title serif">Flexible rostering</h1><p className="page-subtitle">Plan individual and shared supports with visible participant-to-staff ratios.</p></div><div className="flex items-center gap-2">{role !== "Staff" && <Button onClick={startCreate}><Plus size={15}/>Create shift</Button>}<Button variant="secondary" onClick={() => onOpenBudgets()}><CircleDollarSign size={14}/>Participant budgets</Button></div></div>
    {role === "Staff" && <div className="mb-4 flex items-start gap-2 rounded-md border border-[#dce7e4] bg-white p-3 text-[11px] text-[#62767d]"><ShieldAlert size={14} className="mt-0.5 text-[#92702f]"/>Roster is view-only for the Staff role. A Manager/Reviewer or Admin can add and edit shifts.</div>}
    <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4"><div className="panel p-4"><span className="text-[10px] text-[#829097]">Shifts this week</span><div className="stat-number mt-1">{weekShifts.length}</div></div><div className="panel p-4"><span className="text-[10px] text-[#829097]">Participants rostered</span><div className="stat-number mt-1">{weekParticipantCount}</div></div><div className="panel p-4"><span className="text-[10px] text-[#829097]">Staff hours scheduled</span><div className="stat-number mt-1">{weekStaffHours.toFixed(1)}<span className="ml-1 text-xs font-medium text-[#819097]">hrs</span></div></div><div className="panel p-4"><span className="text-[10px] text-[#829097]">Estimated participant commitments</span><div className="mt-2 text-xl font-semibold text-[#2d4d58]">{money(weekBudgetCommitment)}</div></div></div>

    <Panel className="mb-5" title="Roster board" action={<div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="ratio-filter">Filter staffing ratio</label><select id="ratio-filter" className="select h-8 w-[130px] py-1 text-[10px]" value={ratioFilter} onChange={event => setRatioFilter(event.target.value)}><option>All ratios</option><option>1:1</option><option>1:M</option><option>M:M</option></select><Button variant="quiet" className="!h-8 !px-2" onClick={() => setWeekOffset(value => value - 1)} aria-label="Previous week"><ArrowLeft size={15}/></Button><Button variant="quiet" className="!h-8 !px-2" onClick={() => setWeekOffset(value => value + 1)} aria-label="Next week"><ArrowRight size={15}/></Button></div>}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ef] px-5 py-3"><div className="flex items-center gap-2 text-xs font-semibold text-[#435963]"><CalendarDays size={15} className="text-[#4b9187]"/>{weekDays[0].day} – {weekDays[6].day}</div><div className="text-[10px] text-[#819097]">Ratio guide: <b>1:1</b> one-to-one · <b>1:M</b> one staff to several clients · <b>M:M</b> several staff supporting several clients</div></div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-7">{weekDays.map(day => {
        const dayShifts = visibleShifts.filter(shift => shift.date === day.date).sort((a,b) => a.start.localeCompare(b.start));
        return <div key={day.date} className={`min-h-[180px] rounded-md border p-2.5 ${day.date === today ? "border-[#8ac4bb] bg-[#f6fbf9]" : "border-[#e8eeeb] bg-[#fbfcfb]"}`}><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wide text-[#677982]">{day.label}</span><span className={`text-xs font-semibold ${day.date === today ? "text-[#147f79]" : "text-[#40545e]"}`}>{day.day.split(" ")[0]}</span></div>{dayShifts.length === 0 ? <div className="pt-7 text-center text-[10px] text-[#a0aaad]">No shifts planned</div> : <div className="space-y-2">{dayShifts.map(shift => <article key={shift.id} className="rounded-md border border-[#e5ece9] bg-white p-2.5 shadow-[0_2px_5px_rgba(20,40,45,.03)]"><div className="flex items-start justify-between gap-1"><span className="text-[10px] font-bold text-[#344b56]">{shift.start}–{shift.end}</span><span className={`badge ${shift.ratio === "1:1" ? "badge-approved" : shift.ratio === "1:M" ? "badge-submitted" : "badge-returned"}`}>{shift.ratio}</span></div><div className="mt-1 text-[10px] font-semibold leading-4 text-[#405762]">{shift.type}</div><div className="mt-2 flex items-start gap-1 text-[9px] leading-4 text-[#687b82]"><Users size={11} className="mt-0.5 shrink-0 text-[#648c86]"/><span>{shift.clientIds.map(id => participants.find(person => person.id === id)?.preferred ?? "Unknown").join(", ")}</span></div><div className="mt-1 flex items-start gap-1 text-[9px] leading-4 text-[#687b82]"><span className="mt-0.5 shrink-0 text-[#89979d]">Staff</span><span>{shift.staffIds.map(id => staff.find(person => person.id === id)?.initials ?? "?").join(" · ")}</span></div>{shift.location && <div className="mt-1 flex items-start gap-1 text-[9px] leading-4 text-[#87949a]"><MapPin size={10} className="mt-0.5 shrink-0"/><span className="line-clamp-2">{shift.location}</span></div>}<div className="mt-2 flex items-center justify-between border-t border-[#f0f3f2] pt-2"><span className={`text-[9px] font-semibold ${shift.status === "Confirmed" ? "text-[#33785d]" : shift.status === "Completed" ? "text-[#77858b]" : "text-[#9a6f25]"}`}>{shift.status}</span>{role !== "Staff" && <button className="text-[9px] font-semibold text-[#277c76] hover:underline" onClick={() => startEdit(shift)}>Edit</button>}</div></article>)}</div>}</div>;
      })}</div>
    </Panel>

    {formOpen && <Panel className="mb-5" title={editId ? `Edit shift · ${editId}` : "Create a flexible shift"} action={<button className="icon-btn" aria-label="Close shift form" onClick={() => setFormOpen(false)}><X size={16}/></button>}>
      <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-[1.1fr_1fr_300px]"><div className="space-y-4"><div className="grid grid-cols-2 gap-3"><label className="label">Date<input className="input mt-1" type="date" value={draft.date} onChange={event => setDraft(current => ({ ...current, date: event.target.value }))}/></label><label className="label">Staffing ratio<select className="select mt-1" value={draft.ratio} onChange={event => changeRatio(event.target.value as ShiftRatio)}><option value="1:1">1:1 · individual</option><option value="1:M">1:M · shared staff</option><option value="M:M">M:M · shared team</option></select></label><label className="label">Start time<input className="input mt-1" type="time" value={draft.start} onChange={event => setDraft(current => ({ ...current, start: event.target.value }))}/></label><label className="label">End time<input className="input mt-1" type="time" value={draft.end} onChange={event => setDraft(current => ({ ...current, end: event.target.value }))}/></label></div><label className="label">Support type<select className="select mt-1" value={draft.type} onChange={event => setDraft(current => ({ ...current, type: event.target.value }))}>{rates.filter(item => item.active).map(item => <option key={item.id} value={item.name}>{item.name} · {money(item.rate)}/hr per participant</option>)}</select></label><label className="label">Location<input className="input mt-1" value={draft.location} onChange={event => setDraft(current => ({ ...current, location: event.target.value }))} placeholder="e.g. Community centre or participant home"/></label></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1"><fieldset><legend className="label">Participants <span className="font-normal text-[#839097]">({draft.clientIds.length} selected)</span></legend><div className="max-h-[185px] space-y-2 overflow-y-auto rounded-md border border-[#e4eae7] p-3">{activeParticipants.map(person => <label key={person.id} className="flex items-center gap-2 text-xs text-[#4e626b]"><input type="checkbox" checked={draft.clientIds.includes(person.id)} onChange={event => toggleMember("clientIds", person.id, event.target.checked)} className="accent-[#147f79]"/>{person.name}<span className="ml-auto text-[10px] text-[#91a0a4]">{person.preferred}</span></label>)}</div></fieldset><fieldset><legend className="label">Available staff <span className="font-normal text-[#839097]">({draft.staffIds.length} selected)</span></legend><div className="max-h-[185px] space-y-2 overflow-y-auto rounded-md border border-[#e4eae7] p-3">{staffAvailable.map(person => <label key={person.id} className="flex items-center gap-2 text-xs text-[#4e626b]"><input type="checkbox" checked={draft.staffIds.includes(person.id)} onChange={event => toggleMember("staffIds", person.id, event.target.checked)} className="accent-[#147f79]"/>{person.name}<span className="ml-auto text-[10px] text-[#91a0a4]">{person.role}</span></label>)}</div><p className="field-help">Staff on leave are excluded from assignments.</p></fieldset></div>
      <div className="space-y-4"><div className="rounded-md border border-[#dce9e5] bg-[#f2f8f6] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#38665f]"><Clock3 size={14}/>Shift summary</div><div className="mt-3 flex justify-between text-[11px] text-[#64787f]"><span>Duration</span><b>{hours.toFixed(1)} hours</b></div><div className="mt-2 flex justify-between text-[11px] text-[#64787f]"><span>Estimate per participant</span><b>{money(perParticipantEstimate)}</b></div><div className="mt-2 flex justify-between text-[11px] text-[#64787f]"><span>Roster ratio</span><b>{draft.staffIds.length} staff · {draft.clientIds.length} participants</b></div><p className="mt-3 text-[10px] leading-4 text-[#819097]">Budget commitment uses the selected service rate per participant. This is an estimate, not an invoice.</p></div>{budgetRiskNames.length > 0 && <label className="flex items-start gap-2 rounded-md border border-[#f0d7aa] bg-[#fff8e9] p-3 text-[10px] leading-4 text-[#876521]"><input type="checkbox" checked={budgetAcknowledged} onChange={event => setBudgetAcknowledged(event.target.checked)} className="mt-0.5 accent-[#147f79]"/><span><b>Budget warning for {budgetRiskNames.join(", ")}.</b> Proposed shifts may exceed available plan funding. I have reviewed the budget warning and want to continue.</span></label>}{formError && <div role="alert" className="rounded-md border border-[#efd0ce] bg-[#fff3f1] p-3 text-[11px] leading-4 text-[#9e4943]"><ShieldAlert size={14} className="mr-1 inline"/>{formError}</div>}<div className="flex flex-wrap gap-2"><Button onClick={saveShift}><Check size={14}/>{editId ? "Update shift" : "Save planned shift"}</Button><Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button></div></div></div>
    </Panel>}

    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]"><span><CalendarDays size={14} className="mr-1 inline"/>Roster changes are local mock data. Confirm participant availability, staff coverage, plan funding and organisational policy before operational use.</span><button className="shrink-0 font-semibold text-[#277c76]" onClick={() => onOpenBudgets()}>Review budgets <ArrowRight size={12} className="ml-1 inline"/></button></div>
  </>;
}
