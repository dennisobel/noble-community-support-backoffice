import { Router } from "express";
import {
  approveUserSchema,
  declineUserSchema,
  updateUserAccessSchema,
} from "@shared/schemas/access";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import {
  approveUser,
  declineUser,
  listAccessUsers,
  updateUserAccess,
} from "./service";

/** Admin only (nothing here is in the module access table, so it is denied to everyone else). */
export function usersRouter(): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    res.json(await listAccessUsers());
  });
  router.post("/:id/approve", async (req, res) => {
    res.json(
      await approveUser(
        objectIdParam(req, "id", "User"),
        parse(approveUserSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/decline", async (req, res) => {
    res.json(
      await declineUser(
        objectIdParam(req, "id", "User"),
        parse(declineUserSchema, req.body ?? {}),
        ctx(req)
      )
    );
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateUserAccess(
        objectIdParam(req, "id", "User"),
        parse(updateUserAccessSchema, req.body),
        ctx(req)
      )
    );
  });
  return router;
}
