import { ArrowLeft, Check, FilePlus2, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  EMPTY_NOTE,
  NOTE_FIELDS,
  noteProblems,
  type NoteContent,
} from "@shared/logic/progress-note";
import { addDays, todayIn } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import { DEFAULT_TIMEZONE } from "@shared/const";
import { ApiError, errorMessage } from "@/api/client";
import {
  useCreatePortalNote,
  usePortalNotes,
  usePortalShift,
  usePortalShifts,
  useRequestAmendment,
  useSubmitPortalNote,
  useUpdatePortalNote,
} from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { NoteForm } from "@/features/records/NoteForm";
import { formatDateTime, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { Chip, Empty, Section, toneFor } from "./kit";

const noteOf = (source: NoteContent): NoteContent =>
  Object.fromEntries(
    NOTE_FIELDS.map(field => [field, source[field]])
  ) as unknown as NoteContent;

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
  // The shift carries the participant's goals, for a new note and for one being finished later.
  const shift = usePortalShift(isNew ? shiftId : (note?.shiftId ?? undefined));

  const create = useCreatePortalNote();
  const update = useUpdatePortalNote();
  const submit = useSubmitPortalNote();
  const requestAmendment = useRequestAmendment();

  const [clientId, setClientId] = useState("");
  const [content, setContent] = useState<NoteContent>(EMPTY_NOTE);
  const [km, setKm] = useState("0");
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);

  // Load an existing note into the form once, so a background refresh never wipes typing.
  useEffect(() => {
    if (!note || loaded === note.id) return;
    setContent(noteOf(note));
    setKm(String(note.km ?? 0));
    setClientId(note.clientId);
    setDeclared(note.confirmed);
    setLoaded(note.id);
  }, [note, loaded]);

  useEffect(() => {
    if (isNew && shift.data?.participants.length === 1)
      setClientId(shift.data.participants[0].id);
  }, [isNew, shift.data]);

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
  const person = shift.data?.participants.find(p => p.id === clientId);
  const problems = noteProblems(content);
  const waiting = (note?.amendmentRequests ?? []).some(
    request => request.status === "Open"
  );
  const set = <K extends keyof NoteContent>(key: K, next: NoteContent[K]) => {
    setContent(current => ({ ...current, [key]: next }));
    setErrors(current => ({ ...current, [key]: "" }));
  };
  const reportLink = (section: "incidents" | "abc") =>
    `/staff/reports/${section}?new=1&shiftId=${note?.shiftId ?? shiftId ?? ""}&participantId=${clientId}`;

  const save = async (andSubmit: boolean) => {
    setProblem("");
    if (andSubmit && problems.length) {
      setErrors(
        Object.fromEntries(problems.map(item => [item.path, item.message]))
      );
      setProblem(
        `${problems.length === 1 ? "One thing is" : `${problems.length} things are`} still needed before you can submit. They are marked in red above.`
      );
      return;
    }
    if (andSubmit && !declared) {
      setProblem(MESSAGES.declaration);
      return;
    }
    setBusy(true);
    try {
      const payload = { ...content, km: Number(km) || 0 };
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
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    setProblem("");
    try {
      await requestAmendment.mutateAsync({
        id: note!.id,
        reason: reason.trim(),
      });
      setAsking(false);
      setReason("");
      notify("Request sent. The office will correct the note or reply.");
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const heading = note ? note.clientName : (person?.preferred ?? "New note");

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
          {note?.amended && <Chip tone="info">Amended</Chip>}
        </div>
        <p className="mt-1 text-[11px] text-[#7a888d]">
          {note
            ? `${prettyDate(note.date)} · ${note.start}–${note.end} · ${note.type} · ${note.hours} hr`
            : shift.data
              ? `${prettyDate(shift.data.date)} · ${shift.data.start}–${shift.data.end} · ${shift.data.serviceName} · ${shift.data.hours} hr`
              : ""}
        </p>
        <p className="mt-1 text-[10.5px] text-[#93a0a4]">
          Your name, the participant and the shift times come from your roster.
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
            {shift.data!.participants.map(participant => (
              <option key={participant.id} value={participant.id}>
                {participant.preferred} ({participant.name})
              </option>
            ))}
          </select>
        </label>
      )}

      {locked && (
        <p className="mb-4 rounded-lg bg-[#eef2f0] px-3 py-2.5 text-[11px] leading-4 text-[#5d6c73]">
          This note has been {note!.status.toLowerCase()} and can no longer be
          edited. If something in it is wrong, ask for an amendment at the
          bottom of this page.
        </p>
      )}

      <NoteForm
        variant="portal"
        value={content}
        onChange={set}
        errors={errors}
        disabled={locked || busy}
        incidentAction={
          <span className="flex flex-wrap gap-2">
            <Link
              href={reportLink("incidents")}
              className="inline-flex items-center gap-1 rounded-md border border-[#d9b96c] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#7a5a14] no-underline"
            >
              <FilePlus2 size={13} /> Incident report
            </Link>
            <Link
              href={reportLink("abc")}
              className="inline-flex items-center gap-1 rounded-md border border-[#d9b96c] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#7a5a14] no-underline"
            >
              <FilePlus2 size={13} /> Behaviour (ABC) report
            </Link>
          </span>
        }
      />

      <fieldset disabled={locked || busy} className="contents">
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

      {locked && note && (
        <Section title="Corrections">
          {note.amendments.map(amendment => (
            <div key={amendment.id} className="portal-card">
              <b className="text-[11.5px] text-[#16323a]">
                Amended by {amendment.by?.name ?? "the office"}
              </b>
              <small className="block text-[10.5px] text-[#7a888d]">
                {formatDateTime(amendment.at)} ·{" "}
                {amendment.changes.map(change => change.label).join(", ")}
              </small>
              <p className="mt-1 text-[11px] leading-4 text-[#41555d]">
                {amendment.reason}
              </p>
            </div>
          ))}
          {note.amendmentRequests.map(request => (
            <div key={request.id} className="portal-card">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[11.5px] text-[#16323a]">Your request</b>
                <Chip
                  tone={
                    request.status === "Open"
                      ? "info"
                      : request.status === "Applied"
                        ? "ok"
                        : "warn"
                  }
                >
                  {request.status === "Open" ? "Waiting" : request.status}
                </Chip>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-[#41555d]">
                {request.reason}
              </p>
              {request.status === "Declined" && request.resolution && (
                <p className="mt-1 text-[11px] leading-4 text-[#8a5a22]">
                  Reply: {request.resolution}
                </p>
              )}
            </div>
          ))}
          {asking ? (
            <div className="portal-card">
              <label className="portal-field !mb-0">
                What needs to change, and why?
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={reason}
                  onChange={event => setReason(event.target.value)}
                  placeholder="e.g. The appointment was at 10:00, not 11:00."
                />
              </label>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="portal-primary"
                  disabled={!reason.trim() || requestAmendment.isPending}
                  onClick={() => void ask()}
                >
                  <Send size={15} />
                  {requestAmendment.isPending ? "Sending…" : "Send request"}
                </button>
                <button
                  type="button"
                  className="portal-secondary"
                  onClick={() => setAsking(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            !waiting && (
              <button
                type="button"
                className="portal-secondary mt-3"
                onClick={() => setAsking(true)}
              >
                Request an amendment
              </button>
            )
          )}
        </Section>
      )}

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
          {problems.length > 0 && (
            <p className="text-center text-[10px] text-[#8a979b]">
              {problems.length} thing{problems.length === 1 ? "" : "s"} still to
              fill in.
            </p>
          )}
        </div>
      )}
    </>
  );
}
