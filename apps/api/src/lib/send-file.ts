import type { Response } from "express";
import { contentDisposition } from "./http";

/**
 * Streams a stored file with safe headers. Range requests are supported (audio seeking),
 * the type is fixed server-side and browsers are told never to sniff it.
 */
export function sendStoredFile(
  res: Response,
  file: { absolutePath: string; originalName: string; mimeType: string },
  disposition: "inline" | "attachment"
): Promise<void> {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    contentDisposition(disposition, file.originalName)
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return new Promise((resolve, reject) => {
    res.sendFile(
      file.absolutePath,
      { dotfiles: "allow", cacheControl: false, acceptRanges: true },
      error => {
        if (error && !res.headersSent) reject(error);
        else resolve();
      }
    );
  });
}
