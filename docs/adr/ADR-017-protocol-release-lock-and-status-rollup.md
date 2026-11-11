# ADR-017 — Protocol release lock and status roll-up

Date: 2026-11-11. Status: accepted (owner feedback after Phase 6). Changes the protocol statuses in section 4 of ARCHITECTURE.md and refines SPEC 4.4.

- **Context.** The owner asked to switch a protocol between Draft and Release, and for every level of the hierarchy to show a status that updates by itself when the work beneath it is done. Asked what "Release" should mean, the owner chose: it locks the structure.
- **Decision — lifecycle.**
  - `protocol_status` is `draft | released | completed`: the enum value `active` was renamed to `released`.
  - Managers change the status from the protocol header, after a confirmation that explains the effect.
  - Outside Draft, database triggers refuse any insert or change to chapters, functions, test runs and step definitions, including order, duplication and archiving. They also refuse changes to the protocol's reference, name, description and version (`protocol_locked`).
  - Step execution fields (actual result, status, comments, executor) and evidence stay open in Released and Completed.
  - Setting a protocol back to Draft unlocks it. Every status change is audited as `protocol.updated` with the old and new values.
- **Decision — roll-up.**
  - A step with live sub-steps has no status of its own: its status is derived from its sub-steps, and `record_step_result` refuses to set it (`status_derived`), though its actual result and comments can still be recorded.
  - Test runs, functions and chapters derive their status from their live children with the existing rule (Failed > Blocked > In Progress; Passed when every child is Passed or Not Applicable).
  - Nothing derived is stored. The tree editor, the execution view and the Word report all show the derived status.
  - Progress counts ("x of n steps executed") count only steps without sub-steps.
- **Consequences.** A released protocol's structure can only be corrected by setting it back to Draft, which is visible in the audit trail. Completed keeps execution open; locking execution too remains a possible later change. Archiving all sub-steps makes the parent step recordable again.
