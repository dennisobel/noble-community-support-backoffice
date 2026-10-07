import { Types } from "mongoose";
import type { z } from "zod";
import { API_PREFIX } from "@shared/const";
import type {
  NoteDTO,
  NoteImageDTO,
  NoteLabelDTO,
  NoteSummaryDTO,
} from "@shared/dto";
import {
  NOTE_LIMITS,
  type noteCreateSchema,
  type noteListQuery,
  type notePatchSchema,
} from "@shared/schemas/notes";
import { errors } from "../../lib/errors";
import { escapeRegex } from "../../lib/http";
import { logger } from "../../lib/logger";
import { storage } from "../../lib/storage";
import { verifyUpload } from "../../middleware/upload";
import { Note, NoteImage, type NoteDoc, type NoteImageDoc } from "../../models";
import { sanitizeDoc } from "./content";

/*
 * Personal notes. Every query here is scoped to the signed-in user, and another person's
 * note answers "not found", so notes stay private to their author (Admins included).
 */

export const imageUrl = (id: string) => `${API_PREFIX}/notes/images/${id}`;

const snippetOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 180);

export const toSummary = (
  note: Pick<
    NoteDoc,
    | "_id"
    | "title"
    | "text"
    | "labels"
    | "pinned"
    | "archived"
    | "imageCount"
    | "createdAt"
    | "updatedAt"
  >
): NoteSummaryDTO => ({
  id: String(note._id),
  title: note.title,
  snippet: snippetOf(note.text),
  labels: note.labels,
  pinned: note.pinned,
  archived: note.archived,
  imageCount: note.imageCount,
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
});

export const toNoteDTO = (note: NoteDoc): NoteDTO => ({
  ...toSummary(note),
  content: note.content,
  rev: note.rev,
});

async function ownNote(userId: string, id: string): Promise<NoteDoc> {
  const note = await Note.findOne({ _id: id, userId }).lean<NoteDoc>();
  if (!note) throw errors.notFound("Note");
  return note;
}

export async function listNotes(
  userId: string,
  query: z.output<typeof noteListQuery>
): Promise<NoteSummaryDTO[]> {
  const filter: Record<string, unknown> = {
    userId,
    archived: query.archived === "true",
    // A note nobody has typed in ("New note", then straight back) is not worth listing.
    $nor: [{ title: "", text: "", imageCount: 0 }],
  };
  if (query.label) filter.labels = query.label;
  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$and = [
      { $or: [{ title: pattern }, { text: pattern }, { labels: pattern }] },
    ];
  }
  const notes = await Note.find(filter)
    .sort({ pinned: -1, updatedAt: -1 })
    .limit(300)
    .select("-content")
    .lean<NoteDoc[]>();
  return notes.map(toSummary);
}

/** The labels in use across the person's current notes, most used first. */
export async function labelCounts(userId: string): Promise<NoteLabelDTO[]> {
  const rows = await Note.aggregate<{ _id: string; count: number }>([
    { $match: { userId: new Types.ObjectId(userId), archived: false } },
    { $unwind: "$labels" },
    { $group: { _id: "$labels", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 100 },
  ]);
  return rows.map(row => ({ label: row._id, count: row.count }));
}

export async function createNote(
  userId: string,
  input: z.output<typeof noteCreateSchema>
): Promise<NoteDTO> {
  const note = await Note.create({
    userId,
    title: input.title ?? "",
    labels: input.labels ?? [],
  });
  return toNoteDTO(note.toObject<NoteDoc>());
}

export async function getNote(userId: string, id: string): Promise<NoteDTO> {
  return toNoteDTO(await ownNote(userId, id));
}

/** Autosave and the pin / archive buttons all come through here. */
export async function updateNote(
  userId: string,
  id: string,
  input: z.output<typeof notePatchSchema>
): Promise<NoteDTO> {
  const current = await ownNote(userId, id);
  if (input.rev !== undefined && input.rev !== current.rev)
    throw errors.stale();
  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.labels !== undefined) set.labels = input.labels;
  if (input.pinned !== undefined) set.pinned = input.pinned;
  if (input.archived !== undefined) set.archived = input.archived;
  let referenced: string[] | null = null;
  if (input.content !== undefined) {
    const clean = sanitizeDoc(input.content);
    if (clean.imageIds.length) {
      const owned = await NoteImage.countDocuments({
        _id: { $in: clean.imageIds },
        noteId: current._id,
        userId,
      });
      if (owned !== clean.imageIds.length)
        throw errors.validation(
          "This note can't be saved: a picture in it is not part of this note."
        );
    }
    Object.assign(set, {
      content: clean.doc,
      text: clean.text,
      imageCount: clean.imageIds.length,
    });
    referenced = clean.imageIds;
  }
  const updated = await Note.findOneAndUpdate(
    { _id: id, userId, rev: current.rev },
    { $set: set, $inc: { rev: 1 } },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.stale();
  if (referenced)
    void removeImages({
      noteId: current._id,
      _id: { $nin: referenced },
      // An hour of grace covers a picture that was uploaded but not saved into the note yet.
      createdAt: { $lt: new Date(Date.now() - 60 * 60_000) },
    });
  return toNoteDTO(updated as NoteDoc);
}

export async function deleteNote(userId: string, id: string): Promise<void> {
  const note = await ownNote(userId, id);
  await removeImages({ noteId: note._id });
  await Note.deleteOne({ _id: note._id, userId });
}

async function removeImages(filter: Record<string, unknown>): Promise<void> {
  try {
    const images = await NoteImage.find(filter).lean<NoteImageDoc[]>();
    await Promise.all(
      images.map(image =>
        storage
          .remove(image.storageKey)
          .catch(error =>
            logger().warn({ err: error }, "Could not remove a note picture")
          )
      )
    );
    if (images.length)
      await NoteImage.deleteMany({ _id: { $in: images.map(i => i._id) } });
  } catch (error) {
    logger().warn({ err: error }, "Could not tidy note pictures");
  }
}

/** A picture for a note: checked by its real content, stored, and returned as a private address. */
export async function addImage(
  userId: string,
  noteId: string,
  file: Express.Multer.File | undefined
): Promise<NoteImageDTO> {
  if (!file) throw errors.validation("Choose a picture to add.");
  const note = await ownNote(userId, noteId);
  const verified = await verifyUpload(file, "document");
  if (!verified.mimeType.startsWith("image/"))
    throw errors.unsupportedMedia("Add a JPG, PNG or WebP picture.");
  if (verified.size > NOTE_LIMITS.imageBytes)
    throw errors.payloadTooLarge("That picture is too large. Try a smaller one.");
  if ((await NoteImage.countDocuments({ noteId: note._id })) >= NOTE_LIMITS.images)
    throw errors.validation(
      `A note can hold up to ${NOTE_LIMITS.images} pictures.`
    );
  const storageKey = storage.newKey("notes", verified.extension);
  await storage.moveIn(verified.tempPath, storageKey);
  const image = await NoteImage.create({
    userId,
    noteId: note._id,
    storageKey,
    mimeType: verified.mimeType,
    bytes: verified.size,
  });
  return { id: String(image._id), url: imageUrl(String(image._id)) };
}

export async function imageFile(
  userId: string,
  imageId: string
): Promise<{ absolutePath: string; mimeType: string }> {
  const image = await NoteImage.findOne({ _id: imageId, userId }).lean<NoteImageDoc>();
  if (!image) throw errors.notFound("Picture");
  return {
    absolutePath: storage.resolve(image.storageKey),
    mimeType: image.mimeType,
  };
}

/** Housekeeping: notes that were opened and never typed in. */
export async function purgeEmptyNotes(olderThanMs: number): Promise<number> {
  const result = await Note.deleteMany({
    title: "",
    text: "",
    imageCount: 0,
    updatedAt: { $lt: new Date(Date.now() - olderThanMs) },
  });
  return result.deletedCount ?? 0;
}
