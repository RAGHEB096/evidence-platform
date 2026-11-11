# Progress

Maintained by Claude across sessions. Read this after CLAUDE.md, SPEC.md and ARCHITECTURE.md to pick up where work stopped.

## Phase status

| Phase | Status | Commit |
|---|---|---|
| 0 Inspect, plan | Done (plan approved 2026-11-11) | — |
| 1 Project setup, layout, routing, Supabase client, local Supabase | Done | `a30798c` |
| 2 Schema, migrations, RLS, username auth, first-admin setup | Done | `34292d7` |
| 3 User management, protocol access | Done | `038d80a` |
| 4 Protocol editor and hierarchy | Not started | |
| 5 Execution and evidence upload | Not started | |
| 6 Report builder and Word generation | Not started | |
| 7 Dashboard, audit viewer, settings, security review | Not started | |
| 8 Full test run, clean-up, documentation, deployment | Not started | |

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

Phase 3 exit evidence (2026-11-11): `test:db` 62 passed (adds 11 for `admin-users`); `test:e2e` 8 passed (adds creating a user, granting and changing a role, the user signing in through the forced password change, deactivation blocking them, and the no-access empty state); unit 19; typecheck, lint, build clean.

Phase 2 exit evidence (2026-11-11): `test:db` 51 passed; `test:e2e` 6 passed; unit tests 19 passed; typecheck, lint and build clean. Mutation check: loosening the protocol update policy to viewers made 2 RLS tests fail, as expected.

## Data model as built (Phase 2)

Migrations: `20261111100000_core_schema.sql` (tables, helpers, RLS, grants, audit), `20261111100100_auth_and_storage.sql` (setup, account RPCs, `create_protocol`, `user_directory`, buckets, storage policies), `20261111100200_user_administration.sql` (`svc_set_user_flags`, `svc_set_display_name`).

- Default privileges are revoked: a new table or function is unreachable through the API until a migration grants it.
- Helpers in schema `private`: `active_user_id`, `is_admin`, `can_create_protocols`, `protocol_role`, `has_protocol_role(protocol, min_role)`, `try_uuid`, `current_actor`, `write_audit`. All return "no access" for inactive users and for users who must change their password.
- Column-level grants decide what API roles may write. Positions, parents, `protocol_id`, `deleted_at`, execution fields, evidence hash/path/uploader and export status are never directly writable.
- RPCs so far: `needs_setup`, `create_protocol`, `complete_password_change`, `user_directory`; service-only: `svc_bootstrap_admin`, `svc_create_user`, `svc_set_user_active`, `svc_record_password_reset`, `svc_set_user_flags`, `svc_set_display_name`.
- Edge Functions: `bootstrap-admin`, `admin-users` (actions `create`, `reset_password`, `set_active`, `set_flags`, `set_display_name`).
- Still to come: `record_step_result` and `svc_register_evidence` (Phase 5); `reorder_siblings`, `duplicate_node`, `archive_node`, `restore_node` (Phase 4); `finalize_export` (Phase 6); `dashboard_stats` (Phase 7).
- Audit event types come from the generic trigger: `<entity>.created|updated|archived|restored|deleted`, plus `test_step.result_recorded`, `evidence.metadata_changed`, `document_export.generated`, `user.activated|deactivated`, `access.granted|changed|removed`, `selection.added|changed|removed`. Explicit events: `user.password_reset`, `user.password_changed`.

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

## Known gaps

- `npm audit`: 10 moderate advisories, all `minimatch` inside ESLint/typescript-eslint (dev-only, not shipped). Recheck later.
- Main JS chunk ~590 kB (185 kB gzipped). Add route-level lazy loading as pages grow; load `docx` only on the report screen (Phase 6).
- ADR-001 asks to confirm the synthetic email domain against a hosted project. **Blocked: no hosted Supabase project yet.** It is configurable through `VITE_AUTH_EMAIL_DOMAIN` / `AUTH_EMAIL_DOMAIN`.
- `evidence_files` rows are inserted directly by test fixtures until `finalize-evidence` exists (Phase 5).

## Next step

Phase 4: protocol detail page and editor with the full tree (chapter → function → test run → step → sub-steps): add, edit, archive with descendant counts, reorder by drag and drop and by up/down buttons, duplicate, administrator restore of archived items, protocol details editing. RPCs `reorder_siblings`, `duplicate_node`, `archive_node`, `restore_node` with DB tests. E2E for the editor, persistence after sign-out, and a second user being refused an unassigned protocol.
