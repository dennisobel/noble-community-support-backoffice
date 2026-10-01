import { Router, type Request } from "express";
import { revOnly } from "@shared/schemas/common";
import {
  invoiceCreateSchema,
  invoiceListQuery,
  invoiceMarkPaidSchema,
  invoiceMarkSentSchema,
  invoiceUpdateSchema,
  invoiceVoidSchema,
} from "@shared/schemas/invoices";
import { contentDisposition, ctx, parse } from "../../lib/http";
import { codeParam } from "../../lib/mappers";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  invoicePdf,
  invoiceSummary,
  listInvoices,
  markPaid,
  markReady,
  markSent,
  updateDraftInvoice,
  voidInvoice,
} from "./service";

const invoiceId = (req: Request) => codeParam(req, "INV", "Invoice");

export function invoicesRouter(): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    res.json(await listInvoices(parse(invoiceListQuery, req.query)));
  });
  router.get("/summary", async (_req, res) => {
    res.json(await invoiceSummary());
  });
  router.post("/", async (req, res) => {
    res
      .status(201)
      .json(
        await createInvoice(parse(invoiceCreateSchema, req.body), ctx(req))
      );
  });
  router.get("/:id", async (req, res) => {
    res.json(await getInvoice(invoiceId(req)));
  });
  router.patch("/:id", async (req, res) => {
    res.json(
      await updateDraftInvoice(
        invoiceId(req),
        parse(invoiceUpdateSchema, req.body),
        ctx(req)
      )
    );
  });
  router.get("/:id/pdf", async (req, res) => {
    const { filename, buffer } = await invoicePdf(invoiceId(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      contentDisposition(req.query.download ? "attachment" : "inline", filename)
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  });
  router.post("/:id/mark-ready", async (req, res) => {
    res.json(
      await markReady(
        invoiceId(req),
        parse(revOnly, req.body ?? {}).rev,
        ctx(req)
      )
    );
  });
  router.post("/:id/mark-sent", async (req, res) => {
    res.json(
      await markSent(
        invoiceId(req),
        parse(invoiceMarkSentSchema, req.body ?? {}),
        ctx(req)
      )
    );
  });
  router.post("/:id/mark-paid", async (req, res) => {
    res.json(
      await markPaid(
        invoiceId(req),
        parse(invoiceMarkPaidSchema, req.body),
        ctx(req)
      )
    );
  });
  router.post("/:id/void", async (req, res) => {
    res.json(
      await voidInvoice(
        invoiceId(req),
        parse(invoiceVoidSchema, req.body),
        ctx(req)
      )
    );
  });
  router.delete("/:id", async (req, res) => {
    await deleteInvoice(invoiceId(req), ctx(req));
    res.status(204).end();
  });
  return router;
}
