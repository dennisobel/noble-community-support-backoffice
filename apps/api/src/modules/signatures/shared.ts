import type { Request } from "express";
import type {
  SignatureEventDTO,
  SignatureRequestDTO,
  SignatureSummaryDTO,
  SignerDTO,
} from "@shared/dto";
import type { SignatureDisplayStatus, SignatureEventType } from "@shared/enums";
import { config } from "../../config";
import { errors } from "../../lib/errors";
import { clientIp } from "../../lib/http";
import { iso, isoRequired } from "../../lib/mappers";
import {
  SignatureRequest,
  type SignatureEventSub,
  type SignatureRequestDoc,
} from "../../models";

/** How long a finished document stays downloadable through each signer's own link. */
export const COPY_LINK_DAYS = 30;
const DAY_MS = 86_400_000;

/** The address a signer opens. Built from APP_URL so it works behind any host. */
export const signUrlFor = (token: string) => `${config().appUrl}/sign/${token}`;

/** What a request is shown as: "expired" is not stored, it is a sent request past its date. */
export function effectiveStatus(
  doc: Pick<SignatureRequestDoc, "status" | "expiresAt">,
  now = new Date()
): SignatureDisplayStatus {
  return doc.status === "sent" && doc.expiresAt && doc.expiresAt <= now
    ? "expired"
    : doc.status;
}

/** Whether the links still do anything: while out for signature, and for a while after it is finished. */
export function linksLive(
  doc: Pick<SignatureRequestDoc, "status" | "expiresAt" | "completedAt">,
  now = new Date()
): boolean {
  if (doc.status === "sent") return effectiveStatus(doc, now) === "sent";
  if (doc.status === "completed" && doc.completedAt)
    return now.getTime() < doc.completedAt.getTime() + COPY_LINK_DAYS * DAY_MS;
  return false;
}

export async function requestDoc(id: string): Promise<SignatureRequestDoc> {
  const doc = await SignatureRequest.findById(id).lean<SignatureRequestDoc>();
  if (!doc) throw errors.notFound("Signature request");
  return doc;
}

export interface EventMeta {
  ip?: string;
  userAgent?: string;
}

export function makeEvent(
  type: SignatureEventType,
  by: string,
  detail: string,
  options: EventMeta & { signerId?: string | null } = {}
): SignatureEventSub {
  return {
    at: new Date(),
    type,
    signerId: options.signerId ?? null,
    by,
    detail,
    ip: options.ip ?? "",
    userAgent: (options.userAgent ?? "").slice(0, 300),
  };
}

/** Where a public request came from, kept for the completion certificate. */
export function clientMeta(req: Request): Required<EventMeta> {
  return {
    ip: clientIp(req),
    userAgent: (req.get("user-agent") ?? "").slice(0, 300),
  };
}

export function toSummaryDTO(
  doc: SignatureRequestDoc,
  participantName: string,
  now = new Date()
): SignatureSummaryDTO {
  return {
    id: String(doc._id),
    title: doc.title,
    status: effectiveStatus(doc, now),
    participantId: doc.participantId ? String(doc.participantId) : null,
    participantName,
    signerNames: doc.signers.map(signer => signer.name),
    signerCount: doc.signers.length,
    signedCount: doc.signers.filter(signer => signer.status === "signed")
      .length,
    pageCount: doc.pages.length,
    createdBy: doc.createdBy
      ? { id: doc.createdBy.id, name: doc.createdBy.name }
      : null,
    createdAt: isoRequired(doc.createdAt),
    updatedAt: isoRequired(doc.updatedAt),
    sentAt: iso(doc.sentAt),
    completedAt: iso(doc.completedAt),
    expiresAt: iso(doc.expiresAt),
  };
}

export const allSigned = (doc: Pick<SignatureRequestDoc, "signers">) =>
  doc.signers.length > 0 &&
  doc.signers.every(signer => signer.status === "signed");

export function toRequestDTO(
  doc: SignatureRequestDoc,
  participantName: string,
  now = new Date()
): SignatureRequestDTO {
  const live = linksLive(doc, now);
  const signers: SignerDTO[] = doc.signers.map(signer => ({
    id: signer.id,
    name: signer.name,
    email: signer.email ?? "",
    roleLabel: signer.roleLabel ?? "",
    status: signer.status,
    viewedAt: iso(signer.viewedAt),
    signedAt: iso(signer.signedAt),
    declinedAt: iso(signer.declinedAt),
    declineReason: signer.declineReason ?? "",
    emailedAt: iso(signer.emailedAt),
    url: live && signer.token ? signUrlFor(signer.token) : null,
  }));
  const events: SignatureEventDTO[] = doc.events.map(event => ({
    at: isoRequired(event.at),
    type: event.type,
    signerId: event.signerId ?? null,
    by: event.by,
    detail: event.detail,
  }));
  return {
    ...toSummaryDTO(doc, participantName, now),
    message: doc.message ?? "",
    folderKey: doc.folderKey,
    document: {
      originalName: doc.document.originalName,
      size: doc.document.size,
      sha256: doc.document.sha256,
    },
    pages: doc.pages.map(page => ({ width: page.width, height: page.height })),
    signers,
    fields: doc.fields.map(field => ({
      id: field.id,
      signerId: field.signerId,
      type: field.type,
      page: field.page,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      required: field.required,
      label: field.label ?? "",
      value: field.value ?? "",
    })),
    events,
    signedFile: doc.signed
      ? { size: doc.signed.size, sha256: doc.signed.sha256 }
      : null,
    filedDocumentId: doc.filedDocumentId ? String(doc.filedDocumentId) : null,
    sealPending: doc.status === "sent" && allSigned(doc),
    rev: doc.rev,
  };
}

/** A safe file name for a download: the title with anything awkward removed. */
export function fileNameFor(title: string, suffix = ""): string {
  const base =
    title
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "document";
  return `${base}${suffix}.pdf`;
}
