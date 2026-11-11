import { describe, expect, it } from 'vitest'
import { sql } from './helpers'

/**
 * Phase 7 security review, as tests that fail if a later migration weakens
 * anything: every table has RLS, API roles get only what is listed here, and
 * storage cannot be overwritten or deleted through the API.
 */

// Functions the browser (authenticated) may call. Adding one means reviewing it.
const AUTHENTICATED_RPCS = [
  'archive_node',
  'complete_password_change',
  'copy_export_to_draft',
  'create_protocol',
  'dashboard_totals',
  'duplicate_node',
  'finalize_export',
  'needs_setup',
  'node_counts',
  'protocol_overview',
  'record_step_result',
  'record_test_run_result',
  'reorder_export_items',
  'reorder_siblings',
  'restore_node',
  'storage_usage',
  'user_directory',
].sort()

describe('database security review', () => {
  it('enables RLS on every table in public and private', async () => {
    const rows = await sql<{ table: string }>(
      `select n.nspname || '.' || c.relname as table
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname in ('public', 'private') and not c.relrowsecurity`,
    )
    expect(rows).toEqual([])
  })

  it('gives every public table at least one policy, except password fingerprints', async () => {
    const rows = await sql<{ table: string }>(
      `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname = 'public'
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)`,
    )
    expect(rows).toEqual([])
  })

  it('grants the anon role nothing on any table', async () => {
    const rows = await sql(`select table_schema, table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema in ('public', 'private')`)
    expect(rows).toEqual([])
  })

  it('lets anon execute only needs_setup', async () => {
    const rows = await sql<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    )
    expect(rows.map((row) => row.name)).toEqual(['needs_setup'])
  })

  it('lets authenticated execute exactly the reviewed RPCs, and never a svc_* function', async () => {
    const rows = await sql<{ name: string }>(
      `select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    )
    expect(rows.map((row) => row.name)).toEqual(AUTHENTICATED_RPCS)
  })

  it('never grants delete on domain tables, or any write on the audit trail, to API roles', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public'
         and (privilege_type in ('DELETE', 'TRUNCATE') or (table_name = 'audit_events' and privilege_type <> 'SELECT'))
       order by 1`,
    )
    // Deleting is allowed only for configuration rows: protocol access and draft selections.
    expect(rows).toEqual([
      { table_name: 'document_export_items', privilege_type: 'DELETE' },
      { table_name: 'protocol_access', privilege_type: 'DELETE' },
    ])
  })

  it('keeps every security definer function on a fixed search_path', async () => {
    const rows = await sql<{ name: string }>(
      `select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    )
    expect(rows).toEqual([])
  })

  it('does not expose the private schema through the API', async () => {
    const [config] = await sql<{ setting: string | null }>(`select current_setting('pgrst.db_schemas', true) as setting`)
    expect(config!.setting ?? '').not.toContain('private')
  })

  it('keeps both buckets private with size and type limits', async () => {
    const rows = await sql<{ id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }>(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
    )
    expect(rows.map((row) => row.id)).toEqual(['evidence', 'exports'])
    for (const bucket of rows) {
      expect(bucket.public, bucket.id).toBe(false)
      expect(Number(bucket.file_size_limit), bucket.id).toBeGreaterThan(0)
      expect(bucket.allowed_mime_types?.length, bucket.id).toBeGreaterThan(0)
    }
  })

  it('has no UPDATE or DELETE policy on storage objects, so originals are immutable', async () => {
    const rows = await sql<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname`,
    )
    expect(rows.filter((row) => row.cmd !== 'SELECT' && row.cmd !== 'INSERT')).toEqual([])
    expect(rows.map((row) => row.cmd).sort()).toEqual(['INSERT', 'INSERT', 'SELECT', 'SELECT'])
  })

  it('blocks updates and deletes of audit events even for the table owner', async () => {
    await expect(sql(`update public.audit_events set event_type = 'x' where id = (select min(id) from public.audit_events)`)).rejects.toThrow(/append-only/)
    await expect(sql(`delete from public.audit_events where id = (select min(id) from public.audit_events)`)).rejects.toThrow(/append-only/)
  })
})
