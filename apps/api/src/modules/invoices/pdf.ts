import PDFDocument from "pdfkit";
import { fromCents } from "@shared/logic/money";
import { prettyDate } from "@shared/logic/time";
import type { InvoiceDoc } from "../../models";
import { config } from "../../config";

const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const LINE = "#d9d9d9";
const RULE = "#8bc34a";

/** Plain numbers with a thousands separator; the currency symbol only appears on "Amount due". */
const amount = (cents: number) =>
  fromCents(cents).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const money = (cents: number) => `$${amount(cents)}`;

/** "26693750346" → "26 693 750 346" the way an ABN is normally written. */
const formatAbn = (abn: string) => {
  const digits = (abn ?? "").replace(/\D/g, "");
  return digits.length === 11
    ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    : (abn ?? "");
};

/** "067873" → "067-873". */
const formatBsb = (bsb: string) => {
  const digits = (bsb ?? "").replace(/\D/g, "");
  return digits.length === 6
    ? `${digits.slice(0, 3)}-${digits.slice(3)}`
    : (bsb ?? "");
};

/** Short date in the style the invoice uses: "30 Sept 2026". */
const shortish = (ymd: string) => prettyDate(ymd);

/**
 * Renders the invoice to match the layout the business already sends out: supplier block top
 * right, a summary strip of amount / dates / number / reference, the line table, totals, then
 * payment details. Everything comes from the invoice's own snapshots, so editing the workspace
 * later never rewrites an invoice that has already gone out.
 */
export function renderInvoicePdf(invoice: InvoiceDoc): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    info: {
      Title: `${invoice.title} ${invoice._id}`,
      Author: invoice.supplier?.name ?? "Noble Community Support",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(chunk as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;
  const supplier = invoice.supplier ?? {
    name: "",
    legalName: "",
    abn: "",
    address: "",
    phone: "",
    email: "",
  };
  const bank = invoice.bank ?? {
    accountName: "",
    bsb: "",
    accountNumber: "",
    payInstruction: "",
  };

  /* ── Title ── */
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(23)
    .text(invoice.title || "Tax Invoice", left, 50);

  /* ── Supplier, top right ── */
  const supplierLines = [
    (supplier.legalName || supplier.name || "").toUpperCase(),
    ...(supplier.address ?? "").split(/\s*,\s*|\n/).filter(Boolean),
    supplier.abn ? `ABN: ${formatAbn(supplier.abn)}` : "",
    supplier.phone,
    supplier.email,
  ].filter(Boolean);
  let supplierY = 52;
  for (const [index, lineText] of supplierLines.entries()) {
    doc
      .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(index === 0 ? 9.5 : 9)
      .fillColor(index === 0 ? INK : MUTED)
      .text(lineText, left + width * 0.45, supplierY, {
        width: width * 0.55,
        align: "right",
      });
    supplierY = doc.y + 1;
  }

  /* ── Bill to ── */
  let y = Math.max(doc.y, 110) + 6;
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(INK)
    .text("Bill to", left, y);
  y = doc.y + 2;
  const billLines = [
    invoice.recipient || invoice.billTo?.name || "",
    invoice.recipientEmail || "",
    invoice.billTo?.address || "",
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  for (const lineText of billLines) {
    doc.text(lineText, left, y, { width: width * 0.6 });
    y = doc.y + 2;
  }

  /* ── Summary strip: amount due, dates, number, reference ── */
  y = Math.max(y, 150) + 14;
  const cells: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: "Amount due", value: money(invoice.totalCents), bold: true },
    { label: "Due date", value: shortish(invoice.due), bold: true },
    { label: "Issue date", value: shortish(invoice.issue), bold: true },
    { label: "Invoice number", value: invoice._id, bold: true },
  ];
  if (invoice.reference)
    cells.push({ label: "Reference", value: invoice.reference, bold: true });

  // Reference can be long, so it takes whatever space the fixed columns leave.
  const fixed = 78;
  const widths = cells.map((cell, index) =>
    index === cells.length - 1 && cell.label === "Reference"
      ? width - fixed * (cells.length - 1)
      : fixed
  );
  let cellX = left;
  for (const [index, cell] of cells.entries()) {
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(cell.label, cellX, y, { width: widths[index] - 6 });
    doc
      .font("Helvetica-Bold")
      .fontSize(cell.label === "Reference" ? 10 : 11)
      .fillColor(INK)
      .text(cell.value, cellX, y + 12, { width: widths[index] - 6 });
    cellX += widths[index];
  }
  y += 42;

  // The same link the payer can open in a browser, as on the invoices this replaces.
  if (invoice.share?.enabled && invoice.share?.token) {
    const url = `${config().appUrl}/invoice/${invoice.share.token}`;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#1f6fb8")
      .text("View online", left, y, { link: url, underline: false });
    y = doc.y + 6;
  }

  if (invoice.status === "Void" || invoice.status === "Paid") {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(invoice.status === "Void" ? "#a84540" : "#187153")
      .text(
        invoice.status === "Void"
          ? "VOID"
          : `PAID${invoice.paidOn ? ` — ${shortish(invoice.paidOn)}` : ""}`,
        left,
        y
      );
    y = doc.y + 4;
  }

  /* ── Accent rule, as on the printed invoice ── */
  doc
    .moveTo(left, y)
    .lineTo(right, y)
    .strokeColor(RULE)
    .lineWidth(2.5)
    .stroke();
  y += 16;

  /* ── Line items ── */
  const columns = {
    description: left,
    qty: left + width * 0.52,
    price: left + width * 0.65,
    tax: left + width * 0.78,
    amount: left + width * 0.87,
  };
  const colRight = (start: number, end: number) => end - start - 8;

  const header = (top: number) => {
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    doc.text("Description", columns.description, top);
    doc.text("Quantity", columns.qty, top, {
      width: colRight(columns.qty, columns.price),
      align: "right",
    });
    doc.text("Price", columns.price, top, {
      width: colRight(columns.price, columns.tax),
      align: "right",
    });
    doc.text("Tax", columns.tax, top, {
      width: colRight(columns.tax, columns.amount),
      align: "right",
    });
    doc.text("Amount", columns.amount, top, {
      width: right - columns.amount,
      align: "right",
    });
    const bottom = top + 14;
    doc
      .moveTo(left, bottom)
      .lineTo(right, bottom)
      .strokeColor(LINE)
      .lineWidth(0.8)
      .stroke();
    return bottom + 9;
  };
  y = header(y);

  const taxLabel = `${invoice.taxRatePct ?? 0}%`;
  const bottomLimit = doc.page.height - 150;
  for (const line of invoice.lines) {
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    const rowHeight =
      Math.max(
        doc.heightOfString(line.label, {
          width: colRight(columns.description, columns.qty),
        }),
        11
      ) +
      (line.itemCode ? 10 : 0) +
      12;
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = header(50);
    }
    doc.text(line.label, columns.description, y, {
      width: colRight(columns.description, columns.qty),
    });
    if (line.itemCode) {
      // The support item a plan manager checks the claim against, under the description.
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`Item ${line.itemCode}`, columns.description, doc.y + 1, {
          width: colRight(columns.description, columns.qty),
        });
      doc.fontSize(9).fillColor(INK);
    }
    doc.text(String(line.quantity), columns.qty, y, {
      width: colRight(columns.qty, columns.price),
      align: "right",
    });
    doc.text(amount(line.rateCents), columns.price, y, {
      width: colRight(columns.price, columns.tax),
      align: "right",
    });
    doc.text(taxLabel, columns.tax, y, {
      width: colRight(columns.tax, columns.amount),
      align: "right",
    });
    doc.text(amount(line.subtotalCents), columns.amount, y, {
      width: right - columns.amount,
      align: "right",
    });
    y += rowHeight;
    doc
      .moveTo(left, y - 6)
      .lineTo(right, y - 6)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();
  }

  /* ── Totals, right aligned under the Amount column ── */
  if (y > bottomLimit - 70) {
    doc.addPage();
    y = 50;
  }
  y += 6;
  const totalsLabel = left + width * 0.6;
  const totalRow = (
    label: string,
    value: string,
    options: { big?: boolean; rule?: boolean } = {}
  ) => {
    if (options.rule) {
      doc
        .moveTo(totalsLabel, y - 6)
        .lineTo(right, y - 6)
        .strokeColor(LINE)
        .lineWidth(0.5)
        .stroke();
    }
    doc
      .font("Helvetica")
      .fontSize(options.big ? 10 : 9)
      .fillColor(MUTED)
      .text(label, totalsLabel, y, { width: width * 0.18 });
    doc
      .font(options.big ? "Helvetica-Bold" : "Helvetica")
      .fontSize(options.big ? 15 : 9)
      .fillColor(INK)
      .text(value, columns.amount - 40, y - (options.big ? 4 : 0), {
        width: right - columns.amount + 40,
        align: "right",
      });
    y += options.big ? 26 : 18;
  };
  totalRow("Subtotal", amount(invoice.subtotalCents));
  if (invoice.taxCents > 0 || invoice.taxRatePct)
    totalRow(`GST ${invoice.taxRatePct ?? 0}%`, amount(invoice.taxCents), {
      rule: true,
    });
  totalRow("Total", amount(invoice.totalCents), { rule: true });
  totalRow("Amount due", money(invoice.totalCents), { big: true, rule: true });

  /* ── Payment details ── */
  if (y > doc.page.height - 190) {
    doc.addPage();
    y = 50;
  }
  y += 6;
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  const terms = `Payment is due within ${invoice.paymentTermsDays} day${invoice.paymentTermsDays === 1 ? "" : "s"} of the invoice date.`;
  doc.text(terms, left, y, { width: width * 0.7 });
  y = doc.y + 10;

  const payment: string[] = [];
  if (bank.accountName || bank.bsb || bank.accountNumber) {
    payment.push("Payment Method: Bank Transfer");
    if (bank.accountName) payment.push(`Account Name: ${bank.accountName}`);
    if (bank.bsb) payment.push(`BSB: ${formatBsb(bank.bsb)}`);
    if (bank.accountNumber) payment.push(`Account No: ${bank.accountNumber}`);
    if (bank.payInstruction) payment.push(`Reference: ${bank.payInstruction}`);
  }
  if (invoice.paymentInstructions) payment.push(invoice.paymentInstructions);
  if (payment.length) {
    doc.fillColor(INK).fontSize(9);
    for (const lineText of payment) {
      doc.text(lineText, left, y, { width: width * 0.7 });
      y = doc.y + 1;
    }
    y += 10;
  }
  if (invoice.notes) {
    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(invoice.notes, left, y, {
        width: width * 0.7,
      });
    y = doc.y + 10;
  }
  if (invoice.footer) {
    doc
      .fillColor(INK)
      .fontSize(9)
      .text(invoice.footer, left, y, { width: width * 0.7 });
  }

  /* ── Page numbers, only when it runs to more than one page ── */
  const range = doc.bufferedPageRange();
  if (range.count > 1) {
    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      doc.switchToPage(index);
      // The number sits inside the bottom margin; lift it so pdfkit does not add a page.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(MUTED)
        .text(
          `${invoice._id} — page ${index - range.start + 1} of ${range.count}`,
          left,
          doc.page.height - 40,
          { width, align: "right", lineBreak: false }
        );
      doc.page.margins.bottom = bottomMargin;
    }
  }

  doc.end();
  return finished;
}
