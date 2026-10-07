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

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE";
/** Response headers the web app reads: the file name of a download and the id of a failed request. */
const CORS_EXPOSED = "Content-Disposition, X-Request-Id";

/**
 * Lets the web app call the API from another address in the allowlist, for when the site is on
 * example.com and the API on api.example.com. A deployment on one address never needs it. Only an
 * allowlisted origin is ever named, never a wildcard, because these requests carry the session cookies.
 */
export function cors(req: Request, res: Response, next: NextFunction): void {
  // The answer depends on who is asking, so a cache must not hand it to someone else.
  res.vary("Origin");
  const origin = req.get("origin");
  if (!origin || !config().allowedOrigins.has(origin)) return next();
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Expose-Headers", CORS_EXPOSED);
  // The browser asks first before a request with a JSON body or a method other than GET and POST.
  if (req.method === "OPTIONS" && req.get("access-control-request-method")) {
    res.vary("Access-Control-Request-Headers");
    res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.get("access-control-request-headers") ?? "Content-Type"
    );
    res.setHeader("Access-Control-Max-Age", "7200");
    res.status(204).end();
    return;
  }
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
