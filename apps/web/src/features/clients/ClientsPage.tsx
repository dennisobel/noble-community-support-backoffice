import { ChevronRight, Mic, Plus, Search, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useParticipants } from "@/api/hooks";
import {
  Avatar,
  Btn,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  SectionHeading,
  Status,
  useDebounced,
} from "@/components/app/ui";
import { useNotify } from "@/lib/notify";
import ParticipantFormDrawer from "./ParticipantFormDrawer";

export default function ClientsPage() {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const initialQuery = new URLSearchParams(useSearch()).get("q") ?? "";
  const [status, setStatus] = useState("Active");
  const [search, setSearch] = useState(initialQuery);
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search.trim(), 250);
  const participants = useParticipants({
    status: status === "All" ? "all" : status,
    q: q || undefined,
  });
  const list = participants.data?.items ?? [];

  return (
    <>
      <SectionHeading
        title="Clients"
        subtitle="Each client profile keeps their plans, documents, service records, progress notes and budget together."
        actions={
          <>
            <Btn variant="secondary" onClick={() => navigate("/app/review")}>
              Review queue
            </Btn>
            <Btn onClick={() => setAdding(true)}>
              <Plus size={15} />
              Add participant
            </Btn>
          </>
        }
      />
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89969b]"
          />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="input pl-9"
            placeholder="Search name or NDIS number"
            aria-label="Search participants"
          />
        </div>
        <select
          className="select w-[145px]"
          value={status}
          onChange={event => setStatus(event.target.value)}
          aria-label="Filter client status"
        >
          <option>Active</option>
          <option>Archived</option>
          <option>All</option>
        </select>
      </div>
      {participants.isError && (
        <ErrorBlock
          error={participants.error}
          onRetry={() => participants.refetch()}
        />
      )}
      <div className="panel">
        {participants.isPending ? (
          <LoadingBlock label="Loading participants…" />
        ) : (
          <>
            <div className="table-wrap mobile-hide">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>NDIS number</th>
                    <th>Support focus</th>
                    <th>Plan manager</th>
                    <th>Alerts</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map(person => (
                    <tr key={person.id}>
                      <td>
                        <button
                          onClick={() => navigate(`/app/clients/${person.id}`)}
                          className="flex items-center gap-2.5 text-left"
                        >
                          <Avatar name={person.name} />
                          <span>
                            <b className="block text-xs text-[#344753]">
                              {person.name}
                            </b>
                            <small className="text-[10px] text-[#87949a]">
                              Preferred: {person.preferred}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td className="text-xs">{person.ndis}</td>
                      <td className="max-w-[170px] truncate text-xs">
                        {person.support || "—"}
                      </td>
                      <td className="text-xs">
                        {person.manager || "To confirm"}
                      </td>
                      <td>
                        {person.alerts.length ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#9b6c1e]">
                            <ShieldAlert size={13} />
                            {person.alerts.length} alert
                            {person.alerts.length > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-[#98a2a5]">None</span>
                        )}
                      </td>
                      <td>
                        <Status value={person.status} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {person.status === "Active" && (
                            <button
                              className="icon-btn"
                              aria-label={`Record voice note for ${person.preferred}`}
                              onClick={() =>
                                navigate(
                                  `/app/voice/record?clientId=${person.id}`
                                )
                              }
                            >
                              <Mic size={15} />
                            </button>
                          )}
                          <button
                            className="icon-btn"
                            aria-label={`Open ${person.preferred}`}
                            onClick={() =>
                              navigate(`/app/clients/${person.id}`)
                            }
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-[#edf0ef] sm:hidden">
              {list.map(person => (
                <div key={person.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={person.name} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[#344753]">
                        {person.name}
                      </div>
                      <div className="mt-1 text-[10px] text-[#87949a]">
                        NDIS {person.ndis}
                      </div>
                      {person.alerts.length > 0 && (
                        <div className="mt-2 text-[10px] text-[#9b6c1e]">
                          <ShieldAlert size={12} className="mr-1 inline" />
                          {person.alerts[0]}
                        </div>
                      )}
                    </div>
                    <Status value={person.status} />
                  </div>
                  <p className="mt-3 text-[11px] text-[#687a83]">
                    {person.support}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Btn
                      variant="secondary"
                      onClick={() => navigate(`/app/clients/${person.id}`)}
                    >
                      View profile
                    </Btn>
                    {person.status === "Active" && (
                      <>
                        <Btn
                          variant="secondary"
                          onClick={() =>
                            navigate(`/app/voice/record?clientId=${person.id}`)
                          }
                        >
                          <Mic size={13} />
                          Voice note
                        </Btn>
                        <Btn
                          onClick={() =>
                            navigate(`/app/records/new?clientId=${person.id}`)
                          }
                        >
                          <Plus size={13} />
                          New record
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {!list.length && (
              <EmptyState
                title={
                  q
                    ? "No participants found"
                    : status === "Archived"
                      ? "No archived participants"
                      : "No participants yet"
                }
                text={
                  q
                    ? "Try another name, NDIS number or status filter."
                    : "Add a participant to start their client file."
                }
                action={
                  !q && status !== "Archived" ? (
                    <Btn onClick={() => setAdding(true)}>
                      <Plus size={14} />
                      Add participant
                    </Btn>
                  ) : undefined
                }
              />
            )}
          </>
        )}
      </div>
      {participants.data && (
        <p className="mt-3 text-[10px] text-[#8a969a]">
          Showing {list.length} of {participants.data.total}{" "}
          {status === "All" ? "" : status.toLowerCase()} participants
        </p>
      )}
      {adding && (
        <ParticipantFormDrawer
          onClose={() => setAdding(false)}
          onSaved={created => {
            setAdding(false);
            notify(
              `${created.preferred}’s client profile is ready. Check any KYC items still pending.`
            );
            navigate(`/app/clients/${created.id}`);
          }}
        />
      )}
    </>
  );
}
