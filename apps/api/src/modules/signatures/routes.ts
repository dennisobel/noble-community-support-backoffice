import { Router, type Request } from "express";
import {
  shortId,
  signatureCancelSchema,
  signatureCreateFields,
  signatureDraftSchema,
  signatureExtendSchema,
  signatureListQuery,
  signatureSendSchema,
} from "@shared/schemas/signatures";
import { errors } from "../../lib/errors";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { sendStoredFile } from "../../lib/send-file";
import { cleanupUploads, documentFileUpload } from "../../middleware/upload";
import {
  cancelRequest,
  createSignatureRequest,
  deleteRequest,
  extendRequest,
  getSignatureRequest,
  listSignatures,
  originalFile,
  remindSigner,
  resetSignerLink,
  saveDraft,
  sealRequest,
  sendSignatureRequest,
  signedFile,
} from "./service";

const requestId = (req: Request) =>
  objectIdParam(req, "id", "Signature request");

const signerId = (req: Request) => {
  const value = req.params.signerId;
  if (typeof value !== "string" || !shortId.safeParse(value).success)
    throw errors.notFound("Signer");
  return value;
};

/** The back-office side: upload a PDF, place the boxes, send the links, follow progress, download the result. */
export function signaturesRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listSignatures(parse(signatureListQuery, req.query)));
  });
  router.post("/", documentFileUpload(), async (req, res) => {
    try {
      const fields = parse(signatureCreateFields, req.body ?? {});
      res
        .status(201)
        .json(await createSignatureRequest(fields, req.file, ctx(req)));
    } finally {
      await cleanupUploads(req);
    }
  });
  router.get("/:id", async (req, res) => {
    res.json(await getSignatureRequest(requestId(req)));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await saveDraft(
        requestId(req),
        parse(signatureDraftSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/send", async (req, res) => {
    res.json(
      await sendSignatureRequest(
        requestId(req),
        parse(signatureSendSchema, req.body ?? {}),
        ctx(req)
      )
    );
  });
  router.post("/:id/signers/:signerId/remind", async (req, res) => {
    res.json(await remindSigner(requestId(req), signerId(req), ctx(req)));
  });
  router.post("/:id/signers/:signerId/new-link", async (req, res) => {
    res.json(await resetSignerLink(requestId(req), signerId(req), ctx(req)));
  });
  router.post("/:id/extend", async (req, res) => {
    res.json(
      await extendRequest(
        requestId(req),
        parse(signatureExtendSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/seal", async (req, res) => {
    res.json(await sealRequest(requestId(req)));
  });
  router.post("/:id/cancel", async (req, res) => {
    res.json(
      await cancelRequest(
        requestId(req),
        parse(signatureCancelSchema, req.body ?? {}),
        ctx(req)
      )
    );
  });
  router.delete("/:id", async (req, res) => {
    await deleteRequest(requestId(req), ctx(req));
    res.status(204).end();
  });
  router.get("/:id/original", async (req, res) => {
    await sendStoredFile(
      res,
      await originalFile(requestId(req)),
      req.query.download === undefined ? "inline" : "attachment"
    );
  });
  router.get("/:id/signed", async (req, res) => {
    await sendStoredFile(
      res,
      await signedFile(requestId(req)),
      req.query.download === undefined ? "inline" : "attachment"
    );
  });
  return router;
}
