import { Router } from "express";
import { shareTokenParam } from "@shared/schemas/invoices";
import { contentDisposition, parse } from "../../lib/http";
import { limiter } from "../../middleware/security";
import { invoiceByShareToken, publicInvoice } from "./service";
import { renderInvoicePdf } from "./pdf";

/**
 * Invoices opened from a share link. No session is involved: the long random token in the URL
 * is the only credential, exactly as it works for the "view online" link on a Xero invoice.
 *
 * Deliberately narrow — it reads one invoice and renders its PDF, nothing else. The responses
 * are told not to be cached by shared proxies, and the endpoint is rate limited so a token
 * cannot be searched for by brute force.
 */
export function publicInvoicesRouter(): Router {
  const router = Router();
  const guard = limiter({
    windowMs: 60_000,
    limit: 60,
    message: "Too many requests. Wait a moment and try again.",
  });

  router.get("/invoices/:token", guard, async (req, res) => {
    const token = parse(shareTokenParam, req.params.token);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json(await publicInvoice(token));
  });

  router.get("/invoices/:token/pdf", guard, async (req, res) => {
    const token = parse(shareTokenParam, req.params.token);
    const invoice = await invoiceByShareToken(token);
    const buffer = await renderInvoicePdf(invoice);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      contentDisposition(
        req.query.download === undefined ? "inline" : "attachment",
        `${invoice._id}.pdf`
      )
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.send(buffer);
  });

  return router;
}
