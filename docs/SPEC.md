# Evidence Platform — Specification

## 1. Purpose

I run test protocols for software validation, starting with the functional qualification of a manufacturing execution system (MES). Today the evidence for each test, mostly screenshots, is collected by hand and pasted into Word. I want one application where I can:

1. define a protocol as a hierarchy: chapter (for example a production station) → function → test run → step, with nested sub-steps where needed;
2. record the result of each step and attach screenshots to it;
3. choose which screenshots go into the final report;
4. generate an editable Word document that follows the protocol's structure and embeds the chosen images.

The application must stay general enough for other testing and validation projects. I need a working, deployable application backed by a real database. A static prototype or a UI over mock data does not meet the goal.

The design is already decided in `docs/ARCHITECTURE.md`. This file says what to build and when it counts as finished.

## 2. How to work on this

- Start by inspecting the repository: what exists, which dependencies are installed, what can be reused. Then show me a short plan for Phase 1.
- After I approve the plan, work through the phases in section 8 without checking in for ordinary choices. Decide, and log anything non-obvious in `docs/PROGRESS.md`.
- Stop and ask me only when:
  - you need an account, credential or login I have to provide (Supabase project, Cloudflare, GitHub remote);
  - Docker or the Supabase CLI is unavailable, so the local database cannot run. Tell me instead of substituting mocks;
  - a decision in `docs/ARCHITECTURE.md` proves unworkable;
  - an action would change or delete data in a hosted project.
- Keep `docs/PROGRESS.md` current: phase status, decisions, known gaps, and the exact commands to verify each phase. Context will be compacted during this work, and that file is how a later session picks up where this one stopped.
- Commit at the end of each phase with a message that names the phase.
- Suggested libraries, replaceable if you have a reason: React Router, TanStack Query, react-hook-form with zod, dnd-kit, Vitest, Playwright.

## 3. Users and roles

One or more administrators, plus users created by an administrator. Nobody registers themselves and nobody needs an email address. Each user is assigned to specific protocols with one of three roles: viewer, tester or manager. The full permission table is in `docs/ARCHITECTURE.md` section 5; implement exactly that table.

## 4. Features

### 4.1 Shell and general behaviour

- Enterprise-style interface: sidebar navigation, dashboard, tables, cards, dialogs and forms with consistent type and spacing. Desktop first, usable on tablets.
- Navigation: Dashboard, Protocols, Evidence Library, Generated Documents, User Management (administrators only), Settings.
- Every list has search and relevant filters. Every async view has a loading state, an error state with a retry, and an empty state that tells the user what to do next.
- Every archive action asks for confirmation and names what will be affected, including how many items sit beneath it.
- Status is always shown with both a label and a colour.

### 4.2 Sign-in, first-time setup, user management

- Login screen with username and password only.
- First-time setup page for creating the first administrator (ADR-002). It disappears once an administrator exists.
- Administrators can: list users; create a user with username, display name and initial password; activate and deactivate; reset a password; change the administrator and "can create protocols" flags; assign a user to protocols with a role; change that role; remove access.
- A user whose password was set by an administrator is asked to choose a new one at next sign-in.
- A deactivated user cannot sign in and loses existing sessions.
- An administrator cannot deactivate or demote themselves if that would leave no active administrator.

### 4.3 Protocols and their structure

- Protocol fields: name, reference (unique), description, version, status, created by, created at.
- Protocol editor showing the whole hierarchy as an expandable, collapsible tree: chapter → function → test run → step → sub-step. No level has a fixed count.
- At every level: add, edit, archive, reorder (drag and drop, plus move up/down buttons for keyboard users).
- Duplicate a chapter, function or test run, including everything beneath it. Results and evidence are not copied.
- Steps have a reference, description and expected result, and can contain sub-steps to any depth (`parent_step_id`).
- Every change is saved to the database when it is made. After signing out and back in, the structure is exactly as it was left.
- Archiving a node hides it and its descendants; nothing is destroyed. Administrators can view and restore archived items.

### 4.4 Test execution and evidence

- Execution view for a test run: each step shows reference, description, expected result, and editable actual result, status and comments.
- Statuses: Not Started, In Progress, Passed, Failed, Blocked, Not Applicable. A test run's status is derived from its steps.
- Evidence can be attached to a step, or to the test run as a whole.
- Upload by drag and drop or file picker, several files at once, with per-file progress.
- Accepted formats: PNG, JPG/JPEG, WEBP, GIF, BMP. Size limit configurable by administrators, initially 20 MB.
- Validation checks extension, MIME type and actual file content. A rejected file produces a message that names the file and the reason. Nothing is dropped silently, and one bad file does not cancel the rest of a batch.
- The original file is stored unchanged in a private bucket, with its SHA-256.
- Each evidence item shows a thumbnail, filename, caption, description, upload date, uploader, and where it belongs (protocol, chapter, function, test run, step). Caption and description are editable according to role.
- Clicking a thumbnail opens a large preview with next/previous navigation.
- Archiving evidence removes it from normal views and from draft exports; the file stays in storage.

### 4.5 Evidence library

- All evidence across the protocols the user can access, searchable by filename, caption and description, and filterable by protocol, chapter, function, test run, uploader and date.

### 4.6 Report builder

A dedicated screen for preparing a report:

- Choose a protocol, then browse its chapters, functions and test runs with their evidence.
- Select images individually with checkboxes; select or clear all in a test run; select or clear all in a chapter.
- Preview selected images, edit the caption used in this report (the evidence record keeps its own caption), and change the order of images within a step.
- Remove an image from the report without touching the original.
- A summary panel that stays visible: protocol name, number of chapters, and number of test runs, steps and images selected.
- The selection is saved as a draft as it changes (ADR-006), so it survives a reload and can be resumed.
- Option: include steps that have no selected evidence. Off by default.

### 4.7 The Word report

This is the feature the application exists for.

- Output: a real `.docx` that opens and edits normally in Microsoft Word, built in the browser (ADR-005).
- Cover page: "Evidence Platform", the title "Test Evidence Report", protocol name, reference and version, generation date and time with time zone, generated by (display name).
- Protocol information page: description, protocol details, and the same selection summary as the builder.
- Body follows the protocol hierarchy with numbered headings using Word's built-in heading styles, so a table of contents can be inserted later:

  ```
  1. SMT Line 1
  1.1 Barcode Verification
  1.1.1 Test Run 001
  Step 1: Open the application.
  Expected result: The application opens successfully.
  Actual result:   The application opened successfully.
  Status:          PASSED
  Evidence 001
  [image]
  Caption: Screenshot showing the login page.
  ```

- Only selected evidence appears. A chapter, function, test run or step appears if it contains selected evidence, or if the "include steps without evidence" option is on.
- Evidence is numbered sequentially through the document.
- Images are embedded (never linked), centred, scaled to fit the printable width and at most about two thirds of the page height, with aspect ratio preserved. The caption sits directly below and stays on the same page as its image.
- Each chapter starts on a new page. No blank pages.
- Header carries the document title and protocol reference; footer carries "Page X of Y".
- A4 by default, set in one constant. One readable font throughout.
- It must cope with several hundred images across many chapters and show progress while it works.
- After generation the file downloads. A "Save to Generated Documents" option also stores it in the private exports bucket.

### 4.8 Generated documents

- History of exports for the protocols the user can access: document name, protocol, generated by, timestamp, number of images, and whether a file was saved.
- Saved files can be downloaded again by anyone with access to the protocol. Each record lists the evidence it contained.

### 4.9 Dashboard

- Totals: protocols, protocols assigned to me, chapters, test runs, evidence files, generated documents.
- Recent activity, taken from the audit trail.
- One row per protocol: name, reference, version, number of chapters, number of test runs, execution progress (share of steps with a final status, and how many passed), last modified. Searchable and filterable by status.
- Administrators see global numbers, plus storage usage against the plan limit. Everyone else sees numbers for their assigned protocols only, computed on the server under RLS.

### 4.10 Audit trail

- Recorded events: user creation, deactivation, password reset; protocol creation and changes; changes to chapters, functions, test runs and steps; result changes; evidence upload, metadata change and archival; selection changes; document generation; access granted, changed and removed.
- Each event stores actor, event type, entity type, entity id, server-side UTC timestamp, and what changed.
- Viewer page: administrators see everything, managers see their own protocols. Filter by protocol, user, event type and date.
- Ordinary users cannot edit or delete events by any route (ADR-007).

### 4.11 Settings

- Everyone: change display name and own password.
- Administrators: upload size limit, report page size, maximum embedded image size.

## 5. Security

- Authorization is enforced by RLS and by role checks inside RPCs and Edge Functions. Frontend checks exist only to keep the UI tidy.
- Buckets are private. Files are reached through short-lived signed URLs.
- The secret key appears only in Edge Function environments. `.env.example` lists every variable name with placeholder values, and `.env*` files with real values are git-ignored.
- All input is validated on the server side as well as in forms.
- Login failures give one generic message. Errors shown to users never include SQL, stack traces or internal identifiers.
- Passwords are handled only by Supabase Auth. Minimum length is enforced both in the Auth configuration and in `admin-users`.

## 6. Testing

Three layers, each run by one documented command:

- **Database tests** against local Supabase, using real signed-in sessions for an administrator, a manager, a tester, a viewer and an unassigned user. These are the most important tests in the project. They must show that:
  - an unassigned user gets nothing from any table, RPC, bucket or signed-URL request for a protocol, when calling the API directly;
  - each role can do exactly what the permission table allows and nothing more;
  - audit events cannot be inserted, updated or deleted by any user role;
  - evidence originals cannot be overwritten or deleted;
  - a deactivated user is locked out.
- **Unit tests** for the tree utilities, file validation (including a renamed non-image and a truncated image), heading numbering and the DOCX builder. For the DOCX builder, generate a document from fixtures, unzip it, and assert on the heading sequence, the number of embedded media files, and that only selected evidence is present.
- **End-to-end tests** (Playwright) for: setup and admin login; invalid login; creating a user and logging in as them; creating and editing a protocol; adding, reordering, duplicating and archiving chapters, functions, test runs and nested steps; persistence after sign-out; uploading several images and previewing one; recording results; selecting evidence; generating and downloading a DOCX; finding it in the export history; and a second user being refused a protocol they are not assigned to.

Open one generated report in a DOCX renderer or converter to confirm it is a valid document, and tell me plainly that I still need to check it in Microsoft Word myself.

## 7. Deployment and documentation

Deployment needs my accounts, so prepare everything and verify as far as your access allows.

- `README.md`: architecture summary, stack, database structure, local installation, Supabase configuration, administrator initialisation, environment variables, test commands, and a "limits and scope" section covering free-tier limits, the audit trail's limits and the absence of any compliance claim.
- `docs/DEPLOY.md`, written as a checklist I can follow step by step: create the GitHub repository and push; create the Supabase project; apply migrations; create the buckets; set Auth settings (sign-ups off, email flows off, password policy); set function secrets; deploy Edge Functions; create the Cloudflare project, build settings, environment variables and SPA fallback; run first-time setup; delete the setup token; a smoke test to run on the live site.
- Free-tier limits and what triggers an upgrade, with numbers taken from the current pricing pages on the day you write the guide.
- If I give you CLI access to Supabase and Cloudflare, deploy and run the smoke test against the live URL. If not, stop at the checklist and say that deployment has not been verified.

## 8. Phases and exit criteria

| Phase | Scope | Finished when |
|---|---|---|
| 0 | Inspect the repository, plan | I have approved the Phase 1 plan |
| 1 | Project setup, layout, routing, Supabase client, local Supabase | The app runs locally with the shell and navigation; build passes; local Supabase starts |
| 2 | Schema, migrations, RLS, username auth, first-admin setup | `supabase db reset` builds everything; setup creates an administrator who can sign in; database tests for RLS exist and pass |
| 3 | User management, protocol access | An administrator creates users and assigns roles through the UI; role tests pass for every role |
| 4 | Protocol editor and hierarchy | Full add, edit, reorder, duplicate and archive at every level, persisted; E2E for the editor passes |
| 5 | Execution and evidence upload | Results recorded; multi-file upload with validation, hashing and preview; evidence library works |
| 6 | Report builder and Word generation | A report with images from several chapters is generated, downloaded, saved and listed; DOCX tests pass |
| 7 | Dashboard, audit viewer, settings, security review | Dashboard numbers respect roles; audit events exist for every action in 4.10; a pass over every table and bucket confirms RLS coverage |
| 8 | Full test run, clean-up, documentation, deployment | All suites green; production build passes; README and DEPLOY.md complete; deployment done or explicitly handed to me |

## 9. Definition of done

Verifiable by you, locally, through tests:

1. An administrator signs in with username and password, with no email anywhere.
2. An administrator creates accounts and assigns them to specific protocols with a role.
3. Assigned users sign in with username and password.
4. Permitted users create and configure protocols.
5. Chapters and functions can be added, edited, archived and reordered.
6. Functions hold multiple test runs; test runs hold nested steps and sub-steps.
7. Several screenshots can be uploaded at once, previewed, and tied to specific steps.
8. Specific images can be selected for export.
9. The generated Word document is correctly structured, editable, and contains exactly the selected images.
10. Earlier exports are listed and downloadable by authorised users.
11. Data persists across sign-out and sign-in.
12. Users cannot reach protocols they are not assigned to, including by direct API calls.
13. The production build succeeds.
14. Setup and deployment instructions are complete.

Needs me, or my credentials:

15. The application is reachable at its public URL and passes the smoke test there.
16. A generated report looks right in Microsoft Word.

In your final report, list each item as verified, not verified, or blocked, with how you checked it.

## 10. Out of scope for version 1

Electronic signatures, PDF export, non-image evidence, real-time collaborative editing, email notifications, self-service password recovery, permanent deletion, and translations of the interface. Leave room for them; do not build them.
