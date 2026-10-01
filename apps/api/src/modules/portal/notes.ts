import type { z } from "zod";
import type { ServiceRecordDTO } from "@shared/dto";
import type {
  portalNoteCreateSchema,
  portalNoteUpdateSchema,
} from "@shared/schemas/staff-portal";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { ServiceRecord, type ServiceRecordDoc } from "../../models";
import {
  createRecord,
  getRecord,
  getRecordDoc,
  listRecords,
  submitRecord,
  updateRecord,
} from "../records/service";

/** The worker may only ever touch their own notes. */
async function ownRecord(
  staffId: string,
  id: string
): Promise<ServiceRecordDoc> {
  const record = await getRecordDoc(id);
  if (String(record.staffId) !== staffId)
    throw errors.notFound("Service record");
  return record;
}

export interface PortalNotesQuery {
  status?: string;
  clientId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export async function listPortalNotes(
  staffId: string,
  query: PortalNotesQuery
): Promise<ServiceRecordDTO[]> {
  const listed = await listRecords({
    status: query.status ? [query.status as never] : [],
    clientId: query.clientId,
    staffId,
    serviceId: undefined,
    team: undefined,
    q: query.q,
    from: query.from,
    to: query.to,
    sort: "-date",
    page: 1,
    limit: 50,
  });
  return listed.items;
}

export async function getPortalNote(
  staffId: string,
  id: string
): Promise<ServiceRecordDTO> {
  await ownRecord(staffId, id);
  return getRecord(id);
}

export async function createPortalNote(
  staffId: string,
  input: z.output<typeof portalNoteCreateSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  return createRecord({ ...input, staffId }, ctx);
}

export async function updatePortalNote(
  staffId: string,
  id: string,
  input: z.output<typeof portalNoteUpdateSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  await ownRecord(staffId, id);
  return updateRecord(id, input, ctx);
}

export async function submitPortalNote(
  staffId: string,
  id: string,
  rev: number | undefined,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  await ownRecord(staffId, id);
  return submitRecord(id, rev, ctx);
}

export async function ownNotesCount(staffId: string): Promise<{
  open: number;
  drafts: number;
}> {
  const [open, drafts] = await Promise.all([
    ServiceRecord.countDocuments({
      staffId,
      status: { $in: ["Draft", "Returned"] },
    }),
    ServiceRecord.countDocuments({ staffId, status: "Draft" }),
  ]);
  return { open, drafts };
}
