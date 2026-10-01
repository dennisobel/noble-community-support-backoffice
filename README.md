# Noble Community Support — back office

Two apps over one workspace for an NDIS community support provider.

**The back office** (`/app`, Admins): participants and client files, rostering, service records with a review workflow, plan budgets, invoicing, documents, voice notes with AI-assisted progress-note drafts, live job tracking, reports and an audit log.

**The worker portal** (`/staff`, support workers): a phone-first app where a worker sees their own roster, signs on to a shift, has their route recorded while they work, writes progress notes, files incident and ABC reports, keeps a kilometre logbook, and holds their own compliance documents. Workers only ever see their own shifts and the participants on them.

**Stack:** React 19 + Vite + TanStack Query (client) · Express 5 + TypeScript + Mongoose 9 (API) · MongoDB 8 replica set in Docker · Multer uploads on a Docker volume · Caddy for HTTPS in production.

The design and the full endpoint map are in [BACKEND_INTEGRATION_PLAN.md](BACKEND_INTEGRATION_PLAN.md).

## Repository layout

A pnpm workspace: two apps and the code they share.

```
apps/web/        React app: the back office (/app) and the worker portal (/staff)
  Dockerfile       builds the bundle and serves it with Caddy
apps/api/        Express API (modules in src/modules, Mongoose models in src/models)
  Dockerfile       bundles the API and runs it as a non-root user
packages/shared/ Zod schemas, DTO types and business rules used by both apps
deploy/          Caddyfile, MongoDB init script, backup script
docker-compose.yml        development: MongoDB, Mailpit, API
docker-compose.prod.yml   production: Caddy + both apps, API, MongoDB with auth, backups
```

`packages/shared` is TypeScript source, imported through the `@shared/*` alias rather than built, so one definition of a rule is compiled into both apps. Both Dockerfiles build from the repository root, so a deployment only needs this one repository.

| Command                                            | Runs                               |
| -------------------------------------------------- | ---------------------------------- |
| `pnpm dev` / `pnpm dev:api`                        | the web app / the API, on the host |
| `pnpm check`                                       | type-checks both apps              |
| `pnpm test`                                        | the API test suite                 |
| `pnpm build` / `pnpm build:api` / `pnpm build:all` | production builds                  |

Anything can also be run per package, for example `pnpm --filter @noble/api test`.

## Run it locally

Requirements: Node 22+, pnpm 10 (`corepack enable`), Docker Desktop.

```bash
pnpm install
cp .env.example .env

# 1. MongoDB (replica set) and Mailpit
docker compose up -d mongo mailpit

# 2. API on http://localhost:4100 (hot reload)
pnpm dev:api

# 3. Web app on http://localhost:5173 (proxies /api to the API)
pnpm dev
```

Open http://localhost:5173 and choose **Set up the workspace** to create the single Admin account. Password-reset and invoice emails land in Mailpit at http://localhost:8125.

To run the API in Docker instead of on the host: `docker compose up -d --build` (API on port 4100).

### Sample data

```bash
pnpm seed:demo            # loads the prototype's sample participants, records, invoice, shifts and voice notes
pnpm seed:demo -- --reset # wipes the development database first
```

The command prints the demo Admin's email and a generated password (or set `DEMO_ADMIN_PASSWORD`). Set `DEMO_ENABLED=true` to show an "Explore the demo workspace" button that signs in as that account. Demo data and the demo button are refused when `NODE_ENV=production`.

To fill the workspace of an Admin you have already created (sign up first, then run):

```bash
pnpm seed:sample                        # attaches to the only Admin
pnpm seed:sample -- --email you@org.au  # or choose one when there are several
```

This adds 8 fictional clients (one archived, one on a renewed plan, one low on funds), 6 team members, 7 services, a 13-week roster history plus two weeks ahead, about 200 service records at every stage of review, about 25 invoices from draft to paid, and the current plan budgets, so the dashboard, roster, review queue, budgets, invoices and reports all have something to show. It goes through the same services as the API, so ids, counters, links, billing and the audit log are exactly what the app would have produced, and it dates the history across the last few months. It only runs on an empty workspace, never touches your Admin or existing data, refuses in production, checks its own result and removes everything again if anything fails. Its audit entries carry the IP `sample-seed`. To start over, drop the database and sign up again: `docker exec noble-mongo-1 mongosh --quiet --eval "db.getSiblingDB('noble').dropDatabase()"`.

### Useful commands

| Command                                                          | What it does                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm check`                                                     | Type-checks the client, shared code and API                                              |
| `pnpm test`                                                      | API integration tests against the MongoDB container (`docker compose up -d mongo` first) |
| `pnpm build` / `pnpm build:api`                                  | Production builds of the web app (`apps/web/dist`) and the API (`apps/api/dist`)         |
| `pnpm create-admin -- --email you@org.au --name "Your Name"`     | Creates an Admin from the command line (also closes public sign-up)                      |
| `pnpm --filter @noble/api cli reset-password --email you@org.au` | Break-glass password reset; prints a temporary password                                  |

## Configuration

All settings are environment variables; see [.env.example](.env.example) for the full list with comments. The important ones:

| Variable              | Purpose                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`   | Required in production (32+ random characters)                                                                                     |
| `SETUP_CODE`          | Required in production: the code needed to create the first Admin                                                                  |
| `APP_URL`             | Public URL of the web app (emails and the cross-site request check)                                                                |
| `MONGO_URI`           | MongoDB connection string (must be a replica set)                                                                                  |
| `SMTP_*`, `MAIL_FROM` | Email for password resets and invoices                                                                                             |
| `STT_PROVIDER`        | `mock` (default) or `openai` — any OpenAI-compatible `/audio/transcriptions` endpoint, cloud or self-hosted                        |
| `NOTE_PROVIDER`       | `mock` (default) or `anthropic` — drafts progress notes with Claude (`ANTHROPIC_API_KEY`, `NOTE_MODEL`, default `claude-opus-5-5`) |

Voice features work end to end with the `mock` providers. Only the transcript and the participant's preferred name and goals are sent to the drafting model.

## Deploy with Docker

```bash
git clone <this repository> && cd noble-community-support-backoffice
cp .env.example .env.production   # fill in JWT_ACCESS_SECRET, SETUP_CODE, MONGO_* passwords, SMTP_*
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Then open `http://<host>:9080`, choose **Set up the workspace** and enter the `SETUP_CODE` to create the first Admin.

### Ports

Only the `web` container publishes anything; the API and MongoDB are reachable solely on the compose network. It defaults to **9080** (and 9443 for HTTPS) rather than 80/443, because the shared VM already uses 80, 3000–3005, 4000–4030, 5000–5173, 5432, 5434, 6379, 7100–7110 and 8001–8501. Nothing in the 9000s is taken. Change `HTTP_PORT` / `HTTPS_PORT` in `.env.production` to move it.

`SITE_ADDRESS` defaults to `:80`, meaning Caddy serves plain HTTP inside the container and you reach it on 9080. Put your own TLS terminator in front, or — once the host's port 80 and 443 are free — set `SITE_ADDRESS` to your domain and `HTTP_PORT=80 HTTPS_PORT=443`, and Caddy will obtain a certificate itself.

To run the development stack on the same VM, override the host ports too, as the defaults collide: `API_HOST_PORT=9101 MONGO_HOST_PORT=9017 MAILPIT_UI_PORT=9025 MAILPIT_SMTP_PORT=9125`.

### The services

- `web` (Caddy) serves both apps and proxies `/api` to the API. The Mapbox token is baked in at build time from `VITE_MAPBOX_TOKEN`, so changing it needs `--build`.
- `api` holds no state; uploads live on the `uploads_data` volume and are only served to signed-in users.
- `mongo` runs as a replica set with authentication; the API connects as a least-privilege user created on first start.
- `backup` writes a daily `mongodump` archive and an uploads tarball to the `backups` volume and keeps 14 days. Copy backups off the host. Restore steps are at the top of [deploy/backup.sh](deploy/backup.sh).

### Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Data lives in named volumes, so rebuilding does not touch it. To run a command against the deployed API — creating an Admin from the console, for example:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec api node dist/scripts/cli.js create-admin --email you@org.au --name "Your Name"
```

## Giving a support worker access

There are two ways in, and both end with an Admin deciding:

1. **The office adds them.** Staff → Directory → _Add team member_, then open them and choose **Invite**. They get an email with a link to set a password.
2. **They ask.** From the sign-in page a worker follows _Request portal access_ and fills in a short form. The request lands in Staff → **Access requests**; approving it creates their team record and sends the same invite. Nothing is granted, and no client information is visible, until someone approves it.

Open a team member at any time to re-send the invite, review their documents, or **Turn off access** — which closes the portal without touching their history.

### Compliance documents and reminders

Each worker has a checklist (screening checks, qualifications, insurances, vehicle documents). They upload their own documents with issue and expiry dates from Profile; the office approves or sends each item back in the same drawer it reviews them.

A daily job watches for expiry: a worker gets an email 30, 14, 7 and 1 day out, another the day it lapses, and Admins get a digest of everything needing attention. It runs five minutes after boot and every 24 hours after that; the schedule lives in [apps/api/src/maintenance.ts](apps/api/src/maintenance.ts).

### Live job tracking

When a worker starts a shift, the portal signs them on and begins recording their location: every 5 seconds while they are moving, every 30 while stationary, with the server choosing the interval. Fixes are buffered and replayed after a dropout, so a tunnel or a flat patch of signal costs nothing. GPS jitter is dropped and impossible jumps are discarded, so the kilometres can be trusted. Finishing the shift ends the session and writes the measured distance into the worker's KM logbook.

The office watches it at **Live jobs**: who is out, where they are, how far they have gone, and whether a signal has been lost. Set `VITE_MAPBOX_TOKEN` (a public `pk.…` token) to draw the map — without it, positions and kilometres are still recorded and the map is replaced with a short explanation.

## Security notes

- Sessions use http-only, `SameSite=Lax` cookies: a 15-minute access token and a rotating refresh token (stored hashed; reuse revokes the session). Five failed sign-ins lock the account for 15 minutes.
- Admins and support workers are separate roles with separate apps. `/app` is Admin-only and `/portal` is worker-only; a worker's queries are always scoped to their own id, so one worker cannot read another's shifts, notes or documents.
- Location is only recorded between starting and finishing a shift. Nothing is tracked outside a job.
- State-changing requests from other origins are rejected; every request is validated with the shared Zod schemas.
- Uploads are limited by size and count and checked by their real content (magic bytes), stored under random names and never served statically.
- Every change is written to the audit log (Settings → Privacy & access). Clinical and financial records are archived, returned or voided rather than deleted.

## End-to-end check

`e2e/golden-path.mjs` drives a real browser (Chrome or Edge via `playwright-core`) through sign-up, services, staff, intake, budget, a service record through review and approval, invoicing with email, rostering, a recorded voice note through transcript and draft, documents, reports, search, settings, the mobile layout and sign-in again. It needs an **empty** database:

```bash
docker exec noble-mongo-1 mongosh --quiet --eval "db.getSiblingDB('noble_e2e').dropDatabase()"
MONGO_URI="mongodb://127.0.0.1:27017/noble_e2e?directConnection=true" PORT=4101 SMTP_PORT=1125 pnpm dev:api
VITE_API_PROXY_TARGET=http://localhost:4101 pnpm dev
pnpm test:e2e   # E2E_BROWSER=chrome by default; set E2E_BROWSER=msedge to use Edge
```
