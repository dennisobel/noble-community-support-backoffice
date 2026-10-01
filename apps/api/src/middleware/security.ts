import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../config";
import { errors } from "../lib/errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Defence in depth against CSRF (cookies are already SameSite=Lax): state-changing requests
 * from a browser must come from an allowed origin.
 */
export function originCheck(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== "null" && !config().allowedOrigins.has(origin))
    throw errors.forbidden("Cross-site request blocked.");
  if (!origin && req.get("sec-fetch-site") === "cross-site")
    throw errors.forbidden("Cross-site request blocked.");
  next();
}

/** Rate limiter that answers with the standard error envelope. Disabled when RATE_LIMIT_ENABLED=false. */
export function limiter(options: {
  windowMs: number;
  limit: number;
  message?: string;
}) {
  const middleware = rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(errors.rateLimited(options.message)),
  });
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config().rateLimitEnabled) return next();
    return middleware(req, res, next);
  };
}

/** Prevents browsers and proxies from caching API responses that may contain personal information. */
export function noStore(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}
