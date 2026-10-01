import { Router, type Request } from "express";
import {
  budgetAdjustSchema,
  budgetPlanSchema,
  budgetSetupSchema,
} from "@shared/schemas/budgets";
import { ctx, parse } from "../../lib/http";
import { objectIdParam } from "../../lib/mappers";
import {
  adjustAllocation,
  budgetOverview,
  getBudget,
  listAdjustments,
  renewBudget,
  setupBudget,
  updatePlanWindow,
} from "./service";

const clientId = (req: Request) => objectIdParam(req, "id", "Participant");

/** Mounted at the API root: budgets live under each participant, plus an overview. */
export function budgetsRouter(): Router {
  const router = Router();
  router.get("/budgets/overview", async (_req, res) => {
    res.json(await budgetOverview());
  });
  router.get("/participants/:id/budget", async (req, res) => {
    res.json(await getBudget(clientId(req)));
  });
  router.put("/participants/:id/budget", async (req, res) => {
    res
      .status(201)
      .json(
        await setupBudget(
          clientId(req),
          parse(budgetSetupSchema, req.body),
          ctx(req)
        )
      );
  });
  router.post("/participants/:id/budget/adjustments", async (req, res) => {
    res.json(
      await adjustAllocation(
        clientId(req),
        parse(budgetAdjustSchema, req.body),
        ctx(req)
      )
    );
  });
  router.get("/participants/:id/budget/adjustments", async (req, res) => {
    res.json(await listAdjustments(clientId(req)));
  });
  router.patch("/participants/:id/budget/plan", async (req, res) => {
    res.json(
      await updatePlanWindow(
        clientId(req),
        parse(budgetPlanSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/participants/:id/budget/renew", async (req, res) => {
    res
      .status(201)
      .json(
        await renewBudget(
          clientId(req),
          parse(budgetSetupSchema, req.body),
          ctx(req)
        )
      );
  });
  return router;
}
