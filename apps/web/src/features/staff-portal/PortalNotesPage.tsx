import { ChevronRight, Plus } from "lucide-react";
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
  const notes = usePortalNotes(status === "All" ? {} : { status });

  return (
    <>
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
          {status === "All"
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
