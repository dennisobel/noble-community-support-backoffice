import type { Request } from "express";
import type { z } from "zod";
import type { ActorRef } from "@shared/dto";
import type { AccessModule, UserRole } from "@shared/enums";
import { AppError, errors } from "./errors";

export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    /** What the user can open in the back office: every module for Admins, none for support workers. */
    modules: AccessModule[];
    /** The team member this account belongs to (staff accounts only). */
    staffId: string | null;
  };
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export interface RequestContext {
  actor: ActorRef;
  ip: string;
  requestId: string;
}

/** Validates input with a Zod schema and throws a 422 with a user-displayable message. */
export function parse<S extends z.ZodType>(
  schema: S,
  data: unknown
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map(issue => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw errors.validation(
      details[0]?.message ?? "Check the highlighted fields.",
      details
    );
  }
  return result.data;
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw errors.unauthenticated();
  return req.auth;
}

export function ctx(req: Request): RequestContext {
  const auth = requireAuth(req);
  return {
    actor: { id: auth.user.id, name: auth.user.name },
    ip: clientIp(req),
    requestId: String(req.id ?? ""),
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "";
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !value)
    throw new AppError(400, "BAD_REQUEST", `Missing ${name}.`);
  return value;
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(
  type: "attachment" | "inline",
  filename: string
): string {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
