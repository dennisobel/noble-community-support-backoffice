import type { NoteImageDTO } from "@shared/dto";
import { api } from "@/api/client";

const KEEP_AS_IS = new Set(["image/jpeg", "image/png", "image/webp"]);

const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "photo";

/** The server goes by file type and extension, so a pasted "image" with no proper name still needs one. */
function named(file: File): File {
  if (/\.(jpe?g|png|webp)$/i.test(file.name)) return file;
  const extension =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  return new File([file], `${stem(file.name)}.${extension}`, { type: file.type });
}

/**
 * Phone photos are enormous and a note only needs a picture that looks good on a screen, so big
 * ones are redrawn smaller as a JPEG before they are uploaded. Small JPEG/PNG/WebP files go as they are.
 */
export async function shrinkImage(
  file: File,
  longestSide = 1600,
  quality = 0.85
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml")
    return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return named(file);
  }
  const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1_500_000 && KEEP_AS_IS.has(file.type)) {
    bitmap.close();
    return named(file);
  }
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return named(file);
  }
  // JPEG has no transparency: paint white first so a transparent PNG does not turn black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) return named(file);
  return new File([blob], `${stem(file.name)}.jpg`, { type: "image/jpeg" });
}

export function uploadNoteImage(
  noteId: string,
  file: File
): Promise<NoteImageDTO> {
  const form = new FormData();
  form.append("file", file, file.name);
  return api.upload<NoteImageDTO>(`/notes/${noteId}/images`, form);
}
