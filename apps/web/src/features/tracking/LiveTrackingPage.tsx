import {
  Activity,
  Gauge,
  MapPin,
  Radio,
  RouteIcon,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import type { TrackingSessionDTO } from "@shared/dto";
import { useLiveTracking } from "@/api/hooks";
import {
  Avatar,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Panel,
  SectionHeading,
} from "@/components/app/ui";
import { formatTime, timeAgo } from "@/lib/format";
import TrackingMap from "@/features/staff-portal/TrackingMap";

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: TrackingSessionDTO;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 border-b border-[#edf1ef] p-4 text-left last:border-b-0 ${
        selected ? "bg-[#eef5f3]" : "hover:bg-[#f7faf9]"
      }`}
      aria-current={selected || undefined}
    >
      <Avatar name={session.staffName} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#354a56]">
            {session.staffName}
          </span>
          {session.signalLost ? (
            <span className="badge badge-danger">
              <WifiOff size={10} /> Signal lost
            </span>
          ) : session.status === "Active" ? (
            <span className="badge badge-approved">
              {session.stationary ? "Stationary" : "Moving"}
            </span>
          ) : (
            <span className="badge badge-draft">Finished</span>
          )}
        </div>
        <div className="mt-1 text-[10px] text-[#819097]">
          {session.participantNames.length
            ? session.participantNames.join(", ")
            : "No participant linked"}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#63757d]">
          <span>{session.kilometres} km</span>
          <span>{session.durationMinutes} min</span>
          <span>
            {session.status === "Active"
              ? `Last fix ${timeAgo(session.lastPingAt)}`
              : `Ended ${formatTime(session.endedAt)}`}
          </span>
          {session.currentSpeedKph !== null && (
            <span>{session.currentSpeedKph} km/h</span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Who is out on a job right now, where they are, and how far they have travelled. */
export default function LiveTrackingPage() {
  const live = useLiveTracking();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (live.isPending) return <LoadingBlock label="Loading live jobs…" />;
  if (live.isError)
    return <ErrorBlock error={live.error} onRetry={() => live.refetch()} />;

  const data = live.data;
  const all = [...data.active, ...data.recent];
  const selected =
    all.find(session => session.id === selectedId) ?? data.active[0] ?? all[0];

  return (
    <>
      <SectionHeading
        title="Live jobs"
        subtitle="Workers who have started a shift are recording their location. Positions refresh every 10 seconds."
        actions={
          <span className="flex items-center gap-1.5 text-[11px] text-[#63757d]">
            <Radio size={13} className="text-[#12766f]" />
            Updated {timeAgo(data.generatedAt)}
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="panel p-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.08em] text-[#849198]">
            <Activity size={13} /> On a job now
          </div>
          <div className="mt-1.5 text-[26px] font-bold tracking-[-.02em] text-[#25424b]">
            {data.totals.activeCount}
          </div>
        </div>
        <div className="panel p-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.08em] text-[#849198]">
            <RouteIcon size={13} /> Kilometres today
          </div>
          <div className="mt-1.5 text-[26px] font-bold tracking-[-.02em] text-[#25424b]">
            {data.totals.kilometresToday}
          </div>
        </div>
        <div className="panel p-4">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.08em] text-[#849198]">
            <Gauge size={13} /> Jobs tracked today
          </div>
          <div className="mt-1.5 text-[26px] font-bold tracking-[-.02em] text-[#25424b]">
            {data.totals.sessionsToday}
          </div>
        </div>
      </div>

      {!all.length ? (
        <Panel>
          <EmptyState
            title="No one is on a tracked job"
            text="When a worker starts a shift in their portal, their route appears here live."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="flex flex-col gap-4">
            <Panel title={`On a job (${data.active.length})`}>
              {data.active.length ? (
                data.active.map(session => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={selected?.id === session.id}
                    onSelect={() => setSelectedId(session.id)}
                  />
                ))
              ) : (
                <p className="p-5 text-xs text-[#7a888d]">
                  Nobody is on a job right now.
                </p>
              )}
            </Panel>
            {data.recent.length > 0 && (
              <Panel title="Finished today">
                {data.recent.map(session => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={selected?.id === session.id}
                    onSelect={() => setSelectedId(session.id)}
                  />
                ))}
              </Panel>
            )}
          </div>

          <Panel
            title={selected ? `${selected.staffName}'s route` : "Route"}
            action={
              selected && (
                <span className="text-[11px] text-[#63757d]">
                  {selected.kilometres} km · {selected.trail.length} fixes
                </span>
              )
            }
          >
            <div className="p-4">
              <TrackingMap
                trail={selected?.trail ?? []}
                markers={
                  selected?.startLocation
                    ? [{ ...selected.startLocation, label: "start" }]
                    : []
                }
                height={460}
                follow={selected?.status === "Active"}
                emptyText="No positions recorded for this job yet."
              />
              {selected && (
                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ["Started", formatTime(selected.startedAt)],
                    [
                      "Last fix",
                      selected.lastPingAt ? timeAgo(selected.lastPingAt) : "—",
                    ],
                    ["Distance", `${selected.kilometres} km`],
                    ["Duration", `${selected.durationMinutes} min`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                        {label}
                      </dt>
                      <dd className="mt-0.5 text-xs font-semibold text-[#41555d]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {selected?.lastLocation && (
                <p className="mt-3 flex items-center gap-1.5 text-[10px] text-[#849198]">
                  <MapPin size={11} />
                  {selected.lastLocation.lat.toFixed(5)},{" "}
                  {selected.lastLocation.lng.toFixed(5)}
                </p>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
