# Security review (Phase 7)

Date: 2026-11-11. Scope: every table, function, bucket and Edge Function in the repository at the Phase 7 commit, against the rules in CLAUDE.md and section 5 of SPEC.md. Most checks are encoded as tests in `tests/db/security.test.ts` and `tests/db/audit-coverage.test.ts`, so a later migration that weakens them fails `npm run test:db`.

This is an engineering review, not a compliance assessment. The application makes no claim of 21 CFR Part 11, GAMP 5 or GxP compliance.

## Tables

| Table | RLS | Read | Write (API roles) |
|---|---|---|---|
| `user_profiles` | on | own row; administrators all | own `display_name`; everything else via `admin-users` |
| `protocols` | on | any role on the protocol (non-archived); administrators all | managers: details, only while Draft (ADR-017); status any time; creation via `create_protocol` |
| `protocol_access` | on | own rows; managers their protocol's team; administrators all | administrators only (insert, role update, delete) |
| `chapters`, `functions`, `test_runs` | on | any role (live rows); administrators also archived | managers, Draft only; order/archive/duplicate via RPCs |
| `test_steps` | on | as above | managers: definition, Draft only; execution fields only via `record_step_result` (testers and above) |
| `evidence_files` | on | any role (live); administrators also archived | insert only by `finalize-evidence`; caption/description by uploader (tester) or manager; archive via RPC |
| `document_exports` | on | any role (live) | managers: drafts; generation via `finalize_export`; generated exports read-only (trigger) |
| `document_export_items` | on | any role | managers, draft exports only (trigger); delete allowed (selection removal, audited) |
| `app_settings` | on | active users | administrators (validated per key) |
| `audit_events` | on | administrators all; managers their protocols; everyone their own actions | none; triggers reject update, delete and truncate even for the owner |
| `private.password_fingerprints` | on | none | none (server functions only) |

## Functions

- `anon` can execute only `needs_setup()`.
- `authenticated` can execute exactly the 16 RPCs listed in `tests/db/security.test.ts`. Each re-checks the caller's role.
- `svc_*` functions are executable only by `service_role`, used by Edge Functions with an explicit actor (ADR-013).
- Every `security definer` function has a fixed `search_path`.
- The `private` schema is not exposed by PostgREST.

## Storage

Both buckets are private with size and MIME limits. `storage.objects` has only SELECT and INSERT policies, scoped by the protocol id in the path, so no upsert or delete is possible through the API (tested for testers, managers and administrators). Files are served through signed URLs lasting 5 minutes (60 seconds for report downloads).

## Edge Functions

All three verify their caller in code (ADR-014), validate input with zod, restrict CORS to `ALLOWED_ORIGINS`, and return user-safe messages. Internal errors are logged, never returned. `finalize-evidence` touches only an unregistered object uploaded by the caller (ADR-016). The secret key is read only from the function environment, and the browser configuration rejects an `sb_secret_` key.

## Findings

1. **Fixed: `anon` could execute every public RPC.** The core migration revoked default EXECUTE "in schema public", but PostgreSQL's built-in EXECUTE grant to PUBLIC is global and cannot be removed per schema. No data was exposed, because each function refused anonymous callers itself; the second layer was missing. Migration `20261111100800_revoke_public_function_execute.sql` revokes it, and the test now pins the allow-list.
2. **Changed: everyone can read the audit events of their own actions** (new policy), so the dashboard's recent activity works for testers and viewers. They still cannot read other people's events.
3. **Accepted limits** (documented in the README in Phase 8):
   - The project owner, with direct database access, can alter anything, including the audit trail. There is no hash chaining yet (ARCHITECTURE section 8).
   - An Auth access token issued before deactivation stays valid for up to 15 minutes, but RLS denies all data at once.
   - Generated report hashes are computed by the browser; the authoritative trace is the server-side selection record (ADR-005).
   - Uploads never finalised remain as orphan objects; they are shown as "unfinished uploads" on the administrator dashboard.

## Audit coverage (SPEC 4.10)

`tests/db/audit-coverage.test.ts` performs each listed action through the app's own routes and checks for an event with the right actor and a server timestamp:
- user creation, deactivation and password reset
- protocol creation and changes
- chapter, function, test run and step changes
- result changes
- evidence upload, metadata change and archival
- selection added, changed and removed
- document generation
- access granted, changed and removed
- setting changes
