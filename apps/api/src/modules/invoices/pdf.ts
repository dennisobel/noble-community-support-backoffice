import PDFDocument from "pdfkit";
import { formatMoney, fromCents } from "@shared/logic/money";
import { prettyDate } from "@shared/logic/time";
import type { InvoiceDoc } from "../../models";

const INK = "#263d49";
const MUTED = "#738189";
const LINE = "#e2e8e5";
const BRAND = "#1f4350";

/** Renders an invoice from its own snapshots, so later profile edits never change an issued invoice. */
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

  // Brand block
  doc.roundedRect(left, 50, 34, 34, 7).fill(BRAND);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text((supplier.name || "N").charAt(0).toUpperCase(), left, 60, {
      width: 34,
      align: "center",
    });
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(supplier.name || "Noble Community Support", left + 46, 52, {
      width: 250,
    });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  const supplierLines = [
    supplier.legalName,
    supplier.abn
      ? `ABN ${supplier.abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}`
      : "",
    supplier.address,
    supplier.phone,
    supplier.email,
  ].filter(Boolean);
  doc.text(supplierLines.join("\n"), left + 46, doc.y + 2, { width: 250 });

  // Title block
  doc
    .fillColor(INK)
    .font("Helvetica")
    .fontSize(24)
    .text(invoice.title, left, 50, { width, align: "right" });
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .text(invoice._id, left, 80, { width, align: "right" });
  if (invoice.status !== "Sent" && invoice.status !== "Ready to send") {
    doc
      .fillColor(
        invoice.status === "Void"
          ? "#a84540"
          : invoice.status === "Paid"
            ? "#187153"
            : MUTED
      )
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(invoice.status.toUpperCase(), left, 94, { width, align: "right" });
  }

  // Bill-to and dates
  let y = Math.max(doc.y, 140) + 16;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("BILL TO", left, y);
  doc
    .fillColor(INK)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(invoice.billTo?.name ?? "", left, y + 13, { width: 260 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const billLines = [
    invoice.recipient && invoice.recipient !== invoice.billTo?.name
      ? invoice.recipient
      : "",
    invoice.billTo?.address,
    invoice.billTo?.ndis ? `NDIS ${invoice.billTo.ndis}` : "",
  ].filter(Boolean);
  doc.text(billLines.join("\n"), left, doc.y + 2, { width: 260 });
  const billBottom = doc.y;

  const dateRows: Array<[string, string]> = [
    ["Issue date", prettyDate(invoice.issue)],
    ["Due date", prettyDate(invoice.due)],
    ["Payment terms", `${invoice.paymentTermsDays} days`],
  ];
  let dateY = y;
  for (const [label, value] of dateRows) {
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(label, left, dateY, { width, align: "right" });
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .text(value, left, dateY + 10, { width, align: "right" });
    dateY += 28;
  }
  y = Math.max(billBottom, dateY) + 18;

  // Line items
  const columns = {
    description: left,
    qty: left + width * 0.56,
    rate: left + width * 0.72,
    amount: left + width * 0.84,
  };
  const header = (top: number) => {
    doc.rect(left, top, width, 22).fill("#f5f8f7");
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
    doc.text("DESCRIPTION", columns.description + 8, top + 7);
    doc.text("QTY", columns.qty, top + 7, {
      width: columns.rate - columns.qty - 8,
      align: "right",
    });
    doc.text("RATE", columns.rate, top + 7, {
      width: columns.amount - columns.rate - 8,
      align: "right",
    });
    doc.text("AMOUNT", columns.amount, top + 7, {
      width: right - columns.amount - 8,
      align: "right",
    });
    return top + 28;
  };
  y = header(y);
  const bottomLimit = doc.page.height - 120;
  for (const line of invoice.lines) {
    doc.font("Helvetica").fontSize(9);
    const rowHeight =
      Math.max(
        doc.heightOfString(line.label, {
          width: columns.qty - columns.description - 16,
        }),
        11
      ) + 12;
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = header(50);
    }
    doc.fillColor(INK).text(line.label, columns.description + 8, y, {
      width: columns.qty - columns.description - 16,
    });
    doc
      .fillColor(MUTED)
      .fontSize(7.5)
      .text(line.recordId, columns.description + 8, doc.y + 1);
    doc.fillColor(INK).fontSize(9);
    doc.text(`${line.quantity} ${line.unit.toLowerCase()}`, columns.qty, y, {
      width: columns.rate - columns.qty - 8,
      align: "right",
    });
    doc.text(formatMoney(fromCents(line.rateCents)), columns.rate, y, {
      width: columns.amount - columns.rate - 8,
      align: "right",
    });
    doc
      .font("Helvetica-Bold")
      .text(formatMoney(fromCents(line.subtotalCents)), columns.amount, y, {
        width: right - columns.amount - 8,
        align: "right",
      });
    y += rowHeight + 4;
    doc
      .moveTo(left, y - 5)
      .lineTo(right, y - 5)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();
  }

  // Totals
  if (y > bottomLimit - 60) {
    doc.addPage();
    y = 50;
  }
  const totalsLeft = left + width * 0.58;
  const totalsWidth = right - totalsLeft;
  const totalRow = (label: string, value: string, bold = false) => {
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(bold ? 11 : 9)
      .fillColor(bold ? INK : MUTED);
    doc.text(label, totalsLeft, y, { width: totalsWidth / 2 });
    doc
      .fillColor(INK)
      .text(value, totalsLeft, y, { width: totalsWidth, align: "right" });
    y += bold ? 18 : 15;
  };
  y += 6;
  totalRow("Subtotal", formatMoney(fromCents(invoice.subtotalCents)));
  totalRow(
    invoice.taxRatePct ? `GST (${invoice.taxRatePct}%)` : "GST",
    formatMoney(fromCents(invoice.taxCents))
  );
  doc
    .moveTo(totalsLeft, y)
    .lineTo(right, y)
    .strokeColor(LINE)
    .lineWidth(1)
    .stroke();
  y += 8;
  totalRow("Total AUD", formatMoney(fromCents(invoice.totalCents)), true);

  // Notes and payment instructions
  const extras = [invoice.notes, invoice.paymentInstructions].filter(Boolean);
  if (extras.length) {
    y += 12;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8.5)
      .text(extras.join("\n\n"), left, y, { width: width * 0.6 });
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // The footer sits inside the bottom margin; lift the margin so pdfkit does not start a new page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 70;
    doc
      .moveTo(left, footerY)
      .lineTo(right, footerY)
      .strokeColor(LINE)
      .lineWidth(1)
      .stroke();
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(
        invoice.footer || "Thank you for your continued partnership.",
        left,
        footerY + 10,
        { width: width * 0.75, lineBreak: false }
      );
    doc.text(
      `Page ${index - range.start + 1} of ${range.count}`,
      left,
      footerY + 10,
      { width, align: "right", lineBreak: false }
    );
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return finished;
}
