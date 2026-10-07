import { Router, type Request } from "express";
import {
  noteCreateSchema,
  noteListQuery,
  notePatchSchema,
} from "@shared/schemas/notes";
import { parse, requireAuth } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { cleanupUploads, noteImageUpload } from "../../middleware/upload";
import {
  addImage,
  createNote,
  deleteNote,
  getNote,
  imageFile,
  labelCounts,
  listNotes,
  updateNote,
} from "./service";

const me = (req: Request) => requireAuth(req).user.id;
const noteId = (req: Request) => objectIdParam(req, "id", "Note");

/** Mounted behind `authenticate` for every role: back-office users and support workers each keep their own notes. */
export function notesRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listNotes(me(req), parse(noteListQuery, req.query)));
  });
  router.get("/labels", async (req, res) => {
    res.json(await labelCounts(me(req)));
  });
  // Declared before /:id so "images" is never read as a note id.
  router.get("/images/:imageId", async (req, res) => {
    const file = await imageFile(me(req), objectIdParam(req, "imageId", "Picture"));
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // A picture never changes under its id, so the browser may keep it (only for this person).
    res.setHeader("Cache-Control", "private, max-age=86400");
    await new Promise<void>((resolve, reject) =>
      res.sendFile(
        file.absolutePath,
        { dotfiles: "allow", cacheControl: false },
        error => (error && !res.headersSent ? reject(error) : resolve())
      )
    );
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(await createNote(me(req), parse(noteCreateSchema, req.body ?? {})));
  });
  router.get("/:id", async (req, res) => {
    res.json(await getNote(me(req), noteId(req)));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateNote(me(req), noteId(req), parse(notePatchSchema, req.body))
    );
  });
  router.delete("/:id", async (req, res) => {
    await deleteNote(me(req), noteId(req));
    res.status(204).end();
  });
  router.post("/:id/images", noteImageUpload(), async (req, res) => {
    try {
      res.status(201).json(await addImage(me(req), noteId(req), req.file));
    } finally {
      await cleanupUploads(req);
    }
  });
  return router;
}
