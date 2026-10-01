import { Router } from "express";
import {
  staffCreateSchema,
  staffListQuery,
  staffUpdateSchema,
} from "@shared/schemas/staff";
import {
  applicationReviewSchema,
  checklistReviewSchema,
  staffInviteSchema,
} from "@shared/schemas/staff-portal";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { staffCompliance, reviewChecklistItem } from "../portal/service";
import {
  createStaff,
  getStaff,
  inviteStaff,
  listApplications,
  listStaff,
  reviewApplication,
  revokeStaffAccess,
  updateStaff,
} from "./service";

export function staffRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listStaff(parse(staffListQuery, req.query)));
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(await createStaff(parse(staffCreateSchema, req.body), ctx(req)));
  });

  /* Applications from workers who signed up themselves (declared before /:id). */
  router.get("/applications", async (req, res) => {
    res.json(await listApplications(req.query.status as string | undefined));
  });
  router.post("/applications/:id/review", async (req, res) => {
    res.json(
      await reviewApplication(
        objectIdParam(req, "id", "Application"),
        parse(applicationReviewSchema, req.body),
        ctx(req)
      )
    );
  });

  router.get("/:id", async (req, res) => {
    res.json(await getStaff(objectIdParam(req, "id", "Team member")));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateStaff(
        objectIdParam(req, "id", "Team member"),
        parse(staffUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/invite", async (req, res) => {
    const id = objectIdParam(req, "id", "Team member");
    parse(staffInviteSchema, req.body ?? {});
    const result = await inviteStaff(id, ctx(req));
    res.status(201).json(result);
  });
  router.post("/:id/revoke-access", async (req, res) => {
    res.json(
      await revokeStaffAccess(objectIdParam(req, "id", "Team member"), ctx(req))
    );
  });
  router.get("/:id/compliance", async (req, res) => {
    res.json(await staffCompliance(objectIdParam(req, "id", "Team member")));
  });
  router.patch("/:id/checklist/:key", async (req, res) => {
    res.json(
      await reviewChecklistItem(
        objectIdParam(req, "id", "Team member"),
        String(req.params.key ?? ""),
        parse(checklistReviewSchema, req.body),
        ctx(req)
      )
    );
  });
  return router;
}
