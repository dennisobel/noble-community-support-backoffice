import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  Info,
  MapPin,
  Mic,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { KYC_ITEMS } from "@shared/enums";
import { errorMessage } from "@/api/client";
import {
  useArchiveParticipant,
  useParticipant,
  useRecords,
  useRestoreParticipant,
  useUpdateKyc,
} from "@/api/hooks";
import {
  Avatar,
  Btn,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
  Status,
} from "@/components/app/ui";
import BudgetManager from "@/features/budgets/BudgetManager";
import DocumentLibrary from "@/features/documents/DocumentLibrary";
import { prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";
import ParticipantFormDrawer from "./ParticipantFormDrawer";

const TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "support", label: "Support Information" },
  { slug: "records", label: "Service Records" },
  { slug: "notes", label: "Progress Notes" },
  { slug: "budget", label: "Budget" },
  { slug: "documents", label: "Documents" },
];

export default function ClientProfilePage() {
  const { id, tab = "overview" } = useParams<{ id: string; tab?: string }>();
  const [, navigate] = useLocation();
  const notify = useNotify();
  const participantQuery = useParticipant(id);
  const records = useRecords(
    { clientId: id, limit: 200 },
    { enabled: Boolean(id) }
  );
  const updateKyc = useUpdateKyc();
  const archive = useArchiveParticipant();
  const restore = useRestoreParticipant();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState("");
  const [archiveError, setArchiveError] = useState("");

  if (participantQuery.isPending)
    return <LoadingBlock label="Loading client profile…" />;
  if (participantQuery.isError)
    return (
      <ErrorBlock
        error={participantQuery.error}
        onRetry={() => participantQuery.refetch()}
      />
    );
  const client = participantQuery.data;
  const clientRecords = records.data?.items ?? [];
  const active = client.status === "Active";

  const toggleKyc = async (key: string, value: boolean) => {
    try {
      await updateKyc.mutateAsync({ id: client.id, [key]: value });
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };
  const doArchive = async () => {
    setArchiveError("");
    try {
      const result = await archive.mutateAsync({
        id: client.id,
        reason: reason.trim() || undefined,
      });
      setArchiving(false);
      notify(
        result.warnings.length
          ? `${client.preferred} archived. ${result.warnings.join(" ")}`
          : `${client.preferred}’s profile was archived.`,
        result.warnings.length ? "info" : "success"
      );
    } catch (failure) {
      setArchiveError(errorMessage(failure));
    }
  };

  return (
    <>
      <Link
        href="/app/clients"
        className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-[#277c76]"
      >
        <ArrowLeft size={14} />
        Back to clients
      </Link>
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 bg-[#f1f6f4] p-5 sm:p-6">
          <Avatar name={client.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="serif text-2xl font-medium text-[#213746]">
                {client.name}
              </h1>
              <Status
                value={client.status}
                label={active ? "Active participant" : "Archived"}
              />
            </div>
            <p className="mt-1 text-xs text-[#687b82]">
              Preferred name: {client.preferred} <span className="mx-1">·</span>{" "}
              NDIS {client.ndis} <span className="mx-1">·</span> Client{" "}
              {String(client.clientNumber).padStart(3, "0")}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#5e7078]">
              <span>
                <Phone size={12} className="mr-1 inline" />
                {client.phone || "No phone"}
              </span>
              <span>
                <Info size={12} className="mr-1 inline" />
                {client.email || "No email"}
              </span>
              <span>
                <MapPin size={12} className="mr-1 inline" />
                {client.address || "No address"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && (
              <>
                <Btn
                  variant="secondary"
                  onClick={() =>
                    navigate(`/app/voice/record?clientId=${client.id}`)
                  }
                >
                  <Mic size={14} />
                  Voice note
                </Btn>
                <Btn
                  onClick={() =>
                    navigate(`/app/records/new?clientId=${client.id}`)
                  }
                >
                  <Plus size={14} />
                  New record
                </Btn>
              </>
            )}
            <Btn variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit profile
            </Btn>
            {active ? (
              <Btn
                variant="quiet"
                onClick={() => setArchiving(true)}
                ariaLabel="Archive participant"
              >
                <Archive size={14} />
                Archive
              </Btn>
            ) : (
              <Btn
                variant="secondary"
                loading={restore.isPending}
                onClick={() =>
                  restore.mutate(client.id, {
                    onSuccess: () =>
                      notify(
                        `${client.preferred} restored to active participants.`
                      ),
                    onError: failure => notify(errorMessage(failure), "error"),
                  })
                }
              >
                <RotateCcw size={14} />
                Restore
              </Btn>
            )}
          </div>
        </div>
        {!active && (
          <div className="border-y border-[#e7e0f3] bg-[#f7f4fc] px-5 py-3 text-[11px] text-[#5d4f86]">
            <Archive size={14} className="mr-2 inline" />
            Archived{" "}
            {client.archivedAt
              ? prettyDate(client.archivedAt.slice(0, 10))
              : ""}
            {client.archivedReason ? ` · ${client.archivedReason}` : ""}.
            History is kept; new records, shifts and invoices are paused.
          </div>
        )}
        {client.alerts.length > 0 && (
          <div className="border-y border-[#f2dfba] bg-[#fff8e9] px-5 py-3 text-[11px] text-[#865e1e]">
            <ShieldAlert size={15} className="mr-2 inline" />
            <b>Important alerts</b>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 pl-6">
              {client.alerts.map(alert => (
                <span key={alert}>{alert}</span>
              ))}
            </div>
          </div>
        )}
        <div
          className="flex gap-1 overflow-x-auto border-b border-[#e8eeeb] px-4"
          role="tablist"
        >
          {TABS.map(item => (
            <Link
              key={item.slug}
              href={`/app/clients/${client.id}/${item.slug}`}
              role="tab"
              aria-selected={tab === item.slug}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-xs font-semibold ${tab === item.slug ? "border-[#31857d] text-[#276d68]" : "border-transparent text-[#76858b] hover:text-[#40545e]"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="p-5 sm:p-6">
          {tab === "overview" && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <h3 className="panel-title mb-3">Plan at a glance</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
                  {[
                    ["Plan period", client.plan],
                    [
                      "Date of birth",
                      client.dob ? prettyDate(client.dob) : "Not recorded",
                    ],
                    ["Plan manager", client.manager || "To confirm"],
                    ["Nominee / guardian", client.nominee || "Not recorded"],
                    ["Emergency contact", client.emergency || "Not recorded"],
                    [
                      "Plan manager email",
                      client.managerEmail || "Not recorded",
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="label">{label}</div>
                      <div className="break-words">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="panel-title mb-3">Current goals</h3>
                {client.goals.length ? (
                  <ul className="space-y-2">
                    {client.goals.map(goal => (
                      <li
                        key={goal}
                        className="flex gap-2 text-xs text-[#53656e]"
                      >
                        <CheckCircle2
                          size={14}
                          className="mt-0.5 shrink-0 text-[#4a978c]"
                        />
                        {goal}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[#829097]">
                    No goals recorded. Add them from Edit profile.
                  </p>
                )}
              </div>
              <div className="md:col-span-2">
                <h3 className="panel-title mb-3">Onboarding & KYC checklist</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {KYC_ITEMS.map(item => (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#e4ece8] bg-white p-3"
                    >
                      <input
                        type="checkbox"
                        checked={client.kyc[item.key]}
                        disabled={updateKyc.isPending}
                        onChange={event =>
                          void toggleKyc(item.key, event.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 accent-[#177d76]"
                      />
                      <span>
                        <b className="block text-[11px] text-[#465b65]">
                          {item.label}
                        </b>
                        <small className="mt-0.5 block text-[9px] text-[#87949a]">
                          {client.kyc[item.key]
                            ? "Received / confirmed"
                            : item.detail}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <h3 className="panel-title mb-3">Recent service activity</h3>
                {clientRecords.length ? (
                  <div className="space-y-2">
                    {clientRecords.slice(0, 3).map(record => (
                      <Link
                        key={record.id}
                        href={`/app/records/${record.id}`}
                        className="flex w-full items-center gap-3 rounded-md border border-[#e9eeec] p-3 text-left hover:bg-[#fafcfb]"
                      >
                        <FileText size={16} className="text-[#61978f]" />
                        <span className="flex-1">
                          <b className="block text-xs text-[#40535e]">
                            {record.type} · {prettyDate(record.date)}
                          </b>
                          <span className="text-[10px] text-[#829097]">
                            {record.id} · {record.staffName}
                          </span>
                        </span>
                        <Status value={record.status} />
                        <ChevronRight size={14} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#829097]">
                    No service records yet.
                  </p>
                )}
              </div>
            </div>
          )}
          {tab === "support" && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {[
                ["Support needs", client.support],
                ["Communication needs", client.communication],
                ["Mobility", client.mobility],
                ["Transport requirements", client.transport],
                ["Risks", client.risks],
                ["Allergies", client.allergies],
                ["Preferences", client.preferences],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="label">{label}</div>
                  <p className="whitespace-pre-line text-xs leading-5 text-[#576973]">
                    {value || "No information recorded."}
                  </p>
                </div>
              ))}
            </div>
          )}
          {tab === "records" && (
            <div className="table-wrap">
              {records.isPending ? (
                <LoadingBlock />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Service</th>
                      <th>Staff</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clientRecords.map(record => (
                      <tr key={record.id}>
                        <td>{prettyDate(record.date)}</td>
                        <td>
                          {record.type}
                          <small className="mt-1 block text-[10px] text-[#87949a]">
                            {record.id}
                          </small>
                        </td>
                        <td>{record.staffName}</td>
                        <td>
                          <Status value={record.status} />
                        </td>
                        <td>
                          <Link
                            href={`/app/records/${record.id}`}
                            className="text-xs font-semibold text-[#277c76]"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {records.data && !clientRecords.length && (
                <EmptyState
                  title="No service records yet"
                  text="Create a record from this client profile to start their service history."
                  action={
                    active ? (
                      <Btn
                        onClick={() =>
                          navigate(`/app/records/new?clientId=${client.id}`)
                        }
                      >
                        <Plus size={14} />
                        New service record
                      </Btn>
                    ) : undefined
                  }
                />
              )}
            </div>
          )}
          {tab === "notes" && (
            <div className="space-y-3">
              {clientRecords.length ? (
                clientRecords.map(record => (
                  <article
                    key={record.id}
                    className="rounded-md border border-[#e7ece9] bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-[#344854]">
                          {record.type} · {prettyDate(record.date)}
                        </div>
                        <div className="mt-1 text-[10px] text-[#87949a]">
                          {record.id} · {record.staffName}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Status value={record.status} />
                        <Link
                          href={`/app/records/${record.id}`}
                          className="text-[10px] font-semibold text-[#277c76]"
                        >
                          Open note
                        </Link>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#586b73]">
                      {record.support || "Progress note not started."}
                    </p>
                    {record.outcome && (
                      <p className="mt-2 text-[10px] text-[#7c8a90]">
                        Goal / outcome: {record.outcome}
                      </p>
                    )}
                  </article>
                ))
              ) : (
                <EmptyState
                  title="No progress notes yet"
                  text="Progress notes created for this client will appear here."
                  action={
                    active ? (
                      <Btn
                        onClick={() =>
                          navigate(`/app/records/new?clientId=${client.id}`)
                        }
                      >
                        <Plus size={14} />
                        Create progress note
                      </Btn>
                    ) : undefined
                  }
                />
              )}
            </div>
          )}
          {tab === "budget" && <BudgetManager participant={client} />}
          {tab === "documents" && <DocumentLibrary participant={client} />}
        </div>
      </div>

      {editing && (
        <ParticipantFormDrawer
          participant={client}
          onClose={() => setEditing(false)}
          onSaved={saved => {
            setEditing(false);
            notify(`${saved.preferred}’s profile was updated.`);
          }}
        />
      )}
      {archiving && (
        <Modal
          title={`Archive ${client.preferred}?`}
          onClose={() => setArchiving(false)}
          busy={archive.isPending}
        >
          <p className="mb-3 text-xs leading-5 text-[#687982]">
            Archived participants keep their full history but are hidden from
            active lists and cannot receive new records, shifts, invoices or
            voice notes. You can restore them later.
          </p>
          <label className="label" htmlFor="archive-reason">
            Reason (optional)
          </label>
          <textarea
            id="archive-reason"
            className="textarea"
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="e.g. Moved interstate; services ended 30 Sep"
          />
          <div className="mt-3">
            <FormAlert message={archiveError} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setArchiving(false)}>
              Cancel
            </Btn>
            <Btn
              variant="danger"
              loading={archive.isPending}
              onClick={() => void doArchive()}
            >
              Archive participant
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}
