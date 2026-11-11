# Evidence Platform

A web app for organising software-test protocols (chapter → function → test run → step), attaching screenshot evidence to steps, and exporting selected evidence as an editable Word report.

The first use case is qualification testing of a manufacturing execution system (MES), so these records may end up in front of a quality reviewer. That is why traceability, access control and "nothing silently disappears" outrank visual polish everywhere in this project.

- What to build, in what order, and what "done" means: `docs/SPEC.md`
- How it is built and why (decisions, data model, permissions): `docs/ARCHITECTURE.md`
- Where the work stands: `docs/PROGRESS.md` (you maintain this file)

Read all three at the start of every session before changing anything.

## Stack

- Frontend: React, Vite, TypeScript (strict), Tailwind CSS, shadcn/ui
- Backend: Supabase (Postgres with Row Level Security, Auth, Storage, Edge Functions)
- Word export: the `docx` npm package, run in the browser
- Hosting: static build on Cloudflare; source on GitHub

## Commands

Set these up in Phase 1 and keep this list accurate as scripts change.

- `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`
- `npm test` (unit), `npm run test:db` (RLS and RPC tests against local Supabase), `npm run test:e2e` (Playwright), `npm run test:perf` (large-report timing, `PERF_IMAGES`, default 300)
- `test:db`, `test:e2e` and `test:perf` reset the local database first. Apply a new migration without losing data with `npx supabase migration up`.
- `npx supabase start`, `npx supabase db reset`, `npx supabase functions serve` (the CLI is a pinned devDependency, not a global install; Docker must be running)
- `npx playwright install chromium` once per machine before the first `npm run test:e2e`

## Rules that hold for every change

- **Postgres is the source of truth.** No hardcoded arrays, no localStorage standing in for data. Seed data lives in `supabase/seed.sql` and is for local development only.
- **Authorization lives in the database.** Every table gets RLS enabled, with policies, in the same migration that creates it. Hiding a button is a UX nicety, never the control. If a feature needs a privilege the user's own session lacks, it goes through an RPC or Edge Function that checks the caller's role first.
- **The Supabase secret key exists only inside Edge Functions.** Nothing with a `VITE_` prefix may hold a secret, because Vite ships those to the browser.
- **Schema changes are new migration files.** Never edit a migration that has been applied; `supabase db reset` must rebuild the database from scratch at any commit.
- **Delete means archive.** Domain records and evidence are soft-deleted (`deleted_at`). Original evidence files in storage are never overwritten or removed by the app.
- **Audit rows are append-only.** They are written by triggers and server code, never by the client.
- **Usernames only.** The synthetic email behind each account never appears in the UI, in error messages or in exports.
- **No compliance claims.** Do not describe the app as 21 CFR Part 11 compliant, GAMP 5 validated or GxP compliant in the UI, README or generated reports. It is built so that it can be assessed for regulated use; that assessment has not happened.

## How to work

- One phase at a time, in the order given in `docs/SPEC.md`. A phase is finished when its exit criteria pass, `npm run typecheck`, `npm run lint`, the test suites and `npm run build` are green, `docs/PROGRESS.md` is updated, and the work is committed.
- Make ordinary implementation choices yourself and note anything non-obvious under "Decisions" in `docs/PROGRESS.md`. Stop and ask only for the cases listed in `docs/SPEC.md` section 2.
- If a decision in `docs/ARCHITECTURE.md` turns out not to work, say so and propose the change before working around it. Record the outcome as a new ADR.
- Supabase and Cloudflare change often. Check current documentation for CLI commands, API key names, Auth admin methods and limits instead of relying on memory.
- When you report on a phase, separate what you ran and saw pass from what you wrote but could not verify. "Deployed" means you loaded the live URL and exercised it.
