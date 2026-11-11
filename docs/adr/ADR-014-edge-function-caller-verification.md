# ADR-014 — Edge Functions verify their callers in code

Date: 2026-11-11. Status: accepted. Refines section 6 of ARCHITECTURE.md.

- **Context.** `bootstrap-admin` is called before anyone has a session, with only the publishable key, which is not a JWT. The other functions need to reject deactivated (banned) users, and the platform's JWT check does not consult the Auth server. CORS preflight requests carry no Authorization header.
- **Decision.** Every function sets `verify_jwt = false` in `supabase/config.toml`. `bootstrap-admin` relies on the setup token and the "no administrator" check. User-facing functions read the bearer token and call `auth.getUser(token)` with the secret-key client, which asks the Auth server and fails for banned users, then load the profile and check the role before doing anything. Shared code lives in `supabase/functions/_shared/`. CORS is restricted to `ALLOWED_ORIGINS`, and requests from any other origin are refused.
- **Consequences.** One Auth round trip per call, which is acceptable at this scale. Supabase's `@supabase/server` helper (`withSupabase`) is a possible later replacement; it was not adopted because version 1 is new and nothing here needs it.
