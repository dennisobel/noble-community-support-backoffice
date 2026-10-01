import {
  CircleDollarSign,
  Download,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { downloadFile, errorMessage } from "@/api/client";
import { useReports } from "@/api/hooks";
import {
  Btn,
  ErrorBlock,
  LoadingBlock,
  Panel,
  SectionHeading,
} from "@/components/app/ui";
import { money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const EXPORTS = [
  { report: "service-records", label: "Service records" },
  { report: "billing", label: "Invoices" },
  { report: "transport", label: "Transport" },
  { report: "documentation", label: "Documentation status" },
];

export default function ReportsPage() {
  const notify = useNotify();
  const [period, setPeriod] = useState("last30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [team, setTeam] = useState("");
  const [applied, setApplied] = useState({
    period: "last30",
    from: "",
    to: "",
    team: "",
  });
  const [exportOpen, setExportOpen] = useState(false);
  const reports = useReports({
    period: applied.period,
    from: applied.from || undefined,
    to: applied.to || undefined,
    team: applied.team || undefined,
  });
  const data = reports.data;
  const maxWeek = Math.max(
    1,
    ...(data?.serviceActivity.map(week => week.count) ?? [1])
  );
  const docTotal = Math.max(1, data?.documentationStatus.total ?? 1);

  const apply = () => {
    if (period === "custom" && (!from || !to || from > to))
      return notify(
        "Choose a start and end date for a custom period.",
        "error"
      );
    setApplied({
      period,
      from: period === "custom" ? from : "",
      to: period === "custom" ? to : "",
      team,
    });
  };
  const exportCsv = async (report: string, label: string) => {
    setExportOpen(false);
    try {
      await downloadFile("/reports/export", `noble-${report}.csv`, {
        report,
        period: applied.period,
        from: applied.from || undefined,
        to: applied.to || undefined,
        team: applied.team || undefined,
      });
      notify(`${label} exported.`);
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <>
      <SectionHeading
        title="Operational reports"
        subtitle={
          data
            ? `Service activity, documentation health and billing readiness · ${data.range.label} (${prettyDate(data.range.from)} – ${prettyDate(data.range.to)})`
            : "Service activity, documentation health and billing readiness."
        }
        actions={
          <div className="relative">
            <Btn
              variant="secondary"
              onClick={() => setExportOpen(value => !value)}
            >
              <Download size={14} />
              Export report
            </Btn>
            {exportOpen && (
              <div className="absolute right-0 top-11 z-40 w-[220px] overflow-hidden rounded-lg border border-[#e2e8e5] bg-white shadow-[0_14px_40px_rgba(20,40,45,.14)]">
                {EXPORTS.map(item => (
                  <button
                    key={item.report}
                    className="block w-full px-4 py-2.5 text-left text-xs text-[#344854] hover:bg-[#f5f9f7]"
                    onClick={() => void exportCsv(item.report, item.label)}
                  >
                    {item.label} (CSV)
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <select
          className="select w-[155px]"
          value={period}
          onChange={event => setPeriod(event.target.value)}
          aria-label="Report period"
        >
          <option value="last30">Last 30 days</option>
          <option value="month">This month</option>
          <option value="quarter">This quarter</option>
          <option value="custom">Custom range</option>
        </select>
        {period === "custom" && (
          <>
            <input
              className="input w-[150px]"
              type="date"
              value={from}
              onChange={event => setFrom(event.target.value)}
              aria-label="From"
            />
            <input
              className="input w-[150px]"
              type="date"
              value={to}
              onChange={event => setTo(event.target.value)}
              aria-label="To"
            />
          </>
        )}
        <select
          className="select w-[180px]"
          value={team}
          onChange={event => setTeam(event.target.value)}
          aria-label="Team"
        >
          <option value="">All teams</option>
          {data?.teams.map(name => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <Btn variant="secondary" onClick={apply}>
          <SlidersHorizontal size={14} />
          Apply
        </Btn>
      </div>
      {reports.isError && (
        <ErrorBlock error={reports.error} onRetry={() => reports.refetch()} />
      )}
      {reports.isPending ? (
        <LoadingBlock label="Building reports…" />
      ) : (
        data && (
          <div
            className={`grid grid-cols-1 gap-5 lg:grid-cols-2 ${reports.isFetching ? "opacity-70" : ""}`}
          >
            <Panel title="Service activity by week">
              <div className="p-5">
                <div className="flex h-[190px] items-end justify-around gap-2 border-b border-l border-[#e5ebe8] px-2 pb-1">
                  {data.serviceActivity.map(week => (
                    <div
                      key={week.weekStart}
                      className="flex h-full w-full max-w-12 flex-col items-center justify-end gap-2"
                      title={`Week of ${prettyDate(week.weekStart)}: ${week.count} services`}
                    >
                      <span className="text-[9px] text-[#7e8d94]">
                        {week.count}
                      </span>
                      <div
                        className="w-full rounded-t bg-[#65aaa1] transition-all hover:bg-[#31857b]"
                        style={{
                          height: `${Math.max(2, (week.count / maxWeek) * 90)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-around gap-2 text-[9px] text-[#89969b]">
                  {data.serviceActivity.map(week => (
                    <span
                      key={week.weekStart}
                      className="w-full max-w-12 text-center"
                    >
                      {week.label}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] text-[#74828a]">
                  <span className="h-2 w-2 rounded-sm bg-[#65aaa1]" />
                  Services submitted, approved or invoiced (by week starting)
                </div>
              </div>
            </Panel>
            <Panel title="Documentation status">
              <div className="space-y-5 p-5">
                {(
                  [
                    [
                      "Approved / invoiced",
                      data.documentationStatus.approvedOrInvoiced,
                      "#278268",
                    ],
                    [
                      "Submitted for review",
                      data.documentationStatus.submitted,
                      "#3981a6",
                    ],
                    [
                      "Draft or returned",
                      data.documentationStatus.draftOrReturned,
                      "#ce9a3d",
                    ],
                  ] as const
                ).map(([label, value, color]) => (
                  <div key={label}>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-[#596c74]">{label}</span>
                      <b>{value}</b>
                    </div>
                    <div className="h-2 rounded-full bg-[#edf1ef]">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${value ? Math.max(4, (value / docTotal) * 100) : 0}%`,
                          background: color,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="rounded-md bg-[#f6f8f7] p-3 text-[10px] text-[#79878d]">
                  {data.documentationStatus.total} records in this period ·{" "}
                  {data.documentationStatus.returned} awaiting correction ·{" "}
                  <Link
                    href="/app/review?status=Returned"
                    className="font-semibold text-[#277c76]"
                  >
                    open returned records
                  </Link>
                </div>
              </div>
            </Panel>
            <Panel title="Billing readiness">
              <div className="p-5">
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <div className="text-2xl font-semibold text-[#2f4c58]">
                      {data.billingReadiness.approvedNotInvoiced}
                    </div>
                    <div className="text-[10px] text-[#819097]">
                      approved, not yet invoiced ·{" "}
                      {money(data.billingReadiness.value)}
                    </div>
                  </div>
                  <CircleDollarSign size={27} className="text-[#55978d]" />
                </div>
                <div className="table-wrap">
                  <table className="data-table !min-w-0">
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Ready records</th>
                        <th>Est. value</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.billingReadiness.rows.map(row => (
                        <tr key={row.participantId}>
                          <td>{row.name}</td>
                          <td>{row.readyRecords}</td>
                          <td>{money(row.value)}</td>
                          <td>
                            <Link
                              href={`/app/invoices/new?clientId=${row.participantId}`}
                              className="text-[11px] font-semibold text-[#277c76]"
                            >
                              Invoice
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.billingReadiness.rows.length && (
                    <p className="py-4 text-center text-[11px] text-[#87949a]">
                      Nothing is waiting to be invoiced.
                    </p>
                  )}
                </div>
              </div>
            </Panel>
            <Panel title="Transport activity">
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-[#edf5f3] text-[#448e83]">
                    <MapPin size={18} />
                  </div>
                  <div>
                    <div className="text-xl font-semibold">
                      {data.transport.totalKm.toFixed(1)} km
                    </div>
                    <div className="text-[10px] text-[#849198]">
                      provider travel recorded in this period
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {data.transport.recent.map(item => (
                    <Link
                      key={item.recordId}
                      href={`/app/records/${item.recordId}`}
                      className="flex justify-between border-b border-[#edf0ef] pb-2 text-[11px]"
                    >
                      <span className="text-[#657780]">
                        {item.clientName} · {item.recordId} ·{" "}
                        {prettyDate(item.date)}
                      </span>
                      <span className="font-semibold">
                        {item.km.toFixed(1)} km
                      </span>
                    </Link>
                  ))}
                  {!data.transport.recent.length && (
                    <p className="text-[11px] text-[#87949a]">
                      No travel recorded in this period.
                    </p>
                  )}
                </div>
              </div>
            </Panel>
          </div>
        )
      )}
    </>
  );
}
