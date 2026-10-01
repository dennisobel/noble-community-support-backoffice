import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import type { ApiErrorBody } from "@shared/dto";
import { config } from "../config";
import { AppError, errors, isDuplicateKey } from "../lib/errors";
import { logger } from "../lib/logger";
import { cleanupUploads } from "./upload";

function multerError(error: multer.MulterError): AppError {
  const { maxDocBytes, maxAudioBytes, maxFilesPerRequest } = config().uploads;
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return errors.payloadTooLarge(
        `This file is too large. Documents can be up to ${Math.round(maxDocBytes / 1048576)} MB and recordings up to ${Math.round(maxAudioBytes / 1048576)} MB.`
      );
    case "LIMIT_FILE_COUNT":
      return errors.validation(
        `Upload up to ${maxFilesPerRequest} files at a time.`
      );
    case "LIMIT_UNEXPECTED_FILE":
      return errors.validation("Unexpected file field in the upload.");
    default:
      return errors.validation(
        "The upload could not be processed. Check the file and try again."
      );
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof multer.MulterError) return multerError(error);
  if (isDuplicateKey(error))
    return errors.conflict("CONFLICT", "This record already exists.");
  if (error instanceof mongoose.Error.ValidationError) {
    const first = Object.values(error.errors)[0];
    return errors.validation(first?.message ?? "Check the highlighted fields.");
  }
  if (error instanceof mongoose.Error.CastError) return errors.notFound();
  const typed = error as { type?: string; status?: number };
  if (typed?.type === "entity.parse.failed")
    return errors.badRequest("The request body is not valid JSON.");
  if (typed?.type === "entity.too.large")
    return errors.payloadTooLarge("The request is too large.");
  return new AppError(
    500,
    "INTERNAL",
    "Something went wrong. Try again, and contact support if it keeps happening."
  );
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  void cleanupUploads(req).catch(() => undefined);
  const appError = toAppError(error);
  const log = req.log ?? logger();
  if (appError.status >= 500) log.error({ err: error }, "Request failed");
  else
    log.debug(
      { code: appError.code, message: appError.message },
      "Request rejected"
    );
  if (res.headersSent) {
    res.end();
    return;
  }
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId: req.id ? String(req.id) : undefined,
    },
  };
  res.status(appError.status).json(body);
}

export function apiNotFound(_req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: { code: "NOT_FOUND", message: "This API endpoint does not exist." },
  };
  res.status(404).json(body);
}
