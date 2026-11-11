# ADR-013 — Server code writes through service-only RPCs that declare the actor

Date: 2026-11-11. Status: accepted. Refines ADR-007.

- **Context.** Edge Functions use the secret key, so `auth.uid()` is empty and the audit trigger cannot know who acted. A write through the table API with the secret key would either be unattributed or need the trigger to trust a client-supplied value.
- **Decision.** Edge Functions write only by calling `public.svc_*` functions. Execute on them is revoked from `public`, `anon` and `authenticated` and granted to `service_role` only. Each takes `p_actor`, checks that actor (for example `require_active_admin`), and calls `private.set_actor`, which sets the transaction-local `app.actor_id`. `private.current_actor()` uses `auth.uid()` first and falls back to that setting. If both are empty, the audit write raises `audit_actor_missing`, so a change without an actor cannot be stored.
- **Consequences.** A direct secret-key write through the table API fails by design (tested in `tests/db/audit.test.ts`). Test fixtures that insert rows directly set `app.actor_id` themselves, exactly as server code does.
