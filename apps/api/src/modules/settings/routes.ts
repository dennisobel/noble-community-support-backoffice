import { Router } from "express";
import {
  preferencesPatchSchema,
  workspacePatchSchema,
} from "@shared/schemas/settings";
import { ctx, parse, requireAuth } from "../../lib/http";
import {
  getPreferences,
  getWorkspaceSettings,
  updatePreferences,
  updateWorkspaceSettings,
} from "./service";

export function settingsRouter(): Router {
  const router = Router();
  router.get("/workspace", async (_req, res) => {
    res.json(await getWorkspaceSettings());
  });
  router.patch("/workspace", async (req, res) => {
    res.json(
      await updateWorkspaceSettings(
        parse(workspacePatchSchema, req.body),
        ctx(req)
      )
    );
  });
  router.get("/preferences", async (req, res) => {
    res.json(await getPreferences(requireAuth(req).user.id));
  });
  router.patch("/preferences", async (req, res) => {
    res.json(
      await updatePreferences(
        requireAuth(req).user.id,
        parse(preferencesPatchSchema, req.body)
      )
    );
  });
  return router;
}
