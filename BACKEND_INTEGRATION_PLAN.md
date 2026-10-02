# Noble Community Support — Backend Build & Integration Plan

> **Status:** implemented (phases 0–10). How to run, test and deploy it: [README.md](README.md).
> **Reviewed:** `main` @ `99f2dbe` (UI-only prototype) · **Prepared:** 2026-09-29
> **Your constraints:** MERN · TypeScript backend · dockerised API · MongoDB from the official Docker image (no Atlas) · Multer for uploads (no Cloudinary).
> **Versions** quoted in this document were read from the npm registry on 2026-09-29.

### Where the implementation differs from this plan

| Plan                                                                      | Implementation                                                                                                                                                                          | Why                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| API on port 4000; Vite on 3000                                            | API on **4100**, Vite on **5173**, Mailpit on 8125/1125 (all overridable in `.env`)                                                                                                     | 3000, 4000, 1025 and 8025 were already taken on the development machine            |
| `refresh_tokens` collection                                               | `auth_sessions` — one document per signed-in device with the current refresh-token hash and recent rotated hashes                                                                       | One place for session listing, revocation and reuse detection                      |
| Service transport unit Kilometre or Hour                                  | Transport is always billed per kilometre at the workspace travel rate                                                                                                                   | Records only capture kilometres; an hourly transport unit had no data behind it    |
| Staff status Active / On leave                                            | Active / On leave / **Inactive**                                                                                                                                                        | Lets people who have left be kept for history but never assigned                   |
| Organisation folders: policies, insurance, worker checks, NDIS, templates | Also **Finance documents** beside the Xero placeholder                                                                                                                                  | Somewhere to upload statements until an accounting integration exists              |
| Budget status                                                             | Overall status uses the plan total (as the prototype did); categories spending more than their allocation are shown in red, and activity in an unfunded category appears as its own row | Nothing is silently ignored                                                        |
| —                                                                         | `POST /auth/demo` (only when `DEMO_ENABLED=true`, never in production) and `pnpm seed:demo`                                                                                             | Keeps the prototype's "explore the workspace" experience for development and demos |

## Contents

1. [Summary](#1-summary)
2. [What the investigation found](#2-what-the-investigation-found)
3. [Target architecture & conventions](#3-target-architecture--conventions)
4. [Infrastructure: Docker, MongoDB, uploads, environment](#4-infrastructure-docker-mongodb-uploads-environment)
5. [Data model](#5-data-model)
6. [Business rules that move to the server](#6-business-rules-that-move-to-the-server)
7. [Module plans — API mapped to the UI (signup → login → every module)](#7-module-plans--api-mapped-to-the-ui)
8. [Frontend integration plan](#8-frontend-integration-plan)
9. [Security & privacy](#9-security--privacy)
10. [Build order & acceptance criteria](#10-build-order--acceptance-criteria)
11. [Testing plan](#11-testing-plan)
12. [Decisions made & open questions](#12-decisions-made--open-questions)

## 1. Summary

**What the app is.** A staff back-office portal for an NDIS-style community support provider ("Noble Community Support"). Modules: public landing/login/signup, dashboard, rostering, clients (participants) with profile tabs, service records (progress notes) with a review workflow, per-client plan budgets, invoicing, a document library, services & rates, staff directory, reports, voice notes with AI-drafted progress notes, and settings. It is **single-tenant with a single role (Admin)** — the earlier role switcher and organisation selector were removed in commit `1fe497e`.

**What exists today.** 100% client-side. All state lives in `useState` inside [Home.tsx](client/src/pages/Home.tsx) (110 KB), seeded from [mock-data.ts](client/src/lib/mock-data.ts). Nothing persists; a refresh resets everything and drops you back on the public site. Login/signup are disclaimers. [server/index.ts](server/index.ts) only serves static files.

**What we build.**

| Layer      | Choice                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| API        | Express 5 + TypeScript (ESM, bundled with esbuild like the current server), Zod validation shared with the client |
| Database   | MongoDB 8 from the official `mongo` image, run as a **single-node replica set** (needed for transactions)         |
| ODM        | Mongoose 9                                                                                                        |
| Uploads    | Multer 2 → disk on a Docker volume, served only through authenticated routes                                      |
| Auth       | httpOnly-cookie sessions: short-lived access token + rotating refresh token                                       |
| Containers | `mongo`, `api`, `mailpit` (dev) · `caddy`, `api`, `mongo`, `backup` (prod)                                        |
| Client     | Existing React app + TanStack Query + an API layer; `Home.tsx` split by feature                                   |

**Scale of the work.** 17 collections, ~100 endpoints in 15 groups, 11 build phases (§10). Every button that today toasts, no-ops or edits local state maps to an endpoint in §7, and every figure on screen becomes a server-computed value.

**Guiding principles**

1. The **server is the source of truth** for money, statuses, numbering, budget maths and validation. The browser only previews.
2. **DTOs mirror the existing TypeScript types** in `mock-data.ts` (names, shapes) so UI churn is small; the differences are listed in §3.4 and §8.
3. **Incremental per module**, in dependency order, each phase shippable and testable on its own.
4. **Everything works with zero external keys**: email goes to Mailpit, speech-to-text and note drafting have `mock` providers. Real providers are switched on by environment variables.
5. **Nothing clinical or financial is hard-deleted** (soft delete, void, archive), and every mutation writes an audit entry.

**Non-goals (for now):** multi-tenancy, roles beyond Admin (the design leaves room), Xero sync, NDIS portal claim submission, online payments, offline mode, native mobile app.

---

## 2. What the investigation found

### 2.1 Screen inventory

| Area                                 | Where                                                                                                 | Does today                                                                                    | Backend needed                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| Public site                          | [PublicPages.tsx](client/src/pages/PublicPages.tsx)                                                   | Landing, Login, Signup (disclaimers only), "Open Admin preview" bypass                        | Auth, bootstrap status         |
| Shell                                | `Home.tsx:324-338`                                                                                    | Sidebar (10 sections), header (search, bell, logout), mobile nav, toasts                      | Session, notifications, search |
| Dashboard                            | `Home.tsx:187-198`                                                                                    | KPIs, action queue, today's services, documentation health, billing snapshot, recent activity | Aggregate endpoint             |
| Rostering                            | [Rostering.tsx](client/src/pages/Rostering.tsx)                                                       | Week board, ratio filter, KPIs, create/edit drawer, overlap checks                            | Shifts API                     |
| Clients                              | `Home.tsx:200-216`, [ParticipantIntakeDrawer.tsx](client/src/pages/ParticipantIntakeDrawer.tsx)       | List/search/filter, intake + KYC checklist, profile with 6 tabs                               | Participants API               |
| ↳ Service records                    | `Home.tsx:227-241` (editor), `:218-225` (review queue), `:329` (review drawer), `:331` (return modal) | Draft → Submitted → Approved/Returned → Invoiced                                              | Records API                    |
| ↳ Budget tab                         | [BudgetManager.tsx](client/src/pages/BudgetManager.tsx)                                               | Plan setup, allocation adjustment with reason, live metrics                                   | Budgets API                    |
| ↳ Documents tab / Organisation files | [DocumentLibrary.tsx](client/src/pages/DocumentLibrary.tsx)                                           | Virtual folder tree; uploads "not connected"                                                  | Documents API                  |
| Services                             | `Home.tsx:286-287`                                                                                    | Rate table with inline edits + Add-service drawer                                             | Services API                   |
| Invoices                             | `Home.tsx:243-255`                                                                                    | Register, builder drawer, preview                                                             | Invoices API + PDF             |
| Staff                                | `Home.tsx:289`                                                                                        | Directory (add/view are placeholders)                                                         | Staff API                      |
| Reports                              | `Home.tsx:290-293`                                                                                    | Four panels, hard-coded chart data, inert filters/export                                      | Reports API                    |
| Voice                                | `Home.tsx:257-284, 296, 332-335`                                                                      | Inbox, mock recorder, transcript, AI draft, rename/archive/delete, settings                   | Voice API + providers          |
| Settings                             | `Home.tsx:294`                                                                                        | Voice preferences + info panel; other sections just toast                                     | Settings API                   |

### 2.2 Entities and how they relate

```
User (admin) ──< ActivityLog
Participant ──1:1── Budget (current) ──< BudgetAdjustment
Participant ──< ServiceRecord >── Staff
ServiceRecord >── Service (rate, unit, budget category)
ServiceRecord ──0..1── VoiceNote          ServiceRecord >──0..1 Invoice
Invoice ──< Line        Invoice >──< ServiceRecord (recordIds)
RosterShift >──< Participant     RosterShift >──< Staff     RosterShift >── Service
VoiceNote >── Participant
Document >──0..1 Participant (organisation documents have none)
```

### 2.3 Logic living in the browser that must move to the server

| Logic                                                                    | Today                                             | Moves to                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| Duration in hours (6-minute rounding)                                    | `Home.tsx:33`, `budget-math.ts:6`                 | `shared/` pure function; server is authoritative |
| Billables (rate lookup, travel line)                                     | `Home.tsx:143-149`                                | service-records module                           |
| Record total                                                             | `Home.tsx:34`, `budget-math.ts:24`                | server                                           |
| Budget metrics, category mapping, shift cost                             | `budget-math.ts:13-50`                            | budgets module                                   |
| ID generation: `SR-`, `INV-2026-`, `VN-`, `SH-`, `p-<timestamp>`, `r<n>` | `Home.tsx:35,116,125,173,267`, `Rostering.tsx:73` | atomic counters (§3.4)                           |
| Workflow transitions and submit validation                               | `Home.tsx:155-166`                                | service-records module                           |
| Invoice creation and record linking                                      | `Home.tsx:168-175`                                | invoices module (transaction)                    |
| Ratio rules and overlap detection                                        | `Rostering.tsx:61-77`                             | roster module                                    |
| Budget setup/adjust validation                                           | `BudgetManager.tsx:56-73`                         | budgets module                                   |
| NDIS number and plan-date validation                                     | `ParticipantIntakeDrawer.tsx:62-68`               | participants module (shared Zod schema)          |
| Service creation validation                                              | `Home.tsx:110-120`                                | services module                                  |
| Fake transcription and note generation                                   | `Home.tsx:178-179`                                | voice module + providers                         |
| Document tree construction                                               | `DocumentLibrary.tsx:31-105`                      | documents module                                 |
| "Today"                                                                  | `mock-data.ts:10` (browser clock)                 | workspace timezone, served by the API            |
| Dashboard and report aggregates                                          | `Home.tsx:187-198, 290-293`                       | dashboard/reports modules                        |

### 2.4 Gaps and inconsistencies the backend plan must resolve

Each item that needs a decision is settled in §12.1.

**A. Placeholders that need a real backend**

- **A1** Login, signup and "Forgot password?" only show notices (`PublicPages.tsx:15-24,39`). "Open the Admin preview" bypasses auth (`:31,45,54,58`; `Home.tsx:338`).
- **A2** Document upload buttons only toast (`DocumentLibrary.tsx:140`); templates say "No file attached"; the Xero node says "Not connected".
- **A3** The recorder captures nothing (`Home.tsx:259-276`); transcription and generation are timers producing canned text (`:178-179`); playback is a toast (`:281`); "Save draft" on a voice draft is a toast (`:282`).
- **A4** Invoice "Download PDF" is a toast (`:254`); "Mark as sent" only flips a flag.
- **A5** Services "Save rate" (check icon) only toasts; inline edits mutate state immediately (`:286`).
- **A6** Staff "Add team member" and "View profile" only toast (`:289`).
- **A7** Report filters, Apply and Export are inert; chart bars are literal arrays (`:292`).
- **A8** Settings: only the voice panel exists; its toggles and selects are uncontrolled and unsaved (`:294`).
- **A9** The bell always says "all caught up"; header search only jumps to Clients; the Clients "Filters" button toasts (`:184,202`).

**B. Hard-coded values that must come from data**

- **B1** `currentName = "Maya Thompson"` and role "Admin" (`Home.tsx:105,184,185`); "Jordan Lee" on voice detail (`:283`); greeting is always "Good morning".
- **B2** Dashboard "86%", "18 of 21 records complete" and the three activity lines (`:194-195`).
- **B3** Default ids `p1`, `s1`, `VN-028` (`Home.tsx:62,72,75,151`, `Rostering.tsx:11`) will not exist once real ids are used.
- **B4** `today` comes from the browser clock (`mock-data.ts:10`); the organisation is in Adelaide, so the server's workspace timezone must define "today".
- **B5** Travel is a literal $1.00/km, fallback rate 68.30, tax 0, due date +14 days, invoice prefix `INV-2026-` (`Home.tsx:143-149,173`, `budget-math.ts:20`).
- **B6** Document tree months are fixed to Sep–Nov 2026 (`DocumentLibrary.tsx:27,38,52`); notes outside those months never appear.
- **B7** Billing readiness lists only the first 3 participants; "Today's services" shows service records, not rostered shifts (`:194,292`).

**C. Flows the backend needs that have no UI yet**

- **C1** Edit a participant; archive/restore (the type has `Archived` but no control); edit KYC after intake.
- **C2** Edit/deactivate staff; delete a service; choose a service's budget category.
- **C3** Shift status (Planned → Confirmed → Completed), cancel, delete — the edit form has no status control (`Rostering.tsx:61-77`).
- **C4** Invoice statuses "Ready to send" and "Paid" exist in the type and tiles but nothing sets them; no delete/void; the builder's Issue date and Payment terms inputs are uncontrolled and ignored (`Home.tsx:248` vs `:173`).
- **C5** Budget plan renewal/history; the reason typed for an allocation change is discarded (`BudgetManager.tsx:56-64`).
- **C6** Document open/download/rename/move/delete; choosing the target folder when uploading.
- **C7** Password-reset screens; setup code on signup; active-session list.
- **C8** Transcript editing; un-archive a voice note; create records from a completed shift.

**D. Inconsistencies to resolve while wiring**

- **D1** The record editor lists inactive services and archived participants (`Home.tsx:235`) while the roster and invoice builder filter them.
- **D2** "Save draft" on a Returned record turns it into Draft and hides the reviewer's correction banner (`:155-158,233`).
- **D3** Billables are recomputed from _current_ rates every time the editor renders, even for locked Approved/Invoiced records (`:238`), so old totals drift when a rate changes.
- **D4** Billing ignores `service.unit` (always "Hour") and ignores the `transport` flag (travel is added whenever km > 0) (`:143-149`).
- **D5** `budgetCategoryFor` maps any new service to "Community participation" (`budget-math.ts:13-17`); the Add-service drawer has no category field.
- **D6** Budget "used/pending" ignore plan dates (`budget-math.ts:38-41`), so records from a previous plan period still count.
- **D7** The review queue ANDs "Submitted only" with the status filter, so other statuses can never show (`:219`); the "Service Records" and "Progress Notes" pages are unreachable empty shells (`:218-225,305-307`).
- **D8** Attaching a voice note that has a draft silently overwrites the text of a Draft/Returned record (`:181`).
- **D9** Reviewer edits to billable quantity/rate (`:167,329`) are lost if staff re-save (recalculated).
- **D10** Archived voice notes still appear under "All statuses" although the modal says hidden (`:257,334`); "Generate draft" works with no transcript and invents generic text (`:179`).
- **D11** A service's "Last updated" date does not change when its rate is edited (`:286`).

### 2.5 Scaffolding to remove or replace

- `vite-plugin-manus-runtime`, the Manus debug collector and `/manus-storage` proxy in [vite.config.ts](vite.config.ts), the Manus `allowedHosts`, and `client/public/__manus__/`.
- [client/src/const.ts](client/src/const.ts) `getLoginUrl` (Manus OAuth), [ManusDialog.tsx](client/src/components/ManusDialog.tsx) and [Map.tsx](client/src/components/Map.tsx) — none are used.
- **Hero image is missing from the repo.** `/manus-storage/noble-landing-hero_eb3d80e2.webp` (`PublicPages.tsx:54`, `index.css:149`) was served by Manus storage. Add the file to `client/public/` and update both references, otherwise landing and auth pages show a broken image.
- Analytics placeholders `%VITE_ANALYTICS_ENDPOINT%` in [client/index.html](client/index.html).
- [server/index.ts](server/index.ts): it will be replaced. Note `app.get("*")` is invalid on Express 5 (wildcards must be named, e.g. `/*splat`).
- [package.json](package.json): `start` uses POSIX env syntax; `express@4` and `@types/express@4` must move to v5 in the server package.
- [netlify.toml](netlify.toml): the catch-all `/* → /index.html` rewrite would swallow `/api/*`; the API rule must come first (§8.3).
- `mock-data.ts` runtime exports: move to a seed script; keep only the types (into `shared/`).
- **Prototype disclaimers** to rewrite or delete once wired: `Home.tsx:196,248,254,257,275,286,287,292,294,332,335`, `DocumentLibrary.tsx:133,136,140,152,162`, `ParticipantIntakeDrawer.tsx:107,110`, `Rostering.tsx:104`, `BudgetManager.tsx:108`, `PublicPages.tsx:17,23,34,39,46,58`, and the description in `index.html`.

---

## 3. Target architecture & conventions

### 3.1 Stack

| Concern           | Choice                                                          | Notes                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | Node.js 22 LTS in Docker                                        | Mongoose 9 needs ≥ 20.19; `netlify.toml` already uses 22. Your dev machine runs 24, which is fine.                                                                                 |
| Web framework     | **Express 5** (5.2.x)                                           | Async handlers forward rejected promises to the error handler; wildcard routes must be named; `req.query` is read-only, so validate with Zod and avoid middleware that mutates it. |
| Language          | TypeScript, pinned to the repo's **5.6.3**                      | `latest` on npm is now 7.x — do not jump on one side only.                                                                                                                         |
| Database          | **MongoDB 8** (`mongo` image), replica set `rs0`                | Required for multi-document transactions (invoicing, budget changes, voice↔record links).                                                                                         |
| ODM               | **Mongoose 9** (9.10.x)                                         | Driver 7.x. Middleware takes no `next()` (use async functions); `findOneAndUpdate` uses `returnDocument: "after"`.                                                                 |
| Validation        | **Zod 4** (already in the repo)                                 | Schemas live in `shared/` and are used by the API and by `react-hook-form` on the client.                                                                                          |
| Auth              | Cookies + JWT via `jose`; passwords with `argon2` (argon2id)    | Refresh tokens stored hashed in Mongo.                                                                                                                                             |
| Uploads           | **Multer 2.x** (2.4.0), never 1.x                               | 1.x carries published DoS advisories. Add `file-type` for magic-byte sniffing.                                                                                                     |
| Security          | `helmet`, `express-rate-limit`, `cookie-parser`                 |                                                                                                                                                                                    |
| Logging           | `pino` + `pino-http`                                            | Redact cookies, passwords and tokens.                                                                                                                                              |
| Email             | `nodemailer` → SMTP                                             | Mailpit in dev.                                                                                                                                                                    |
| PDF               | `pdfkit`                                                        | Pure JS, no headless browser in the image.                                                                                                                                         |
| Background jobs   | Small Mongo-backed queue in the API process                     | No Redis for the MVP.                                                                                                                                                              |
| AI (text step)    | `@anthropic-ai/sdk`, default `claude-opus-5-5`, configurable    | Speech-to-text is a **separate** provider (§7.13).                                                                                                                                 |
| Tests             | Vitest (already in the repo), supertest, real Mongo replica set |                                                                                                                                                                                    |
| Client data layer | `@tanstack/react-query` + `axios` (already a dependency)        |                                                                                                                                                                                    |

### 3.2 Runtime topology

```
Browser ──HTTPS──► Caddy (prod)  /  Vite dev server (dev)
                    ├─ /            → SPA static files (history fallback)
                    └─ /api/v1/*    → api:4000  (Express 5)
                                        ├─ MongoDB  mongo:27017  (replica set rs0)
                                        ├─ Uploads volume  /data/uploads  (Multer → disk)
                                        ├─ SMTP (Mailpit in dev)
                                        └─ Providers: speech-to-text (mock / OpenAI-compatible)
                                                      note drafts (mock / Anthropic)
```

The SPA and the API share **one origin** (reverse proxy in prod, Vite proxy in dev). That removes CORS and third-party-cookie problems entirely.

### 3.3 Repository layout

```
noble-community-support-backoffice/
├─ client/                      existing Vite + React app (gains src/api, src/features/*)
├─ shared/                      Zod schemas, DTO types, enums, pure business logic (both sides)
├─ server/                      NEW — Express 5 + TypeScript API
│  ├─ src/
│  │  ├─ app.ts, server.ts      app factory; boot: env → db → jobs → listen
│  │  ├─ config/                env validation (Zod)
│  │  ├─ db/                    connection, indexes, migrations, seed
│  │  ├─ middleware/            auth, role guard, validate, error, rate-limit, request-id, upload
│  │  ├─ lib/                   money, dates/timezone, counters, storage, mailer, pdf, logger, audit
│  │  ├─ providers/             stt/ (mock, openai-compatible)   notes/ (mock, anthropic)
│  │  ├─ jobs/                  queue + workers (transcribe, generate-draft, cleanup)
│  │  └─ modules/               auth · settings · staff · services · participants · service-records
│  │                            roster · budgets · invoices · documents · voice · reports
│  │                            dashboard · activity · notifications · search
│  │                            (each: routes · controller · service · model · schema · mapper · tests)
│  ├─ scripts/                  create-admin, reset-password, seed-demo, backup, restore
│  └─ Dockerfile
├─ deploy/                      Caddyfile, backup script, prod overrides
├─ docker-compose.yml           dev: mongo (replica set), api, mailpit  (+ optional stt profile)
├─ docker-compose.prod.yml      prod: caddy, api, mongo (auth on), backup
├─ .env.example
├─ pnpm-workspace.yaml          root (client) + server
└─ BACKEND_INTEGRATION_PLAN.md  this file
```

`shared/` is already wired as `@shared/*` in `tsconfig.json` and `vite.config.ts`. The server is bundled with esbuild (as the current `build` script already does), which keeps the alias working without `.js` import suffixes.

### 3.4 Conventions (apply to every endpoint)

**Base path and auth.** `/api/v1`. Everything requires an authenticated Admin except routes marked _Public_.

**Identifiers.** All ids are strings on the wire.

| Collection                                               | `_id`                  | Example        |
| -------------------------------------------------------- | ---------------------- | -------------- |
| participants, staff, services, budgets, documents, users | ObjectId hex           | `66f1…`        |
| service records                                          | counter code           | `SR-1048`      |
| invoices                                                 | counter code, per year | `INV-2026-092` |
| voice notes                                              | counter code           | `VN-029`       |
| roster shifts                                            | counter code           | `SH-2406`      |

The UI displays and links by these ids (`SR-1048` and friends), so the codes _are_ the ids. Counters only increment, so numbers are never reused. Invoice numbers are allocated inside the invoice transaction, so a rollback leaves no gap.

**Money.** Stored as **integer cents** (fields end in `Cents`); the API speaks **dollars as numbers with at most 2 decimals**, converted only in each module's mapper. Quantities (hours, km) stay decimal. `subtotal = round(quantity × rate)` at the cent.

**Dates and times.** Business dates are `YYYY-MM-DD` strings and times are `HH:mm` strings in the workspace timezone (`Australia/Adelaide`). This matches the UI, which compares them as strings (`shift.date >= today`, `budget.planEnd < today`). System timestamps (`createdAt`, `updatedAt`, `submittedAt`…) are UTC ISO-8601. "Today" comes from the server (`/meta`, `/auth/me`).

**DTO rule.** Field names match the current TypeScript types (`Participant`, `ServiceRecord`, `Invoice`, `Voice`, `RosterShift`, `ClientBudget`). Deliberate differences:

- `id` values are the ids above; money is dollars; `created`/`updated` become ISO strings.
- `Participant.plan` is derived from `planStart`/`planEnd`; `emergency` is derived from `emergencyName` + `emergencyPhone`.
- `Voice.created` (display text) becomes `createdAt` (ISO) and `duration` (`mm:ss`) is derived from `durationSec`; the client formats both.
- New fields: `rev` on mutable resources, `history[]` on records and invoices, `clientNumber` on participants.

**Errors.** One envelope everywhere; `message` is already user-displayable and reuses the UI's existing wording, so `notify(error.message)` needs no rewrite.

- Shape: `{ error: { code, message, details?, requestId } }`.

| Code                                           | HTTP      | When                                                                                                                                         |
| ---------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`                             | 422       | Zod failure; `details` lists fields                                                                                                          |
| `UNAUTHENTICATED` / `TOKEN_EXPIRED`            | 401       | No/expired access cookie (client refreshes on `TOKEN_EXPIRED`)                                                                               |
| `INVALID_CREDENTIALS`                          | 401       | Wrong email or password (generic)                                                                                                            |
| `ACCOUNT_LOCKED`                               | 423       | Too many failed logins; `details.retryAfterSeconds`                                                                                          |
| `FORBIDDEN`                                    | 403       | Role/permission (future roles) or bad setup code                                                                                             |
| `NOT_FOUND`                                    | 404       |                                                                                                                                              |
| `CONFLICT` and specific codes                  | 409       | `SETUP_ALREADY_COMPLETED`, `NDIS_DUPLICATE`, `SERVICE_NAME_EXISTS`, `SHIFT_OVERLAP`, `BUDGET_EXISTS`, `RECORD_NOT_APPROVED`, `STALE_VERSION` |
| `INVALID_STATE`                                | 409       | Illegal workflow transition (e.g. approving a Draft)                                                                                         |
| `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | 413 / 415 | Upload limits and allow-lists                                                                                                                |
| `RATE_LIMITED`                                 | 429       |                                                                                                                                              |
| `PROVIDER_UNAVAILABLE`                         | 502/503   | Speech-to-text or note-draft provider failed                                                                                                 |
| `INTERNAL`                                     | 500       | Unexpected; details only in logs                                                                                                             |

**Lists.** `?page=1&limit=50` (max 200) → `{ items, page, limit, total }`. `?sort=-date,createdAt`. Filters are documented per endpoint. Search text (`q`) is regex-escaped server-side.

**Optimistic concurrency.** Mutable resources carry an integer `rev`. `PATCH` and workflow actions send the `rev` they read; a mismatch returns `409 STALE_VERSION` ("This record was changed elsewhere. Reload and try again.").

**Audit.** Every mutation writes an `activity_logs` entry (actor, action, entity, participant, human summary). Records and invoices also keep an embedded `history[]`.

---

## 4. Infrastructure: Docker, MongoDB, uploads, environment

### 4.1 Containers

**Development (`docker-compose.yml`)**

| Service                    | Image / build                             | Ports                      | Volumes                                                      | Notes                                                                                                                                                |
| -------------------------- | ----------------------------------------- | -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mongo`                    | `mongo:8`                                 | `127.0.0.1:27017`          | `mongo_data`                                                 | Started with `--replSet rs0`; the healthcheck runs `rs.initiate` once with member host `mongo:27017`, then reports healthy. `api` waits for healthy. |
| `api`                      | `server/Dockerfile` (dev target)          | `4000`                     | `uploads_data` → `/data/uploads`; optional source bind-mount | Env from `.env`.                                                                                                                                     |
| `mailpit`                  | `axllent/mailpit`                         | `8025` (UI), `1025` (SMTP) | —                                                            | Catches password-reset and invoice emails.                                                                                                           |
| `stt` _(optional profile)_ | An OpenAI-compatible transcription server | `8000`                     | model cache                                                  | Only if you self-host speech-to-text (§7.13). Pick and pin the image when you get there.                                                             |

The React app runs on the host with `pnpm dev`; Vite proxies `/api` to `http://localhost:4000`.

**Production (`docker-compose.prod.yml`)**

| Service  | Notes                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caddy`  | Automatic HTTPS. `/api/*` → `api:4000`; everything else → built SPA with history fallback. The only published ports are 80/443.                                                                                                        |
| `api`    | Multi-stage image, non-root user, healthcheck on `/api/v1/health/ready`, `uploads_data` volume, `NODE_ENV=production`.                                                                                                                 |
| `mongo`  | Replica set **with authentication**: a one-shot init container generates the replica-set keyfile into a named volume (mode 400, owned by the `mongodb` user); a least-privilege app user is created on first start. No published port. |
| `backup` | Scheduled `mongodump` plus a tarball of `uploads_data` into a `backups` volume with retention; copy off-host.                                                                                                                          |

**MongoDB connection strings.** Inside Docker: `mongodb://mongo:27017/noble?replicaSet=rs0`. From host tools such as Compass or a host-run API: `mongodb://127.0.0.1:27017/noble?directConnection=true` (otherwise the driver is redirected to the unreachable hostname `mongo`). A plain standalone `mongod` will not work: the invoicing flow needs transactions.

**Windows notes.** Docker Desktop must be running before `docker compose up`. If hot reload does not fire on bind mounts, run the API on the host (`pnpm --filter server dev`) against the containerised Mongo. Keep shell scripts on LF endings (`.gitattributes`).

### 4.2 Environment variables

| Group          | Variable                                                                                                                                                                                                          | Purpose / default                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Core           | `NODE_ENV`, `PORT` (4000), `APP_URL`, `APP_TIMEZONE` (`Australia/Adelaide`), `LOG_LEVEL`                                                                                                                          | `APP_URL` is used in emails and for the `Origin` check                        |
| Mongo          | `MONGO_URI`; prod: `MONGO_INITDB_ROOT_USERNAME/PASSWORD`, `MONGO_APP_USER/PASSWORD`                                                                                                                               |                                                                               |
| Auth           | `JWT_ACCESS_SECRET` (≥ 32 random bytes), `ACCESS_TTL` (15m), `REFRESH_TTL_DAYS` (14), `COOKIE_SECURE`, `COOKIE_DOMAIN` (optional), `PASSWORD_MIN_LENGTH` (8), `LOGIN_MAX_FAILURES` (5), `LOGIN_LOCK_MINUTES` (15) |                                                                               |
| First run      | `SETUP_CODE` (required in production unless `ALLOW_OPEN_SETUP=true`)                                                                                                                                              | Stops a stranger claiming the Admin account on a fresh internet-facing deploy |
| Uploads        | `UPLOADS_DIR` (`/data/uploads`), `MAX_DOC_MB` (25), `MAX_AUDIO_MB` (50), `MAX_FILES_PER_REQUEST` (10)                                                                                                             |                                                                               |
| Email          | `SMTP_HOST/PORT/USER/PASS` (or `SMTP_URL`), `MAIL_FROM`                                                                                                                                                           |                                                                               |
| Speech-to-text | `STT_PROVIDER` (`mock` / `openai` / `local`), `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`                                                                                                                          | Default `mock`                                                                |
| Note drafts    | `NOTE_PROVIDER` (`mock` / `anthropic`), `ANTHROPIC_API_KEY`, `NOTE_MODEL` (default `claude-opus-5-5`)                                                                                                             | Default `mock`                                                                |
| Seed / demo    | `SEED_DEMO_DATA` (false), `DEMO_ENABLED` (false)                                                                                                                                                                  | Demo data only in non-production                                              |
| Client         | `VITE_API_BASE_URL` (default `/api/v1`), `VITE_DEMO_MODE` (false)                                                                                                                                                 | Replaces the Manus `VITE_*` variables                                         |

The server validates its environment with Zod at boot and refuses to start on missing or weak production values.

### 4.3 File storage with Multer

**Layout.** `UPLOADS_DIR/tmp/` (Multer writes here first) → `documents/{yyyy}/{mm}/{uuid}.{ext}` and `voice/{yyyy}/{mm}/{voiceId}.{ext}`. The database stores the _relative_ `storageKey` plus original name, MIME type, size and SHA-256. Files are never served statically.

**Upload pipeline** (same for documents and audio)

1. Multer 2 with disk storage, a generated random filename, and explicit `limits` (`fileSize`, `files`, `fields`, `parts`). Multer errors (`LIMIT_FILE_SIZE`, `LIMIT_UNEXPECTED_FILE`, `LIMIT_PART_COUNT`) map to `413`/`422`.
2. `fileFilter` checks the declared MIME type and extension against the allow-list.
3. After upload, sniff the real type from the file's magic bytes; reject mismatches and delete the temp file.
4. Validate the request (participant exists and is active, folder key valid, and so on).
5. Move the file atomically into its final path, then write the DB row. If the DB write fails, delete the file.
6. A nightly job removes orphaned files in `tmp/` older than 1 hour and reports files with no DB row.

**Limits and types**

| Endpoint                  | Field     | Types                                     | Limit                      |
| ------------------------- | --------- | ----------------------------------------- | -------------------------- |
| `POST /documents`         | `files[]` | pdf, docx, xlsx, csv, txt, jpg, png, webp | 25 MB each, 10 per request |
| `PUT /documents/:id/file` | `file`    | same                                      | 25 MB                      |
| `POST /voice-notes`       | `audio`   | webm, ogg, mp4/m4a, mpeg, wav             | 50 MB, ≤ 60 min            |

**Serving.** Downloads go through authenticated routes that stream the file. Documents are sent with `Content-Disposition: attachment` by default; `?inline=1` is allowed only for PDF/PNG/JPEG/WebP. All responses carry `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. HTML and SVG are never served inline. Audio supports HTTP Range requests so the browser player can seek.

**Backups and encryption.** The uploads volume is part of the backup set. Encrypt the host disk and the backup archives; MongoDB's native at-rest encryption is Enterprise-only, so rely on disk/volume encryption.

---

## 5. Data model

Seventeen collections. Unless noted, each has `createdAt`/`updatedAt`. "Idx" lists indexes beyond `_id`.

**`users`** — `name`, `email` (unique, lower-case), `passwordHash` (argon2id), `role` (`admin`), `status` (`active`/`disabled`), `failedLogins`, `lockedUntil`, `lastLoginAt`, `passwordChangedAt`, `tokenVersion`, `preferences.voice` {`generationTemplate`, `detailLevel`, `autoSaveRecordings`, `useTranscriptOnly`, `notifyDraftReady`}, `preferences.notifications`. Idx: `email` unique.

**`refresh_tokens`** — `userId`, `familyId`, `tokenHash` (SHA-256), `userAgent`, `ip`, `lastUsedAt`, `expiresAt`, `revokedAt`, `replacedByHash`. Idx: `tokenHash`, `userId`, TTL on `expiresAt`.

**`password_resets`** — `userId`, `tokenHash`, `expiresAt`, `usedAt`, `requestedIp`. Idx: `tokenHash`, TTL on `expiresAt`.

**`workspace`** (single document, `_id: "workspace"`) — `name`, `legalName`, `abn`, `address`, `phone`, `email`, `timezone`, `currency` (AUD), `gst` {`registered`, `ratePct`}, `invoice` {`prefix`, `defaultPaymentTermsDays`, `footer`, `paymentInstructions`}, `providerTravelRateCents` (per km), `budgetCategories[]` (default: Community participation, Daily living skills, Support coordination), `setupCompletedAt`.

**`staff`** — `name`, `position`, `team`, `email`, `phone`, `status` (`Active`/`On leave`), `userId?`, `notes`; virtual `initials`. Idx: `status`, `email` (unique, sparse). Staff are operational contacts, **not** login users (the Staff page says so).

**`services`** — `name` (unique, case-insensitive collation), `unit` (`Hour`/`Session`/`Item`/`Kilometre`), `rateCents`, `transportEnabled`, `transportUnit` (`Kilometre`/`Hour`/null), `budgetCategory`, `supportItemNumber?`, `active`, `rateHistory[]` {`rateCents`, `changedAt`, `changedBy`}.

**`participants`**

- Identity/contact: `name`, `preferred`, `ndis` (9 digits, unique), `dob`, `phone`, `email`, `address`, `clientNumber` (int from a counter; drives the "Client 001 – AC" folder name).
- Plan: `planStart`, `planEnd`, `manager` (name or "Self-managed"), `managerEmail?`, `nominee`.
- NDIS support coordinator (all optional): `coordinatorName?`, `coordinatorOrg?`, `coordinatorPhone?`, `coordinatorEmail?`.
- Emergency: `emergencyName`, `emergencyPhone`. Lists: `alerts[]`, `goals[]`.
- Support text: `communication`, `mobility`, `transport`, `support`, `risks`, `allergies`, `preferences`.
- `kyc` {`serviceAgreement`, `consentForms`, `supportPlan`, `riskInformationReviewed`, `transportRequirementsConfirmed`}, `status` (`Active`/`Archived`), `archivedAt`, `archivedReason`, `createdBy`.
- Idx: `ndis` unique, `{status, name}`.

**`service_records`**

- Keys: `_id` (`SR-####`), `clientId`, `staffId`, `serviceId`, `shiftId?`, `voiceNoteId?`, `invoiceId?`.
- Snapshots: `type` (service name), `budgetCategory`, `unit`.
- When/where: `date`, `start`, `end`, `location`, `km`, `quantity?`.
- Narrative: `support`, `response`, `outcome`, `observations`, `followUp`. Declaration: `confirmed`, `confirmedAt`.
- Money: `billables[]` {`label`, `unit`, `quantity`, `rateCents`, `subtotalCents`}, `totalCents`, `billablesFrozenAt`.
- Workflow: `status` (`Draft`/`Submitted`/`Returned`/`Approved`/`Invoiced`), `correction`, `submittedAt/By`, `reviewedAt/By`, `approvedBy` {id, name}, `returnedAt`, `history[]` {`at`, `by`, `action`, `note`}, `rev`, `createdBy`.
- Idx: `{clientId, date desc}`, `{status, date desc}`, `{staffId, date desc}`, `{invoiceId}`, `{date desc}`.

**`invoices`**

- `_id` (`INV-YYYY-###`), `clientId`, `recordIds[]`, `status` (`Draft`/`Ready to send`/`Sent`/`Paid`/`Void`).
- Snapshots taken at creation: `recipient`, `recipientEmail?`, `billTo` {name, address, ndis}, `supplier` {legalName, abn, address, …}.
- `issue`, `due`, `paymentTermsDays`, `lines[]` {`label`, `unit`, `quantity`, `rateCents`, `subtotalCents`, `recordId`}, `subtotalCents`, `taxCents`, `totalCents`, `notes`.
- `sentAt`, `emailedAt?`, `paidAt`, `paidReference`, `voidedAt`, `voidReason`, `history[]`, `rev`.
- Idx: `{status, issue desc}`, `{clientId, issue desc}`.

**`roster_shifts`** — `_id` (`SH-####`), `date`, `start`, `end`, `ratio` (`1:1`/`1:M`/`M:M`), `clientIds[]`, `staffIds[]`, `serviceId`, `type` (snapshot), `location`, `notes`, `status` (`Planned`/`Confirmed`/`Completed`/`Cancelled`), `recordIds[]`, `rev`, `createdBy`. Idx: `{date, status}`, `{clientIds, date}`, `{staffIds, date}`.

**`budgets`** — `clientId`, `planStart`, `planEnd`, `categories[]` {`name`, `allocationCents`}, `isCurrent`, `confirmedAgainstPlanAt`, `rev`, `createdBy`. Idx: unique partial on `clientId` where `isCurrent`.

**`budget_adjustments`** — `budgetId`, `clientId`, `category`, `oldAllocationCents`, `newAllocationCents`, `reason`, `by`, `at`.

**`voice_notes`**

- `_id` (`VN-###`), `clientId`, `recordId?`, `staffId?`, `recordedBy` {id, name}, `title`, `durationSec`.
- `audio` {`storageKey`, `mimeType`, `size`, `sha256`} (null in demo data).
- `transcript` {`text`, `status` (`Not transcribed`/`Processing`/`Ready`/`Unavailable`), `provider`, `language`, `error`, `updatedAt`}.
- `generation` {`status` (`Not generated`/`Processing`/`Draft ready`/`Failed`), `template`, `sections[]`, `detailLevel`, `transcriptOnly`, `provider`, `model`, `error`, `generatedAt`}.
- `draft` {`support`, `response`, `outcome`, `observations`, `followUp`}, `status` (`Saved`/`Draft ready`/`Archived`), `archivedAt`, `rev`.
- Idx: `{clientId, createdAt desc}`, `{status}`.

**`documents`** — `scope` (`participant`/`organisation`), `participantId?`, `folderKey`, `title`, `notes`, `docDate?`, `kind` (`file`/`template-slot`), `slotKey?`, `file` {`storageKey`, `originalName`, `mimeType`, `size`, `sha256`} or null, `uploadedBy`, `deletedAt?`. Idx: `{scope, participantId, folderKey}`.

- Participant folder keys: `agreement` (02), `plans` (03), `incidents` (05), `correspondence` (07). Folders 01 (profile), 04 (progress notes) and 06 (transport) are _virtual_, built from participants and records.
- Organisation folder keys: `policies`, `insurance`, `worker-checks`, `ndis`, `templates`. Finance/Xero is a virtual "external" node.

**`counters`** — `_id` (`serviceRecord`, `shift`, `voiceNote`, `participant`, `invoice:<year>`), `seq`.

**`activity_logs`** — `at`, `actor` {id, name}, `action`, `entityType`, `entityId`, `participantId?`, `summary`, `meta`, `ip?`. Append-only. Idx: `{at desc}`, `{entityType, entityId}`, `{participantId, at desc}`.

**`jobs`** — `type` (`transcribe`/`generate-draft`/`cleanup`), `payload`, `status` (`queued`/`running`/`done`/`failed`), `attempts`, `maxAttempts`, `runAt`, `lockedAt`, `lastError`. Idx: `{status, runAt}`.

_(A `notifications` collection is optional; the MVP computes notifications on demand.)_

---

## 6. Business rules that move to the server

### 6.1 Service-record workflow

| From             | Action                              | To           | Guard                                                                                                                | Effects                                                                            |
| ---------------- | ----------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| —                | create                              | Draft        | Participant and staff Active; service Active; end > start                                                            | Allocate `SR-####`; compute billables; history                                     |
| Draft            | edit                                | Draft        | —                                                                                                                    | Recompute billables                                                                |
| Returned         | edit                                | **Returned** | —                                                                                                                    | Recompute billables; the correction banner stays visible (D2)                      |
| Draft / Returned | **submit**                          | Submitted    | All five narrative sections non-blank; declaration ticked; duration > 0; km > 0 only if the service allows transport | Freeze billables; set `submittedAt/By`; counts as budget "pending"                 |
| Submitted        | **approve**                         | Approved     | —                                                                                                                    | `approvedBy/At`; billables frozen including reviewer adjustments; counts as "used" |
| Submitted        | **return** (reason required)        | Returned     | Reason non-blank                                                                                                     | Store `correction`; history                                                        |
| Submitted        | adjust billables                    | Submitted    | quantity ≥ 0, rate ≥ 0                                                                                               | Recompute subtotal; history `billables_adjusted`                                   |
| Approved         | invoice (via invoice creation only) | Invoiced     | Same client, still Approved                                                                                          | Set `invoiceId`                                                                    |
| Invoiced         | invoice deleted or voided           | Approved     | —                                                                                                                    | Clear `invoiceId`                                                                  |

Submitted, Approved and Invoiced records are **locked** — no field edits (D9: reviewer billable adjustments are the only exception, and only while Submitted). Anything else returns `INVALID_STATE`.

### 6.2 Billing formulas

- **Hours** = `round((end − start in minutes) / 6) / 10`, i.e. the nearest 0.1 h; must be > 0.
- **Service line**: unit Hour → quantity = hours; Session/Item → quantity from the record's `quantity` field (default 1). Rate = the service's current rate, looked up on create/edit and frozen at submit (D3, D4).
- **Travel line** (only if km > 0 and the service allows transport): label "Provider travel", unit Kilometre, quantity = km, rate = workspace `providerTravelRate` (default $1.00, D4).
- `subtotal = round(quantity × rate)` in cents. **Record total** = sum of subtotals.

### 6.3 Budget metrics (per participant, per category, "as of today" in the workspace timezone)

- **allocation**: as configured.
- **used** = total of Approved + Invoiced records in that category with `date` inside the plan window (D6).
- **pending** = total of Submitted records in that category inside the window.
- **committed** = for Planned/Confirmed shifts including the participant with `date ≥ today` and inside the window: hours × the service's current rate, **per participant** (the UI's rule).
- **remaining** = allocation − used − pending − committed. Overall figures are the sums across categories.
- **Status**: "Plan expired" if `planEnd < today`; else "Over allocation" if remaining < 0; else "Low balance" if remaining < 15% of allocation; else "Within plan". Per-category bar colours use the same thresholds.
- A record's or shift's category = its service's `budgetCategory` snapshot (D5).

### 6.4 Roster rules

- **Ratios**: `1:1` = exactly 1 participant and 1 staff; `1:M` = 1 staff and ≥ 2 participants; `M:M` = ≥ 2 staff and ≥ 2 participants.
- End must be later than start. Only Active participants and Active staff can be assigned. Only active services can be chosen.
- **Overlap**: a new or edited shift conflicts with any other non-cancelled shift on the same date whose time range overlaps _and_ which includes any of the same participants (`SHIFT_OVERLAP`, resource = participant) or any of the same staff (resource = staff). The response names the conflicting shift id.
- **Status flow**: Planned ⇄ Confirmed → Completed; Planned/Confirmed → Cancelled; Cancelled → Planned. Completed is final and locks edits. Delete only when Planned or Cancelled and no records are linked.
- **Budget impact** is returned as non-blocking `warnings[]` (e.g. "Mia's Community participation budget would be $120.00 over allocation").

### 6.5 Invoice rules

- **Eligibility**: every selected record is Approved, belongs to the chosen participant, and is not already invoiced. The participant must be Active.
- **Lines**: every billable of every selected record, labelled `"<label> — <d MMM>"` (e.g. "Community participation — 18 Sep").
- **Totals**: subtotal = sum of lines; tax = subtotal × workspace GST rate (default 0, NDIS supports are typically GST-free — confirm with your accountant); total = subtotal + tax.
- **Dates**: `issue` defaults to today; `due` = issue + payment terms (7/14/30 days, default from workspace).
- **Recipient**: the participant's plan manager; if the manager is blank or "Self-managed", the participant (or nominee).
- **Number**: `INV-<issue year>-<seq, 3 digits>`, allocated in the same transaction that marks the records Invoiced.
- **Status flow**: Draft → Ready to send → Sent → Paid. Draft can be deleted; Ready/Sent can be voided with a reason. Delete or void reverts the records to Approved. Once Sent, lines are immutable.
- **PDF** is rendered from the invoice's own snapshots, so later profile edits never change an issued invoice. Title reads "Tax invoice" only if the workspace is GST-registered, otherwise "Invoice".

### 6.6 Voice rules

- **Upload**: participant Active; `recordId` (if given) must belong to the same participant.
- **Transcription** is asynchronous: `Not transcribed` → `Processing` → `Ready` or `Unavailable` (with an error; retry allowed). The `mock` provider marks its text `provider: "mock"` and the UI shows a "Demo transcript" chip.
- **Draft generation requires a transcript** (`422 TRANSCRIPT_REQUIRED`) — the model must never invent events (D10). With `transcriptOnly` on, only facts present in the transcript are used and unsupported sections stay empty; with it off, the participant's goals and support needs may inform the "Goal / outcome" wording, but never invented events or observations.
- **Data minimisation for AI**: send the transcript, the participant's preferred first name, goals and support needs only — never NDIS number, date of birth, address, phone or email.
- **Drafts are never submitted or approved automatically.** Applying a draft to a record is an explicit action (`applyDraft: true`) and is logged in the record's history as an AI-assisted edit (D8).
- **Linking** is one-to-one in both directions: linking a note to a record replaces any previous link on either side.
- **Deleting** a note hard-deletes the audio and row, and is refused (`409`) if it is linked to a Submitted/Approved/Invoiced record — archive instead. Archived notes are hidden unless `status=Archived` or `all` (D10).

### 6.7 Numbering

| Thing          | Format                              | Counter key      |
| -------------- | ----------------------------------- | ---------------- |
| Service record | `SR-####` (starts at 1001)          | `serviceRecord`  |
| Invoice        | `INV-<year>-###` (resets each year) | `invoice:<year>` |
| Voice note     | `VN-###`                            | `voiceNote`      |
| Roster shift   | `SH-####` (starts at 2401)          | `shift`          |
| Client number  | `Client 001`                        | `participant`    |

### 6.8 Validation parity (server reuses the UI's wording)

| Rule                                         | Message                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NDIS number not 9 digits                     | "Enter the 9-digit NDIS number."                                                                                                                                                                                                                                                                                                                          |
| Plan end before start                        | "The plan end date must be on or after the start date."                                                                                                                                                                                                                                                                                                   |
| Password too short                           | "Choose a password with at least 8 characters."                                                                                                                                                                                                                                                                                                           |
| Service name blank / duplicate / bad rate    | "Enter a service name." · "A service with this name already exists." · "Enter a valid non-negative rate."                                                                                                                                                                                                                                                 |
| Submit without declaration / incomplete note | "Please confirm the staff declaration before submitting." · "Complete all progress note sections before submitting."                                                                                                                                                                                                                                      |
| Invoice with no records                      | "Select at least one approved service record."                                                                                                                                                                                                                                                                                                            |
| Shift rules                                  | "Choose a date and an end time later than the start time." · "A 1:1 shift requires exactly one participant and one staff member." · "A 1:M shift requires one staff member and at least two participants." · "An M:M shift requires at least two staff members and two participants." · "Assign at least one participant and one available staff member." |
| Shift overlap                                | "A participant is already rostered during this time (SH-xxxx). Resolve the overlap before saving." · "A staff member is already assigned during this time (SH-xxxx). Resolve the overlap before saving."                                                                                                                                                  |
| Budget setup/adjust                          | "Choose a valid plan start and end date." · "Confirm the amounts against the approved client plan before saving." · "Enter at least one positive category allocation." · "Enter a valid non-negative allocation amount." · "Add a reason for this allocation change."                                                                                     |

---

## 7. Module plans — API mapped to the UI

`Ph` is the build phase in §10; `L` means later/optional. "Wires to" names the UI file and handler to change. All paths are relative to `/api/v1`.

### 7.1 Public site & first run

**UI today:** `PublicPages.tsx` renders Landing/Login/Signup from local `screen` state; `Home.tsx:338` shows it whenever `adminPreview` is false.

| Ph  | Endpoint                         | Request → response                                                                            | Wires to                                                   |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0   | `GET /health` _(Public)_         | Liveness → `{status}`                                                                         | Docker healthcheck                                         |
| 0   | `GET /health/ready` _(Public)_   | Mongo ping + uploads dir writable                                                             | Deploy readiness                                           |
| 1   | `GET /meta` _(Public)_           | → `{version, today, timezone, features{email, sttProvider, noteProvider, xero}, demoEnabled}` | App boot: `today`, banners for mock providers, demo button |
| 1   | `GET /auth/bootstrap` _(Public)_ | → `{setupRequired, setupCodeRequired}`                                                        | Landing CTAs and login↔signup switch                      |

**Wiring**

- "Create Admin account" buttons (`PublicPages.tsx:53,57,58`) and "Need to set up the workspace?" (`:43`) render only while `setupRequired`.
- "Explore the Admin workspace" / "Open the Admin preview" (`:31,45,54,58`) render only when `demoEnabled`; otherwise show "Sign in".
- Add the hero image to `client/public/` and fix both references.
- Add routes: `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/app/*` (guarded).

**The first-run journey this plan makes possible:** deploy → open the site → sign up with the setup code → set workspace details → add services and staff → add a participant → set their budget → roster a shift → write, submit and approve a record → invoice it → record a voice note → upload documents.

### 7.2 Signup — the first (and only) Admin

**UI today:** `submitSignup` (`PublicPages.tsx:19-24`) checks length ≥ 8 and matching passwords, then shows "Account creation is not connected". Name and email inputs are uncontrolled.

| Ph  | Endpoint                                                 | Request → response                                                                                                                                            | Wires to       |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | `POST /auth/signup` _(Public, only while setup is open)_ | `{name, email, password, setupCode?}` → 201 `{user, workspace}` + auth cookies. Errors: `409 SETUP_ALREADY_COMPLETED`, `403` invalid setup code, `422`, `429` | `submitSignup` |

**Server behaviour**

1. Validate with the shared Zod schema. If `SETUP_CODE` is configured, compare it in constant time.
2. **Atomically claim the workspace**: one upsert on the single `workspace` document, guarded by `setupCompletedAt` being empty. Concurrent signups produce exactly one winner; the rest get 409.
3. Hash the password (argon2id), create the user with role `admin`, create the workspace defaults, issue cookies, write `auth.signup` to the activity log.
4. Never seed sample rates or participants in production; demo data is opt-in (`SEED_DEMO_DATA`).

**Wiring:** controlled form fields; show the server's `message` in the existing `notice` box; on success navigate to `/app`. Add a "Setup code" field shown only when `setupCodeRequired`. In production the server refuses to boot without `SETUP_CODE` unless `ALLOW_OPEN_SETUP=true`.

### 7.3 Login, session, logout

**UI today:** `submitLogin` (`PublicPages.tsx:15-18`) shows a notice; the logout icon (`Home.tsx:184`) just flips `adminPreview`.

| Ph  | Endpoint                      | Request → response                                                                                       | Wires to                                     |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | `POST /auth/login` _(Public)_ | `{email, password}` → `{user}` + cookies. Errors: `401 INVALID_CREDENTIALS`, `423 ACCOUNT_LOCKED`, `429` | `submitLogin`                                |
| 1   | `POST /auth/refresh`          | Rotates the refresh cookie → new cookies; reuse of an already-rotated token revokes the whole family     | axios interceptor                            |
| 1   | `POST /auth/logout`           | Revokes the current refresh token, clears cookies → 204                                                  | Header logout icon                           |
| 1   | `POST /auth/logout-all`       | Revokes every session                                                                                    | Settings → Privacy & access                  |
| 1   | `GET /auth/me`                | → `{user, workspace{name, timezone, today}, preferences}`                                                | App boot: restores the session after refresh |
| 1   | `GET /auth/sessions`          | Active sessions (device, IP, last used)                                                                  | Settings → Privacy & access                  |
| 1   | `DELETE /auth/sessions/:id`   | Revoke one session                                                                                       | Same                                         |

**Session design**

- Two httpOnly cookies: `noble_access` (15 min, path `/`) and `noble_refresh` (14 days, path `/api/v1/auth`), both `SameSite=Lax`, `Secure` in production. **No tokens in `localStorage`.**
- The access token carries `sub`, `role`, `sid` and `tv` (the user's `tokenVersion`); the auth middleware loads the user, so disabling an account or changing a password takes effect immediately.
- Refresh tokens are random values stored **hashed** with a `familyId`. Each refresh rotates the token; presenting a rotated token again revokes the family.
- After 5 failed logins the account locks for 15 minutes; login and refresh are also rate-limited per IP. Error messages never reveal whether an email exists.
- State-changing requests must also pass an `Origin` check against `APP_URL`.

**Wiring:** add `AuthProvider` (calls `/auth/me` on load), a `ProtectedRoute` for `/app/*`, and an axios response interceptor that on `TOKEN_EXPIRED` calls `/auth/refresh` once (single-flight) and retries, else redirects to `/login`. Replace `currentName` and the hard-coded role in the header and sidebar (`Home.tsx:105,184,185`) with the signed-in user.

### 7.4 Password reset & change

**UI today:** "Forgot password?" only shows a notice (`PublicPages.tsx:39`). There are no reset screens.

| Ph  | Endpoint                                | Request → response                                                                                          | Wires to                                         |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `POST /auth/forgot-password` _(Public)_ | `{email}` → always 202 (no user enumeration). If the user exists, emails a single-use link valid 30 minutes | "Forgot password?" → new `/forgot-password` page |
| 1   | `POST /auth/reset-password` _(Public)_  | `{token, password}` → 204; revokes all sessions                                                             | New `/reset-password?token=` page                |
| 1   | `POST /auth/change-password`            | `{currentPassword, newPassword}` → 204; revokes other sessions                                              | Settings → My profile                            |
| 1   | `PATCH /auth/me`                        | `{name}` → user                                                                                             | Settings → My profile                            |

If SMTP is not configured the server logs a warning at boot; the CLI `scripts/reset-password` is the break-glass path for the single Admin. Reset and change events are audit-logged and rate-limited.

### 7.5 Dashboard

**UI today:** `dashboard()` (`Home.tsx:187-198`).

| Ph  | Endpoint         | Request → response         | Wires to                                     |
| --- | ---------------- | -------------------------- | -------------------------------------------- |
| 9   | `GET /dashboard` | One aggregate call (below) | Replaces the derived values in `dashboard()` |

Response contents:

- `kpis`: `awaitingReview` (Submitted), `needsCompletion` (Draft + Returned), `readyToInvoice` (Approved), `activeParticipants`.
- `actionQueue`: up to 4 items (Returned first, then Submitted, then Draft) with record id, status, participant, date.
- `todayShifts`: today's rostered shifts (max 3) — fixes B7; falls back to today's records if none.
- `documentationHealth`: `{completePct, complete, total}` for records dated in the last 7 days, where "complete" means Submitted, Approved or Invoiced — replaces the hard-coded 86%.
- `billing`: `{awaitingInvoice, draftInvoices, outstanding}`.
- `recentActivity`: last 5 activity entries ("Maya Thompson approved SR-1048").

A reduced version can ship earlier by wiring the tiles to `GET /service-records/counts`.

### 7.6 Rostering

**UI today:** `Rostering.tsx` — the week board, ratio filter, KPIs (computed from the week's shifts, which stay client-side), and the create/edit drawer.

| Ph  | Endpoint                                 | Request → response                                                                                                                                                                                                                          | Wires to                                                           |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 5   | `GET /roster/shifts`                     | `from`, `to` (Mon–Sun), `ratio`, `clientId`, `staffId`, `status` → shifts                                                                                                                                                                   | Board; week arrows change `from`/`to`                              |
| 5   | `POST /roster/shifts`                    | `{date, start, end, ratio, clientIds[], staffIds[], serviceId, location, notes?}` → 201 shift (Planned) + `warnings[]`. Errors: `422` ratio/time rules, `409 SHIFT_OVERLAP` (with conflicting id), `422` inactive staff/participant/service | `saveShift` → "Save planned shift"                                 |
| 5   | `GET /roster/shifts/:id`                 | → shift                                                                                                                                                                                                                                     | Deep links                                                         |
| 5   | `PATCH /roster/shifts/:id`               | same fields + `rev` → shift                                                                                                                                                                                                                 | `saveShift` → "Update shift"                                       |
| 5   | `POST /roster/shifts/:id/status`         | `{status}` → shift (rules in §6.4)                                                                                                                                                                                                          | **New** Confirm / Complete / Cancel buttons on the shift card (C3) |
| 5   | `DELETE /roster/shifts/:id`              | Planned/Cancelled only                                                                                                                                                                                                                      | **New** Delete in the drawer                                       |
| 5   | `POST /roster/shifts/validate`           | Same body, dry run → `{errors[], warnings[]}`                                                                                                                                                                                               | Live warnings in the drawer's assignment summary                   |
| L   | `POST /roster/shifts/:id/create-records` | Completed shift → one Draft service record per participant, prefilled                                                                                                                                                                       | **New** "Create records" on completed shifts (C8)                  |

**Wiring:** replace the `shifts`/`onShiftsChange` props with a query keyed by week and mutations; `freshDraft` defaults (`p1`/`s1`) become the first active participant/staff (B3); the ratio helper `changeRatio` stays client-side for convenience but the server is authoritative; map error codes to `formError`. Service choices come from `GET /services?active=true`.

### 7.7 Clients (participants)

**UI today:** `clientsPage` (`Home.tsx:200-203`), `ParticipantIntakeDrawer.tsx`, `profilePage` (`:205-216`).

| Ph  | Endpoint                         | Request → response                                                                                                                                              | Wires to                                                                                     |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 3   | `GET /participants`              | `status` (Active default / Archived / all), `q`, `page`, `limit` → list (id, name, preferred, ndis, support, manager, alerts, status, plan dates, clientNumber) | Clients table filter and search; also every participant dropdown (`status=Active&limit=200`) |
| 3   | `POST /participants`             | Intake payload → 201 full profile. Errors: `422` NDIS/plan dates, `409 NDIS_DUPLICATE`                                                                          | `ParticipantIntakeDrawer.submit` → `createParticipant`                                       |
| 3   | `GET /participants/:id`          | → full profile                                                                                                                                                  | `openProfile` and the tabs                                                                   |
| 3   | `PATCH /participants/:id`        | Partial profile + `rev` → profile                                                                                                                               | **New** "Edit profile" (reuse the intake form) (C1)                                          |
| 3   | `POST /participants/:id/archive` | `{reason?}` → profile + `warnings[]` (e.g. "2 planned shifts remain")                                                                                           | **New** menu action (C1)                                                                     |
| 3   | `POST /participants/:id/restore` | → profile                                                                                                                                                       | **New**                                                                                      |
| 3   | `PATCH /participants/:id/kyc`    | Any of the five booleans → profile                                                                                                                              | **New** checklist on Overview / Documents (C1)                                               |

**Rules:** NDIS stored as 9 digits, returned formatted `### ### ###`, unique. Archived participants keep all history but can't receive new records, shifts, invoices or voice notes; they are excluded from Active dropdowns (D1). Alerts and goals are arrays (the client keeps splitting the textarea lines). Profile tabs reuse other modules: Service Records / Progress Notes → `GET /service-records?clientId=`; Budget → §7.9; Documents → §7.10.

### 7.8 Service records & the review queue

**UI today:** editor (`Home.tsx:227-241`), review queue (`:218-225`), review drawer (`:329`), return modal (`:331`), `saveRecord`, `changeRecordStatus`, `updateBillable`.

| Ph  | Endpoint                               | Request → response                                                                                                                                                                                | Wires to                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 4   | `GET /service-records`                 | `status`, `clientId`, `staffId`, `serviceId`, `team`, `q`, `from`, `to`, page/sort → list with derived `hours`, `total`                                                                           | Review queue table, profile tabs, dashboard queue                                  |
| 4   | `GET /service-records/counts`          | `clientId?` → `{Draft, Submitted, Returned, Approved, Invoiced}`                                                                                                                                  | "N awaiting review" badge, dashboard tiles                                         |
| 4   | `POST /service-records`                | `{clientId, staffId, serviceId, date, start, end, location, support, response, outcome, observations, followUp, km, quantity?, confirmed, voiceNoteId?}` → 201 Draft with `SR-####` and billables | `startNewRecord` + first "Save draft"                                              |
| 4   | `GET /service-records/:id`             | → record incl. `history[]`                                                                                                                                                                        | `openRecord`; audit box in the review drawer (replaces the derived "Submitted by") |
| 4   | `PATCH /service-records/:id`           | Partial + `rev` (Draft/Returned only) → record with recomputed billables                                                                                                                          | `updateEditor` → "Save draft"                                                      |
| 4   | `POST /service-records/:id/submit`     | `{rev}` → Submitted                                                                                                                                                                               | "Submit for review"                                                                |
| 4   | `POST /service-records/:id/approve`    | `{rev}` → Approved                                                                                                                                                                                | Review drawer "Approve record"                                                     |
| 4   | `POST /service-records/:id/return`     | `{reason, rev}` → Returned                                                                                                                                                                        | `submitReturn`                                                                     |
| 4   | `PATCH /service-records/:id/billables` | `{lines:[{index, quantity?, rate?}], rev}` (Submitted only) → record                                                                                                                              | `updateBillable` — send on blur, not per keystroke                                 |
| L   | `DELETE /service-records/:id`          | Draft only                                                                                                                                                                                        | **New** delete for drafts                                                          |

**Wiring**

- The editor's live "Billable breakdown" and duration keep using the shared pure functions for instant feedback; the saved values always come from the server.
- Locked records (Submitted/Approved/Invoiced) show stored billables, not recomputed ones (D3).
- Review queue: default `status=Submitted` with a working status filter (D7); delete the unreachable "Service Records"/"Progress Notes" page shells.
- Record-editor dropdowns use only Active participants, Active staff and active services (D1). Show a "Quantity" input when the chosen service's unit is Session or Item (D4).
- "Save draft" on a Returned record keeps it Returned (D2).

### 7.9 Budgets (client profile → Budget tab)

**UI today:** `BudgetManager.tsx`, plus `computeBudgetMetrics` in `budget-math.ts`.

| Ph  | Endpoint                                    | Request → response                                                                                                                                              | Wires to                                           |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 5   | `GET /participants/:id/budget`              | → `{budget or null, metrics or null}`; `metrics` = per-category and overall allocation/used/pending/committed/remaining, `status`, `asOf`                       | `BudgetManager` props (replaces client-side maths) |
| 5   | `PUT /participants/:id/budget`              | Initial setup `{planStart, planEnd, categories[{name, allocation}], confirmedAgainstPlan: true}` → 201. `409 BUDGET_EXISTS`. Syncs the participant's plan dates | `saveInitialBudget`                                |
| 5   | `POST /participants/:id/budget/adjustments` | `{category, allocation, reason}` → budget                                                                                                                       | `saveAdjustment` — the reason is now stored (C5)   |
| 5   | `GET /participants/:id/budget/adjustments`  | Change history                                                                                                                                                  | **New** small "Change history" list                |
| L   | `PATCH /participants/:id/budget/plan`       | `{planStart, planEnd}`                                                                                                                                          | **New**                                            |
| L   | `POST /participants/:id/budget/renew`       | Archives the current budget, creates the next plan                                                                                                              | **New** (C5)                                       |
| 9   | `GET /budgets/overview`                     | All participants' budget health                                                                                                                                 | Dashboard alerts; feeds notifications              |

**Rules:** formulas in §6.3. Categories must come from the workspace category list. Setup requires end ≥ start and at least one positive amount. Budgets stay attached to a single participant (the UI copy already says so).

### 7.10 Documents — client documents and Organisation files

**UI today:** `DocumentLibrary.tsx` builds a virtual tree in the browser. Two modes: per-participant (profile → Documents) and organisation-only (sidebar → Organisation files). Uploads are "not connected".

| Ph  | Endpoint                                 | Request → response                                                                                                                                                                                | Wires to                                                                                                                       |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 7   | `GET /participants/:id/documents/tree`   | Server-built tree: fixed folders 01–07 (see below), KYC badges, real years/months, record links → nodes `{id, title, description, kind, badge, count, children, recordId, documentId, folderKey}` | Replaces `makeParticipantFolder`; fixes B6                                                                                     |
| 7   | `GET /documents/tree?scope=organisation` | Business documents (Policies & Procedures, Insurance, Worker Checks, NDIS Documents), Finance (Xero placeholder), Templates (4 slots)                                                             | Replaces `buildLibrary`                                                                                                        |
| 7   | `GET /documents`                         | `scope`, `participantId`, `folderKey`, `q` → files in a folder                                                                                                                                    | Opening a leaf folder                                                                                                          |
| 7   | `POST /documents`                        | **multipart**: `scope`, `participantId?`, `folderKey`, `title?`, `notes?`, `docDate?`, `files[]` → 201 documents                                                                                  | "Upload document" / "Add document" (`DocumentLibrary.tsx:140`) — opens a new upload dialog with the current folder preselected |
| 7   | `GET /documents/:id`                     | Metadata                                                                                                                                                                                          | File card                                                                                                                      |
| 7   | `GET /documents/:id/download`            | Streams the file (`?inline=1` for PDF/images)                                                                                                                                                     | **New** open/download on file cards (C6)                                                                                       |
| 7   | `PATCH /documents/:id`                   | `{title?, notes?, folderKey?, docDate?}`                                                                                                                                                          | **New** rename/move                                                                                                            |
| 7   | `DELETE /documents/:id`                  | Soft delete (`deletedAt`); a 30-day purge job is optional                                                                                                                                         | **New**                                                                                                                        |
| 7   | `PUT /documents/:id/file`                | **multipart** `file` — attach or replace on a template slot                                                                                                                                       | Template cards ("No file attached" → Upload)                                                                                   |
| L   | `GET /integrations/xero/status`          | `{connected: false}`                                                                                                                                                                              | Xero node; a real integration is a later, separate project                                                                     |

**Tree rules**

- Participant folders: `01 Participant Profile` (reference link to the profile), `02 Service Agreement & Consent`, `03 Support Plans & Goals`, `04 Progress Notes` (year → month → linked records), `05 Incidents & Hazards`, `06 Transport & Kilometres` (year → month → records with km > 0), `07 Correspondence`. Folders 02, 03, 05, 07 hold uploaded files; 01, 04, 06 are virtual links, not copies.
- Badges come from the KYC flags (Received/Pending, Reviewed/Check required, Confirmed/Pending). **Uploading a file does not tick a KYC box**; the KYC checklist stays an explicit Admin action, and the tree shows both the badge and the file count.
- The folder title "Client 001 – AC" uses the stable `clientNumber`, so archiving or reordering never renames folders.
- Organisation library: four business folders, the Finance/Xero external node, and four template slots (Progress Note Template, Incident Report, Service Agreement, Consent Forms) seeded as `template-slot` documents with no file.

### 7.11 Services & rates

**UI today:** `servicesPage` (`Home.tsx:286`) with inline edits, and the Add-service drawer (`:287`, `saveNewService`).

| Ph  | Endpoint               | Request → response                                                                                                                                      | Wires to                                                             |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2   | `GET /services`        | `active=true/false/all` → services                                                                                                                      | Services table; record editor, roster and rate lookups (active only) |
| 2   | `POST /services`       | `{name, unit, rate, transport, transportUnit, active, budgetCategory, supportItemNumber?}` → 201. `409 SERVICE_NAME_EXISTS`, `422`                      | `saveNewService`                                                     |
| 2   | `PATCH /services/:id`  | `{rate?, transport?, transportUnit?, active?, budgetCategory?, name?}` → service; rate changes are appended to `rateHistory`; `updatedAt` changes (D11) | Inline edits + the check-mark "Save rate"                            |
| L   | `DELETE /services/:id` | Only if never used; otherwise `409` (deactivate instead)                                                                                                | **New**                                                              |

**Wiring:** keep table edits as local drafts and send them on "Save rate" (or on blur). Add a **Budget category** select to the Add-service drawer (D5). Rate changes affect only _new_ records and shifts — existing records keep their frozen billables.

### 7.12 Invoices

**UI today:** register (`Home.tsx:243`), builder drawer (`:244-249`), preview (`:250-255`), `createInvoice`, `updateInvoiceStatus`.

| Ph  | Endpoint                        | Request → response                                                                                                                                                        | Wires to                                                                             |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 6   | `GET /invoices`                 | `status`, `clientId`, `q`, page → register rows                                                                                                                           | Invoice register                                                                     |
| 6   | `GET /invoices/summary`         | → `{outstanding, drafts, paidThisPeriod, awaitingInvoice}` ("period" = current calendar month in the workspace timezone)                                                  | Tiles at the top; dashboard billing snapshot                                         |
| 6   | `POST /invoices`                | `{clientId, recordIds[], issueDate?, paymentTermsDays?, notes?}` → 201 Draft. Errors: `422` none selected / mixed clients, `409 RECORD_NOT_APPROVED`. **One transaction** | `createInvoice`; wire the currently ignored Issue date and Payment terms inputs (C4) |
| 6   | `GET /invoices/:id`             | → invoice with lines and snapshots                                                                                                                                        | `invoicePreviewPage`                                                                 |
| 6   | `GET /invoices/:id/pdf`         | `application/pdf` rendered from snapshots                                                                                                                                 | "Download PDF"                                                                       |
| 6   | `POST /invoices/:id/mark-sent`  | `{sendEmail?}` → Sent (if `sendEmail` and SMTP is set, emails the PDF to `recipientEmail`)                                                                                | `updateInvoiceStatus(…, "Sent")`                                                     |
| 6   | `POST /invoices/:id/mark-paid`  | `{paidOn, reference?}` → Paid                                                                                                                                             | **New** "Mark as paid" (C4)                                                          |
| 6   | `POST /invoices/:id/void`       | `{reason}` → Void; records revert to Approved                                                                                                                             | **New**                                                                              |
| 6   | `DELETE /invoices/:id`          | Draft only; records revert to Approved                                                                                                                                    | **New**                                                                              |
| L   | `PATCH /invoices/:id`           | Draft only: issue date, terms, notes                                                                                                                                      | Edit draft                                                                           |
| L   | `POST /invoices/:id/mark-ready` | Draft → Ready to send                                                                                                                                                     | Optional step                                                                        |

**Wiring:** the builder's eligible-record table uses `GET /service-records?status=Approved&clientId=`; selection stays local. The register maps every status to a badge (currently only record statuses have styles).

### 7.13 Staff

**UI today:** `staffPage` (`Home.tsx:289`). "Add team member" and "View profile" only toast.

| Ph  | Endpoint           | Request → response                                                         | Wires to                                          |
| --- | ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------- |
| 2   | `GET /staff`       | `status`, `team`, `q` → staff                                              | Directory; record editor and roster (Active only) |
| 2   | `POST /staff`      | `{name, position, team, email, phone?, status}` → 201                      | **New** Add-team-member drawer                    |
| 2   | `GET /staff/:id`   | → staff (+ recent records/hours later)                                     | **New** "View profile"                            |
| 2   | `PATCH /staff/:id` | Partial → staff; setting "On leave" warns if future Confirmed shifts exist | **New** edit / deactivate                         |

No hard delete. Staff are not login accounts; if you later add roles, `staff.userId` links a worker to a user.

### 7.14 Reports

**UI today:** `reportsPage` (`Home.tsx:290-293`). The period select and team select have no state; chart data is a literal array.

| Ph  | Endpoint                | Request → response                                                                                                                                                                                                                                                                                                                           | Wires to                                                             |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 9   | `GET /reports/overview` | `period` (`last30`/`month`/`quarter`/`custom`), `from`, `to`, `team` → four panels: `serviceActivity[{weekStart, label, count}]`, `documentationStatus{approvedOrInvoiced, submitted, draftOrReturned, returned}`, `billingReadiness{approvedNotInvoiced, rows[{participantId, name, readyRecords, value}]}`, `transport{totalKm, recent[]}` | Replaces the literals; the selects and "Apply" button get real state |
| 9   | `GET /reports/export`   | `report` (`service-records`/`billing`/`transport`/`documentation`), same filters → CSV download                                                                                                                                                                                                                                              | "Export report" (make it a small menu)                               |

"Quarter" means the calendar quarter unless you prefer financial-year quarters (§12.2). Team filters records by the assigned staff member's team. Billing readiness returns all participants, not the first three (B7).

### 7.15 Voice notes

**UI today:** inbox (`Home.tsx:257`), recorder (`:259-276`), detail (`:278-284`), modals (`:332-335`), Generate modal, Voice settings drawer (`:296`).

| Ph  | Endpoint                                       | Request → response                                                                                                                        | Wires to                                                                       |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 8   | `GET /voice-notes`                             | `clientId`, `status` (default = not archived; `Saved`/`Draft ready`/`Archived`/`all`), `range` (`any`/`today`/`recent`), `q`, page → list | Inbox filters (replace the text matching on `created`)                         |
| 8   | `GET /voice-notes/summary`                     | → `{saved, transcriptReady, draftsForReview}`                                                                                             | Three tiles                                                                    |
| 8   | `POST /voice-notes`                            | **multipart**: `audio`, `clientId`, `title`, `recordId?`, `durationSec` → 201                                                             | Recorder `saveRecording`                                                       |
| 8   | `GET /voice-notes/:id`                         | → note (client polls while `Processing`)                                                                                                  | `openVoice`                                                                    |
| 8   | `PATCH /voice-notes/:id`                       | `{title?, recordId? (null detaches)}` + `rev`                                                                                             | Rename modal; "Linked service record" select                                   |
| 8   | `DELETE /voice-notes/:id`                      | Hard delete (refused if linked to a locked record)                                                                                        | Delete modal                                                                   |
| 8   | `POST /voice-notes/:id/archive` · `/unarchive` | → note                                                                                                                                    | Archive modal; **new** un-archive                                              |
| 8   | `GET /voice-notes/:id/audio`                   | Streams audio (Range)                                                                                                                     | Player replaces the mock play button                                           |
| 8   | `POST /voice-notes/:id/transcribe`             | → 202, `transcript.status = Processing`; retry allowed                                                                                    | `startTranscription`                                                           |
| 8   | `PATCH /voice-notes/:id/transcript`            | `{text}`                                                                                                                                  | **New** transcript editing (C8)                                                |
| 8   | `POST /voice-notes/:id/generate-draft`         | `{template, sections[], detailLevel, transcriptOnly}` → 202; `422 TRANSCRIPT_REQUIRED`                                                    | Generate modal → `generateDraft`                                               |
| 8   | `PATCH /voice-notes/:id/draft`                 | Any of the five sections                                                                                                                  | `updateVoiceDraft` (debounced) and "Save draft"                                |
| 8   | `POST /voice-notes/:id/attach`                 | `{recordId, applyDraft}`                                                                                                                  | `attachVoice` — add a confirm step when `applyDraft` would overwrite text (D8) |

"Create service record" from a draft needs no dedicated endpoint: the editor opens pre-filled (`startNewRecord(clientId, draft, voiceId)`) and the first save is a normal `POST /service-records` with `voiceNoteId`, which sets both sides of the link.

**Providers (adapters, chosen by environment)**

- **Speech-to-text**: `mock` (canned text, flagged as demo) · `openai` (any OpenAI-compatible `/audio/transcriptions` endpoint — cloud, or a self-hosted server in your compose stack, which keeps audio in-house). Anthropic's API is used only for the text step below; transcription needs a separate provider.
- **Note drafting**: `mock` · `anthropic` (`@anthropic-ai/sdk`, `NOTE_MODEL` default `claude-opus-5-5`; a cheaper Sonnet is a config change). Request a structured result with exactly the five sections; handle `refusal` and provider errors by setting `generation.status = Failed` with a friendly message ("Draft unavailable — write the note manually").
- Jobs run from the Mongo-backed queue in the API process; a stale-lock sweep recovers jobs after a restart. The UI polls `GET /voice-notes/:id` every ~2 s while `Processing`.
- **Preferences** (`generationTemplate`, `detailLevel`, `autoSaveRecordings`, `useTranscriptOnly`, `notifyDraftReady`) come from `/settings/preferences`. Input device, recording quality and the microphone test are per-device and stay in the browser.

**Recorder (browser).** Replace the timer with `MediaRecorder`: negotiate the MIME type (`audio/webm;codecs=opus` on Chrome/Firefox, `audio/mp4` on Safari), record at ~32 kbps to stay well under provider size limits, wire pause/resume, and on `getUserMedia` rejection set the existing `micError` state (`Home.tsx:81`). "Play preview" uses a local object URL. Show a warning (not a block) when the participant's consent forms are not ticked.

### 7.16 Settings

**UI today:** `settingsPage` (`Home.tsx:294`): a left menu of Workspace / My profile / Notifications / Privacy & access / Voice settings; only the voice panel has content, and it is unsaved.

| Ph  | Endpoint                                                                   | Request → response                                                                                                                                                               | Wires to                                    |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 2   | `GET /settings/workspace` · `PATCH /settings/workspace`                    | Organisation profile (legal name, ABN, address, contact), timezone, GST, invoice defaults (prefix, terms, footer, payment instructions), provider travel rate, budget categories | **New** Workspace panel                     |
| 2   | `GET /settings/preferences` · `PATCH /settings/preferences`                | Per-user `voice` and `notifications` preferences                                                                                                                                 | Voice settings drawer / Notifications panel |
| 1   | `PATCH /auth/me`, `POST /auth/change-password`                             | (§7.4)                                                                                                                                                                           | My profile panel                            |
| 1   | `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/logout-all` | (§7.3)                                                                                                                                                                           | Privacy & access panel                      |

Replace the "Prototype & access" panel with real environment/version information from `/meta`.

### 7.17 Activity log, notifications, search

| Ph  | Endpoint                   | Request → response                                                                                                                                                                                  | Wires to                                                                                |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 4   | `GET /activity`            | `limit`, `entityType`, `entityId`, `participantId`, `actorId`, `from`, `to`, page → entries                                                                                                         | Dashboard "Recent activity"; Settings → Privacy & access audit view; per-record history |
| 9   | `GET /notifications`       | Computed on demand: Returned records, records awaiting review, old drafts, plans ending within 30 days, low/over/expired budgets, overdue invoices (`due < today`, status Sent), voice drafts ready | Header bell (count + popover)                                                           |
| 9   | `POST /notifications/read` | Mark seen                                                                                                                                                                                           | Bell                                                                                    |
| 9   | `GET /search`              | `q` → grouped participants, records, invoices, voice notes, documents                                                                                                                               | Header search (the MVP keeps jump-to-Clients)                                           |

---

## 8. Frontend integration plan

### 8.1 Approach

Incremental, module by module, following the build order. The UI is not redesigned. `mock-data.ts` stays available until the last module is wired, then only its types survive (moved to `shared/`).

1. **Foundations:** add `@tanstack/react-query`; create `client/src/api/` with an axios instance (`baseURL` from `VITE_API_BASE_URL`, `withCredentials`), a single-flight refresh interceptor, an error normaliser producing `{code, message, details}`, and a query-key factory.
2. **Move types and schemas** into `shared/` (Zod schemas + inferred types + enums + pure functions). Use the same schemas in `react-hook-form` forms.
3. **Split `Home.tsx`** into `features/{dashboard,clients,records,invoices,voice,services,staff,reports,settings,auth}` (Rostering, BudgetManager and DocumentLibrary already stand alone). Do this first: 110 KB in one file makes the wiring diffs unreviewable.
4. **Routing:** `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, and a guarded `/app/*`. The `page` state can stay initially, but real data makes deep links and refresh-safety valuable, so move sections to URLs (e.g. `/app/clients/:id/budget`) soon after.
5. **Replace state with queries** phase by phase (table below).
6. **Rewrite prototype disclaimers** (list in §2.5) as each module goes live.

### 8.2 State → server mapping

| Today (`Home.tsx`)                      | Becomes                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `participants`                          | `useParticipants({status})`, `useParticipant(id)`, create/update/archive mutations                                                                     |
| `records`, `editor`, `saved`            | `useServiceRecords(filters)`, `useServiceRecord(id)`, save/submit/approve/return/adjust mutations; "unsaved" flag from form dirty state                |
| `invoices`, `invoicePreview`            | `useInvoices`, `useInvoice(id)`, create and action mutations; `invoiceSelection` stays local                                                           |
| `voices`, `voiceId`                     | `useVoiceNotes`, `useVoiceNote(id)` (polls while Processing), upload/transcribe/generate/patch mutations; recorder state stays local + `MediaRecorder` |
| `rosterShifts`                          | `useRosterShifts({from,to})` + mutations                                                                                                               |
| `budgets`                               | `useBudget(clientId)` (metrics included) + setup/adjust mutations                                                                                      |
| `rates`                                 | `useServices()` + create/update mutations                                                                                                              |
| `staff` (imported constant)             | `useStaff()` + create/update mutations                                                                                                                 |
| `toast` / `notify`                      | Keep `notify`; every mutation's `onError` calls `notify(error.message)`                                                                                |
| `adminPreview`                          | `useAuth()`                                                                                                                                            |
| `currentName`                           | `useAuth().user.name`                                                                                                                                  |
| `today`                                 | `useMeta().today`                                                                                                                                      |
| `budget-math.ts` `computeBudgetMetrics` | Deleted from the client (kept in `shared/` only if the roster drawer previews locally)                                                                 |

### 8.3 Dev and deploy wiring

- **Dev:** add a Vite `server.proxy` for `/api` → `http://localhost:4000`. Remove the Manus plugins (§2.5).
- **Docker/prod:** Caddy serves the built SPA and proxies `/api/*` (same origin).
- **Netlify (if you keep it for the SPA):** put an API proxy redirect _before_ the `/* → /index.html` rule so `/api/*` reaches the API host. That keeps the browser on one origin.
- **Env:** `VITE_API_BASE_URL` (default `/api/v1`); drop `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID`, `VITE_FRONTEND_FORGE_*` and the analytics placeholders.

### 8.4 New UI needed (the small controls the backend expects)

Setup-code field, forgot/reset pages, edit-participant, archive/restore, KYC toggles, add/edit staff drawer, service budget-category select and quantity input, shift status buttons and delete, invoice mark-paid/void/delete, budget change history, document upload dialog and file actions, transcript editor, un-archive voice note, notification popover, workspace settings panel. All are small variants of existing drawers and forms.

---

## 9. Security & privacy

| Area           | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords      | argon2id; minimum length from config; lockout after repeated failures; generic error messages; reset tokens hashed, single-use, 30-minute expiry                                                                                                                                                                                                                                                                                                            |
| Sessions       | httpOnly + `SameSite=Lax` + `Secure` cookies; rotating refresh tokens with reuse detection; revocation on password change; session list                                                                                                                                                                                                                                                                                                                     |
| CSRF / CORS    | Same-origin deployment; `Origin` check on unsafe methods; no wildcard CORS                                                                                                                                                                                                                                                                                                                                                                                  |
| Rate limiting  | Strict on login, signup, forgot-password; moderate global and upload limits                                                                                                                                                                                                                                                                                                                                                                                 |
| Input          | Zod on every route (body, query, params); regex-escaped search; no user-supplied Mongo operators; JSON body limit 1 MB                                                                                                                                                                                                                                                                                                                                      |
| Uploads        | Allow-lists, size/count limits, magic-byte check, random server-side names, no static serving, `nosniff`, attachment by default                                                                                                                                                                                                                                                                                                                             |
| Authorisation  | Every route behind `authenticate` + `requireRole`; a test walks the router and fails if any non-public route lacks a guard                                                                                                                                                                                                                                                                                                                                  |
| First run      | `SETUP_CODE` in production; atomic workspace claim; signup closes permanently                                                                                                                                                                                                                                                                                                                                                                               |
| Logging        | Redact cookies, tokens and passwords; no PII in log lines; request ids                                                                                                                                                                                                                                                                                                                                                                                      |
| Audit          | Append-only activity log for every mutation, login and password event; record/invoice `history[]`                                                                                                                                                                                                                                                                                                                                                           |
| Data safety    | Soft delete/void/archive for clinical and financial data; transactions where several documents change together                                                                                                                                                                                                                                                                                                                                              |
| Infrastructure | Mongo not published in prod, auth + keyfile on; non-root containers; secrets from env/secret files, never committed; TLS via Caddy; encrypted disks and backups; tested restore                                                                                                                                                                                                                                                                             |
| Dependencies   | Multer 2.x; lockfile committed; `pnpm audit` in CI                                                                                                                                                                                                                                                                                                                                                                                                          |
| AI providers   | Off by default (`mock`); minimised payloads (§6.6); disclose in your privacy notice; review the provider's retention terms before enabling                                                                                                                                                                                                                                                                                                                  |
| Compliance     | Participant records are sensitive health information. Sending audio or transcripts to an overseas provider is a cross-border disclosure under the Australian Privacy Principles; prefer an Australian region for hosting and consider self-hosted transcription. Check retention obligations for NDIS records with your compliance adviser — the design never hard-deletes clinical records by default. _(This is engineering guidance, not legal advice.)_ |

---

## 10. Build order & acceptance criteria

Dependency chain: **Foundations → Auth → Reference data → Clients → Service records → (Budgets + Roster) → Invoices → Dashboard/Reports**, with **Documents** and **Voice** attaching after Clients/Records. Sizes are relative (S/M/L), not day estimates.

**Phase 0 — Foundations (M)**

- Deliver: pnpm workspace (`server/`, `shared/`); env validation; Mongo replica-set container and connection; error envelope, request ids, pino logging; health endpoints; counters and audit helpers; seed framework; remove Manus scaffolding; add the hero image; Vite `/api` proxy.
- Done when: `docker compose up` brings up `mongo` + `api`; `/health/ready` is green; a transaction round-trip test passes; typecheck and lint pass.

**Phase 1 — Auth & first run (L)**

- Deliver: §7.1–7.4 endpoints, Mailpit, `create-admin` and `reset-password` scripts; client `AuthProvider`, guarded routes, controlled login/signup/forgot/reset pages, real user in header.
- Done when, from an empty database: sign up (with setup code) → land in the app → refresh keeps the session → log out → log in → five wrong passwords lock the account → reset email arrives in Mailpit and the new password works → a second signup attempt is rejected → `/auth/bootstrap` reports `setupRequired: false` and the landing page hides the signup CTAs.

**Phase 2 — Reference data (S)**

- Deliver: workspace settings, preferences, staff, services; Workspace settings panel, staff drawers, Add-service drawer with budget category.
- Done when: add/edit/deactivate staff and services persist across reload; duplicate service names are rejected with the existing message; inactive services and staff on leave disappear from pickers.

**Phase 3 — Clients (M)**

- Deliver: participants, archive/restore, KYC; intake drawer, edit profile, profile Overview/Support tabs; participant dropdowns fed by the API.
- Done when: intake creates a profile with a `clientNumber`; bad or duplicate NDIS numbers are rejected; archived clients vanish from Active pickers and cannot receive new records.

**Phase 4 — Service records & review (L)**

- Deliver: §7.8, activity log, counts; editor, review queue and drawer, return flow, profile tabs; dashboard tiles via counts.
- Done when: a record goes Draft → Submitted → Returned → Submitted → Approved with correct locks; billables are frozen on submit (changing a rate afterwards does not alter them); reviewer adjustments persist; stale saves return `STALE_VERSION`; every step appears in the activity feed.

**Phase 5 — Budgets & rostering (L)**

- Deliver: §7.9 and §7.6; shift status controls; budget history.
- Done when: overlaps and ratio rules reject bad shifts with the exact UI messages; approved, submitted and scheduled amounts move the budget figures correctly (including the plan-window rule); adjustments store their reason; expired/over/low statuses appear.

**Phase 6 — Invoices (M)**

- Deliver: §7.12 with PDF; builder, preview, register, mark sent/paid, void/delete.
- Done when: creating an invoice atomically marks records Invoiced with a gap-free number; double-clicking "Create" cannot double-invoice; deleting a draft returns records to Approved; the PDF downloads and matches the preview; totals reconcile with the records.

**Phase 7 — Documents & Organisation files (M)**

- Deliver: §7.10 with Multer; upload dialog, file actions, KYC badges, real year/month trees.
- Done when: an upload lands on the volume and downloads intact; oversize, wrong-type and spoofed files are rejected; progress notes appear under their true months; deleting hides the file; template slots accept a file.

**Phase 8 — Voice (L)**

- Deliver: §7.15 with `mock` providers first, then real providers behind env flags; `MediaRecorder` recorder, player, polling, attach flow, jobs queue.
- Done when: record in the browser → save → audio plays back → transcribe (mock) → generate a draft → create a service record from it → both sides show the link; a permission-denied microphone shows the existing error state; enabling a real provider needs only environment variables.

**Phase 9 — Dashboard, reports, notifications, search (M)**

- Deliver: §7.5, §7.14, §7.17 remainder; real bell popover and header search.
- Done when: every dashboard and report number reconciles with the underlying lists; CSV exports open in Excel; filters change results.

**Phase 10 — Hardening & release (M)**

- Deliver: prod compose with Caddy and authenticated Mongo; backup and restore drill; security checklist (§9) verified; full E2E suite; seed-demo script; optional OpenAPI document generated from the Zod schemas; CI (typecheck, tests, image build).
- Done when: a clean machine goes from `git clone` to a working system by following the README, a restored backup reproduces the data and files, and the golden path (§11) passes.

---

## 11. Testing plan

- **Unit:** money and rounding; `durationHours`; billables; budget metrics (fixtures derived from the mock data); ratio and overlap rules; counter formatting; state-machine guards.
- **Integration** (supertest against a real replica set): every endpoint's happy path, validation errors, auth required, `STALE_VERSION`, illegal transitions, transaction rollback (invoice creation with one bad record), concurrent invoice creation, concurrent first-admin signup (exactly one wins), upload limits and spoofed types, Range requests on audio.
- **Security tests:** a router walk asserting every non-public route rejects unauthenticated requests; login lockout; refresh-token reuse revokes the family; cookies carry the right flags.
- **Contract:** the shared Zod schemas are the contract — compile the client against them; add a test that seeded DTOs parse.
- **E2E (Playwright), the golden path:** sign up → log in → set workspace → add service → add staff → add participant → set budget → create shift → write, submit and approve a record → create an invoice → download the PDF → record and transcribe a voice note → create a record from its draft → upload a document → check dashboard and report numbers → log out.

---

## 12. Decisions made & open questions

### 12.1 Decisions I made (change any you disagree with)

| #   | Decision                                                                                                                         | Resolves   |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Cookie sessions with short access token + rotating refresh token; no tokens in `localStorage`                                    | A1         |
| 2   | Signup is a one-time bootstrap protected by `SETUP_CODE` and an atomic claim                                                     | A1         |
| 3   | Single Admin role now; `role` field and guards exist so Manager/Staff can be added later                                         | —          |
| 4   | Records, invoices, voice notes and shifts use counter-based business codes as their ids                                          | B3         |
| 5   | Money in cents internally, dollars on the wire                                                                                   | —          |
| 6   | Billables are frozen at submit; approved/invoiced records never re-price                                                         | D3         |
| 7   | Services carry a `budgetCategory`; billing honours `unit` and the `transport` flag; travel rate is a workspace setting           | D4, D5, B5 |
| 8   | Budget "used/pending/committed" count only items inside the plan window                                                          | D6         |
| 9   | "Save draft" on a Returned record keeps it Returned                                                                              | D2         |
| 10  | Inactive services, archived participants and staff on leave are rejected server-side, not just hidden                            | D1         |
| 11  | Review queue defaults to Submitted with a working status filter; delete the unreachable record pages                             | D7         |
| 12  | Voice: draft generation requires a transcript; applying a draft is explicit; archived notes hidden by default                    | D8, D10    |
| 13  | Uploading a document does not auto-tick KYC                                                                                      | —          |
| 14  | Two "providers" per AI step, both defaulting to `mock`; Claude for note drafts, speech-to-text via an OpenAI-compatible endpoint | A3         |
| 15  | Jobs run on a Mongo-backed queue inside the API process (no Redis)                                                               | —          |
| 16  | Same-origin deployment via Caddy/Vite proxy                                                                                      | —          |
| 17  | The demo/"Admin preview" button is hidden unless `DEMO_ENABLED`                                                                  | A1         |

### 12.2 Questions that could change the plan

Defaults are in brackets; none block starting Phase 0.

1. **Password policy** — keep the UI's 8-character minimum, or raise to 12 for a system holding health data? [8, configurable]
2. **More users later?** Will Managers or Staff ever log in (roles, invitations)? [No; design leaves room]
3. **Speech-to-text** — cloud OpenAI-compatible endpoint or self-hosted in Docker? [`mock` until you choose]
4. **Note drafting** — use the Claude API (`claude-opus-5-5` by default, or a cheaper Sonnet)? [`mock` until you supply a key]
5. **Hosting and region** for production (single VPS with Caddy vs managed platform; Australian region?) [single VPS]
6. **Email/SMTP provider** for reset links and sending invoices. [Mailpit in dev only]
7. **GST and invoice content** — confirm tax = 0 for NDIS supports, whether invoices need your ABN and NDIS support item numbers on lines. [tax 0, ABN in workspace settings, support item number optional per service]
8. **Travel rate** — replace the $1.00/km placeholder; confirm travel is billable only when the service allows transport. [$1.00, gated]
9. **Report quarter** — calendar or financial-year quarters? [calendar]
10. **Retention and deletion** — how long must records and audio be kept, and do you want a purge job? [never hard-delete records; audio deletable by Admin]
11. **Xero** — in scope for a later phase? [not in the MVP]
12. **Demo mode** — keep a static demo build with mock data for sales/training? [optional `VITE_DEMO_MODE` build]

---

_End of plan. Suggested first step: Phase 0 and Phase 1 together — they are the smallest slice that gives you a running stack, a real signup and login, and a template for every later module._
