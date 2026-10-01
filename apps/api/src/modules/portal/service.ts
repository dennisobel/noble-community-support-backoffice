import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  DocumentFileDTO,
  StaffChecklistItemDTO,
  StaffDocumentDTO,
  StaffPortalDetailsDTO,
  StaffPortalProfileDTO,
} from "@shared/dto";
import { STAFF_CHECKLIST } from "@shared/enums";
import { initialsOf } from "@shared/logic/ndis";
import { MESSAGES } from "@shared/messages";
import type {
  checklistReviewSchema,
  staffDetailsSchema,
  staffDocumentFields,
  staffDocumentPatchSchema,
} from "@shared/schemas/staff-portal";
import { logActivity } from "../../lib/audit";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { actorDTO, isoRequired } from "../../lib/mappers";
import { sha256File, storage } from "../../lib/storage";
import { workspaceToday } from "../../lib/workspace";
import { verifyUpload, type VerifiedFile } from "../../middleware/upload";
import {
  Staff,
  StaffDocument,
  StaffProfile,
  User,
  type ChecklistItemSub,
  type StaffDoc,
  type StaffDocumentDoc,
  type StaffProfileDoc,
} from "../../models";
import { getStaff } from "../staff/service";
import {
  checklistItemsDTO,
  checklistProgress,
  defaultChecklist,
  expiryInfo,
} from "./checklist";

export async function requireStaffDoc(staffId: string): Promise<StaffDoc> {
  const staff = await Staff.findById(staffId).lean<StaffDoc>();
  if (!staff) throw errors.notFound("Team member");
  return staff;
}

/** Creates the profile (with a full checklist) the first time a worker opens the portal. */
export async function ensureProfile(staff: StaffDoc): Promise<StaffProfileDoc> {
  const existing = await StaffProfile.findOne({
    staffId: staff._id,
  }).lean<StaffProfileDoc>();
  if (existing) return existing;
  const created = await StaffProfile.create({
    staffId: staff._id,
    checklist: defaultChecklist(staff),
  });
  return created.toObject<StaffProfileDoc>();
}

export function toStaffDocumentDTO(
  document: StaffDocumentDoc,
  today: string
): StaffDocumentDTO {
  const info = expiryInfo(document.expiry, today);
  const file: DocumentFileDTO | null = document.file
    ? {
        originalName: document.file.originalName,
        mimeType: document.file.mimeType,
        size: document.file.size,
      }
    : null;
  return {
    id: String(document._id),
    staffId: String(document.staffId),
    checklistKey: document.checklistKey ?? null,
    title: document.title,
    notes: document.notes ?? "",
    issued: document.issued ?? null,
    expiry: document.expiry ?? null,
    daysLeft: info.daysLeft,
    expiryState: info.state,
    file,
    uploadedBy: actorDTO(document.uploadedBy),
    createdAt: isoRequired(document.createdAt),
  };
}

function toDetailsDTO(
  staff: StaffDoc,
  profile: StaffProfileDoc
): StaffPortalDetailsDTO {
  return {
    id: String(staff._id),
    name: staff.name,
    initials: initialsOf(staff.name),
    position: staff.position,
    team: staff.team,
    email: staff.email,
    phone: staff.phone ?? "",
    status: staff.status,
    startDate: profile.startDate ?? null,
    dateOfBirth: profile.dateOfBirth ?? null,
    address: profile.address ?? "",
    about: profile.about ?? "",
    nextOfKin: {
      name: profile.nextOfKin?.name ?? "",
      relationship: profile.nextOfKin?.relationship ?? "",
      phone: profile.nextOfKin?.phone ?? "",
      email: profile.nextOfKin?.email ?? "",
      address: profile.nextOfKin?.address ?? "",
    },
    emergencyContacts: (profile.emergencyContacts ?? []).map(contact => ({
      id: String(contact._id),
      name: contact.name,
      relationship: contact.relationship ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      primary: Boolean(contact.primary),
    })),
    medicalNotes: profile.medicalNotes ?? "",
    transport: {
      hasVehicle: Boolean(profile.transport?.hasVehicle),
      licenceNumber: profile.transport?.licenceNumber ?? "",
      vehicle: profile.transport?.vehicle ?? "",
      registration: profile.transport?.registration ?? "",
    },
  };
}

/** The worker's own profile: details, KYC, checklist state and their document wallet. */
export async function portalProfile(
  staffId: string
): Promise<StaffPortalProfileDTO> {
  const staff = await requireStaffDoc(staffId);
  const [today, profile] = await Promise.all([
    workspaceToday(),
    ensureProfile(staff),
  ]);
  const documents = await StaffDocument.find({
    staffId: staff._id,
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean<StaffDocumentDoc[]>();
  const checklist = checklistItemsDTO(staff, profile, today);
  return {
    staff: await getStaff(staffId),
    details: toDetailsDTO(staff, profile),
    checklist,
    documents: documents.map(document => toStaffDocumentDTO(document, today)),
    progress: checklistProgress(checklist),
  };
}

export interface ComplianceDTO {
  staffId: string;
  staff: Awaited<ReturnType<typeof getStaff>>;
  today: string;
  progress: ReturnType<typeof checklistProgress>;
  checklist: StaffChecklistItemDTO[];
  documents: StaffDocumentDTO[];
  account: {
    hasAccess: boolean;
    accepted: boolean;
    lastLoginAt: string | null;
  };
}

/** Admin view of one worker's compliance: the same checklist, in expiry order. */
export async function staffCompliance(staffId: string): Promise<ComplianceDTO> {
  const staff = await requireStaffDoc(staffId);
  const [today, profile, account] = await Promise.all([
    workspaceToday(),
    ensureProfile(staff),
    User.findOne({ staffId: staff._id })
      .select("invitation lastLoginAt status")
      .lean<{
        invitation?: { acceptedAt: Date | null } | null;
        lastLoginAt?: Date | null;
        status?: string;
      } | null>(),
  ]);
  const documents = await StaffDocument.find({
    staffId: staff._id,
    deletedAt: null,
  })
    .sort({ expiry: 1 })
    .lean<StaffDocumentDoc[]>();
  const checklist = checklistItemsDTO(staff, profile, today);
  return {
    staffId,
    staff: await getStaff(staffId),
    today,
    progress: checklistProgress(checklist),
    checklist,
    documents: documents.map(document => toStaffDocumentDTO(document, today)),
    account: {
      hasAccess: account?.status === "active",
      accepted: Boolean(account?.invitation?.acceptedAt),
      lastLoginAt: account?.lastLoginAt
        ? account.lastLoginAt.toISOString()
        : null,
    },
  };
}

/* ───────────── Details (next of kin, contacts, transport) ───────────── */

export async function updatePortalDetails(
  staffId: string,
  input: z.output<typeof staffDetailsSchema>,
  ctx: RequestContext
): Promise<StaffPortalProfileDTO> {
  const staff = await requireStaffDoc(staffId);
  await ensureProfile(staff);
  const $set: Record<string, unknown> = {};
  if (input.phone !== undefined)
    await Staff.updateOne({ _id: staff._id }, { $set: { phone: input.phone } });
  for (const key of [
    "dateOfBirth",
    "startDate",
    "address",
    "about",
    "medicalNotes",
  ] as const) {
    if (input[key] !== undefined) $set[key] = input[key];
  }
  if (input.nextOfKin) {
    for (const [key, value] of Object.entries(input.nextOfKin))
      if (value !== undefined) $set[`nextOfKin.${key}`] = value;
  }
  if (input.transport) {
    for (const [key, value] of Object.entries(input.transport))
      if (value !== undefined) $set[`transport.${key}`] = value;
  }
  if (input.emergencyContacts) {
    if (!input.emergencyContacts.length)
      throw errors.validation(MESSAGES.emergencyContact, [
        { path: "emergencyContacts", message: MESSAGES.emergencyContact },
      ]);
    // The portal always posts the full list, so the array is replaced wholesale.
    const requested = input.emergencyContacts.map(contact => ({
      ...contact,
      primary: Boolean(contact.primary),
    }));
    const anyPrimary = requested.some(contact => contact.primary);
    $set.emergencyContacts = requested.map((contact, index) =>
      anyPrimary ? contact : { ...contact, primary: index === 0 }
    );
  }
  if (Object.keys($set).length)
    await StaffProfile.updateOne({ staffId: staff._id }, { $set });
  await logActivity({
    actor: ctx.actor,
    action: "staff.profile_updated",
    entityType: "staff",
    entityId: staffId,
    summary: "updated their profile & KYC details",
    ip: ctx.ip,
  });
  return portalProfile(staffId);
}

/* ───────────── Documents ───────────── */

async function markChecklistFromDocument(
  staffId: string,
  checklistKey: string | null,
  expiry: string | null,
  documentId: Types.ObjectId | null
): Promise<void> {
  if (!checklistKey) return;
  const profile = await StaffProfile.findOne({
    staffId,
  }).lean<StaffProfileDoc>();
  const item = profile?.checklist.find(row => row.key === checklistKey);
  const patch: Partial<ChecklistItemSub> = {
    status: "Awaiting review",
    documentId,
    expiry: expiry ?? item?.expiry ?? null,
    reviewNote: "",
    reviewedAt: null,
    reviewedBy: null,
  };
  if (item)
    await StaffProfile.updateOne(
      { staffId, "checklist.key": checklistKey },
      { $set: { "checklist.$": { ...item, ...patch } } }
    );
  else
    await StaffProfile.updateOne(
      { staffId },
      {
        $push: {
          checklist: { key: checklistKey, ...patch, status: "Awaiting review" },
        },
      }
    );
}

/** Uploads (or replaces) a file against a checklist item, with its expiry date. */
export async function addStaffDocument(
  staffId: string,
  fields: z.output<typeof staffDocumentFields>,
  file: Express.Multer.File | undefined,
  ctx: RequestContext
): Promise<StaffDocumentDTO> {
  const staff = await requireStaffDoc(staffId);
  const checklistKey = fields.checklistKey ? fields.checklistKey : null;
  const definition = checklistKey
    ? STAFF_CHECKLIST.find(item => item.key === checklistKey)
    : undefined;
  if (checklistKey && !definition)
    throw errors.validation("Choose a checklist item that exists.");
  if (!file)
    throw errors.validation(
      "Attach the document (PDF, Word, Excel or a photo)."
    );
  const verified: VerifiedFile = await verifyUpload(file, "document");
  const expiry = fields.expiry ?? null;
  if (definition?.expiry && !expiry)
    throw errors.validation(MESSAGES.expiryRequired(definition.label), [
      { path: "expiry", message: MESSAGES.expiryRequired(definition.label) },
    ]);
  const storageKey = storage.newKey("documents", verified.extension);
  await storage.moveIn(verified.tempPath, storageKey);
  const created = await StaffDocument.create({
    staffId: staff._id,
    checklistKey,
    title: fields.title,
    notes: fields.notes ?? "",
    issued: fields.issued ?? null,
    expiry,
    file: {
      storageKey,
      originalName: verified.originalName,
      mimeType: verified.mimeType,
      size: verified.size,
      sha256: await sha256File(storage.resolve(storageKey)),
    },
    uploadedBy: ctx.actor,
  });
  // A replacement supersedes the previous file for the same checklist item.
  if (checklistKey)
    await StaffDocument.updateMany(
      {
        staffId: staff._id,
        checklistKey,
        _id: { $ne: created._id },
        deletedAt: null,
      },
      { $set: { deletedAt: new Date() } }
    );
  await markChecklistFromDocument(staffId, checklistKey, expiry, created._id);
  await logActivity({
    actor: ctx.actor,
    action: "staff.document_uploaded",
    entityType: "staff",
    entityId: staffId,
    summary: `uploaded ${fields.title}${expiry ? ` (expires ${expiry})` : ""}`,
    ip: ctx.ip,
  });
  return toStaffDocumentDTO(
    created.toObject<StaffDocumentDoc>(),
    await workspaceToday()
  );
}

export async function updateStaffDocument(
  staffId: string,
  documentId: string,
  input: z.output<typeof staffDocumentPatchSchema>,
  ctx: RequestContext
): Promise<StaffDocumentDTO> {
  const document = await StaffDocument.findOne({
    _id: documentId,
    staffId,
    deletedAt: null,
  }).lean<StaffDocumentDoc>();
  if (!document) throw errors.notFound("Document");
  const $set: Record<string, unknown> = {};
  for (const key of ["title", "notes", "issued", "expiry"] as const)
    if (input[key] !== undefined) $set[key] = input[key];
  const updated = await StaffDocument.findOneAndUpdate(
    { _id: documentId },
    { $set },
    { returnDocument: "after", lean: true }
  );
  if (updated?.checklistKey && input.expiry !== undefined)
    await markChecklistFromDocument(
      staffId,
      updated.checklistKey,
      input.expiry ?? null,
      updated._id as Types.ObjectId
    );
  return toStaffDocumentDTO(
    updated as StaffDocumentDoc,
    await workspaceToday()
  );
}

export async function deleteStaffDocument(
  staffId: string,
  documentId: string,
  ctx: RequestContext
): Promise<void> {
  const document = await StaffDocument.findOneAndUpdate(
    { _id: documentId, staffId, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { returnDocument: "after", lean: true }
  );
  if (!document) throw errors.notFound("Document");
  if (document.checklistKey)
    await StaffProfile.updateOne(
      { staffId, "checklist.key": document.checklistKey },
      {
        $set: {
          "checklist.$.status": "Not started",
          "checklist.$.documentId": null,
          "checklist.$.expiry": null,
        },
      }
    );
  await logActivity({
    actor: ctx.actor,
    action: "staff.document_deleted",
    entityType: "staff",
    entityId: staffId,
    summary: `removed ${document.title}`,
    ip: ctx.ip,
  });
}

export async function getStaffDocument(
  documentId: string,
  staffId?: string
): Promise<StaffDocumentDoc> {
  const filter: Record<string, unknown> = { _id: documentId, deletedAt: null };
  if (staffId) filter.staffId = staffId;
  const document = await StaffDocument.findOne(filter).lean<StaffDocumentDoc>();
  if (!document) throw errors.notFound("Document");
  return document;
}

/* ───────────── Admin checklist review ───────────── */

export async function reviewChecklistItem(
  staffId: string,
  key: string,
  input: z.output<typeof checklistReviewSchema>,
  ctx: RequestContext
): Promise<StaffChecklistItemDTO[]> {
  const staff = await requireStaffDoc(staffId);
  const profile = await ensureProfile(staff);
  const item = profile.checklist.find(row => row.key === key);
  if (!item)
    throw errors.notFound(
      STAFF_CHECKLIST.find(def => def.key === key)?.label ?? "Checklist item"
    );
  await StaffProfile.updateOne(
    { staffId, "checklist.key": key },
    {
      $set: {
        "checklist.$.status": input.status,
        "checklist.$.reviewNote": input.note ?? "",
        "checklist.$.reviewedAt": new Date(),
        "checklist.$.reviewedBy": ctx.actor,
      },
    }
  );
  await logActivity({
    actor: ctx.actor,
    action: "staff.checklist_reviewed",
    entityType: "staff",
    entityId: staffId,
    summary: `marked ${STAFF_CHECKLIST.find(def => def.key === key)?.label ?? key} as ${input.status}`,
    ip: ctx.ip,
  });
  return (await staffCompliance(staffId)).checklist;
}
