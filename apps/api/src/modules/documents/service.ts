import path from "node:path";
import type { Types } from "mongoose";
import type { z } from "zod";
import type { DocumentDTO, TreeNode } from "@shared/dto";
import {
  ORGANISATION_FOLDERS,
  PARTICIPANT_FOLDERS,
  TEMPLATE_SLOTS,
  type DocumentScope,
} from "@shared/enums";
import { initialsOf } from "@shared/logic/ndis";
import { prettyDate } from "@shared/logic/time";
import type {
  documentListQuery,
  documentPatchSchema,
  documentUploadFields,
} from "@shared/schemas/documents";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import { actorDTO, isoRequired } from "../../lib/mappers";
import { sha256File, storage } from "../../lib/storage";
import { verifyUpload, type VerifiedFile } from "../../middleware/upload";
import {
  DocumentModel,
  ServiceRecord,
  type DocumentDoc,
  type ParticipantDoc,
} from "../../models";
import { getParticipantDoc } from "../participants/service";
import { xeroConnected } from "../xero/service";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function toDocumentDTO(doc: DocumentDoc): DocumentDTO {
  return {
    id: String(doc._id),
    scope: doc.scope,
    participantId: doc.participantId ? String(doc.participantId) : null,
    folderKey: doc.folderKey,
    title: doc.title,
    notes: doc.notes ?? "",
    docDate: doc.docDate ?? null,
    kind: doc.kind,
    slotKey: doc.slotKey ?? null,
    file: doc.file
      ? {
          originalName: doc.file.originalName,
          mimeType: doc.file.mimeType,
          size: doc.file.size,
        }
      : null,
    uploadedBy: actorDTO(doc.uploadedBy),
    createdAt: isoRequired(doc.createdAt),
    updatedAt: isoRequired(doc.updatedAt),
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

function folderKeysFor(scope: DocumentScope): string[] {
  return scope === "participant"
    ? PARTICIPANT_FOLDERS.map(folder => folder.key)
    : ORGANISATION_FOLDERS.map(folder => folder.key);
}

function assertFolder(scope: DocumentScope, folderKey: string): void {
  if (!folderKeysFor(scope).includes(folderKey))
    throw errors.validation("Choose a folder that accepts documents.");
}

/** Makes sure the four organisation template slots exist (idempotent). */
export async function ensureTemplateSlots(): Promise<void> {
  for (const slot of TEMPLATE_SLOTS) {
    await DocumentModel.updateOne(
      { kind: "template-slot", slotKey: slot.key },
      {
        $setOnInsert: {
          scope: "organisation",
          participantId: null,
          folderKey: "templates",
          title: slot.title,
          notes: "",
          kind: "template-slot",
          slotKey: slot.key,
          file: null,
          deletedAt: null,
        },
      },
      { upsert: true }
    );
  }
}

/* ───────────── Trees ───────────── */

function countLeaves(node: TreeNode): number {
  if (node.kind !== "folder") return 1;
  return (node.children ?? []).reduce(
    (total, child) => total + countLeaves(child),
    0
  );
}

function withCounts(node: TreeNode): TreeNode {
  if (node.kind !== "folder") return node;
  const children = (node.children ?? []).map(withCounts);
  return {
    ...node,
    children,
    count: children.reduce(
      (total, child) =>
        total + (child.kind === "folder" ? (child.count ?? 0) : 1),
      0
    ),
  };
}

function fileNode(doc: DocumentDoc): TreeNode {
  const uploaded = prettyDate(doc.createdAt.toISOString().slice(0, 10));
  return {
    id: `doc-${doc._id}`,
    title: doc.title,
    description: doc.file
      ? `${doc.file.originalName} · ${formatSize(doc.file.size)} · added ${uploaded}`
      : "No file attached",
    kind: "file",
    documentId: String(doc._id),
    folderKey: doc.folderKey,
    file: doc.file
      ? {
          originalName: doc.file.originalName,
          mimeType: doc.file.mimeType,
          size: doc.file.size,
        }
      : null,
    updatedAt: isoRequired(doc.updatedAt),
  };
}

/** Year (newest first) → month (chronological) folders of linked service records. */
function datedFolders(
  prefix: string,
  records: Array<{ _id: string; date: string }>,
  describeYear: (year: string) => string,
  describeMonth: (month: string, year: string) => string,
  leaf: (record: { _id: string; date: string }) => TreeNode
): TreeNode[] {
  const years = new Map<string, Map<string, TreeNode[]>>();
  for (const record of records) {
    const year = record.date.slice(0, 4);
    const month = record.date.slice(5, 7);
    const months = years.get(year) ?? new Map<string, TreeNode[]>();
    months.set(month, [...(months.get(month) ?? []), leaf(record)]);
    years.set(year, months);
  }
  return [...years.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(year => ({
      id: `${prefix}-${year}`,
      title: year,
      description: describeYear(year),
      kind: "folder" as const,
      children: [...years.get(year)!.keys()].sort().map(month => ({
        id: `${prefix}-${year}-${month}`,
        title: MONTHS[Number(month) - 1],
        description: describeMonth(MONTHS[Number(month) - 1], year),
        kind: "folder" as const,
        children: years.get(year)!.get(month)!,
      })),
    }));
}

export async function participantTree(
  participantId: string
): Promise<TreeNode> {
  const participant: ParticipantDoc = await getParticipantDoc(participantId);
  const pid = String(participant._id);
  const [records, docs] = await Promise.all([
    ServiceRecord.find({ clientId: participant._id })
      .select("_id date start type status km")
      .sort({ date: 1, start: 1 })
      .lean<
        Array<{
          _id: string;
          date: string;
          type: string;
          status: string;
          km: number;
        }>
      >(),
    DocumentModel.find({
      scope: "participant",
      participantId: participant._id,
      deletedAt: null,
      kind: "file",
    })
      .sort({ createdAt: -1 })
      .lean<DocumentDoc[]>(),
  ]);
  const files = (folderKey: string) =>
    docs.filter(doc => doc.folderKey === folderKey).map(fileNode);
  const kyc = participant.kyc;
  const badge = (ok: boolean, yes: string, no: string) => ({
    badge: ok ? yes : no,
    badgeTone: ok ? ("ok" as const) : ("pending" as const),
  });
  const byId = new Map(records.map(record => [record._id, record]));

  const tree: TreeNode = {
    id: `client-${pid}`,
    title: `Client ${String(participant.clientNumber).padStart(3, "0")} – ${initialsOf(participant.name)}`,
    description: `${participant.name} · preferred name ${participant.preferred}`,
    kind: "folder",
    clientId: pid,
    children: [
      {
        id: `${pid}-profile`,
        title: "01 Participant Profile",
        description: "Profile, contacts, preferences and alerts.",
        kind: "folder",
        clientId: pid,
        children: [
          {
            id: `${pid}-profile-link`,
            title: "Participant profile in Noble",
            description: "Open the in-app participant profile.",
            kind: "reference",
            clientId: pid,
          },
        ],
      },
      {
        id: `${pid}-agreement`,
        title: "02 Service Agreement & Consent",
        description: "Signed service agreements and consent forms.",
        kind: "folder",
        folderKey: "agreement",
        uploadable: true,
        ...badge(
          kyc.serviceAgreement && kyc.consentForms,
          "Received",
          "Pending"
        ),
        children: files("agreement"),
      },
      {
        id: `${pid}-plans`,
        title: "03 Support Plans & Goals",
        description: "Current plan, goals and review documents.",
        kind: "folder",
        folderKey: "plans",
        uploadable: true,
        clientId: pid,
        ...badge(kyc.supportPlan, "Received", "Pending"),
        children: [
          {
            id: `${pid}-goals-link`,
            title: "Current goals and support summary",
            description: `${participant.goals.length} goal${participant.goals.length === 1 ? "" : "s"} · available in the participant profile.`,
            kind: "reference",
            clientId: pid,
          },
          ...files("plans"),
        ],
      },
      {
        id: `${pid}-notes`,
        title: "04 Progress Notes",
        description: "Linked service notes organised by year and month.",
        kind: "folder",
        children: datedFolders(
          `${pid}-notes`,
          records,
          year => `Progress-note folders for the ${year} calendar year.`,
          (month, year) => `Progress notes filed for ${month} ${year}.`,
          record => {
            const full = byId.get(record._id)!;
            return {
              id: `${pid}-${record._id}`,
              title: `${record._id} · ${full.type}`,
              description: `${prettyDate(record.date)} · ${full.status} · linked portal record`,
              kind: "record",
              recordId: record._id,
              clientId: pid,
            };
          }
        ),
      },
      {
        id: `${pid}-incidents`,
        title: "05 Incidents & Hazards",
        description: "Incident reports, hazard records and follow-up.",
        kind: "folder",
        folderKey: "incidents",
        uploadable: true,
        ...badge(kyc.riskInformationReviewed, "Reviewed", "Check required"),
        children: files("incidents"),
      },
      {
        id: `${pid}-transport`,
        title: "06 Transport & Kilometres",
        description: "Travel and kilometre entries linked to service records.",
        kind: "folder",
        ...badge(kyc.transportRequirementsConfirmed, "Confirmed", "Pending"),
        children: datedFolders(
          `${pid}-travel`,
          records.filter(record => (record.km ?? 0) > 0),
          year => `Transport entries for the ${year} calendar year.`,
          (month, year) => `Travel records for ${month} ${year}.`,
          record => {
            const full = byId.get(record._id)!;
            return {
              id: `${pid}-travel-${record._id}`,
              title: `${record._id} · ${full.km.toFixed(1)} km`,
              description: `${prettyDate(record.date)} · linked service record`,
              kind: "record",
              recordId: record._id,
              clientId: pid,
            };
          }
        ),
      },
      {
        id: `${pid}-correspondence`,
        title: "07 Correspondence",
        description: "Participant and nominee correspondence.",
        kind: "folder",
        folderKey: "correspondence",
        uploadable: true,
        children: files("correspondence"),
      },
    ],
  };
  return withCounts(tree);
}

export async function organisationTree(): Promise<TreeNode> {
  const docs = await DocumentModel.find({
    scope: "organisation",
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean<DocumentDoc[]>();
  const files = (folderKey: string) =>
    docs
      .filter(doc => doc.kind === "file" && doc.folderKey === folderKey)
      .map(fileNode);
  const slots = TEMPLATE_SLOTS.map(slot =>
    docs.find(doc => doc.kind === "template-slot" && doc.slotKey === slot.key)
  ).filter(Boolean) as DocumentDoc[];
  const business = ORGANISATION_FOLDERS.filter(
    folder => folder.group === "business"
  );
  const xero = await xeroConnected();
  const tree: TreeNode = {
    id: "org-root",
    title: "Organisation files",
    description:
      "Policies, finance references and reusable organisation templates.",
    kind: "folder",
    children: [
      {
        id: "business-root",
        title: "02 BUSINESS DOCUMENTS",
        description:
          "Organisation-wide policy, insurance, worker and NDIS files.",
        kind: "folder",
        children: business.map(folder => ({
          id: `org-${folder.key}`,
          title: folder.title,
          description: `Organisation-wide ${folder.title.toLowerCase()} documents.`,
          kind: "folder" as const,
          folderKey: folder.key,
          uploadable: true,
          children: files(folder.key),
        })),
      },
      {
        id: "finance-root",
        title: "03 FINANCE",
        description: "Accounting records and finance references.",
        kind: "folder",
        children: [
          {
            id: "xero-records",
            title: "Xero / accounting records",
            description: xero
              ? "External accounting records · kept in Xero."
              : "External accounting records · Xero is not connected.",
            kind: "external",
            badge: xero ? "Connected" : "Not connected",
            badgeTone: xero ? "ok" : "external",
          },
          {
            id: "org-finance",
            title: "Finance documents",
            description: "Statements, remittances and other finance files.",
            kind: "folder",
            folderKey: "finance",
            uploadable: true,
            children: files("finance"),
          },
        ],
      },
      {
        id: "templates-root",
        title: "04 TEMPLATES",
        description: "Approved reusable forms and note templates.",
        kind: "folder",
        folderKey: "templates",
        uploadable: true,
        children: [
          ...slots.map(slot => ({
            id: `slot-${slot.slotKey}`,
            title: slot.title,
            description: slot.file
              ? `${slot.file.originalName} · ${formatSize(slot.file.size)} · updated ${prettyDate(slot.updatedAt.toISOString().slice(0, 10))}`
              : "Template slot · upload the approved source file.",
            kind: "template" as const,
            documentId: String(slot._id),
            folderKey: "templates",
            file: slot.file
              ? {
                  originalName: slot.file.originalName,
                  mimeType: slot.file.mimeType,
                  size: slot.file.size,
                }
              : null,
            ...(slot.file
              ? {}
              : { badge: "No file attached", badgeTone: "pending" as const }),
            updatedAt: isoRequired(slot.updatedAt),
          })),
          ...files("templates"),
        ],
      },
    ],
  };
  return withCounts(tree);
}

/* ───────────── Files ───────────── */

export async function listDocuments(
  query: z.output<typeof documentListQuery>
): Promise<DocumentDTO[]> {
  const filter: Record<string, unknown> = {
    scope: query.scope,
    deletedAt: null,
  };
  if (query.participantId) filter.participantId = query.participantId;
  if (query.folderKey) filter.folderKey = query.folderKey;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [
      { title: pattern },
      { "file.originalName": pattern },
      { notes: pattern },
    ];
  }
  const docs = await DocumentModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean<DocumentDoc[]>();
  return docs.map(toDocumentDTO);
}

async function getDocumentDoc(id: string): Promise<DocumentDoc> {
  const doc = await DocumentModel.findOne({
    _id: id,
    deletedAt: null,
  }).lean<DocumentDoc>();
  if (!doc) throw errors.notFound("Document");
  return doc;
}

export async function getDocument(id: string): Promise<DocumentDTO> {
  return toDocumentDTO(await getDocumentDoc(id));
}

async function storeVerified(file: VerifiedFile) {
  const sha256 = await sha256File(file.tempPath);
  const storageKey = storage.newKey("documents", file.extension);
  await storage.moveIn(file.tempPath, storageKey);
  return {
    storageKey,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    sha256,
  };
}

const titleFrom = (originalName: string) =>
  path.basename(originalName, path.extname(originalName)).slice(0, 200) ||
  "Untitled document";

export async function uploadDocuments(
  fields: z.output<typeof documentUploadFields>,
  files: Express.Multer.File[],
  ctx: RequestContext
): Promise<DocumentDTO[]> {
  if (!files.length)
    throw errors.validation("Choose at least one file to upload.");
  assertFolder(fields.scope, fields.folderKey);
  let participantId: Types.ObjectId | null = null;
  if (fields.scope === "participant")
    participantId = (await getParticipantDoc(fields.participantId!))._id;

  // Verify every file before storing any of them, so a bad file rejects the whole upload.
  const verified: VerifiedFile[] = [];
  for (const file of files) verified.push(await verifyUpload(file, "document"));

  const created: DocumentDoc[] = [];
  for (const file of verified) {
    const stored = await storeVerified(file);
    try {
      const doc = await DocumentModel.create({
        scope: fields.scope,
        participantId,
        folderKey: fields.folderKey,
        title:
          verified.length === 1 && fields.title
            ? fields.title
            : titleFrom(file.originalName),
        notes: fields.notes ?? "",
        docDate: fields.docDate || null,
        kind: "file",
        file: stored,
        uploadedBy: ctx.actor,
      });
      created.push(doc.toObject<DocumentDoc>());
    } catch (error) {
      await storage.remove(stored.storageKey);
      throw error;
    }
  }
  await logActivity({
    actor: ctx.actor,
    action: "document.uploaded",
    entityType: "document",
    entityId: String(created[0]._id),
    participantId,
    summary:
      created.length === 1
        ? `uploaded ${created[0].title}`
        : `uploaded ${created.length} documents`,
    meta: { folderKey: fields.folderKey, count: created.length },
    ip: ctx.ip,
  });
  return created.map(toDocumentDTO);
}

/** Attaches or replaces the file on a document or template slot. */
export async function replaceDocumentFile(
  id: string,
  file: Express.Multer.File | undefined,
  ctx: RequestContext
): Promise<DocumentDTO> {
  if (!file) throw errors.validation("Choose a file to upload.");
  const current = await getDocumentDoc(id);
  const stored = await storeVerified(await verifyUpload(file, "document"));
  const updated = await DocumentModel.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { file: stored, uploadedBy: ctx.actor } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) {
    await storage.remove(stored.storageKey);
    throw errors.notFound("Document");
  }
  await storage.remove(current.file?.storageKey);
  await logActivity({
    actor: ctx.actor,
    action: "document.file_replaced",
    entityType: "document",
    entityId: id,
    participantId: current.participantId,
    summary: `${current.file ? "replaced the file for" : "attached a file to"} ${current.title}`,
    ip: ctx.ip,
  });
  return toDocumentDTO(updated as DocumentDoc);
}

export async function updateDocument(
  id: string,
  input: z.output<typeof documentPatchSchema>,
  ctx: RequestContext
): Promise<DocumentDTO> {
  const current = await getDocumentDoc(id);
  const $set: Record<string, unknown> = {};
  if (input.title !== undefined) $set.title = input.title;
  if (input.notes !== undefined) $set.notes = input.notes;
  if (input.docDate !== undefined) $set.docDate = input.docDate || null;
  if (input.folderKey !== undefined && input.folderKey !== current.folderKey) {
    if (current.kind === "template-slot")
      throw errors.validation("Template slots stay in the Templates folder.");
    assertFolder(current.scope, input.folderKey);
    $set.folderKey = input.folderKey;
  }
  const updated = await DocumentModel.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.notFound("Document");
  await logActivity({
    actor: ctx.actor,
    action: "document.updated",
    entityType: "document",
    entityId: id,
    participantId: current.participantId,
    summary: `updated the document ${updated.title}`,
    ip: ctx.ip,
  });
  return toDocumentDTO(updated as DocumentDoc);
}

/** Files are soft-deleted (purged after 30 days); a template slot keeps its place and only loses its file. */
export async function deleteDocument(
  id: string,
  ctx: RequestContext
): Promise<void> {
  const current = await getDocumentDoc(id);
  if (current.kind === "template-slot") {
    await DocumentModel.updateOne({ _id: id }, { $set: { file: null } });
    await storage.remove(current.file?.storageKey);
  } else {
    await DocumentModel.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date() } }
    );
  }
  await logActivity({
    actor: ctx.actor,
    action: "document.deleted",
    entityType: "document",
    entityId: id,
    participantId: current.participantId,
    summary:
      current.kind === "template-slot"
        ? `removed the file from ${current.title}`
        : `deleted the document ${current.title}`,
    ip: ctx.ip,
  });
}

export async function documentDownload(
  id: string
): Promise<{ absolutePath: string; originalName: string; mimeType: string }> {
  const doc = await getDocumentDoc(id);
  if (!doc.file) throw errors.notFound("File");
  if (!(await storage.exists(doc.file.storageKey)))
    throw errors.notFound("File");
  return {
    absolutePath: storage.resolve(doc.file.storageKey),
    originalName: doc.file.originalName,
    mimeType: doc.file.mimeType,
  };
}

/** Permanently removes documents that were soft-deleted more than `days` ago. */
export async function purgeDeletedDocuments(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const docs = await DocumentModel.find({ deletedAt: { $lt: cutoff } }).lean<
    DocumentDoc[]
  >();
  for (const doc of docs) {
    await storage.remove(doc.file?.storageKey);
    await DocumentModel.deleteOne({ _id: doc._id });
  }
  return docs.length;
}
