import type { NextFunction, Request, Response } from "express";
import { effectiveModules } from "@shared/access";
import { ACCESS_COOKIE } from "@shared/const";
import type { UserRole } from "@shared/enums";
import { errors } from "../lib/errors";
import {
  AuthSession,
  User,
  type AuthSessionDoc,
  type UserDoc,
} from "../models";
import { verifyAccessToken } from "../modules/auth/tokens";

const ENDED = "Your session has ended. Sign in again.";

/** Requires a valid access cookie, an active user and a live (not revoked) session. */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== "string" || !token) throw errors.unauthenticated();
  const claims = await verifyAccessToken(token);
  if (!/^[a-f\d]{24}$/i.test(claims.sub) || !/^[a-f\d]{24}$/i.test(claims.sid))
    throw errors.unauthenticated();
  const [user, session] = await Promise.all([
    User.findById(claims.sub)
      .select("name email role modules status tokenVersion staffId")
      .lean<
        Pick<
          UserDoc,
          | "_id"
          | "name"
          | "email"
          | "role"
          | "modules"
          | "status"
          | "tokenVersion"
          | "staffId"
        >
      >(),
    AuthSession.findById(claims.sid)
      .select("userId revokedAt expiresAt")
      .lean<
        Pick<AuthSessionDoc, "_id" | "userId" | "revokedAt" | "expiresAt">
      >(),
  ]);
  if (!user || user.status !== "active" || user.tokenVersion !== claims.tv)
    throw errors.unauthenticated(ENDED);
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now() ||
    String(session.userId) !== String(user._id)
  ) {
    throw errors.unauthenticated(ENDED);
  }
  req.auth = {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      modules: effectiveModules(user.role, user.modules),
      staffId: user.staffId ? String(user.staffId) : null,
    },
    sessionId: String(session._id),
  };
  next();
}

/** The back office: Admins and approved office users. Support workers use their own portal. */
export function requireOffice(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.auth || req.auth.user.role === "staff") throw errors.forbidden();
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.user.role))
      throw errors.forbidden();
    next();
  };
}
