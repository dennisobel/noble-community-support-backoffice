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

/**
 * What a kilometre of provider travel is claimable at, in cents. One place so the API default, the
 * form hints and the fallbacks can never disagree. Each workspace can change its own rate in
 * Settings; this is only what a new workspace starts with.
 */
export const DEFAULT_TRAVEL_RATE_CENTS = 99;

/**
 * How quickly a complaint or other feedback should be acknowledged (business days) and resolved
 * (calendar days). These set the due dates a new case starts with; the resolve date can be
 * changed on the case.
 */
export const FEEDBACK_ACKNOWLEDGE_BUSINESS_DAYS = 2;
export const FEEDBACK_RESOLVE_DAYS = 21;

/**
 * NDIS Commission deadlines for a reportable incident, counted from when key personnel became
 * aware: 24 hours for the immediate notification, five business days for the detailed report
 * (and for an unauthorised restrictive practice that caused no harm).
 */
export const REPORTABLE_NOTIFY_HOURS = 24;
export const REPORTABLE_FOLLOW_UP_BUSINESS_DAYS = 5;

/** How often an open conversation and the unread count look for new messages, in milliseconds. */
export const MESSAGE_POLL_MS = { thread: 5_000, list: 20_000 } as const;
