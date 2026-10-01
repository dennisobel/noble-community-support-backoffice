import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  MapPin,
  NotebookPen,
  Navigation,
  Play,
  Square,
  Target,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "wouter";
import type { PortalShiftDTO } from "@shared/dto";
import {
  useActiveTracking,
  usePortalShift,
  useStartTracking,
  useStopTracking,
  useTimesheet,
} from "@/api/hooks";
import { errorMessage } from "@/api/client";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { Chip, Empty, Section, toneFor } from "./kit";
import TrackingMap from "./TrackingMap";
import { useJobTracking } from "./useJobTracking";

/** Reads one GPS fix, so a job can start and finish with a real position. */
function currentPosition(): Promise<
  { lat: number; lng: number; accuracy: number | null } | undefined
> {
  if (!("geolocation" in navigator)) return Promise.resolve(undefined);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
        }),
      // A refused or slow fix must never block starting the job.
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 10_000 }
    );
  });
}

function ParticipantCard({
  person,
}: {
  person: PortalShiftDTO["participants"][number];
}) {
  const facts: Array<[string, string]> = [
    ["Communication", person.communication],
    ["Mobility", person.mobility],
    ["Risks", person.risks],
    ["Allergies", person.allergies],
    ["Address", person.address],
  ];
  return (
    <div className="portal-card">
      <b className="text-[13px] text-[#16323a]">{person.preferred}</b>
      <span className="ml-1.5 text-[11px] text-[#8a979b]">{person.name}</span>
      {person.alerts.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {person.alerts.map(alert => (
            <p
              key={alert}
              className="flex items-start gap-2 rounded-lg bg-[#fdf1e3] px-2.5 py-2 text-[11px] leading-4 text-[#8a5a22]"
            >
              <AlertTriangle size={13} className="mt-px shrink-0" />
              {alert}
            </p>
          ))}
        </div>
      )}
      {person.goals.length > 0 && (
        <div className="mt-2.5">
          <span className="text-[9px] font-bold uppercase tracking-[.06em] text-[#8a979b]">
            Goals
          </span>
          <ul className="mt-1 space-y-0.5">
            {person.goals.map(goal => (
              <li
                key={goal}
                className="flex gap-1.5 text-[11px] leading-4 text-[#4f6169]"
              >
                <Target
                  size={11}
                  className="mt-[3px] shrink-0 text-[#12766f]"
                />
                {goal}
              </li>
            ))}
          </ul>
        </div>
      )}
      {facts.some(([, value]) => value) && (
        <dl className="mt-2.5 space-y-1.5">
          {facts
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-[9px] font-bold uppercase tracking-[.06em] text-[#8a979b]">
                  {label}
                </dt>
                <dd className="text-[11px] leading-4 text-[#4f6169]">
                  {value}
                </dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

export default function PortalShiftPage() {
  const { id } = useParams<{ id: string }>();
  const notify = useNotify();
  const shift = usePortalShift(id);
  const active = useActiveTracking();
  const timesheet = useTimesheet();
  const startTracking = useStartTracking();
  const stopTracking = useStopTracking();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  const session = active.data?.active ?? null;
  const trackingHere = session?.shiftId === id ? session : null;
  const live = useJobTracking(trackingHere ? trackingHere.id : null);

  if (shift.isPending) return <LoadingBlock label="Loading the shift…" />;
  if (shift.isError)
    return (
      <ErrorBlock error={shift.error} onRetry={() => void shift.refetch()} />
    );
  const data = shift.data;
  const running = Boolean(data.timesheet.startedAt && !data.timesheet.endedAt);
  const finished = Boolean(data.timesheet.endedAt);
  const noteText = notes ?? data.timesheet.notes;

  /** Starting a job signs on and begins tracking together, so the two never disagree. */
  const startJob = async () => {
    setBusy(true);
    try {
      const location = await currentPosition();
      await timesheet.mutateAsync({
        shiftId: data.id,
        input: { action: "start" },
      });
      if (!session)
        await startTracking.mutateAsync({
          shiftId: data.id,
          location: location && { lat: location.lat, lng: location.lng },
          accuracy: location?.accuracy ?? null,
        });
      notify("Shift started — your location is being recorded.");
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const finishJob = async () => {
    setBusy(true);
    try {
      const location = await currentPosition();
      if (trackingHere)
        await stopTracking.mutateAsync({
          id: trackingHere.id,
          location: location && { lat: location.lat, lng: location.lng },
        });
      await timesheet.mutateAsync({
        shiftId: data.id,
        input: { action: "stop", notes: noteText },
      });
      notify("Shift finished. Kilometres saved to your logbook.");
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    try {
      await timesheet.mutateAsync({
        shiftId: data.id,
        input: { action: "save", notes: noteText },
      });
      notify("Saved.");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const trail = trackingHere?.trail ?? data.tracking?.trail ?? [];
  const shown = trackingHere ?? data.tracking;

  return (
    <>
      <Link
        href="/staff/schedule"
        className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#12766f]"
      >
        <ArrowLeft size={13} /> Schedule
      </Link>

      <div className="portal-card mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[15px] text-[#16323a]">{data.serviceName}</b>
          <Chip tone={toneFor(data.status)}>{data.status}</Chip>
          {running && <Chip tone="ok">On shift</Chip>}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#5d6c73]">
          <Clock size={13} />
          {prettyDate(data.date)} · {data.start}–{data.end} · {data.hours} hr
        </p>
        {data.location && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#7a888d]">
            <MapPin size={13} />
            {data.location}
          </p>
        )}
        {data.notes && (
          <p className="mt-2 rounded-lg bg-[#f2f6f4] px-3 py-2 text-[11px] leading-4 text-[#4f6169]">
            {data.notes}
          </p>
        )}
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[#eef2f0] pt-3">
          <div>
            <dt className="text-[9px] font-bold uppercase tracking-[.05em] text-[#8a979b]">
              Signed on
            </dt>
            <dd className="text-[12px] font-semibold text-[#24444b]">
              {data.timesheet.startedAt
                ? new Date(data.timesheet.startedAt).toLocaleTimeString(
                    "en-AU",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] font-bold uppercase tracking-[.05em] text-[#8a979b]">
              Worked
            </dt>
            <dd className="text-[12px] font-semibold text-[#24444b]">
              {data.timesheet.workedMinutes === null
                ? "—"
                : `${Math.floor(data.timesheet.workedMinutes / 60)}h ${data.timesheet.workedMinutes % 60}m`}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] font-bold uppercase tracking-[.05em] text-[#8a979b]">
              Kilometres
            </dt>
            <dd className="text-[12px] font-semibold text-[#24444b]">
              {shown ? shown.kilometres : data.timesheet.kilometres}
            </dd>
          </div>
        </dl>
      </div>

      {(running || shown) && (
        <Section title="Live tracking">
          <TrackingMap
            trail={trail}
            height={220}
            follow
            emptyText="Waiting for your first location fix…"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {trackingHere ? (
              <>
                <Chip tone={live.state === "error" ? "warn" : "ok"}>
                  <Navigation size={11} />
                  {live.state === "error" ? "Reconnecting" : "Recording"}
                </Chip>
                <span className="text-[10px] text-[#7a888d]">
                  {trackingHere.kilometres} km · every {live.intervalSec}s
                </span>
              </>
            ) : (
              shown && (
                <span className="text-[10px] text-[#7a888d]">
                  Finished · {shown.kilometres} km over {shown.durationMinutes}{" "}
                  min
                </span>
              )
            )}
          </div>
          {live.error && (
            <p className="mt-2 rounded-lg bg-[#fdf1e3] px-3 py-2 text-[11px] leading-4 text-[#8a5a22]">
              {live.error}
            </p>
          )}
        </Section>
      )}

      <Section title={`Participants (${data.participants.length})`}>
        {data.participants.length ? (
          <div className="space-y-2">
            {data.participants.map(person => (
              <ParticipantCard key={person.id} person={person} />
            ))}
          </div>
        ) : (
          <Empty>No participants on this shift.</Empty>
        )}
      </Section>

      <Section title="Shift notes">
        <label className="portal-field">
          <span className="sr-only">Notes for this shift</span>
          <textarea
            rows={3}
            placeholder="Anything the office should know about the shift itself."
            value={noteText}
            onChange={event => setNotes(event.target.value)}
            onBlur={() => {
              if (noteText !== data.timesheet.notes) void saveNotes();
            }}
          />
        </label>
      </Section>

      <div className="portal-sticky space-y-2">
        {!finished &&
          (running ? (
            <button
              type="button"
              className="portal-primary portal-danger"
              onClick={() => void finishJob()}
              disabled={busy}
            >
              <Square size={15} />
              {busy ? "Finishing…" : "Finish shift"}
            </button>
          ) : (
            <button
              type="button"
              className="portal-primary"
              onClick={() => void startJob()}
              disabled={busy || Boolean(session && session.shiftId !== id)}
            >
              <Play size={15} />
              {busy ? "Starting…" : "Start shift & tracking"}
            </button>
          ))}
        {session && session.shiftId !== id && !running && (
          <p className="text-center text-[10px] leading-4 text-[#8a5a22]">
            Another job is still being tracked. Finish it before starting this
            one.
          </p>
        )}
        <Link
          href={
            data.recordId
              ? `/staff/notes/${data.recordId}`
              : `/staff/notes/new?shiftId=${data.id}`
          }
          className="portal-secondary"
        >
          <NotebookPen size={15} />
          {data.recordId ? "Open progress note" : "Write progress note"}
        </Link>
      </div>
    </>
  );
}
