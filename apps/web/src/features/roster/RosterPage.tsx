import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  MapPin,
  MessagesSquare,
  Plus,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { RosterShiftDTO } from "@shared/dto";
import type { ShiftRatio, ShiftStatus } from "@shared/enums";
import { ratioError } from "@shared/logic/roster";
import { addDays, durationHours, startOfWeek } from "@shared/logic/time";
import { errorMessage } from "@/api/client";
import {
  useCreateShift,
  useDeleteShift,
  useMeta,
  useParticipants,
  useRecordsFromShift,
  useServices,
  useShiftStatus,
  useShifts,
  useShiftValidation,
  useStaff,
  useUpdateShift,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  Drawer,
  ErrorBlock,
  LoadingBlock,
  Panel,
  useDebounced,
} from "@/components/app/ui";
import { useNotify } from "@/lib/notify";

interface Draft {
  id?: string;
  rev?: number;
  status?: ShiftStatus;
  recordIds?: string[];
  date: string;
  start: string;
  end: string;
  ratio: ShiftRatio;
  clientIds: string[];
  staffIds: string[];
  serviceId: string;
  location: string;
  notes: string;
}

const RATIO_BADGE: Record<ShiftRatio, string> = {
  "1:1": "badge-approved",
  "1:M": "badge-submitted",
  "M:M": "badge-returned",
};
const STATUS_TEXT: Record<ShiftStatus, string> = {
  Confirmed: "text-[#33785d]",
  Completed: "text-[#77858b]",
  Planned: "text-[#9a6f25]",
  Cancelled: "text-[#a84540]",
};

function dayLabel(ymd: string) {
  const date = new Date(`${ymd}T00:00:00Z`);
  return {
    weekday: date.toLocaleDateString("en-AU", {
      weekday: "short",
      timeZone: "UTC",
    }),
    day: date.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
  };
}

function ShiftDrawer({
  initial,
  onClose,
}: {
  initial: Draft;
  onClose: () => void;
}) {
  const notify = useNotify();
  const [, navigate] = useLocation();
  const participants = useParticipants({ status: "Active" });
  const staff = useStaff({ status: "all" });
  const services = useServices({ active: "all" });
  const create = useCreateShift();
  const update = useUpdateShift();
  const setStatus = useShiftStatus();
  const remove = useDeleteShift();
  const makeRecords = useRecordsFromShift();
  const [draft, setDraft] = useState<Draft>(initial);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = Boolean(initial.id);
  const locked = initial.status === "Completed";
  const hours = durationHours(draft.start, draft.end);

  const activeClients = participants.data?.items ?? [];
  const activeStaff = (staff.data ?? []).filter(
    member => member.status === "Active" || draft.staffIds.includes(member.id)
  );
  const serviceChoices = (services.data ?? []).filter(
    service => service.active || service.id === draft.serviceId
  );

  // Live server-side validation (overlaps, ratio rules and budget impact) while the draft changes.
  const validationInput = useDebounced(
    draft.clientIds.length &&
      draft.staffIds.length &&
      draft.serviceId &&
      draft.date &&
      !locked
      ? {
          id: draft.id,
          date: draft.date,
          start: draft.start,
          end: draft.end,
          ratio: draft.ratio,
          clientIds: draft.clientIds,
          staffIds: draft.staffIds,
          serviceId: draft.serviceId,
          location: draft.location,
          notes: draft.notes,
        }
      : null,
    400
  );
  const validation = useShiftValidation(validationInput);

  const changeRatio = (ratio: ShiftRatio) =>
    setDraft(current => {
      const nextClient = activeClients.find(
        person => !current.clientIds.includes(person.id)
      )?.id;
      const nextStaff = activeStaff.find(
        person => !current.staffIds.includes(person.id)
      )?.id;
      if (ratio === "1:1")
        return {
          ...current,
          ratio,
          clientIds: current.clientIds.slice(0, 1),
          staffIds: current.staffIds.slice(0, 1),
        };
      if (ratio === "1:M")
        return {
          ...current,
          ratio,
          clientIds:
            current.clientIds.length >= 2
              ? current.clientIds
              : [...current.clientIds, ...(nextClient ? [nextClient] : [])],
          staffIds: current.staffIds.slice(0, 1),
        };
      return {
        ...current,
        ratio,
        clientIds:
          current.clientIds.length >= 2
            ? current.clientIds
            : [...current.clientIds, ...(nextClient ? [nextClient] : [])],
        staffIds:
          current.staffIds.length >= 2
            ? current.staffIds
            : [...current.staffIds, ...(nextStaff ? [nextStaff] : [])],
      };
    });
  const toggle = (
    kind: "clientIds" | "staffIds",
    id: string,
    checked: boolean
  ) =>
    setDraft(current => ({
      ...current,
      [kind]: checked
        ? [...current[kind], id]
        : current[kind].filter(item => item !== id),
    }));

  const save = async () => {
    setFormError("");
    if (!draft.date || hours <= 0)
      return setFormError(
        "Choose a date and an end time later than the start time."
      );
    const ratio = ratioError(
      draft.ratio,
      draft.clientIds.length,
      draft.staffIds.length
    );
    if (ratio) return setFormError(ratio);
    const body = {
      date: draft.date,
      start: draft.start,
      end: draft.end,
      ratio: draft.ratio,
      clientIds: draft.clientIds,
      staffIds: draft.staffIds,
      serviceId: draft.serviceId,
      location: draft.location,
      notes: draft.notes,
    };
    try {
      const saved = editing
        ? await update.mutateAsync({ id: draft.id!, rev: draft.rev, ...body })
        : await create.mutateAsync(body);
      notify(
        editing
          ? `${saved.id} updated in the roster.`
          : `${saved.id} added as a planned shift.`
      );
      if (saved.warnings.length)
        setTimeout(() => notify(saved.warnings.join(" "), "info"), 400);
      onClose();
    } catch (failure) {
      setFormError(errorMessage(failure));
    }
  };

  const changeStatus = async (status: ShiftStatus) => {
    setFormError("");
    try {
      await setStatus.mutateAsync({ id: draft.id!, status, rev: draft.rev });
      notify(`${draft.id} marked ${status.toLowerCase()}.`);
      onClose();
    } catch (failure) {
      setFormError(errorMessage(failure));
    }
  };

  const busy =
    create.isPending ||
    update.isPending ||
    setStatus.isPending ||
    remove.isPending ||
    makeRecords.isPending;
  const statusActions: Array<{ status: ShiftStatus; label: string }> =
    initial.status === "Planned"
      ? [
          { status: "Confirmed", label: "Confirm" },
          { status: "Completed", label: "Mark completed" },
          { status: "Cancelled", label: "Cancel shift" },
        ]
      : initial.status === "Confirmed"
        ? [
            { status: "Planned", label: "Back to planned" },
            { status: "Completed", label: "Mark completed" },
            { status: "Cancelled", label: "Cancel shift" },
          ]
        : initial.status === "Cancelled"
          ? [{ status: "Planned", label: "Restore shift" }]
          : [];

  return (
    <Drawer
      wide
      onClose={onClose}
      eyebrow={
        <span className="flex items-center gap-2 font-bold text-[#538880]">
          <CalendarDays size={13} />
          Roster planner
        </span>
      }
      title={
        <span className="serif text-2xl font-normal text-[#243d49]">
          {editing
            ? `Shift ${initial.id} · ${initial.status}`
            : "Create a flexible shift"}
        </span>
      }
      subtitle={
        locked
          ? "Completed shifts are locked. Create the service records for each participant from here."
          : "Assign clients and staff, check ratio rules, then save the planned shift."
      }
      footer={
        <>
          {formError && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-[#efd0ce] bg-[#fff3f1] p-3 text-[11px] leading-4 text-[#9e4943]"
            >
              <ShieldAlert size={14} className="mr-1 inline" />
              {formError}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {editing &&
                statusActions.map(item => (
                  <Btn
                    key={item.status}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void changeStatus(item.status)}
                  >
                    {item.label}
                  </Btn>
                ))}
              {editing && (
                <Btn
                  variant="quiet"
                  disabled={busy}
                  title="Start a conversation with the workers rostered on this shift"
                  onClick={() => navigate(`/app/messages?shift=${initial.id}`)}
                >
                  <MessagesSquare size={14} />
                  Message the workers
                </Btn>
              )}
              {editing &&
                (initial.status === "Planned" ||
                  initial.status === "Cancelled") &&
                !initial.recordIds?.length && (
                  <Btn
                    variant="quiet"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={14} />
                    Delete
                  </Btn>
                )}
            </div>
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={onClose}>
                Close
              </Btn>
              {locked ? (
                <Btn
                  loading={makeRecords.isPending}
                  onClick={() =>
                    makeRecords.mutate(initial.id!, {
                      onSuccess: records => {
                        notify(
                          records.length
                            ? `Created ${records.length} draft service record${records.length === 1 ? "" : "s"}.`
                            : "Every participant on this shift already has a record."
                        );
                        onClose();
                        if (records.length === 1)
                          navigate(`/app/records/${records[0].id}`);
                      },
                      onError: failure => setFormError(errorMessage(failure)),
                    })
                  }
                >
                  <ClipboardList size={14} />
                  Create service records
                </Btn>
              ) : (
                <Btn
                  onClick={() => void save()}
                  loading={create.isPending || update.isPending}
                >
                  <Check size={14} />
                  {editing ? "Update shift" : "Save planned shift"}
                </Btn>
              )}
            </div>
          </div>
        </>
      }
    >
      {participants.isPending || staff.isPending || services.isPending ? (
        <LoadingBlock />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_1fr_280px]">
          <fieldset className="space-y-4" disabled={locked}>
            <div className="grid grid-cols-2 gap-3">
              <label className="label">
                Date
                <input
                  className="input mt-1"
                  type="date"
                  value={draft.date}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label">
                Staffing ratio
                <select
                  className="select mt-1"
                  value={draft.ratio}
                  onChange={event =>
                    changeRatio(event.target.value as ShiftRatio)
                  }
                >
                  <option value="1:1">1:1 · individual</option>
                  <option value="1:M">1:M · shared staff</option>
                  <option value="M:M">M:M · shared team</option>
                </select>
              </label>
              <label className="label">
                Start time
                <input
                  className="input mt-1"
                  type="time"
                  value={draft.start}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      start: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="label">
                End time
                <input
                  className="input mt-1"
                  type="time"
                  value={draft.end}
                  onChange={event =>
                    setDraft(current => ({
                      ...current,
                      end: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="label">
              Support type
              <select
                className="select mt-1"
                value={draft.serviceId}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    serviceId: event.target.value,
                  }))
                }
              >
                {serviceChoices.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              Location
              <input
                className="input mt-1"
                value={draft.location}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
                placeholder="e.g. Community centre or participant home"
              />
            </label>
            <label className="label">
              Notes
              <textarea
                className="textarea mt-1 !min-h-[60px]"
                value={draft.notes}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Meeting point, what to bring…"
              />
            </label>
          </fieldset>
          <fieldset
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1"
            disabled={locked}
          >
            <div>
              <div className="label">
                Participants{" "}
                <span className="font-normal text-[#839097]">
                  ({draft.clientIds.length} selected)
                </span>
              </div>
              <div className="max-h-[210px] space-y-2 overflow-y-auto rounded-md border border-[#e4eae7] bg-white p-3">
                {activeClients.map(person => (
                  <label
                    key={person.id}
                    className="flex items-center gap-2 text-xs text-[#4e626b]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.clientIds.includes(person.id)}
                      onChange={event =>
                        toggle("clientIds", person.id, event.target.checked)
                      }
                      className="accent-[#147f79]"
                    />
                    {person.name}
                    <span className="ml-auto text-[10px] text-[#91a0a4]">
                      {person.preferred}
                    </span>
                  </label>
                ))}
                {!activeClients.length && (
                  <p className="text-[11px] text-[#87949a]">
                    No active participants.
                  </p>
                )}
              </div>
            </div>
            <div>
              <div className="label">
                Available staff{" "}
                <span className="font-normal text-[#839097]">
                  ({draft.staffIds.length} selected)
                </span>
              </div>
              <div className="max-h-[210px] space-y-2 overflow-y-auto rounded-md border border-[#e4eae7] bg-white p-3">
                {activeStaff.map(person => (
                  <label
                    key={person.id}
                    className="flex items-center gap-2 text-xs text-[#4e626b]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.staffIds.includes(person.id)}
                      onChange={event =>
                        toggle("staffIds", person.id, event.target.checked)
                      }
                      className="accent-[#147f79]"
                    />
                    {person.name}
                    <span className="ml-auto text-[10px] text-[#91a0a4]">
                      {person.status === "Active"
                        ? person.position
                        : person.status}
                    </span>
                  </label>
                ))}
              </div>
              <p className="field-help">
                Staff on leave or inactive can't be assigned.
              </p>
            </div>
          </fieldset>
          <div className="space-y-4">
            <div className="rounded-md border border-[#dce9e5] bg-[#f2f8f6] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#38665f]">
                <Clock3 size={14} />
                Assignment summary
              </div>
              <div className="mt-3 flex justify-between text-[11px] text-[#64787f]">
                <span>Duration</span>
                <b>{hours.toFixed(1)} hours</b>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-[#64787f]">
                <span>Staffing ratio</span>
                <b>
                  {draft.staffIds.length} staff · {draft.clientIds.length}{" "}
                  clients
                </b>
              </div>
            </div>
            {!locked &&
              validation.data &&
              (validation.data.errors.length > 0 ||
                validation.data.warnings.length > 0) && (
                <div className="space-y-2">
                  {validation.data.errors.map(message => (
                    <div
                      key={message}
                      className="rounded-md border border-[#efd0ce] bg-[#fff3f1] p-3 text-[10px] leading-4 text-[#9e4943]"
                    >
                      <ShieldAlert size={12} className="mr-1 inline" />
                      {message}
                    </div>
                  ))}
                  {validation.data.warnings.map(message => (
                    <div
                      key={message}
                      className="rounded-md border border-[#f0dcb4] bg-[#fff8ea] p-3 text-[10px] leading-4 text-[#8a6424]"
                    >
                      <AlertTriangle size={12} className="mr-1 inline" />
                      {message}
                    </div>
                  ))}
                </div>
              )}
            <div className="rounded-md border border-[#e6ece9] bg-white p-4 text-[10px] leading-4 text-[#77878b]">
              <b className="text-[#4c6068]">Ratio guide</b>
              <p className="mt-2">
                <b>1:1</b> · one staff member to one client
              </p>
              <p className="mt-1">
                <b>1:M</b> · one staff member to multiple clients
              </p>
              <p className="mt-1">
                <b>M:M</b> · multiple staff supporting multiple clients
              </p>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${initial.id}?`}
          body="The shift is removed from the roster. This is recorded in the audit log."
          confirmLabel="Delete shift"
          danger
          busy={remove.isPending}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            remove.mutate(initial.id!, {
              onSuccess: () => {
                notify(`${initial.id} deleted.`);
                onClose();
              },
              onError: failure => {
                setConfirmDelete(false);
                setFormError(errorMessage(failure));
              },
            })
          }
        />
      )}
    </Drawer>
  );
}

export default function RosterPage() {
  const meta = useMeta();
  const staff = useStaff({ status: "assignable" });
  const participants = useParticipants({ status: "Active" });
  const services = useServices({ active: "true" });
  const today = meta.data?.today ?? new Date().toISOString().slice(0, 10);
  const [weekOffset, setWeekOffset] = useState(0);
  const [ratioFilter, setRatioFilter] = useState("All ratios");
  const [drawer, setDrawer] = useState<Draft | null>(null);
  const monday = addDays(startOfWeek(today), weekOffset * 7);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(monday, index)),
    [monday]
  );
  const shifts = useShifts({ from: days[0], to: days[6] });
  const all = shifts.data ?? [];
  const visible =
    ratioFilter === "All ratios"
      ? all
      : all.filter(shift => shift.ratio === ratioFilter);
  const scheduled = all.filter(shift => shift.status !== "Cancelled");
  const staffHours = scheduled.reduce(
    (sum, shift) => sum + shift.hours * shift.staffIds.length,
    0
  );
  const participantCount = new Set(scheduled.flatMap(shift => shift.clientIds))
    .size;

  const startCreate = () =>
    setDrawer({
      date: today < days[0] || today > days[6] ? days[0] : today,
      start: "09:00",
      end: "11:00",
      ratio: "1:1",
      clientIds: participants.data?.items[0]
        ? [participants.data.items[0].id]
        : [],
      staffIds: staff.data?.[0] ? [staff.data[0].id] : [],
      serviceId: services.data?.[0]?.id ?? "",
      location: "",
      notes: "",
    });
  const startEdit = (shift: RosterShiftDTO) =>
    setDrawer({
      id: shift.id,
      rev: shift.rev,
      status: shift.status,
      recordIds: shift.recordIds,
      date: shift.date,
      start: shift.start,
      end: shift.end,
      ratio: shift.ratio,
      clientIds: [...shift.clientIds],
      staffIds: [...shift.staffIds],
      serviceId: shift.serviceId,
      location: shift.location,
      notes: shift.notes,
    });
  const first = dayLabel(days[0]);
  const last = dayLabel(days[6]);
  const canCreate = Boolean(
    participants.data?.items.length &&
      staff.data?.length &&
      services.data?.length
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title serif">Flexible rostering</h1>
          <p className="page-subtitle">
            Plan individual and shared supports with visible
            participant-to-staff ratios.
          </p>
        </div>
        <Btn
          onClick={startCreate}
          disabled={!canCreate}
          title={
            canCreate
              ? undefined
              : "Add participants, active staff and services first"
          }
        >
          <Plus size={15} />
          Create shift
        </Btn>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-3">
        <div className="panel p-4">
          <span className="text-[10px] text-[#829097]">Shifts this week</span>
          <div className="stat-number mt-1">{scheduled.length}</div>
        </div>
        <div className="panel p-4">
          <span className="text-[10px] text-[#829097]">
            Participants rostered
          </span>
          <div className="stat-number mt-1">{participantCount}</div>
        </div>
        <div className="panel p-4">
          <span className="text-[10px] text-[#829097]">
            Staff hours scheduled
          </span>
          <div className="stat-number mt-1">
            {staffHours.toFixed(1)}
            <span className="ml-1 text-xs font-medium text-[#819097]">hrs</span>
          </div>
        </div>
      </div>
      {shifts.isError && (
        <ErrorBlock error={shifts.error} onRetry={() => shifts.refetch()} />
      )}
      <Panel
        className="mb-5"
        title="Roster board"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="select h-8 w-[130px] py-1 text-[10px]"
              value={ratioFilter}
              onChange={event => setRatioFilter(event.target.value)}
              aria-label="Filter staffing ratio"
            >
              <option>All ratios</option>
              <option>1:1</option>
              <option>1:M</option>
              <option>M:M</option>
            </select>
            <Btn
              variant="quiet"
              className="!h-8 !px-2"
              onClick={() => setWeekOffset(value => value - 1)}
              ariaLabel="Previous week"
            >
              <ArrowLeft size={15} />
            </Btn>
            {weekOffset !== 0 && (
              <Btn
                variant="quiet"
                className="!h-8 !px-2 text-[10px]"
                onClick={() => setWeekOffset(0)}
              >
                This week
              </Btn>
            )}
            <Btn
              variant="quiet"
              className="!h-8 !px-2"
              onClick={() => setWeekOffset(value => value + 1)}
              ariaLabel="Next week"
            >
              <ArrowRight size={15} />
            </Btn>
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0ef] px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#435963]">
            <CalendarDays size={15} className="text-[#4b9187]" />
            {first.day} – {last.day}
          </div>
          <div className="text-[10px] text-[#819097]">
            Ratio guide: <b>1:1</b> one-to-one · <b>1:M</b> one staff to several
            clients · <b>M:M</b> several staff supporting several clients
          </div>
        </div>
        {shifts.isPending ? (
          <LoadingBlock />
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-7">
            {days.map(day => {
              const label = dayLabel(day);
              const dayShifts = visible.filter(shift => shift.date === day);
              return (
                <div
                  key={day}
                  className={`min-h-[180px] rounded-md border p-2.5 ${day === today ? "border-[#8ac4bb] bg-[#f6fbf9]" : "border-[#e8eeeb] bg-[#fbfcfb]"}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[#677982]">
                      {label.weekday}
                    </span>
                    <span
                      className={`text-xs font-semibold ${day === today ? "text-[#147f79]" : "text-[#40545e]"}`}
                    >
                      {label.day.split(" ")[0]}
                    </span>
                  </div>
                  {!dayShifts.length ? (
                    <div className="pt-7 text-center text-[10px] text-[#a0aaad]">
                      No shifts planned
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {dayShifts.map(shift => (
                        <article
                          key={shift.id}
                          className={`rounded-md border border-[#e5ece9] bg-white p-2.5 shadow-[0_2px_5px_rgba(20,40,45,.03)] ${shift.status === "Cancelled" ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-[10px] font-bold text-[#344b56]">
                              {shift.start}–{shift.end}
                            </span>
                            <span
                              className={`badge ${RATIO_BADGE[shift.ratio]}`}
                            >
                              {shift.ratio}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] font-semibold leading-4 text-[#405762]">
                            {shift.type}
                          </div>
                          <div className="mt-2 flex items-start gap-1 text-[9px] leading-4 text-[#687b82]">
                            <Users
                              size={11}
                              className="mt-0.5 shrink-0 text-[#648c86]"
                            />
                            <span>
                              {shift.clients
                                .map(client => client.preferred)
                                .join(", ")}
                            </span>
                          </div>
                          <div className="mt-1 flex items-start gap-1 text-[9px] leading-4 text-[#687b82]">
                            <span className="mt-0.5 shrink-0 text-[#89979d]">
                              Staff
                            </span>
                            <span>
                              {shift.staff
                                .map(member => member.initials)
                                .join(" · ")}
                            </span>
                          </div>
                          {shift.location && (
                            <div className="mt-1 flex items-start gap-1 text-[9px] leading-4 text-[#87949a]">
                              <MapPin size={10} className="mt-0.5 shrink-0" />
                              <span className="line-clamp-2">
                                {shift.location}
                              </span>
                            </div>
                          )}
                          <div className="mt-2 flex items-center justify-between border-t border-[#f0f3f2] pt-2">
                            <span
                              className={`text-[9px] font-semibold ${STATUS_TEXT[shift.status]}`}
                            >
                              {shift.status}
                            </span>
                            <button
                              className="text-[9px] font-semibold text-[#277c76] hover:underline"
                              onClick={() => startEdit(shift)}
                            >
                              {shift.status === "Completed" ? "Open" : "Edit"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#496663]">
        <span>
          <CalendarDays size={14} className="mr-1 inline" />
          Overlaps, ratio rules and plan-budget impact are checked by the server
          when a shift is saved. Mark a shift completed to create its service
          records.
        </span>
      </div>
      {drawer && (
        <ShiftDrawer initial={drawer} onClose={() => setDrawer(null)} />
      )}
    </>
  );
}
