import type { XeroOptionsDTO, XeroStatusDTO } from "@shared/dto";
import type { XeroSyncState } from "@shared/enums";
import type { XeroSettingsInput } from "@shared/schemas/xero";
import { config } from "../../config";
import { logActivity } from "../../lib/audit";
import { errors, RetryableProviderError } from "../../lib/errors";
import type { RequestContext } from "../../lib/http";
import { enqueueJob, registerJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { historyEntry, iso } from "../../lib/mappers";
import { getWorkspace, workspaceToday } from "../../lib/workspace";
import {
  Invoice,
  Job,
  XERO_CONNECTION_ID,
  XeroConnection,
  type InvoiceDoc,
  type XeroConnectionDoc,
  type XeroSettingsSub,
} from "../../models";
import { randomToken, sha256 } from "../auth/tokens";
import {
  authEventIdOf,
  authorizeUrl,
  dropConnection,
  exchangeCode,
  listConnections,
  organisationFor,
  requireConnection,
  seal,
  tokenExpiry,
  XeroApiError,
  xeroApi,
} from "./client";
import {
  centsOf,
  dollars,
  invoiceUrl,
  latestPayment,
  missingMapping,
  paidOnOf,
  suggestDefaults,
  toXeroContact,
  toXeroInvoice,
  type XeroInvoice,
} from "./mapping";

/*
 * Noble stays the record of what was issued. Xero receives each invoice when it is sent, and
 * tells us when it has been paid. One idempotent job ("converge") makes Xero match Noble for a
 * single invoice, so retries, the Retry button and the 15-minute check can never double-post.
 */

const SIGN_IN_MINUTES = 10;
const STUCK_MINUTES = 15;
const POLL_BATCH = 40;

const emptySettings = (): XeroSettingsSub => ({
  salesAccountCode: "",
  taxTypeGstFree: "",
  taxTypeTaxable: "",
  paymentAccountCode: "",
});

const connectionDoc = () =>
  XeroConnection.findById(XERO_CONNECTION_ID).lean<XeroConnectionDoc>();

/** User-facing endpoints speak AppError; XeroApiError belongs to the sync internals. */
const asAppError = (error: unknown): unknown =>
  error instanceof XeroApiError ? errors.invalidState(error.message) : error;

/** True while a Xero organisation is connected and working. */
export async function xeroConnected(): Promise<boolean> {
  return (
    (await XeroConnection.exists({
      _id: XERO_CONNECTION_ID,
      status: "connected",
    })) !== null
  );
}

/* ───────────── Status, options, settings ───────────── */

export async function xeroStatus(): Promise<XeroStatusDTO> {
  const found = await connectionDoc();
  const connected = found?.status === "connected";
  const settings = {
    salesAccountCode: found?.settings?.salesAccountCode ?? "",
    taxTypeGstFree: found?.settings?.taxTypeGstFree ?? "",
    taxTypeTaxable: found?.settings?.taxTypeTaxable ?? "",
    paymentAccountCode: found?.settings?.paymentAccountCode ?? "",
  };
  return {
    configured: config().xero.configured,
    connected,
    needsReconnect: found?.status === "needs-reconnect",
    orgName: found && found.status !== "disconnected" ? found.orgName : "",
    connectedAt: iso(found?.connectedAt),
    connectedBy: found?.connectedBy ?? "",
    lastPollAt: iso(found?.lastPollAt),
    lastError: found?.lastError ?? "",
    settings,
    redirectUri: config().xero.redirectUri,
    ready: connected && Boolean(settings.salesAccountCode && settings.taxTypeGstFree),
  };
}

interface XeroAccount {
  Code?: string;
  Name?: string;
  Type?: string;
  Class?: string;
  Status?: string;
}
interface XeroTaxRate {
  Name?: string;
  TaxType?: string;
  Status?: string;
  CanApplyToRevenue?: boolean;
  EffectiveRate?: number;
  DisplayTaxRate?: number;
}

/** Reads the organisation's own chart of accounts and tax rates, so only codes that exist can be chosen. */
async function loadOptions(): Promise<XeroOptionsDTO> {
  const [accounts, rates] = await Promise.all([
    xeroApi<{ Accounts?: XeroAccount[] }>("GET", "/Accounts"),
    xeroApi<{ TaxRates?: XeroTaxRate[] }>("GET", "/TaxRates"),
  ]);
  const active = (account: XeroAccount) =>
    account.Status === "ACTIVE" && Boolean(account.Code);
  const pick = (account: XeroAccount) => ({
    code: account.Code ?? "",
    name: account.Name ?? "",
  });
  const byCode = (a: { code: string }, b: { code: string }) =>
    a.code.localeCompare(b.code, undefined, { numeric: true });
  return {
    salesAccounts: (accounts.Accounts ?? [])
      .filter(account => active(account) && account.Class === "REVENUE")
      .map(pick)
      .sort(byCode),
    bankAccounts: (accounts.Accounts ?? [])
      .filter(account => active(account) && account.Type === "BANK")
      .map(pick)
      .sort(byCode),
    taxRates: (rates.TaxRates ?? [])
      .filter(
        rate =>
          rate.Status === "ACTIVE" &&
          rate.CanApplyToRevenue !== false &&
          Boolean(rate.TaxType)
      )
      .map(rate => ({
        type: rate.TaxType ?? "",
        name: rate.Name ?? "",
        rate: rate.EffectiveRate ?? rate.DisplayTaxRate ?? 0,
      })),
  };
}

export async function xeroOptions(): Promise<XeroOptionsDTO> {
  try {
    return await loadOptions();
  } catch (error) {
    throw asAppError(error);
  }
}

export async function saveXeroSettings(
  input: XeroSettingsInput,
  ctx: RequestContext
): Promise<XeroStatusDTO> {
  if (!(await xeroConnected()))
    throw errors.invalidState("Connect Xero before choosing accounts.");
  await XeroConnection.updateOne(
    { _id: XERO_CONNECTION_ID },
    {
      $set: {
        settings: {
          salesAccountCode: input.salesAccountCode,
          taxTypeGstFree: input.taxTypeGstFree,
          taxTypeTaxable: input.taxTypeTaxable,
          paymentAccountCode: input.paymentAccountCode,
        },
      },
    }
  );
  await logActivity({
    actor: ctx.actor,
    action: "xero.settings",
    entityType: "integration",
    entityId: XERO_CONNECTION_ID,
    summary: "updated the Xero account settings",
    ip: ctx.ip,
  });
  return xeroStatus();
}

/** Pre-selects Xero's usual sales account and tax types the first time, so setup is a glance and a Save. */
async function fillDefaults(): Promise<void> {
  try {
    const current = await connectionDoc();
    if (!current || current.settings?.salesAccountCode) return;
    const picks = suggestDefaults(await loadOptions());
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      {
        $set: {
          "settings.salesAccountCode": picks.salesAccountCode,
          "settings.taxTypeGstFree": picks.taxTypeGstFree,
          "settings.taxTypeTaxable": picks.taxTypeTaxable,
        },
      }
    );
  } catch (error) {
    logger().warn({ err: error }, "Could not suggest Xero defaults");
  }
}

/* ───────────── Connect and disconnect ───────────── */

/** Starts the sign-in: remembers a one-time `state` and returns the Xero address to send the browser to. */
export async function beginXeroConnect(
  ctx: RequestContext
): Promise<{ url: string }> {
  if (!config().xero.configured)
    throw errors.validation(
      "Xero is not set up on this server yet. Add XERO_CLIENT_ID and XERO_CLIENT_SECRET, restart the API, then try again."
    );
  const state = randomToken(24);
  await XeroConnection.updateOne(
    { _id: XERO_CONNECTION_ID },
    {
      $set: {
        pending: {
          stateHash: sha256(state),
          expiresAt: new Date(Date.now() + SIGN_IN_MINUTES * 60_000),
          by: ctx.actor,
        },
      },
    },
    { upsert: true }
  );
  return { url: authorizeUrl(state) };
}

/** Finishes the sign-in when Xero sends the browser back. No session: the one-time `state` is the credential. */
export async function completeXeroConnect(
  query: Record<string, unknown>
): Promise<void> {
  const denied = typeof query.error === "string" ? query.error : "";
  if (denied)
    throw errors.badRequest(
      `Xero did not complete the connection${/^[a-z_]{3,40}$/.test(denied) ? ` (${denied.replace(/_/g, " ")})` : ""}. Start again from Settings.`
    );
  const code = typeof query.code === "string" ? query.code : "";
  const state = typeof query.state === "string" ? query.state : "";
  if (!code || !state)
    throw errors.badRequest(
      "Xero's reply was incomplete. Start again from Settings."
    );

  // One use only: consuming the pending sign-in is what makes a replayed link worthless.
  const previous = await XeroConnection.findOneAndUpdate(
    {
      _id: XERO_CONNECTION_ID,
      "pending.stateHash": sha256(state),
      "pending.expiresAt": { $gt: new Date() },
    },
    { $set: { pending: null } },
    { returnDocument: "before" }
  ).lean<XeroConnectionDoc>();
  if (!previous?.pending)
    throw errors.badRequest(
      "This Xero sign-in link has expired or was already used. Start again from Settings."
    );

  const tokens = await exchangeCode(code);
  const granted =
    (
      await listConnections(tokens.access_token, authEventIdOf(tokens.access_token))
    ).find(entry => entry.tenantType === "ORGANISATION") ??
    (await listConnections(tokens.access_token)).find(
      entry => entry.tenantType === "ORGANISATION"
    );
  if (!granted)
    throw errors.badRequest(
      "Xero did not share an organisation. Start again and choose one on Xero's consent screen."
    );
  const organisation = await organisationFor(
    tokens.access_token,
    granted.tenantId
  ).catch(() => ({}) as { Name?: string; ShortCode?: string });

  // Invoices linked to a different organisation mean nothing in this one.
  const switched =
    Boolean(previous.tenantId) && previous.tenantId !== granted.tenantId;
  if (switched)
    await Invoice.updateMany(
      { "xero.invoiceId": { $ne: null } },
      {
        $set: {
          "xero.invoiceId": null,
          "xero.state": "none",
          "xero.message": "",
          "xero.syncedAt": null,
          "xero.paymentId": null,
          "xero.url": "",
        },
      }
    );

  const orgName = granted.tenantName || organisation.Name || "Xero organisation";
  await XeroConnection.updateOne(
    { _id: XERO_CONNECTION_ID },
    {
      $set: {
        status: "connected",
        tenantId: granted.tenantId,
        connectionId: granted.id,
        orgName,
        shortCode: organisation.ShortCode ?? "",
        accessTokenSealed: seal(tokens.access_token),
        refreshTokenSealed: seal(tokens.refresh_token),
        accessTokenExpiresAt: tokenExpiry(tokens),
        connectedAt: new Date(),
        connectedBy: previous.pending.by.name,
        lastError: "",
        ...(switched ? { settings: emptySettings() } : {}),
      },
    }
  );
  await fillDefaults();
  await logActivity({
    actor: previous.pending.by,
    action: "xero.connected",
    entityType: "integration",
    entityId: XERO_CONNECTION_ID,
    summary: `connected Xero (${orgName})`,
  });
}

export async function disconnectXero(
  ctx: RequestContext
): Promise<XeroStatusDTO> {
  const found = await connectionDoc();
  if (found && found.status !== "disconnected") {
    // Best effort: if Xero cannot be reached, the app can still be removed from Xero's connected apps by hand.
    if (found.status === "connected")
      await dropConnection().catch(error =>
        logger().warn({ err: error }, "Could not remove the connection at Xero")
      );
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      {
        $set: {
          status: "disconnected",
          accessTokenSealed: "",
          refreshTokenSealed: "",
          accessTokenExpiresAt: null,
          connectionId: "",
          lastError: "",
          pending: null,
        },
      }
    );
    await logActivity({
      actor: ctx.actor,
      action: "xero.disconnected",
      entityType: "integration",
      entityId: XERO_CONNECTION_ID,
      summary: "disconnected Xero",
      ip: ctx.ip,
    });
  }
  return xeroStatus();
}

/* ───────────── Converging one invoice ───────────── */

/** Records where an invoice stands in Xero. Deliberately leaves `rev` alone: this is bookkeeping, not an edit. */
async function note(
  invoiceId: string,
  state: XeroSyncState,
  message: string,
  stamp = false
): Promise<void> {
  await Invoice.updateOne(
    { _id: invoiceId },
    {
      $set: {
        "xero.state": state,
        "xero.message": message.slice(0, 500),
        ...(stamp ? { "xero.syncedAt": new Date() } : {}),
      },
    }
  );
}

/** Queues the sync after a send, payment or void. Never throws: Noble's own change must not fail because Xero is down. */
export async function queueXeroSync(invoiceId: string): Promise<void> {
  try {
    const found = await XeroConnection.findById(XERO_CONNECTION_ID)
      .select("status connectedAt")
      .lean<Pick<XeroConnectionDoc, "status" | "connectedAt">>();
    if (found?.status === "needs-reconnect")
      return note(
        invoiceId,
        "error",
        "Xero needs to be reconnected in Settings → Accounting (Xero), then retry."
      );
    if (found?.status !== "connected") return;
    // Sent before Xero was connected, so it may already be in Xero by hand: wait for "Send to Xero".
    const invoice = await Invoice.findById(invoiceId)
      .select("sentAt xero")
      .lean<Pick<InvoiceDoc, "sentAt" | "xero">>();
    if (!invoice) return;
    if (
      !invoice.xero?.invoiceId &&
      invoice.sentAt &&
      found.connectedAt &&
      invoice.sentAt < found.connectedAt
    )
      return;
    await note(invoiceId, "queued", "");
    await enqueueJob("xero-sync", { invoiceId }, 6);
  } catch (error) {
    logger().error({ err: error, invoiceId }, "Could not queue the Xero sync");
  }
}

/** The "Send to Xero" / Retry button. */
export async function requestXeroSync(
  invoiceId: string
): Promise<{ queued: boolean }> {
  const invoice = await Invoice.findById(invoiceId)
    .select("status")
    .lean<Pick<InvoiceDoc, "status">>();
  if (!invoice) throw errors.notFound("Invoice");
  if (!["Sent", "Paid", "Void"].includes(invoice.status))
    throw errors.invalidState(
      "Only invoices that have been sent can go to Xero."
    );
  try {
    await requireConnection();
  } catch (error) {
    throw asAppError(error);
  }
  await note(invoiceId, "queued", "");
  await enqueueJob("xero-sync", { invoiceId }, 6);
  return { queued: true };
}

/** The payer, not the participant: one Xero contact per plan manager, found by name or created. */
async function contactFor(invoice: InvoiceDoc): Promise<string> {
  const contact = toXeroContact({
    recipient: invoice.recipient || invoice.billTo?.name || "",
    recipientEmail: invoice.recipientEmail,
  });
  if (!contact.Name)
    throw new XeroApiError(
      "This invoice has no recipient name, so Xero has no one to bill."
    );
  const found = await xeroApi<{
    Contacts?: Array<{ ContactID: string; Name?: string; ContactStatus?: string }>;
  }>("GET", "/Contacts", { query: { searchTerm: contact.Name } });
  const wanted = contact.Name.toLowerCase();
  const match = (found.Contacts ?? []).find(
    entry =>
      (entry.Name ?? "").trim().toLowerCase() === wanted &&
      entry.ContactStatus !== "ARCHIVED"
  );
  if (match) return match.ContactID;
  const created = await xeroApi<{ Contacts?: Array<{ ContactID: string }> }>(
    "PUT",
    "/Contacts",
    { body: { Contacts: [contact] } }
  );
  const id = created.Contacts?.[0]?.ContactID;
  if (!id) throw new XeroApiError("Xero did not return the new contact.");
  return id;
}

async function fetchInvoice(xeroId: string): Promise<XeroInvoice> {
  try {
    const found = await xeroApi<{ Invoices?: XeroInvoice[] }>(
      "GET",
      `/Invoices/${encodeURIComponent(xeroId)}`
    );
    if (found.Invoices?.[0]) return found.Invoices[0];
  } catch (error) {
    if (!(error instanceof XeroApiError && error.status === 404)) throw error;
  }
  throw new XeroApiError(
    "This invoice is no longer in Xero (it may have been deleted there).",
    404
  );
}

async function findByNumber(number: string): Promise<XeroInvoice | null> {
  const found = await xeroApi<{ Invoices?: XeroInvoice[] }>("GET", "/Invoices", {
    query: { InvoiceNumbers: number },
  });
  return (
    (found.Invoices ?? []).find(
      entry =>
        entry.InvoiceNumber === number && (entry.Type ?? "ACCREC") === "ACCREC"
    ) ?? null
  );
}

async function createInvoice(
  invoice: InvoiceDoc,
  settings: XeroSettingsSub,
  currency: string
): Promise<XeroInvoice> {
  const contactId = await contactFor(invoice);
  try {
    const created = await xeroApi<{ Invoices?: XeroInvoice[] }>(
      "PUT",
      "/Invoices",
      {
        idempotencyKey: `noble-${invoice._id}`,
        body: {
          Invoices: [toXeroInvoice(invoice, contactId, settings, currency)],
        },
      }
    );
    const made = created.Invoices?.[0];
    if (!made?.InvoiceID)
      throw new XeroApiError("Xero did not return the new invoice.");
    return made;
  } catch (error) {
    // The number is unique in Xero: if a crash lost the link last time, adopt the invoice rather than duplicate it.
    if (
      error instanceof XeroApiError &&
      /unique|already|duplicate/i.test(error.message)
    ) {
      const existing = await findByNumber(invoice._id);
      if (existing) return existing;
    }
    throw error;
  }
}

async function recordPayment(
  invoice: InvoiceDoc,
  remote: XeroInvoice,
  settings: XeroSettingsSub
): Promise<void> {
  const made = await xeroApi<{ Payments?: Array<{ PaymentID?: string }> }>(
    "PUT",
    "/Payments",
    {
      idempotencyKey: `noble-pay-${invoice._id}`,
      body: {
        Invoice: { InvoiceID: remote.InvoiceID },
        Account: { Code: settings.paymentAccountCode },
        Date: invoice.paidOn ?? (await workspaceToday()),
        Amount: remote.AmountDue ?? remote.Total ?? invoice.totalCents / 100,
        Reference: invoice.paidReference || invoice._id,
      },
    }
  );
  await Invoice.updateOne(
    { _id: invoice._id },
    { $set: { "xero.paymentId": made.Payments?.[0]?.PaymentID ?? null } }
  );
}

/** Xero says it is paid (bank reconciliation, usually): mark it paid here, attributed to Xero rather than a person. */
async function applyPaidFromXero(
  invoice: Pick<InvoiceDoc, "_id" | "clientId">,
  remote: XeroInvoice
): Promise<void> {
  const payment = latestPayment(remote);
  const paidOn = paidOnOf(remote) ?? (await workspaceToday());
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, status: "Sent" },
    {
      $set: {
        status: "Paid",
        paidAt: new Date(),
        paidOn,
        paidReference: (payment?.Reference ?? "").trim() || "Paid in Xero",
        "xero.state": "synced",
        "xero.message": "",
        "xero.syncedAt": new Date(),
        "xero.paymentId": payment?.PaymentID ?? null,
      },
      $inc: { rev: 1 },
      $push: { history: historyEntry(null, "paid", "Payment received in Xero") },
    },
    { returnDocument: "after" }
  ).lean();
  if (updated)
    await logActivity({
      actor: null,
      action: "invoice.paid",
      entityType: "invoice",
      entityId: invoice._id,
      participantId: invoice.clientId,
      summary: `Xero reports invoice ${invoice._id} as paid`,
    });
}

const goneInXero = (remote: XeroInvoice) =>
  remote.Status === "VOIDED" || remote.Status === "DELETED";

async function converge(
  invoice: InvoiceDoc,
  connection: XeroConnectionDoc
): Promise<void> {
  const settings = connection.settings;
  const linked = invoice.xero?.invoiceId ?? null;
  const issued = invoice.status === "Sent" || invoice.status === "Paid";
  if (!issued && !(invoice.status === "Void" && linked)) {
    // A draft, or voided before it ever reached Xero: nothing belongs there.
    return note(invoice._id, "none", "");
  }

  let remote: XeroInvoice;
  if (linked) {
    remote = await fetchInvoice(linked);
  } else {
    const problem = missingMapping(invoice, settings);
    if (problem) throw new XeroApiError(problem);
    remote = await createInvoice(
      invoice,
      settings,
      (await getWorkspace()).currency || "AUD"
    );
    await Invoice.updateOne(
      { _id: invoice._id },
      {
        $set: {
          "xero.invoiceId": remote.InvoiceID,
          "xero.url": invoiceUrl(connection.shortCode, remote.InvoiceID),
        },
      }
    );
  }

  if (invoice.status === "Void") {
    if (!goneInXero(remote)) {
      if (remote.Status === "PAID" || (remote.AmountPaid ?? 0) > 0)
        throw new XeroApiError(
          "Xero has a payment on this invoice, so it cannot be voided there. Remove the payment in Xero, then retry."
        );
      await xeroApi("POST", `/Invoices/${encodeURIComponent(remote.InvoiceID)}`, {
        body: { Invoices: [{ InvoiceID: remote.InvoiceID, Status: "VOIDED" }] },
      });
    }
  } else if (invoice.status === "Paid") {
    if (goneInXero(remote))
      throw new XeroApiError(
        `Marked paid here, but the invoice is ${remote.Status.toLowerCase()} in Xero.`
      );
    if (remote.Status !== "PAID") {
      if (!settings.paymentAccountCode)
        throw new XeroApiError(
          "Marked paid here, but not in Xero. Choose a bank account for payments in Settings → Accounting (Xero) and retry, or record the payment in Xero."
        );
      await recordPayment(invoice, remote, settings);
    }
  } else if (remote.Status === "PAID") {
    await applyPaidFromXero(invoice, remote);
  } else if (goneInXero(remote)) {
    throw new XeroApiError(
      `This invoice was ${remote.Status.toLowerCase()} in Xero. Void it here too if that was intended.`
    );
  }

  if (
    invoice.status !== "Void" &&
    typeof remote.Total === "number" &&
    centsOf(remote.Total) !== invoice.totalCents
  )
    throw new XeroApiError(
      `Xero's total (${dollars(centsOf(remote.Total))}) differs from this invoice (${dollars(invoice.totalCents)}), usually a rounding difference. Check the invoice in Xero.`
    );
  await note(invoice._id, "synced", "", true);
}

async function syncInvoice(invoiceId: string): Promise<void> {
  const invoice = await Invoice.findById(invoiceId).lean<InvoiceDoc>();
  if (!invoice) return;
  try {
    await converge(invoice, await requireConnection());
  } catch (error) {
    // Something a person has to fix: show it on the invoice. Anything else is retried by the queue.
    if (error instanceof XeroApiError) return note(invoiceId, "error", error.message);
    throw error;
  }
}

/* ───────────── Payments coming back ───────────── */

/** Asks Xero about every sent invoice that is linked, in batches, and applies payments. */
async function pollXero(): Promise<void> {
  const connection = await connectionDoc();
  if (connection?.status !== "connected") return;
  try {
    const open = await Invoice.find({
      status: "Sent",
      "xero.invoiceId": { $ne: null },
    })
      .select("_id clientId xero")
      .limit(400)
      .lean<Array<Pick<InvoiceDoc, "_id" | "clientId" | "xero">>>();
    for (let from = 0; from < open.length; from += POLL_BATCH) {
      const batch = open.slice(from, from + POLL_BATCH);
      const found = await xeroApi<{ Invoices?: XeroInvoice[] }>(
        "GET",
        "/Invoices",
        { query: { IDs: batch.map(entry => entry.xero?.invoiceId ?? "").join(",") } }
      );
      const remotes = new Map(
        (found.Invoices ?? []).map(entry => [entry.InvoiceID, entry])
      );
      for (const invoice of batch) {
        const remote = remotes.get(invoice.xero?.invoiceId ?? "");
        if (!remote) continue;
        if (remote.Status === "PAID") await applyPaidFromXero(invoice, remote);
        else if (goneInXero(remote))
          await note(
            invoice._id,
            "error",
            `This invoice was ${remote.Status.toLowerCase()} in Xero. Void it here too if that was intended.`
          );
      }
    }
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      { $set: { lastPollAt: new Date(), lastError: "" } }
    );
  } catch (error) {
    if (!(error instanceof XeroApiError)) throw error;
    await XeroConnection.updateOne(
      { _id: XERO_CONNECTION_ID },
      { $set: { lastError: error.message.slice(0, 300) } }
    );
    return;
  }

  // Still "queued" after a while means its job was lost (a restart, a long outage): queue it again.
  const stuck = await Invoice.find({
    "xero.state": "queued",
    updatedAt: { $lt: new Date(Date.now() - STUCK_MINUTES * 60_000) },
  })
    .select("_id")
    .limit(50)
    .lean<Array<{ _id: string }>>();
  for (const invoice of stuck) {
    const waiting = await Job.exists({
      type: "xero-sync",
      "payload.invoiceId": invoice._id,
      status: { $in: ["queued", "running"] },
    });
    if (!waiting) await enqueueJob("xero-sync", { invoiceId: invoice._id }, 6);
    await note(invoice._id, "queued", "");
  }
}

/** Called every 15 minutes, and by "Check Xero now". Skips when a check is already waiting. */
export async function enqueueXeroPoll(): Promise<boolean> {
  if (!(await xeroConnected())) return false;
  const waiting = await Job.exists({
    type: "xero-poll",
    status: { $in: ["queued", "running"] },
  });
  if (waiting) return false;
  await enqueueJob("xero-poll", {}, 2);
  return true;
}

registerJob(
  "xero-sync",
  async payload => syncInvoice(String(payload.invoiceId)),
  async (payload, error) => {
    const message =
      error instanceof Error ? error.message : "The Xero sync failed.";
    // Out of retries because Xero was unreachable or rate-limiting: stay queued, the next check tries again.
    if (error instanceof RetryableProviderError)
      await note(String(payload.invoiceId), "queued", `Waiting for Xero: ${message}`);
    else await note(String(payload.invoiceId), "error", message);
  }
);
registerJob("xero-poll", async () => pollXero());
