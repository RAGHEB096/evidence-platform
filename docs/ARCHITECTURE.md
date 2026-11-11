# Evidence Platform — Architecture

Date: 2026-11-11. Status of every decision below: accepted as the starting design. Deviate only for a concrete blocker, and record the change as a new ADR in `docs/adr/`.

## 1. What shapes the design

| Force | Consequence |
|---|---|
| Records may be used as validation evidence | Append-only audit trail, soft delete, immutable originals, file hashes, server-side timestamps |
| Users have no email address | Username login layered on Supabase Auth; every account is created by an administrator |
| Access is per protocol, with three roles | Authorization enforced in Postgres (RLS), with `protocol_id` on every row |
| Free-tier hosting | No always-on server; heavy work (image conversion, DOCX assembly) runs in the browser, not in Edge Functions |
| Small scale: tens of users, dozens of protocols, thousands of screenshots | Plain Postgres queries, no caching layer, no queues |

Free-tier limits that matter, as of November 2026 (re-check before writing the deployment guide):

- Supabase Free: about 500 MB database, 1 GB file storage, 50 MB maximum upload, projects pause after 7 days without activity.
- Supabase Edge Functions: 256 MB memory, 2 s CPU time per request, 150 s wall clock on Free.
- File storage is the first limit this app will hit: 1 GB is roughly 500 screenshots at 2 MB each, before saved reports are counted.

## 2. System overview

```
Browser — React SPA (static files on Cloudflare)
│
├─ supabase-js, publishable key + the signed-in user's JWT
│    ├─ Auth      sign in with synthetic email + password
│    ├─ PostgREST tables and RPCs, every row filtered by RLS
│    └─ Storage   private buckets, policies on storage.objects, signed URLs
│
├─ Edge Functions (hold the secret key; verify the caller before acting)
│    ├─ bootstrap-admin    one-time creation of the first administrator
│    ├─ admin-users        create user, reset password, activate/deactivate
│    └─ finalize-evidence  verify an uploaded file, hash it, register it
│
└─ docx (in the browser)
     selected images → PNG → .docx blob → download, and optionally
     upload to the exports bucket
```

Three flows to keep in mind:

1. **Sign in.** Username → normalised → synthetic email → `signInWithPassword`. The profile row (`is_active`, `is_admin`) is loaded next; an inactive profile is signed out immediately.
2. **Upload evidence.** Client validates the file, uploads it straight to the private bucket under the protocol's folder, then calls `finalize-evidence`. Only that function can create the `evidence_files` row.
3. **Export.** The selection is a draft export stored in the database. On "Generate", the browser fetches the selected originals through signed URLs, converts them to PNG, builds the DOCX, and records the result through an RPC.

## 3. Decisions

### ADR-001 — Username login through synthetic emails

- **Context.** Supabase Auth identifies users by email or phone. Users here have neither, and there must be no public registration and no email flows.
- **Decision.** Each account's Auth email is `<username>@<AUTH_EMAIL_DOMAIN>`, where the domain is a non-routable value held in one config constant. Usernames are lowercase, 3–32 characters, `[a-z0-9._-]`, unique in `user_profiles`. Accounts are created through the Auth admin API with the email pre-confirmed. Public sign-ups, email confirmation, magic links and email password recovery are disabled in `supabase/config.toml` and in the hosted project. The login form shows one generic error for any failure.
- **Rejected.** A custom password table (throws away Supabase's hashing and session handling, and means storing password material ourselves). Phone or anonymous auth (wrong semantics).
- **Consequences.** The email domain is visible in the client bundle, which is acceptable because it is not a secret. Self-service password recovery does not exist; administrators reset passwords. Hosted Supabase may reject some email domains, so confirm the chosen domain against the real project during Phase 2 and keep it configurable.

### ADR-002 — First administrator through a one-time setup token

- **Context.** No credentials may live in the repository, yet someone has to become the first administrator.
- **Decision.** Edge Function `bootstrap-admin` accepts a setup token, username, display name and password. It compares the token with the `SETUP_TOKEN` function secret in constant time and refuses if any administrator already exists. The `/setup` page is reachable only while an RPC `needs_setup()` returns true. The deployment guide tells the owner to delete the secret afterwards.
- **Rejected.** Seeded default credentials (forbidden). A local script with the secret key (works, but leaves no path for someone deploying purely from the dashboard; acceptable as a documented fallback).
- **Consequences.** Two independent locks: the token and the "no admin exists" check. After first use the function is inert.

### ADR-003 — Authorization in Postgres

- **Context.** A user must never read or change a protocol they are not assigned to, including through direct API calls.
- **Decision.** RLS on every table. Every domain table carries `protocol_id`, even where it could be derived through joins, so policies stay one-line and indexable. Policies call helper functions in a non-exposed `private` schema: `private.is_admin()` and `private.protocol_role(protocol_id)`, both `security definer`, `stable`, with a fixed `search_path`, and both returning nothing for an inactive profile. Writes that are narrower than a row (a tester may change a step's result but not its definition) go through RPCs that check the role; fields that must never change after creation (hash, storage path, uploader) are protected with column-level grants.
- **Rejected.** Checks only in the frontend (bypassable). A custom API layer in Edge Functions for all data access (duplicates what RLS gives and adds latency and cold starts).
- **Consequences.** Policies must be tested with real user sessions, not with the secret key, which bypasses RLS. Wrap `auth.uid()` as `(select auth.uid())` inside policies so it is evaluated once per statement.

### ADR-004 — Evidence ingestion: direct upload, then server-side finalisation

- **Context.** Files reach 20 MB, must be validated by content rather than by name, need a trustworthy SHA-256, and originals must be preserved.
- **Decision.** The browser validates extension, MIME type, magic bytes and size, then uploads to `evidence/{protocol_id}/{evidence_id}/{sanitised-filename}`. Storage policies allow inserts only for testers and above on that protocol, and allow no updates or deletes, which makes originals immutable. The browser then calls `finalize-evidence`, which re-checks the caller's role, downloads the object, verifies size and magic bytes against the allow-list (PNG, JPEG, WEBP, GIF, BMP), computes SHA-256, derives chapter and function from the target test run, and inserts the `evidence_files` row. On failure it removes the object and returns a specific error. The bucket also sets its own size limit and allowed MIME types as a second layer.
- **Rejected.** Client-only validation and hashing (not trustworthy as a record). Proxying the upload through the function (20 MB bodies against tight memory and CPU limits).
- **Consequences.** A file that is uploaded but never finalised is an orphan; it is invisible to the app because no row points to it. Document a cleanup query. Hashing 20 MB fits the function limits, but streaming the download is safer than buffering.

### ADR-005 — The Word document is built in the browser

- **Context.** A report may embed hundreds of images. Edge Functions on the Free plan are limited to 256 MB of memory and 2 s of CPU per request.
- **Decision.** Generate with `docx` in the browser. For each selected image: fetch the original through a short-lived signed URL, decode it, scale it down so its long edge is at most a configurable maximum (default 2000 px), re-encode as PNG, embed. Process images one at a time and show progress. Originals in storage are untouched. Animated GIFs contribute their first frame.
- **Rejected.** Generation in an Edge Function (exceeds the limits for any realistic report). A separate always-on server (not free, more to run).
- **Consequences.** The user's own session fetches the data, so RLS already limits what can go into a report. The browser tab must stay open during generation. Because the client assembles the file, the server-side record of *what was selected* (ADR-006) is the authoritative trace, and a SHA-256 of the saved file is stored with it.

### ADR-006 — An export is a database record, not just a download

- **Context.** Selection, ordering and caption edits must survive a page reload, and past exports must be traceable.
- **Decision.** `document_exports` holds one row per export with status `draft` or `generated`. `document_export_items` holds the selected evidence with `position` and an optional `caption_override`. The selection screen edits a draft. An RPC `finalize_export` stamps `generated_at` server-side, stores counts, file path and hash, and flips the status; items of a generated export are read-only. Saving the file to storage is optional, the record is not.
- **Rejected.** A JSON array of evidence ids on the export row (no referential integrity, awkward to audit).
- **Consequences.** Removing an image from an export deletes only the item row. Caption overrides apply to that export alone and leave the evidence record unchanged.

### ADR-007 — Audit trail written by triggers into an append-only table

- **Context.** Every meaningful change must be recorded with actor, time and what changed, and ordinary users must not be able to alter the record.
- **Decision.** One generic trigger function writes to `audit_events` on insert, update and delete for all domain tables, storing the changed columns (old and new values) as JSON. Timestamps come from the database in UTC. `authenticated` and `anon` have no insert, update or delete privilege on the table, and a trigger rejects updates and deletes outright. Edge Functions write their own events for actions with no row change the trigger can see (password reset, deactivation). When a write arrives through the secret key, `auth.uid()` is empty, so the function passes the acting user explicitly; no event may be stored without an actor.
- **Rejected.** Logging from the frontend (skippable). Application-level logging in each call site (easy to forget one).
- **Consequences.** Selection changes and document generation are audited for free, because both are row changes (ADR-006). The project owner, with direct database access, can still alter anything; state this limit in the README.

### ADR-008 — Soft delete only

- **Context.** Deleting a chapter must not destroy the evidence and history beneath it.
- **Decision.** Domain tables have `deleted_at` and `deleted_by`. There are no delete policies. An RPC `archive_node` marks a node and all its descendants with the same timestamp, so a restore can undo exactly that operation. Archived items disappear from normal views; administrators can list and restore them. Version 1 has no purge.
- **Consequences.** Queries filter on `deleted_at is null` (use views or partial indexes). Unique constraints that should ignore archived rows must be partial.

### ADR-009 — Static SPA on Cloudflare

- **Context.** The owner asked for Cloudflare Pages. Cloudflare's documentation now steers new projects towards Workers with static assets, while Pages remains supported.
- **Decision.** Build a plain static `dist/` with an SPA fallback and no host-specific code. Deploy to Pages as requested. In the deployment guide, note the Workers static-assets route as the alternative and what would change (a Wrangler config file, nothing in the app).
- **Consequences.** Switching hosts later is configuration only.

### ADR-010 — Supabase publishable and secret keys

- **Context.** Supabase is retiring the legacy `anon` and `service_role` keys in favour of publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys.
- **Decision.** The browser uses the publishable key. Edge Functions read the secret key from the environment Supabase provides. Do not build on the legacy keys. Confirm the current variable names in the Supabase docs when wiring this up.

## 4. Data model

All tables: `id uuid` primary key (except where noted), `created_at`, `updated_at` as `timestamptz default now()`, foreign keys indexed. "Soft" means `deleted_at`, `deleted_by`.

| Table | Key columns | Notes |
|---|---|---|
| `user_profiles` | `id` → `auth.users`, `username` unique, `display_name`, `is_admin`, `can_create_protocols`, `is_active`, `must_change_password`, `created_by` | No password or email column |
| `protocols` | `reference` unique, `name`, `description`, `version`, `status` (draft, active, completed, archived), `created_by` | Soft. `updated_at` is bumped by any change beneath it |
| `protocol_access` | `protocol_id`, `user_id`, `role` (viewer, tester, manager), `granted_by`, `granted_at` | Unique on (`protocol_id`, `user_id`) |
| `chapters` | `protocol_id`, `title`, `description`, `position` | Soft |
| `functions` | `protocol_id`, `chapter_id`, `title`, `description`, `position` | Soft |
| `test_runs` | `protocol_id`, `function_id`, `reference`, `title`, `description`, `position` | Soft |
| `test_steps` | `protocol_id`, `test_run_id`, `parent_step_id` (self), `reference`, `description`, `expected_result`, `actual_result`, `status`, `comments`, `executed_by`, `executed_at`, `position` | Soft. Status: not_started, in_progress, passed, failed, blocked, not_applicable |
| `evidence_files` | `protocol_id`, `chapter_id`, `function_id`, `test_run_id`, `test_step_id` (nullable), `storage_path`, `original_filename`, `mime_type`, `size_bytes`, `sha256`, `width`, `height`, `caption`, `description`, `uploaded_by`, `uploaded_at` | Soft. Rows are created only by `finalize-evidence` |
| `document_exports` | `protocol_id`, `name`, `status` (draft, generated), `storage_path` (nullable), `sha256`, `generated_by`, `generated_at`, selection counts | |
| `document_export_items` | `export_id`, `evidence_id`, `position`, `caption_override` | Unique on (`export_id`, `evidence_id`) |
| `audit_events` | `id bigint identity`, `occurred_at`, `actor_id`, `event_type`, `entity_type`, `entity_id`, `protocol_id`, `metadata jsonb` | Append-only |
| `app_settings` | `key`, `value jsonb` | Upload size limit, report page size, image long-edge maximum |

Ordering uses an integer `position` per parent. Reordering goes through one RPC that takes the parent and the full ordered list of ids and renumbers in a single transaction. Test-run status shown in the UI is derived from its steps, not stored.

## 5. Permissions

| Action | Viewer | Tester | Manager | Admin |
|---|---|---|---|---|
| See an assigned protocol, its structure and evidence | ✓ | ✓ | ✓ | all protocols |
| Download saved reports | ✓ | ✓ | ✓ | ✓ |
| Record actual result, status, comments | | ✓ | ✓ | ✓ |
| Upload evidence; edit caption and description of own uploads | | ✓ | ✓ | ✓ |
| Edit structure (chapters, functions, runs, steps): add, edit, reorder, duplicate, archive | | | ✓ | ✓ |
| Edit or archive any evidence in the protocol | | | ✓ | ✓ |
| Build selections and generate reports | | | ✓ | ✓ |
| Edit protocol details | | | ✓ | ✓ |
| Create a protocol (also any user with the global `can_create_protocols` flag, whatever their protocol roles) | | | | ✓ |
| Archive or restore a protocol; assign access; manage users; see the global audit trail | | | | ✓ |

Whoever creates a protocol becomes its manager automatically. Managers can read the audit events of their own protocols.

## 6. Server-side surface

RPCs (Postgres functions, each checks the caller's role):

- `needs_setup()`
- `record_step_result(step_id, actual_result, status, comments)`
- `reorder_siblings(node_type, parent_id, ordered_ids)`
- `duplicate_node(node_type, id)` — deep copy of the structure, execution fields reset, no evidence copied, placed after the source
- `archive_node(node_type, id)`, `restore_node(node_type, id)`
- `finalize_export(export_id, storage_path, sha256)`
- `dashboard_stats()` or equivalent views with `security_invoker`, so RLS applies to the numbers

Edge Functions:

- `bootstrap-admin` — see ADR-002
- `admin-users` — verifies the caller is an active administrator, then creates users, resets passwords, activates or deactivates (deactivation also bans the Auth user so existing sessions end), updates display name and flags
- `finalize-evidence` — see ADR-004

All functions validate input with a schema, restrict CORS to the configured origins, and return errors that say what the user can do without exposing internals.

## 7. Storage

| Bucket | Path | Read | Write |
|---|---|---|---|
| `evidence` (private) | `{protocol_id}/{evidence_id}/{filename}` | any role on the protocol | insert: tester and above; no update, no delete |
| `exports` (private) | `{protocol_id}/{export_id}.docx` | any role on the protocol | insert: manager and above; no update, no delete |

Policies on `storage.objects` read the protocol id from the first path segment. The UI accesses files through signed URLs with a short expiry.

## 8. What to revisit as it grows

- **Storage.** First limit reached. Show usage on the admin dashboard; the upgrade path is the Supabase Pro plan.
- **Large reports.** If browser generation becomes too slow or memory-heavy, move it to a small dedicated worker service. ADR-006 already keeps the record independent of where the file is built.
- **Thumbnails.** Version 1 displays originals scaled by CSS with lazy loading. If galleries get slow, generate thumbnails at upload time.
- **Tamper evidence.** If the audit trail must stand up to stronger scrutiny, add hash chaining to `audit_events`.
- **Inactivity pause.** A paused Free project makes the app unreachable until it is restored from the dashboard. Document it; do not hide it with a keep-alive hack.
