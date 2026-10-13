import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  History,
  Info,
  PenLine,
  Printer,
  RotateCcw,
  Sparkles,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { DEFAULT_TRAVEL_RATE_CENTS } from "@shared/const";
import type { ServiceRecordDTO } from "@shared/dto";
import { computeBillables } from "@shared/logic/billing";
import { fromCents, toCents } from "@shared/logic/money";
import {
  EMPTY_NOTE,
  NOTE_FIELDS,
  noteProblems,
  type NoteContent,
} from "@shared/logic/progress-note";
import { MESSAGES } from "@shared/messages";
import type { RecordCreateInput } from "@shared/schemas/records";
import { ApiError, downloadFile, errorMessage, openFile } from "@/api/client";
import {
  useAmendRecord,
  useCreateRecord,
  useDeclineAmendment,
  useDeleteRecord,
  useMeta,
  useParticipants,
  useRecord,
  useRecordAction,
  useServices,
  useShifts,
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
import { NoteFlags, NoteForm } from "./NoteForm";

interface FormState extends NoteContent {
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
  /** The rostered shift this note is written against. Only chosen when the record is created. */
  shiftId: string;
}

const noteOf = (source: NoteContent): NoteContent =>
  Object.fromEntries(
    NOTE_FIELDS.map(field => [field, source[field]])
  ) as unknown as NoteContent;
/** The same note as the API takes it: the ticked options are checked there against the fixed lists. */
const noteInput = (source: NoteContent) =>
  noteOf(source) as Pick<RecordCreateInput, keyof NoteContent>;

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
    shiftId: record.shiftId ?? "",
    ...noteOf(record),
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
  amended: "Note amended",
  amendment_requested: "Amendment requested",
  amendment_declined: "Amendment request declined",
};

export default function RecordEditorPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  const query = new URLSearchParams(useSearch());
  const presetClient = query.get("clientId") ?? undefined;
  const sourceVoiceId = query.get("voiceId") ?? undefined;
  /** Coming from a shift that still needs its note: the shift and its day are already known. */
  const presetShift = query.get("shiftId") ?? "";
  const presetDate = query.get("date") ?? "";
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
  const amend = useAmendRecord();
  const decline = useDeclineAmendment();

  const [form, setForm] = useState<FormState | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  /** Correcting a submitted note: the note opens for editing, with a reason, and nothing else does. */
  const [amending, setAmending] = useState(false);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState("");
  const [declining, setDeclining] = useState<{
    id: string;
    note: string;
  } | null>(null);
  const record = recordQuery.data;
  const voiceNotes = useVoiceNotes({ clientId: form?.clientId, status: "all" });
  const shifts = useShifts(
    {
      from: form?.date ?? "",
      to: form?.date ?? "",
      clientId: form?.clientId,
    },
    { enabled: !id && Boolean(form?.date && form?.clientId) }
  );

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
      date: presetDate || meta.data.today,
      start: "09:00",
      end: "11:00",
      location: "",
      km: "0",
      quantity: "",
      confirmed: false,
      voiceNoteId: voice?.id ?? "",
      shiftId: "",
      ...EMPTY_NOTE,
      // A recording's draft has five sections; its response and observations are the shift summary.
      support: draft?.support ?? "",
      summary: [draft?.response, draft?.observations]
        .filter(Boolean)
        .join("\n\n"),
      outcome: draft?.outcome ?? "",
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
    presetDate,
  ]);

  const shiftChoices = (shifts.data ?? []).filter(
    shift => shift.status !== "Cancelled"
  );
  /** Takes the worker, service, times and place from the roster, so they are not typed twice. */
  const applyShift = (shiftId: string) => {
    const shift = shiftChoices.find(item => item.id === shiftId);
    setForm(current =>
      current
        ? {
            ...current,
            shiftId,
            ...(shift
              ? {
                  staffId: shift.staffIds[0] ?? current.staffId,
                  serviceId: shift.serviceId,
                  start: shift.start,
                  end: shift.end,
                  location: shift.location || current.location,
                }
              : {}),
          }
        : current
    );
    setDirty(true);
  };
  const presetReady =
    !id &&
    Boolean(presetShift) &&
    form?.shiftId === "" &&
    shiftChoices.some(shift => shift.id === presetShift);
  useEffect(() => {
    if (presetReady) applyShift(presetShift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetReady]);

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
  const noteOpen = editable || amending;
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
      toCents(
        workspace.data?.providerTravelRate ?? DEFAULT_TRAVEL_RATE_CENTS / 100
      )
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
  const busy =
    create.isPending || update.isPending || action.isPending || amend.isPending;
  const participant = participants.data.items.find(
    person => person.id === form.clientId
  );
  const openRequests = (record?.amendmentRequests ?? []).filter(
    request => request.status === "Open"
  );
  const backHref = `/app/clients/${form.clientId}/records`;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setFieldErrors(errors => ({ ...errors, [key]: "" }));
  };

  const setNote = <K extends keyof NoteContent>(
    key: K,
    value: NoteContent[K]
  ) => {
    setForm(current => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setFieldErrors(errors => ({ ...errors, [key]: "" }));
  };

  /** Clears the written-up part of the record so the user can start the note again; the shift facts above it (who, what, when) are left alone. */
  const resetNote = () => {
    setForm(current =>
      current
        ? { ...current, ...EMPTY_NOTE, km: "0", voiceNoteId: "", confirmed: false }
        : current
    );
    setDirty(true);
    setFieldErrors({});
    setConfirmReset(false);
    notify("Note cleared. Save draft once you're ready.");
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
    ...noteInput(form),
  });

  const handleError = (failure: unknown) => {
    if (failure instanceof ApiError) setFieldErrors(failure.fieldErrors());
    setError(errorMessage(failure));
    notify(errorMessage(failure), "error");
  };

  const save = async (): Promise<ServiceRecordDTO> => {
    setError("");
    if (!id) {
      const created = await create.mutateAsync({
        ...payload(),
        shiftId: form.shiftId || null,
      });
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
    const problems = noteProblems(noteOf(form));
    if (!form.confirmed) return notify(MESSAGES.declaration, "error");
    if (problems.length) {
      setFieldErrors(
        Object.fromEntries(
          problems.map(problem => [problem.path, problem.message])
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

  const startAmending = (answering = "") => {
    setForm(fromRecord(record!));
    setReason("");
    setRequestId(answering);
    setFieldErrors({});
    setError("");
    setAmending(true);
  };
  const stopAmending = () => {
    setForm(fromRecord(record!));
    setAmending(false);
    setDirty(false);
    setFieldErrors({});
    setError("");
  };
  const saveAmendment = async () => {
    setError("");
    if (!reason.trim()) {
      setFieldErrors({ reason: "Say why the note is being amended." });
      return;
    }
    try {
      const updated = await amend.mutateAsync({
        id: record!.id,
        rev: record!.rev,
        reason: reason.trim(),
        requestId: requestId || undefined,
        ...noteInput(form),
      });
      setForm(fromRecord(updated));
      setAmending(false);
      setDirty(false);
      notify(
        "Amendment saved. The earlier wording is kept in the note's history."
      );
    } catch (failure) {
      handleError(failure);
    }
  };
  const declineRequest = async () => {
    if (!declining) return;
    try {
      await decline.mutateAsync({
        id: record!.id,
        requestId: declining.id,
        note: declining.note.trim() || undefined,
      });
      setDeclining(null);
      notify("Request declined. The worker can see your reply.");
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };
  const pdfPath = `/service-records/${id}/pdf`;
  const exportPdf = async (print: boolean) => {
    try {
      if (print) await openFile(pdfPath);
      else
        await downloadFile(pdfPath, `progress-note-${id}.pdf`, { download: 1 });
    } catch (failure) {
      notify(errorMessage(failure), "error");
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
            <span className="flex flex-wrap items-center gap-1.5">
              <NoteFlags record={record} />
              <Status value={record.status} />
            </span>
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
          A mistake in the note is corrected with <b>Amend note</b>, which keeps
          the earlier wording and your reason.
        </div>
      )}
      {amending && (
        <div className="mb-4 rounded-md border border-[#d8cdf0] bg-[#f6f2fd] p-4">
          <div className="text-xs font-bold text-[#4e3d86]">
            <PenLine size={13} className="mr-1 inline" />
            Amending a submitted note
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[#5f5489]">
            Change the sections below. The shift details and billing stay as
            they are. What each section said before is kept with your name, the
            time and this reason.
          </p>
          {openRequests.length > 0 && (
            <div className="mt-3">
              <label className="label" htmlFor="amend-request">
                Answering a request
              </label>
              <select
                id="amend-request"
                className="select"
                value={requestId}
                onChange={event => setRequestId(event.target.value)}
              >
                <option value="">Not answering a request</option>
                {openRequests.map(request => (
                  <option key={request.id} value={request.id}>
                    {request.by?.name ?? "Worker"}:{" "}
                    {request.reason.slice(0, 80)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="label mt-3" htmlFor="amend-reason">
            Reason for the amendment <span className="text-red-600">*</span>
          </label>
          <textarea
            id="amend-reason"
            className="textarea"
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={event => {
              setReason(event.target.value);
              setFieldErrors(errors => ({ ...errors, reason: "" }));
            }}
            placeholder="e.g. The worker reported the wrong time for the appointment."
          />
          <FieldError message={fieldErrors.reason} />
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
          <Panel title="Shift information">
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              {!id && shiftChoices.length > 0 && (
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="record-shift">
                    Rostered shift
                  </label>
                  <select
                    id="record-shift"
                    className="select"
                    value={form.shiftId}
                    onChange={event => applyShift(event.target.value)}
                  >
                    <option value="">Not linked to a rostered shift</option>
                    {shiftChoices.map(shift => (
                      <option key={shift.id} value={shift.id}>
                        {shift.start}–{shift.end} · {shift.type} ·{" "}
                        {shift.staff.map(member => member.name).join(", ") ||
                          "Unassigned"}
                      </option>
                    ))}
                  </select>
                  <p className="field-help">
                    Choosing the shift fills in the worker, the service and the
                    times from the roster and links this note to it.
                  </p>
                </div>
              )}
              {record?.shiftId && (
                <div className="rounded-md bg-[#f4f7f6] px-3 py-2 text-[11px] text-[#60727a] sm:col-span-2">
                  Linked to rostered shift <b>{record.shiftId}</b>.
                </div>
              )}
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
              {noteOpen && (
                <div className="mb-4 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]">
                  <Info size={14} className="mr-1 inline" />
                  <b>Good documentation is specific.</b> Record concrete
                  actions, the participant’s choices and the goal worked toward.
                  Avoid vague statements such as “everything okay”.
                </div>
              )}
              <NoteForm
                variant="office"
                value={noteOf(form)}
                onChange={setNote}
                errors={fieldErrors}
                disabled={!noteOpen}
                incidentAction={
                  <Link
                    href="/app/worker-reports"
                    className="font-semibold text-[#7a5a14] underline"
                  >
                    Open worker reports
                  </Link>
                }
              />
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
                    ? `Actual provider travel; billed at ${money(
                        workspace.data?.providerTravelRate ??
                          DEFAULT_TRAVEL_RATE_CENTS / 100
                      )}/km as a separate line.`
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
          {record && record.amendmentRequests.length > 0 && (
            <Panel title="Amendment requests">
              <ul className="space-y-3 p-5">
                {[...record.amendmentRequests].reverse().map(request => (
                  <li key={request.id} className="text-[11px]">
                    <div className="flex items-start justify-between gap-2">
                      <b className="text-[#455963]">
                        {request.by?.name ?? "Worker"}
                      </b>
                      <Status
                        value={
                          request.status === "Open"
                            ? "Submitted"
                            : request.status === "Applied"
                              ? "Approved"
                              : "Returned"
                        }
                        label={request.status}
                      />
                    </div>
                    <span className="block text-[10px] text-[#8a969b]">
                      {formatDateTime(request.at)}
                    </span>
                    <p className="mt-1 leading-4 text-[#586b73]">
                      {request.reason}
                    </p>
                    {request.status !== "Open" && request.resolution && (
                      <p className="mt-1 text-[10px] leading-4 text-[#7c8a90]">
                        {request.resolvedBy?.name ?? "Office"}:{" "}
                        {request.resolution}
                      </p>
                    )}
                    {request.status === "Open" &&
                      (declining?.id === request.id ? (
                        <div className="mt-2">
                          <textarea
                            className="textarea"
                            rows={2}
                            maxLength={500}
                            aria-label="Reply to the worker"
                            placeholder="Why the note stays as it is (the worker sees this)"
                            value={declining.note}
                            onChange={event =>
                              setDeclining({
                                id: request.id,
                                note: event.target.value,
                              })
                            }
                          />
                          <div className="mt-2 flex gap-2">
                            <Btn
                              variant="danger"
                              loading={decline.isPending}
                              onClick={() => void declineRequest()}
                            >
                              Decline request
                            </Btn>
                            <Btn
                              variant="quiet"
                              onClick={() => setDeclining(null)}
                            >
                              Cancel
                            </Btn>
                          </div>
                        </div>
                      ) : (
                        !amending && (
                          <div className="mt-2 flex gap-2">
                            <Btn onClick={() => startAmending(request.id)}>
                              Amend now
                            </Btn>
                            <Btn
                              variant="secondary"
                              onClick={() =>
                                setDeclining({ id: request.id, note: "" })
                              }
                            >
                              Decline
                            </Btn>
                          </div>
                        )
                      ))}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {record && record.amendments.length > 0 && (
            <Panel title={`Amendments (${record.amendments.length})`}>
              <ol className="space-y-4 p-5">
                {[...record.amendments].reverse().map(amendment => (
                  <li key={amendment.id} className="text-[11px]">
                    <b className="text-[#455963]">
                      {amendment.by?.name ?? "Unknown"}
                    </b>
                    <span className="block text-[10px] text-[#8a969b]">
                      {formatDateTime(amendment.at)}
                    </span>
                    <p className="mt-1 leading-4 text-[#586b73]">
                      <span className="font-semibold">Reason:</span>{" "}
                      {amendment.reason}
                    </p>
                    {amendment.changes.map(change => (
                      <div
                        key={change.field}
                        className="mt-2 rounded-md bg-[#f6f8f7] p-2 text-[10px] leading-4"
                      >
                        <div className="font-semibold text-[#455963]">
                          {change.label}
                        </div>
                        <div className="text-[#9a6a64] line-through">
                          {change.before || "(empty)"}
                        </div>
                        <div className="text-[#2f6b55]">
                          {change.after || "(empty)"}
                        </div>
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
          {record?.relatedReports && record.relatedReports.length > 0 && (
            <Panel title="Reports for this shift">
              <ul className="space-y-2 p-5 text-[11px]">
                {record.relatedReports.map(report => (
                  <li key={`${report.kind}-${report.id}`}>
                    <Link
                      href={`/app/worker-reports/${report.kind === "abc" ? "abc" : "incidents"}`}
                      className="font-semibold text-[#277c76]"
                    >
                      {report.kind === "abc"
                        ? "Behaviour (ABC) report"
                        : "Incident report"}
                    </Link>
                    <span className="block text-[10px] text-[#8a969b]">
                      {report.summary} · {report.status} ·{" "}
                      {prettyDate(report.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
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
                variant="quiet"
                onClick={() => setConfirmReset(true)}
                disabled={busy}
              >
                <RotateCcw size={14} />
                Reset note
              </Btn>
              <Btn
                variant="secondary"
                onClick={() => void saveDraft()}
                loading={create.isPending || update.isPending}
                disabled={action.isPending}
              >
                Save draft
              </Btn>
              <Btn
                disabled={busy}
                loading={action.isPending}
                onClick={() => void submit()}
              >
                Submit for review <ArrowRight size={14} />
              </Btn>
            </>
          ) : amending ? (
            <>
              <Btn variant="quiet" onClick={stopAmending} disabled={busy}>
                Cancel
              </Btn>
              <Btn
                loading={amend.isPending}
                onClick={() => void saveAmendment()}
              >
                <PenLine size={14} /> Save amendment
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="secondary" onClick={() => navigate(backHref)}>
                Back to client
              </Btn>
              <Btn variant="secondary" onClick={() => void exportPdf(true)}>
                <Printer size={14} /> Print
              </Btn>
              <Btn variant="secondary" onClick={() => void exportPdf(false)}>
                <Download size={14} /> PDF
              </Btn>
              <Btn onClick={() => startAmending()}>
                <PenLine size={14} /> Amend note
              </Btn>
            </>
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

      {confirmReset && (
        <ConfirmModal
          title="Reset this note?"
          body="Support provided, the shift summary, health, incidents, handover, travel kilometres, the linked recording and the declaration are all cleared so you can start the note afresh. The participant, staff member, service, date and times above are not affected. Nothing is deleted until you save."
          confirmLabel="Reset note"
          danger
          onClose={() => setConfirmReset(false)}
          onConfirm={resetNote}
        />
      )}
    </>
  );
}
