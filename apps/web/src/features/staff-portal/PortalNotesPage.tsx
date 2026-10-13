import { ChevronRight, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { RECORD_STATUSES } from "@shared/enums";
import { usePortalNotes } from "@/api/hooks";
import { ErrorBlock, LoadingBlock } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import { Chip, Empty, toneFor } from "./kit";

const FILTERS = ["All", ...RECORD_STATUSES] as const;

/** Every progress note the worker has written, newest first. */
export default function PortalNotesPage() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("All");
  const [q, setQ] = useState("");
  const notes = usePortalNotes({
    status: status === "All" ? undefined : status,
    q: q.trim().length > 1 ? q.trim() : undefined,
  });

  return (
    <>
      <label className="relative mb-3 block">
        <span className="sr-only">Search your notes</span>
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#93a0a4]"
        />
        <input
          type="search"
          className="h-10 w-full rounded-lg border border-[#dbe4e0] bg-white pl-9 pr-3 text-[13px] text-[#24363f]"
          placeholder="Search by participant, date or what you wrote"
          value={q}
          onChange={event => setQ(event.target.value)}
        />
      </label>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => setStatus(option)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ${
              status === option
                ? "bg-[#12766f] text-white"
                : "border border-[#dbe4e0] bg-white text-[#54636b]"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {notes.isPending ? (
        <LoadingBlock label="Loading your notes…" />
      ) : notes.isError ? (
        <ErrorBlock error={notes.error} onRetry={() => void notes.refetch()} />
      ) : !notes.data.length ? (
        <Empty>
          {q.trim().length > 1
            ? "No notes match that search."
            : status === "All"
              ? "You haven't written any progress notes yet."
              : `No ${status.toLowerCase()} notes.`}
        </Empty>
      ) : (
        <div className="portal-card !p-0">
          {notes.data.map(note => (
            <Link
              key={note.id}
              href={`/staff/notes/${note.id}`}
              className="portal-row px-4 no-underline"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-[12px] text-[#16323a]">
                    {note.clientName}
                  </b>
                  <Chip tone={toneFor(note.status)}>{note.status}</Chip>
                  {note.amended && <Chip tone="info">Amended</Chip>}
                </span>
                <small className="mt-0.5 block text-[11px] text-[#7a888d]">
                  {prettyDate(note.date)} · {note.type} · {note.hours} hr
                </small>
                {note.status === "Returned" && note.correction && (
                  <small className="mt-1 block text-[11px] leading-4 text-[#8a5a22]">
                    {note.correction}
                  </small>
                )}
              </span>
              <ChevronRight size={15} className="shrink-0 text-[#9aa7ab]" />
            </Link>
          ))}
        </div>
      )}

      <div className="portal-sticky">
        <Link href="/staff/notes/new" className="portal-primary no-underline">
          <Plus size={16} /> New progress note
        </Link>
      </div>
    </>
  );
}
