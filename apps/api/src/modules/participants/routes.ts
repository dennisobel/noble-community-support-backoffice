import { Router, type Request } from "express";
import {
  participantArchiveSchema,
  participantCreateSchema,
  participantKycSchema,
  participantListQuery,
  participantUpdateSchema,
} from "@shared/schemas/participants";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import {
  archiveParticipant,
  createParticipant,
  getParticipantDoc,
  listParticipants,
  restoreParticipant,
  toParticipantDTO,
  updateKyc,
  updateParticipant,
} from "./service";

const participantId = (req: Request) => objectIdParam(req, "id", "Participant");

export function participantsRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listParticipants(parse(participantListQuery, req.query)));
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(
        await createParticipant(
          parse(participantCreateSchema, req.body),
          ctx(req)
        )
      );
  });
  router.get("/:id", async (req, res) => {
    res.json(toParticipantDTO(await getParticipantDoc(participantId(req))));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateParticipant(
        participantId(req),
        parse(participantUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.patch("/:id/kyc", async (req, res) => {
    res.json(
      await updateKyc(
        participantId(req),
        parse(participantKycSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/archive", async (req, res) => {
    res.json(
      await archiveParticipant(
        participantId(req),
        parse(participantArchiveSchema, req.body ?? {}),
        ctx(req)
      )
    );
  });
  router.post("/:id/restore", async (req, res) => {
    res.json(await restoreParticipant(participantId(req), ctx(req)));
  });
  return router;
}
