import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  ExternalLink,
  HandHeart,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { downloadFile, errorMessage, openFile } from "@/api/client";
import {
  useDeleteInvoice,
  useInvoice,
  useInvoiceAction,
  useMeta,
} from "@/api/hooks";
import {
  Btn,
  ConfirmModal,
  ErrorBlock,
  FormAlert,
  LoadingBlock,
  Modal,
  Status,
} from "@/components/app/ui";
import { formatDateTime, money, prettyDate } from "@/lib/format";
import { useNotify } from "@/lib/notify";

const ACTION_LABELS: Record<string, string> = {
  created: "Invoice created",
  updated: "Draft updated",
  ready_to_send: "Marked ready to send",
  sent: "Marked as sent",
  paid: "Payment recorded",
  voided: "Voided",
};

export default function InvoicePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const notify = useNotify();
  const meta = useMeta();
  const invoiceQuery = useInvoice(id);
  const action = useInvoiceAction();
  const remove = useDeleteInvoice();
  const [modal, setModal] = useState<
    "send" | "paid" | "void" | "delete" | null
  >(null);
  const [sendEmail, setSendEmail] = useState(false);
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  if (invoiceQuery.isPending) return <LoadingBlock label="Loading invoice…" />;
  if (invoiceQuery.isError)
    return (
      <ErrorBlock
        error={invoiceQuery.error}
        onRetry={() => invoiceQuery.refetch()}
      />
    );
  const invoice = invoiceQuery.data;
  const canEmail = Boolean(meta.data?.features.email && invoice.recipientEmail);

  const run = async (
    kind: "mark-sent" | "mark-paid" | "void" | "mark-ready",
    body: Record<string, unknown>,
    message: string
  ) => {
    setError("");
    try {
      await action.mutateAsync({
        id: invoice.id,
        action: kind,
        rev: invoice.rev,
        ...body,
      });
      notify(message);
      setModal(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const download = async (inline: boolean) => {
    try {
      if (inline) await openFile(`/invoices/${invoice.id}/pdf`);
      else
        await downloadFile(`/invoices/${invoice.id}/pdf`, `${invoice.id}.pdf`, {
          download: 1,
        });
    } catch (failure) {
      notify(errorMessage(failure), "error");
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/app/invoices"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#277c76]"
        >
          <ArrowLeft size={14} />
          Back to invoices
        </Link>
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" onClick={() => void download(true)}>
            <ExternalLink size={14} />
            Open PDF
          </Btn>
          <Btn variant="secondary" onClick={() => void download(false)}>
            <Download size={14} />
            Download PDF
          </Btn>
          {invoice.status === "Draft" && (
            <>
              <Btn variant="quiet" onClick={() => setModal("delete")}>
                <Trash2 size={14} />
                Delete draft
              </Btn>
              <Btn
                variant="secondary"
                loading={action.isPending && !modal}
                onClick={() =>
                  void run("mark-ready", {}, "Invoice marked ready to send.")
                }
              >
                Mark ready to send
              </Btn>
            </>
          )}
          {(invoice.status === "Draft" ||
            invoice.status === "Ready to send") && (
            <Btn
              onClick={() => {
                setSendEmail(canEmail);
                setModal("send");
              }}
            >
              <Send size={14} />
              Mark as sent
            </Btn>
          )}
          {(invoice.status === "Sent" ||
            invoice.status === "Ready to send") && (
            <>
              <Btn variant="quiet" onClick={() => setModal("void")}>
                <Ban size={14} />
                Void
              </Btn>
              {invoice.status === "Sent" && (
                <Btn
                  onClick={() => {
                    setPaidOn(meta.data?.today ?? "");
                    setModal("paid");
                  }}
                >
                  <CheckCircle2 size={14} />
                  Mark as paid
                </Btn>
              )}
            </>
          )}
        </div>
      </div>
      <FormAlert message={modal ? null : error} />

      <div className="mx-auto max-w-[800px] rounded-sm border border-[#e0e6e3] bg-white p-8 shadow-sm sm:p-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#1f4350] text-white">
              <HandHeart size={21} />
            </div>
            <div>
              <div className="text-sm font-bold tracking-[.06em] text-[#1f3b49]">
                {invoice.supplier.name.toUpperCase()}
              </div>
              <div className="mt-1 whitespace-pre-line text-[10px] leading-4 text-[#768890]">
                {[
                  invoice.supplier.legalName,
                  invoice.supplier.abn ? `ABN ${invoice.supplier.abn}` : "",
                  invoice.supplier.address,
                  invoice.supplier.email,
                ]
                  .filter(Boolean)
                  .join("\n")}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="serif text-3xl text-[#263d49]">{invoice.title}</div>
            <div className="mt-1 text-xs text-[#738189]">{invoice.id}</div>
            <div className="mt-2">
              <Status value={invoice.status} />
              {invoice.overdue && (
                <span className="badge badge-danger ml-2">Overdue</span>
              )}
            </div>
          </div>
        </div>
        <div className="my-8 grid grid-cols-2 gap-6 border-y border-[#e9eeec] py-5 text-xs">
          <div>
            <div className="label">Bill to</div>
            <div className="font-semibold text-[#344854]">
              {invoice.billTo.name}
            </div>
            {invoice.recipient !== invoice.billTo.name && (
              <div className="mt-1 text-[#74838b]">{invoice.recipient}</div>
            )}
            <div className="text-[#74838b]">{invoice.billTo.address}</div>
            <div className="text-[#74838b]">NDIS {invoice.billTo.ndis}</div>
          </div>
          <div className="text-right">
            <div>
              <span className="text-[#869399]">Issue date</span>
              <div className="mt-1 font-semibold">
                {prettyDate(invoice.issue)}
              </div>
            </div>
            <div className="mt-3">
              <span className="text-[#869399]">Due date</span>
              <div className="mt-1 font-semibold">
                {prettyDate(invoice.due)}
              </div>
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table !min-w-0">
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Rate</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    {line.label}
                    <button
                      className="block text-[10px] text-[#277c76]"
                      onClick={() => navigate(`/app/records/${line.recordId}`)}
                    >
                      {line.recordId}
                    </button>
                  </td>
                  <td>
                    {line.quantity} {line.unit.toLowerCase()}
                  </td>
                  <td>{money(line.rate)}</td>
                  <td className="text-right font-semibold">
                    {money(line.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto mt-6 w-full max-w-[260px] space-y-2 text-xs">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>
              GST{invoice.taxRatePct ? ` (${invoice.taxRatePct}%)` : ""}
            </span>
            <span>{money(invoice.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-[#e5ebe8] pt-3 text-base font-bold text-[#263d49]">
            <span>Total AUD</span>
            <span>{money(invoice.total)}</span>
          </div>
        </div>
        {(invoice.notes || invoice.paymentInstructions) && (
          <p className="mt-8 whitespace-pre-line text-[11px] leading-5 text-[#687982]">
            {[invoice.notes, invoice.paymentInstructions]
              .filter(Boolean)
              .join("\n\n")}
          </p>
        )}
        <div className="mt-12 border-t border-[#e9eeec] pt-4 text-[10px] text-[#8b979b]">
          {invoice.footer || "Thank you for your continued partnership."}
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-[800px] rounded-md border border-[#e7ecea] bg-white p-4">
        <div className="mb-2 text-xs font-bold text-[#344854]">History</div>
        <ol className="space-y-1.5">
          {invoice.history.map((entry, index) => (
            <li key={index} className="text-[11px] text-[#5f7179]">
              <b>{ACTION_LABELS[entry.action] ?? entry.action}</b> ·{" "}
              {entry.by?.name ?? "System"} · {formatDateTime(entry.at)}
              {entry.note ? ` · ${entry.note}` : ""}
            </li>
          ))}
        </ol>
        {invoice.status === "Paid" && (
          <p className="mt-2 text-[11px] text-[#187153]">
            Paid on {prettyDate(invoice.paidOn)}
            {invoice.paidReference ? ` · ${invoice.paidReference}` : ""}
          </p>
        )}
        {invoice.status === "Void" && (
          <p className="mt-2 text-[11px] text-[#a84540]">
            Voided: {invoice.voidReason}
          </p>
        )}
      </div>

      {modal === "send" && (
        <Modal
          title={`Mark ${invoice.id} as sent`}
          onClose={() => setModal(null)}
          busy={action.isPending}
        >
          <p className="text-xs leading-5 text-[#687982]">
            Once sent, the invoice lines are locked. To change it afterwards,
            void it and create a new invoice.
          </p>
          <label
            className={`mt-4 flex items-start gap-2 rounded-md bg-[#f5f8f7] p-3 text-xs text-[#586c74] ${canEmail ? "" : "opacity-60"}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-[#147f79]"
              disabled={!canEmail}
              checked={sendEmail}
              onChange={event => setSendEmail(event.target.checked)}
            />
            <span>
              <b className="block text-[#405761]">
                Email the PDF to the recipient
              </b>
              <small className="mt-1 block text-[10px] text-[#839097]">
                {canEmail
                  ? `Sends to ${invoice.recipientEmail}.`
                  : !meta.data?.features.email
                    ? "Email is not configured on the server."
                    : "No recipient email on the participant's profile."}
              </small>
            </span>
          </label>
          <div className="mt-3">
            <FormAlert message={error} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Btn>
            <Btn
              loading={action.isPending}
              onClick={() =>
                void run(
                  "mark-sent",
                  { sendEmail },
                  sendEmail
                    ? `Invoice emailed to ${invoice.recipientEmail}.`
                    : "Invoice marked as sent."
                )
              }
            >
              <Send size={14} />
              {sendEmail ? "Email and mark sent" : "Mark as sent"}
            </Btn>
          </div>
        </Modal>
      )}
      {modal === "paid" && (
        <Modal
          title="Record payment"
          onClose={() => setModal(null)}
          busy={action.isPending}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="label">
              Paid on
              <input
                className="input mt-1"
                type="date"
                value={paidOn}
                onChange={event => setPaidOn(event.target.value)}
              />
            </label>
            <label className="label">
              Reference
              <input
                className="input mt-1"
                value={reference}
                onChange={event => setReference(event.target.value)}
                placeholder="e.g. EFT 20931"
              />
            </label>
          </div>
          <div className="mt-3">
            <FormAlert message={error} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Btn>
            <Btn
              disabled={!paidOn}
              loading={action.isPending}
              onClick={() =>
                void run(
                  "mark-paid",
                  { paidOn, reference: reference.trim() || undefined },
                  "Payment recorded."
                )
              }
            >
              Save payment
            </Btn>
          </div>
        </Modal>
      )}
      {modal === "void" && (
        <Modal
          title={`Void ${invoice.id}?`}
          onClose={() => setModal(null)}
          busy={action.isPending}
        >
          <p className="mb-3 text-xs leading-5 text-[#687982]">
            The invoice stays on file as void and its service records return to
            Approved so they can be invoiced again.
          </p>
          <label className="label" htmlFor="void-reason">
            Reason <span className="text-red-600">*</span>
          </label>
          <textarea
            id="void-reason"
            className="textarea"
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="e.g. Sent to the wrong plan manager"
          />
          <div className="mt-3">
            <FormAlert message={error} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Btn>
            <Btn
              variant="danger"
              disabled={!reason.trim()}
              loading={action.isPending}
              onClick={() =>
                void run(
                  "void",
                  { reason: reason.trim() },
                  "Invoice voided. Its records can be invoiced again."
                )
              }
            >
              Void invoice
            </Btn>
          </div>
        </Modal>
      )}
      {modal === "delete" && (
        <ConfirmModal
          title={`Delete draft ${invoice.id}?`}
          body="The draft is removed and its service records return to Approved."
          confirmLabel="Delete draft"
          danger
          busy={remove.isPending}
          onClose={() => setModal(null)}
          onConfirm={() =>
            remove.mutate(invoice.id, {
              onSuccess: () => {
                notify("Draft invoice deleted.");
                navigate("/app/invoices");
              },
              onError: failure => {
                setModal(null);
                setError(errorMessage(failure));
              },
            })
          }
        />
      )}
    </>
  );
}
