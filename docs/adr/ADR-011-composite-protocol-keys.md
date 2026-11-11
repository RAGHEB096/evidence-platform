# ADR-011 — Every row's protocol_id is tied to its parent's by composite foreign keys

Date: 2026-11-11. Status: accepted. Refines ADR-003.

- **Context.** ADR-003 keeps policies one-line by checking `protocol_id` on each row. On its own that lets a manager of protocol A insert a function with `protocol_id = A` but a `chapter_id` from protocol B: the policy passes and the hierarchy now crosses protocols.
- **Decision.** Each parent table has `unique (id, protocol_id)`, and each child references `(parent_id, protocol_id)`. Sub-steps reference `(parent_step_id, test_run_id)`. Evidence references its chapter, function, test run and step the same way, plus `(function_id, chapter_id)` and `(test_run_id, function_id)`, so the denormalised ids cannot disagree. Export items reference `(export_id, protocol_id)` and `(evidence_id, protocol_id)`. Parent ids and `protocol_id` are not updatable by API roles, so a row cannot be moved later either.
- **Consequences.** Mismatches fail with a foreign-key error (23503) whatever the caller's role. Covered by `tests/db/rls.test.ts` ("cannot attach a node … from another protocol", "… from another test run", export smuggling).
