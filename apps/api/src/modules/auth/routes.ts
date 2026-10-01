import { Router } from "express";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateMeSchema,
} from "@shared/schemas/auth";
import { staffApplicationSchema } from "@shared/schemas/staff-portal";
import { param, parse } from "../../lib/http";
import { authenticate } from "../../middleware/auth";
import { limiter } from "../../middleware/security";
import {
  bootstrapStatus,
  changePassword,
  demoLogin,
  forgotPassword,
  listSessions,
  login,
  logout,
  logoutAll,
  me,
  refresh,
  resetPassword,
  revokeSession,
  signup,
  staffSignup,
  updateMe,
} from "./service";

export function authRouter(): Router {
  const router = Router();
  const signInLimit = limiter({
    windowMs: 15 * 60_000,
    limit: 20,
    message: "Too many sign-in attempts. Wait a few minutes and try again.",
  });
  const setupLimit = limiter({ windowMs: 60 * 60_000, limit: 10 });
  const resetLimit = limiter({
    windowMs: 60 * 60_000,
    limit: 10,
    message: "Too many password reset attempts. Try again later.",
  });
  const refreshLimit = limiter({ windowMs: 60_000, limit: 60 });

  /* Public */
  router.get("/bootstrap", async (_req, res) => {
    res.json(await bootstrapStatus());
  });
  router.post("/signup", setupLimit, async (req, res) => {
    res.status(201).json(await signup(parse(signupSchema, req.body), req, res));
  });
  router.post("/login", signInLimit, async (req, res) => {
    res.json(await login(parse(loginSchema, req.body), req, res));
  });
  router.post("/staff-signup", setupLimit, async (req, res) => {
    res
      .status(202)
      .json(await staffSignup(parse(staffApplicationSchema, req.body), req));
  });
  router.post("/demo", signInLimit, async (req, res) => {
    res.json(await demoLogin(req, res));
  });
  router.post("/refresh", refreshLimit, async (req, res) => {
    await refresh(req, res);
    res.status(204).end();
  });
  router.post("/logout", async (req, res) => {
    await logout(req, res);
    res.status(204).end();
  });
  router.post("/forgot-password", resetLimit, async (req, res) => {
    await forgotPassword(parse(forgotPasswordSchema, req.body), req);
    res.status(202).json({ ok: true });
  });
  router.post("/reset-password", resetLimit, async (req, res) => {
    await resetPassword(parse(resetPasswordSchema, req.body), req);
    res.status(204).end();
  });

  /* Signed in */
  router.get("/me", authenticate, async (req, res) => {
    res.json(await me(req));
  });
  router.patch("/me", authenticate, async (req, res) => {
    res.json(await updateMe(req, parse(updateMeSchema, req.body)));
  });
  router.post(
    "/change-password",
    authenticate,
    resetLimit,
    async (req, res) => {
      await changePassword(req, res, parse(changePasswordSchema, req.body));
      res.status(204).end();
    }
  );
  router.post("/logout-all", authenticate, async (req, res) => {
    await logoutAll(req, res);
    res.status(204).end();
  });
  router.get("/sessions", authenticate, async (req, res) => {
    res.json(await listSessions(req));
  });
  router.delete("/sessions/:id", authenticate, async (req, res) => {
    await revokeSession(req, param(req, "id"));
    res.status(204).end();
  });
  return router;
}
