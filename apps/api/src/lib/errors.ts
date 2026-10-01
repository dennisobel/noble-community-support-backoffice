import type { ErrorCode } from "@shared/enums";
import { MESSAGES } from "@shared/messages";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errors = {
  badRequest: (message: string) => new AppError(400, "BAD_REQUEST", message),
  validation: (message: string, details?: unknown) =>
    new AppError(422, "VALIDATION_ERROR", message, details),
  unauthenticated: (message = "Sign in to continue.") =>
    new AppError(401, "UNAUTHENTICATED", message),
  tokenExpired: () =>
    new AppError(
      401,
      "TOKEN_EXPIRED",
      "Your session has expired. Sign in again."
    ),
  invalidCredentials: () =>
    new AppError(
      401,
      "INVALID_CREDENTIALS",
      "The email or password is incorrect."
    ),
  locked: (retryAfterSeconds: number) =>
    new AppError(
      423,
      "ACCOUNT_LOCKED",
      `Too many failed sign-in attempts. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`,
      { retryAfterSeconds }
    ),
  forbidden: (message = "You do not have access to this action.") =>
    new AppError(403, "FORBIDDEN", message),
  notFound: (what = "Record") =>
    new AppError(404, "NOT_FOUND", `${what} not found.`),
  conflict: (code: ErrorCode, message: string, details?: unknown) =>
    new AppError(409, code, message, details),
  invalidState: (message: string) =>
    new AppError(409, "INVALID_STATE", message),
  stale: () => new AppError(409, "STALE_VERSION", MESSAGES.staleVersion),
  payloadTooLarge: (message: string) =>
    new AppError(413, "PAYLOAD_TOO_LARGE", message),
  unsupportedMedia: (message: string) =>
    new AppError(415, "UNSUPPORTED_MEDIA_TYPE", message),
  rateLimited: (message = "Too many requests. Wait a moment and try again.") =>
    new AppError(429, "RATE_LIMITED", message),
  provider: (message: string) =>
    new AppError(502, "PROVIDER_UNAVAILABLE", message),
};

/** A provider failure worth retrying later (network errors, rate limits, 5xx). */
export class RetryableProviderError extends AppError {
  constructor(message: string) {
    super(502, "PROVIDER_UNAVAILABLE", message);
    this.name = "RetryableProviderError";
  }
}

/** Mongo duplicate-key error (E11000). */
export function isDuplicateKey(
  error: unknown
): error is { code: number; keyPattern?: Record<string, unknown> } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
