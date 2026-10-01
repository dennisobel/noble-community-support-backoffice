import { Router, type Request } from "express";
import {
  shiftCreateSchema,
  shiftListQuery,
  shiftStatusSchema,
  shiftUpdateSchema,
} from "@shared/schemas/roster";
import { shiftId as shiftIdSchema } from "@shared/schemas/common";
import { ctx, parse } from "../../lib/http";
import { codeParam } from "../../lib/mappers";
import { z } from "zod";
import {
  changeShiftStatus,
  createRecordsFromShift,
  createShift,
  deleteShift,
  getShiftDoc,
  listShifts,
  shiftsToDTOs,
  updateShift,
  validateShift,
} from "./service";

const shiftId = (req: Request) => codeParam(req, "SH", "Shift");
const validateBody = shiftCreateSchema.extend({ id: shiftIdSchema.optional() });

export function rosterRouter(): Router {
  const router = Router();
  router.get("/shifts", async (req, res) => {
    res.json(await listShifts(parse(shiftListQuery, req.query)));
  });
  router.post("/shifts", async (req, res) => {
    res
      .status(201)
      .json(await createShift(parse(shiftCreateSchema, req.body), ctx(req)));
  });
  router.post("/shifts/validate", async (req, res) => {
    const input: z.output<typeof validateBody> = parse(validateBody, req.body);
    res.json(await validateShift(input, input.id));
  });
  router.get("/shifts/:id", async (req, res) => {
    res.json((await shiftsToDTOs([await getShiftDoc(shiftId(req))]))[0]);
  });
  router.patch("/shifts/:id", async (req, res) => {
    res.json(
      await updateShift(
        shiftId(req),
        parse(shiftUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/shifts/:id/status", async (req, res) => {
    res.json(
      await changeShiftStatus(
        shiftId(req),
        parse(shiftStatusSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/shifts/:id", async (req, res) => {
    await deleteShift(shiftId(req), ctx(req));
    res.status(204).end();
  });
  router.post("/shifts/:id/create-records", async (req, res) => {
    res.status(201).json(await createRecordsFromShift(shiftId(req), ctx(req)));
  });
  return router;
}
