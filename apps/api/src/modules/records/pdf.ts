import PDFDocument from "pdfkit";
import type { ServiceRecordDTO } from "@shared/dto";
import { prettyDate } from "@shared/logic/time";

const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const LINE = "#d9d9d9";

/** The built-in PDF fonts only cover Western European text; anything else would print as noise. */
const printable = (value: string) =>
  (value ?? "").replace(/[^\n\r\t\x20-\x7e\xa0-\xff‘’“”–—•…€™]/g, "?");

export interface NotePdfMeta {
  organisation: string;
  timezone: string;
  exportedBy: string;
}

/**
 * A progress note on paper: the shift, each section of the note, the declaration, and every
 * amendment with what it replaced. The footer says who exported it and when, because a printed
 * note leaves the system's access control behind.
 */
export function renderNotePdf(
  note: ServiceRecordDTO,
  meta: NotePdfMeta
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
    info: {
      Title: `Progress note ${note.id}`,
      Author: meta.organisation,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(chunk as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const stamp = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("en-AU", {
          timeZone: meta.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "";
  const rule = () => {
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc.moveDown(0.6);
  };
  const fact = (label: string, value: string) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(INK)
      .text(`${label}: `, left, doc.y, { continued: true, width })
      .font("Helvetica")
      .text(printable(value) || "-");
  };
  const section = (title: string, parts: Array<[string, string]>) => {
    if (doc.y > doc.page.height - 130) doc.addPage();
    doc.moveDown(0.7);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(INK)
      .text(title, left, doc.y, { width });
    doc.moveDown(0.25);
    const filled = parts.filter(([, value]) => value.trim());
    if (!filled.length)
      doc
        .font("Helvetica-Oblique")
        .fontSize(9.5)
        .fillColor(MUTED)
        .text("Nothing recorded.", { width });
    for (const [label, value] of filled) {
      if (label)
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor(MUTED)
          .text(label, { width });
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(INK)
        .text(printable(value), { width, lineGap: 1.5 });
      doc.moveDown(0.3);
    }
  };

  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(INK)
    .text("Progress note", left, doc.y, { width });
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(
      printable(
        [meta.organisation, note.id, note.status, note.amended ? "Amended" : ""]
          .filter(Boolean)
          .join("  |  ")
      ),
      { width }
    );
  doc.moveDown(0.6);
  rule();

  fact("Participant", note.clientFullName);
  fact("Support worker", note.staffName);
  fact("Service date", prettyDate(note.date));
  fact("Shift", `${note.start} to ${note.end} (${note.hours} hours)`);
  fact("Service", note.type);
  fact("Location", note.location);
  fact("Rostered shift", note.shiftId ?? "Not linked to a rostered shift");
  fact(
    "Submitted",
    note.submittedAt
      ? `${stamp(note.submittedAt)} by ${note.submittedBy?.name ?? "unknown"}`
      : "Not submitted yet"
  );
  doc.moveDown(0.4);
  rule();

  section("Support provided", [
    ["", note.supportTypes.join(", ")],
    ["Details", note.support],
  ]);
  section("Shift summary", [["", note.summary]]);
  section("Participant goals and outcomes", [
    ["Goals worked on", note.goals.map(goal => `- ${goal}`).join("\n")],
    ["Progress", note.outcome],
    ["Achievements and outcomes", note.achievements],
  ]);
  section("Health and wellbeing", [
    ["", note.health.join(", ")],
    ["Details", note.healthDetails],
  ]);
  section("Incidents and behaviours of concern", [
    ["", note.incident.join(", ")],
    ["Details", note.incidentDetails],
    [
      "",
      note.incidentDetails.trim()
        ? "This note does not replace the formal incident report."
        : "",
    ],
  ]);
  section("Handover and follow-up", [["", note.followUp]]);
  section("Declaration", [
    [
      "",
      note.confirmed
        ? "Declared as accurate and as reflecting the support provided during this service."
        : "The staff declaration has not been made.",
    ],
  ]);

  if (note.amendments.length) {
    section(
      `Amendments (${note.amendments.length})`,
      note.amendments.map(amendment => [
        `${stamp(amendment.at)} by ${amendment.by?.name ?? "unknown"}`,
        [
          `Reason: ${amendment.reason}`,
          ...amendment.changes.map(
            change =>
              `${change.label}\n  Was: ${change.before || "(empty)"}\n  Now: ${change.after || "(empty)"}`
          ),
        ].join("\n"),
      ])
    );
  }

  const range = doc.bufferedPageRange();
  const exported = stamp(new Date().toISOString());
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // The footer sits inside the bottom margin; lift it so pdfkit does not add a page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        printable(
          `Confidential: personal and health information. Exported by ${meta.exportedBy} on ${exported}. ${note.id}, page ${index - range.start + 1} of ${range.count}`
        ),
        left,
        doc.page.height - 34,
        { width, align: "center", lineBreak: false }
      );
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return finished;
}
