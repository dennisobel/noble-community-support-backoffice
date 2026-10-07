import { Car, ClipboardList, ShieldAlert, Siren } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import type { AbcReportDTO, IncidentReportDTO } from "@shared/dto";
import { errorMessage } from "@/api/client";
import {
  useAdminAbc,
  useAdminIncidents,
  useAdminLogbook,
  useReviewReport,
} from "@/api/hooks";
import {
  Btn,
  Drawer,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Panel,
  SectionHeading,
  Status,
} from "@/components/app/ui";
import { formatDateTime, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import ReportablePanel from "./ReportablePanel";

type Tab = "incidents" | "abc" | "logbook";

const TABS: Array<{ key: Tab; label: string; icon: typeof ShieldAlert }> = [
  { key: "incidents", label: "Incidents", icon: ShieldAlert },
  { key: "abc", label: "ABC reports", icon: ClipboardList },
  { key: "logbook", label: "KM logbook", icon: Car },
];

/** Read a worker's report in full and move it through review. */
function ReportDrawer({
  report,
  kind,
  onClose,
}: {
  report: IncidentReportDTO | AbcReportDTO;
  kind: "incidents" | "abc-reports";
  onClose: () => void;
}) {
  const review = useReviewReport(kind);
  const notify = useNotify();
  const [note, setNote] = useState(report.reviewNote ?? "");
  const [error, setError] = useState("");

  const move = async (status: "Reviewed" | "Closed") => {
    setError("");
    try {
      await review.mutateAsync({
        id: report.id,
        status,
        note,
        rev: report.rev,
      });
      notify(`Marked ${status.toLowerCase()}.`);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const incident = "category" in report ? report : null;
  const abc = "behaviour" in report ? report : null;

  const rows: Array<[string, string]> = incident
    ? [
        ["What happened", incident.description],
        ["Injuries", incident.injuries],
        ["Medical details", incident.medicalDetails],
        ["Immediate actions", incident.immediateActions],
        ["Witness", incident.witness],
        ["Who was told", incident.notified.join(", ")],
        ["Follow-up", incident.followUp],
      ]
    : abc
      ? [
          ["Antecedent", abc.antecedent],
          ["Behaviour", abc.behaviourDescription],
          ["Consequence", abc.consequence],
          ["Staff response", abc.staffResponse],
          ["Outcome", abc.outcome],
          ["Prevention plan", abc.preventionPlan],
        ]
      : [];

  return (
    <Drawer
      title={incident ? incident.category : (abc?.behaviour ?? "Report")}
      eyebrow={`${report.staffName} · ${prettyDate(report.date)} ${report.time}`}
      subtitle={
        report.participantName
          ? `About ${report.participantName}`
          : "No participant recorded"
      }
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Btn variant="secondary" onClick={onClose}>
            Close
          </Btn>
          {report.status !== "Closed" && (
            <>
              <Btn
                variant="secondary"
                onClick={() => void move("Reviewed")}
                loading={review.isPending}
              >
                Mark reviewed
              </Btn>
              <Btn
                onClick={() => void move("Closed")}
                loading={review.isPending}
              >
                Close report
              </Btn>
            </>
          )}
        </div>
      }
    >
      <Panel title="Details">
        <dl className="space-y-4 p-5">
          {incident && (
            <div className="flex flex-wrap gap-2">
              <Status value={incident.severity} />
              <Status value={incident.status} />
              {incident.medicalAttention && (
                <span className="badge badge-danger">Medical attention</span>
              )}
            </div>
          )}
          {abc && (
            <div className="flex flex-wrap gap-2">
              <span className="badge badge-draft">
                Intensity {abc.intensity}
              </span>
              <span className="badge badge-draft">
                {abc.durationMinutes} min
              </span>
              <Status value={abc.status} />
            </div>
          )}
          {report.location && (
            <div>
              <dt className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                Location
              </dt>
              <dd className="mt-0.5 text-xs text-[#4f6169]">
                {report.location}
              </dd>
            </div>
          )}
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] uppercase tracking-[.06em] text-[#849198]">
                  {label}
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-xs leading-5 text-[#4f6169]">
                  {value}
                </dd>
              </div>
            ))}
        </dl>
      </Panel>

      {incident && <ReportablePanel incident={incident} />}

      <Panel title="Review" className="mt-4">
        <div className="p-5">
          <label className="label">
            Note back to the worker
            <textarea
              className="textarea mt-1 !min-h-[70px]"
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="What you did with this, or what you still need."
            />
          </label>
          {report.reviewedBy && (
            <p className="mt-3 text-[10px] text-[#849198]">
              Last reviewed by {report.reviewedBy.name} ·{" "}
              {formatDateTime(report.reviewedAt)}
            </p>
          )}
          <FormAlert message={error} />
        </div>
      </Panel>
    </Drawer>
  );
}

/** Everything workers have filed from their portal, for the office to read and close off. */
export default function WorkerReportsPage() {
  const params = useParams<{ section?: string }>();
  const tab = (TABS.find(item => item.key === params.section)?.key ??
    "incidents") as Tab;
  const incidents = useAdminIncidents();
  const abc = useAdminAbc();
  const logbook = useAdminLogbook();
  const [open, setOpen] = useState<{
    report: IncidentReportDTO | AbcReportDTO;
    kind: "incidents" | "abc-reports";
  } | null>(null);
  // A notification or a linked complaint can point straight at one incident.
  const wanted = new URLSearchParams(useSearch()).get("open");
  useEffect(() => {
    const report = wanted && incidents.data?.find(row => row.id === wanted);
    if (report) setOpen({ report, kind: "incidents" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, Boolean(incidents.data)]);
  // The drawer shows the list's latest copy, so a change made inside it is seen at once.
  const opened =
    open &&
    ((open.kind === "incidents" ? incidents.data : abc.data)?.find(
      row => row.id === open.report.id
    ) ??
      open.report);

  const active =
    tab === "incidents" ? incidents : tab === "abc" ? abc : logbook;

  return (
    <>
      <SectionHeading
        title="Worker reports"
        subtitle="Incidents, behaviour records and kilometres filed by support workers from their portal."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(item => {
          const Icon = item.icon;
          const count =
            item.key === "incidents"
              ? incidents.data?.filter(r => r.status === "Submitted").length
              : item.key === "abc"
                ? abc.data?.filter(r => r.status === "Submitted").length
                : undefined;
          return (
            <Link
              key={item.key}
              href={`/app/worker-reports/${item.key}`}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold no-underline ${
                tab === item.key
                  ? "bg-[#12766f] text-white"
                  : "border border-[#dde5e2] bg-white text-[#52666f]"
              }`}
            >
              <Icon size={14} />
              {item.label}
              {count ? (
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    tab === item.key
                      ? "bg-white/20"
                      : "bg-[#fdf0da] text-[#8a6224]"
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {active.isError && (
        <ErrorBlock error={active.error} onRetry={() => active.refetch()} />
      )}
      {active.isPending ? (
        <LoadingBlock />
      ) : tab === "logbook" ? (
        logbook.data?.length ? (
          <Panel title={`${logbook.data.length} entries`}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Worker</th>
                    <th>Participant</th>
                    <th>From → to</th>
                    <th>Purpose</th>
                    <th className="text-right">KM</th>
                    <th className="text-right">Tracked</th>
                  </tr>
                </thead>
                <tbody>
                  {logbook.data.map(entry => (
                    <tr key={entry.id}>
                      <td>{prettyDate(entry.date)}</td>
                      <td>{entry.staffName}</td>
                      <td>{entry.participantName || "—"}</td>
                      <td>
                        {entry.fromLocation || "—"} → {entry.toLocation || "—"}
                      </td>
                      <td>{entry.purpose || "—"}</td>
                      <td className="text-right font-semibold">
                        {entry.kilometres}
                      </td>
                      <td className="text-right text-[#849198]">
                        {entry.trackedKilometres ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <Panel>
            <EmptyState
              title="No logbook entries"
              text="Kilometres appear here when workers log them or finish a tracked shift."
            />
          </Panel>
        )
      ) : (
        (() => {
          const rows = tab === "incidents" ? incidents.data : abc.data;
          if (!rows?.length)
            return (
              <Panel>
                <EmptyState
                  title={
                    tab === "incidents"
                      ? "No incident reports"
                      : "No ABC reports"
                  }
                  text="Reports filed by workers in their portal show up here for review."
                />
              </Panel>
            );
          return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {rows.map(report => (
                <button
                  key={report.id}
                  type="button"
                  className="panel p-5 text-left hover:border-[#c9d9d5]"
                  onClick={() =>
                    setOpen({
                      report,
                      kind: tab === "incidents" ? "incidents" : "abc-reports",
                    })
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#354a56]">
                        {"category" in report
                          ? report.category
                          : report.behaviour}
                      </div>
                      <div className="mt-1 text-[10px] text-[#819097]">
                        {report.staffName} · {prettyDate(report.date)}{" "}
                        {report.time}
                      </div>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Status value={report.status} />
                      {"reportable" in report && report.reportable.flagged && (
                        <span
                          className={`badge ${report.reportable.next ? "badge-danger" : "badge-approved"}`}
                        >
                          <Siren size={11} />
                          {report.reportable.next
                            ? report.reportable.next.overdue
                              ? "Commission overdue"
                              : "Commission due"
                            : "Commission lodged"}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-3 border-t border-[#edf0ef] pt-3 text-xs leading-5 text-[#52666f]">
                    {"description" in report
                      ? report.description
                      : report.behaviourDescription}
                  </p>
                  {report.participantName && (
                    <div className="mt-2 text-[10px] text-[#849198]">
                      About {report.participantName}
                    </div>
                  )}
                </button>
              ))}
            </div>
          );
        })()
      )}

      {open && opened && (
        <ReportDrawer
          key={opened.id}
          report={opened}
          kind={open.kind}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
