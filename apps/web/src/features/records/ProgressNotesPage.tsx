import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useNotesOverview } from "@/api/hooks";
import { ErrorBlock, Panel, SectionHeading } from "@/components/app/ui";
import { prettyDate } from "@/lib/format";
import {
  NO_NOTE_FILTERS,
  NotesBrowser,
  type NoteFilters,
} from "./NotesBrowser";

/**
 * The team leader's view of progress notes: what was written today, what is still a draft, which
 * finished shifts have no note at all, and which notes need a person to look at them.
 */
export default function ProgressNotesPage() {
  const flag = new URLSearchParams(useSearch()).get("flag");
  const [filters, setFilters] = useState<NoteFilters>({
    ...NO_NOTE_FILTERS,
    status: flag ? `flag:${flag}` : "",
  });
  const overview = useNotesOverview({
    clientId: filters.clientId || undefined,
    staffId: filters.staffId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  });
  const data = overview.data;
  const show = (status: string) => setFilters({ ...filters, status });

  const tiles: Array<{
    label: string;
    value: number | undefined;
    hint: string;
    tone: string;
    onClick?: () => void;
  }> = [
    {
      label: "Completed today",
      value: data?.completedToday,
      hint: "Notes submitted today",
      tone: "text-[#1f6f5b]",
    },
    {
      label: "Awaiting submission",
      value: data?.awaitingSubmission,
      hint: "Drafts and notes sent back",
      tone: "text-[#8a5a22]",
      onClick: () => show("open"),
    },
    {
      label: "Missing notes",
      value: data?.missing,
      hint: "Finished shifts with no note",
      tone: data?.missing ? "text-[#a84540]" : "text-[#1f6f5b]",
      onClick: () =>
        document
          .getElementById("missing-notes")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      label: "Needs review",
      value: data?.needsReview,
      hint: "Submitted, not yet reviewed",
      tone: "text-[#276696]",
      onClick: () => show("Submitted"),
    },
    {
      label: "Health or incident",
      value: data?.flagged,
      hint: "Flagged on a note awaiting review",
      tone: data?.flagged ? "text-[#a84540]" : "text-[#1f6f5b]",
      onClick: () => show("flag:attention"),
    },
    {
      label: "Amendment requests",
      value: data?.amendmentRequests,
      hint: "Workers asking for a correction",
      tone: "text-[#66539b]",
      onClick: () => show("flag:requests"),
    },
  ];

  return (
    <>
      <SectionHeading
        title="Progress notes"
        subtitle="Every note written for a shift. Filter by participant, support worker, dates or status; the numbers follow the participant, worker and dates you choose."
        actions={
          <Link
            href="/app/review"
            className="text-xs font-semibold text-[#277c76]"
          >
            Open the review queue
          </Link>
        }
      />
      {overview.isError && (
        <ErrorBlock error={overview.error} onRetry={() => overview.refetch()} />
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(tile => {
          const body = (
            <>
              <span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[#7c8a90]">
                {tile.label}
              </span>
              <span className={`mt-1 block text-[24px] font-bold ${tile.tone}`}>
                {tile.value ?? "–"}
              </span>
              <span className="mt-0.5 block text-[10px] font-normal text-[#8a969b]">
                {tile.hint}
              </span>
            </>
          );
          // A button centres what is inside it; the column keeps every tile's label on one line.
          const frame =
            "flex h-full flex-col items-start justify-start rounded-md border border-[#e3e9e6] bg-white p-3 text-left";
          return tile.onClick ? (
            <button
              key={tile.label}
              type="button"
              className={`${frame} hover:border-[#a9c6bf]`}
              onClick={tile.onClick}
            >
              {body}
            </button>
          ) : (
            <div key={tile.label} className={frame}>
              {body}
            </div>
          );
        })}
      </div>

      {data && data.missingNotes.length > 0 && (
        <div id="missing-notes" className="mb-5 scroll-mt-24">
          <Panel
            title={`Missing progress notes (${data.missing})`}
            action={
              <span className="text-[10px] text-[#8a969b]">
                Shifts from {prettyDate(data.from)} to {prettyDate(data.to)}
              </span>
            }
          >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Participant</th>
                    <th>Support worker</th>
                    <th>Service</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.missingNotes.map(item => (
                    <tr key={`${item.shiftId}-${item.clientId}`}>
                      <td>
                        {prettyDate(item.date)}
                        <small className="mt-1 block text-[10px] text-[#87949a]">
                          {item.start}–{item.end} · {item.shiftId}
                        </small>
                      </td>
                      <td>{item.clientName}</td>
                      <td>{item.staffName}</td>
                      <td>
                        {item.type}
                        {item.overdue && (
                          <span className="badge badge-danger ml-2">
                            Overdue
                          </span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/app/records/new?clientId=${item.clientId}&shiftId=${item.shiftId}&date=${item.date}`}
                          className="text-xs font-semibold text-[#277c76]"
                        >
                          Write note
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      <NotesBrowser filters={filters} onChange={setFilters} />
    </>
  );
}
