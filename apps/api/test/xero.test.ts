/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config, setConfig } from "../src/config";
import { drainJobs } from "../src/lib/jobs";
import { Invoice, XERO_CONNECTION_ID, XeroConnection } from "../src/models";
import { setXeroFetch } from "../src/modules/xero/client";
import { enqueueXeroPoll } from "../src/modules/xero/service";
import { API, signedInAgent, startTestApp, stopTestApp } from "./helpers";
import {
  approvedRecord,
  createParticipant,
  createService,
  createStaff,
} from "./fixtures";

/** A small stand-in for Xero: enough of the identity, connections and accounting endpoints to run the real code against. */
function fakeXero() {
  const calls: Array<{
    method: string;
    url: URL;
    headers: Record<string, string>;
    body: any;
  }> = [];
  const invoices = new Map<string, any>();
  const contacts: Array<{ ContactID: string; Name: string }> = [];
  let refreshSeq = 0;
  let rejectNextInvoice: string | null = null;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const jwt = (payload: object) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

  const handle = async (
    input: string,
    init: RequestInit = {}
  ): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(
        ([key, value]) => [key.toLowerCase(), value]
      )
    );
    const raw = typeof init.body === "string" ? init.body : "";
    const body = headers["content-type"]?.includes("json") && raw ? JSON.parse(raw) : raw;
    calls.push({ method, url, headers, body });
    const path = url.pathname.replace("/api.xro/2.0", "");

    if (url.host === "identity.xero.com") {
      const form = new URLSearchParams(raw);
      if (
        form.get("grant_type") === "refresh_token" &&
        form.get("refresh_token") !== `refresh-${refreshSeq}`
      )
        return json(400, { error: "invalid_grant" });
      refreshSeq += 1;
      return json(200, {
        access_token: jwt({ authentication_event_id: "event-1" }),
        refresh_token: `refresh-${refreshSeq}`,
        expires_in: 1800,
      });
    }
    if (url.pathname === "/connections")
      return json(200, [
        {
          id: "connection-1",
          tenantId: "tenant-1",
          tenantType: "ORGANISATION",
          tenantName: "Noble Demo Pty Ltd",
        },
      ]);
    if (headers["xero-tenant-id"] !== "tenant-1")
      return json(403, { Detail: "AuthenticationUnsuccessful" });

    if (path === "/Organisation")
      return json(200, {
        Organisations: [{ Name: "Noble Demo Pty Ltd", ShortCode: "!ABC12" }],
      });
    if (path === "/Accounts")
      return json(200, {
        Accounts: [
          { Code: "200", Name: "Sales", Type: "REVENUE", Class: "REVENUE", Status: "ACTIVE" },
          { Code: "090", Name: "Business Bank Account", Type: "BANK", Class: "ASSET", Status: "ACTIVE" },
          { Code: "400", Name: "Advertising", Type: "EXPENSE", Class: "EXPENSE", Status: "ACTIVE" },
        ],
      });
    if (path === "/TaxRates")
      return json(200, {
        TaxRates: [
          { Name: "GST Free Income", TaxType: "EXEMPTOUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 0 },
          { Name: "GST on Income", TaxType: "OUTPUT", Status: "ACTIVE", CanApplyToRevenue: true, EffectiveRate: 10 },
          { Name: "GST on Expenses", TaxType: "INPUT", Status: "ACTIVE", CanApplyToRevenue: false, EffectiveRate: 10 },
        ],
      });
    if (path === "/Contacts" && method === "GET") {
      const term = (url.searchParams.get("searchTerm") ?? "").toLowerCase();
      return json(200, {
        Contacts: contacts.filter(c => c.Name.toLowerCase().includes(term)),
      });
    }
    if (path === "/Contacts" && method === "PUT") {
      const made = {
        ContactID: `contact-${contacts.length + 1}`,
        Name: body.Contacts[0].Name,
      };
      contacts.push(made);
      return json(200, { Contacts: [made] });
    }
    if (path === "/Invoices" && method === "PUT") {
      const sent = body.Invoices[0];
      if (rejectNextInvoice) {
        const message = rejectNextInvoice;
        rejectNextInvoice = null;
        return json(400, {
          Type: "ValidationException",
          Message: "A validation exception occurred",
          Elements: [{ ValidationErrors: [{ Message: message }] }],
        });
      }
      if ([...invoices.values()].some(i => i.InvoiceNumber === sent.InvoiceNumber))
        return json(400, {
          Elements: [{ ValidationErrors: [{ Message: "Invoice # must be unique." }] }],
        });
      const total = Math.round(
        sent.LineItems.reduce((sum: number, line: any) => sum + line.Quantity * line.UnitAmount, 0) * 100
      ) / 100;
      const made = {
        InvoiceID: `xero-${invoices.size + 1}`,
        InvoiceNumber: sent.InvoiceNumber,
        Type: "ACCREC",
        Status: sent.Status,
        Total: total,
        AmountDue: total,
        AmountPaid: 0,
      };
      invoices.set(made.InvoiceID, made);
      return json(200, { Invoices: [made] });
    }
    if (path === "/Invoices" && method === "GET") {
      const ids = url.searchParams.get("IDs")?.split(",") ?? [];
      const numbers = url.searchParams.get("InvoiceNumbers")?.split(",") ?? [];
      return json(200, {
        Invoices: [...invoices.values()].filter(
          i => ids.includes(i.InvoiceID) || numbers.includes(i.InvoiceNumber)
        ),
      });
    }
    const one = /^\/Invoices\/([^/]+)$/.exec(path);
    if (one) {
      const found = invoices.get(decodeURIComponent(one[1]!));
      if (!found) return json(404, { Message: "not found" });
      if (method === "POST") found.Status = body.Invoices[0].Status;
      return json(200, { Invoices: [found] });
    }
    if (path === "/Payments" && method === "PUT") {
      Object.assign(invoices.get(body.Invoice.InvoiceID), {
        Status: "PAID",
        AmountPaid: body.Amount,
        AmountDue: 0,
      });
      return json(200, { Payments: [{ PaymentID: `payment-${calls.length}` }] });
    }
    return json(404, { Message: `Unhandled ${method} ${path}` });
  };

  return {
    calls,
    invoices,
    contacts,
    install: () => setXeroFetch(handle),
    rejectNext: (message: string) => {
      rejectNextInvoice = message;
    },
    /** Someone else used the refresh token, so ours is no longer good. */
    revokeRefresh: () => {
      refreshSeq += 1;
    },
    /** The bank feed matched a payment to the invoice inside Xero. */
    reconcile(xeroId: string, on: string, reference: string) {
      const ms = Date.parse(`${on}T00:00:00Z`);
      const found = invoices.get(xeroId);
      Object.assign(found, {
        Status: "PAID",
        AmountPaid: found.Total,
        AmountDue: 0,
        FullyPaidOnDate: `/Date(${ms}+0000)/`,
        Payments: [{ PaymentID: "bank-1", Date: `/Date(${ms}+0000)/`, Reference: reference }],
      });
    },
    count: (method: string, suffix: string) =>
      calls.filter(c => c.method === method && c.url.pathname.endsWith(suffix)).length,
    identityCalls: () => calls.filter(c => c.url.host === "identity.xero.com").length,
  };
}

const xero = fakeXero();
let app: Express;
let agent: request.Agent;
let ids: { clientId: string; staffId: string; serviceId: string };

beforeAll(async () => {
  app = await startTestApp();
  agent = await signedInAgent(app);
  const [service, staff, participant] = await Promise.all([
    createService(agent),
    createStaff(agent, { name: "Jordan Lee" }),
    createParticipant(agent),
  ]);
  ids = { clientId: participant.id, staffId: staff.id, serviceId: service.id };
  setConfig({
    ...config(),
    xero: {
      ...config().xero,
      clientId: "client-id",
      clientSecret: "client-secret",
      configured: true,
    },
  });
  xero.install();
});
afterAll(async () => {
  setXeroFetch(null);
  await stopTestApp();
});

async function newInvoice() {
  const record = await approvedRecord(agent, ids);
  const created = await agent
    .post(`${API}/invoices`)
    .send({ clientId: ids.clientId, recordIds: [record.id] });
  expect(created.status).toBe(201);
  return created.body as { id: string; rev: number; total: number };
}
const read = async (id: string) =>
  (await agent.get(`${API}/invoices/${id}`)).body;
// Read the revision before building the request: supertest's server is tied to the request object.
const revOf = async (id: string): Promise<number> => (await read(id)).rev;
async function markSent(id: string) {
  const rev = await revOf(id);
  const response = await agent
    .post(`${API}/invoices/${id}/mark-sent`)
    .send({ rev });
  expect(response.status).toBe(200);
}
const xeroIdOf = async (id: string) =>
  (await Invoice.findById(id).lean())!.xero!.invoiceId!;

describe("Xero integration", () => {
  it("connects through the sign-in redirect and suggests sensible defaults", async () => {
    const begin = await agent.post(`${API}/integrations/xero/connect`).send({});
    expect(begin.status).toBe(200);
    const url = new URL(begin.body.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.xero.com/identity/connect/authorize"
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toContain("accounting.invoices");
    const state = url.searchParams.get("state")!;

    // Xero sends the browser back with no session cookie: the one-time state is the credential.
    const back = await request(app)
      .get(`${API}/integrations/xero/callback`)
      .query({ code: "abc", state });
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe(
      "http://localhost:3000/app/settings/accounting?xero=connected"
    );
    const replay = await request(app)
      .get(`${API}/integrations/xero/callback`)
      .query({ code: "abc", state });
    expect(replay.headers.location).toContain("xero=error");

    const status = await agent.get(`${API}/integrations/xero/status`);
    expect(status.body).toMatchObject({
      connected: true,
      orgName: "Noble Demo Pty Ltd",
      ready: true,
      settings: {
        salesAccountCode: "200",
        taxTypeGstFree: "EXEMPTOUTPUT",
        taxTypeTaxable: "OUTPUT",
        paymentAccountCode: "",
      },
    });
    // Tokens are sealed in the database and never sent to the browser.
    const stored = await XeroConnection.findById(XERO_CONNECTION_ID).lean();
    expect(stored?.refreshTokenSealed.startsWith("v1.")).toBe(true);
    expect(stored?.refreshTokenSealed).not.toContain("refresh-1");
    expect(JSON.stringify(status.body)).not.toContain("refresh-1");
    expect((await agent.get(`${API}/meta`)).body.features.xero).toBe(true);
  });

  it("sends a sent invoice to Xero once and reuses the payer's contact", async () => {
    const first = await newInvoice();
    await markSent(first.id);
    expect((await read(first.id)).xero.state).toBe("queued");
    await drainJobs();

    const synced = await read(first.id);
    expect(synced.xero).toMatchObject({ state: "synced", message: "" });
    expect(synced.xero.url).toContain("shortcode=");
    const put = xero.calls.find(
      c => c.method === "PUT" && c.url.pathname.endsWith("/Invoices")
    )!;
    expect(put.body.Invoices[0]).toMatchObject({
      Type: "ACCREC",
      InvoiceNumber: first.id,
      Status: "AUTHORISED",
      LineAmountTypes: "Exclusive",
      CurrencyCode: "AUD",
    });
    expect(put.body.Invoices[0].LineItems[0]).toMatchObject({
      AccountCode: "200",
      TaxType: "EXEMPTOUTPUT",
    });
    expect(put.headers["idempotency-key"]).toBe(`noble-${first.id}`);
    expect(put.headers["xero-tenant-id"]).toBe("tenant-1");

    const second = await newInvoice();
    await markSent(second.id);
    await drainJobs();
    expect(xero.contacts).toHaveLength(1);
    expect(xero.contacts[0]!.Name).toBe("Bright Path Plan Management");
    expect((await read(second.id)).xero.state).toBe("synced");
  });

  it("leaves invoices sent before the connection alone until someone chooses Send to Xero", async () => {
    const invoice = await newInvoice();
    const connected = (await XeroConnection.findById(XERO_CONNECTION_ID).lean())!
      .connectedAt;
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      { $set: { connectedAt: new Date(Date.now() + 60_000) } }
    );
    await markSent(invoice.id);
    await drainJobs();
    expect((await read(invoice.id)).xero.state).toBe("none");
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      { $set: { connectedAt: connected } }
    );

    const send = await agent
      .post(`${API}/integrations/xero/invoices/${invoice.id}/sync`)
      .send({});
    expect(send.status).toBe(200);
    await drainJobs();
    expect((await read(invoice.id)).xero.state).toBe("synced");
  });

  it("marks the invoice paid when Xero reports the payment, without pushing a payment back", async () => {
    const invoice = await newInvoice();
    await markSent(invoice.id);
    await drainJobs();
    xero.reconcile(await xeroIdOf(invoice.id), "2026-03-05", "Bank feed ref");

    expect(await enqueueXeroPoll()).toBe(true);
    await drainJobs();
    const paid = await read(invoice.id);
    expect(paid).toMatchObject({
      status: "Paid",
      paidOn: "2026-03-05",
      paidReference: "Bank feed ref",
    });
    expect(paid.history.at(-1)).toMatchObject({ action: "paid", by: null });
    expect(paid.xero.state).toBe("synced");
    expect(xero.count("PUT", "/Payments")).toBe(0);
  });

  it("shows Xero's refusal on the invoice, then succeeds on retry without duplicating", async () => {
    const invoice = await newInvoice();
    xero.rejectNext("Account code '200' has been archived.");
    await markSent(invoice.id);
    await drainJobs();
    expect((await read(invoice.id)).xero).toMatchObject({
      state: "error",
      message: "Account code '200' has been archived.",
    });

    const retry = await agent
      .post(`${API}/integrations/xero/invoices/${invoice.id}/sync`)
      .send({});
    expect(retry.status).toBe(200);
    await drainJobs();
    expect((await read(invoice.id)).xero.state).toBe("synced");
    expect(
      [...xero.invoices.values()].filter(i => i.InvoiceNumber === invoice.id)
    ).toHaveLength(1);
  });

  it("records a manual payment in Xero only once a bank account is chosen", async () => {
    const invoice = await newInvoice();
    await markSent(invoice.id);
    await drainJobs();

    const rev = await revOf(invoice.id);
    const paid = await agent
      .post(`${API}/invoices/${invoice.id}/mark-paid`)
      .send({ paidOn: "2026-03-06", reference: "Cash", rev });
    expect(paid.status).toBe(200);
    await drainJobs();
    const waiting = await read(invoice.id);
    expect(waiting.status).toBe("Paid");
    expect(waiting.xero.state).toBe("error");
    expect(waiting.xero.message).toContain("bank account");
    expect(xero.count("PUT", "/Payments")).toBe(0);

    const saved = await agent.put(`${API}/integrations/xero/settings`).send({
      salesAccountCode: "200",
      taxTypeGstFree: "EXEMPTOUTPUT",
      taxTypeTaxable: "OUTPUT",
      paymentAccountCode: "090",
    });
    expect(saved.status).toBe(200);
    await agent
      .post(`${API}/integrations/xero/invoices/${invoice.id}/sync`)
      .send({});
    await drainJobs();
    expect(xero.count("PUT", "/Payments")).toBe(1);
    const payment = xero.calls.find(c => c.url.pathname.endsWith("/Payments"))!;
    expect(payment.body).toMatchObject({
      Account: { Code: "090" },
      Date: "2026-03-06",
      Reference: "Cash",
    });
    expect(payment.body.Amount).toBeCloseTo(invoice.total, 2);
    expect((await read(invoice.id)).xero.state).toBe("synced");
  });

  it("voids in Xero, and never sends an invoice that was voided before it was sent", async () => {
    const sent = await newInvoice();
    await markSent(sent.id);
    await drainJobs();
    const sentRev = await revOf(sent.id);
    const voided = await agent
      .post(`${API}/invoices/${sent.id}/void`)
      .send({ reason: "Raised in error", rev: sentRev });
    expect(voided.status).toBe(200);
    await drainJobs();
    expect(xero.invoices.get(await xeroIdOf(sent.id))!.Status).toBe("VOIDED");

    const draft = await newInvoice();
    const ready = await agent
      .post(`${API}/invoices/${draft.id}/mark-ready`)
      .send({ rev: draft.rev });
    const before = xero.count("PUT", "/Invoices");
    await agent
      .post(`${API}/invoices/${draft.id}/void`)
      .send({ reason: "Not needed", rev: ready.body.rev });
    await drainJobs();
    expect(xero.count("PUT", "/Invoices")).toBe(before);
    expect((await read(draft.id)).xero.state).toBe("none");
  });

  it("refreshes an expired access token once, however many requests are waiting", async () => {
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      { $set: { accessTokenExpiresAt: new Date(Date.now() - 1000) } }
    );
    const before = xero.identityCalls();
    const [a, b] = await Promise.all([
      agent.get(`${API}/integrations/xero/options`),
      agent.get(`${API}/integrations/xero/options`),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.salesAccounts).toEqual([{ code: "200", name: "Sales" }]);
    expect(a.body.bankAccounts).toEqual([{ code: "090", name: "Business Bank Account" }]);
    expect(a.body.taxRates.map((rate: any) => rate.type)).toEqual(["EXEMPTOUTPUT", "OUTPUT"]);
    expect(xero.identityCalls() - before).toBe(1);
  });

  it("asks for a reconnect when Xero stops honouring the saved sign-in", async () => {
    xero.revokeRefresh();
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      { $set: { accessTokenExpiresAt: new Date(Date.now() - 1000) } }
    );
    const options = await agent.get(`${API}/integrations/xero/options`);
    expect(options.status).toBe(409);
    expect(options.body.error.message).toContain("Reconnect");
    expect((await agent.get(`${API}/integrations/xero/status`)).body).toMatchObject({
      connected: false,
      needsReconnect: true,
    });

    const invoice = await newInvoice();
    await markSent(invoice.id);
    const after = await read(invoice.id);
    expect(after.status).toBe("Sent");
    expect(after.xero).toMatchObject({ state: "error" });
    expect(after.xero.message).toContain("reconnected");
  });
});
