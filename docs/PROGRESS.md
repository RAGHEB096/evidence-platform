# Progress

Maintained by Claude across sessions. Read this after CLAUDE.md, SPEC.md and ARCHITECTURE.md to pick up where work stopped.

## Phase status

| Phase | Status | Commit |
|---|---|---|
| 0 Inspect, plan | Done (plan approved 2026-11-11) | — |
| 1 Project setup, layout, routing, Supabase client, local Supabase | Done | "Phase 1: …" |
| 2 Schema, migrations, RLS, username auth, first-admin setup | Not started | |
| 3 User management, protocol access | Not started | |
| 4 Protocol editor and hierarchy | Not started | |
| 5 Execution and evidence upload | Not started | |
| 6 Report builder and Word generation | Not started | |
| 7 Dashboard, audit viewer, settings, security review | Not started | |
| 8 Full test run, clean-up, documentation, deployment | Not started | |

## Environment (this machine)

- Windows 11, Node 26.13, npm 11.20, Docker 29.5 (Docker Desktop must be running).
- Supabase CLI is a pinned devDependency (`supabase@3.1.0`); always call it as `npx supabase …`. There is no global install.
- Deno is not installed; Edge Functions run in the CLI's Docker edge runtime.
- Playwright Chromium installed with `npx playwright install chromium`.

## How to verify each phase

Prerequisite for everything: Docker running, then `npx supabase start`.
Create `.env.local` from `.env.example`; the publishable key comes from `npx supabase status -o env` (`PUBLISHABLE_KEY`).

### Phase 1

```
npm run typecheck
npm run lint
npm test            # unit: nav, env validation, status badge
npm run test:db     # local Supabase reachable; public sign-up refused
npm run test:e2e    # builds, serves dist/ on :4173, clicks through the shell
npm run build
npm run dev         # http://localhost:5173
```

## Decisions

Ordinary implementation choices that are not obvious from the code.

- **Docs moved into `docs/`.** SPEC.md and ARCHITECTURE.md were at the repo root while CLAUDE.md and the spec referred to `docs/…`. Moved them; CLAUDE.md stays at the root.
- **TypeScript pinned to `~6.0.3`.** TypeScript 7 (the native port) is the npm `latest`, but typescript-eslint 8.72 supports `<6.1`. Revisit when typescript-eslint supports 7.
- **Versions in use:** React 19.3, React Router 8.5 (`RouterProvider` from `react-router/dom`), Vite 8.3 (Rolldown), Tailwind 4.3, shadcn 4.23 (style `radix-nova`, base Radix), TanStack Query 5, zod 4, Vitest 5, Playwright 1.65, ESLint 10, supabase-js 2.119.
- **shadcn alias fix.** shadcn reads path aliases from the root `tsconfig.json`; with only project references it wrote files into a literal `@/` folder. The root tsconfig now carries `paths` as well.
- **Generated `src/hooks/use-mobile.ts` rewritten** with `useSyncExternalStore`; the shadcn version calls setState inside an effect and fails the React Compiler lint rule. `src/components/ui/**` is otherwise left as generated and excluded from lint.
- **One Vitest config, two projects.** `npm test` runs `unit` (jsdom); `npm run test:db` runs `db` (node, files sequential) whose global setup reads URLs and keys from `npx supabase status -o env`, so no key is stored in the repo. It fails with instructions if the stack is down; there is no mock fallback.
- **E2E runs against the production build** (`vite preview` on :4173), so it exercises the bundle that gets deployed.
- **Env validation at start-up** (`src/lib/env.ts`, zod). A missing variable shows a configuration page naming the variable. A key starting with `sb_secret_` in `VITE_SUPABASE_PUBLISHABLE_KEY` is rejected.
- **Synthetic email domain is a build variable**, `VITE_AUTH_EMAIL_DOMAIN` (not secret). Edge Functions will read the same value from a function secret. Local value: `users.evidence-platform.local`; must be confirmed against hosted Auth (ADR-001 consequence).
- **ESLint forbids `localStorage`** in app code (Postgres is the source of truth). supabase-js's own session persistence is unaffected.
- **Local Supabase config** (`supabase/config.toml`): sign-ups off, anonymous off, email confirmations off, minimum password length 10 with letters and digits, access-token lifetime 900 s, email sending rate 0, realtime/analytics/vector disabled (unused), site URL `http://localhost:5173`.

### Refinements agreed at the Phase 0 review (to implement in Phase 2 and record as ADRs in `docs/adr/`)

1. Composite foreign keys so every child row's `protocol_id` matches its parent's; `parent_step_id` within the same test run; export items and evidence in the same protocol; `finalize-evidence` checks the path's protocol against the test run's.
2. While `must_change_password` is set, the `private.*` helpers grant no protocol access; a trigger on `auth.users` clears the flag when the password really changes.
3. Edge Functions write through service-role-only RPCs that take the actor explicitly and set a transaction-local setting the audit trigger reads, so no audit row lacks an actor.
4. Deactivation: RLS helpers deny inactive profiles immediately; the Auth ban stops refresh; access tokens last 15 minutes.
5. Testers may update only caption/description of their own evidence; `deleted_at` is never client-updatable; archiving goes through RPCs.
6. Documented exceptions to "nothing is removed": `finalize-evidence` deletes rejected, never-registered uploads; removing an item from a draft export deletes the item row (audited).
7. `updated_at`-only changes are left out of the audit trail.

## Known gaps

- `npm audit`: 10 moderate advisories, all `minimatch` inside ESLint/typescript-eslint (dev-only tooling, not shipped). No fix without a breaking downgrade; recheck later.
- Main JS chunk is ~586 kB (183 kB gzipped). Add route-level lazy loading as pages grow, and load `docx` only on the report screen (Phase 6).
- The shell shows User Management to everyone until Phase 2 wires the signed-in profile (`AppLayout` passes `isAdmin`). No data exists yet, and the real control will be RLS.
- `/login` and `/setup` arrive in Phase 2 with auth.

## Next step

Phase 2: migrations for the full data model with RLS in the same migration, private helper functions, audit trigger, storage buckets and policies, `needs_setup()`, `bootstrap-admin`, username sign-in and `/setup`, and the RLS test suite with real sessions.
