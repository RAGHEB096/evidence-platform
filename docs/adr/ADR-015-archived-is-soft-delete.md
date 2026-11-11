# ADR-015 — "Archived" is the soft-deleted state, not a protocol status

Date: 2026-11-11. Status: accepted. Changes the `protocols.status` values in section 4 of ARCHITECTURE.md.

- **Context.** The data model listed `archived` among protocol statuses and also gave protocols `deleted_at` (ADR-008). That gives two sources of truth: a protocol could be "archived" but visible, or hidden but "active".
- **Decision.** `protocol_status` is `draft | active | completed`. Archiving a protocol sets `deleted_at` (administrators only, through `archive_node`), and the UI shows such a protocol as "Archived". Restoring it clears `deleted_at` and the stored status is unchanged.
- **Consequences.** Non-administrators lose all access to an archived protocol, because `private.protocol_role` ignores archived protocols. Administrators still see it and can restore it.
