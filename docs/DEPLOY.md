# Deployment checklist

Follow these steps in order. Each ends with a check. Commands are run from the repository root on your machine; the Supabase CLI is the project's pinned dev dependency (`npx supabase …`).

Limits below were taken from supabase.com/pricing, the Supabase Edge Function limits page and the Cloudflare Pages limits page on **2026-11-11**. Check them again before relying on them.

You need: a GitHub account, a Supabase account, a Cloudflare account, and Node.js 22 or later.

---

## 1. GitHub repository

- [ ] Create an empty **private** repository on GitHub (no README or licence, so the first push is clean).
- [ ] Push:
  ```bash
  git remote add origin https://github.com/<you>/<repo>.git
  ```
  ```bash
  git push -u origin main
  ```
- [ ] Check: the repository shows the commits, and contains no `.env.local` or `supabase/functions/.env`. Both are git-ignored; confirm with `git ls-files | grep -i env` showing only the two `.env.example` files.

## 2. Supabase project

- [ ] supabase.com → New project. Choose a region close to your users and a strong database password, kept in your password manager.
- [ ] Postgres must be **17**, matching `major_version` in `supabase/config.toml`.
- [ ] Project Settings → API Keys: make sure a **publishable key** (`sb_publishable_…`) and a **secret key** (`sb_secret_…`) exist; create them if the project shows only the legacy keys. The app does not use the legacy `anon`/`service_role` keys (ADR-010).
- [ ] Note the **project ref**, the **project URL** and the **publishable key**. Never copy the secret key anywhere; Edge Functions receive it automatically.

## 3. Database: apply the migrations

```bash
npx supabase login
```
```bash
npx supabase link --project-ref <project-ref>
```
```bash
npx supabase db push
```

- [ ] Check: Database → Migrations lists every file in `supabase/migrations/`.
- [ ] Check: Storage shows the buckets **evidence** and **exports**, both **private**. The migration creates them; nothing to do by hand.
- [ ] Check: Project Settings → Data API → exposed schemas is `public` (and `graphql_public`) only. **`private` must not be listed.**
- [ ] Do **not** run `supabase/seed.sql` against the hosted project; it is for local development.

## 4. Authentication settings

In Authentication (the labels may differ slightly in the current dashboard):

- [ ] **Sign In / Providers → Email:** enabled. Password sign-in uses it, and no email is ever sent.
- [ ] **Allow new users to sign up:** **off**. Only administrators create accounts.
- [ ] **Confirm email:** **off**. Accounts are created pre-confirmed.
- [ ] **Anonymous sign-ins:** **off**.
- [ ] **Password requirements:** minimum length **10**, with **letters and digits**. Must match `PASSWORD_MIN_LENGTH` in the app and the `admin-users` function.
- [ ] **Access token (JWT) expiry:** **900** seconds. A deactivated user's token then lapses within 15 minutes; RLS already refuses them at once.
- [ ] **URL configuration → Site URL:** the Cloudflare address from step 7. Come back and set it once you know it.
- [ ] Optional on paid plans: leaked password protection.

`npx supabase config push` can push `[auth]` settings from `config.toml`, but it would also push local-only values such as `site_url = http://localhost:5173`. If you use it, read the diff it shows before confirming, and fix the Site URL afterwards.

## 5. Edge Function secrets

Create `supabase/functions/.env.production`. It is git-ignored by the `.env.*` rule; check with `git status` that it does not appear.

```
SETUP_TOKEN=<new random value, at least 24 characters>
AUTH_EMAIL_DOMAIN=users.<your-domain-or-app-name>.example
ALLOWED_ORIGINS=https://<your-pages-project>.pages.dev
```

Generate the token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Push the secrets:

```bash
npx supabase secrets set --env-file supabase/functions/.env.production
```

- [ ] Check: `npx supabase secrets list` shows `SETUP_TOKEN`, `AUTH_EMAIL_DOMAIN` and `ALLOWED_ORIGINS` (values are hidden).
- [ ] About the email domain (ADR-001): it is never shown and no mail is sent to it, but Supabase Auth must accept it as an email domain. Use a domain-shaped value. Step 9 tests it; if setup fails with an invalid-email error, change it in both places (this secret and `VITE_AUTH_EMAIL_DOMAIN`).

## 6. Deploy the Edge Functions

```bash
npx supabase functions deploy
```

This deploys `bootstrap-admin`, `admin-users` and `finalize-evidence`, each with `verify_jwt = false` from `config.toml`. They verify their callers themselves (ADR-014).

- [ ] Check: Edge Functions lists all three, and **Verify JWT** is off for each.

## 7. Cloudflare Pages

Workers & Pages → Create → Pages → Connect to Git → choose the repository.

- [ ] Framework preset: none (or Vite). **Build command:** `npm run build`. **Build output directory:** `dist`. **Root directory:** blank.
- [ ] **Environment variables** (Production; Preview too if you use preview deployments):
  - `VITE_SUPABASE_URL` = the project URL
  - `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key (`sb_publishable_…`), **never** the secret key; the app refuses to start with one
  - `VITE_AUTH_EMAIL_DOMAIN` = exactly the same value as `AUTH_EMAIL_DOMAIN`
  - `NODE_VERSION` = `22`
- [ ] Save and deploy.
- [ ] **SPA fallback:** nothing to configure. The build has no top-level `404.html`, so Pages serves the app for every route (Cloudflare documents this as its default single-page-application behaviour).
- [ ] Check: opening `https://<project>.pages.dev/protocols` directly shows the sign-in page, not a 404.
- [ ] Go back and set the Auth **Site URL** (step 4) and `ALLOWED_ORIGINS` (step 5) to the final address. Re-run `secrets set` if it changed. Add a custom domain the same way if you use one; it must also be in `ALLOWED_ORIGINS`.

**Alternative used for this project (ADR-009): Workers with static assets.** Cloudflare's "Create application" now leads to Workers by default. The repository includes `wrangler.jsonc` for this route (serves `dist/`, SPA fallback):
- Create a Worker from the Git repository, named exactly **`evidence-platform`** (it must match `name` in `wrangler.jsonc`).
- Build command `npm run build`, deploy command `npx wrangler deploy`, root directory `/`.
- Put the four variables above in the Worker's **Settings → Build → Variables and secrets** (build variables, because Vite bakes them in at build time), then redeploy.
- The address is `https://evidence-platform.<your-subdomain>.workers.dev`. Use it for `ALLOWED_ORIGINS` and the Auth Site URL.

## 8. Free-tier limits and when to upgrade

| Limit (Free plan) | Value | What happens / when to act |
|---|---|---|
| Supabase file storage | 1 GB | **Reached first.** About 500 screenshots of 2 MB, before saved reports. The administrator dashboard shows usage and turns amber above 80%. Upgrade to Pro (from $25/month, 100 GB) before it is full. |
| Supabase database | 500 MB | Text, structure and the audit trail; ample for this scale. |
| Max upload per file | 50 MB | The app's own limit defaults to 20 MB and cannot be set above 50 MB. |
| Egress | 5 GB (+5 GB cached) | Viewing originals and generating reports downloads images. Watch Usage if many large reports are generated. |
| Edge Function invocations | 500,000 / month | One per upload plus account actions; ample. |
| Edge Function resources | 256 MB memory, 2 s CPU, 150 s wall clock | Verification and hashing of a 50 MB file fits. Reports are built in the browser for this reason (ADR-005). |
| Inactivity | Project **paused after 1 week** without activity | The app is unreachable until you restore the project from the dashboard. There is deliberately no keep-alive. |
| Backups | **None automatic on Free** | Take your own: `npx supabase db dump -f backup.sql` (schema and data), on a schedule. Storage files are not included; Pro adds daily backups. |
| Projects | 2 active | — |
| Cloudflare Pages | 500 builds/month, 20,000 files, 25 MiB per file | Far above this app's needs. |

## 9. First-time setup on the live site

- [ ] Open the live address. The sign-in page shows "No administrator exists yet. **Run first-time setup**".
- [ ] Enter the `SETUP_TOKEN` from `.env.production`, then the administrator's username, display name and password.
- [ ] Check: you land on the Dashboard as that administrator.

## 10. Delete the setup token

```bash
npx supabase secrets unset SETUP_TOKEN
```

- [ ] Check: signed out, the sign-in page no longer offers setup. Setup also refuses while an administrator exists; deleting the token is the second lock (ADR-002).
- [ ] Delete `supabase/functions/.env.production` from your machine, or remove the token line from it.

## 11. Smoke test on the live site

Do this in a normal browser window and a private window (second user).

- [ ] **Sign-in:** a wrong password shows the one generic message.
- [ ] **Users:** User Management → create a user with an initial password. In a private window, sign in as them: they must choose a new password and then see the Dashboard.
- [ ] **Protocol:** create a protocol. Add a chapter, function, test run, a step and a sub-step. Reorder something.
- [ ] **Access:** give the second user the Tester role on it. In the private window, the protocol appears; Execute the test run.
- [ ] **Execution:** as the tester, record a result on the sub-step. Upload two PNG/JPG screenshots, and a text file renamed to `.png`, which must be rejected by name. Open the preview.
- [ ] **Release:** as administrator, set the protocol to **Released**. The structure is locked; the tester can still record results.
- [ ] **Report:** Build report → select images from the test run → Generate. A `.docx` downloads. **Open it in Microsoft Word**: cover page, headings, images with captions, "Page X of Y". Generated Documents lists it, and Download works.
- [ ] **Isolation:** create a second protocol without giving the tester access. In the private window it does not appear, and its URL shows "Protocol not available".
- [ ] **Audit:** Audit Trail shows the actions above with the right names.
- [ ] **Persistence:** sign out and back in; everything is still there.

If every box is ticked, the deployment is verified. Record the date and the live URL in `docs/PROGRESS.md`.
