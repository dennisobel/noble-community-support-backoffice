import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { z } from "zod";
import type { PublicSigningDTO, PublicSigningResultDTO } from "@shared/dto";
import type { SigningState } from "@shared/enums";
import { ymdIn } from "@shared/logic/time";
import {
  SIGNATURE_LIMITS,
  type signDeclineSchema,
  type signSubmitSchema,
} from "@shared/schemas/signatures";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { withTransaction } from "../../lib/db";
import { errors } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { storage } from "../../lib/storage";
import { getWorkspace } from "../../lib/workspace";
import {
  DocumentModel,
  Participant,
  SignatureRequest,
  type SignatureRequestDoc,
  type SignerSub,
} from "../../models";
import { emailCompleted } from "./mail";
import { buildSignedPdf, canEmbedPng } from "./pdf";
import {
  allSigned,
  effectiveStatus,
  fileNameFor,
  linksLive,
  makeEvent,
  type EventMeta,
} from "./shared";

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
/** A sealed copy being built longer than this ago is assumed to have been interrupted. */
const SEAL_CLAIM_MS = 2 * 60_000;

/** Decodes a drawn or typed signature and refuses anything that is not a modest PNG picture. */
async function readSignaturePicture(dataUrl: string): Promise<Buffer> {
  const match = PNG_DATA_URL.exec(dataUrl);
  const bad = () =>
    errors.validation(
      "That signature could not be read. Clear it and sign again."
    );
  if (!match) throw bad();
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > SIGNATURE_LIMITS.signatureBytes)
    throw errors.validation(
      "That signature is too large. Clear it and sign again."
    );
  const type = await fileTypeFromBuffer(bytes);
  if (
    type?.mime !== "image/png" ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  )
    throw bad();
  // A tiny PNG can describe a huge picture, so the size is read from its header, not guessed from the bytes.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const limit = SIGNATURE_LIMITS.signaturePixels;
  if (
    !width ||
    !height ||
    width > limit ||
    height > limit ||
    width * height > 3_000_000
  )
    throw bad();
  if (!(await canEmbedPng(bytes))) throw bad();
  return bytes;
}

async function byToken(
  token: string
): Promise<{ doc: SignatureRequestDoc; signer: SignerSub }> {
  const doc = await SignatureRequest.findOne({
    "signers.token": token,
  }).lean<SignatureRequestDoc>();
  const signer = doc?.signers.find(candidate => candidate.token === token);
  // An unknown, replaced or never-sent link all look the same, so a token cannot be probed for.
  if (!doc || !signer || doc.status === "draft")
    throw errors.notFound("Signing link");
  return { doc, signer };
}

function stateFor(
  doc: SignatureRequestDoc,
  signer: SignerSub,
  now: Date
): SigningState {
  if (doc.status === "cancelled") return "cancelled";
  if (doc.status === "declined") return "declined";
  if (doc.status === "completed") return "completed";
  if (effectiveStatus(doc, now) === "expired") return "expired";
  return signer.status === "signed" ? "signed" : "open";
}

const refusal: Record<Exclude<SigningState, "open">, string> = {
  signed: "You have already signed this document.",
  completed: "This document has already been signed by everyone.",
  declined: "This document was declined, so it can no longer be signed.",
  cancelled: "The sender cancelled this request.",
  expired: "This link has expired. Ask the sender for a new one.",
};

/** What the person holding the link is shown. Opening it for the first time is recorded. */
export async function publicSigning(
  token: string,
  meta: EventMeta
): Promise<PublicSigningDTO> {
  const { doc, signer } = await byToken(token);
  const now = new Date();
  const state = stateFor(doc, signer, now);
  let status = signer.status;
  if (state === "open" && signer.status === "pending") {
    const marked = await SignatureRequest.updateOne(
      {
        _id: doc._id,
        status: "sent",
        signers: { $elemMatch: { id: signer.id, status: "pending" } },
      },
      {
        $set: { "signers.$.status": "viewed", "signers.$.viewedAt": now },
        $push: {
          events: makeEvent("viewed", signer.name, "Opened the document", {
            signerId: signer.id,
            ...meta,
          }),
        },
      }
    );
    if (marked.modifiedCount) status = "viewed";
  }
  const workspace = await getWorkspace();
  return {
    state,
    title: doc.title,
    message: doc.message ?? "",
    senderName: workspace.name,
    signer: {
      name: signer.name,
      roleLabel: signer.roleLabel ?? "",
      status,
      signedAt: signer.signedAt ? signer.signedAt.toISOString() : null,
    },
    others: doc.signers
      .filter(other => other.id !== signer.id)
      .map(other => ({
        name: other.name,
        roleLabel: other.roleLabel ?? "",
        status: other.status,
      })),
    pages: doc.pages.map(page => ({ width: page.width, height: page.height })),
    fields:
      state === "open"
        ? doc.fields
            .filter(field => field.signerId === signer.id)
            .map(field => ({
              id: field.id,
              type: field.type,
              page: field.page,
              x: field.x,
              y: field.y,
              w: field.w,
              h: field.h,
              required: field.required,
              label: field.label ?? "",
            }))
        : [],
    today: ymdIn(workspace.timezone || config().timezone, now),
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    canDownload: state === "completed" && linksLive(doc, now),
  };
}

/** The file behind a link: the original while people are still signing, the finished copy afterwards. */
export async function publicSigningFile(
  token: string
): Promise<{ absolutePath: string; originalName: string; mimeType: string }> {
  const { doc, signer } = await byToken(token);
  const state = stateFor(doc, signer, new Date());
  let file: { storageKey: string; originalName: string } | null = null;
  if (state === "open" || state === "signed") file = doc.document;
  else if (state === "completed" && linksLive(doc) && doc.signed)
    file = doc.signed;
  if (!file || !(await storage.exists(file.storageKey)))
    throw errors.notFound("Document");
  return {
    absolutePath: storage.resolve(file.storageKey),
    originalName: file.originalName,
    mimeType: "application/pdf",
  };
}

const CONTROL = /[\u0000-\u001f\u007f]+/g;

export async function submitSigning(
  token: string,
  input: z.output<typeof signSubmitSchema>,
  meta: Required<EventMeta>
): Promise<PublicSigningResultDTO> {
  const { doc: first, signer: firstSigner } = await byToken(token);
  const now = new Date();
  const state = stateFor(first, firstSigner, now);
  if (state !== "open") throw errors.invalidState(refusal[state]);

  const mine = first.fields.filter(field => field.signerId === firstSigner.id);
  const answers = new Map(input.values.map(item => [item.fieldId, item.value]));
  for (const id of answers.keys())
    if (!mine.some(field => field.id === id))
      throw errors.validation(
        "One of the answers does not belong to this document."
      );

  const today = ymdIn(
    (await getWorkspace()).timezone || config().timezone,
    now
  );
  const filled = new Map<string, string>();
  for (const field of mine) {
    const name = field.label ? `"${field.label}"` : "every box marked required";
    if (field.type === "signature") continue;
    if (field.type === "date") {
      filled.set(field.id, today);
      continue;
    }
    const raw = (answers.get(field.id) ?? "").replace(CONTROL, " ").trim();
    if (field.type === "checkbox") {
      if (field.required && raw !== "true")
        throw errors.validation(`Tick ${name} to continue.`);
      filled.set(field.id, raw === "true" ? "true" : "false");
    } else {
      if (field.required && !raw)
        throw errors.validation(`Fill in ${name} to continue.`);
      filled.set(field.id, raw.slice(0, 300));
    }
  }

  const needsPicture = mine.some(field => field.type === "signature");
  if (needsPicture && !input.signature)
    throw errors.validation("Add your signature to continue.");
  const picture = needsPicture
    ? await readSignaturePicture(input.signature!)
    : null;
  const signatureKey = picture ? storage.newKey("signatures", ".png") : null;
  if (picture && signatureKey) await storage.write(signatureKey, picture);
  const signatureSha256 = picture
    ? createHash("sha256").update(picture).digest("hex")
    : null;

  try {
    await withTransaction(async session => {
      const doc = await SignatureRequest.findOne({ "signers.token": token })
        .session(session)
        .lean<SignatureRequestDoc>();
      const signer = doc?.signers.find(candidate => candidate.token === token);
      if (!doc || !signer || doc.status === "draft")
        throw errors.notFound("Signing link");
      // Checked again inside the transaction: a second tab, or another signer finishing, may have got here first.
      const current = stateFor(doc, signer, new Date());
      if (current !== "open") throw errors.invalidState(refusal[current]);
      const signedAt = new Date();
      const boxes = filled.size + (needsPicture ? 1 : 0);
      await SignatureRequest.updateOne(
        { _id: doc._id, status: "sent" },
        {
          $set: {
            signers: doc.signers.map(candidate =>
              candidate.id === signer.id
                ? {
                    ...candidate,
                    status: "signed",
                    signedAt,
                    ip: meta.ip,
                    userAgent: meta.userAgent,
                    signatureKey,
                    signatureSha256,
                  }
                : candidate
            ),
            fields: doc.fields.map(field =>
              field.signerId === signer.id && filled.has(field.id)
                ? { ...field, value: filled.get(field.id)! }
                : field
            ),
          },
          $push: {
            events: makeEvent(
              "signed",
              signer.name,
              `Agreed to sign electronically and signed (${boxes} ${boxes === 1 ? "box" : "boxes"} completed)`,
              { signerId: signer.id, ...meta }
            ),
          },
        },
        { session }
      );
    });
  } catch (error) {
    await storage.remove(signatureKey);
    throw error;
  }

  await logActivity({
    actor: null,
    action: "signature.signed",
    entityType: "signature",
    entityId: String(first._id),
    participantId: first.participantId,
    summary: `${firstSigner.name} signed ${first.title}`,
    ip: meta.ip,
  });
  const after = await SignatureRequest.findById(
    first._id
  ).lean<SignatureRequestDoc>();
  if (after && after.status === "sent" && allSigned(after))
    await completeRequest(String(after._id));
  const finished = await SignatureRequest.findById(first._id)
    .select("status")
    .lean<Pick<SignatureRequestDoc, "status">>();
  return { state: finished?.status === "completed" ? "completed" : "signed" };
}

export async function declineSigning(
  token: string,
  input: z.output<typeof signDeclineSchema>,
  meta: Required<EventMeta>
): Promise<PublicSigningResultDTO> {
  const { doc: first, signer: firstSigner } = await byToken(token);
  const state = stateFor(first, firstSigner, new Date());
  if (state !== "open") throw errors.invalidState(refusal[state]);
  const reason = (input.reason ?? "").replace(CONTROL, " ").trim();
  await withTransaction(async session => {
    const doc = await SignatureRequest.findOne({ "signers.token": token })
      .session(session)
      .lean<SignatureRequestDoc>();
    const signer = doc?.signers.find(candidate => candidate.token === token);
    if (!doc || !signer) throw errors.notFound("Signing link");
    const current = stateFor(doc, signer, new Date());
    if (current !== "open") throw errors.invalidState(refusal[current]);
    const declinedAt = new Date();
    await SignatureRequest.updateOne(
      { _id: doc._id, status: "sent" },
      {
        $set: {
          status: "declined",
          signers: doc.signers.map(candidate =>
            candidate.id === signer.id
              ? {
                  ...candidate,
                  status: "declined",
                  declinedAt,
                  declineReason: reason,
                  ip: meta.ip,
                  userAgent: meta.userAgent,
                }
              : candidate
          ),
        },
        $inc: { rev: 1 },
        $push: {
          events: makeEvent(
            "declined",
            signer.name,
            reason ? `Declined to sign: ${reason}` : "Declined to sign",
            { signerId: signer.id, ...meta }
          ),
        },
      },
      { session }
    );
  });
  await logActivity({
    actor: null,
    action: "signature.declined",
    entityType: "signature",
    entityId: String(first._id),
    participantId: first.participantId,
    summary: `${firstSigner.name} declined to sign ${first.title}`,
    ip: meta.ip,
  });
  return { state: "declined" };
}

/* ───────────── Finishing ───────────── */

/** Copies the finished PDF into the client's own documents, so it sits with the rest of their file. */
async function fileSignedCopy(doc: SignatureRequestDoc): Promise<void> {
  if (!doc.participantId || !doc.signed) return;
  if (!(await Participant.exists({ _id: doc.participantId }))) return;
  const key = storage.newKey("documents", ".pdf");
  await storage.copy(doc.signed.storageKey, key);
  try {
    const workspace = await getWorkspace();
    const created = await DocumentModel.create({
      scope: "participant",
      participantId: doc.participantId,
      folderKey: doc.folderKey || "agreement",
      title: `${doc.title} (signed)`,
      notes: `Signed electronically by ${doc.signers.map(signer => signer.name).join(", ")}. Signature request ${doc._id}.`,
      docDate: ymdIn(
        workspace.timezone || config().timezone,
        doc.signed.completedAt
      ),
      kind: "file",
      file: {
        storageKey: key,
        originalName: doc.signed.originalName,
        mimeType: "application/pdf",
        size: doc.signed.size,
        sha256: doc.signed.sha256,
      },
      uploadedBy: doc.createdBy,
    });
    await SignatureRequest.updateOne(
      { _id: doc._id },
      { $set: { filedDocumentId: created._id } }
    );
  } catch (error) {
    await storage.remove(key);
    throw error;
  }
}

/**
 * Builds the finished PDF once the last person has signed. Safe to call again: only one caller at a
 * time can claim the job, and a claim left behind by a crashed process expires.
 */
export async function completeRequest(id: string): Promise<boolean> {
  const claimed = await SignatureRequest.findOneAndUpdate(
    {
      _id: id,
      status: "sent",
      $or: [
        { sealClaimedAt: null },
        { sealClaimedAt: { $lt: new Date(Date.now() - SEAL_CLAIM_MS) } },
      ],
    },
    { $set: { sealClaimedAt: new Date() } },
    { returnDocument: "after", lean: true }
  );
  if (!claimed) return false;
  const release = () =>
    SignatureRequest.updateOne(
      { _id: id, status: "sent" },
      { $set: { sealClaimedAt: null } }
    );
  if (!allSigned(claimed)) {
    await release();
    return false;
  }

  let signedKey: string | null = null;
  try {
    const workspace = await getWorkspace();
    const completedAt = new Date();
    const signers = await Promise.all(
      claimed.signers.map(async signer => ({
        id: signer.id,
        name: signer.name,
        email: signer.email ?? "",
        roleLabel: signer.roleLabel ?? "",
        status: signer.status,
        signedAt: signer.signedAt,
        ip: signer.ip ?? "",
        userAgent: signer.userAgent ?? "",
        image: signer.signatureKey
          ? await storage.read(signer.signatureKey)
          : null,
      }))
    );
    const bytes = await buildSignedPdf({
      original: await storage.read(claimed.document.storageKey),
      requestId: String(claimed._id),
      title: claimed.title,
      originalName: claimed.document.originalName,
      originalSha256: claimed.document.sha256,
      senderName: workspace.name,
      createdBy: claimed.createdBy?.name ?? "",
      createdAt: claimed.createdAt,
      sentAt: claimed.sentAt,
      completedAt,
      timeZone: workspace.timezone || config().timezone,
      signers,
      fields: claimed.fields,
      events: [
        ...claimed.events,
        {
          at: completedAt,
          by: "System",
          detail: "Everyone has signed. This signed copy was created.",
          ip: "",
        },
      ],
    });
    signedKey = storage.newKey("signatures", ".pdf");
    await storage.write(signedKey, bytes);
    const done = await SignatureRequest.findOneAndUpdate(
      { _id: id, status: "sent" },
      {
        $set: {
          status: "completed",
          completedAt,
          sealClaimedAt: null,
          signed: {
            storageKey: signedKey,
            originalName: fileNameFor(claimed.title, "-signed"),
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            completedAt,
          },
        },
        $inc: { rev: 1 },
        $push: {
          events: makeEvent(
            "completed",
            "System",
            "Everyone has signed. The signed copy was created."
          ),
        },
      },
      { returnDocument: "after", lean: true }
    );
    if (!done) {
      await storage.remove(signedKey);
      return false;
    }
    await fileSignedCopy(done).catch(error =>
      logger().error({ err: error, id }, "Filing the signed copy failed")
    );
    await emailCompleted(done).catch(error =>
      logger().warn({ err: error, id }, "Completion emails failed")
    );
    await logActivity({
      actor: null,
      action: "signature.completed",
      entityType: "signature",
      entityId: id,
      participantId: done.participantId,
      summary: `${done.title} was signed by everyone`,
    });
    return true;
  } catch (error) {
    await storage.remove(signedKey);
    await release();
    logger().error({ err: error, id }, "Building the signed PDF failed");
    return false;
  }
}

/** Housekeeping: finishes any request whose last signature landed but whose signed copy was never built. */
export async function completeStuckRequests(): Promise<number> {
  const stuck = await SignatureRequest.find({
    status: "sent",
    "signers.0": { $exists: true },
    signers: { $not: { $elemMatch: { status: { $ne: "signed" } } } },
  })
    .select("_id")
    .limit(20)
    .lean<Array<{ _id: unknown }>>();
  let finished = 0;
  for (const request of stuck)
    if (await completeRequest(String(request._id))) finished += 1;
  return finished;
}
