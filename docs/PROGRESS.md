# Progress

Maintained by Claude across sessions. Read this after CLAUDE.md, SPEC.md and ARCHITECTURE.md to pick up where work stopped.

## Phase status

| Phase | Status | Commit |
|---|---|---|
| 0 Inspect, plan | Done (plan approved 2026-11-11) | — |
| 1 Project setup, layout, routing, Supabase client, local Supabase | Done | `a30798c` |
| 2 Schema, migrations, RLS, username auth, first-admin setup | Done | `34292d7` |
| 3 User management, protocol access | Done | `038d80a` |
| 4 Protocol editor and hierarchy | Done | `ec5e647` |
| 5 Execution and evidence upload | Done | `c874834` |
| 6 Report builder and Word generation | Done | `9085007` (WIP), `631e647` |
| 6b Owner feedback: release lock, status roll-up | Done | `d2b3e01` |
| 7 Dashboard, audit viewer, settings, security review | Done | `8ff2cf1` |
| 8 Full test run, clean-up, documentation, deployment | Done except deployment (needs owner accounts) | "Phase 8: …" |

## Environment (this machine)

- Windows 11, Node 26.13, npm 11.20, Docker 29.5 (Docker Desktop must be running).
- Supabase CLI is a pinned devDependency (`supabase@3.1.0`); always call it as `npx supabase …`. There is no global install.
- Deno is not installed; Edge Functions run in the CLI's Docker edge runtime (Deno 2.1), which `npx supabase start` serves automatically along with `supabase/functions/.env`.
- Playwright Chromium installed with `npx playwright install chromium`.

## How to verify

Prerequisites: Docker running, then `npx supabase start`.
- `.env.local` from `.env.example`; the publishable key comes from `npx supabase status -o env` (`PUBLISHABLE_KEY`).
- `supabase/functions/.env` from `supabase/functions/.env.example`, with a random `SETUP_TOKEN` of at least 24 characters. Restart the stack (`npx supabase stop && npx supabase start`) after changing it.

**`npm run test:db` and `npm run test:e2e` each run `supabase db reset` first.** They wipe local data on purpose, so every run starts from the migrations. Do not keep anything you care about in the local database.

```
npm run typecheck
npm run lint
npm test            # unit: nav, env, status badge, usernames/passwords, error mapping
npm run test:db     # reset → bootstrap-admin → RLS/RPC/storage/audit tests with real sessions
npm run test:e2e    # reset → setup via UI → sign-in tests → shell (production build on :4173)
npm run build
npm run dev         # http://localhost:5173 (after a reset, /setup is offered on the sign-in page)
```

Phase 8 final run (2026-11-11): typecheck and lint clean; `npm test` 74 passed; `npm run test:db` 135 passed; `npm run test:e2e` 16 passed; `npm run build` clean (no chunk warnings); `npm run test:perf` with 300 images passed (see Performance).

Phase 7 exit evidence (2026-11-11): `test:db` 135 passed (adds `dashboard.test.ts` for figures per role and anonymous refusal, `security.test.ts` for the review checks, `audit-coverage.test.ts` for every SPEC 4.10 action with its actor); `test:e2e` 16 passed (adds dashboard progress and storage, audit filter and change details, admin limits persisting and validation, a user changing display name and password); unit 70; lint and build clean, with no chunk warnings after lazy-loading every page except sign-in. Dashboard and audit trail checked visually. Review record: `docs/SECURITY-REVIEW.md`.

Owner feedback round (2026-11-11), ADR-017: `test:db` 98 (adds 6 lifecycle and derived-step tests), `test:e2e` 13 (adds release lock and roll-up), unit 69 (adds 3 roll-up tests); lint and build clean; tree badges and status menu checked visually.

Phase 6 exit evidence (2026-11-11): `test:db` 92 passed (adds 6 for `finalize_export`, `reorder_export_items`, `copy_export_to_draft`); `test:e2e` 12 passed (adds selecting images from two chapters, single and whole-chapter selection, caption override, reorder, the draft surviving a reload, generation and download, unzipping the .docx, history listing, re-download and contained evidence; the report test then passed 5 runs in a row); unit 66 (adds 13 for the report model and DOCX builder); lint and build clean. **Opened a generated report in Microsoft Word 16 on this machine** (automation, read-only, hidden). Word read it without errors, counted 4 pages and listed the Heading 1–3 paragraphs as expected, and its PDF export showed the layout from SPEC 4.7. The owner should still review a real report in Word, with real screenshots, themselves.

Phase 5 exit evidence (2026-11-11): `test:db` 86 passed (adds 12: finalize-evidence registration and hashing, rejection of renamed/truncated/mismatched files with cleanup, refusal to touch others' or registered objects, path checks, bucket size limit following the setting, `record_step_result` stamping and audit, evidence archive keeping the file); `test:e2e` 11 passed (adds results, a three-file upload with one rejected file, preview with next/previous and keyboard, caption edit, persistence, library search and filter); unit 53 (adds 18 for image validation with real fixtures); typecheck, lint, build clean. Visually checked the execution view and the preview dialog in Chromium.

Phase 4 exit evidence (2026-11-11): `test:db` 74 passed (adds 12 for reorder/archive/restore/duplicate); `test:e2e` 10 passed (adds the editor flow: build all five levels, edit, reorder by button and keyboard drag, duplicate, archive with counts, administrator restore, persistence after sign-out and sign-in; and an unassigned user refused by direct URL); unit 35 (adds tree building, numbering, moves, run-status derivation); typecheck, lint, build clean.

Phase 3 exit evidence (2026-11-11): `test:db` 62 passed (adds 11 for `admin-users`); `test:e2e` 8 passed (adds creating a user, granting and changing a role, the user signing in through the forced password change, deactivation blocking them, and the no-access empty state); unit 19; typecheck, lint, build clean.

Phase 2 exit evidence (2026-11-11): `test:db` 51 passed; `test:e2e` 6 passed; unit tests 19 passed; typecheck, lint and build clean. Mutation check: loosening the protocol update policy to viewers made 2 RLS tests fail, as expected.

## Data model as built (Phase 2)

Migrations: `20261111100000_core_schema.sql` (tables, helpers, RLS, grants, audit), `20261111100100_auth_and_storage.sql` (setup, account RPCs, `create_protocol`, `user_directory`, buckets, storage policies), `20261111100200_user_administration.sql` (`svc_set_user_flags`, `svc_set_display_name`), `20261111100300_hierarchy_operations.sql` (`node_counts`, `reorder_siblings`, `archive_node`, `restore_node`, `duplicate_node`), `20261111100400_execution_and_evidence.sql` (`record_step_result`, `svc_check_protocol_role`, `svc_evidence_object`, `svc_register_evidence`), `20261111100500_report_exports.sql` (`reorder_export_items`, `finalize_export`, `copy_export_to_draft`), `20261111100600_release_lock_and_derived_steps.sql` (status `released`, structure lock triggers, `record_step_result` refusing status on parent steps), `20261111100700_dashboard_and_audit_access.sql` (`dashboard_totals`, `protocol_overview`, `storage_usage`, audit policy for one's own actions), `20261111100800_revoke_public_function_execute.sql` (security review fix).

- Default privileges are revoked: a new table or function is unreachable through the API until a migration grants it.
- Helpers in schema `private`: `active_user_id`, `is_admin`, `can_create_protocols`, `protocol_role`, `has_protocol_role(protocol, min_role)`, `try_uuid`, `current_actor`, `write_audit`. All return "no access" for inactive users and for users who must change their password.
- Column-level grants decide what API roles may write. Positions, parents, `protocol_id`, `deleted_at`, execution fields, evidence hash/path/uploader and export status are never directly writable.
- RPCs so far: `needs_setup`, `create_protocol`, `complete_password_change`, `user_directory`, `node_counts`, `reorder_siblings`, `archive_node`, `restore_node`, `duplicate_node`, `record_step_result`, `reorder_export_items`, `finalize_export`, `copy_export_to_draft`; service-only: `svc_bootstrap_admin`, `svc_create_user`, `svc_set_user_active`, `svc_record_password_reset`, `svc_set_user_flags`, `svc_set_display_name`, `svc_check_protocol_role`, `svc_evidence_object`, `svc_register_evidence`.
- Edge Functions: `bootstrap-admin`, `admin-users` (actions `create`, `reset_password`, `set_active`, `set_flags`, `set_display_name`), `finalize-evidence`.
- Dashboard: `dashboard_totals` and `protocol_overview` are `security invoker`, so RLS shapes the numbers; `storage_usage` is administrators only.
- Audit event types come from the generic trigger: `<entity>.created|updated|archived|restored|deleted`, plus `test_step.result_recorded`, `evidence.metadata_changed`, `document_export.generated`, `user.activated|deactivated`, `access.granted|changed|removed`, `selection.added|changed|removed`. Explicit events: `user.password_reset`, `user.password_changed`, `<type>.duplicated` (with `source_id`).

## Decisions

Ordinary implementation choices that are not obvious from the code. Design-level changes are ADRs in `docs/adr/` (ADR-011 to ADR-015 so far).

### Phase 1
- **Docs moved into `docs/`.** SPEC.md and ARCHITECTURE.md were at the repo root while CLAUDE.md and the spec referred to `docs/…`. Moved them; CLAUDE.md stays at the root.
- **TypeScript pinned to `~6.0.3`.** TypeScript 7 (the native port) is npm `latest`, but typescript-eslint 8.72 supports `<6.1`. Revisit when typescript-eslint supports 7.
- **Versions in use:** React 19.3, React Router 8.5 (`RouterProvider` from `react-router/dom`), Vite 8.3 (Rolldown), Tailwind 4.3, shadcn 4.23 (style `radix-nova`, base Radix), TanStack Query 5, zod 4, react-hook-form 7 with @hookform/resolvers 7, Vitest 5, Playwright 1.65, ESLint 10, supabase-js 2.119, pg 8 (tests only).
- **shadcn alias fix.** shadcn reads path aliases from the root `tsconfig.json`; with only project references it wrote into a literal `@/` folder. The root tsconfig now carries `paths` too.
- **Generated `src/hooks/use-mobile.ts` rewritten** with `useSyncExternalStore`, because the shadcn version fails the React Compiler lint rule. `src/components/ui/**` is otherwise as generated and excluded from lint.
- **One Vitest config, two projects:** `unit` (jsdom) and `db` (node, files run sequentially).
- **E2E runs against the production build** (`vite preview` on :4173).
- **Env validation at start-up** (`src/lib/env.ts`, zod). A missing variable shows a configuration page; an `sb_secret_` key in the browser config is rejected.
- **Synthetic email domain** is `VITE_AUTH_EMAIL_DOMAIN` for the app and `AUTH_EMAIL_DOMAIN` for functions; both must match. Locally `users.evidence-platform.local`.
- **ESLint forbids `localStorage`** in app code. supabase-js session persistence is unaffected.
- **Local Auth config:** sign-ups off, anonymous off, email confirmations off, password minimum 10 with letters and digits, access tokens 900 s, email sending 0/h, realtime/analytics/vector disabled.

### Phase 2
- **Composite keys, forced password change, actor-carrying service RPCs, function auth, "archived" semantics:** ADR-011 to ADR-015.
- **`create_protocol()` RPC instead of a table insert.** With a plain insert, the creator could not read their own new row back (`RETURNING` is checked against the SELECT policy before the manager grant exists). The RPC inserts the protocol and the creator's manager access in one transaction.
- **Protocol references are unique case-insensitively, including archived protocols**, so a restore can never collide.
- **`protocol_access` rows are hard-deleted when access is removed.** They are configuration rather than evidence, and the trigger audits `access.removed` with the full old row.
- **Other users' names come from `user_directory()`** (id, username, display name, active), available to any active user. `user_profiles` itself shows only your own row, or everyone to administrators.
- **Positions:** a BEFORE INSERT trigger appends a new node after its siblings and refuses inserts under an archived parent. There is no unique constraint on position; `reorder_siblings` renumbers in one transaction.
- **`protocols.updated_at`** is bumped by triggers on chapters, functions, test runs, steps and evidence, once per transaction. Changes that touch only `updated_at` are not audited (refinement 7).
- **Settings** are validated by a CHECK per key: upload limit 1–50 MB, page size A4 or Letter, long edge 500–6000 px. Changing the upload limit also updates the evidence bucket's own `file_size_limit`.
- **Buckets are created in a migration** (not only in config.toml), so hosted projects get them from `supabase db push`. The evidence bucket also allows `image/x-ms-bmp`, which some systems report for BMP.
- **Sign-in** is username → normalised (trim, lowercase) → synthetic email → `signInWithPassword`. Any failure, including an inactive profile, shows "Incorrect username or password, or the account is not active."
- **Test isolation:** both DB and E2E suites reset the local database. DB tests bootstrap an administrator through the real function in global setup; E2E runs setup through the UI in a `setup` project that the others depend on, and saves the session to `playwright/.auth/` (git-ignored).

### Phase 3
- **All account changes go through `admin-users`**, including flags and display name, so each is attributed to the acting administrator (ADR-013). Protocol access is ordinary table writes that RLS restricts to administrators; the trigger audits them with `auth.uid()`.
- **Deactivation order:** the database flag goes first (it enforces the last-administrator rule and closes RLS at once), then the Auth ban. If the ban fails, the user is told to retry; the account is already inert. Reactivation lifts the ban first, then sets the flag.
- **Usernames cannot be changed**, because they identify the account in the audit trail. Display names can.
- **The initial password is generated in the browser** (14 characters, no ambiguous characters) and shown once in the dialog for the administrator to hand over. It is never stored outside Supabase Auth.
- **Protocols list and "Create protocol" were built in Phase 3**, because assigning access needs protocols to exist. The list filters by status; administrators can also filter for archived protocols.
- **User Management:** a list with search and status/permission filters, plus a detail page (`/users/:id`) with edit, reset password, deactivate/reactivate, and a protocol-access table where roles are added, changed and removed.

### Phase 4
- **Archive cascades in one transaction with one timestamp**, including evidence beneath the node. `restore_node` restores only rows carrying that same timestamp, so items archived separately beforehand stay archived. Restoring requires the parent to be live. Only administrators restore (SPEC 4.3); managers archive structure and evidence; only administrators archive protocols.
- **Reorder** takes the full list of live siblings. Anything else (missing, extra, duplicate, foreign id) is refused as `stale_order` and the client refetches. Archived siblings are renumbered after the live ones. For steps, `p_parent_id` is the test run (top-level steps) or the parent step (sub-steps).
- **Duplicate** (chapters, functions, test runs) copies live descendants only, keeps references and texts, resets execution fields, copies no evidence, inserts directly after the source (shifting later siblings), and appends " (copy)" to the top node's title. An explicit `<type>.duplicated` audit event records the source.
- **Moving a node to a different parent is not supported** (not in the spec). Parent columns are not client-writable, so the denormalised ids on evidence can never go stale.
- **Tree UI:** each sibling list has its own dnd-kit `DndContext`. Disabled lists still get one, otherwise their items register as drop targets in the parent's list (found by the E2E keyboard-drag test). Reordering works by pointer drag, keyboard drag (Space, arrows, Space) with announcements that name the node, and visible up/down buttons. Numbering ("1.2.3", "Step 2.1") is computed client-side from position order, and archived nodes are not numbered.
- **Not-assigned protocols** show "Protocol not available", which does not reveal whether the protocol exists.
- **Protocol detail page** (`/protocols/:id`) has Structure, Details (managers edit; others read-only) and Team (managers and administrators) tabs; administrators archive and restore the protocol from the header.

### Phase 5
- **Evidence finalisation safeguards:** see ADR-016 (caller role, exact path, caller-owned unregistered object, shared validator, bounded buffering).
- **One validator, two runtimes:** `supabase/functions/_shared/image-format.ts` has no imports and runs in Vite and Deno. The `@shared` alias points there from the app (vite, vitest and tsconfig).
- **Image fixtures** in `tests/fixtures/images/` are real files: PNG, JPEG and WEBP rendered by Chromium, plus minimal valid GIF and BMP. Regenerate them with `node scripts/make-image-fixtures.mjs tests/fixtures/images`.
- **Upload:** each file is checked in the browser first (reading at most limit + 1 bytes), then uploaded with `XMLHttpRequest` for per-file progress, three at a time, then finalised. A rejection never stops the others. Messages always start with the file name.
- **Results** are saved per step with an explicit "Save result" (marked when there are unsaved changes) through `record_step_result`, which stamps `executed_by`/`executed_at` and records nothing when the values are unchanged. Run status is derived (`deriveRunStatus`), never stored.
- **Evidence display** uses short-lived signed URLs (5 minutes, fetched in one batch per list and refreshed before expiry), with originals scaled by CSS and lazy-loaded. Thumbnails are not generated (ARCHITECTURE section 8).
- **Evidence Library** filters on the server (search with `ilike` over file name, caption and description; protocol, cascading chapter/function/test run, uploader, date range) and pages 48 at a time. Location names come from PostgREST embeds that name the composite foreign keys explicitly.
- **Archiving evidence** goes through `archive_node('evidence', id)` (managers and administrators); the file stays in storage.

### Phase 6
- **One shared draft per protocol:** the builder resumes the protocol's most recent draft, whoever started it, and creates it on the first change (not on opening the page). After generating, `copy_export_to_draft` starts a new draft with the same settings and live selection, so the generated export stays read-only and work can continue.
- **Report headings keep the protocol's own numbering** (a report that leaves out chapter 1 starts at "2."), so every heading traces back to the app. A parent step appears when one of its sub-steps has selected evidence. Evidence numbers run 001, 002… through the document. Each image also shows its source file name and SHA-256.
- **Counts:** the browser computes chapters, test runs and steps from the same model that builds the document. `finalize_export` recomputes the image count from the stored live selection and refuses a mismatch (`selection_changed`). Who generated the report and when are stamped by the server.
- **Images:** fetched through signed URLs refreshed 25 at a time, decoded with `createImageBitmap` (a GIF contributes its first frame), scaled to the long-edge setting, re-encoded as PNG one at a time, and fitted to the printable width and at most two thirds of the page height, never enlarged. docx stores identical image bytes once.
- **Layout:** the cover sits in its own section without header or footer. The second section holds the information page and the chapters, with the header (title and reference) and "Page X of Y" footer. Only `pageBreakBefore` on chapter headings forces breaks, so there are no blank pages. Arial throughout; A4 by default from the administrator setting (`report_page_size`, constant `DEFAULT_REPORT_PAGE_SIZE`).
- **Downloads** of saved reports use 60-second signed URLs with a download file name. Generated Documents shows generated reports by default; drafts are behind the status filter.
- **Selection checkboxes update optimistically**, written to the cache in the same frame as the click; a draft created by the first click inherits the optimistic items before the page switches to it.
- **Route-level lazy loading** with React Router's `lazy` route property; a thin progress bar shows while a page loads. The main chunk went from 1.08 MB to 485 kB, and `docx` loads only when generating.

### Owner feedback (after Phase 6)
- **Release lock and status roll-up:** see ADR-017. Statuses Draft / Released / Completed are changed from the protocol header. Outside Draft the structure and details are locked in the database. Every level shows a status derived from its children, through `effectiveStatus` in `src/features/protocols/tree.ts`.
- **Applying migrations without losing data:** use `npx supabase migration up` for new migrations. `npx supabase db reset` wipes the local database, and so does every run of `test:db` and `test:e2e`.

### Phase 7
- **Dashboard** figures come from two `security invoker` SQL functions, so administrators get global numbers and everyone else only their protocols, with no client-side filtering. Execution progress counts steps without sub-steps (ADR-017).
- **Storage usage** compares evidence and saved reports with `STORAGE_PLAN_LIMIT_BYTES` (1 GB, Supabase Free) in `src/config.ts`, warns above 80%, and shows unfinished uploads.
- **Recent activity and the Audit Trail** read `audit_events` under RLS. A new policy lets everyone read their own actions. The Audit Trail page (nav item for administrators and managers) filters by protocol, user, event type and date on the server, 50 per page, and expands each event into a before/after table.
- **Settings:** display name for everyone (audited); password change for everyone, verifying the current password first and auditing via `complete_password_change`; administrators edit the upload limit (1–50 MB, also applied to the bucket), report page size and image long edge, validated in the form and by the database CHECK.
- **Security review:** see `docs/SECURITY-REVIEW.md`. One real finding fixed: `anon` could execute public RPCs because PostgreSQL's EXECUTE grant to PUBLIC is global. Pinned by tests.
- **Lazy loading:** every page except sign-in, setup and change-password loads on demand; the main chunk is ~500 kB (React, router, supabase-js, UI kit).

### Phase 8
- **`npm run test:perf`** (`playwright.perf.config.ts`, `tests/perf/large-report.spec.ts`) shares the E2E build, reset and setup, uploads `PERF_IMAGES` distinct full-HD screenshots through the real upload path, selects them all, generates the report in the browser and prints timings. Not part of `test:e2e`. Results are under "Performance" below.
- **Evidence finalisation retries** transient failures: 5xx or unreachable, up to 4 attempts with 0.5/1/2 s backoff. "Already registered" on a retry counts as success, because the earlier attempt had worked and only its answer was lost. Found by the performance run: the local function runtime returned 503 under 8 concurrent finalisations, which previously meant a failed upload plus an orphan file. Rejections (invalid image, no permission) are never retried. Unit-tested in `tests/unit/upload-retry.test.ts`.
- **README.md** and **docs/DEPLOY.md** written. Free-tier figures were taken from supabase.com/pricing, the Supabase Edge Function limits page and the Cloudflare Pages limits page on 2026-11-11. DEPLOY.md sets Auth settings by hand in the dashboard rather than with `supabase config push`, which would also push local values such as the localhost Site URL.
- **Deployment not performed:** it needs the owner's GitHub, Supabase and Cloudflare accounts (SPEC section 2). Everything up to that point is prepared.

## Performance (Phase 8)

`npm run test:perf` on this machine (Windows 11, local Supabase in Docker, headless Chromium), 2026-11-11, 300 distinct 1920×1080 PNG screenshots, average 426 kB:

| Measure | Result |
|---|---|
| Upload and finalise 300 files (8 in parallel) | 26.6 s, 0 retries (an earlier run needed retries: runtime 503 at image 155 before the retry fix) |
| Generate the report in the browser (300 images) | 44.3 s |
| .docx size | 111.2 MB, 300 embedded media files |
| JavaScript heap after generation | ~415 MB (renderer process ~815 MB during generation) |
| Microsoft Word 16 opening it (read-only, automation) | 2.3 s, 157 pages, 300 inline images |

**Found and fixed by this run:** a report over 50 MB could not be saved to the exports bucket, and because saving came before the download, the user lost the generated file. Now the file is always downloaded and the export always recorded; a copy is saved only when it fits under `EXPORT_SAVE_LIMIT_BYTES` (50 MB), and otherwise the user is told. Smaller runs: 20 images generated in 5.7 s (7 MB).

## Known gaps

- `npm audit`: 10 moderate advisories, all `minimatch` inside ESLint/typescript-eslint (dev-only, not shipped). Recheck later.
- Uploads that are uploaded but never finalised (tab closed mid-upload) remain as orphan objects; the cleanup query goes in the README (Phase 8).
- ADR-001 asks to confirm the synthetic email domain against a hosted project. **Blocked: no hosted Supabase project yet.** It is configurable through `VITE_AUTH_EMAIL_DOMAIN` / `AUTH_EMAIL_DOMAIN`.
- `evidence_files` rows are inserted directly by test fixtures until `finalize-evidence` exists (Phase 5).

- One run of `report.spec.ts` during Phase 6 reported a failure whose details were filtered out of the log. After the optimistic-selection fix it passed 5 times in a row and in the full suite. Watch for flakiness there.
- The test suites share the local database with manual use, so running them wipes the owner's local data. Separating them (a second local stack or schema) is proposed as the next step.
- Reports over 50 MB (about 100–120 full-HD screenshots) cannot be saved to Generated Documents on the Free plan; they are downloaded and recorded without a file. Raising this needs a paid plan and a migration raising the exports bucket limit.
- Edge Function code is not typechecked or linted in CI (Deno is not installed); it is exercised by the DB and E2E suites.
- A stray empty folder tree `F:cUsers…` outside the repo was created during Phase 5 by a screenshot script. It can be deleted.

## Definition of done (SPEC section 9), 2026-11-11

| # | Item | State | How checked |
|---|---|---|---|
| 1 | Administrator signs in with username and password, no email anywhere | Verified | E2E setup and sign-in; the page text is asserted not to contain the email domain; `user_profiles` has no email column (DB test) |
| 2 | Administrator creates accounts and assigns them to protocols with a role | Verified | E2E `users.spec`; DB `admin-users.test` |
| 3 | Assigned users sign in with username and password | Verified | E2E (forced password change, then dashboard and protocol visible) |
| 4 | Permitted users create and configure protocols | Verified | E2E editor; DB `create_protocol` with the "can create protocols" flag |
| 5 | Chapters and functions added, edited, archived, reordered | Verified | E2E editor (buttons and keyboard drag); DB `hierarchy.test` |
| 6 | Functions hold several test runs; runs hold nested steps and sub-steps | Verified | DB and unit tree tests; E2E sub-steps to three levels |
| 7 | Several screenshots uploaded at once, previewed, tied to steps | Verified | E2E `execution.spec` (three files, one rejected by name); DB `evidence.test` |
| 8 | Specific images selected for export | Verified | E2E `report.spec` |
| 9 | Word document correctly structured, editable, exactly the selected images | Verified (automated) | Unit tests unzip a generated .docx; E2E unzips the downloaded file; Microsoft Word opened a 3-image and a 300-image report (headings recognised, 300 inline images) and exported the small one to PDF, which was inspected. Editing in Word was not tried. |
| 10 | Earlier exports listed and downloadable by authorised users | Verified | E2E history and re-download; DB storage tests (viewer downloads, outsider refused) |
| 11 | Data persists across sign-out and sign-in | Verified | E2E editor and execution (reload, sign out and back in) |
| 12 | Users cannot reach unassigned protocols, including by direct API calls | Verified | DB `rls.test`, `storage.test`, `dashboard.test`, `security.test` with real sessions; E2E direct URL refused |
| 13 | Production build succeeds | Verified | `npm run build` |
| 14 | Setup and deployment instructions complete | Written, not exercised on a hosted project | README.md, docs/DEPLOY.md |
| 15 | Reachable at a public URL and passes the smoke test there | **Blocked**: needs the owner's GitHub, Supabase and Cloudflare accounts | — |
| 16 | A generated report looks right in Microsoft Word | **Needs the owner** | Opened by automation only; the owner should open a report built from real screenshots in Word |

## Deployment status (2026-11-11)

- **GitHub:** pushed to https://github.com/RAGHEB096/evidence-platform (private). History scanned first: only the `.env.example` files, no secrets.
- **Supabase project** `etwtckdfckpbjzdvfqkz` (Frankfurt, Postgres 17): linked; 9 migrations applied with `db push --remote`; secrets `SETUP_TOKEN`, `AUTH_EMAIL_DOMAIN` and `ALLOWED_ORIGINS` set from the git-ignored `supabase/functions/.env.production`; three functions deployed, active, `verify_jwt` off.
- **Live checks (read-only or refused calls):** `needs_setup` true; anonymous `create_protocol` 401; anonymous table read refused (42501); `bootstrap-admin` refuses a wrong token with the expected message.
- **Open, found by those checks:**
  1. Hosted Auth rejected `users.example.com` (`email_address_invalid`), the ADR-001 risk. **Owner chose `ragheb096.github.io`** (their GitHub Pages domain, no mail server). It is set in `AUTH_EMAIL_DOMAIN` (verified by digest) and must also be the Cloudflare variable `VITE_AUTH_EMAIL_DOMAIN`. Acceptance is confirmed only by first-time setup on the live site; if refused, setup now reports `auth_domain_rejected`.
  2. Public sign-up is still enabled in the hosted Auth settings (the project default). The owner must disable it (DEPLOY.md step 4), together with the other Auth settings.
- **Not started:** Cloudflare Pages (owner needs an account), Auth settings, first-time setup, unsetting the setup token, live smoke test.

## Next step

Owner: disable sign-ups and apply the other Auth settings (DEPLOY.md step 4); create a Cloudflare account. Then: set the domain secret, create the Pages project, add its address to `ALLOWED_ORIGINS` and the Auth Site URL, run first-time setup on the live site, unset `SETUP_TOKEN`, and run the smoke test.
