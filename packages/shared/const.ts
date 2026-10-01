export const API_PREFIX = "/api/v1";

export const ACCESS_COOKIE = "noble_access";
export const REFRESH_COOKIE = "noble_refresh";

/** Upload rules shared by the API (enforcement) and the UI (accept attributes and hints). */
export const DOCUMENT_UPLOAD = {
  maxFiles: 10,
  extensions: [
    ".pdf",
    ".docx",
    ".xlsx",
    ".csv",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
  ],
  accept:
    ".pdf,.docx,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv",
} as const;

export const AUDIO_UPLOAD = {
  extensions: [
    ".webm",
    ".ogg",
    ".oga",
    ".opus",
    ".m4a",
    ".mp4",
    ".mp3",
    ".wav",
  ],
  maxDurationSec: 60 * 60,
} as const;

export const DEFAULT_TIMEZONE = "Australia/Adelaide";
