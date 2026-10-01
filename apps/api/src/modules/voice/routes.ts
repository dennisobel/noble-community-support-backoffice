import { Router, type Request } from "express";
import {
  attachSchema,
  draftPatchSchema,
  generateDraftSchema,
  transcriptPatchSchema,
  voiceListQuery,
  voicePatchSchema,
  voiceUploadFields,
} from "@shared/schemas/voice";
import { ctx, parse } from "../../lib/http";
import { codeParam } from "../../lib/mappers";
import { sendStoredFile } from "../../lib/send-file";
import { audioUpload, cleanupUploads } from "../../middleware/upload";
import {
  attachToRecord,
  audioFile,
  createVoiceNote,
  deleteVoiceNote,
  getVoiceNote,
  listVoiceNotes,
  requestDraft,
  requestTranscription,
  setArchived,
  updateDraft,
  updateTranscript,
  updateVoiceNote,
  voiceSummary,
} from "./service";

const voiceId = (req: Request) => codeParam(req, "VN", "Voice note");

export function voiceRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listVoiceNotes(parse(voiceListQuery, req.query)));
  });
  router.get("/summary", async (_req, res) => {
    res.json(await voiceSummary());
  });
  router.post("/", audioUpload(), async (req, res) => {
    try {
      res
        .status(201)
        .json(
          await createVoiceNote(
            parse(voiceUploadFields, req.body ?? {}),
            req.file,
            ctx(req)
          )
        );
    } finally {
      await cleanupUploads(req);
    }
  });
  router.get("/:id", async (req, res) => {
    res.json(await getVoiceNote(voiceId(req)));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateVoiceNote(
        voiceId(req),
        parse(voicePatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/:id", async (req, res) => {
    await deleteVoiceNote(voiceId(req), ctx(req));
    res.status(204).end();
  });
  router.post("/:id/archive", async (req, res) => {
    res.json(await setArchived(voiceId(req), true, ctx(req)));
  });
  router.post("/:id/unarchive", async (req, res) => {
    res.json(await setArchived(voiceId(req), false, ctx(req)));
  });
  router.get("/:id/audio", async (req, res) => {
    await sendStoredFile(res, await audioFile(voiceId(req)), "inline");
  });
  router.post("/:id/transcribe", async (req, res) => {
    res.status(202).json(await requestTranscription(voiceId(req), ctx(req)));
  });
  router.patch("/:id/transcript", async (req, res) => {
    res.json(
      await updateTranscript(
        voiceId(req),
        parse(transcriptPatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/generate-draft", async (req, res) => {
    res
      .status(202)
      .json(
        await requestDraft(
          voiceId(req),
          parse(generateDraftSchema, req.body),
          ctx(req)
        )
      );
  });
  router.patch("/:id/draft", async (req, res) => {
    res.json(
      await updateDraft(
        voiceId(req),
        parse(draftPatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/attach", async (req, res) => {
    res.json(
      await attachToRecord(
        voiceId(req),
        parse(attachSchema, req.body),
        ctx(req)
      )
    );
  });
  return router;
}
