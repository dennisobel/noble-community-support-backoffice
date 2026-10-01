import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Info,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import type { ServiceRecordDTO } from "@shared/dto";
import {
  NOTE_SECTIONS,
  NOTE_SECTION_LABELS,
  type NoteSection,
} from "@shared/enums";
import { computeBillables } from "@shared/logic/billing";
import { fromCents, toCents } from "@shared/logic/money";
import { MESSAGES } from "@shared/messages";
import { ApiError, errorMessage } from "@/api/client";
import {
  useCreateRecord,
  useDeleteRecord,
  useMeta,
  useParticipants,
  useRecord,
  useRecordAction,
  useServices,
  useStaff,
  useUpdateRecord,
  useVoiceNote,
  useVoiceNotes,
  useWorkspace,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  EmptyState,
  ErrorBlock,
  FieldError,
  FormAlert,
  LoadingBlock,
  Panel,
  SectionHeading,
  Status,
} from "@/components/app/ui";
import { durationHours, formatDateTime, money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

interface FormState {
  clientId: string;
  staffId: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  location: string;
  km: string;
  quantity: string;
  confirmed: boolean;
  voiceNoteId: string;
  support: string;
  response: string;
  outcome: string;
  observations: string;
  followUp: string;
}

const HELP: Record<NoteSection, string> = {
  support: "Record the concrete actions and support delivered.",
  response: "Describe the participant’s response and choices.",
  outcome: "Connect the support to a stated participant goal.",
  observations: "Include relevant factual observations; avoid assumptions.",
  followUp: "Record who will do what, and when.",
};

function fromRecord(record: ServiceRecordDTO): FormState {
  return {
    clientId: record.clientId,
    staffId: record.staffId,
    serviceId: record.serviceId,
    date: record.date,
    start: record.start,
    end: record.end,
    location: record.location,
    km: String(record.km ?? 0),
    quantity: record.quantity === null ? "" : String(record.quantity),
    confirmed: record.confirmed,
    voiceNoteId: record.voiceId ?? "",
    support: record.support,
    response: record.response,
    outcome: record.outcome,
    observations: record.observations,
    followUp: record.followUp,
  };
}

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  submitted: "Submitted for review",
  resubmitted: "Resubmitted after correction",
  approved: "Approved",
  returned: "Returned for correction",
  billables_adjusted: "Billable lines adjusted",
  invoiced: "Added to invoice",
  invoice_deleted: "Invoice draft deleted",
  invoice_voided: "Invoice voided",
  draft_applied: "AI-assisted draft applied",
};

export default function RecordEditorPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const query = new URLSearchParams(useSearch());
  const presetClient = query.get("clientId") ?? undefined;
  const sourceVoiceId = query.get("voiceId") ?? undefined;
  const [, navigate] = useLocation();
  const notify = useNotify();

  const meta = useMeta();
  const workspace = useWorkspace();
  const recordQuery = useRecord(id);
  const participants = useParticipants({ status: "all", limit: 200 });
  const staff = useStaff({ status: "all" });
  const services = useServices({ active: "all" });
  const sourceVoice = useVoiceNote(id ? undefined : sourceVoiceId);
  const create = useCreateRecord();
  const update = useUpdateRecord();
  const action = useRecordAction();
  const remove = useDeleteRecord();

  const [form, setForm] = useState<FormState | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const record = recordQuery.data;
  const voiceNotes = useVoiceNotes({ clientId: form?.clientId, status: "all" });

  // Initialise the form from the record, or from sensible defaults for a new record.
  useEffect(() => {
    if (id) {
      if (record && (loadedFor !== record.id || !dirty)) {
        setForm(fromRecord(record));
        setLoadedFor(record.id);
      }
      return;
    }
    if (
      loadedFor === "new" ||
      !participants.data ||
      !staff.data ||
      !services.data ||
      !meta.data
    )
      return;
    if (sourceVoiceId && !sourceVoice.data && !sourceVoice.isError) return;
    const activeClients = participants.data.items.filter(
      item => item.status === "Active"
    );
    const voice = sourceVoice.data;
    const draft = voice?.draft;
    setForm({
      clientId: voice?.clientId ?? presetClient ?? activeClients[0]?.id ?? "",
      staffId: staff.data.find(member => member.status === "Active")?.id ?? "",
      serviceId: services.data.find(service => service.active)?.id ?? "",
      date: meta.data.today,
      start: "09:00",
      end: "11:00",
      location: "",
      km: "0",
      quantity: "",
      confirmed: false,
      voiceNoteId: voice?.id ?? "",
      support: draft?.support ?? "",
      response: draft?.response ?? "",
      outcome: draft?.outcome ?? "",
      observations: draft?.observations ?? "",
      followUp: draft?.followUp ?? "",
    });
    setLoadedFor("new");
    setDirty(Boolean(draft));
  }, [
    id,
    record,
    loadedFor,
    dirty,
    participants.data,
    staff.data,
    services.data,
    meta.data,
    sourceVoiceId,
    sourceVoice.data,
    sourceVoice.isError,
    presetClient,
  ]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const service = services.data?.find(item => item.id === form?.serviceId);
  const editable =
    !id || record?.status === "Draft" || record?.status === "Returned";
  const liveBillables = useMemo(() => {
    if (!form || !service) return [];
    return computeBillables(
      {
        start: form.start,
        end: form.end,
        km: Number(form.km) || 0,
        quantity: form.quantity === "" ? null : Number(form.quantity),
      },
      {
        name: service.name,
        unit: service.unit,
        rateCents: toCents(service.rate),
        transportEnabled: service.transport,
      },
      toCents(workspace.data?.providerTravelRate ?? 1)
    ).map(line => ({
      label: line.label,
      unit: line.unit,
      quantity: line.quantity,
      rate: fromCents(line.rateCents),
      subtotal: fromCents(line.subtotalCents),
    }));
  }, [form, service, workspace.data?.providerTravelRate]);

  const loading =
    (id && recordQuery.isPending) ||
    !participants.data ||
    !staff.data ||
    !services.data ||
    !form;
  if (id && recordQuery.isError)
    return (
      <ErrorBlock
        error={recordQuery.error}
        onRetry={() => recordQuery.refetch()}
      />
    );
  if (loading) return <LoadingBlock label="Loading service record…" />;
  if (!participants.data.items.some(item => item.status === "Active") && !id) {
    return (
      <EmptyState
        title="Add a participant first"
        text="Service records belong to a participant's client file."
        action={
          <Btn onClick={() => navigate("/app/clients")}>Go to clients</Btn>
        }
      />
    );
  }

  const billables = editable ? liveBillables : (record?.billables ?? []);
  const total = billables.reduce((sum, line) => sum + line.subtotal, 0);
  const duration = durationHours(form.start, form.end);
  const clientChoices = participants.data.items.filter(
    item => item.status === "Active" || item.id === form.clientId
  );
  const staffChoices = staff.data.filter(
    member => member.status === "Active" || member.id === form.staffId
  );
  const serviceChoices = services.data.filter(
    item => item.active || item.id === form.serviceId
  );
  const voiceChoices = (voiceNotes.data?.items ?? []).filter(
    voice => voice.clientId === form.clientId
  );
  const linkedVoice = voiceChoices.find(voice => voice.id === form.voiceNoteId);
  const busy = create.isPending || update.isPending || action.isPending;
  const backHref = `/app/clients/${form.clientId}/records`;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setFieldErrors(errors => ({ ...errors, [key]: "" }));
  };

  const payload = () => ({
    clientId: form.clientId,
    staffId: form.staffId,
    serviceId: form.serviceId,
    date: form.date,
    start: form.start,
    end: form.end,
    location: form.location,
    km: Number(form.km) || 0,
    quantity:
      service && service.unit !== "Hour" && form.quantity !== ""
        ? Number(form.quantity)
        : null,
    confirmed: form.confirmed,
    voiceNoteId: form.voiceNoteId || null,
    support: form.support,
    response: form.response,
    outcome: form.outcome,
    observations: form.observations,
    followUp: form.followUp,
  });

  const handleError = (failure: unknown) => {
    if (failure instanceof ApiError) setFieldErrors(failure.fieldErrors());
    setError(errorMessage(failure));
    notify(errorMessage(failure), "error");
  };

  const save = async (): Promise<ServiceRecordDTO> => {
    setError("");
    if (!id) {
      const created = await create.mutateAsync(payload());
      setDirty(false);
      setLoadedFor(null);
      navigate(`/app/records/${created.id}`, { replace: true });
      return created;
    }
    const updated = await update.mutateAsync({
      id,
      rev: record!.rev,
      ...payload(),
    });
    setForm(fromRecord(updated));
    setDirty(false);
    return updated;
  };

  const saveDraft = async () => {
    try {
      await save();
      notify("Draft saved. You can continue editing later.");
    } catch (failure) {
      handleError(failure);
    }
  };

  const submit = async () => {
    const missing = NOTE_SECTIONS.filter(section => !form[section].trim());
    if (!form.confirmed) return notify(MESSAGES.declaration, "error");
    if (missing.length) {
      setFieldErrors(
        Object.fromEntries(
          missing.map(section => [
            section,
            `${NOTE_SECTION_LABELS[section]} is required.`,
          ])
        )
      );
      return notify(MESSAGES.incompleteNote, "error");
    }
    if (service?.unit === "Hour" && duration <= 0)
      return notify(MESSAGES.recordDuration, "error");
    try {
      const saved = !id || dirty ? await save() : record!;
      await action.mutateAsync({
        id: saved.id,
        action: "submit",
        rev: saved.rev,
      });
      notify("Record submitted to the review queue.");
      if (!id) navigate(`/app/records/${saved.id}`, { replace: true });
    } catch (failure) {
      handleError(failure);
    }
  };

  const applyVoiceDraft = async () => {
    if (!form.voiceNoteId) return;
    try {
      const saved = !id || dirty ? await save() : record!;
      const updated = await update.mutateAsync({
        id: saved.id,
        rev: saved.rev,
        voiceNoteId: form.voiceNoteId,
        applyVoiceDraft: true,
      });
      setForm(fromRecord(updated));
      setDirty(false);
      notify("Draft sections applied. Review every section before submitting.");
    } catch (failure) {
      handleError(failure);
    }
  };

  return (
    <>
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-[#277c76]"
      >
        <ArrowLeft size={14} />
        Back to client profile
      </Link>
      <SectionHeading
        title={id ? `Service record ${id}` : "New service record"}
        subtitle="Document the shift clearly. This record will not create an invoice until it is approved and selected."
        actions={
          record ? (
            <Status value={record.status} />
          ) : (
            <Status value="Draft" label="New draft" />
          )
        }
      />
      {record?.status === "Returned" && (
        <div className="mb-4 rounded-md border border-[#ecd29d] bg-[#fff7e6] p-3 text-xs text-[#865f22]">
          <b>Returned for correction</b>
          <p className="mt-1">
            {record.correction ||
              "Please review the note and update the requested details."}
          </p>
        </div>
      )}
      {!editable && record && (
        <div className="mb-4 rounded-md border border-[#cce4d6] bg-[#eef8f1] p-3 text-xs text-[#426a53]">
          <CheckCircle2 size={14} className="mr-1 inline" />
          This record is {record.status.toLowerCase()} and locked from editing.
          You can still review the billable summary.
        </div>
      )}
      {sourceVoice.data?.draft && !id && (
        <div className="mb-4 rounded-md border border-[#f0d9a8] bg-[#fff8ea] p-3 text-xs text-[#826326]">
          <Sparkles size={13} className="mr-1 inline" />
          Sections were pre-filled from the AI-assisted draft of{" "}
          {sourceVoice.data.id}. Check every detail against the service before
          submitting.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <Panel title="Service details">
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="record-client">
                  Participant <span className="text-red-600">*</span>
                </label>
                <select
                  id="record-client"
                  disabled={!editable}
                  className="select"
                  value={form.clientId}
                  onChange={event => {
                    setField("clientId", event.target.value);
                    setField("voiceNoteId", "");
                  }}
                >
                  {clientChoices.map(person => (
                    <option key={person.id} value={person.id}>
                      {person.name} — {person.preferred}
                      {person.status === "Archived" ? " (archived)" : ""}
                    </option>
                  ))}
                </select>
                <FieldError message={fieldErrors.clientId} />
              </div>
              <div>
                <label className="label" htmlFor="record-staff">
                  Staff member
                </label>
                <select
                  id="record-staff"
                  disabled={!editable}
                  className="select"
                  value={form.staffId}
                  onChange={event => setField("staffId", event.target.value)}
                >
                  {staffChoices.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                      {member.status !== "Active"
                        ? ` (${member.status.toLowerCase()})`
                        : ""}
                    </option>
                  ))}
                </select>
                {!staffChoices.length && (
                  <p className="field-help">
                    Add an active team member on the Staff page first.
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="record-date">
                  Service date
                </label>
                <input
                  id="record-date"
                  disabled={!editable}
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={event => setField("date", event.target.value)}
                />
                <FieldError message={fieldErrors.date} />
              </div>
              <div>
                <label className="label" htmlFor="record-service">
                  Support type
                </label>
                <select
                  id="record-service"
                  disabled={!editable}
                  className="select"
                  value={form.serviceId}
                  onChange={event => setField("serviceId", event.target.value)}
                >
                  {serviceChoices.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {!item.active ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
                {!serviceChoices.length && (
                  <p className="field-help">
                    Add a service on the Services page first.
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="record-location">
                  Location
                </label>
                <input
                  id="record-location"
                  disabled={!editable}
                  className="input"
                  value={form.location}
                  onChange={event => setField("location", event.target.value)}
                  placeholder="e.g. Marion Shopping Centre"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="record-start">
                    Shift start
                  </label>
                  <input
                    id="record-start"
                    disabled={!editable}
                    className="input"
                    type="time"
                    value={form.start}
                    onChange={event => setField("start", event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="record-end">
                    Shift end
                  </label>
                  <input
                    id="record-end"
                    disabled={!editable}
                    className="input"
                    type="time"
                    value={form.end}
                    onChange={event => setField("end", event.target.value)}
                  />
                </div>
              </div>
              {service && service.unit !== "Hour" && (
                <div>
                  <label className="label" htmlFor="record-quantity">
                    Quantity ({service.unit.toLowerCase()}s)
                  </label>
                  <input
                    id="record-quantity"
                    disabled={!editable}
                    className="input"
                    type="number"
                    min="0"
                    step="0.5"
                    value={form.quantity}
                    onChange={event => setField("quantity", event.target.value)}
                    placeholder="1"
                  />
                </div>
              )}
              <div className="rounded-md bg-[#f4f7f6] px-3 py-2 text-[11px] text-[#60727a] sm:col-span-2">
                <Clock3 size={13} className="mr-1 inline" />
                Calculated duration: <b>{duration.toFixed(1)} hours</b>
                <span className="mx-2 text-[#bbc4c3]">|</span> Rate:{" "}
                <b>
                  {money(service?.rate ?? 0)}/
                  {(service?.unit ?? "hour").toLowerCase()}
                </b>
              </div>
            </div>
          </Panel>

          <Panel title="Progress note">
            <div className="p-5">
              <div className="mb-4 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]">
                <Info size={14} className="mr-1 inline" />
                <b>Good documentation is specific.</b> Record concrete actions,
                the participant’s response and the goal/outcome worked toward.
                Avoid vague statements such as “everything okay”.
              </div>
              <div className="space-y-4">
                {NOTE_SECTIONS.map(section => (
                  <div key={section}>
                    <label className="label" htmlFor={`field-${section}`}>
                      {NOTE_SECTION_LABELS[section]}{" "}
                      <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      id={`field-${section}`}
                      disabled={!editable}
                      className="textarea"
                      value={form[section]}
                      onChange={event => setField(section, event.target.value)}
                      placeholder={
                        section === "support"
                          ? "e.g. Supported the participant with community access to…"
                          : "Add clear, factual details…"
                      }
                      aria-invalid={Boolean(fieldErrors[section]) || undefined}
                    />
                    <FieldError message={fieldErrors[section]} />
                    <p className="field-help">{HELP[section]}</p>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <details
            className="panel"
            open={
              Boolean(form.voiceNoteId) ||
              Number(form.km) > 0 ||
              !form.confirmed
            }
          >
            <summary className="cursor-pointer list-none px-5 py-4 text-xs font-bold text-[#344854]">
              Travel, linked recording & declaration{" "}
              <ChevronDown size={14} className="ml-2 inline" />
            </summary>
            <div className="grid grid-cols-1 gap-4 border-t border-[#e9eeec] p-5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="record-km">
                  Transport kilometres
                </label>
                <input
                  id="record-km"
                  className="input"
                  disabled={!editable}
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.km}
                  onChange={event => setField("km", event.target.value)}
                />
                <p className="field-help">
                  {service?.transport
                    ? `Actual provider travel; billed at ${money(workspace.data?.providerTravelRate ?? 1)}/km as a separate line.`
                    : "This service does not include transport, so kilometres are not billed."}
                </p>
                <FieldError message={fieldErrors.km} />
              </div>
              <div>
                <label className="label" htmlFor="record-voice">
                  Linked voice recording
                </label>
                <select
                  id="record-voice"
                  className="select"
                  disabled={!editable}
                  value={form.voiceNoteId}
                  onChange={event =>
                    setField("voiceNoteId", event.target.value)
                  }
                >
                  <option value="">No linked recording</option>
                  {voiceChoices.map(voice => (
                    <option key={voice.id} value={voice.id}>
                      {voice.title} ({voice.id})
                    </option>
                  ))}
                </select>
                {linkedVoice?.draft && editable && (
                  <button
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#277c76]"
                    onClick={() => void applyVoiceDraft()}
                    disabled={busy}
                  >
                    <Sparkles size={12} />
                    Apply the recording’s draft to this note
                  </button>
                )}
                {form.voiceNoteId && (
                  <Link
                    href={`/app/voice/${form.voiceNoteId}`}
                    className="mt-2 block text-[11px] font-semibold text-[#277c76]"
                  >
                    Open recording
                  </Link>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2 text-xs text-[#53656e]">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={form.confirmed}
                    onChange={event =>
                      setField("confirmed", event.target.checked)
                    }
                    className="mt-0.5 accent-[#177d76]"
                  />
                  <span>
                    I confirm this record is accurate and reflects the support
                    provided during this service.
                  </span>
                </label>
              </div>
            </div>
          </details>
          <FormAlert message={error} />
        </div>

        <div className="space-y-5">
          <Panel title="Record summary">
            <div className="space-y-3 p-5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#829097]">Status</span>
                <Status value={record?.status ?? "Draft"} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#829097]">Created</span>
                <span>
                  {record ? formatDateTime(record.created) : "Not saved yet"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#829097]">Last updated</span>
                <span>{record ? formatDateTime(record.updated) : "—"}</span>
              </div>
              {record?.approvedBy && (
                <div className="flex justify-between">
                  <span className="text-[#829097]">Approved by</span>
                  <span>{record.approvedBy.name}</span>
                </div>
              )}
              <div className="divider" />
              <div className="font-semibold text-[#344854]">
                Billable breakdown
              </div>
              {billables.map((line, index) => (
                <div key={index} className="flex justify-between gap-2">
                  <span className="text-[#687982]">
                    {line.label}
                    <small className="block text-[10px]">
                      {line.quantity.toFixed(1)} {line.unit.toLowerCase()} ×{" "}
                      {money(line.rate)}
                    </small>
                  </span>
                  <span className="font-semibold">{money(line.subtotal)}</span>
                </div>
              ))}
              <div className="divider" />
              <div className="flex justify-between text-sm font-bold text-[#263b48]">
                <span>{editable ? "Estimated total" : "Total"}</span>
                <span>{money(total)}</span>
              </div>
              <p className="text-[10px] leading-4 text-[#8a969b]">
                {editable
                  ? "Estimate using current rates. Rates are fixed when the record is submitted; submitting does not create an invoice."
                  : "Billable lines were fixed when the record was submitted and are not affected by later rate changes."}
              </p>
            </div>
          </Panel>
          <Panel title="Workflow">
            <div className="space-y-3 p-5">
              {[
                ["Draft", "Write and save progress notes."],
                ["Submitted", "Send for review."],
                ["Reviewed", "Approved or returned with a reason."],
                ["Invoiced", "Approved records are added to an invoice."],
              ].map(([label, detail], index) => {
                const stage =
                  {
                    Draft: 0,
                    Returned: 0,
                    Submitted: 1,
                    Approved: 2,
                    Invoiced: 3,
                  }[record?.status ?? "Draft"] ?? 0;
                return (
                  <div className="flex gap-3" key={label}>
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] ${index <= stage ? "bg-[#dcece8] text-[#28776f]" : "bg-[#f0f3f2] text-[#869399]"}`}
                    >
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-[11px] font-semibold text-[#455963]">
                        {label}
                      </span>
                      <span className="text-[10px] text-[#8a969b]">
                        {detail}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
          {record?.invoiceId && (
            <Panel title="Invoice link">
              <div className="p-5 text-xs">
                <Link
                  href={`/app/invoices/${record.invoiceId}`}
                  className="font-semibold text-[#277c76]"
                >
                  {record.invoiceId}{" "}
                  <SquareArrowOutUpRight size={12} className="ml-1 inline" />
                </Link>
              </div>
            </Panel>
          )}
          {record && record.history.length > 0 && (
            <Panel
              title={
                <span className="inline-flex items-center gap-2">
                  <History size={14} />
                  History
                </span>
              }
            >
              <ol className="space-y-3 p-5">
                {[...record.history].reverse().map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="text-[11px]">
                    <b className="text-[#455963]">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </b>
                    <span className="block text-[10px] text-[#8a969b]">
                      {entry.by?.name ?? "System"} · {formatDateTime(entry.at)}
                    </span>
                    {entry.note && (
                      <span className="mt-0.5 block text-[10px] text-[#687982]">
                        {entry.note}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>

      <div className="sticky-action mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#e3e9e6] bg-white p-3">
        <span className="text-[10px] text-[#829097]">
          {editable
            ? dirty
              ? "Unsaved changes"
              : "All changes saved"
            : `Locked · ${record?.status}`}{" "}
          {editable && !dirty ? (
            <Check size={12} className="ml-1 inline text-[#43947f]" />
          ) : editable ? (
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#df9e41]" />
          ) : null}
          {record && <span className="ml-2">· {prettyDate(record.date)}</span>}
        </span>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              {record?.status === "Draft" && (
                <Btn
                  variant="quiet"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  <Trash2 size={14} />
                  Delete draft
                </Btn>
              )}
              <Btn
                variant="secondary"
                onClick={() => void saveDraft()}
                loading={create.isPending || update.isPending}
                disabled={action.isPending}
              >
                Save draft
              </Btn>
              <Btn
                disabled={!form.support.trim() || busy}
                loading={action.isPending}
                onClick={() => void submit()}
              >
                Submit for review <ArrowRight size={14} />
              </Btn>
            </>
          ) : (
            <Btn variant="secondary" onClick={() => navigate(backHref)}>
              Back to client
            </Btn>
          )}
        </div>
      </div>

      {confirmDelete && record && (
        <ConfirmModal
          title={`Delete draft ${record.id}?`}
          body="This draft and its unsent notes are removed. The deletion is recorded in the audit log."
          confirmLabel="Delete draft"
          danger
          busy={remove.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            remove.mutate(record.id, {
              onSuccess: () => {
                setDirty(false);
                notify(`${record.id} deleted.`);
                navigate(backHref);
              },
              onError: failure => notify(errorMessage(failure), "error"),
            })
          }
        />
      )}
    </>
  );
}
