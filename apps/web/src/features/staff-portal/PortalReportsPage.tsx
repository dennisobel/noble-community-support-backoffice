import { ChevronRight, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import {
  ABC_BEHAVIOURS,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  LOGBOOK_ENTRY_TYPES,
} from "@shared/enums";
import { todayIn } from "@shared/logic/time";
import { DEFAULT_TIMEZONE } from "@shared/const";
import { errorMessage } from "@/api/client";
import {
  useAbcMutations,
  useIncidentMutations,
  useLogbookMutations,
  usePortalAbc,
  usePortalIncidents,
  usePortalLogbook,
  usePortalShifts,
} from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { Chip, Empty, toneFor } from "./kit";

type Section = "incidents" | "abc" | "logbook";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "incidents", label: "Incidents" },
  { key: "abc", label: "ABC" },
  { key: "logbook", label: "KM logbook" },
];

const NOTIFY_OPTIONS = [
  "Coordinator",
  "Family / nominee",
  "Emergency services",
  "NDIS Commission",
  "Plan manager",
];

const nowTime = () =>
  new Date().toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** A shift the worker actually worked, so a report can be tied to real context. */
function useRecentShifts() {
  const today = todayIn(DEFAULT_TIMEZONE);
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);
  return usePortalShifts({ from: from.toISOString().slice(0, 10), to: today });
}

function ShiftAndParticipant({
  shiftId,
  participantId,
  onChange,
}: {
  shiftId: string;
  participantId: string;
  onChange: (next: { shiftId: string; participantId: string }) => void;
}) {
  const shifts = useRecentShifts();
  const chosen = shifts.data?.find(shift => shift.id === shiftId);
  return (
    <>
      <label className="portal-field">
        Shift this relates to
        <select
          value={shiftId}
          onChange={event =>
            onChange({ shiftId: event.target.value, participantId: "" })
          }
        >
          <option value="">Not linked to a shift</option>
          {(shifts.data ?? []).map(shift => (
            <option key={shift.id} value={shift.id}>
              {prettyDate(shift.date)} · {shift.serviceName} ·{" "}
              {shift.participants.map(p => p.preferred).join(", ")}
            </option>
          ))}
        </select>
      </label>
      {chosen && chosen.participants.length > 0 && (
        <label className="portal-field">
          Participant involved
          <select
            value={participantId}
            onChange={event =>
              onChange({ shiftId, participantId: event.target.value })
            }
          >
            <option value="">No one in particular</option>
            {chosen.participants.map(person => (
              <option key={person.id} value={person.id}>
                {person.preferred}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function FormSheet({
  title,
  onClose,
  onSubmit,
  busy,
  problem,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  problem: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-[#16323a]">{title}</h2>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#dbe4e0] bg-white text-[#54636b]"
          onClick={onClose}
          aria-label="Cancel"
        >
          <X size={15} />
        </button>
      </div>
      <form
        onSubmit={event => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
        {problem && (
          <p className="mb-3 rounded-lg bg-[#fbe6e3] px-3 py-2.5 text-[11px] leading-4 text-[#9c3c34]">
            {problem}
          </p>
        )}
        <div className="portal-sticky space-y-2">
          <button type="submit" className="portal-primary" disabled={busy}>
            {busy ? "Saving…" : "Submit report"}
          </button>
          <button
            type="button"
            className="portal-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

/** Incidents, ABC records and the kilometre logbook — the paperwork a worker files. */
export default function PortalReportsPage() {
  const params = useParams<{ section?: string }>();
  const section = (SECTIONS.find(item => item.key === params.section)?.key ??
    "incidents") as Section;
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {SECTIONS.map(item => (
          <Link
            key={item.key}
            href={`/staff/reports/${item.key}`}
            onClick={() => setAdding(false)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[11px] font-bold no-underline ${
              section === item.key
                ? "bg-[#12766f] text-white"
                : "border border-[#dbe4e0] bg-white text-[#54636b]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {section === "incidents" && (
        <IncidentsSection adding={adding} setAdding={setAdding} />
      )}
      {section === "abc" && (
        <AbcSection adding={adding} setAdding={setAdding} />
      )}
      {section === "logbook" && (
        <LogbookSection adding={adding} setAdding={setAdding} />
      )}
    </>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="portal-sticky">
      <button type="button" className="portal-primary" onClick={onClick}>
        <Plus size={16} /> {label}
      </button>
    </div>
  );
}

/* ───────────── Incidents ───────────── */

function IncidentsSection({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (value: boolean) => void;
}) {
  const list = usePortalIncidents();
  const { create } = useIncidentMutations();
  const notify = useNotify();
  const today = todayIn(DEFAULT_TIMEZONE);
  const [problem, setProblem] = useState("");
  const [form, setForm] = useState({
    shiftId: "",
    participantId: "",
    date: today,
    time: nowTime(),
    location: "",
    category: INCIDENT_CATEGORIES[0],
    severity: "Minor" as (typeof INCIDENT_SEVERITIES)[number],
    description: "",
    injuries: "",
    medicalAttention: false,
    medicalDetails: "",
    witness: "",
    immediateActions: "",
    notified: [] as string[],
    followUp: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async () => {
    setProblem("");
    try {
      await create.mutateAsync(form);
      notify("Incident report submitted.");
      setAdding(false);
      setForm(current => ({ ...current, description: "", injuries: "" }));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  if (adding)
    return (
      <FormSheet
        title="Report an incident"
        onClose={() => setAdding(false)}
        onSubmit={() => void submit()}
        busy={create.isPending}
        problem={problem}
      >
        <ShiftAndParticipant
          shiftId={form.shiftId}
          participantId={form.participantId}
          onChange={next =>
            setForm(current => ({
              ...current,
              shiftId: next.shiftId,
              participantId: next.participantId,
            }))
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="portal-field">
            Date
            <input
              type="date"
              required
              value={form.date}
              onChange={event => set("date", event.target.value)}
            />
          </label>
          <label className="portal-field">
            Time
            <input
              type="time"
              required
              value={form.time}
              onChange={event => set("time", event.target.value)}
            />
          </label>
        </div>
        <label className="portal-field">
          Where it happened
          <input
            value={form.location}
            placeholder="Address or place"
            onChange={event => set("location", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Category
          <select
            value={form.category}
            onChange={event =>
              set("category", event.target.value as typeof form.category)
            }
          >
            {INCIDENT_CATEGORIES.map(option => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="portal-field">
          Severity
          <select
            value={form.severity}
            onChange={event =>
              set("severity", event.target.value as typeof form.severity)
            }
          >
            {INCIDENT_SEVERITIES.map(option => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="portal-field">
          What happened
          <textarea
            rows={4}
            required
            placeholder="Describe it factually, in the order it happened."
            value={form.description}
            onChange={event => set("description", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Injuries
          <textarea
            rows={2}
            placeholder="Who was hurt and how. Leave blank if no one was."
            value={form.injuries}
            onChange={event => set("injuries", event.target.value)}
          />
        </label>
        <label className="mb-3 flex items-center gap-2.5 text-[12px] font-semibold text-[#41555d]">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.medicalAttention}
            onChange={event => set("medicalAttention", event.target.checked)}
          />
          Medical attention was needed
        </label>
        {form.medicalAttention && (
          <label className="portal-field">
            Medical details
            <textarea
              rows={2}
              value={form.medicalDetails}
              onChange={event => set("medicalDetails", event.target.value)}
            />
          </label>
        )}
        <label className="portal-field">
          Witness
          <input
            value={form.witness}
            onChange={event => set("witness", event.target.value)}
          />
        </label>
        <label className="portal-field">
          What you did straight away
          <textarea
            rows={3}
            value={form.immediateActions}
            onChange={event => set("immediateActions", event.target.value)}
          />
        </label>
        <fieldset className="mb-3">
          <legend className="mb-1.5 text-[10px] font-bold text-[#41555d]">
            Who was told
          </legend>
          <div className="flex flex-wrap gap-2">
            {NOTIFY_OPTIONS.map(option => {
              const on = form.notified.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    set(
                      "notified",
                      on
                        ? form.notified.filter(item => item !== option)
                        : [...form.notified, option]
                    )
                  }
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    on
                      ? "bg-[#12766f] text-white"
                      : "border border-[#dbe4e0] bg-white text-[#54636b]"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="portal-field">
          Follow-up needed
          <textarea
            rows={2}
            value={form.followUp}
            onChange={event => set("followUp", event.target.value)}
          />
        </label>
      </FormSheet>
    );

  return (
    <>
      {list.isPending ? (
        <LoadingBlock label="Loading incidents…" />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.length ? (
        <Empty>No incident reports. That is a good thing.</Empty>
      ) : (
        <div className="portal-card !p-0">
          {list.data.map(item => (
            <div key={item.id} className="portal-row px-4">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-[12px] text-[#16323a]">{item.category}</b>
                  <Chip tone={toneFor(item.severity)}>{item.severity}</Chip>
                  <Chip tone={toneFor(item.status)}>{item.status}</Chip>
                </span>
                <small className="mt-0.5 block text-[11px] text-[#7a888d]">
                  {prettyDate(item.date)} {item.time}
                  {item.participantName ? ` · ${item.participantName}` : ""}
                </small>
                <small className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[#5d6c73]">
                  {item.description}
                </small>
                {item.reviewNote && (
                  <small className="mt-1 block text-[11px] leading-4 text-[#2f5c86]">
                    Office: {item.reviewNote}
                  </small>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <AddButton label="Report an incident" onClick={() => setAdding(true)} />
    </>
  );
}

/* ───────────── ABC reports ───────────── */

function AbcSection({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (value: boolean) => void;
}) {
  const list = usePortalAbc();
  const { create } = useAbcMutations();
  const notify = useNotify();
  const today = todayIn(DEFAULT_TIMEZONE);
  const [problem, setProblem] = useState("");
  const [form, setForm] = useState({
    shiftId: "",
    participantId: "",
    date: today,
    time: nowTime(),
    location: "",
    behaviour: ABC_BEHAVIOURS[0],
    intensity: 3,
    durationMinutes: 0,
    antecedent: "",
    behaviourDescription: "",
    consequence: "",
    staffResponse: "",
    outcome: "",
    preventionPlan: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async () => {
    setProblem("");
    try {
      await create.mutateAsync(form);
      notify("ABC report submitted.");
      setAdding(false);
      setForm(current => ({
        ...current,
        antecedent: "",
        behaviourDescription: "",
        consequence: "",
      }));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  if (adding)
    return (
      <FormSheet
        title="Record an ABC"
        onClose={() => setAdding(false)}
        onSubmit={() => void submit()}
        busy={create.isPending}
        problem={problem}
      >
        <p className="mb-3 rounded-lg bg-[#eef2f0] px-3 py-2.5 text-[11px] leading-4 text-[#5d6c73]">
          Antecedent, Behaviour, Consequence — what led up to it, what happened,
          and what followed.
        </p>
        <ShiftAndParticipant
          shiftId={form.shiftId}
          participantId={form.participantId}
          onChange={next =>
            setForm(current => ({
              ...current,
              shiftId: next.shiftId,
              participantId: next.participantId,
            }))
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="portal-field">
            Date
            <input
              type="date"
              required
              value={form.date}
              onChange={event => set("date", event.target.value)}
            />
          </label>
          <label className="portal-field">
            Time
            <input
              type="time"
              required
              value={form.time}
              onChange={event => set("time", event.target.value)}
            />
          </label>
        </div>
        <label className="portal-field">
          Behaviour
          <select
            value={form.behaviour}
            onChange={event =>
              set("behaviour", event.target.value as typeof form.behaviour)
            }
          >
            {ABC_BEHAVIOURS.map(option => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="portal-field">
            Intensity (1–5)
            <input
              type="number"
              min={1}
              max={5}
              value={form.intensity}
              onChange={event => set("intensity", Number(event.target.value))}
            />
          </label>
          <label className="portal-field">
            Duration (minutes)
            <input
              type="number"
              min={0}
              value={form.durationMinutes}
              onChange={event =>
                set("durationMinutes", Number(event.target.value))
              }
            />
          </label>
        </div>
        <label className="portal-field">
          Antecedent — what came before
          <textarea
            rows={3}
            required
            value={form.antecedent}
            onChange={event => set("antecedent", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Behaviour — what you saw
          <textarea
            rows={3}
            required
            value={form.behaviourDescription}
            onChange={event => set("behaviourDescription", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Consequence — what followed
          <textarea
            rows={3}
            required
            value={form.consequence}
            onChange={event => set("consequence", event.target.value)}
          />
        </label>
        <label className="portal-field">
          How you responded
          <textarea
            rows={2}
            value={form.staffResponse}
            onChange={event => set("staffResponse", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Outcome
          <textarea
            rows={2}
            value={form.outcome}
            onChange={event => set("outcome", event.target.value)}
          />
        </label>
        <label className="portal-field">
          What might prevent it next time
          <textarea
            rows={2}
            value={form.preventionPlan}
            onChange={event => set("preventionPlan", event.target.value)}
          />
        </label>
      </FormSheet>
    );

  return (
    <>
      {list.isPending ? (
        <LoadingBlock label="Loading ABC reports…" />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.length ? (
        <Empty>No ABC reports recorded.</Empty>
      ) : (
        <div className="portal-card !p-0">
          {list.data.map(item => (
            <div key={item.id} className="portal-row px-4">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-[12px] text-[#16323a]">{item.behaviour}</b>
                  <Chip tone="muted">Intensity {item.intensity}</Chip>
                  <Chip tone={toneFor(item.status)}>{item.status}</Chip>
                </span>
                <small className="mt-0.5 block text-[11px] text-[#7a888d]">
                  {prettyDate(item.date)} {item.time}
                  {item.participantName ? ` · ${item.participantName}` : ""}
                </small>
                <small className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[#5d6c73]">
                  {item.behaviourDescription}
                </small>
              </span>
            </div>
          ))}
        </div>
      )}
      <AddButton label="Record an ABC" onClick={() => setAdding(true)} />
    </>
  );
}

/* ───────────── KM logbook ───────────── */

function LogbookSection({
  adding,
  setAdding,
}: {
  adding: boolean;
  setAdding: (value: boolean) => void;
}) {
  const list = usePortalLogbook();
  const { create } = useLogbookMutations();
  const notify = useNotify();
  const today = todayIn(DEFAULT_TIMEZONE);
  const [problem, setProblem] = useState("");
  const [form, setForm] = useState({
    shiftId: "",
    participantId: "",
    date: today,
    type: LOGBOOK_ENTRY_TYPES[0],
    fromLocation: "",
    toLocation: "",
    purpose: "",
    kilometres: 0,
    odometerStart: "",
    odometerEnd: "",
    notes: "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async () => {
    setProblem("");
    try {
      await create.mutateAsync({
        ...form,
        odometerStart: form.odometerStart ? Number(form.odometerStart) : null,
        odometerEnd: form.odometerEnd ? Number(form.odometerEnd) : null,
      });
      notify("Logbook entry saved.");
      setAdding(false);
      setForm(current => ({
        ...current,
        fromLocation: "",
        toLocation: "",
        kilometres: 0,
      }));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const total =
    Math.round(
      (list.data ?? []).reduce((sum, i) => sum + i.kilometres, 0) * 10
    ) / 10;

  if (adding)
    return (
      <FormSheet
        title="Add a logbook entry"
        onClose={() => setAdding(false)}
        onSubmit={() => void submit()}
        busy={create.isPending}
        problem={problem}
      >
        <ShiftAndParticipant
          shiftId={form.shiftId}
          participantId={form.participantId}
          onChange={next =>
            setForm(current => ({
              ...current,
              shiftId: next.shiftId,
              participantId: next.participantId,
            }))
          }
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="portal-field">
            Date
            <input
              type="date"
              required
              value={form.date}
              onChange={event => set("date", event.target.value)}
            />
          </label>
          <label className="portal-field">
            Type
            <select
              value={form.type}
              onChange={event =>
                set("type", event.target.value as typeof form.type)
              }
            >
              {LOGBOOK_ENTRY_TYPES.map(option => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="portal-field">
          From
          <input
            value={form.fromLocation}
            onChange={event => set("fromLocation", event.target.value)}
          />
        </label>
        <label className="portal-field">
          To
          <input
            value={form.toLocation}
            onChange={event => set("toLocation", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Purpose
          <input
            placeholder="Community access, appointment…"
            value={form.purpose}
            onChange={event => set("purpose", event.target.value)}
          />
        </label>
        <label className="portal-field">
          Kilometres
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            required
            value={form.kilometres}
            onChange={event => set("kilometres", Number(event.target.value))}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="portal-field">
            Odometer start
            <input
              type="number"
              inputMode="numeric"
              value={form.odometerStart}
              onChange={event => set("odometerStart", event.target.value)}
            />
          </label>
          <label className="portal-field">
            Odometer end
            <input
              type="number"
              inputMode="numeric"
              value={form.odometerEnd}
              onChange={event => set("odometerEnd", event.target.value)}
            />
          </label>
        </div>
        <label className="portal-field">
          Notes
          <textarea
            rows={2}
            value={form.notes}
            onChange={event => set("notes", event.target.value)}
          />
        </label>
      </FormSheet>
    );

  return (
    <>
      {list.isPending ? (
        <LoadingBlock label="Loading your logbook…" />
      ) : list.isError ? (
        <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data.length ? (
        <Empty>
          No kilometres logged. Tracked shifts add their distance here
          automatically.
        </Empty>
      ) : (
        <>
          <div className="portal-stat mb-3">
            <b>{total} km</b>
            <span>Logged across {list.data.length} entries</span>
          </div>
          <div className="portal-card !p-0">
            {list.data.map(item => (
              <div key={item.id} className="portal-row px-4">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-[12px] text-[#16323a]">
                      {item.kilometres} km
                    </b>
                    <Chip tone="muted">{item.type}</Chip>
                    {item.trackedKilometres !== null && (
                      <Chip tone="info">
                        Tracked {item.trackedKilometres} km
                      </Chip>
                    )}
                  </span>
                  <small className="mt-0.5 block text-[11px] text-[#7a888d]">
                    {prettyDate(item.date)}
                    {item.fromLocation || item.toLocation
                      ? ` · ${item.fromLocation || "—"} → ${item.toLocation || "—"}`
                      : ""}
                  </small>
                  {item.purpose && (
                    <small className="mt-0.5 block text-[11px] text-[#5d6c73]">
                      {item.purpose}
                    </small>
                  )}
                </span>
                <ChevronRight size={15} className="shrink-0 text-[#d3dcd9]" />
              </div>
            ))}
          </div>
        </>
      )}
      <AddButton label="Add kilometres" onClick={() => setAdding(true)} />
    </>
  );
}
