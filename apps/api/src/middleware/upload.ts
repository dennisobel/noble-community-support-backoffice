import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request } from "express";
import { fileTypeFromFile } from "file-type";
import multer from "multer";
import { config } from "../config";
import { errors } from "../lib/errors";
import { removeQuietly, storage } from "../lib/storage";

export type UploadKind = "document" | "audio";

interface TypeRule {
  mimes: string[];
  /** file-type extensions accepted for this declared extension, or "text" for plain-text formats. */
  detected: string[] | "text";
  canonicalExt: string;
  canonicalMime: string;
}

const DOCUMENT_RULES: Record<string, TypeRule> = {
  ".pdf": {
    mimes: ["application/pdf"],
    detected: ["pdf"],
    canonicalExt: ".pdf",
    canonicalMime: "application/pdf",
  },
  ".docx": {
    mimes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    detected: ["docx"],
    canonicalExt: ".docx",
    canonicalMime:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    detected: ["xlsx"],
    canonicalExt: ".xlsx",
    canonicalMime:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".csv": {
    mimes: ["text/csv", "application/vnd.ms-excel", "text/plain"],
    detected: "text",
    canonicalExt: ".csv",
    canonicalMime: "text/csv",
  },
  ".txt": {
    mimes: ["text/plain"],
    detected: "text",
    canonicalExt: ".txt",
    canonicalMime: "text/plain",
  },
  ".jpg": {
    mimes: ["image/jpeg"],
    detected: ["jpg"],
    canonicalExt: ".jpg",
    canonicalMime: "image/jpeg",
  },
  ".jpeg": {
    mimes: ["image/jpeg"],
    detected: ["jpg"],
    canonicalExt: ".jpg",
    canonicalMime: "image/jpeg",
  },
  ".png": {
    mimes: ["image/png"],
    detected: ["png"],
    canonicalExt: ".png",
    canonicalMime: "image/png",
  },
  ".webp": {
    mimes: ["image/webp"],
    detected: ["webp"],
    canonicalExt: ".webp",
    canonicalMime: "image/webp",
  },
};

const oggRule: TypeRule = {
  mimes: ["audio/ogg", "application/ogg", "audio/opus"],
  detected: ["ogg", "opus", "oga"],
  canonicalExt: ".ogg",
  canonicalMime: "audio/ogg",
};
const mp4Rule: TypeRule = {
  mimes: ["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "video/mp4"],
  detected: ["m4a", "mp4"],
  canonicalExt: ".m4a",
  canonicalMime: "audio/mp4",
};

const AUDIO_RULES: Record<string, TypeRule> = {
  ".webm": {
    mimes: ["audio/webm", "video/webm"],
    detected: ["webm"],
    canonicalExt: ".webm",
    canonicalMime: "audio/webm",
  },
  ".ogg": oggRule,
  ".oga": oggRule,
  ".opus": oggRule,
  ".m4a": mp4Rule,
  ".mp4": mp4Rule,
  ".mp3": {
    mimes: ["audio/mpeg", "audio/mp3"],
    detected: ["mp3"],
    canonicalExt: ".mp3",
    canonicalMime: "audio/mpeg",
  },
  ".wav": {
    mimes: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
    detected: ["wav"],
    canonicalExt: ".wav",
    canonicalMime: "audio/wav",
  },
};

const rulesFor = (kind: UploadKind) =>
  kind === "document" ? DOCUMENT_RULES : AUDIO_RULES;
const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();
const unsupported = (kind: UploadKind) =>
  errors.unsupportedMedia(
    kind === "document"
      ? "This file type is not supported. Upload a PDF, Word, Excel, CSV, text or image file."
      : "This audio format is not supported. Record again or upload WebM, Ogg, M4A, MP3 or WAV audio."
  );

function fileFilter(kind: UploadKind): multer.Options["fileFilter"] {
  return (_req, file, callback) => {
    const rule = rulesFor(kind)[path.extname(file.originalname).toLowerCase()];
    const mime = baseMime(file.mimetype);
    if (
      !rule ||
      (mime !== "application/octet-stream" && !rule.mimes.includes(mime))
    ) {
      callback(unsupported(kind));
      return;
    }
    callback(null, true);
  };
}

function diskStorage() {
  return multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, storage.tmpDir()),
    filename: (_req, _file, callback) =>
      callback(null, `${randomUUID()}.upload`),
  });
}

/** `files[]` (up to MAX_FILES_PER_REQUEST) for document uploads. */
export function documentFilesUpload() {
  const { maxDocBytes, maxFilesPerRequest } = config().uploads;
  return multer({
    storage: diskStorage(),
    fileFilter: fileFilter("document"),
    limits: {
      fileSize: maxDocBytes,
      files: maxFilesPerRequest,
      fields: 20,
      parts: 40,
      fieldSize: 64 * 1024,
      headerPairs: 200,
    },
  }).array("files", maxFilesPerRequest);
}

/** A single `file` field for replacing a document or filling a template slot. */
export function documentFileUpload() {
  return multer({
    storage: diskStorage(),
    fileFilter: fileFilter("document"),
    limits: {
      fileSize: config().uploads.maxDocBytes,
      files: 1,
      fields: 10,
      parts: 15,
      fieldSize: 64 * 1024,
      headerPairs: 200,
    },
  }).single("file");
}

/** A single `audio` field for voice notes. */
export function audioUpload() {
  return multer({
    storage: diskStorage(),
    fileFilter: fileFilter("audio"),
    limits: {
      fileSize: config().uploads.maxAudioBytes,
      files: 1,
      fields: 10,
      parts: 15,
      fieldSize: 64 * 1024,
      headerPairs: 200,
    },
  }).single("audio");
}

/** A single `file` field holding one picture for a note (the service checks it really is an image). */
export function noteImageUpload() {
  return multer({
    storage: diskStorage(),
    fileFilter: fileFilter("document"),
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 5,
      parts: 10,
      fieldSize: 8 * 1024,
      headerPairs: 200,
    },
  }).single("file");
}

export interface VerifiedFile {
  tempPath: string;
  originalName: string;
  size: number;
  extension: string;
  mimeType: string;
}

/** Confirms the real content type from the file's magic bytes; the declared type and extension are never trusted alone. */
export async function verifyUpload(
  file: Express.Multer.File,
  kind: UploadKind
): Promise<VerifiedFile> {
  const rule = rulesFor(kind)[path.extname(file.originalname).toLowerCase()];
  if (!rule) throw unsupported(kind);
  if (file.size === 0) throw errors.validation("The uploaded file is empty.");
  if (rule.detected === "text") {
    const handle = await fs.open(file.path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(8192, file.size));
      await handle.read(buffer, 0, buffer.length, 0);
      if (buffer.includes(0))
        throw errors.unsupportedMedia(
          "The file content does not match its type."
        );
    } finally {
      await handle.close();
    }
  } else {
    const detected = await fileTypeFromFile(file.path);
    if (!detected || !rule.detected.includes(detected.ext))
      throw errors.unsupportedMedia(
        "The file content does not match its type."
      );
  }
  return {
    tempPath: file.path,
    originalName:
      path.basename(file.originalname).slice(0, 200) ||
      `upload${rule.canonicalExt}`,
    size: file.size,
    extension: rule.canonicalExt,
    mimeType: rule.canonicalMime,
  };
}

/** Removes any temp files Multer wrote for this request (called on errors and after processing). */
export async function cleanupUploads(req: Request): Promise<void> {
  const files: Express.Multer.File[] = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files)
    for (const group of Object.values(req.files)) files.push(...group);
  const tmp = path.resolve(storage.tmpDir());
  await Promise.all(
    files
      .filter(file => path.resolve(file.path).startsWith(tmp))
      .map(file => removeQuietly(file.path))
  );
}

export const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
