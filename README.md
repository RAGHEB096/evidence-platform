# Evidence Platform

A web application for organising software-test protocols (chapter → function → test run → step, with sub-steps), recording results, attaching screenshot evidence, and exporting selected evidence as an editable Word report.

It was built for functional qualification testing of a manufacturing execution system (MES), so traceability, access control and "nothing silently disappears" come first. It is built so that it **can be assessed** for regulated use; that assessment has not been done, and the application makes **no claim** of 21 CFR Part 11, GAMP 5 or GxP compliance (see [Limits and scope](#limits-and-scope)).

- What it does and when each part counts as done: [`docs/SPEC.md`](docs/SPEC.md)
- How it is built and why: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), decisions since then in [`docs/adr/`](docs/adr/)
- Where the work stands, decisions, verification commands: [`docs/PROGRESS.md`](docs/PROGRESS.md)
- Security review: [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md)
- Deployment checklist: [`docs/DEPLOY.md`](docs/DEPLOY.md)

## Architecture in brief

```
Browser — React SPA (static files on Cloudflare Pages)
├─ supabase-js with the publishable key + the user's JWT
│   ├─ Auth: username → synthetic email + password (no email is ever shown)
│   ├─ PostgREST: tables and RPCs, every row filtered by Row Level Security
│   └─ Storage: private buckets, insert-only policies, short-lived signed URLs
├─ Edge Functions (hold the secret key; check the caller first)
│   ├─ bootstrap-admin    one-time creation of the first administrator
│   ├─ admin-users        create users, reset passwords, (de)activate, flags
│   └─ finalize-evidence  verify an upload, hash it (SHA-256), register it
└─ docx (in the browser): selected images → PNG → .docx → download / exports bucket
```

- **Postgres is the source of truth.** Authorisation lives in the database: RLS on every table, role checks in every RPC, column-level grants for narrower writes.
- **Delete means archive.** Records are soft-deleted (`deleted_at`). Evidence originals are never overwritten or removed through the app.
- **Append-only audit trail**, written by triggers and server code, with an actor on every event.
- **Protocol lifecycle:** Draft → Released → Completed. Outside Draft the structure is locked, while results and evidence stay open (ADR-017).

## Stack

React 19, Vite 8, TypeScript (strict), Tailwind CSS 4, shadcn/ui (Radix), React Router 8, TanStack Query 5, react-hook-form + zod, dnd-kit, `docx`. Supabase (Postgres 17 with RLS, Auth, Storage, Edge Functions on Deno). Tests: Vitest, Playwright. Hosting: static build on Cloudflare Pages.

## Database structure

| Table | Purpose |
|---|---|
| `user_profiles` | One row per account: username, display name, administrator and "can create protocols" flags, active, must-change-password. No email or password column. |
| `protocols` | Reference (unique), name, description, version, status (draft, released, completed), archive state. |
| `protocol_access` | Who may do what on a protocol: viewer, tester or manager. |
| `chapters`, `functions`, `test_runs`, `test_steps` | The hierarchy. Every row carries `protocol_id`, tied to its parent by composite foreign keys (ADR-011). Steps nest through `parent_step_id`. |
| `evidence_files` | One row per verified upload: storage path, original file name, MIME type, size, SHA-256, dimensions, caption, description, uploader. |
| `document_exports`, `document_export_items` | Report drafts and generated reports: the selected evidence, its order and report-only captions. |
| `audit_events` | Append-only: actor, event type, entity, protocol, server timestamp (UTC), what changed. |
| `app_settings` | Upload size limit, report page size, maximum embedded image size. |

Migrations are in [`supabase/migrations/`](supabase/migrations/), and `supabase db reset` rebuilds everything from them. The permission table is in section 5 of ARCHITECTURE.md; the database enforces it, and `tests/db/` proves it with real sessions for every role.

## Local installation

Requirements: Node.js 22 or later (developed on 26), npm, and Docker Desktop running. The Supabase CLI is a pinned dev dependency, so there is nothing to install globally.

```bash
npm install
```

```bash
npx playwright install chromium
```

Create the function secrets file and choose a setup token of at least 24 characters:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put that value after `SETUP_TOKEN=` in `supabase/functions/.env`. Then start the local stack (the first start downloads the Docker images):

```bash
npx supabase start
```

Create the app's environment file and fill in the publishable key that `npx supabase status -o env` prints as `PUBLISHABLE_KEY`:

```bash
cp .env.example .env.local
```

Start the app at http://localhost:5173:

```bash
npm run dev
```

### Initialising the administrator

There are no default credentials. On first visit the sign-in page offers **Run first-time setup**. Enter the setup token from `supabase/functions/.env`, then the administrator's username, display name and password (at least 10 characters, with letters and digits). The setup page disappears as soon as an active administrator exists. All other accounts are created by an administrator in **User Management**; people choose their own password at first sign-in.

## Supabase configuration

The local configuration is in [`supabase/config.toml`](supabase/config.toml):
- public sign-ups off, anonymous sign-ins off, email confirmations off
- minimum password length 10 with letters and digits
- access tokens valid for 15 minutes
- `verify_jwt = false` for all three functions, which verify callers themselves (ADR-014)

The buckets (`evidence`, `exports`) are created by a migration, private, with size and type limits. For a hosted project, follow [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Environment variables

| Variable | Where | Secret? | Meaning |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` / Cloudflare | no | Project API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.local` / Cloudflare | no | Publishable key (`sb_publishable_…`). The app refuses to start with a secret key here. |
| `VITE_AUTH_EMAIL_DOMAIN` | `.env.local` / Cloudflare | no | Domain of the synthetic Auth emails behind usernames (ADR-001) |
| `SETUP_TOKEN` | function secrets | **yes** | One-time token for first-time setup. Delete it after setup. |
| `AUTH_EMAIL_DOMAIN` | function secrets | no | Must equal `VITE_AUTH_EMAIL_DOMAIN` |
| `ALLOWED_ORIGINS` | function secrets | no | Comma-separated browser origins allowed to call the functions |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, … | injected by Supabase | yes | Never set by hand; the secret key exists only inside Edge Functions |

Anything prefixed `VITE_` is shipped to the browser and must never be secret. `.env*` files with real values are git-ignored; `.env.example` files list every name with placeholders.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :5173 |
| `npm run build` | Typecheck and production build to `dist/` |
| `npm run typecheck`, `npm run lint` | Strict TypeScript; ESLint with zero warnings |
| `npm test` | Unit tests: tree and status roll-up, file validation (including renamed and truncated images), report model and the DOCX builder (unzips a generated document) |
| `npm run test:db` | RLS, RPC, storage, audit, Edge Function and security-review tests against local Supabase, with real sessions for administrator, manager, tester, viewer and an unassigned user |
| `npm run test:e2e` | Playwright against the production build: setup, sign-in, users and roles, the protocol editor, execution and upload, report generation and history, lifecycle lock, dashboard, audit, settings |
| `npm run test:perf` | Generates a report with many full-HD screenshots and prints timings (`PERF_IMAGES`, default 300) |

**`test:db`, `test:e2e` and `test:perf` reset the local database first**, so each run starts from the migrations alone. They wipe local data, including your administrator; run first-time setup again afterwards. To apply a new migration without losing data, use `npx supabase migration up`.

## Limits and scope

**Free-tier limits** (checked 2026-11-11 on supabase.com/pricing and the Cloudflare Pages limits page):
- **Supabase Free:** 500 MB database, **1 GB file storage**, 50 MB maximum upload, 5 GB egress, 500,000 Edge Function invocations, 2 active projects, no automatic backups, and **projects pause after 1 week of inactivity**. A paused project makes the app unreachable until it is restored from the dashboard; the app does not hide this with a keep-alive.
- **Supabase Edge Functions:** 256 MB memory, 2 s CPU per request, 150 s wall clock on Free.
- **Cloudflare Pages Free:** 500 builds a month, 20,000 files and 25 MiB per file.

File storage runs out first: 1 GB holds roughly 500 screenshots of 2 MB, before saved reports. The administrator dashboard shows usage against the limit. The upgrade path is Supabase Pro (from $25 a month, 100 GB storage, 8 GB database).

**Large reports** are built in the browser (ADR-005), and the tab must stay open while generating.
- **Measured locally** (`npm run test:perf`, Chromium, 2026-11-11) with 300 distinct full-HD screenshots of about 426 kB each: generation took **44 s**, the .docx was **111 MB** with all 300 images, the tab's JavaScript heap was about 415 MB afterwards, and Microsoft Word opened the file in 2.3 s (157 pages).
- **Saved copies are limited to 50 MB**, the exports bucket limit, which is also the Free plan's per-file maximum. A larger report is still downloaded and recorded in Generated Documents with its contents, but without a saved file; the app says so. Roughly 100–120 full-HD screenshots fit under 50 MB. Keep large downloaded reports yourself, or split them by chapter.

**Audit trail limits.**
- Users cannot alter or delete events by any route, and triggers refuse updates and deletes even for the table owner.
- The project owner, with direct database access, can still disable triggers and change anything.
- There is no hash chaining or external timestamping yet (ARCHITECTURE section 8).
- Report files are hashed by the browser. The authoritative record of what a report contained is the server-side selection.

**Orphan uploads.** A file uploaded but never finalised (for example, the tab closed mid-upload) stays in storage with no evidence row, so it is invisible in the app. The dashboard shows their total size. Inspect them with this query in the SQL editor:

```sql
select o.name, (o.metadata ->> 'size')::bigint as bytes, o.created_at
from storage.objects o
where o.bucket_id = 'evidence'
  and not exists (select 1 from public.evidence_files e where e.storage_path = o.name)
  and o.created_at < now() - interval '1 day'
order by o.created_at;
```

To remove them, delete those objects through the Storage API or the dashboard, not with SQL, so the stored files go too. The app itself never deletes evidence.

**Not in version 1:** electronic signatures, PDF export, non-image evidence, real-time collaboration, email notifications, self-service password recovery (administrators reset passwords), permanent deletion, interface translations.

**No compliance claim.** Nothing here should be described as 21 CFR Part 11 compliant, GAMP 5 validated or GxP compliant. Using it for regulated work requires your own assessment and validation, including procedural controls this software does not provide (for example electronic signatures, backup and retention policies, and periodic access review).
