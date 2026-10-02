# Xero Integration Plan

_2026-10-02. Noble → Xero Accounting (Australia, single organisation)._

> **Built 2026-10-02** (invoices only, as planned). Where the build differs from this plan:
> - **OAuth sign-in (§6), not a Custom Connection.** The Xero organisation belongs to a client, and a Custom Connection needs the organisation owner to buy a subscription. OAuth on the free Starter tier needs no purchase and gives a "Connect to Xero" button. `getAccessToken` logic lives in `modules/xero/client.ts` if Custom Connection is wanted later.
> - Account mappings live on the connection document (`integrations` collection), edited at `PUT /integrations/xero/settings`, not on the workspace.
> - Job types are `xero-sync` and `xero-poll`; `SentToContact` is not set; invoices sent before the connection are not pushed until someone clicks "Send to Xero".
> - Code: `apps/api/src/modules/xero/`, `apps/web/src/features/settings/XeroSettings.tsx`. Tests: `apps/api/test/xero.test.ts` (a fake Xero injected through `setXeroFetch`). **Never run against real Xero yet**, so the ⚠ items in §8 plus the `PUT /Payments` body, voiding via `POST /Invoices/{id}` and the "Open in Xero" link are still to confirm on the Demo Company.
> - Setup steps: [.env.example](.env.example) and Settings → Accounting (Xero).

## 1. Verdict

1. **One module matters: Invoices.** Push each invoice to Xero when it is _sent_; pull "paid" back when Xero reconciles the bank payment. The payer becomes a Xero Contact automatically behind it. Settings gets one panel. **Nothing else in Noble needs integrating.** Records, Roster, Budgets, Staff, Portal, Tracking, Voice and Documents logic stay untouched (the Documents "Finance / Xero" placeholder just flips from "not connected" to real status).
2. **Connection: Xero Custom Connection** (client-credentials, one organisation, ~A$10/month). Noble is exactly one organisation, so this removes the OAuth redirect, the token vault, refresh-token rotation and the "DB restore rolled the token back" failure. Fallback is standard OAuth on the free Starter tier (§6).
3. **Sync model:** every trigger enqueues one idempotent `xero.sync` job on the existing Mongo job queue; a 15-minute poll picks up payments. Webhooks are Phase 2 (they need a public HTTPS endpoint, and the VM on 9080/9443 behind `SITE_ADDRESS=:80` does not clearly have one yet).
4. **Size:** 4 new API files, 1 web component, ~16 small edits (§5). No new dependency (plain `fetch`; the official SDK `xero-node` is at 20.0.0 if you would rather use it).

## 2. What the research says (decision-relevant only)

| Fact | Consequence for Noble |
| --- | --- |
| OAuth 2.0. Access token lives 30 min. Refresh token lives 60 days, is single-use, with a 30-min grace window. | Token upkeep is the usual way Xero integrations break. Pick the connection type that avoids it. |
| **Custom Connections**: client-credentials, one org, only AU/NZ/UK/US orgs, extra monthly subscription (A$10/mo inc GST per connection, per Databuzz). Granular scopes available since 29 Apr 2026. | Fits a single-organisation back office exactly. |
| **Granular scopes** since Mar 2026: `accounting.invoices` (invoices, credit notes, items…), `accounting.payments`, `accounting.contacts`, `accounting.settings`, `accounting.attachments`. Broad `accounting.transactions` works only until Sep 2027. | Request granular only: `accounting.invoices accounting.payments accounting.contacts accounting.settings` (+ `accounting.attachments` in Phase 2). |
| **Pricing since 2 Mar 2026**: Starter free (5 connections, 1,000 calls/day/org); Core A$35/mo (50 conn.); Plus A$245; Advanced A$1,445. | One org fits the free tier on OAuth. See ⚠ in §8 for how Custom Connections are billed. |
| **Limits**: 60 calls/min and 5,000/day per org (1,000/day on Starter), 5 concurrent, 10,000/min per app. 429 carries `Retry-After`. | Batch the poll. Job worker concurrency of 2 is fine. |
| **Invoices API**: `ACCREC` sales invoice; each line needs Description, Quantity, UnitAmount, AccountCode, TaxType. Status DRAFT/SUBMITTED/AUTHORISED. `InvoiceNumber` must be unique. `Idempotency-Key` header supported. Authorised invoices have limited edits. PDF can be attached. | Noble's `INV-2026-001` ids double as the duplicate guard. Noble's edit-lock after Sent already matches Xero's rules. |
| **Webhooks**: CONTACT and INVOICE events (CREATE/UPDATE). Signed `x-xero-signature` (HMAC-SHA256, base64, over the raw body). "Intent to receive" handshake needs 200 (valid) / 401 (invalid) within 5 s. Payload carries IDs only. | Phase 2. Needs a follow-up GET per event. |
| **Peer pattern** (Rentman, Tipalti, Apideck): connect, map ledgers and tax rates, export invoices, payment status flows back from Xero, per-invoice export status/remark when a mapping is missing. Pitfalls: duplicates (idempotency), rounding, fixed-schedule polling at scale. | This plan copies that shape. |

**Coverage caveat.** Rentman's page returned HTTP 403 (used its search excerpt). Several developer.xero.com pages (scopes, webhooks, custom connections, rate limits) are JS-rendered and returned no body; those facts come from Xero's devblog, search snippets and third-party guides. Items marked ⚠ in §8 must be confirmed in the Xero developer portal / Demo Company before building.

## 3. Mapping to what Noble already has

### 3.1 Modules

| Noble module | Integrate? | What changes |
| --- | --- | --- |
| **Invoices** | **Yes, core** | Push on Sent; payment/void convergence; Paid pulled back; sync chip + retry. |
| **Participants** (payer) | **Yes, invisible** | `invoice.recipient` / `recipientEmail` → Xero Contact, looked up by name, created if missing. No participant model or UI change. |
| **Settings** | **Yes** | One "Accounting (Xero)" panel: connect, sales account, GST-free and taxable tax types, bank account for payments. |
| Services | Read-only | `supportItemNumber` is already copied onto invoice lines; it goes into the line Description. (Later, optional: account code per budget category.) |
| Documents | Tiny | "Finance / Xero" node and the `/integrations/xero/status` stub show real status. |
| Dashboard, Notifications, Budgets | Free benefit | Outstanding / overdue / `invoiceOverdue` become accurate once payments flow back. No code. |
| Records, Roster, Staff, Portal, Tracking, Voice | No | — |
| **Not now** | | Payroll AU (timesheets; separate API, STP implications), Bills/expenses, Tracking categories, NDIS portal claims. |

### 3.2 Invoice → Xero fields

| Noble `Invoice` | Xero `ACCREC` invoice | Note |
| --- | --- | --- |
| `_id` (`INV-2026-001`) | `InvoiceNumber` | Unique in Xero, so it is also the duplicate guard. |
| `recipient`, `recipientEmail` | `Contact` (Name, EmailAddress) | The payer, not the participant: one contact per plan manager. |
| `reference` | `Reference` | "Participant – NDIS …". |
| `issue`, `due` | `Date`, `DueDate` | Already `YYYY-MM-DD`. |
| line `itemCode` + `label` | `LineItems[].Description` | |
| line `quantity`, `rateCents / 100` | `Quantity`, `UnitAmount` | Cents → dollars via `fromCents`. |
| `workspace.xero.salesAccountCode` | `AccountCode` | One default account in v1. |
| `taxRatePct` = 0 / > 0 | `TaxType` GST-free / taxable | Chosen in Settings from the org's own `/TaxRates`; never hard-coded. |
| — | `LineAmountTypes: Exclusive`, `CurrencyCode: AUD`, `Status: AUTHORISED`, `SentToContact: true` | Noble emails the PDF itself. |
| `notes`, `footer`, `paymentInstructions`, `bank` | not sent | Stay on Noble's PDF / public link. Phase 2: attach the PDF. |

**Post-create check:** compare Xero's returned `Total` with `totalCents`. On mismatch set state `error` ("totals differ by $0.01, rounding") instead of drifting silently.

### 3.3 Lifecycle

| Noble event | Xero effect |
| --- | --- |
| Create / edit draft / Ready to send | None. Drafts are deletable; pushing them only clutters Xero. |
| `markSent` | Upsert Contact, create the AUTHORISED invoice. |
| `markPaid` (manual) | Push the invoice first if never pushed, then create a Payment (needs a bank account in Settings; otherwise Noble-only and the chip reads "paid here, unpaid in Xero"). |
| Void (issued invoice) | Set Xero status VOIDED. Xero refuses when payments are applied; show as an error, do not retry. |
| Delete draft | None (never pushed). |
| **Xero: invoice PAID** (poll) | Noble → Paid, `paidOn` = Xero payment date, reference from the payment. |
| Xero: invoice VOIDED / deleted | Flag only ("Voided in Xero"). Auto-voiding would release the records, so a person decides. |

## 4. Design

- **Files** `apps/api/src/modules/xero/`: `client.ts` (token + `xeroFetch`; 429/5xx/network → `RetryableProviderError`), `mapping.ts` (pure Noble↔Xero functions, unit-testable), `service.ts` (connect, status, options, `syncInvoice`, `pollPayments`), `routes.ts`.
- **Converge job `xero.sync {invoiceId}`**: reads the Noble invoice and (if linked) the Xero invoice, then performs only the missing steps (create → authorise → pay → void). It is state-based, not event-based, so retries, the Retry button and the sweeper cannot double-post or loop with the inbound poll. Uses `enqueueJob` (`maxAttempts` ~6) and the existing backoff in `lib/jobs.ts`.
- **Poll `xero.poll`**: started from `startMaintenance()` every 15 min (same "timer enqueues, job works" pattern as the expiry sweep). One batched `GET /Invoices?IDs=…` (≤ ~40 ids) for Sent + linked invoices; applies Paid; re-enqueues anything stuck in `queued`/`error` for > 15 min. About 100–200 calls/day against the 1,000/day Starter cap.
- **Token**: Custom Connection → `POST https://identity.xero.com/connect/token` (`grant_type=client_credentials`, scopes above), cached in memory for its ~30-min life. Tenant id from `GET /connections` once, at "Connect". Everything goes through one `getAccessToken()`, so moving to OAuth later touches only that function.
- **Config**: `XERO_MODE=off|custom|oauth`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` (server only, never `VITE_*`). `features.xero` = mode ≠ off. Tests inject a fake fetch, in the spirit of `STT_PROVIDER=mock`.
- **Data**: `Invoice.xero = { invoiceId, state: none|queued|synced|error, error, syncedAt, paymentId }`. `Workspace.xero = { tenantId, orgName, salesAccountCode, taxTypeGstFree, taxTypeTaxable, paymentAccountCode, lastPollAt }`: non-secret, edited through the existing `PATCH /settings/workspace`. No tokens are persisted in custom mode.
- **Contacts**: look up `Name == recipient`, create if absent. No mapping collection in v1.
- **Settings options**: `GET /integrations/xero/options` returns revenue accounts, bank accounts and tax rates (from `/Accounts`, `/TaxRates`) so the selects can only hold valid values. This is Rentman's "match ledgers and tax rates" step.
- **UI**: status chip on the invoice preview ("Synced to Xero" / "Queued" / "Failed, Retry"); one Settings panel; Documents node text.
- **History/audit**: Xero-originated changes (Paid from poll) need a "Xero" system actor. Confirm `historyEntry` / `logActivity` accept a null/system actor (no system actor exists in `apps/api/src` today).
- **Tests**: mapping unit tests; job tests through `drainJobs` with fake Xero responses (create, duplicate number, 429, paid-in-Xero).

## 5. Touch-points

**New:** `apps/api/src/modules/xero/{client,mapping,service,routes}.ts` · `apps/web/src/features/settings/XeroPanel.tsx`

| File | Edit |
| --- | --- |
| `.env.example` | `XERO_*` after the `NOTE_*` block (~line 59) |
| `apps/api/src/config/index.ts` | `xero` block beside `stt` / `notes` (~139–150), validation like line 205 |
| `apps/api/src/models/system.ts:63` | add `"xero.sync" \| "xero.poll"` to `JobType` |
| `apps/api/src/models/invoice.ts` | `xero` sub-doc (interface after `share`, schema after the `share` block) |
| `apps/api/src/models/workspace.ts` | `xero` settings (interface, defaults, schema) |
| `packages/shared/schemas/settings.ts` | `xero` in `workspacePatchSchema` (after `bank`) |
| `packages/shared/dto.ts` | `InvoiceDTO.xero`, `XeroStatusDTO` (`MetaDTO.features.xero` already exists, line 152) |
| `apps/api/src/modules/invoices/service.ts` | `queueXeroSync(id)` after `markSent` (~649), `markPaid` (~682) and the void branch of `releaseInvoice` (~751); add `xero` to `toInvoiceDTO` (128) |
| `apps/api/src/routes.ts` | mount `/integrations/xero` beside `/invoices` (line 67) |
| `apps/api/src/modules/documents/routes.ts:87` | delete the `{connected:false}` stub (moves into the xero router) |
| `apps/api/src/modules/documents/service.ts:403`, `apps/web/.../DocumentLibrary.tsx:465,568` | real status text instead of "Xero is not connected" |
| `apps/api/src/modules/system/routes.ts:49` | `xero: cfg.xero.mode !== "off"` |
| `apps/api/src/maintenance.ts` | 15-min `runXeroTick` (pattern at lines 40–58) |
| `apps/web/src/features/settings/SettingsPage.tsx` | `<XeroPanel />` after the Invoicing panel (ends line 310) |
| `apps/web/src/features/invoices/InvoicePreviewPage.tsx` | chip + Retry beside the action buttons (~219–270) |
| `apps/web/src/api/hooks.ts` | `useXeroStatus/Options/Connect/Retry` (near `useInvoiceShare`, 1161) |
| `apps/api/test/workflow.test.ts` | Xero scenario |

## 6. Alternative: standard OAuth (if you want to avoid the A$10/month)

Delta only: `GET /integrations/xero/connect` + `/callback` (state in a signed cookie, scopes plus `offline_access`); a `XeroConnection` collection holding the refresh token **encrypted at rest** (AES-GCM, `XERO_TOKEN_KEY`); a compare-and-set lock so two workers never rotate the token at once; a banner on `invalid_grant`, including after a DB restore (backups run every 24 h, so a restored token is stale) and after 60 idle days. Free on Starter (1 of 5 connections, 1,000 calls/day). Only `getAccessToken()` and the connect routes differ; everything else in §4 is identical.

## 7. Phases

- **Phase 0 (you, no code):** commit the in-progress public-link invoice work first (it touches the same invoice model / service / dto files); a Xero org Admin creates the Custom Connection; test on the Demo Company (AU); your accountant confirms the sales account code and GST treatment.
- **Phase 1 (MVP):** everything above: connect, Settings panel, push on Sent, paid/void convergence, 15-min poll, chip + retry, tests.
- **Phase 2:** webhooks (`POST /public/xero/webhook`: verify `x-xero-signature`, answer the handshake 200/401, enqueue `xero.sync`; needs the raw body ahead of `express.json()`, and `originCheck` already lets server-to-server POSTs through, `middleware/security.ts:12-24`); attach the PDF to the Xero invoice; deep link to the invoice in Xero (org ShortCode); per-participant contact override.
- **Not planned:** payroll, bills, tracking categories, multi-org.

## 8. Decisions and risks

**Decisions for you**
1. Custom Connection (A$10/mo, least code, no token upkeep) vs OAuth on free Starter. **Recommend Custom Connection.**
2. GST: Noble has one invoice-level rate (default 0%; NDIS supports are usually GST-free). Confirm the Xero tax type for 0% (typically "GST Free Income" if registered, "BAS Excluded" if not) and that no service is GST-taxable. If some are, add a per-service GST flag before this work.
3. Who holds Xero Admin to create the connection and buy the subscription.

**Risks**
- ⚠ Duplicate handling: confirm in Demo Company what Xero returns for an existing `InvoiceNumber` on create (plan assumes a validation error we treat as "link it, don't duplicate"), and that `SentToContact` is accepted on create.
- ⚠ Billing: confirm in the developer portal that a Custom Connection app needs nothing beyond the A$10/month (Starter tier otherwise).
- Rounding: Xero rounds per line, Noble per invoice, so 1¢ drift is possible. The total check catches it; fix is a single-line amount for that invoice.
- Payer names are free text (`participant.manager`), so "Leaf Plan Mgmt" and "Leaf Plan Management" become two Xero contacts. Normalise the field or add the Phase 2 override.
- Privacy: line text and Reference carry participant names and NDIS numbers into Xero. Check who at your accounting firm has org access.
- Never poll per invoice (1,000 calls/day on Starter).

## 9. Sources

- [Xero API pricing (from 2 Mar 2026)](https://developer.xero.com/pricing)
- [Xero scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/) · [Upcoming changes to Xero Accounting API scopes](https://devblog.xero.com/upcoming-changes-to-xero-accounting-api-scopes-705c5a9621a0) · [Apideck: Xero scopes](https://www.apideck.com/blog/xero-scopes)
- [Xero Custom Connections](https://developer.xero.com/documentation/guides/oauth2/custom-connections/) · [Databuzz: Custom Connections pricing](https://www.databuzz.com.au/fmaccounting-link-xero-edition-and-custom-connections/)
- [Xero auth flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow) · [Xero Invoices API](https://developer.xero.com/documentation/api/accounting/invoices)
- [Xero webhooks with Node/Express (Xero devblog)](https://devblog.xero.com/keeping-your-integration-in-sync-implementing-xero-webhooks-using-node-express-and-ngrok-6d2976baac6d) · [Hookdeck: Xero webhooks guide](https://hookdeck.com/webhooks/platforms/guide-to-xero-webhooks-features-and-best-practices)
- [Coefficient: Xero API rate limits](https://coefficient.io/xero-api/xero-api-rate-limits)
- Your leads: [Apideck](https://www.apideck.com/blog/xero-integrations) · [Tipalti](https://tipalti.com/blog/xero-integrations/) · [Rentman](https://support.rentman.io/hc/en-us/articles/360013977700-Xero-Integration-Setting-up-your-integration-with-Xero-Accounting-Software) (403 on fetch; read via search excerpt)
- [xero-node on npm](https://www.npmjs.com/package/xero-node) (20.0.0, last modified 2026-09-21)
