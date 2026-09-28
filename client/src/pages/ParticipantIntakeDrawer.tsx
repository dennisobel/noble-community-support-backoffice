import { useEffect, useState, type FormEvent } from "react";
import { Check, FileCheck2, Info, UserRound, X } from "lucide-react";
import type { Participant } from "@/lib/mock-data";

export type ParticipantIntakeData = {
  name: string;
  preferred: string;
  ndis: string;
  dob: string;
  phone: string;
  email: string;
  address: string;
  planStart: string;
  planEnd: string;
  manager: string;
  nominee: string;
  emergencyName: string;
  emergencyPhone: string;
  alertsText: string;
  goalsText: string;
  communication: string;
  mobility: string;
  transport: string;
  support: string;
  risks: string;
  allergies: string;
  preferences: string;
  kyc: NonNullable<Participant["kyc"]>;
};

const emptyForm = (): ParticipantIntakeData => ({
  name: "", preferred: "", ndis: "", dob: "", phone: "", email: "", address: "",
  planStart: "", planEnd: "", manager: "", nominee: "", emergencyName: "", emergencyPhone: "",
  alertsText: "", goalsText: "", communication: "", mobility: "", transport: "", support: "", risks: "", allergies: "", preferences: "",
  kyc: { serviceAgreement: false, consentForms: false, supportPlan: false, riskInformationReviewed: false, transportRequirementsConfirmed: false },
});

const kycItems: Array<{ key: keyof ParticipantIntakeData["kyc"]; label: string; detail: string }> = [
  { key: "serviceAgreement", label: "Service agreement", detail: "Agreement received or signed" },
  { key: "consentForms", label: "Consent forms", detail: "Consent and nominee permissions recorded" },
  { key: "supportPlan", label: "Support plan & goals", detail: "Current plan and participant goals reviewed" },
  { key: "riskInformationReviewed", label: "Incidents, hazards & risks", detail: "Known risks and safety information checked" },
  { key: "transportRequirementsConfirmed", label: "Transport requirements", detail: "Travel and access requirements confirmed" },
];

export default function ParticipantIntakeDrawer({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (data: ParticipantIntakeData) => void;
}) {
  const [form, setForm] = useState<ParticipantIntakeData>(emptyForm);
  const [error, setError] = useState("");
  const setField = <K extends keyof ParticipantIntakeData>(key: K, value: ParticipantIntakeData[K]) => setForm(current => ({ ...current, [key]: value }));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (form.ndis.replace(/\D/g, "").length !== 9) { setError("Enter the 9-digit NDIS number."); return; }
    if (form.planStart && form.planEnd && form.planEnd < form.planStart) { setError("The plan end date must be on or after the start date."); return; }
    onCreate(form);
  };

  return <div className="fixed inset-0 z-[100]">
    <button className="app-drawer-backdrop" aria-label="Close new participant form" onClick={onClose}/>
    <aside role="dialog" aria-modal="true" aria-labelledby="participant-drawer-title" className="app-drawer-panel">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e6ece9] bg-white px-5 py-4 sm:px-7"><div><div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#538880]"><UserRound size={13}/>Client intake · Admin</div><h2 id="participant-drawer-title" className="serif text-2xl text-[#243d49]">Add participant</h2><p className="mt-1 text-[11px] text-[#78888d]">Create a client profile and record the initial KYC checklist.</p></div><button className="icon-btn" aria-label="Close new participant form" onClick={onClose}><X size={17}/></button></header>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
          <section className="rounded-lg border border-[#e5ebe8] bg-white p-4 sm:p-5"><div className="mb-4"><h3 className="text-xs font-bold text-[#354b57]">01 · Identity & contact</h3><p className="mt-1 text-[10px] text-[#87949a]">Core participant and contact details from the client profile checklist.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="label">Legal name <span className="text-red-600">*</span><input required autoFocus className="input mt-1" value={form.name} onChange={event => setField("name", event.target.value)} placeholder="Full legal name"/></label>
            <label className="label">Preferred name <span className="text-red-600">*</span><input required className="input mt-1" value={form.preferred} onChange={event => setField("preferred", event.target.value)} placeholder="Name used day to day"/></label>
            <label className="label">NDIS number <span className="text-red-600">*</span><input required inputMode="numeric" className="input mt-1" value={form.ndis} onChange={event => setField("ndis", event.target.value)} placeholder="9 digits" maxLength={12}/></label>
            <label className="label">Date of birth <span className="text-red-600">*</span><input required type="date" className="input mt-1" value={form.dob} onChange={event => setField("dob", event.target.value)}/></label>
            <label className="label">Phone <span className="text-red-600">*</span><input required type="tel" className="input mt-1" value={form.phone} onChange={event => setField("phone", event.target.value)} placeholder="04xx xxx xxx"/></label>
            <label className="label">Email <span className="text-red-600">*</span><input required type="email" className="input mt-1" value={form.email} onChange={event => setField("email", event.target.value)} placeholder="name@example.com"/></label>
            <label className="label sm:col-span-2">Residential address <span className="text-red-600">*</span><input required className="input mt-1" value={form.address} onChange={event => setField("address", event.target.value)} placeholder="Street, suburb, state and postcode"/></label>
          </div></section>

          <section className="rounded-lg border border-[#e5ebe8] bg-white p-4 sm:p-5"><div className="mb-4"><h3 className="text-xs font-bold text-[#354b57]">02 · Plan, nominee & emergency contact</h3><p className="mt-1 text-[10px] text-[#87949a]">Record the current NDIS plan period and the people Noble should contact.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="label">Plan start<input type="date" className="input mt-1" value={form.planStart} onChange={event => setField("planStart", event.target.value)}/></label>
            <label className="label">Plan end<input type="date" className="input mt-1" value={form.planEnd} onChange={event => setField("planEnd", event.target.value)}/></label>
            <label className="label">Plan manager / self-managed<input className="input mt-1" value={form.manager} onChange={event => setField("manager", event.target.value)} placeholder="Plan manager or Self-managed"/></label>
            <label className="label">Nominee / guardian<input className="input mt-1" value={form.nominee} onChange={event => setField("nominee", event.target.value)} placeholder="Name and relationship, if applicable"/></label>
            <label className="label">Emergency contact name <span className="text-red-600">*</span><input required className="input mt-1" value={form.emergencyName} onChange={event => setField("emergencyName", event.target.value)} placeholder="Contact name and relationship"/></label>
            <label className="label">Emergency contact phone <span className="text-red-600">*</span><input required type="tel" className="input mt-1" value={form.emergencyPhone} onChange={event => setField("emergencyPhone", event.target.value)} placeholder="Phone number"/></label>
          </div></section>

          <section className="rounded-lg border border-[#e5ebe8] bg-white p-4 sm:p-5"><div className="mb-4"><h3 className="text-xs font-bold text-[#354b57]">03 · Support, goals & safety</h3><p className="mt-1 text-[10px] text-[#87949a]">Capture practical information needed before services are delivered.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="label sm:col-span-2">Support needs<textarea className="textarea mt-1" value={form.support} onChange={event => setField("support", event.target.value)} placeholder="Types of support and day-to-day assistance required"/></label>
            <label className="label sm:col-span-2">Goals <span className="font-normal text-[#88959a]">(one per line)</span><textarea className="textarea mt-1" value={form.goalsText} onChange={event => setField("goalsText", event.target.value)} placeholder="Participant-led goals and outcomes"/></label>
            <label className="label">Communication needs<textarea className="textarea mt-1" value={form.communication} onChange={event => setField("communication", event.target.value)} placeholder="Preferred communication approach"/></label>
            <label className="label">Mobility needs<textarea className="textarea mt-1" value={form.mobility} onChange={event => setField("mobility", event.target.value)} placeholder="Mobility aids or access needs"/></label>
            <label className="label">Transport requirements<textarea className="textarea mt-1" value={form.transport} onChange={event => setField("transport", event.target.value)} placeholder="Vehicle and travel requirements"/></label>
            <label className="label">Risks & alerts<textarea className="textarea mt-1" value={form.risks} onChange={event => setField("risks", event.target.value)} placeholder="Known risks, hazards and safety alerts"/></label>
            <label className="label">Allergies<textarea className="textarea mt-1" value={form.allergies} onChange={event => setField("allergies", event.target.value)} placeholder="List allergies or write ‘None known’"/></label>
            <label className="label">Preferences<textarea className="textarea mt-1" value={form.preferences} onChange={event => setField("preferences", event.target.value)} placeholder="Participant preferences and routines"/></label>
            <label className="label sm:col-span-2">Important alerts<textarea className="textarea mt-1" value={form.alertsText} onChange={event => setField("alertsText", event.target.value)} placeholder="Urgent or high-priority information (one per line)"/></label>
          </div></section>

          <section className="rounded-lg border border-[#dbe8e3] bg-[#f5f9f7] p-4 sm:p-5"><div className="mb-3 flex items-start gap-2"><FileCheck2 size={16} className="mt-0.5 text-[#43877c]"/><div><h3 className="text-xs font-bold text-[#354b57]">04 · KYC & onboarding checklist</h3><p className="mt-1 text-[10px] leading-4 text-[#77878b]">Mark what has been received or confirmed. Unchecked items remain pending in the client file.</p></div></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{kycItems.map(item => <label key={item.key} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#e4ece8] bg-white p-3"><input type="checkbox" checked={form.kyc[item.key]} onChange={event => setField("kyc", { ...form.kyc, [item.key]: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[#177d76]"/><span><b className="block text-[11px] text-[#465b65]">{item.label}</b><small className="mt-0.5 block text-[9px] text-[#87949a]">{item.detail}</small></span></label>)}</div><div className="mt-3 flex items-start gap-2 rounded-md border border-[#d9e9e5] bg-white p-3 text-[10px] leading-4 text-[#496663]"><Info size={13} className="mt-0.5 shrink-0"/>The checklist records status only. Secure document upload/storage is not connected in this prototype.</div></section>
          {error && <div role="alert" className="rounded-md border border-[#efd0ce] bg-[#fff3f1] p-3 text-xs text-[#9e4943]">{error}</div>}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e5ebe8] bg-white px-5 py-4 sm:px-7"><p className="text-[10px] text-[#87949a]">Creates a local client profile; no data is sent externally.</p><div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary"><Check size={14}/>Create client profile</button></div></footer>
      </form>
    </aside>
  </div>;
}
