import type { ClientSession } from "mongoose";
import type { z } from "zod";
import type {
  Paginated,
  ServiceRecordDTO,
  VoiceNoteDTO,
  VoiceSummaryDTO,
} from "@shared/dto";
import { NOTE_SECTIONS, type RecordStatus } from "@shared/enums";
import { addDays, formatDuration, zonedStartOfDay } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import type {
  attachSchema,
  draftPatchSchema,
  generateDraftSchema,
  transcriptPatchSchema,
  voiceListQuery,
  voicePatchSchema,
  voiceUploadFields,
} from "@shared/schemas/voice";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { nextIds } from "../../lib/counters";
import { withTransaction } from "../../lib/db";
import { AppError, errors } from "../../lib/errors";
import { escapeRegex, type RequestContext } from "../../lib/http";
import { enqueueJob, registerJob } from "../../lib/jobs";
import { actorDTO, assertRev, iso, isoRequired } from "../../lib/mappers";
import { sha256File, storage } from "../../lib/storage";
import { workspaceTimezone, workspaceToday } from "../../lib/workspace";
import { verifyUpload } from "../../middleware/upload";
import {
  Job,
  Participant,
  ServiceRecord,
  VoiceNote,
  type ParticipantDoc,
  type ServiceRecordDoc,
  type VoiceNoteDoc,
} from "../../models";
import { noteDrafts } from "../../providers/notes";
import { speechToText } from "../../providers/stt";
import {
  participantLookup,
  requireActiveParticipant,
} from "../participants/service";
import { LOCKED_STATUSES, updateRecord } from "../records/service";

/* ───────────── Mapping ───────────── */

export function toVoiceDTO(
  voice: VoiceNoteDoc,
  clientName: string,
  recordStatus: RecordStatus | null
): VoiceNoteDTO {
  return {
    id: voice._id,
    title: voice.title,
    clientId: String(voice.clientId),
    clientName,
    recordId: voice.recordId ?? null,
    recordStatus,
    recordedBy: actorDTO(voice.recordedBy),
    durationSec: voice.durationSec ?? 0,
    duration: formatDuration(voice.durationSec ?? 0),
    createdAt: isoRequired(voice.createdAt),
    hasAudio: Boolean(voice.audio),
    audioMimeType: voice.audio?.mimeType ?? null,
    transcript: voice.transcript?.text ?? "",
    transcriptStatus: voice.transcript?.status ?? "Not transcribed",
    transcriptProvider: voice.transcript?.provider ?? null,
    transcriptError: voice.transcript?.error ?? null,
    generationStatus: voice.generation?.status ?? "Not generated",
    generation: {
      template: voice.generation?.template ?? null,
      sections: voice.generation?.sections ?? [],
      detailLevel: voice.generation?.detailLevel ?? null,
      transcriptOnly: Boolean(voice.generation?.transcriptOnly),
      provider: voice.generation?.provider ?? null,
      model: voice.generation?.model ?? null,
      error: voice.generation?.error ?? null,
      generatedAt: iso(voice.generation?.generatedAt),
    },
    draft: voice.draft
      ? {
          support: voice.draft.support ?? "",
          response: voice.draft.response ?? "",
          outcome: voice.draft.outcome ?? "",
          observations: voice.draft.observations ?? "",
          followUp: voice.draft.followUp ?? "",
        }
      : null,
    status: voice.status,
    archivedAt: iso(voice.archivedAt),
    updatedAt: isoRequired(voice.updatedAt),
    rev: voice.rev ?? 0,
  };
}

async function voicesToDTOs(voices: VoiceNoteDoc[]): Promise<VoiceNoteDTO[]> {
  const recordIds = voices
    .map(voice => voice.recordId)
    .filter((id): id is string => Boolean(id));
  const [participants, records] = await Promise.all([
    participantLookup(voices.map(voice => voice.clientId)),
    recordIds.length
      ? ServiceRecord.find({ _id: { $in: recordIds } })
          .select("status")
          .lean<Array<{ _id: string; status: RecordStatus }>>()
      : [],
  ]);
  const statuses = new Map(records.map(record => [record._id, record.status]));
  return voices.map(voice =>
    toVoiceDTO(
      voice,
      participants.get(String(voice.clientId))?.preferred ?? "Unknown",
      voice.recordId ? (statuses.get(voice.recordId) ?? null) : null
    )
  );
}

async function voiceToDTO(voice: VoiceNoteDoc): Promise<VoiceNoteDTO> {
  return (await voicesToDTOs([voice]))[0];
}

export async function getVoiceDoc(
  id: string,
  session?: ClientSession
): Promise<VoiceNoteDoc> {
  const voice = await VoiceNote.findById(id)
    .session(session ?? null)
    .lean<VoiceNoteDoc>();
  if (!voice) throw errors.notFound("Voice note");
  return voice;
}

export async function getVoiceNote(id: string): Promise<VoiceNoteDTO> {
  return voiceToDTO(await getVoiceDoc(id));
}

/* ───────────── Queries ───────────── */

export async function listVoiceNotes(
  query: z.output<typeof voiceListQuery>
): Promise<Paginated<VoiceNoteDTO>> {
  const filter: Record<string, unknown> = {};
  if (query.clientId) filter.clientId = query.clientId;
  if (query.status === "active") filter.status = { $ne: "Archived" };
  else if (query.status !== "all") filter.status = query.status;
  if (query.range !== "any") {
    const [today, timezone] = await Promise.all([
      workspaceToday(),
      workspaceTimezone(),
    ]);
    const from = query.range === "today" ? today : addDays(today, -6);
    filter.createdAt = { $gte: zonedStartOfDay(from, timezone) };
  }
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ title: pattern }, { _id: pattern }];
  }
  const [items, total] = await Promise.all([
    VoiceNote.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<VoiceNoteDoc[]>(),
    VoiceNote.countDocuments(filter),
  ]);
  return {
    items: await voicesToDTOs(items),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function voiceSummary(): Promise<VoiceSummaryDTO> {
  const active = { status: { $ne: "Archived" as const } };
  const [saved, transcriptReady, draftsForReview] = await Promise.all([
    VoiceNote.countDocuments(active),
    VoiceNote.countDocuments({ ...active, "transcript.status": "Ready" }),
    VoiceNote.countDocuments({ ...active, "generation.status": "Draft ready" }),
  ]);
  return { saved, transcriptReady, draftsForReview };
}

/* ───────────── Links to service records (one-to-one) ───────────── */

async function relink(
  voice: VoiceNoteDoc,
  recordId: string | null,
  session: ClientSession
): Promise<void> {
  if (voice.recordId && voice.recordId !== recordId) {
    await ServiceRecord.updateOne(
      { _id: voice.recordId, voiceNoteId: voice._id },
      { $set: { voiceNoteId: null }, $inc: { rev: 1 } },
      { session }
    );
  }
  if (recordId) {
    const record = await ServiceRecord.findById(recordId)
      .session(session)
      .lean<ServiceRecordDoc>();
    if (!record) throw errors.notFound("Service record");
    if (String(record.clientId) !== String(voice.clientId))
      throw errors.validation(
        "Choose a service record for the same participant."
      );
    if (record.voiceNoteId && record.voiceNoteId !== voice._id) {
      await VoiceNote.updateOne(
        { _id: record.voiceNoteId, recordId },
        { $set: { recordId: null }, $inc: { rev: 1 } },
        { session }
      );
    }
    await ServiceRecord.updateOne(
      { _id: recordId },
      { $set: { voiceNoteId: voice._id }, $inc: { rev: 1 } },
      { session }
    );
  }
}

/* ───────────── Commands ───────────── */

export async function createVoiceNote(
  fields: z.output<typeof voiceUploadFields>,
  file: Express.Multer.File | undefined,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  if (!file) throw errors.validation("Record a short clip before saving.");
  const participant = await requireActiveParticipant(
    fields.clientId,
    "have new voice notes recorded"
  );
  const audio = await verifyUpload(file, "audio");
  const sha256 = await sha256File(audio.tempPath);
  // Store the file first: the transaction below may be retried, and a failed transaction removes the file again.
  const storageKey = storage.newKey("voice", audio.extension);
  await storage.moveIn(audio.tempPath, storageKey);
  const insert = (session: ClientSession) => async () => {
    const id = await nextIds.voiceNote(session);
    const [created] = await VoiceNote.create(
      [
        {
          _id: id,
          clientId: participant._id,
          recordId: null,
          recordedBy: ctx.actor,
          title: fields.title,
          durationSec: fields.durationSec,
          audio: {
            storageKey,
            mimeType: audio.mimeType,
            size: audio.size,
            sha256,
          },
        },
      ],
      { session }
    );
    const doc = created.toObject<VoiceNoteDoc>();
    if (fields.recordId) {
      await relink(doc, fields.recordId, session);
      await VoiceNote.updateOne(
        { _id: id },
        { $set: { recordId: fields.recordId } },
        { session }
      );
      doc.recordId = fields.recordId;
    }
    return doc;
  };
  let voice: VoiceNoteDoc;
  try {
    voice = await withTransaction(session => insert(session)());
  } catch (error) {
    await storage.remove(storageKey);
    throw error;
  }
  await logActivity({
    actor: ctx.actor,
    action: "voice.created",
    entityType: "voice_note",
    entityId: voice._id,
    participantId: participant._id,
    summary: `recorded voice note ${voice._id}`,
    ip: ctx.ip,
  });
  return getVoiceNote(voice._id);
}

export async function updateVoiceNote(
  id: string,
  input: z.output<typeof voicePatchSchema>,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  const current = await getVoiceDoc(id);
  assertRev(current, input.rev);
  await withTransaction(async session => {
    const $set: Record<string, unknown> = {};
    if (input.title !== undefined) $set.title = input.title;
    if (input.recordId !== undefined && input.recordId !== current.recordId) {
      await relink(current, input.recordId, session);
      $set.recordId = input.recordId;
    }
    const result = await VoiceNote.updateOne(
      { _id: id, rev: current.rev },
      { $set, $inc: { rev: 1 } },
      { session }
    );
    if (!result.matchedCount) throw errors.stale();
  });
  const summary =
    input.recordId !== undefined && input.recordId !== current.recordId
      ? input.recordId
        ? `linked ${id} to ${input.recordId}`
        : `detached ${id} from ${current.recordId}`
      : `renamed voice note ${id}`;
  await logActivity({
    actor: ctx.actor,
    action: "voice.updated",
    entityType: "voice_note",
    entityId: id,
    participantId: current.clientId,
    summary,
    ip: ctx.ip,
  });
  return getVoiceNote(id);
}

export async function setArchived(
  id: string,
  archived: boolean,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  const current = await getVoiceDoc(id);
  const status = archived
    ? "Archived"
    : current.generation?.status === "Draft ready"
      ? "Draft ready"
      : "Saved";
  await VoiceNote.updateOne(
    { _id: id },
    {
      $set: { status, archivedAt: archived ? new Date() : null },
      $inc: { rev: 1 },
    }
  );
  await logActivity({
    actor: ctx.actor,
    action: archived ? "voice.archived" : "voice.unarchived",
    entityType: "voice_note",
    entityId: id,
    participantId: current.clientId,
    summary: `${archived ? "archived" : "restored"} voice note ${id}`,
    ip: ctx.ip,
  });
  return getVoiceNote(id);
}

export async function deleteVoiceNote(
  id: string,
  ctx: RequestContext
): Promise<void> {
  const current = await getVoiceDoc(id);
  if (current.recordId) {
    const record = await ServiceRecord.findById(current.recordId)
      .select("status")
      .lean<{ status: RecordStatus }>();
    if (
      record &&
      (LOCKED_STATUSES as readonly string[]).includes(record.status)
    ) {
      throw errors.conflict(
        "CONFLICT",
        `This recording supports ${current.recordId}, which is ${record.status.toLowerCase()}. Archive it instead of deleting it.`
      );
    }
  }
  await withTransaction(async session => {
    if (current.recordId) {
      await ServiceRecord.updateOne(
        { _id: current.recordId, voiceNoteId: id },
        { $set: { voiceNoteId: null }, $inc: { rev: 1 } },
        { session }
      );
    }
    await VoiceNote.deleteOne({ _id: id }, { session });
    await Job.deleteMany(
      { "payload.voiceId": id, status: "queued" },
      { session }
    );
  });
  await storage.remove(current.audio?.storageKey);
  await logActivity({
    actor: ctx.actor,
    action: "voice.deleted",
    entityType: "voice_note",
    entityId: id,
    participantId: current.clientId,
    summary: `deleted voice note ${id}`,
    ip: ctx.ip,
  });
}

export async function audioFile(
  id: string
): Promise<{ absolutePath: string; originalName: string; mimeType: string }> {
  const voice = await getVoiceDoc(id);
  if (!voice.audio || !(await storage.exists(voice.audio.storageKey)))
    throw errors.notFound("Audio");
  return {
    absolutePath: storage.resolve(voice.audio.storageKey),
    originalName: `${voice._id}${voice.audio.storageKey.slice(voice.audio.storageKey.lastIndexOf("."))}`,
    mimeType: voice.audio.mimeType,
  };
}

export async function requestTranscription(
  id: string,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  const current = await getVoiceDoc(id);
  if (current.transcript?.status === "Processing") return getVoiceNote(id);
  if (!current.audio && config().stt.provider !== "mock")
    throw errors.validation("This recording has no audio file to transcribe.");
  await VoiceNote.updateOne(
    { _id: id },
    {
      $set: { "transcript.status": "Processing", "transcript.error": null },
      $inc: { rev: 1 },
    }
  );
  await enqueueJob("transcribe", { voiceId: id, actor: ctx.actor });
  return getVoiceNote(id);
}

export async function updateTranscript(
  id: string,
  input: z.output<typeof transcriptPatchSchema>,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  const current = await getVoiceDoc(id);
  assertRev(current, input.rev);
  const text = input.text.trim();
  const result = await VoiceNote.updateOne(
    { _id: id, rev: current.rev },
    {
      $set: {
        "transcript.text": text,
        "transcript.status": text ? "Ready" : "Not transcribed",
        "transcript.provider": "manual",
        "transcript.error": null,
        "transcript.updatedAt": new Date(),
      },
      $inc: { rev: 1 },
    }
  );
  if (!result.matchedCount) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "voice.transcript_edited",
    entityType: "voice_note",
    entityId: id,
    participantId: current.clientId,
    summary: `edited the transcript of ${id}`,
    ip: ctx.ip,
  });
  return getVoiceNote(id);
}

export async function requestDraft(
  id: string,
  input: z.output<typeof generateDraftSchema>,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  const current = await getVoiceDoc(id);
  if (
    current.transcript?.status !== "Ready" ||
    !current.transcript.text.trim()
  ) {
    throw new AppError(422, "TRANSCRIPT_REQUIRED", MESSAGES.transcriptRequired);
  }
  if (current.generation?.status === "Processing") return getVoiceNote(id);
  await VoiceNote.updateOne(
    { _id: id },
    {
      $set: {
        "generation.status": "Processing",
        "generation.template": input.template,
        "generation.sections": input.sections,
        "generation.detailLevel": input.detailLevel,
        "generation.transcriptOnly": input.transcriptOnly,
        "generation.error": null,
      },
      $inc: { rev: 1 },
    }
  );
  await enqueueJob("generate-draft", { voiceId: id, actor: ctx.actor });
  return getVoiceNote(id);
}

export async function updateDraft(
  id: string,
  input: z.output<typeof draftPatchSchema>,
  ctx: RequestContext
): Promise<VoiceNoteDTO> {
  const current = await getVoiceDoc(id);
  assertRev(current, input.rev);
  const draft = {
    support: "",
    response: "",
    outcome: "",
    observations: "",
    followUp: "",
    ...(current.draft ?? {}),
  };
  for (const section of NOTE_SECTIONS)
    if (input[section] !== undefined) draft[section] = input[section]!;
  const result = await VoiceNote.updateOne(
    { _id: id, rev: current.rev },
    { $set: { draft }, $inc: { rev: 1 } }
  );
  if (!result.matchedCount) throw errors.stale();
  await logActivity({
    actor: ctx.actor,
    action: "voice.draft_edited",
    entityType: "voice_note",
    entityId: id,
    participantId: current.clientId,
    summary: `edited the draft note for ${id}`,
    ip: ctx.ip,
  });
  return getVoiceNote(id);
}

/**
 * Links a recording to a service record. With applyDraft the non-empty draft sections are copied into the
 * record (Draft/Returned only) and the record's history notes the AI-assisted edit.
 */
export async function attachToRecord(
  id: string,
  input: z.output<typeof attachSchema>,
  ctx: RequestContext
): Promise<{ voice: VoiceNoteDTO; record: ServiceRecordDTO | null }> {
  const current = await getVoiceDoc(id);
  assertRev(current, input.rev);
  if (input.applyDraft) {
    if (!current.draft)
      throw errors.validation(
        "Generate or write a draft before applying it to a record."
      );
    const record = await ServiceRecord.findById(
      input.recordId
    ).lean<ServiceRecordDoc>();
    if (!record) throw errors.notFound("Service record");
    const updated = await updateRecord(
      input.recordId,
      { voiceNoteId: id, applyVoiceDraft: true, rev: record.rev },
      ctx
    );
    return { voice: await getVoiceNote(id), record: updated };
  }
  await withTransaction(async session => {
    await relink(current, input.recordId, session);
    await VoiceNote.updateOne(
      { _id: id },
      { $set: { recordId: input.recordId }, $inc: { rev: 1 } },
      { session }
    );
  });
  await logActivity({
    actor: ctx.actor,
    action: "voice.attached",
    entityType: "voice_note",
    entityId: id,
    participantId: current.clientId,
    summary: `linked ${id} to ${input.recordId}`,
    ip: ctx.ip,
  });
  return { voice: await getVoiceNote(id), record: null };
}

/* ───────────── Background jobs ───────────── */

async function participantFor(
  voice: VoiceNoteDoc
): Promise<ParticipantDoc | null> {
  return Participant.findById(voice.clientId)
    .select("preferred goals support")
    .lean<ParticipantDoc>();
}

registerJob(
  "transcribe",
  async payload => {
    const voice = await VoiceNote.findById(
      String(payload.voiceId)
    ).lean<VoiceNoteDoc>();
    if (!voice) return;
    const participant = await participantFor(voice);
    const result = await speechToText().transcribe({
      filePath: voice.audio ? storage.resolve(voice.audio.storageKey) : null,
      mimeType: voice.audio?.mimeType ?? null,
      participantName: participant?.preferred ?? "The participant",
    });
    await VoiceNote.updateOne(
      { _id: voice._id },
      {
        $set: {
          "transcript.text": result.text,
          "transcript.status": result.text ? "Ready" : "Unavailable",
          "transcript.provider": result.provider,
          "transcript.language": result.language,
          "transcript.error": result.text
            ? null
            : "No speech was detected in this recording.",
          "transcript.updatedAt": new Date(),
        },
        $inc: { rev: 1 },
      }
    );
    await logActivity({
      actor: (payload.actor as { id: string; name: string }) ?? null,
      action: "voice.transcribed",
      entityType: "voice_note",
      entityId: voice._id,
      participantId: voice.clientId,
      summary: `transcribed voice note ${voice._id}`,
    });
  },
  async (payload, error) => {
    await VoiceNote.updateOne(
      { _id: String(payload.voiceId) },
      {
        $set: {
          "transcript.status": "Unavailable",
          "transcript.error":
            error instanceof Error ? error.message : "Transcription failed.",
          "transcript.updatedAt": new Date(),
        },
        $inc: { rev: 1 },
      }
    );
  }
);

registerJob(
  "generate-draft",
  async payload => {
    const voice = await VoiceNote.findById(
      String(payload.voiceId)
    ).lean<VoiceNoteDoc>();
    if (!voice) return;
    const participant = await participantFor(voice);
    const sections = (voice.generation?.sections ?? []).filter(
      (section): section is (typeof NOTE_SECTIONS)[number] =>
        (NOTE_SECTIONS as readonly string[]).includes(section)
    );
    const provider = noteDrafts();
    const result = await provider.generate({
      transcript: voice.transcript.text,
      template: voice.generation?.template ?? "Community support progress note",
      sections: sections.length ? sections : [...NOTE_SECTIONS],
      detailLevel:
        (voice.generation?.detailLevel as
          | "Balanced"
          | "Concise"
          | "Detailed") ?? "Balanced",
      transcriptOnly: Boolean(voice.generation?.transcriptOnly),
      participant: {
        preferred: participant?.preferred ?? "The participant",
        goals: participant?.goals ?? [],
        support: participant?.support ?? "",
      },
    });
    await VoiceNote.updateOne(
      { _id: voice._id },
      {
        $set: {
          draft: result.draft,
          "generation.status": "Draft ready",
          "generation.provider": result.provider,
          "generation.model": result.model,
          "generation.error": null,
          "generation.generatedAt": new Date(),
          ...(voice.status === "Archived" ? {} : { status: "Draft ready" }),
        },
        $inc: { rev: 1 },
      }
    );
    await logActivity({
      actor: (payload.actor as { id: string; name: string }) ?? null,
      action: "voice.draft_generated",
      entityType: "voice_note",
      entityId: voice._id,
      participantId: voice.clientId,
      summary: `generated a draft progress note from ${voice._id}`,
    });
  },
  async (payload, error) => {
    await VoiceNote.updateOne(
      { _id: String(payload.voiceId) },
      {
        $set: {
          "generation.status": "Failed",
          "generation.error":
            error instanceof Error
              ? error.message
              : "Draft generation failed. Write the note manually.",
        },
        $inc: { rev: 1 },
      }
    );
  }
);
