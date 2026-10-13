import type { z } from "zod";
import type { HandoverNoteDTO, ServiceRecordDTO } from "@shared/dto";
import { addDays } from "@shared/logic/time";
import type { amendmentRequestSchema } from "@shared/schemas/records";
import type {
  portalNoteCreateSchema,
  portalNoteUpdateSchema,
} from "@shared/schemas/staff-portal";
import { errors } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { workspaceToday } from "../../lib/workspace";
import {
  RosterShift,
  ServiceRecord,
  type ServiceRecordDoc,
} from "../../models";
import {
  getRecordDetail,
  recentNotesFor,
  requestAmendment,
} from "../records/notes";
import {
  createRecord,
  getRecordDoc,
  listRecords,
  submitRecord,
  updateRecord,
} from "../records/service";

/** How far back a shift still counts as supporting a participant, for reading their notes. */
const HANDOVER_WINDOW_DAYS = 60;

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
  return getRecordDetail(id);
}

export async function createPortalNote(
  staffId: string,
  input: z.output<typeof portalNoteCreateSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  // A worker writes notes for the participants on their own roster, and nobody else.
  const rostered = await RosterShift.exists(
    input.shiftId
      ? { _id: input.shiftId, staffIds: staffId, clientIds: input.clientId }
      : {
          staffIds: staffId,
          clientIds: input.clientId,
          status: { $ne: "Cancelled" },
        }
  );
  if (!rostered)
    throw errors.forbidden(
      "You can only write notes for participants you are rostered with."
    );
  return createRecord({ ...input, staffId }, ctx);
}

/** A submitted note is locked for the worker; this asks the office to correct it. */
export async function requestPortalAmendment(
  staffId: string,
  id: string,
  input: z.output<typeof amendmentRequestSchema>,
  ctx: RequestContext
): Promise<ServiceRecordDTO> {
  await ownRecord(staffId, id);
  return requestAmendment(id, input, ctx);
}

/**
 * The last notes about a participant, for handover. Only for a worker who is, or recently was,
 * rostered with them: the notes of people they do not support stay closed.
 */
export async function portalHandover(
  staffId: string,
  participantId: string
): Promise<HandoverNoteDTO[]> {
  const rostered = await RosterShift.exists({
    staffIds: staffId,
    clientIds: participantId,
    status: { $ne: "Cancelled" },
    date: { $gte: addDays(await workspaceToday(), -HANDOVER_WINDOW_DAYS) },
  });
  if (!rostered) throw errors.notFound("Participant");
  return recentNotesFor(participantId, 3);
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
