import argon2 from "argon2";
import type { Request, Response } from "express";
import type { z } from "zod";
import { ACCESS_COOKIE, API_PREFIX, REFRESH_COOKIE } from "@shared/const";
import type {
  AuthSessionDTO,
  BootstrapDTO,
  SessionDTO,
  UserDTO,
} from "@shared/dto";
import { effectiveModules } from "@shared/access";
import { todayIn } from "@shared/logic/time";
import { MESSAGES } from "@shared/messages";
import type {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateMeSchema,
} from "@shared/schemas/auth";
import type { registerSchema } from "@shared/schemas/access";
import type { staffApplicationSchema } from "@shared/schemas/staff-portal";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { withTransaction } from "../../lib/db";
import { errors, isDuplicateKey } from "../../lib/errors";
import { clientIp, requireAuth, type RequestContext } from "../../lib/http";
import { logger } from "../../lib/logger";
import { sendMail } from "../../lib/mailer";
import { getWorkspace, invalidateWorkspaceCache } from "../../lib/workspace";
import {
  AuthSession,
  PasswordReset,
  Staff,
  StaffApplication,
  User,
  Workspace,
  WORKSPACE_ID,
  workspaceDefaults,
  type AuthSessionDoc,
  type StaffDoc,
  type UserDoc,
} from "../../models";
import { toPreferencesDTO } from "../settings/service";
import {
  randomToken,
  safeEqual,
  sha256,
  signAccessToken,
  verifyAccessToken,
} from "./tokens";

/* ───────────── Passwords ───────────── */

// OWASP-recommended argon2id parameters (19 MiB memory, 2 iterations, 1 lane).
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
let dummyHash: Promise<string> | null = null;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/** Verifies a password; when the user does not exist a dummy hash is checked so timing does not reveal it. */
async function verifyPassword(
  hash: string | null,
  password: string
): Promise<boolean> {
  try {
    if (!hash) {
      dummyHash ??= argon2.hash("timing-equaliser-password", HASH_OPTIONS);
      await argon2.verify(await dummyHash, password);
      return false;
    }
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function assertPasswordStrength(password: string): void {
  const min = config().auth.passwordMinLength;
  if (password.length < min)
    throw errors.validation(MESSAGES.password(min), [
      { path: "password", message: MESSAGES.password(min) },
    ]);
}

/* ───────────── Cookies & sessions ───────────── */

const refreshTtlMs = () => config().auth.refreshTtlDays * 86_400_000;
const REUSE_GRACE_MS = 60_000;

function cookieBase() {
  const auth = config().auth;
  return {
    httpOnly: true,
    secure: auth.cookieSecure,
    sameSite: "lax" as const,
    domain: auth.cookieDomain,
  };
}

function setAccessCookie(res: Response, token: string): void {
  // Session cookie; the JWT inside expires after ACCESS_TTL_MINUTES and is renewed through /auth/refresh.
  res.cookie(ACCESS_COOKIE, token, { ...cookieBase(), path: "/" });
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieBase(),
    path: `${API_PREFIX}/auth`,
    maxAge: refreshTtlMs(),
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, {
    ...cookieBase(),
    path: `${API_PREFIX}/auth`,
  });
}

async function issueAccessCookie(
  res: Response,
  user: Pick<UserDoc, "_id" | "role" | "tokenVersion">,
  sessionId: string
): Promise<void> {
  const access = await signAccessToken({
    sub: String(user._id),
    sid: sessionId,
    role: user.role,
    tv: user.tokenVersion,
  });
  setAccessCookie(res, access);
}

async function startSession(
  user: UserDoc,
  req: Request,
  res: Response
): Promise<string> {
  const refreshToken = randomToken();
  const now = new Date();
  const session = await AuthSession.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    previous: [],
    userAgent: (req.get("user-agent") ?? "").slice(0, 300),
    ip: clientIp(req),
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + refreshTtlMs()),
  });
  await issueAccessCookie(res, user, String(session._id));
  setRefreshCookie(res, refreshToken);
  return String(session._id);
}

async function revokeSessions(
  filter: Record<string, unknown>,
  reason: string
): Promise<void> {
  await AuthSession.updateMany(
    { ...filter, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
}

/* ───────────── DTOs ───────────── */

export function toUserDTO(
  user: Pick<
    UserDoc,
    | "_id"
    | "name"
    | "email"
    | "role"
    | "modules"
    | "lastLoginAt"
    | "createdAt"
    | "staffId"
  >
): UserDTO {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    modules: effectiveModules(user.role, user.modules),
    staffId: user.staffId ? String(user.staffId) : null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

async function sessionDTO(user: UserDoc): Promise<SessionDTO> {
  const workspace = await getWorkspace();
  return {
    user: toUserDTO(user),
    workspace: {
      name: workspace.name,
      timezone: workspace.timezone,
      today: todayIn(workspace.timezone),
    },
    preferences: toPreferencesDTO(user),
  };
}

const actorOf = (user: Pick<UserDoc, "_id" | "name">) => ({
  id: String(user._id),
  name: user.name,
});

/* ───────────── First run ───────────── */

export async function bootstrapStatus(): Promise<BootstrapDTO> {
  const workspace = await Workspace.findById(WORKSPACE_ID)
    .select("setupCompletedAt")
    .lean<{ setupCompletedAt: Date | null }>();
  return {
    setupRequired: !workspace?.setupCompletedAt,
    setupCodeRequired: Boolean(config().auth.setupCode),
  };
}

const setupDone = () =>
  errors.conflict(
    "SETUP_ALREADY_COMPLETED",
    "This workspace already has an Admin account. Sign in instead."
  );

export async function signup(
  input: z.output<typeof signupSchema>,
  req: Request,
  res: Response
): Promise<SessionDTO> {
  const cfg = config();
  assertPasswordStrength(input.password);
  if (
    cfg.auth.setupCode &&
    !safeEqual(input.setupCode ?? "", cfg.auth.setupCode)
  ) {
    throw errors.forbidden(
      "The setup code is incorrect. Ask the person who deployed Noble for the code."
    );
  }
  if ((await bootstrapStatus()).setupRequired === false) throw setupDone();
  const passwordHash = await hashPassword(input.password);
  let user: UserDoc;
  try {
    user = await withTransaction(async session => {
      // Atomic claim: only one signup can ever set setupCompletedAt.
      const claimed = await Workspace.findOneAndUpdate(
        { _id: WORKSPACE_ID, setupCompletedAt: null },
        {
          $set: { setupCompletedAt: new Date() },
          $setOnInsert: workspaceDefaults(cfg.timezone),
        },
        { upsert: true, returnDocument: "after", session }
      );
      if (!claimed) throw setupDone();
      const [created] = await User.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            role: "admin",
            lastLoginAt: new Date(),
          },
        ],
        {
          session,
        }
      );
      return created.toObject<UserDoc>();
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw setupDone();
    throw error;
  }
  invalidateWorkspaceCache();
  await startSession(user, req, res);
  await logActivity({
    actor: actorOf(user),
    action: "auth.signup",
    entityType: "user",
    entityId: String(user._id),
    summary: "created the workspace Admin account",
    ip: clientIp(req),
  });
  return sessionDTO(user);
}

/* ───────────── Asking for access ───────────── */

/**
 * Anyone who is not the first Admin asks for access here. The account exists straight away,
 * so they choose their own password, but it cannot sign in until an Admin approves it and
 * decides which role and modules it gets.
 */
export async function register(
  input: z.output<typeof registerSchema>,
  req: Request
): Promise<{ status: "Pending"; message: string }> {
  assertPasswordStrength(input.password);
  if ((await bootstrapStatus()).setupRequired)
    throw errors.badRequest(
      "This workspace has not been set up yet. Create the Admin account first."
    );
  const taken = (status?: UserDoc["status"]) =>
    errors.conflict(
      "EMAIL_DUPLICATE",
      status === "pending"
        ? "You have already asked for access. An Admin will review it soon."
        : "This email already has an account. Sign in, or use “Forgot password” if you need a new password."
    );
  const existing = await User.findOne({ email: input.email })
    .select("status")
    .lean<Pick<UserDoc, "status">>();
  if (existing) throw taken(existing.status);
  const passwordHash = await hashPassword(input.password);
  let user: UserDoc;
  try {
    const created = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      // Placeholders: the Admin chooses the real role and modules when approving.
      role: "coordinator",
      modules: [],
      status: "pending",
      request: { message: input.message ?? "" },
    });
    user = created.toObject<UserDoc>();
  } catch (error) {
    if (isDuplicateKey(error)) throw taken();
    throw error;
  }
  await logActivity({
    actor: null,
    action: "user.requested_access",
    entityType: "user",
    entityId: String(user._id),
    summary: `${input.name} asked for access`,
    ip: clientIp(req),
  });
  return {
    status: "Pending",
    message:
      "Thanks, your request is with an Admin. You can sign in as soon as they approve it.",
  };
}

/* ───────────── Sign in / out ───────────── */

export async function login(
  input: z.output<typeof loginSchema>,
  req: Request,
  res: Response
): Promise<SessionDTO> {
  const auth = config().auth;
  const user = await User.findOne({ email: input.email }).lean<UserDoc>();
  if (user && (user.status === "pending" || user.status === "rejected")) {
    // Only someone who knows the password learns where their request stands.
    if (!(await verifyPassword(user.passwordHash, input.password)))
      throw errors.invalidCredentials();
    throw errors.forbidden(
      user.status === "pending"
        ? "Your access request is waiting for an Admin to approve it. You can sign in as soon as it is."
        : "Your access request was declined. Ask the person who runs your workspace if you think that is a mistake."
    );
  }
  if (!user || user.status !== "active") {
    await verifyPassword(null, input.password);
    throw errors.invalidCredentials();
  }
  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now)
    throw errors.locked((user.lockedUntil.getTime() - now) / 1000);

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLogins: 1 } },
      { returnDocument: "after", lean: true }
    );
    if ((updated?.failedLogins ?? 0) >= auth.loginMaxFailures) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLogins: 0,
            lockedUntil: new Date(now + auth.loginLockMinutes * 60_000),
          },
        }
      );
      await logActivity({
        actor: null,
        action: "auth.account_locked",
        entityType: "user",
        entityId: String(user._id),
        summary: `Account locked after ${auth.loginMaxFailures} failed sign-in attempts`,
        ip: clientIp(req),
      });
      throw errors.locked(auth.loginLockMinutes * 60);
    }
    throw errors.invalidCredentials();
  }

  const $set: Record<string, unknown> = {
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  };
  if (argon2.needsRehash(user.passwordHash, HASH_OPTIONS))
    $set.passwordHash = await hashPassword(input.password);
  const fresh = await User.findOneAndUpdate(
    { _id: user._id },
    { $set },
    { returnDocument: "after", lean: true }
  );
  const signedIn = (fresh ?? user) as UserDoc;
  await startSession(signedIn, req, res);
  await logActivity({
    actor: actorOf(signedIn),
    action: "auth.login",
    entityType: "user",
    entityId: String(user._id),
    summary: "signed in",
    ip: clientIp(req),
  });
  return sessionDTO(signedIn);
}

/** Signs in as the seeded demo Admin. Only available when DEMO_ENABLED=true (never in production). */
export async function demoLogin(
  req: Request,
  res: Response
): Promise<SessionDTO> {
  const cfg = config();
  if (!cfg.demo.enabled || cfg.production)
    throw errors.notFound("Demo workspace");
  const user = await User.findOne({
    email: cfg.demo.adminEmail,
    status: "active",
  }).lean<UserDoc>();
  if (!user)
    throw errors.notFound(
      "Demo data has not been loaded. Run `pnpm seed:demo` first. Demo account"
    );
  await User.updateOne(
    { _id: user._id },
    { $set: { lastLoginAt: new Date() } }
  );
  await startSession(user, req, res);
  return sessionDTO(user);
}

/** Rotates the refresh token. Presenting an already-rotated token (outside a short grace window) revokes the session. */
export async function refresh(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== "string" || !token)
    throw errors.unauthenticated("No active session.");
  const hash = sha256(token);
  const now = new Date();

  const session = await AuthSession.findOne({
    tokenHash: hash,
  }).lean<AuthSessionDoc>();
  if (session) {
    if (session.revokedAt || session.expiresAt <= now)
      throw errors.unauthenticated("Your session has ended. Sign in again.");
    const user = await User.findById(session.userId).lean<UserDoc>();
    if (!user || user.status !== "active")
      throw errors.unauthenticated("Your session has ended. Sign in again.");
    const next = randomToken();
    const rotated = await AuthSession.findOneAndUpdate(
      { _id: session._id, tokenHash: hash, revokedAt: null },
      {
        $set: {
          tokenHash: sha256(next),
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + refreshTtlMs()),
        },
        $push: { previous: { $each: [{ hash, rotatedAt: now }], $slice: -5 } },
      },
      { returnDocument: "after", lean: true }
    );
    if (rotated) {
      await issueAccessCookie(res, user, String(session._id));
      setRefreshCookie(res, next);
      return;
    }
  }

  const reused = await AuthSession.findOne({
    "previous.hash": hash,
  }).lean<AuthSessionDoc>();
  if (reused && !reused.revokedAt && reused.expiresAt > now) {
    const entry = reused.previous.find(item => item.hash === hash);
    if (entry && now.getTime() - entry.rotatedAt.getTime() < REUSE_GRACE_MS) {
      // Another tab refreshed a moment ago: renew the access token only; the browser already holds the new refresh cookie.
      const user = await User.findById(reused.userId).lean<UserDoc>();
      if (user && user.status === "active") {
        await issueAccessCookie(res, user, String(reused._id));
        return;
      }
    }
    await revokeSessions({ _id: reused._id }, "refresh_token_reuse");
    logger().warn(
      { sessionId: String(reused._id) },
      "Refresh token reuse detected; session revoked"
    );
    await logActivity({
      actor: null,
      action: "auth.refresh_reuse",
      entityType: "session",
      entityId: String(reused._id),
      summary:
        "A reused refresh token was detected and the session was revoked",
      ip: clientIp(req),
    });
  }
  clearAuthCookies(res);
  throw errors.unauthenticated("Your session has ended. Sign in again.");
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof token === "string" && token) {
    await revokeSessions({ tokenHash: sha256(token) }, "logout");
  } else {
    const access: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof access === "string" && access) {
      try {
        const claims = await verifyAccessToken(access);
        await revokeSessions({ _id: claims.sid }, "logout");
      } catch {
        /* already invalid */
      }
    }
  }
  clearAuthCookies(res);
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const auth = requireAuth(req);
  await revokeSessions({ userId: auth.user.id }, "logout_all");
  await User.updateOne({ _id: auth.user.id }, { $inc: { tokenVersion: 1 } });
  await logActivity({
    actor: { id: auth.user.id, name: auth.user.name },
    action: "auth.logout_all",
    entityType: "user",
    entityId: auth.user.id,
    summary: "signed out of every session",
    ip: clientIp(req),
  });
  clearAuthCookies(res);
}

/* ───────────── Current user ───────────── */

export async function me(req: Request): Promise<SessionDTO> {
  const user = await User.findById(requireAuth(req).user.id).lean<UserDoc>();
  if (!user) throw errors.unauthenticated();
  return sessionDTO(user);
}

export async function updateMe(
  req: Request,
  input: z.output<typeof updateMeSchema>
): Promise<SessionDTO> {
  const auth = requireAuth(req);
  const $set: Record<string, unknown> = {};
  if (input.name) $set.name = input.name;
  if (input.email) $set.email = input.email;
  if (Object.keys($set).length) {
    try {
      await User.updateOne({ _id: auth.user.id }, { $set });
    } catch (error) {
      if (isDuplicateKey(error))
        throw errors.conflict(
          "EMAIL_DUPLICATE",
          "Another account already uses this email address."
        );
      throw error;
    }
  }
  return me(req);
}

export async function changePassword(
  req: Request,
  res: Response,
  input: z.output<typeof changePasswordSchema>
): Promise<void> {
  const auth = requireAuth(req);
  const user = await User.findById(auth.user.id).lean<UserDoc>();
  if (!user) throw errors.unauthenticated();
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw errors.validation("Your current password is incorrect.", [
      {
        path: "currentPassword",
        message: "Your current password is incorrect.",
      },
    ]);
  }
  assertPasswordStrength(input.newPassword);
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: new Date(),
      },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!updated) throw errors.unauthenticated();
  await revokeSessions(
    { userId: user._id, _id: { $ne: auth.sessionId } },
    "password_changed"
  );
  await issueAccessCookie(res, updated as UserDoc, auth.sessionId);
  await logActivity({
    actor: actorOf(user),
    action: "auth.password_changed",
    entityType: "user",
    entityId: String(user._id),
    summary: "changed their password",
    ip: clientIp(req),
  });
}

export async function listSessions(req: Request): Promise<AuthSessionDTO[]> {
  const auth = requireAuth(req);
  const sessions = await AuthSession.find({
    userId: auth.user.id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastUsedAt: -1 })
    .lean<AuthSessionDoc[]>();
  return sessions.map(session => ({
    id: String(session._id),
    userAgent: session.userAgent,
    ip: session.ip,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    current: String(session._id) === auth.sessionId,
  }));
}

export async function revokeSession(
  req: Request,
  sessionId: string
): Promise<void> {
  const auth = requireAuth(req);
  if (!/^[a-f\d]{24}$/i.test(sessionId)) throw errors.notFound("Session");
  const result = await AuthSession.updateOne(
    { _id: sessionId, userId: auth.user.id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: "revoked_by_user" } }
  );
  if (!result.matchedCount) throw errors.notFound("Session");
}

/* ───────────── Password reset ───────────── */

const RESET_TTL_MS = 30 * 60_000;

export async function forgotPassword(
  input: z.output<typeof forgotPasswordSchema>,
  req: Request
): Promise<void> {
  const user = await User.findOne({
    email: input.email,
    status: "active",
  }).lean<UserDoc>();
  if (!user) return; // same response either way: no account enumeration
  const token = randomToken(32);
  await PasswordReset.deleteMany({ userId: user._id, usedAt: null });
  await PasswordReset.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
    requestedIp: clientIp(req),
  });
  const link = `${config().appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const sent = await sendMail({
    to: user.email,
    subject: "Reset your Noble Community Support password",
    text: `Hi ${user.name},\n\nUse this link to choose a new password. It expires in 30 minutes and can be used once:\n\n${link}\n\nIf you did not ask for this, you can ignore this email; your password will not change.\n`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Use this link to choose a new password. It expires in 30 minutes and can be used once:</p><p><a href="${link}">Reset your password</a></p><p>If you did not ask for this, you can ignore this email; your password will not change.</p>`,
  }).catch(error => {
    logger().error({ err: error }, "Password reset email failed");
    return false;
  });
  if (!sent && !config().production)
    logger().info(
      { link },
      "Password reset link (SMTP not configured; development only)"
    );
  await logActivity({
    actor: null,
    action: "auth.password_reset_requested",
    entityType: "user",
    entityId: String(user._id),
    summary: "A password reset was requested",
    ip: clientIp(req),
  });
}

export async function resetPassword(
  input: z.output<typeof resetPasswordSchema>,
  req: Request
): Promise<void> {
  assertPasswordStrength(input.password);
  const reset = await PasswordReset.findOneAndUpdate(
    {
      tokenHash: sha256(input.token),
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { returnDocument: "after", lean: true }
  );
  if (!reset)
    throw errors.validation(
      "This reset link is invalid or has expired. Request a new one."
    );
  const user = await User.findOneAndUpdate(
    { _id: reset.userId },
    {
      $set: {
        passwordHash: await hashPassword(input.password),
        passwordChangedAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
        "invitation.acceptedAt": new Date(),
      },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: "after", lean: true }
  );
  if (!user)
    throw errors.validation(
      "This reset link is invalid or has expired. Request a new one."
    );
  await revokeSessions({ userId: user._id }, "password_reset");
  await logActivity({
    actor: actorOf(user as UserDoc),
    action: "auth.password_reset",
    entityType: "user",
    entityId: String(user._id),
    summary: "reset their password",
    ip: clientIp(req),
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char
  );
}

/* ───────────── Staff accounts ───────────── */

export interface InviteResult {
  userId: string;
  email: string;
  link: string;
  expiresAt: string;
  emailed: boolean;
}

const INVITE_TTL_MS = 7 * 86_400_000;

/**
 * Issues a "choose your password" link for a team member, creating their worker account
 * the first time. The same link doubles as the invitation for a self-registered worker
 * whose application an Admin has just approved, so approval and invitation are one step.
 */
export async function inviteStaffAccount(
  staff: Pick<StaffDoc, "_id" | "name" | "email" | "userId">,
  ctx: RequestContext | null
): Promise<InviteResult> {
  let userId = staff.userId ? String(staff.userId) : null;
  if (!userId) {
    const existing = await User.findOne({ email: staff.email })
      .select("_id role")
      .lean<Pick<UserDoc, "_id" | "role">>();
    // Any office account (Admin, Manager, ...) must never be turned into a worker login by an invite.
    if (existing && existing.role !== "staff")
      throw errors.conflict(
        "STAFF_ACCOUNT_EXISTS",
        existing.role === "admin"
          ? `${staff.email} already belongs to the workspace Admin account.`
          : `${staff.email} already belongs to an office account.`
      );
    if (existing) userId = String(existing._id);
  }
  // A random password keeps the account unusable until the invite link is followed.
  const placeholder = await hashPassword(randomToken(24));
  const user =
    userId === null
      ? await User.create({
          name: staff.name,
          email: staff.email,
          passwordHash: placeholder,
          role: "staff",
          staffId: staff._id,
          invitation: { sentAt: new Date(), acceptedAt: null },
        })
      : await User.findOneAndUpdate(
          { _id: userId },
          {
            $set: {
              name: staff.name,
              email: staff.email,
              role: "staff",
              staffId: staff._id,
              status: "active",
              "invitation.sentAt": new Date(),
            },
          },
          { returnDocument: "after", lean: true }
        );
  if (!user) throw errors.notFound("Team member account");
  await Staff.updateOne({ _id: staff._id }, { $set: { userId: user._id } });

  const token = randomToken(32);
  await PasswordReset.deleteMany({ userId: user._id, usedAt: null });
  await PasswordReset.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    requestedIp: ctx?.ip ?? "",
  });
  const link = `${config().appUrl}/reset-password?token=${encodeURIComponent(token)}&welcome=1`;
  const emailed = await sendMail({
    to: user.email,
    subject: "Your Noble Community Support staff portal access",
    text: `Hi ${user.name},\n\nYour staff portal is ready. Choose a password to sign in — the link works once and expires in 7 days:\n\n${link}\n\nOn your phone you can add the portal to your home screen and use it like an app.\n`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Your staff portal is ready. Choose a password to sign in — the link works once and expires in 7 days:</p><p><a href="${link}">Choose your password</a></p><p>On your phone you can add the portal to your home screen and use it like an app.</p>`,
  }).catch(error => {
    logger().error({ err: error }, "Staff invitation email failed");
    return false;
  });
  if (!emailed && !config().production)
    logger().info({ link }, "Staff invitation link (SMTP not configured)");
  await logActivity({
    actor: ctx?.actor ?? null,
    action: "staff.invited",
    entityType: "staff",
    entityId: String(staff._id),
    summary: `invited ${staff.name} to the staff portal`,
    ip: ctx?.ip ?? "",
  });
  return {
    userId: String(user._id),
    email: user.email,
    link,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    emailed,
  };
}

/** Public worker self-registration: records an application for an Admin to approve. */
export async function staffSignup(
  input: z.output<typeof staffApplicationSchema>,
  req: Request
): Promise<{ status: "Pending" | "Have account"; message: string }> {
  const account = await User.findOne({ email: input.email })
    .select("_id")
    .lean<Pick<UserDoc, "_id">>();
  if (account) {
    return {
      status: "Have account",
      message:
        "This email already has portal access. Sign in, or use “Forgot password” if you need a new password.",
    };
  }
  const pending = await StaffApplication.findOne({
    email: input.email,
    status: "Pending",
  })
    .select("_id")
    .lean<{ _id: unknown }>();
  if (pending)
    throw errors.conflict(
      "STAFF_APPLICATION_EXISTS",
      MESSAGES.applicationDuplicate
    );
  await StaffApplication.create({
    name: input.name,
    email: input.email,
    phone: input.phone ?? "",
    position: input.position ?? "",
    team: input.team ?? "",
    suburb: input.suburb ?? "",
    experience: input.experience ?? "",
    message: input.message ?? "",
    status: "Pending",
  });
  await logActivity({
    actor: null,
    action: "staff.application_submitted",
    entityType: "staffApplication",
    entityId: input.email,
    summary: `${input.name} applied to join the team`,
    ip: clientIp(req),
  });
  return {
    status: "Pending",
    message:
      "Thanks — your application is with the Noble team. You’ll get an email as soon as your portal access is approved.",
  };
}
