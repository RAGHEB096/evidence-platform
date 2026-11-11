# ADR-018 — Configurable first chapter number; results on test runs without steps

Date: 2026-11-11. Status: accepted (owner feedback after the first live use). Refines ARCHITECTURE section 4 and SPEC 4.3–4.4 and 4.7.

- **Context.** Protocols copied from larger documents do not always start at chapter 1. Steps are not mandatory: a test run can be a single check, and then its expected result, actual result, status and evidence belong on the run itself.
- **Decision — numbering.** `protocols.chapter_start` (default 1, 0–9999) is the number of the first chapter, set in the protocol's Details tab. Chapters are numbered consecutively from it, and functions, test runs and the Word report follow. It is part of the locked definition outside Draft (ADR-017).
- **Decision — run results.**
  - `test_runs` gains `expected_result` (a definition field, edited by managers in the run dialog, locked outside Draft) and the execution fields `actual_result`, `status`, `comments`, `executed_by` and `executed_at`.
  - Testers record them through `record_test_run_result`, audited as `test_run.result_recorded`. Execution fields stay open when the protocol is Released or Completed.
  - While a run has live steps its status is derived from them, and the RPC refuses to set it (`status_derived`).
  - Dashboard progress counts a run without steps as one recorded item. The Word report prints the run's expected result, actual result and status under its heading.
  - Evidence on the whole run already existed.
- **Also.** The tree's "Execute" button is now "Record results".
- **Consequences.** Migration `20261111100900_chapter_start_and_run_results.sql` redefines `guard_structure_lock`, `guard_protocol_details_lock`, `copy_test_run`, `audit_row_change` and `protocol_overview`. A run that later gets steps keeps its recorded fields in the database, but they no longer drive its status.
