import {
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Info,
  Mic,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useDashboard, useMeta } from "@/api/hooks";
import {
  Btn,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Panel,
  SectionHeading,
  Status,
} from "@/components/app/ui";
import { useAuth } from "@/lib/auth";
import { firstName, greeting, money, prettyDate, timeAgo } from "@/lib/format";

const ACTIVITY_DOT: Record<string, string> = {
  record: "#e1aa53",
  invoice: "#8d81ba",
  participant: "#5eaaa2",
  default: "#5eaaa2",
};

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { session } = useAuth();
  const dashboard = useDashboard();
  const meta = useMeta();
  const data = dashboard.data;

  const tiles = data
    ? [
        {
          label: "Awaiting review",
          value: data.kpis.awaitingReview,
          hint: "service records submitted",
          icon: ClipboardCheck,
          tone: "bg-[#eaf3f8] text-[#397596]",
          href: "/app/review",
        },
        {
          label: "Needs completion",
          value: data.kpis.needsCompletion,
          hint: "drafts or returned notes",
          icon: FileText,
          tone: "bg-[#fff4de] text-[#a87723]",
          href: "/app/review?status=Draft,Returned",
        },
        {
          label: "Ready to invoice",
          value: data.kpis.readyToInvoice,
          hint: "approved service records",
          icon: CircleDollarSign,
          tone: "bg-[#edf6ef] text-[#39825b]",
          href: "/app/invoices/new",
        },
        {
          label: "Active participants",
          value: data.kpis.activeParticipants,
          hint: "across all support teams",
          icon: Users,
          tone: "bg-[#f0edfa] text-[#7565a3]",
          href: "/app/clients",
        },
      ]
    : [];

  return (
    <>
      <SectionHeading
        title={`${greeting()}, ${firstName(session?.user.name ?? "")}`}
        subtitle="Here’s what needs your attention today."
        actions={
          <>
            <Btn
              variant="secondary"
              onClick={() => navigate("/app/voice/record")}
            >
              <Mic size={15} />
              Record voice note
            </Btn>
            <Btn onClick={() => navigate("/app/records/new")}>
              <Plus size={16} />
              New service record
            </Btn>
          </>
        }
      />
      {dashboard.isPending && <LoadingBlock label="Loading your dashboard…" />}
      {dashboard.isError && (
        <ErrorBlock
          error={dashboard.error}
          onRetry={() => dashboard.refetch()}
        />
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map(({ label, value, hint, icon: Icon, tone, href }) => (
              <Link
                key={label}
                href={href}
                className="panel block p-4 transition hover:border-[#bfd9d3]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#77858d]">{label}</span>
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-md ${tone}`}
                  >
                    <Icon size={16} />
                  </span>
                </div>
                <div className="stat-number mt-2">{value}</div>
                <div className="mt-1 text-[10px] text-[#87939a]">{hint}</div>
              </Link>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_1fr]">
            <Panel
              title="Action queue"
              action={
                <Link
                  href="/app/review"
                  className="text-[11px] font-semibold text-[#277c76]"
                >
                  Open review queue{" "}
                  <ArrowRight size={12} className="ml-1 inline" />
                </Link>
              }
            >
              <div className="divide-y divide-[#edf0ef]">
                {data.actionQueue.map(item => (
                  <button
                    key={item.recordId}
                    onClick={() =>
                      navigate(
                        item.status === "Submitted"
                          ? `/app/review?open=${item.recordId}`
                          : `/app/records/${item.recordId}`
                      )
                    }
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#fbfcfb]"
                  >
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full ${
                        item.status === "Returned"
                          ? "bg-[#fff2dc] text-[#aa741b]"
                          : item.status === "Draft"
                            ? "bg-[#f1f3f3] text-[#738088]"
                            : "bg-[#e9f3fa] text-[#3b7692]"
                      }`}
                    >
                      {item.status === "Returned" ? (
                        <Info size={15} />
                      ) : item.status === "Draft" ? (
                        <Pencil size={14} />
                      ) : (
                        <ClipboardCheck size={15} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-[#344753]">
                        {item.status === "Returned"
                          ? "Correction requested"
                          : item.status === "Draft"
                            ? "Draft needs completion"
                            : "Review service record"}{" "}
                        · {item.recordId}
                      </span>
                      <span className="mt-1 block text-[10px] text-[#86939a]">
                        {item.clientName} · {prettyDate(item.date)}
                      </span>
                    </span>
                    <Status value={item.status} />
                    <ChevronRight size={15} className="text-[#98a3a7]" />
                  </button>
                ))}
              </div>
              {!data.actionQueue.length && (
                <EmptyState
                  title="All caught up"
                  text="There are no records waiting for your attention."
                />
              )}
            </Panel>

            <div className="flex flex-col gap-5">
              <Panel
                title="Today’s services"
                action={
                  <Link
                    href="/app/roster"
                    className="text-[11px] font-semibold text-[#277c76]"
                  >
                    Open roster
                  </Link>
                }
              >
                <div className="divide-y divide-[#edf0ef]">
                  {data.todayShifts.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-5 py-3.5"
                    >
                      <div className="w-11 text-center">
                        <div className="text-xs font-bold text-[#344b57]">
                          {item.start}
                        </div>
                        <div className="text-[9px] text-[#95a0a4]">
                          {item.end}
                        </div>
                      </div>
                      <div className="h-8 w-0.5 rounded bg-[#83bdb4]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-[#394d57]">
                          {item.title}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-[#87949b]">
                          {item.location || "Location to confirm"}
                        </div>
                      </div>
                      <button
                        className="icon-btn"
                        onClick={() =>
                          navigate(
                            item.recordId
                              ? `/app/records/${item.recordId}`
                              : "/app/roster"
                          )
                        }
                        aria-label={
                          item.recordId
                            ? `Open ${item.recordId}`
                            : `Open ${item.id} in the roster`
                        }
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                {!data.todayShifts.length && (
                  <EmptyState
                    title="Nothing rostered today"
                    text="Shifts planned for today will appear here."
                  />
                )}
              </Panel>
              <Panel title="Documentation health">
                <div className="p-5">
                  <div className="flex items-end justify-between">
                    <span className="text-[11px] text-[#71818a]">
                      Complete notes in the last 7 days
                    </span>
                    <span className="text-lg font-semibold text-[#276c67]">
                      {data.documentationHealth.total
                        ? `${data.documentationHealth.completePct}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eaf0ee]">
                    <div
                      className="h-full rounded-full bg-[#49a295]"
                      style={{
                        width: `${data.documentationHealth.completePct}%`,
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[#829097]">
                    <span>
                      {data.documentationHealth.total
                        ? `${data.documentationHealth.complete} of ${data.documentationHealth.total} records submitted or approved`
                        : "No service records in the last 7 days"}
                    </span>
                    <Link
                      href="/app/reports"
                      className="font-semibold text-[#277c76]"
                    >
                      View report
                    </Link>
                  </div>
                </div>
              </Panel>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
            <Panel
              title="Billing snapshot"
              action={
                <Link
                  href="/app/invoices"
                  className="text-[11px] font-semibold text-[#277c76]"
                >
                  Open invoices <ArrowRight size={12} className="ml-1 inline" />
                </Link>
              }
            >
              <div className="grid grid-cols-3 gap-3 p-5">
                <div>
                  <div className="text-[10px] text-[#87949a]">
                    Awaiting invoice
                  </div>
                  <div className="mt-1 text-lg font-semibold text-[#344854]">
                    {data.billing.awaitingInvoice}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#87949a]">
                    Draft invoices
                  </div>
                  <div className="mt-1 text-lg font-semibold text-[#344854]">
                    {data.billing.draftInvoices}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#87949a]">Outstanding</div>
                  <div className="mt-1 text-lg font-semibold text-[#344854]">
                    {money(data.billing.outstanding)}
                  </div>
                </div>
              </div>
            </Panel>
            <Panel
              title="Recent activity"
              action={
                <Link
                  href="/app/settings/privacy"
                  className="text-[11px] font-semibold text-[#277c76]"
                >
                  Audit log
                </Link>
              }
            >
              <div className="space-y-3 px-5 py-4">
                {data.recentActivity.map(entry => (
                  <div key={entry.id} className="flex gap-3">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background:
                          ACTIVITY_DOT[entry.entityType.split("_")[0]] ??
                          ACTIVITY_DOT.default,
                      }}
                    />
                    <p className="text-[11px] text-[#576872]">
                      <b>{entry.actor?.name ?? "System"}</b> {entry.summary}{" "}
                      <span className="text-[#95a0a4]">
                        · {timeAgo(entry.at)}
                      </span>
                    </p>
                  </div>
                ))}
                {!data.recentActivity.length && (
                  <p className="text-[11px] text-[#87949a]">
                    Activity will appear here as the team works.
                  </p>
                )}
              </div>
            </Panel>
          </div>

          {meta.data &&
            (meta.data.features.sttProvider === "mock" ||
              meta.data.features.noteProvider === "mock") && (
              <div className="mt-5 rounded-lg border border-[#d9e9e5] bg-[#edf6f3] px-4 py-3 text-[11px] text-[#42615f]">
                <Info size={14} className="mr-2 inline" />
                Voice transcription and note drafting are using demo providers.
                Configure STT_PROVIDER and NOTE_PROVIDER on the server to use
                real services.
              </div>
            )}
        </>
      )}
    </>
  );
}
