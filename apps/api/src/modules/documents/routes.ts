import { Router, type Request } from "express";
import {
  documentListQuery,
  documentPatchSchema,
  documentUploadFields,
} from "@shared/schemas/documents";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { sendStoredFile } from "../../lib/send-file";
import {
  cleanupUploads,
  documentFileUpload,
  documentFilesUpload,
  INLINE_SAFE_TYPES,
} from "../../middleware/upload";
import {
  deleteDocument,
  documentDownload,
  getDocument,
  listDocuments,
  organisationTree,
  participantTree,
  replaceDocumentFile,
  updateDocument,
  uploadDocuments,
} from "./service";

const documentId = (req: Request) => objectIdParam(req, "id", "Document");

/** Mounted at the API root (document routes plus the participant document tree). */
export function documentsRouter(): Router {
  const router = Router();
  router.get("/documents/tree", async (_req, res) => {
    res.json(await organisationTree());
  });
  router.get("/participants/:id/documents/tree", async (req, res) => {
    res.json(await participantTree(objectIdParam(req, "id", "Participant")));
  });
  router.get("/documents", async (req, res) => {
    res.json(await listDocuments(parse(documentListQuery, req.query)));
  });
  router.post("/documents", documentFilesUpload(), async (req, res) => {
    try {
      const fields = parse(documentUploadFields, req.body ?? {});
      res
        .status(201)
        .json(
          await uploadDocuments(
            fields,
            (req.files as Express.Multer.File[]) ?? [],
            ctx(req)
          )
        );
    } finally {
      await cleanupUploads(req);
    }
  });
  router.get("/documents/:id", async (req, res) => {
    res.json(await getDocument(documentId(req)));
  });
  router.get("/documents/:id/download", async (req, res) => {
    const file = await documentDownload(documentId(req));
    const inline =
      req.query.inline === "1" && INLINE_SAFE_TYPES.has(file.mimeType);
    await sendStoredFile(res, file, inline ? "inline" : "attachment");
  });
  router.patch("/documents/:id", async (req, res) => {
    res.json(
      await updateDocument(
        documentId(req),
        parse(documentPatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.put("/documents/:id/file", documentFileUpload(), async (req, res) => {
    try {
      res.json(await replaceDocumentFile(documentId(req), req.file, ctx(req)));
    } finally {
      await cleanupUploads(req);
    }
  });
  router.delete("/documents/:id", async (req, res) => {
    await deleteDocument(documentId(req), ctx(req));
    res.status(204).end();
  });
  router.get("/integrations/xero/status", (_req, res) => {
    res.json({ connected: false });
  });
  return router;
}
