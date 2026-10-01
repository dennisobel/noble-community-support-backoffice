import { ArrowLeft, Check, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { NOTE_SECTIONS, NOTE_SECTION_LABELS } from "@shared/enums";
import { addDays, todayIn } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import { DEFAULT_TIMEZONE } from "@shared/const";
import { errorMessage } from "@/api/client";
import {
  useCreatePortalNote,
  usePortalNotes,
  usePortalShift,
  usePortalShifts,
  useSubmitPortalNote,
  useUpdatePortalNote,
} from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { Chip, Empty, Section, toneFor } from "./kit";

type Sections = Record<(typeof NOTE_SECTIONS)[number], string>;

const EMPTY: Sections = {
  support: "",
  response: "",
  outcome: "",
  observations: "",
  followUp: "",
};

const HINTS: Sections = {
  support: "What you did with them this shift.",
  response: "How they responded — engagement, mood, what they said.",
  outcome: "Which goal this worked towards, and any progress.",
  observations: "Anything you noticed: health, environment, safety.",
  followUp: "What the next worker or the office needs to pick up.",
};

/** Lets a worker choose which of their recent shifts a new note belongs to. */
function ShiftPicker() {
  const today = todayIn(DEFAULT_TIMEZONE);
  const shifts = usePortalShifts({ from: addDays(today, -14), to: today });
  const pending = (shifts.data ?? []).filter(shift => !shift.recordId);

  if (shifts.isPending) return <LoadingBlock label="Loading your shifts…" />;
  if (shifts.isError)
    return (
      <ErrorBlock error={shifts.error} onRetry={() => void shifts.refetch()} />
    );

  return (
    <Section title="Which shift is this note for?">
      {pending.length ? (
        <div className="portal-card !p-0">
          {pending.map(shift => (
            <Link
              key={shift.id}
              href={`/staff/notes/new?shiftId=${shift.id}`}
              className="portal-row px-4 no-underline"
            >
              <span className="min-w-0 flex-1">
                <b className="text-[12px] text-[#16323a]">
                  {shift.participants.map(p => p.preferred).join(", ") ||
                    shift.serviceName}
                </b>
                <small className="mt-0.5 block text-[11px] text-[#7a888d]">
                  {prettyDate(shift.date)} · {shift.start}–{shift.end} ·{" "}
                  {shift.serviceName}
                </small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty>
          Every shift in the last fortnight already has a note. Notes are
          written against a shift from your roster.
        </Empty>
      )}
    </Section>
  );
}

export default function PortalNoteEditor() {
  const { id } = useParams<{ id?: string }>();
  const search = new URLSearchParams(useSearch());
  const shiftId = search.get("shiftId") ?? undefined;
  const [, navigate] = useLocation();
  const notify = useNotify();

  const isNew = !id || id === "new";
  const existing = usePortalNotes();
  const note = useMemo(
    () => (isNew ? undefined : existing.data?.find(item => item.id === id)),
    [existing.data, id, isNew]
  );
  const shift = usePortalShift(isNew ? shiftId : undefined);

  const create = useCreatePortalNote();
  const update = useUpdatePortalNote();
  const submit = useSubmitPortalNote();

  const [clientId, setClientId] = useState("");
  const [sections, setSections] = useState<Sections>(EMPTY);
  const [km, setKm] = useState("0");
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  // Load an existing note into the form once it arrives.
  useEffect(() => {
    if (!note) return;
    setSections({
      support: note.support,
      response: note.response,
      outcome: note.outcome,
      observations: note.observations,
      followUp: note.followUp,
    });
    setKm(String(note.km ?? 0));
    setClientId(note.clientId);
    setDeclared(note.confirmed);
  }, [note]);

  useEffect(() => {
    if (shift.data?.participants.length === 1)
      setClientId(shift.data.participants[0].id);
  }, [shift.data]);

  if (isNew && !shiftId) return <ShiftPicker />;
  if (isNew && shift.isPending)
    return <LoadingBlock label="Loading the shift…" />;
  if (!isNew && existing.isPending)
    return <LoadingBlock label="Loading the note…" />;
  if (!isNew && !note)
    return (
      <Empty>
        That note is not available. It may have been invoiced already.
      </Empty>
    );

  const locked = Boolean(note && !["Draft", "Returned"].includes(note.status));
  const set = (key: keyof Sections) => (value: string) =>
    setSections(current => ({ ...current, [key]: value }));
  const missing = NOTE_SECTIONS.filter(key => !sections[key].trim());

  const save = async (andSubmit: boolean) => {
    setProblem("");
    if (andSubmit && missing.length) {
      setProblem(
        `Fill in every section before submitting — still to do: ${missing
          .map(key => NOTE_SECTION_LABELS[key])
          .join(", ")}.`
      );
      return;
    }
    if (andSubmit && !declared) {
      setProblem(MESSAGES.declaration);
      return;
    }
    setBusy(true);
    try {
      const payload = { ...sections, km: Number(km) || 0 };
      let recordId = note?.id;
      if (isNew) {
        const shiftData = shift.data!;
        const created = await create.mutateAsync({
          clientId,
          serviceId: shiftData.serviceId,
          date: shiftData.date,
          start: shiftData.start,
          end: shiftData.end,
          location: shiftData.location,
          shiftId: shiftData.id,
          ...payload,
        });
        recordId = created.id;
        // The declaration is never set at creation, so it is recorded as its own change.
        if (declared)
          await update.mutateAsync({
            id: created.id,
            rev: created.rev,
            confirmed: true,
          });
      } else {
        await update.mutateAsync({
          id: note!.id,
          rev: note!.rev,
          ...payload,
          confirmed: declared,
        });
      }
      if (andSubmit && recordId) {
        await submit.mutateAsync({ id: recordId });
        notify("Note submitted for review.");
        navigate("/staff/notes");
        return;
      }
      notify("Saved as a draft.");
      if (isNew && recordId) navigate(`/staff/notes/${recordId}`);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const heading = note
    ? note.clientName
    : (shift.data?.participants.find(p => p.id === clientId)?.preferred ??
      "New note");

  return (
    <>
      <Link
        href="/staff/notes"
        className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#12766f]"
      >
        <ArrowLeft size={13} /> Notes
      </Link>

      <div className="portal-card mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[15px] text-[#16323a]">{heading}</b>
          {note && <Chip tone={toneFor(note.status)}>{note.status}</Chip>}
        </div>
        <p className="mt-1 text-[11px] text-[#7a888d]">
          {note
            ? `${prettyDate(note.date)} · ${note.type} · ${note.hours} hr`
            : shift.data
              ? `${prettyDate(shift.data.date)} · ${shift.data.serviceName} · ${shift.data.hours} hr`
              : ""}
        </p>
        {note?.status === "Returned" && note.correction && (
          <p className="mt-2 rounded-lg bg-[#fdf1e3] px-3 py-2 text-[11px] leading-4 text-[#8a5a22]">
            <b>Sent back:</b> {note.correction}
          </p>
        )}
      </div>

      {isNew && (shift.data?.participants.length ?? 0) > 1 && (
        <label className="portal-field">
          Who is this note about?
          <select
            value={clientId}
            onChange={event => setClientId(event.target.value)}
          >
            <option value="">Choose a participant</option>
            {shift.data!.participants.map(person => (
              <option key={person.id} value={person.id}>
                {person.preferred} ({person.name})
              </option>
            ))}
          </select>
        </label>
      )}

      {locked && (
        <p className="mb-4 rounded-lg bg-[#eef2f0] px-3 py-2.5 text-[11px] leading-4 text-[#5d6c73]">
          This note has been {note!.status.toLowerCase()} and can no longer be
          edited. Ask your coordinator if something needs to change.
        </p>
      )}

      <fieldset disabled={locked || busy} className="contents">
        {NOTE_SECTIONS.map(key => (
          <label key={key} className="portal-field">
            {NOTE_SECTION_LABELS[key]}
            <textarea
              rows={4}
              placeholder={HINTS[key]}
              value={sections[key]}
              onChange={event => set(key)(event.target.value)}
            />
          </label>
        ))}
        <label className="portal-field">
          Kilometres travelled with the participant
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={km}
            onChange={event => setKm(event.target.value)}
          />
        </label>
        <label className="portal-card mb-3 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={declared}
            onChange={event => setDeclared(event.target.checked)}
          />
          <span className="text-[11px] leading-4 text-[#41555d]">
            I declare this note is a true and accurate record of the support I
            delivered on this shift.
          </span>
        </label>
      </fieldset>

      {problem && (
        <p className="mb-3 rounded-lg bg-[#fbe6e3] px-3 py-2.5 text-[11px] leading-4 text-[#9c3c34]">
          {problem}
        </p>
      )}

      {!locked && (
        <div className="portal-sticky space-y-2">
          <button
            type="button"
            className="portal-primary"
            disabled={busy || (isNew && !clientId)}
            onClick={() => void save(true)}
          >
            <Send size={15} />
            {busy ? "Submitting…" : "Submit for review"}
          </button>
          <button
            type="button"
            className="portal-secondary"
            disabled={busy || (isNew && !clientId)}
            onClick={() => void save(false)}
          >
            <Check size={15} /> Save draft
          </button>
          {missing.length > 0 && (
            <p className="text-center text-[10px] text-[#8a979b]">
              {missing.length} section{missing.length === 1 ? "" : "s"} still to
              fill in.
            </p>
          )}
        </div>
      )}
    </>
  );
}
