import { Router } from "express";
import {
  signDeclineSchema,
  signSubmitSchema,
  signTokenParam,
} from "@shared/schemas/signatures";
import { parse } from "../../lib/http";
import { sendStoredFile } from "../../lib/send-file";
import { limiter } from "../../middleware/security";
import { clientMeta } from "./shared";
import {
  declineSigning,
  publicSigning,
  publicSigningFile,
  submitSigning,
} from "./signing";

/**
 * Documents opened from a signing link. No session is involved: the long random token in the URL is
 * the only credential, the same way the invoice share link works, and each link belongs to one
 * signer. The endpoints are narrow (read this document, sign it, decline it), rate limited so a
 * token cannot be found by guessing, and told not to be cached or indexed.
 */
export function publicSigningRouter(): Router {
  const router = Router();
  const read = limiter({
    windowMs: 60_000,
    limit: 90,
    message: "Too many requests. Wait a moment and try again.",
  });
  const write = limiter({
    windowMs: 60_000,
    limit: 12,
    message: "Too many attempts. Wait a minute and try again.",
  });

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  router.get("/sign/:token", read, async (req, res) => {
    const token = parse(signTokenParam, req.params.token);
    res.json(await publicSigning(token, clientMeta(req)));
  });

  router.get("/sign/:token/pdf", read, async (req, res) => {
    const token = parse(signTokenParam, req.params.token);
    await sendStoredFile(
      res,
      await publicSigningFile(token),
      req.query.download === undefined ? "inline" : "attachment"
    );
  });

  router.post("/sign/:token/submit", write, async (req, res) => {
    const token = parse(signTokenParam, req.params.token);
    res.json(
      await submitSigning(
        token,
        parse(signSubmitSchema, req.body ?? {}),
        clientMeta(req)
      )
    );
  });

  router.post("/sign/:token/decline", write, async (req, res) => {
    const token = parse(signTokenParam, req.params.token);
    res.json(
      await declineSigning(
        token,
        parse(signDeclineSchema, req.body ?? {}),
        clientMeta(req)
      )
    );
  });

  return router;
}
