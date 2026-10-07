import { Router, type Request } from "express";
import {
  feedbackActionPatchSchema,
  feedbackActionSchema,
  feedbackCreateSchema,
  feedbackFormSchema,
  feedbackListQuery,
  feedbackNoteSchema,
  feedbackStatusSchema,
  feedbackTokenParam,
  feedbackUpdateSchema,
  publicFeedbackSchema,
} from "@shared/schemas/feedback";
import { clientIp, ctx, parse } from "../../lib/http";
import { codeParam, objectIdParam } from "../../lib/mappers";
import { limiter } from "../../middleware/security";
import {
  addFeedbackAction,
  addFeedbackNote,
  createFeedback,
  feedbackOptions,
  getFeedback,
  listFeedback,
  publicFeedbackForm,
  removeFeedbackAction,
  setFeedbackForm,
  setFeedbackStatus,
  submitPublicFeedback,
  updateFeedback,
  updateFeedbackAction,
} from "./service";

const caseId = (req: Request) => codeParam(req, "FB", "Feedback");

/** The complaints and feedback register. */
export function feedbackRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listFeedback(parse(feedbackListQuery, req.query)));
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(await createFeedback(parse(feedbackCreateSchema, req.body), ctx(req)));
  });
  /* Declared before /:id so neither word is read as a case number. */
  router.get("/options", async (_req, res) => {
    res.json(await feedbackOptions());
  });
  router.put("/form", async (req, res) => {
    res.json(
      await setFeedbackForm(parse(feedbackFormSchema, req.body), ctx(req))
    );
  });

  router.get("/:id", async (req, res) => {
    res.json(await getFeedback(caseId(req)));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateFeedback(
        caseId(req),
        parse(feedbackUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/status", async (req, res) => {
    res.json(
      await setFeedbackStatus(
        caseId(req),
        parse(feedbackStatusSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/notes", async (req, res) => {
    res
      .status(201)
      .json(
        await addFeedbackNote(
          caseId(req),
          parse(feedbackNoteSchema, req.body).note,
          ctx(req)
        )
      );
  });
  router.post("/:id/actions", async (req, res) => {
    res
      .status(201)
      .json(
        await addFeedbackAction(
          caseId(req),
          parse(feedbackActionSchema, req.body),
          ctx(req)
        )
      );
  });
  router.patch("/:id/actions/:actionId", async (req, res) => {
    res.json(
      await updateFeedbackAction(
        caseId(req),
        objectIdParam(req, "actionId", "Action"),
        parse(feedbackActionPatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/:id/actions/:actionId", async (req, res) => {
    res.json(
      await removeFeedbackAction(
        caseId(req),
        objectIdParam(req, "actionId", "Action")
      )
    );
  });
  return router;
}

/**
 * The public feedback form. No session: the token in the link shows the form is the one the
 * office published, and turning the form off (or issuing a new link) stops the old one. It
 * can only add a case to the register; nothing can be read back through it. Submissions are
 * limited per address so the register cannot be flooded.
 */
export function publicFeedbackRouter(): Router {
  const router = Router();
  const read = limiter({
    windowMs: 60_000,
    limit: 60,
    message: "Too many requests. Wait a moment and try again.",
  });
  const write = limiter({
    windowMs: 60 * 60_000,
    limit: 8,
    message: "That is a lot of feedback in one hour. Please try again later.",
  });
  router.use("/feedback", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });
  router.get("/feedback/:token", read, async (req, res) => {
    res.json(
      await publicFeedbackForm(parse(feedbackTokenParam, req.params.token))
    );
  });
  router.post("/feedback/:token", write, async (req, res) => {
    res
      .status(201)
      .json(
        await submitPublicFeedback(
          parse(feedbackTokenParam, req.params.token),
          parse(publicFeedbackSchema, req.body ?? {}),
          clientIp(req)
        )
      );
  });
  return router;
}
