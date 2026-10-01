import {
  Check,
  ChevronRight,
  ClipboardCheck,
  ListFilter,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { RECORD_STATUSES } from "@shared/enums";
import type { ServiceRecordDTO } from "@shared/dto";
import { MESSAGES } from "@shared/messages";
import { errorMessage } from "@/api/client";
import {
  useAdjustBillables,
  useRecord,
  useRecordAction,
  useRecordCounts,
  useRecords,
} from "@/api/hooks";
import {
  Btn,
  EmptyState,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
  Panel,
  SectionHeading,
  Status,
  useDebounced,
  useOverlay,
} from "@/components/app/ui";
import { formatDateTime, money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

function ReviewDrawer({
  recordId,
  onClose,
}: {
  recordId: string;
  onClose: () => void;
}) {
  const notify = useNotify();
  const recordQuery = useRecord(recordId);
  const action = useRecordAction();
  const adjust = useAdjustBillables();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [lineEdits, setLineEdits] = useState<
    Record<number, { quantity: string; rate: string }>
  >({});
  const [error, setError] = useState("");
  useOverlay(onClose, !returning);
  const record = recordQuery.data;

  useEffect(() => setLineEdits({}), [record?.rev]);

  const saveLine = async (current: ServiceRecordDTO, index: number) => {
    const edit = lineEdits[index];
    if (!edit) return;
    const line = current.billables[index];
    const quantity = Number(edit.quantity);
    const rate = Number(edit.rate);
    if (
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !Number.isFinite(rate) ||
      rate < 0
    )
      return setError("Enter a valid non-negative quantity and rate.");
    if (quantity === line.quantity && rate === line.rate) return;
    setError("");
    try {
      await adjust.mutateAsync({
        id: current.id,
        rev: current.rev,
        lines: [{ index, quantity, rate }],
      });
      notify("Billable line updated.");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const decide = async (kind: "approve" | "return") => {
    if (!record) return;
    setError("");
    try {
      await action.mutateAsync({
        id: record.id,
        action: kind,
        rev: record.rev,
        reason: kind === "return" ? reason.trim() : undefined,
      });
      notify(
        kind === "approve"
          ? "Record approved. It can now be selected for invoicing."
          : "Record returned with reviewer feedback."
      );
      setReturning(false);
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Review ${recordId}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e7ecea] bg-white px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[#8a969b]">
              Review service record
            </div>
            <div className="mt-1 font-semibold text-[#314753]">{recordId}</div>
          </div>
          <button
            className="icon-btn"
            aria-label="Close review drawer"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        {recordQuery.isPending && <LoadingBlock />}
        {recordQuery.isError && (
          <div className="p-5">
            <ErrorBlock
              error={recordQuery.error}
              onRetry={() => recordQuery.refetch()}
            />
          </div>
        )}
        {record && (
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#3c505a]">
                  {record.clientFullName}
                </div>
                <div className="mt-1 text-[11px] text-[#829097]">
                  {record.type} · {prettyDate(record.date)} · {record.start}–
                  {record.end}
                </div>
              </div>
              <Status value={record.status} />
            </div>
            {record.correction && (
              <div className="rounded-md border border-[#efd6a7] bg-[#fff7e7] p-3 text-xs text-[#846222]">
                <b>Previous correction</b>
                <p className="mt-1">{record.correction}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 rounded-md bg-[#f5f8f7] p-3 text-[11px]">
              <div>
                <span className="text-[#87949a]">Staff</span>
                <b className="mt-1 block">{record.staffName}</b>
              </div>
              <div>
                <span className="text-[#87949a]">Duration</span>
                <b className="mt-1 block">{record.hours.toFixed(1)} hours</b>
              </div>
              <div>
                <span className="text-[#87949a]">Transport</span>
                <b className="mt-1 block">{record.km.toFixed(1)} km</b>
              </div>
              <div>
                <span className="text-[#87949a]">Total</span>
                <b className="mt-1 block">{money(record.total)}</b>
              </div>
            </div>
            <div className="space-y-3">
              {[
                ["Support provided", record.support],
                ["Participant response", record.response],
                ["Goal / outcome", record.outcome],
                ["Observations", record.observations],
                ["Follow-up", record.followUp],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="label">{label}</div>
                  <p className="whitespace-pre-line text-xs leading-5 text-[#53666e]">
                    {value || "No details provided."}
                  </p>
                </div>
              ))}
            </div>
            <Panel title="Billable breakdown">
              <div className="space-y-3 p-4">
                {record.billables.map((line, index) => {
                  const edit = lineEdits[index] ?? {
                    quantity: String(line.quantity),
                    rate: String(line.rate),
                  };
                  const editable = record.status === "Submitted";
                  const update = (patch: Partial<typeof edit>) =>
                    setLineEdits(current => ({
                      ...current,
                      [index]: { ...edit, ...patch },
                    }));
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_75px_85px] items-end gap-2"
                    >
                      <div className="text-[11px] text-[#53666e]">
                        {line.label}
                        <small className="block text-[9px] text-[#8a969b]">
                          {line.unit} · {money(line.subtotal)}
                        </small>
                      </div>
                      <label>
                        <span className="label !mb-1 !text-[9px]">Qty</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          disabled={!editable}
                          className="input h-8 px-2 py-1 text-xs"
                          value={edit.quantity}
                          onChange={event =>
                            update({ quantity: event.target.value })
                          }
                          onBlur={() => void saveLine(record, index)}
                        />
                      </label>
                      <label>
                        <span className="label !mb-1 !text-[9px]">Rate</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!editable}
                          className="input h-8 px-2 py-1 text-xs"
                          value={edit.rate}
                          onChange={event =>
                            update({ rate: event.target.value })
                          }
                          onBlur={() => void saveLine(record, index)}
                        />
                      </label>
                    </div>
                  );
                })}
                <div className="divider" />
                <div className="flex justify-between text-xs font-bold">
                  <span>Total</span>
                  <span>{money(record.total)}</span>
                </div>
                {adjust.isPending && (
                  <p className="text-[10px] text-[#87949a]">
                    Saving adjustment…
                  </p>
                )}
              </div>
            </Panel>
            <div className="rounded-md bg-[#f6f8f7] p-3 text-[10px] leading-4 text-[#7a888e]">
              <b>Audit metadata</b>
              <br />
              Created {formatDateTime(record.created)}
              <br />
              Last updated {formatDateTime(record.updated)}
              <br />
              Submitted by {record.submittedBy?.name ?? record.staffName}
              {record.submittedAt
                ? ` · ${formatDateTime(record.submittedAt)}`
                : ""}
            </div>
            <FormAlert message={error} />
            {record.status === "Submitted" ? (
              <div className="flex gap-2 border-t border-[#edf0ef] pt-4">
                <Btn
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setReason("");
                    setReturning(true);
                  }}
                >
                  Return for correction
                </Btn>
                <Btn
                  className="flex-1"
                  loading={action.isPending && !returning}
                  onClick={() => void decide("approve")}
                >
                  Approve record <Check size={14} />
                </Btn>
              </div>
            ) : (
              <p className="border-t border-[#edf0ef] pt-4 text-[11px] text-[#7a888e]">
                This record is {record.status.toLowerCase()}; there is nothing
                to review.
              </p>
            )}
          </div>
        )}
      </aside>
      {returning && (
        <div onClick={event => event.stopPropagation()}>
          <Modal
            title="Return for correction"
            onClose={() => setReturning(false)}
            busy={action.isPending}
          >
            <p className="mb-3 text-xs text-[#6b7b82]">
              Explain what needs to change. The staff member will see this
              reason on the returned record.
            </p>
            <label className="label" htmlFor="reason">
              Correction reason <span className="text-red-600">*</span>
            </label>
            <textarea
              id="reason"
              autoFocus
              className="textarea"
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="For example: please include the departure and return points for travel…"
            />
            {!reason.trim() && (
              <p className="field-help">{MESSAGES.returnReason}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="secondary" onClick={() => setReturning(false)}>
                Cancel
              </Btn>
              <Btn
                variant="danger"
                disabled={!reason.trim()}
                loading={action.isPending}
                onClick={() => void decide("return")}
              >
                Return record
              </Btn>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}

export default function ReviewQueuePage() {
  const [location, navigate] = useLocation();
  const search = new URLSearchParams(useSearch());
  const [status, setStatus] = useState(search.get("status") ?? "Submitted");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const [open, setOpen] = useState<string | null>(search.get("open"));
  const records = useRecords({
    status: status === "All statuses" ? undefined : status,
    q: q || undefined,
    limit: 100,
  });
  const counts = useRecordCounts();
  const list = records.data?.items ?? [];

  const closeDrawer = () => {
    setOpen(null);
    if (search.get("open")) navigate(location, { replace: true });
  };

  return (
    <>
      <SectionHeading
        title="Review queue"
        subtitle="Review submitted notes and approve or return with clear feedback."
        actions={
          <>
            <span className="badge badge-submitted">
              {counts.data?.Submitted ?? 0} awaiting review
            </span>
            <Btn onClick={() => navigate("/app/records/new")}>
              <Plus size={15} />
              New service record
            </Btn>
          </>
        }
      />
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89969b]"
          />
          <input
            className="input pl-9"
            placeholder="Search participant, staff, service, date or ID"
            value={text}
            onChange={event => setText(event.target.value)}
            aria-label="Search records"
          />
        </div>
        <select
          className="select w-[190px]"
          value={status}
          onChange={event => setStatus(event.target.value)}
          aria-label="Filter by status"
        >
          <option>All statuses</option>
          {RECORD_STATUSES.map(item => (
            <option key={item}>{item}</option>
          ))}
          <option value="Draft,Returned">Draft or returned</option>
        </select>
        <button
          onClick={() => {
            setText("");
            setStatus("Submitted");
          }}
          className="btn btn-secondary"
        >
          <ListFilter size={14} />
          Clear filters
        </button>
      </div>
      {records.isError && (
        <ErrorBlock error={records.error} onRetry={() => records.refetch()} />
      )}
      <Panel>
        {records.isPending ? (
          <LoadingBlock />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Service date</th>
                  <th>Participant</th>
                  <th>Service / staff</th>
                  <th>Duration</th>
                  <th>Transport</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map(record => (
                  <tr key={record.id}>
                    <td>
                      {prettyDate(record.date)}
                      <small className="mt-1 block text-[10px] text-[#87949a]">
                        {record.id}
                      </small>
                    </td>
                    <td>
                      <button
                        className="text-left font-semibold text-[#344753]"
                        onClick={() =>
                          navigate(`/app/clients/${record.clientId}`)
                        }
                      >
                        {record.clientName}
                      </button>
                    </td>
                    <td>
                      <div className="text-xs font-medium">{record.type}</div>
                      <div className="mt-1 text-[10px] text-[#829097]">
                        {record.staffName}
                      </div>
                    </td>
                    <td>{record.hours.toFixed(1)} hr</td>
                    <td>{record.km.toFixed(1)} km</td>
                    <td className="font-semibold">{money(record.total)}</td>
                    <td>
                      <Status value={record.status} />
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          className="icon-btn"
                          title="Open record"
                          aria-label={`Open ${record.id}`}
                          onClick={() => navigate(`/app/records/${record.id}`)}
                        >
                          <Pencil size={14} />
                        </button>
                        {record.status === "Submitted" && (
                          <button
                            className="icon-btn"
                            title="Review record"
                            aria-label={`Review ${record.id}`}
                            onClick={() => setOpen(record.id)}
                          >
                            <ChevronRight size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && (
              <EmptyState
                icon={<ClipboardCheck size={19} />}
                title={
                  status === "Submitted" && !q
                    ? "Review queue is clear"
                    : "No records found"
                }
                text={
                  status === "Submitted" && !q
                    ? "Submitted service notes will appear here."
                    : "Try a different search or status filter."
                }
              />
            )}
          </div>
        )}
      </Panel>
      <div className="mt-3 text-[10px] text-[#89959a]">
        {records.data?.total ?? 0} records <span className="mx-1">·</span>{" "}
        Statuses move through Draft → Submitted → Returned or Approved →
        Invoiced.
      </div>
      {open && <ReviewDrawer recordId={open} onClose={closeDrawer} />}
    </>
  );
}
