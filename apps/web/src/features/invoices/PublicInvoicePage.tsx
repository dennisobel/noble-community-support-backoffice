import { AlertCircle, Download, Printer } from "lucide-react";
import { useParams } from "wouter";
import { API_BASE } from "@/api/client";
import { usePublicInvoice } from "@/api/hooks";
import { Spinner } from "@/components/app/ui";
import { money, prettyDate } from "@/lib/format";

const formatAbn = (abn: string) => {
  const digits = (abn ?? "").replace(/\D/g, "");
  return digits.length === 11
    ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    : abn;
};

const formatBsb = (bsb: string) => {
  const digits = (bsb ?? "").replace(/\D/g, "");
  return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : bsb;
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#f4f6f5] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[820px]">{children}</div>
    </main>
  );
}

/**
 * An invoice opened from a share link. Deliberately standalone: no navigation, no session and
 * nothing from the workspace beyond this one invoice, because whoever holds the link is a payer
 * rather than a user of the system.
 */
export default function PublicInvoicePage() {
  const { token } = useParams<{ token: string }>();
  const invoice = usePublicInvoice(token);
  const pdf = `${API_BASE}/public/invoices/${token}/pdf`;

  if (invoice.isPending)
    return (
      <Shell>
        <div className="grid place-items-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  if (invoice.isError)
    return (
      <Shell>
        <div className="rounded-xl border border-[#e4ebe8] bg-white p-10 text-center">
          <AlertCircle size={22} className="mx-auto text-[#a33a33]" />
          <h1 className="mt-3 text-[17px] font-bold text-[#16323a]">
            This invoice link is not available.
          </h1>
          <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-[#6d7c82]">
            The link may have been turned off, or it may be mistyped. Ask the
            person who sent it for a current link.
          </p>
        </div>
      </Shell>
    );

  const data = invoice.data;
  const paid = data.status === "Paid";
  const voided = data.status === "Void";

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2 print:hidden">
        <a
          href={pdf}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#cfdcd7] bg-white px-3 text-[12px] font-semibold text-[#2b4a50] no-underline"
        >
          <Printer size={14} /> View PDF
        </a>
        <a
          href={`${pdf}?download=1`}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#12766f] px-3 text-[12px] font-semibold text-white no-underline"
        >
          <Download size={14} /> Download
        </a>
      </div>

      <article className="rounded-xl border border-[#e4ebe8] bg-white p-6 shadow-[0_1px_3px_rgba(24,45,52,.06)] sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-[26px] font-bold tracking-[-.02em] text-[#1a1a1a]">
            {data.title}
          </h1>
          <div className="text-right text-[11px] leading-5 text-[#6b6b6b]">
            <div className="text-[12px] font-bold text-[#1a1a1a]">
              {(data.supplier.legalName || data.supplier.name).toUpperCase()}
            </div>
            {data.supplier.address
              .split(/\s*,\s*/)
              .filter(Boolean)
              .map(part => (
                <div key={part}>{part}</div>
              ))}
            {data.supplier.abn && (
              <div>ABN: {formatAbn(data.supplier.abn)}</div>
            )}
            {data.supplier.email && <div>{data.supplier.email}</div>}
          </div>
        </header>

        {(paid || voided) && (
          <p
            className={`mt-4 inline-block rounded-md px-2.5 py-1 text-[11px] font-bold ${
              voided
                ? "bg-[#fbe6e3] text-[#9c3c34]"
                : "bg-[#e4f2ec] text-[#1d6f57]"
            }`}
          >
            {voided
              ? "VOID — this invoice has been cancelled"
              : `PAID${data.paidOn ? ` — ${prettyDate(data.paidOn)}` : ""}`}
          </p>
        )}
        {data.overdue && (
          <p className="mt-4 inline-block rounded-md bg-[#fdf0da] px-2.5 py-1 text-[11px] font-bold text-[#8a6224]">
            Overdue — due {prettyDate(data.due)}
          </p>
        )}

        <section className="mt-6">
          <h2 className="text-[11px] font-bold text-[#1a1a1a]">Bill to</h2>
          <div className="mt-1 text-[12px] leading-5 text-[#6b6b6b]">
            <div>{data.recipient || data.billTo.name}</div>
            {data.billTo.address && <div>{data.billTo.address}</div>}
          </div>
        </section>

        <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 border-b-2 border-[#8bc34a] pb-5 sm:grid-cols-5">
          {[
            ["Amount due", money(data.total), true],
            ["Due date", prettyDate(data.due), false],
            ["Issue date", prettyDate(data.issue), false],
            ["Invoice number", data.id, false],
            ["Reference", data.reference, false],
          ]
            .filter(([, value]) => value)
            .map(([label, value, big]) => (
              <div key={String(label)}>
                <dt className="text-[10px] text-[#6b6b6b]">{label}</dt>
                <dd
                  className={`mt-0.5 font-bold text-[#1a1a1a] ${big ? "text-[17px]" : "text-[12.5px]"}`}
                >
                  {value}
                </dd>
              </div>
            ))}
        </dl>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[#d9d9d9] text-[10.5px] text-[#6b6b6b]">
                <th className="py-2 text-left font-normal">Description</th>
                <th className="py-2 text-right font-normal">Quantity</th>
                <th className="py-2 text-right font-normal">Price</th>
                <th className="py-2 text-right font-normal">Tax</th>
                <th className="py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr
                  key={`${line.label}-${index}`}
                  className="border-b border-[#eceeed] text-[#1a1a1a]"
                >
                  <td className="py-2.5 pr-3">
                    {line.label}
                    {line.itemCode && (
                      <span className="mt-0.5 block font-mono text-[10px] text-[#6b6b6b]">
                        Item {line.itemCode}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {line.quantity}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {line.rate.toFixed(2)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {data.taxRatePct}%
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {line.subtotal.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-[280px] text-[12px]">
            <div className="flex justify-between border-b border-[#eceeed] py-2">
              <dt className="text-[#6b6b6b]">Subtotal</dt>
              <dd className="tabular-nums">{data.subtotal.toFixed(2)}</dd>
            </div>
            {(data.tax > 0 || data.taxRatePct > 0) && (
              <div className="flex justify-between border-b border-[#eceeed] py-2">
                <dt className="text-[#6b6b6b]">GST {data.taxRatePct}%</dt>
                <dd className="tabular-nums">{data.tax.toFixed(2)}</dd>
              </div>
            )}
            <div className="flex justify-between border-b border-[#eceeed] py-2">
              <dt className="text-[#6b6b6b]">Total</dt>
              <dd className="tabular-nums">{data.total.toFixed(2)}</dd>
            </div>
            <div className="flex items-center justify-between py-3">
              <dt className="text-[#6b6b6b]">Amount due</dt>
              <dd className="text-[19px] font-bold tabular-nums text-[#1a1a1a]">
                {money(data.total)}
              </dd>
            </div>
          </dl>
        </div>

        <footer className="mt-6 space-y-4 border-t border-[#eceeed] pt-5 text-[12px] leading-5 text-[#1a1a1a]">
          <p>
            Payment is due within {data.paymentTermsDays} day
            {data.paymentTermsDays === 1 ? "" : "s"} of the invoice date.
          </p>
          {(data.bank.accountName ||
            data.bank.bsb ||
            data.bank.accountNumber) && (
            <div>
              <div>Payment Method: Bank Transfer</div>
              {data.bank.accountName && (
                <div>Account Name: {data.bank.accountName}</div>
              )}
              {data.bank.bsb && <div>BSB: {formatBsb(data.bank.bsb)}</div>}
              {data.bank.accountNumber && (
                <div>Account No: {data.bank.accountNumber}</div>
              )}
              {data.bank.payInstruction && (
                <div>Reference: {data.bank.payInstruction}</div>
              )}
            </div>
          )}
          {data.paymentInstructions && <p>{data.paymentInstructions}</p>}
          {data.notes && <p className="text-[#6b6b6b]">{data.notes}</p>}
          {data.footer && <p>{data.footer}</p>}
        </footer>
      </article>

      <p className="mt-5 text-center text-[10.5px] text-[#8a979b] print:hidden">
        This is a read-only copy of invoice {data.id}. Keep the link private —
        anyone who has it can view this invoice.
      </p>
    </Shell>
  );
}
