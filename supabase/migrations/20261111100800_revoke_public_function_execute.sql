-- Phase 7 security review finding: the anon role could execute every public
-- RPC. The core migration revoked default EXECUTE "in schema public", but
-- PostgreSQL's built-in EXECUTE grant to PUBLIC is global and cannot be
-- removed per schema, so new functions stayed executable by everyone. Each
-- function already refused anonymous callers itself; this restores the
-- intended second layer.

-- Future functions: no EXECUTE for PUBLIC anywhere unless granted.
alter default privileges for role postgres revoke execute on functions from public;

-- Existing functions: revoke what PUBLIC and anon got implicitly.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

-- The one function signed-out visitors need (the sign-in page asks whether
-- first-time setup is still open).
grant execute on function public.needs_setup() to anon;
