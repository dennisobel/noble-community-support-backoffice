import { Download, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { RECORD_STATUSES } from "@shared/enums";
import { downloadFile, errorMessage } from "@/api/client";
import { useParticipants, useRecords, useStaff } from "@/api/hooks";
import {
  Btn,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Status,
} from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import { NoteFlags } from "./NoteForm";

export interface NoteFilters {
  q: string;
  clientId: string;
  staffId: string;
  /** A record status, "open" for anything not yet submitted, or "flag:…" for what a note flags. */
  status: string;
  from: string;
  to: string;
}

export const NO_NOTE_FILTERS: NoteFilters = {
  q: "",
  clientId: "",
  staffId: "",
  status: "",
  from: "",
  to: "",
};

const STATUS_CHOICES: Array<[string, string]> = [
  ["", "Every status"],
  ["open", "Awaiting submission"],
  ...RECORD_STATUSES.map(status => [status, status] as [string, string]),
  ["flag:amended", "Amended"],
  ["flag:attention", "Health concern or incident"],
  ["flag:requests", "Amendment requested"],
];

const statusQuery = (value: string) =>
  value.startsWith("flag:")
    ? { flag: value.slice(5) }
    : value === "open"
      ? { status: "Draft,Returned" }
      : value
        ? { status: value }
        : {};

/**
 * Progress notes with their search and filters. A participant's profile shows it fixed to that
 * participant; the dashboard shows it across everyone.
 */
export function NotesBrowser({
  filters,
  onChange,
  fixedClientId,
  canCreate = true,
}: {
  filters: NoteFilters;
  onChange: (next: NoteFilters) => void;
  fixedClientId?: string;
  canCreate?: boolean;
}) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const staff = useStaff({ status: "all" });
  const participants = useParticipants(
    { status: "all", limit: 200 },
    { enabled: !fixedClientId }
  );
  const clientId = fixedClientId ?? filters.clientId;
  const records = useRecords({
    clientId: clientId || undefined,
    staffId: filters.staffId || undefined,
    q: filters.q.trim().length > 1 ? filters.q.trim() : undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    ...statusQuery(filters.status),
    limit: 100,
  });
  const set = (patch: Partial<NoteFilters>) =>
    onChange({ ...filters, ...patch });
  const filtered = Object.entries(filters).some(
    ([key, value]) => value && !(fixedClientId && key === "clientId")
  );
  const newHref = `/app/records/new${clientId ? `?clientId=${clientId}` : ""}`;

  const exportPdf = async (id: string) => {
    try {
      await downloadFile(
        `/service-records/${id}/pdf`,
        `progress-note-${id}.pdf`,
        { download: 1 }
      );
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <div>
      <div
        className={`mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 ${
          fixedClientId ? "xl:grid-cols-6" : "xl:grid-cols-7"
        }`}
      >
        <label className="relative col-span-2">
          <span className="sr-only">Search notes</span>
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#93a0a4]"
          />
          <input
            type="search"
            className="input !pl-8"
            placeholder="Search what was written, a date or a name"
            value={filters.q}
            onChange={event => set({ q: event.target.value })}
          />
        </label>
        {!fixedClientId && (
          <select
            className="select"
            aria-label="Participant"
            value={filters.clientId}
            onChange={event => set({ clientId: event.target.value })}
          >
            <option value="">Every participant</option>
            {(participants.data?.items ?? []).map(person => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="select"
          aria-label="Support worker"
          value={filters.staffId}
          onChange={event => set({ staffId: event.target.value })}
        >
          <option value="">Every support worker</option>
          {(staff.data ?? []).map(member => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Status"
          value={filters.status}
          onChange={event => set({ status: event.target.value })}
        >
          {STATUS_CHOICES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="input"
          aria-label="From date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={event => set({ from: event.target.value })}
        />
        <input
          type="date"
          className="input"
          aria-label="To date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={event => set({ to: event.target.value })}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#7c8a90]">
        <span>
          {records.data
            ? `${records.data.total} note${records.data.total === 1 ? "" : "s"}${
                filtered
                  ? records.data.total === 1
                    ? " matches"
                    : " match"
                  : ""
              }`
            : ""}
          {filtered && (
            <button
              type="button"
              className="ml-2 !font-semibold text-[#277c76] underline"
              onClick={() =>
                onChange({ ...NO_NOTE_FILTERS, clientId: filters.clientId })
              }
            >
              Clear filters
            </button>
          )}
        </span>
        {canCreate && (
          <Btn onClick={() => navigate(newHref)}>
            <Plus size={14} /> New progress note
          </Btn>
        )}
      </div>

      {records.isPending ? (
        <LoadingBlock label="Loading progress notes…" />
      ) : records.isError ? (
        <ErrorBlock error={records.error} onRetry={() => records.refetch()} />
      ) : !records.data.items.length ? (
        <EmptyState
          title={filtered ? "No notes match" : "No progress notes yet"}
          text={
            filtered
              ? "Try a different search, or clear the filters."
              : "Progress notes written for a shift appear here."
          }
        />
      ) : (
        <div className="space-y-3">
          {records.data.items.map(record => (
            <article
              key={record.id}
              className="rounded-md border border-[#e7ece9] bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#344854]">
                    {prettyDate(record.date)} · {record.start}–{record.end} ·{" "}
                    {record.type}
                  </div>
                  <div className="mt-1 text-[10px] text-[#87949a]">
                    {record.id}
                    {!fixedClientId && ` · ${record.clientFullName}`} ·{" "}
                    {record.staffName}
                    {record.shiftId ? ` · shift ${record.shiftId}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <NoteFlags record={record} />
                  <Status value={record.status} />
                </div>
              </div>
              <p className="mt-3 line-clamp-3 whitespace-pre-line text-xs leading-5 text-[#586b73]">
                {record.summary ||
                  record.support ||
                  "The progress note has not been written yet."}
              </p>
              {record.followUp && (
                <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-[#7c8a90]">
                  <span className="font-semibold">Handover:</span>{" "}
                  {record.followUp}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                <Link
                  href={`/app/records/${record.id}`}
                  className="font-semibold text-[#277c76]"
                >
                  Open note
                </Link>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 !font-semibold text-[#277c76]"
                  onClick={() => void exportPdf(record.id)}
                >
                  <Download size={12} /> PDF
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** Clients → a participant → Progress notes: that participant's history, searchable. */
export function ParticipantNotes({
  clientId,
  active,
}: {
  clientId: string;
  active: boolean;
}) {
  const [filters, setFilters] = useState<NoteFilters>(NO_NOTE_FILTERS);
  return (
    <NotesBrowser
      filters={filters}
      onChange={setFilters}
      fixedClientId={clientId}
      canCreate={active}
    />
  );
}
