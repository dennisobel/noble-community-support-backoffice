import { Router, type Request } from "express";
import {
  billablesAdjustSchema,
  recordCountsQuery,
  recordCreateSchema,
  recordListQuery,
  recordReturnSchema,
  recordUpdateSchema,
} from "@shared/schemas/records";
import { revOnly } from "@shared/schemas/common";
import { ctx, parse } from "../../lib/http";
import { codeParam } from "../../lib/mappers";
import {
  adjustBillables,
  approveRecord,
  countRecords,
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  returnRecord,
  submitRecord,
  updateRecord,
} from "./service";

const recordId = (req: Request) => codeParam(req, "SR", "Service record");

export function recordsRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listRecords(parse(recordListQuery, req.query)));
  });
  router.get("/counts", async (req, res) => {
    res.json(await countRecords(parse(recordCountsQuery, req.query).clientId));
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(await createRecord(parse(recordCreateSchema, req.body), ctx(req)));
  });
  router.get("/:id", async (req, res) => {
    res.json(await getRecord(recordId(req)));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateRecord(
        recordId(req),
        parse(recordUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/:id", async (req, res) => {
    await deleteRecord(recordId(req), ctx(req));
    res.status(204).end();
  });
  router.post("/:id/submit", async (req, res) => {
    res.json(
      await submitRecord(
        recordId(req),
        parse(revOnly, req.body ?? {}).rev,
        ctx(req)
      )
    );
  });
  router.post("/:id/approve", async (req, res) => {
    res.json(
      await approveRecord(
        recordId(req),
        parse(revOnly, req.body ?? {}).rev,
        ctx(req)
      )
    );
  });
  router.post("/:id/return", async (req, res) => {
    res.json(
      await returnRecord(
        recordId(req),
        parse(recordReturnSchema, req.body),
        ctx(req)
      )
    );
  });
  router.patch("/:id/billables", async (req, res) => {
    res.json(
      await adjustBillables(
        recordId(req),
        parse(billablesAdjustSchema, req.body),
        ctx(req)
      )
    );
  });
  return router;
}
