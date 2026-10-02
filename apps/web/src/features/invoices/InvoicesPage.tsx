import { ChevronRight, FileCheck2, Info, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { INVOICE_STATUSES } from "@shared/enums";
import { addDays } from "@shared/logic/time";
import { PAYMENT_TERMS } from "@shared/schemas/invoices";
import { errorMessage } from "@/api/client";
import {
  useCreateInvoice,
  useInvoices,
  useInvoiceSummary,
  useMeta,
  useParticipants,
  useRecords,
  useWorkspace,
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
  useDebounced,
} from "@/components/app/ui";
import { money, prettyDate, shortDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

function InvoiceBuilder({
  onClose,
  initialClient,
}: {
  onClose: () => void;
  initialClient?: string;
}) {
  const [, navigate] = useLocation();
  const notify = useNotify();
  const meta = useMeta();
  const workspace = useWorkspace();
  const participants = useParticipants({ status: "Active" });
  const create = useCreateInvoice();
  const clients = participants.data?.items ?? [];
  const [clientId, setClientId] = useState(initialClient ?? "");
  const [reference, setReference] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [issue, setIssue] = useState("");
  const [terms, setTerms] = useState<number | null>(null);
  const [error, setError] = useState("");
  const client = clients.find(item => item.id === clientId) ?? clients[0];
  const approved = useRecords(
    { clientId: client?.id, status: "Approved", limit: 200, sort: "date" },
    { enabled: Boolean(client) }
  );
  const records = approved.data?.items ?? [];
  const selected = records.filter(record => selection.includes(record.id));
  const lines = selected.flatMap(record =>
    record.billables.map((line, index) => ({
      key: `${record.id}-${index}`,
      record,
      line,
    }))
  );
  const subtotal = selected.reduce((sum, record) => sum + record.total, 0);
  const taxRate = workspace.data?.gst.ratePct ?? 0;
  const tax = Math.round(subtotal * taxRate) / 100;
  const paymentTerms =
    terms ?? workspace.data?.invoice.defaultPaymentTermsDays ?? 14;
  const issueDate = issue || meta.data?.today || "";
  const recipient = client
    ? client.manager && !/self[\s-]?managed/i.test(client.manager)
      ? client.manager
      : `${client.name} (self-managed)`
    : "";

  useEffect(() => setSelection([]), [client?.id]);

  const submit = async () => {
    setError("");
    if (!client || !selected.length)
      return setError("Select at least one approved service record.");
    try {
      const invoice = await create.mutateAsync({
        clientId: client.id,
        recordIds: selected.map(record => record.id),
        issueDate,
        paymentTermsDays: paymentTerms,
        reference: reference.trim(),
      });
      notify(`Invoice ${invoice.id} created from approved records.`);
      navigate(`/app/invoices/${invoice.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Drawer
      wide
      onClose={onClose}
      eyebrow="Invoice draft"
      title="Create invoice"
      subtitle="Select approved service records for one client."
    >
      {participants.isPending ? (
        <LoadingBlock />
      ) : !clients.length ? (
        <EmptyState
          title="No active participants"
          text="Invoices are created for active participants with approved records."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Panel title="Invoice details">
              <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="invoice-client">
                    Participant
                  </label>
                  <select
                    id="invoice-client"
                    className="select"
                    value={client?.id ?? ""}
                    onChange={event => setClientId(event.target.value)}
                  >
                    {clients.map(person => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Invoice recipient</label>
                  <input className="input" value={recipient} readOnly />
                  <p className="field-help">
                    {client?.managerEmail
                      ? `Invoices can be emailed to ${client.managerEmail}.`
                      : "Add the plan manager's email to the profile to email invoices."}
                  </p>
                </div>
                <div>
                  <label className="label" htmlFor="invoice-issue">
                    Issue date
                  </label>
                  <input
                    id="invoice-issue"
                    className="input"
                    type="date"
                    value={issueDate}
                    onChange={event => setIssue(event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="invoice-terms">
                    Payment terms
                  </label>
                  <select
                    id="invoice-terms"
                    className="select"
                    value={paymentTerms}
                    onChange={event => setTerms(Number(event.target.value))}
                  >
                    {[...new Set([...PAYMENT_TERMS, paymentTerms])]
                      .sort((a, b) => a - b)
                      .map(days => (
                        <option key={days} value={days}>
                          {days} days
                        </option>
                      ))}
                  </select>
                  {issueDate && (
                    <p className="field-help">
                      Due {prettyDate(addDays(issueDate, paymentTerms))}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="invoice-reference">
                    Reference
                  </label>
                  <input
                    id="invoice-reference"
                    className="input"
                    value={reference}
                    onChange={event => setReference(event.target.value)}
                    placeholder={
                      client
                        ? `${client.name} – NDIS ${client.ndis}`
                        : "Participant – NDIS number"
                    }
                  />
                  <p className="field-help">
                    Printed on the invoice. Left blank, it uses the
                    participant&rsquo;s name and NDIS number.
                  </p>
                </div>
              </div>
            </Panel>
            <Panel
              title="Approved service records"
              action={
                records.length > 0 && (
                  <button
                    className="text-[11px] font-semibold text-[#277c76]"
                    onClick={() =>
                      setSelection(
                        selection.length === records.length
                          ? []
                          : records.map(record => record.id)
                      )
                    }
                  >
                    {selection.length === records.length
                      ? "Clear selection"
                      : "Select all"}
                  </button>
                )
              }
            >
              {approved.isPending ? (
                <LoadingBlock />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th />
                        <th>Date</th>
                        <th>Service / record</th>
                        <th>Duration</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map(record => (
                        <tr key={record.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selection.includes(record.id)}
                              onChange={event =>
                                setSelection(old =>
                                  event.target.checked
                                    ? [...old, record.id]
                                    : old.filter(id => id !== record.id)
                                )
                              }
                              aria-label={`Select ${record.id}`}
                              className="accent-[#147f79]"
                            />
                          </td>
                          <td>{prettyDate(record.date)}</td>
                          <td>
                            <b>{record.type}</b>
                            <small className="mt-1 block text-[10px] text-[#829097]">
                              {record.id} · {record.staffName}
                            </small>
                          </td>
                          <td>{record.hours.toFixed(1)} h</td>
                          <td className="font-semibold">
                            {money(record.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!records.length && (
                    <EmptyState
                      title="No approved records for this participant"
                      text="Only reviewed and approved records that are not yet invoiced can be added."
                    />
                  )}
                </div>
              )}
            </Panel>
          </div>
          <div className="space-y-5">
            <Panel title="Invoice summary">
              <div className="space-y-3 p-5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#77858d]">Selected records</span>
                  <b>{selected.length}</b>
                </div>
                <div className="divider" />
                {lines.map(({ key, record, line }) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-[#687982]">
                      {line.label} — {shortDate(record.date)}
                      <small className="block text-[10px]">
                        {record.id} · {line.quantity} {line.unit.toLowerCase()}
                      </small>
                    </span>
                    <b>{money(line.subtotal)}</b>
                  </div>
                ))}
                {!selected.length && (
                  <p className="text-[#89969b]">
                    Select records to preview line items.
                  </p>
                )}
                <div className="divider" />
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <b>{money(subtotal)}</b>
                </div>
                <div className="flex justify-between">
                  <span>GST{taxRate ? ` (${taxRate}%)` : ""}</span>
                  <b>{money(tax)}</b>
                </div>
                <div className="flex justify-between border-t border-[#e8eeeb] pt-3 text-sm">
                  <b>Total AUD</b>
                  <b>{money(subtotal + tax)}</b>
                </div>
                <FormAlert message={error} />
                <p className="text-[10px] leading-4 text-[#87949a]">
                  Creates a draft invoice and marks the selected records as
                  invoiced. Nothing is sent until you choose to.
                </p>
                <Btn
                  className="w-full"
                  disabled={!selected.length}
                  loading={create.isPending}
                  onClick={() => void submit()}
                >
                  <FileCheck2 size={14} />
                  Create invoice draft
                </Btn>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function InvoicesPage() {
  const [location, navigate] = useLocation();
  const initialClient =
    new URLSearchParams(useSearch()).get("clientId") ?? undefined;
  const [status, setStatus] = useState("all");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const invoices = useInvoices({ status, q: q || undefined });
  const summary = useInvoiceSummary();
  const building = location === "/app/invoices/new";
  const list = useMemo(() => invoices.data?.items ?? [], [invoices.data]);

  return (
    <>
      <SectionHeading
        title="Invoices"
        subtitle="Create billing drafts from approved service records and track them to payment."
        actions={
          <Btn onClick={() => navigate("/app/invoices/new")}>
            <Plus size={15} />
            Create invoice
          </Btn>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="panel p-4">
          <div className="text-[10px] text-[#809097]">Outstanding</div>
          <div className="mt-1 text-xl font-semibold">
            {money(summary.data?.outstanding ?? 0)}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-[10px] text-[#809097]">Overdue</div>
          <div
            className={`mt-1 text-xl font-semibold ${summary.data?.overdue ? "text-[#a84540]" : ""}`}
          >
            {summary.data?.overdue ?? 0}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-[10px] text-[#809097]">Drafts</div>
          <div className="mt-1 text-xl font-semibold">
            {summary.data?.drafts ?? 0}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-[10px] text-[#809097]">Paid this month</div>
          <div className="mt-1 text-xl font-semibold">
            {money(summary.data?.paidThisPeriod ?? 0)}
          </div>
        </div>
      </div>
      <Panel
        className="mt-5"
        title="Invoice register"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#89969b]"
              />
              <input
                className="input h-8 w-[180px] py-1 pl-8 text-[11px]"
                placeholder="Invoice, client or recipient"
                value={text}
                onChange={event => setText(event.target.value)}
                aria-label="Search invoices"
              />
            </div>
            <select
              className="select h-8 w-[140px] py-1 text-[10px]"
              value={status}
              onChange={event => setStatus(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {INVOICE_STATUSES.map(item => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        }
      >
        {invoices.isError && (
          <div className="p-4">
            <ErrorBlock
              error={invoices.error}
              onRetry={() => invoices.refetch()}
            />
          </div>
        )}
        {invoices.isPending ? (
          <LoadingBlock />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice ID</th>
                  <th>Participant</th>
                  <th>Recipient</th>
                  <th>Issue date</th>
                  <th>Due date</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map(invoice => (
                  <tr key={invoice.id}>
                    <td className="font-semibold text-[#375361]">
                      {invoice.id}
                    </td>
                    <td>{invoice.clientName}</td>
                    <td>{invoice.recipient}</td>
                    <td>{prettyDate(invoice.issue)}</td>
                    <td
                      className={
                        invoice.overdue ? "font-semibold text-[#a84540]" : ""
                      }
                    >
                      {prettyDate(invoice.due)}
                      {invoice.overdue && (
                        <small className="block text-[10px]">Overdue</small>
                      )}
                    </td>
                    <td className="font-semibold">{money(invoice.total)}</td>
                    <td>
                      <Status value={invoice.status} />
                    </td>
                    <td>
                      <button
                        className="btn btn-quiet !h-8 !px-2 text-[11px]"
                        onClick={() => navigate(`/app/invoices/${invoice.id}`)}
                      >
                        Open <ChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && (
              <EmptyState
                title={
                  q || status !== "all"
                    ? "No matching invoices"
                    : "No invoices yet"
                }
                text="Create an invoice from approved service records."
              />
            )}
          </div>
        )}
      </Panel>
      <div className="mt-4 rounded-md border border-[#d9e9e5] bg-[#f1f8f6] p-3 text-[11px] text-[#4a6662]">
        <Info size={14} className="mr-1 inline" />
        Submitted service records are never invoiced automatically. Only
        approved records selected here are added to an invoice, and each record
        can belong to one invoice at a time.
      </div>
      {building && (
        <InvoiceBuilder
          initialClient={initialClient}
          onClose={() => navigate("/app/invoices")}
        />
      )}
    </>
  );
}
