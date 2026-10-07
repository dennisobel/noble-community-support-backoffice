import {
  degrees,
  EncryptedPDFError,
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "@cantoo/pdf-lib";
import type { SignatureFieldType, SignerStatus } from "@shared/enums";
import { prettyDate } from "@shared/logic/time";
import { SIGNATURE_LIMITS } from "@shared/schemas/signatures";
import { errors } from "../../lib/errors";
import {
  displayedSize,
  normaliseRotation,
  toPagePoint,
  type PageBox,
} from "./geometry";

const round2 = (value: number) => Math.round(value * 100) / 100;

function boxOf(page: PDFPage): PageBox {
  const crop = page.getCropBox();
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation: normaliseRotation(page.getRotation().angle),
  };
}

/** Reads a PDF the way a viewer would and reports each page's displayed size. */
export async function inspectPdf(
  bytes: Uint8Array
): Promise<Array<{ width: number; height: number }>> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError)
      throw errors.validation(
        "This PDF is password protected. Remove the password, save a copy and upload that."
      );
    throw errors.validation(
      "This PDF could not be read. Open it and save or print it as a new PDF, then try again."
    );
  }
  const count = pdf.getPageCount();
  if (count === 0) throw errors.validation("This PDF has no pages.");
  if (count > SIGNATURE_LIMITS.maxPages)
    throw errors.validation(
      `This PDF has ${count} pages. The limit is ${SIGNATURE_LIMITS.maxPages}.`
    );
  return pdf.getPages().map(page => {
    const size = displayedSize(boxOf(page));
    return { width: round2(size.width), height: round2(size.height) };
  });
}

/** Whether a signature picture can be placed in a PDF. Checked when it is submitted, so sealing never trips on it later. */
export async function canEmbedPng(bytes: Uint8Array): Promise<boolean> {
  try {
    const scratch = await PDFDocument.create();
    await scratch.embedPng(bytes);
    return true;
  } catch {
    return false;
  }
}

/* ───────────── Sealing ───────────── */

export interface SealSigner {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  status: SignerStatus;
  signedAt: Date | null;
  ip: string;
  userAgent: string;
  /** The drawn or typed signature, as PNG bytes. */
  image: Uint8Array | null;
}

export interface SealField {
  signerId: string;
  type: SignatureFieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string;
}

export interface SealEvent {
  at: Date;
  by: string;
  detail: string;
  ip: string;
}

export interface SealInput {
  original: Uint8Array;
  requestId: string;
  title: string;
  originalName: string;
  originalSha256: string;
  senderName: string;
  createdBy: string;
  createdAt: Date;
  sentAt: Date | null;
  completedAt: Date;
  timeZone: string;
  signers: SealSigner[];
  fields: SealField[];
  events: SealEvent[];
}

const INK = rgb(0.06, 0.12, 0.2);
const MUTED = rgb(0.38, 0.45, 0.5);
const RULE = rgb(0.85, 0.89, 0.9);
const TEAL = rgb(0.07, 0.46, 0.44);

const characterSets = new WeakMap<PDFFont, Set<number>>();

/**
 * The built-in PDF fonts only hold Latin-1 style characters. Anything outside them is reduced to
 * its plain letter (so "Nguyễn" prints as "Nguyen") or "?", rather than failing the whole PDF. The
 * exact text the person typed is still kept in the record.
 */
export function printable(font: PDFFont, value: string): string {
  let supported = characterSets.get(font);
  if (!supported) {
    supported = new Set(font.getCharacterSet());
    characterSets.set(font, supported);
  }
  const known = supported;
  let out = "";
  for (const char of value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")) {
    if (known.has(char.codePointAt(0)!)) {
      out += char;
      continue;
    }
    const plain = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out +=
      plain && [...plain].every(c => known.has(c.codePointAt(0)!))
        ? plain
        : "?";
  }
  return out;
}

/** Shrinks the text to fit `width`, and only cuts it (with an ellipsis) when even the smallest size is too wide. */
function fitText(
  font: PDFFont,
  value: string,
  width: number,
  startSize: number
): { text: string; size: number } {
  let size = startSize;
  while (size > 5 && font.widthOfTextAtSize(value, size) > width) size -= 0.5;
  let text = value;
  while (text.length > 1 && font.widthOfTextAtSize(text, size) > width)
    text = `${text.slice(0, -2).trimEnd()}…`;
  return { text, size };
}

function stampFields(
  pdf: PDFDocument,
  font: PDFFont,
  images: Map<string, PDFImage>,
  fields: SealField[]
): void {
  const pages = pdf.getPages();
  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;
    const box = boxOf(page);
    const view = displayedSize(box);
    const left = field.x * view.width;
    const top = field.y * view.height;
    const width = field.w * view.width;
    const height = field.h * view.height;
    const turn = degrees(box.rotation);

    if (field.type === "signature") {
      const image = images.get(field.signerId);
      if (!image) continue;
      const scale = Math.min(width / image.width, height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      const bottomLeft = toPagePoint(
        box,
        left + (width - drawWidth) / 2,
        top + (height + drawHeight) / 2
      );
      page.drawImage(image, {
        ...bottomLeft,
        width: drawWidth,
        height: drawHeight,
        rotate: turn,
      });
    } else if (field.type === "checkbox") {
      if (field.value !== "true") continue;
      const point = (fx: number, fy: number) =>
        toPagePoint(box, left + width * fx, top + height * fy);
      const thickness = Math.max(1.2, Math.min(width, height) * 0.12);
      for (const [from, to] of [
        [point(0.2, 0.55), point(0.42, 0.78)],
        [point(0.42, 0.78), point(0.82, 0.22)],
      ])
        page.drawLine({ start: from, end: to, thickness, color: INK });
    } else if (field.value) {
      const shown = fitText(
        font,
        printable(
          font,
          field.type === "date" ? prettyDate(field.value) : field.value
        ),
        width - 4,
        Math.min(14, Math.max(6, height * 0.62))
      );
      const baseline = toPagePoint(
        box,
        left + 2,
        top + (height + shown.size * 0.7) / 2
      );
      page.drawText(shown.text, {
        ...baseline,
        size: shown.size,
        font,
        color: INK,
        rotate: turn,
      });
    }
  }
}

/** Lays text out down a page and starts a new page when the last one is full. */
class Sheet {
  private page!: PDFPage;
  private y = 0;
  private pageNumber = 0;
  readonly width = 595.28;
  readonly height = 841.89;
  readonly margin = 48;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly mono: PDFFont,
    private readonly footer: string
  ) {
    this.addPage();
  }

  private addPage(): void {
    this.page = this.pdf.addPage([this.width, this.height]);
    this.pageNumber += 1;
    this.y = this.height - this.margin;
    this.page.drawText(printable(this.font, this.footer), {
      x: this.margin,
      y: 28,
      size: 7.5,
      font: this.font,
      color: MUTED,
    });
    if (this.pageNumber > 1)
      this.line("Certificate of completion (continued)", {
        font: this.bold,
        size: 11,
        gap: 10,
      });
  }

  space(needed: number): void {
    if (this.y - needed < this.margin + 14) this.addPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  rule(): void {
    this.space(10);
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 10;
  }

  private wrap(value: string, font: PDFFont, size: number, max: number) {
    const lines: string[] = [];
    let current = "";
    const push = () => {
      if (current) lines.push(current);
      current = "";
    };
    for (const word of printable(font, value).split(/\s+/).filter(Boolean)) {
      if (font.widthOfTextAtSize(word, size) > max) {
        // A hash or a long device string has no spaces: break it wherever it runs out of room.
        push();
        let piece = "";
        for (const char of word) {
          if (font.widthOfTextAtSize(piece + char, size) > max) {
            lines.push(piece);
            piece = "";
          }
          piece += char;
        }
        current = piece;
        continue;
      }
      const trial = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) > max) {
        push();
        current = word;
      } else current = trial;
    }
    push();
    return lines.length ? lines : [""];
  }

  line(
    value: string,
    options: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      gap?: number;
    } = {}
  ): void {
    const font = options.font ?? this.font;
    const size = options.size ?? 9;
    const indent = options.indent ?? 0;
    const leading = size * 1.35;
    const lines = this.wrap(
      value,
      font,
      size,
      this.width - this.margin * 2 - indent
    );
    for (const text of lines) {
      this.space(leading);
      this.y -= leading;
      this.page.drawText(text, {
        x: this.margin + indent,
        y: this.y,
        size,
        font,
        color: options.color ?? INK,
      });
    }
    this.y -= options.gap ?? 0;
  }

  /** A label and its value on one line; a long value wraps within the value column. */
  row(label: string, value: string): void {
    const size = 9.5;
    const column = 118;
    const leading = size * 1.4;
    const lines = this.wrap(
      value || "-",
      this.font,
      size,
      this.width - this.margin * 2 - column
    );
    lines.forEach((text, index) => {
      this.space(leading);
      this.y -= leading;
      if (index === 0)
        this.page.drawText(printable(this.font, label), {
          x: this.margin,
          y: this.y,
          size: 8.5,
          font: this.font,
          color: MUTED,
        });
      this.page.drawText(text, {
        x: this.margin + column,
        y: this.y,
        size,
        font: this.font,
        color: INK,
      });
    });
    this.y -= 1.5;
  }

  code(value: string): void {
    this.line(value, { font: this.mono, size: 8 });
  }

  /** A signature picture drawn small, to show what each person signed with. */
  picture(image: PDFImage, maxWidth: number, maxHeight: number): void {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    this.space(h + 6);
    this.y -= h;
    this.page.drawImage(image, {
      x: this.margin,
      y: this.y,
      width: w,
      height: h,
    });
    this.y -= 6;
  }

  heading(value: string): void {
    this.gap(6);
    this.space(30);
    this.line(value, { font: this.bold, size: 11.5, color: TEAL, gap: 3 });
    this.rule();
  }
}

/**
 * Builds the finished PDF: every box the signers filled in is drawn onto the original pages, and a
 * completion certificate (who signed, when, from where, and the original file's fingerprint) is
 * added at the end. The original file is never changed; this writes a new one.
 */
export async function buildSignedPdf(input: SealInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.original, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const images = new Map<string, PDFImage>();
  for (const signer of input.signers)
    if (signer.image) images.set(signer.id, await pdf.embedPng(signer.image));
  stampFields(pdf, font, images, input.fields);

  const moment = new Intl.DateTimeFormat("en-AU", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const when = (date: Date | null) => (date ? moment.format(date) : "-");

  const sheet = new Sheet(
    pdf,
    font,
    bold,
    mono,
    `Signature request ${input.requestId}`
  );
  sheet.line("Certificate of completion", { font: bold, size: 20, gap: 2 });
  sheet.line(input.senderName, { size: 10, color: MUTED, gap: 6 });
  sheet.line(
    "Everyone named below has signed this document electronically. This page records how, and is part of the signed copy.",
    { size: 9, color: MUTED, gap: 4 }
  );

  sheet.heading("Document");
  sheet.row("Title", input.title);
  sheet.row("File", input.originalName);
  sheet.row("Request ID", input.requestId);
  sheet.row("Sent by", input.createdBy);
  sheet.row("Created", when(input.createdAt));
  sheet.row("Sent for signature", when(input.sentAt));
  sheet.row("Completed", when(input.completedAt));
  sheet.gap(2);
  sheet.line("Fingerprint of the original file (SHA-256)", {
    size: 8.5,
    color: MUTED,
  });
  sheet.code(input.originalSha256);

  sheet.heading("Signers");
  for (const signer of input.signers) {
    sheet.space(70);
    sheet.line(
      signer.roleLabel ? `${signer.name} (${signer.roleLabel})` : signer.name,
      { font: bold, size: 10.5, gap: 1 }
    );
    if (signer.email) sheet.line(signer.email, { size: 9, color: MUTED });
    sheet.line(
      signer.status === "signed"
        ? `Agreed to use electronic signatures and signed on ${when(signer.signedAt)}`
        : `Status: ${signer.status}`,
      { size: 9 }
    );
    sheet.line(`Network address: ${signer.ip || "not recorded"}`, {
      size: 8.5,
      color: MUTED,
    });
    sheet.line(`Device: ${signer.userAgent || "not recorded"}`, {
      size: 8,
      color: MUTED,
      gap: 3,
    });
    const image = images.get(signer.id);
    if (image) sheet.picture(image, 140, 40);
    sheet.gap(6);
  }

  sheet.heading("Activity");
  for (const event of input.events) {
    sheet.line(`${when(event.at)} - ${event.by || "System"}`, {
      size: 8,
      color: MUTED,
    });
    sheet.line(event.detail, { size: 9, indent: 8, gap: 2 });
  }

  sheet.gap(10);
  sheet.rule();
  sheet.line(
    "Keep this certificate with the signed document. If the original file is ever disputed, compare its SHA-256 fingerprint with the one above.",
    { size: 8, color: MUTED }
  );

  pdf.setTitle(`${input.title} (signed)`);
  pdf.setProducer("Noble Community Support");
  pdf.setModificationDate(input.completedAt);
  return pdf.save();
}
