# ADR-012 — Forced password change is enforced in the database

Date: 2026-11-11. Status: accepted. Refines ADR-001 and SPEC 4.2.

- **Context.** When an administrator sets a password, the administrator knows it. If the "choose a new password" step lived only in the UI, the account could be used through the API with the administrator's password, and actions would be attributed to the user.
- **Decision.** The RLS helpers (`private.is_admin`, `private.protocol_role`, `private.active_user_id`) grant nothing while `must_change_password` is set. The flag cannot be cleared by the client (no column grant). After `supabase.auth.updateUser({ password })`, the client calls `complete_password_change()`, which compares a SHA-256 fingerprint of the current bcrypt hash in `auth.users` with the one recorded when the administrator set the password (`private.password_fingerprints`). Only if they differ is the flag cleared and `user.password_changed` audited. The fingerprint is a hash of a hash; no password material is stored outside Supabase Auth.
- **Rejected.** A trigger on `auth.users`: it runs inside GoTrue's connection with no JWT, so it cannot tell a user's own change from an administrator's reset and would attribute the audit event wrongly.
- **Consequences.** A user who changes their password in Settings without calling the RPC is not audited; Settings always calls it. Covered by `tests/db/accounts.test.ts`.
