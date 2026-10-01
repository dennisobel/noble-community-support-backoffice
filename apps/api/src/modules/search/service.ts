import { Router } from "express";
import type { SearchResultsDTO } from "@shared/dto";
import type { RecordStatus } from "@shared/enums";
import { formatNdis, normalizeNdis } from "@shared/logic/ndis";
import { fromCents } from "@shared/logic/money";
import { searchQuery } from "@shared/schemas/reports";
import { escapeRegex, parse } from "../../lib/http";
import {
  DocumentModel,
  Invoice,
  Participant,
  ServiceRecord,
  VoiceNote,
  type DocumentDoc,
  type InvoiceDoc,
  type ParticipantDoc,
  type VoiceNoteDoc,
} from "../../models";
import { participantLookup } from "../participants/service";

const LIMIT = 5;

export async function search(q: string): Promise<SearchResultsDTO> {
  const pattern = new RegExp(escapeRegex(q), "i");
  const digits = normalizeNdis(q);
  const participantFilter: Record<string, unknown>[] = [
    { name: pattern },
    { preferred: pattern },
  ];
  if (digits.length >= 3)
    participantFilter.push({ ndis: new RegExp(escapeRegex(digits)) });
  const participants = await Participant.find({ $or: participantFilter })
    .sort({ status: 1, name: 1 })
    .limit(20)
    .lean<ParticipantDoc[]>();
  const participantIds = participants.map(participant => participant._id);

  const [records, invoices, voiceNotes, documents] = await Promise.all([
    ServiceRecord.find({
      $or: [
        { _id: pattern },
        { type: pattern },
        { location: pattern },
        { clientId: { $in: participantIds } },
      ],
    })
      .sort({ date: -1 })
      .limit(LIMIT)
      .select("_id clientId type date status")
      .lean<
        Array<{
          _id: string;
          clientId: string;
          type: string;
          date: string;
          status: RecordStatus;
        }>
      >(),
    Invoice.find({
      $or: [
        { _id: pattern },
        { recipient: pattern },
        { clientId: { $in: participantIds } },
      ],
    })
      .sort({ issue: -1 })
      .limit(LIMIT)
      .lean<InvoiceDoc[]>(),
    VoiceNote.find({ $or: [{ _id: pattern }, { title: pattern }] })
      .sort({ createdAt: -1 })
      .limit(LIMIT)
      .lean<VoiceNoteDoc[]>(),
    DocumentModel.find({
      deletedAt: null,
      $or: [{ title: pattern }, { "file.originalName": pattern }],
    })
      .sort({ updatedAt: -1 })
      .limit(LIMIT)
      .lean<DocumentDoc[]>(),
  ]);
  const names = await participantLookup([
    ...records.map(record => record.clientId),
    ...invoices.map(invoice => invoice.clientId),
    ...voiceNotes.map(voice => voice.clientId),
  ]);
  const nameOf = (id: unknown) => names.get(String(id))?.preferred ?? "Unknown";

  return {
    participants: participants.slice(0, LIMIT).map(participant => ({
      id: String(participant._id),
      name: participant.name,
      preferred: participant.preferred,
      ndis: formatNdis(participant.ndis),
      status: participant.status,
    })),
    records: records.map(record => ({
      id: record._id,
      clientName: nameOf(record.clientId),
      type: record.type,
      date: record.date,
      status: record.status,
    })),
    invoices: invoices.map(invoice => ({
      id: invoice._id,
      clientName: nameOf(invoice.clientId),
      total: fromCents(invoice.totalCents),
      status: invoice.status,
    })),
    voiceNotes: voiceNotes.map(voice => ({
      id: voice._id,
      title: voice.title,
      clientName: nameOf(voice.clientId),
    })),
    documents: documents.map(doc => ({
      id: String(doc._id),
      title: doc.title,
      scope: doc.scope,
      participantId: doc.participantId ? String(doc.participantId) : null,
      folderKey: doc.folderKey,
    })),
  };
}

export function searchRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await search(parse(searchQuery, req.query).q));
  });
  return router;
}
