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
import {
  availabilitySchema,
  leaveDecisionSchema,
  leaveListQuery,
  officeLeaveCreateSchema,
} from "@shared/schemas/workforce";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import { staffCompliance, reviewChecklistItem } from "../portal/service";
import { getAvailability, setAvailability } from "./availability";
import { cancelLeave, decideLeave, listLeave, requestLeave } from "./leave";
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

  /* Leave and time off across the team (declared before /:id). */
  router.get("/leave", async (req, res) => {
    res.json(await listLeave(parse(leaveListQuery, req.query)));
  });
  router.post("/leave", async (req, res) => {
    const { staffId, approve, ...input } = parse(
      officeLeaveCreateSchema,
      req.body
    );
    res
      .status(201)
      .json(
        await requestLeave(staffId, input, ctx(req), { office: true, approve })
      );
  });
  router.post("/leave/:id/decision", async (req, res) => {
    res.json(
      await decideLeave(
        objectIdParam(req, "id", "Leave request"),
        parse(leaveDecisionSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/leave/:id/cancel", async (req, res) => {
    res.json(
      await cancelLeave(objectIdParam(req, "id", "Leave request"), ctx(req))
    );
  });

  router.get("/:id", async (req, res) => {
    res.json(await getStaff(objectIdParam(req, "id", "Team member")));
  });
  router.get("/:id/availability", async (req, res) => {
    res.json(await getAvailability(objectIdParam(req, "id", "Team member")));
  });
  router.put("/:id/availability", async (req, res) => {
    res.json(
      await setAvailability(
        objectIdParam(req, "id", "Team member"),
        parse(availabilitySchema, req.body),
        ctx(req)
      )
    );
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
