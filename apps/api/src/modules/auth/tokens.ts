import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import type { UserRole } from "@shared/enums";
import { config } from "../../config";
import { errors } from "../../lib/errors";

const ISSUER = "noble-api";
const AUDIENCE = "noble-web";

export interface AccessClaims {
  sub: string;
  sid: string;
  role: UserRole;
  tv: number;
}

const secretKey = () => new TextEncoder().encode(config().auth.jwtSecret);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sid, role: claims.role, tv: claims.tv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config().auth.accessTtlMinutes}m`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.tv !== "number"
    ) {
      throw errors.unauthenticated();
    }
    return {
      sub: payload.sub,
      sid: payload.sid,
      role: payload.role === "staff" ? "staff" : "admin",
      tv: payload.tv,
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw errors.tokenExpired();
    throw errors.unauthenticated();
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time string comparison (compares hashes so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}
