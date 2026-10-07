import fs from "node:fs/promises";
import type { z } from "zod";
import type {
  SignatureListDTO,
  SignatureReminderResultDTO,
  SignatureRequestDTO,
  SignatureSendResultDTO,
} from "@shared/dto";
import { PARTICIPANT_FOLDERS } from "@shared/enums";
import {
  SIGNATURE_LIMITS,
  type signatureCancelSchema,
  type signatureCreateFields,
  type signatureDraftSchema,
  type signatureExtendSchema,
  type signatureListQuery,
  type signatureSendSchema,
} from "@shared/schemas/signatures";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import { emailEnabled } from "../../lib/mailer";
import { sha256File, storage } from "../../lib/storage";
import { verifyUpload } from "../../middleware/upload";
import {
  Participant,
  SignatureRequest,
  type SignatureRequestDoc,
  type SignerSub,
} from "../../models";
import { randomToken } from "../auth/tokens";
import { getParticipantDoc } from "../participants/service";
import { emailSigner } from "./mail";
import { inspectPdf } from "./pdf";
import {
  allSigned,
  fileNameFor,
  linksLive,
  makeEvent,
  requestDoc,
  toRequestDTO,
  toSummaryDTO,
} from "./shared";
import { completeRequest } from "./signing";

const DAY_MS = 86_400_000;
const FOLDER_KEYS: string[] = PARTICIPANT_FOLDERS.map(folder => folder.key);

async function participantNames(
  ids: Array<unknown>
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const found = await Participant.find({ _id: { $in: unique } })
    .select("name")
    .lean<Array<{ _id: unknown; name: string }>>();
  return new Map(found.map(person => [String(person._id), person.name]));
}

async function presentRequest(
  doc: SignatureRequestDoc
): Promise<SignatureRequestDTO> {
  const names = await participantNames([doc.participantId]);
  return toRequestDTO(doc, names.get(String(doc.participantId)) ?? "");
}

export async function getSignatureRequest(
  id: string
): Promise<SignatureRequestDTO> {
  return presentRequest(await requestDoc(id));
}

export async function listSignatures(
  query: z.output<typeof signatureListQuery>
): Promise<SignatureListDTO> {
  const now = new Date();
  const filter: Record<string, unknown> = {};
  if (query.participantId) filter.participantId = query.participantId;
  if (query.status === "expired") {
    filter.status = "sent";
    filter.expiresAt = { $lte: now };
  } else if (query.status === "sent") {
    filter.status = "sent";
    filter.expiresAt = { $gt: now };
  } else if (query.status !== "all") filter.status = query.status;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ title: pattern }, { "signers.name": pattern }];
  }
  const [docs, awaiting, completed, drafts, needsAttention] = await Promise.all(
    [
      SignatureRequest.find(filter)
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean<SignatureRequestDoc[]>(),
      SignatureRequest.countDocuments({
        status: "sent",
        expiresAt: { $gt: now },
      }),
      SignatureRequest.countDocuments({ status: "completed" }),
      SignatureRequest.countDocuments({ status: "draft" }),
      SignatureRequest.countDocuments({
        $or: [
          { status: "declined" },
          { status: "sent", expiresAt: { $lte: now } },
        ],
      }),
    ]
  );
  const names = await participantNames(docs.map(doc => doc.participantId));
  return {
    items: docs.map(doc =>
      toSummaryDTO(doc, names.get(String(doc.participantId)) ?? "", now)
    ),
    totals: { awaiting, completed, drafts, needsAttention },
  };
}

const titleFrom = (originalName: string) =>
  originalName
    .replace(/\.pdf$/i, "")
    .trim()
    .slice(0, 200) || "Untitled document";

/** Starts a request from an uploaded PDF. It is a draft until boxes are placed and it is sent. */
export async function createSignatureRequest(
  fields: z.output<typeof signatureCreateFields>,
  file: Express.Multer.File | undefined,
  ctx: RequestContext
): Promise<SignatureRequestDTO> {
  if (!file) throw errors.validation("Choose a PDF to send for signature.");
  const verified = await verifyUpload(file, "document");
  if (verified.extension !== ".pdf")
    throw errors.unsupportedMedia(
      "Only PDF files can be sent for signature. Save the document as a PDF first."
    );
  const pages = await inspectPdf(await fs.readFile(verified.tempPath));
  const folderKey = fields.folderKey || "agreement";
  if (!FOLDER_KEYS.includes(folderKey))
    throw errors.validation("Choose a folder that accepts documents.");
  const participant = fields.participantId
    ? await getParticipantDoc(fields.participantId)
    : null;

  const sha256 = await sha256File(verified.tempPath);
  const storageKey = storage.newKey("signatures", ".pdf");
  await storage.moveIn(verified.tempPath, storageKey);
  let created: SignatureRequestDoc;
  try {
    const doc = await SignatureRequest.create({
      title: fields.title || titleFrom(verified.originalName),
      message: fields.message ?? "",
      status: "draft",
      participantId: participant?._id ?? null,
      folderKey,
      document: {
        storageKey,
        originalName: verified.originalName,
        size: verified.size,
        sha256,
      },
      pages,
      createdBy: ctx.actor,
      events: [
        makeEvent(
          "created",
          ctx.actor.name,
          `Uploaded ${verified.originalName}`,
          { ip: ctx.ip }
        ),
      ],
    });
    created = doc.toObject<SignatureRequestDoc>();
  } catch (error) {
    await storage.remove(storageKey);
    throw error;
  }
  await logActivity({
    actor: ctx.actor,
    action: "signature.created",
    entityType: "signature",
    entityId: String(created._id),
    participantId: created.participantId,
    summary: `started a signature request for ${created.title}`,
    ip: ctx.ip,
  });
  return presentRequest(created);
}

/** Saves the title, the people and the boxes of a draft. Only a draft can change: a sent request is what the signers saw. */
export async function saveDraft(
  id: string,
  input: z.output<typeof signatureDraftSchema>
): Promise<SignatureRequestDTO> {
  const current = await requestDoc(id);
  if (current.status !== "draft")
    throw errors.invalidState(
      "This request has been sent, so it can no longer be edited. Cancel it and start a new one to change it."
    );
  const $set: Record<string, unknown> = {};
  if (input.title !== undefined) $set.title = input.title;
  if (input.message !== undefined) $set.message = input.message;
  if (input.folderKey !== undefined) {
    if (!FOLDER_KEYS.includes(input.folderKey))
      throw errors.validation("Choose a folder that accepts documents.");
    $set.folderKey = input.folderKey;
  }
  if (input.participantId !== undefined)
    $set.participantId = input.participantId
      ? (await getParticipantDoc(input.participantId))._id
      : null;

  const signerInputs = input.signers;
  const fieldInputs = input.fields;
  const signerIds = new Set(
    (signerInputs ?? current.signers).map(signer => signer.id)
  );
  if (signerInputs && signerIds.size !== signerInputs.length)
    throw errors.validation("Each person needs their own id.");
  if (fieldInputs) {
    if (new Set(fieldInputs.map(field => field.id)).size !== fieldInputs.length)
      throw errors.validation("Each box needs its own id.");
    for (const field of fieldInputs) {
      if (!signerIds.has(field.signerId))
        throw errors.validation(
          "A box belongs to someone who is not a signer."
        );
      if (field.page > current.pages.length)
        throw errors.validation(
          "A box sits on a page the document does not have."
        );
    }
  }
  if (signerInputs) {
    $set.signers = signerInputs.map(
      (signer): SignerSub => ({
        id: signer.id,
        name: signer.name,
        email: signer.email ?? "",
        roleLabel: signer.roleLabel ?? "",
        token: null,
        status: "pending",
        viewedAt: null,
        signedAt: null,
        declinedAt: null,
        declineReason: "",
        ip: "",
        userAgent: "",
        signatureKey: null,
        signatureSha256: null,
        emailedAt: null,
      })
    );
    // Removing a signer takes their boxes with them, so none are left pointing at nobody.
    if (!fieldInputs)
      $set.fields = current.fields.filter(field =>
        signerIds.has(field.signerId)
      );
  }
  if (fieldInputs)
    $set.fields = fieldInputs.map(field => ({
      id: field.id,
      signerId: field.signerId,
      type: field.type,
      page: field.page,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      required: field.type === "date" ? true : field.required,
      label: field.label ?? "",
      value: "",
    }));

  const filter: Record<string, unknown> = { _id: id, status: "draft" };
  if (input.rev !== undefined) filter.rev = input.rev;
  const updated = await SignatureRequest.findOneAndUpdate(
    filter,
    { $set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) {
    const now = await requestDoc(id);
    if (now.status !== "draft")
      throw errors.invalidState("This request has just been sent.");
    throw errors.stale();
  }
  return presentRequest(updated);
}

/* ───────────── Sending and managing ───────────── */

/**
 * Sends a draft: every signer gets their own private link, and the layout is locked. The links work
 * for `expiresInDays`. Emailing is best effort, so the sender can always copy the links instead.
 */
export async function sendSignatureRequest(
  id: string,
  input: z.output<typeof signatureSendSchema>,
  ctx: RequestContext
): Promise<SignatureSendResultDTO> {
  const doc = await requestDoc(id);
  if (doc.status !== "draft")
    throw errors.invalidState("This request has already been sent.");
  if (input.rev !== undefined && doc.rev !== input.rev) throw errors.stale();
  if (!doc.signers.length)
    throw errors.validation("Add at least one person to sign.");
  for (const signer of doc.signers)
    if (!doc.fields.some(field => field.signerId === signer.id))
      throw errors.validation(`Place at least one box for ${signer.name}.`);

  const now = new Date();
  const days = input.expiresInDays ?? SIGNATURE_LIMITS.defaultExpiryDays;
  const signers = doc.signers.map(signer => ({
    ...signer,
    token: randomToken(32),
    status: "pending" as const,
  }));
  const sent = await SignatureRequest.findOneAndUpdate(
    { _id: id, status: "draft", rev: doc.rev },
    {
      $set: {
        status: "sent",
        signers,
        sentAt: now,
        expiresAt: new Date(now.getTime() + days * DAY_MS),
      },
      $inc: { rev: 1 },
      $push: {
        events: makeEvent(
          "sent",
          ctx.actor.name,
          `Sent to ${signers.map(signer => signer.name).join(", ")}`,
          { ip: ctx.ip }
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!sent) throw errors.stale();

  const emailed: string[] = [];
  if (input.emailSigners !== false)
    for (const signer of sent.signers)
      if (await emailSigner(sent, signer, "request")) emailed.push(signer.id);
  const final = emailed.length
    ? await SignatureRequest.findOneAndUpdate(
        { _id: id },
        { $set: { "signers.$[s].emailedAt": new Date() } },
        {
          arrayFilters: [{ "s.id": { $in: emailed } }],
          returnDocument: "after",
          lean: true,
        }
      )
    : sent;
  await logActivity({
    actor: ctx.actor,
    action: "signature.sent",
    entityType: "signature",
    entityId: id,
    participantId: sent.participantId,
    summary: `sent ${sent.title} for signature to ${signers.length} ${signers.length === 1 ? "person" : "people"}`,
    ip: ctx.ip,
  });
  return {
    request: await presentRequest(final ?? sent),
    emailed,
    emailConfigured: emailEnabled(),
  };
}

async function liveRequest(id: string): Promise<SignatureRequestDoc> {
  const doc = await requestDoc(id);
  if (doc.status !== "sent")
    throw errors.invalidState("This request is not out for signature.");
  return doc;
}

/** Emails a signer their link again. Needs an email address and a mail server; otherwise the sender copies the link. */
export async function remindSigner(
  id: string,
  signerId: string,
  ctx: RequestContext
): Promise<SignatureReminderResultDTO> {
  const doc = await liveRequest(id);
  if (!linksLive(doc))
    throw errors.invalidState("This request has expired. Extend it first.");
  const signer = doc.signers.find(candidate => candidate.id === signerId);
  if (!signer) throw errors.notFound("Signer");
  if (signer.status === "signed")
    throw errors.invalidState(`${signer.name} has already signed.`);
  if (!signer.email)
    throw errors.validation(`Add an email address for ${signer.name} first.`);
  const emailed = await emailSigner(doc, signer, "reminder");
  if (!emailed)
    return {
      request: await presentRequest(doc),
      emailed,
      emailConfigured: emailEnabled(),
    };
  const updated = await SignatureRequest.findOneAndUpdate(
    { _id: id },
    {
      $set: { "signers.$[s].emailedAt": new Date() },
      $push: {
        events: makeEvent(
          "reminded",
          ctx.actor.name,
          `Emailed a reminder to ${signer.name}`,
          { signerId, ip: ctx.ip }
        ),
      },
    },
    {
      arrayFilters: [{ "s.id": signerId }],
      returnDocument: "after",
      lean: true,
    }
  );
  return {
    request: await presentRequest(updated ?? doc),
    emailed,
    emailConfigured: true,
  };
}

/** Replaces one signer's link, so a link that went to the wrong place stops working. */
export async function resetSignerLink(
  id: string,
  signerId: string,
  ctx: RequestContext
): Promise<SignatureRequestDTO> {
  await liveRequest(id);
  const updated = await SignatureRequest.findOneAndUpdate(
    {
      _id: id,
      status: "sent",
      signers: {
        $elemMatch: { id: signerId, status: { $in: ["pending", "viewed"] } },
      },
    },
    {
      $set: { "signers.$.token": randomToken(32) },
      $inc: { rev: 1 },
      $push: {
        events: makeEvent(
          "link_reset",
          ctx.actor.name,
          "Replaced the signing link; the old one no longer works",
          { signerId, ip: ctx.ip }
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated)
    throw errors.invalidState(
      "That person has already signed, so their link cannot be replaced."
    );
  return presentRequest(updated);
}

/** Gives a sent request more time, counted from today. Works on one that has already expired. */
export async function extendRequest(
  id: string,
  input: z.output<typeof signatureExtendSchema>,
  ctx: RequestContext
): Promise<SignatureRequestDTO> {
  await liveRequest(id);
  const expiresAt = new Date(Date.now() + input.days * DAY_MS);
  const updated = await SignatureRequest.findOneAndUpdate(
    { _id: id, status: "sent" },
    {
      $set: { expiresAt },
      $inc: { rev: 1 },
      $push: {
        events: makeEvent(
          "extended",
          ctx.actor.name,
          `Extended the deadline by ${input.days} ${input.days === 1 ? "day" : "days"}`,
          { ip: ctx.ip }
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated)
    throw errors.invalidState("This request is not out for signature.");
  return presentRequest(updated);
}

/** Stops a request that is out for signature. Every link stops working at once. */
export async function cancelRequest(
  id: string,
  input: z.output<typeof signatureCancelSchema>,
  ctx: RequestContext
): Promise<SignatureRequestDTO> {
  await liveRequest(id);
  const reason = input.reason?.trim();
  const updated = await SignatureRequest.findOneAndUpdate(
    { _id: id, status: "sent" },
    {
      $set: { status: "cancelled" },
      $inc: { rev: 1 },
      $push: {
        events: makeEvent(
          "cancelled",
          ctx.actor.name,
          reason ? `Cancelled the request: ${reason}` : "Cancelled the request",
          { ip: ctx.ip }
        ),
      },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated)
    throw errors.invalidState("This request is not out for signature.");
  await logActivity({
    actor: ctx.actor,
    action: "signature.cancelled",
    entityType: "signature",
    entityId: id,
    participantId: updated.participantId,
    summary: `cancelled the signature request for ${updated.title}`,
    ip: ctx.ip,
  });
  return presentRequest(updated);
}

/** Retries building the signed copy when everyone has signed but it was not created. */
export async function sealRequest(id: string): Promise<SignatureRequestDTO> {
  const doc = await liveRequest(id);
  if (!allSigned(doc))
    throw errors.invalidState("Not everyone has signed yet.");
  await completeRequest(id);
  const after = await requestDoc(id);
  if (after.status !== "completed")
    throw errors.provider(
      "The signed copy could not be created just now. Try again in a minute."
    );
  return presentRequest(after);
}

/** Removes a request that is not live and was never finished. A signed document is a record and stays. */
export async function deleteRequest(
  id: string,
  ctx: RequestContext
): Promise<void> {
  const doc = await requestDoc(id);
  const expired = doc.status === "sent" && !linksLive(doc);
  if (doc.status === "completed")
    throw errors.invalidState(
      "A signed document is kept as a record and cannot be deleted."
    );
  if (doc.status === "sent" && !expired)
    throw errors.invalidState("Cancel this request before deleting it.");
  const removed = await SignatureRequest.deleteOne({
    _id: id,
    status: doc.status,
  });
  if (!removed.deletedCount)
    throw errors.invalidState(
      "This request has just changed. Reload the page and try again."
    );
  await storage.remove(doc.document.storageKey);
  for (const signer of doc.signers) await storage.remove(signer.signatureKey);
  await logActivity({
    actor: ctx.actor,
    action: "signature.deleted",
    entityType: "signature",
    entityId: id,
    participantId: doc.participantId,
    summary: `deleted the signature request for ${doc.title}`,
    ip: ctx.ip,
  });
}

/* ───────────── Downloads ───────────── */

async function stored(key: string, originalName: string) {
  if (!(await storage.exists(key))) throw errors.notFound("File");
  return {
    absolutePath: storage.resolve(key),
    originalName,
    mimeType: "application/pdf",
  };
}

export async function originalFile(id: string) {
  const doc = await requestDoc(id);
  return stored(doc.document.storageKey, doc.document.originalName);
}

export async function signedFile(id: string) {
  const doc = await requestDoc(id);
  if (doc.status !== "completed" || !doc.signed)
    throw errors.invalidState(
      "This document has not been signed by everyone yet."
    );
  return stored(doc.signed.storageKey, fileNameFor(doc.title, "-signed"));
}
