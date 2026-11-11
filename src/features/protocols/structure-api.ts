import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/useAuth'
import type { ProtocolRole } from '@/domain/roles'
import { PROTOCOL_COLUMNS, protocolKeys, type ProtocolRow } from '@/features/protocols/api'
import type { ChapterRow, FunctionRow, NodeType, ProtocolRows, TestRunRow, TestStepRow } from '@/features/protocols/tree'
import { getSupabase } from '@/lib/supabase'

export const structureKeys = {
  rows: (protocolId: string) => ['protocols', protocolId, 'rows'] as const,
  role: (protocolId: string) => ['protocols', protocolId, 'my-role'] as const,
  team: (protocolId: string) => ['protocols', protocolId, 'team'] as const,
}

const TABLE: Record<NodeType, 'chapters' | 'functions' | 'test_runs' | 'test_steps'> = {
  chapter: 'chapters',
  function: 'functions',
  test_run: 'test_runs',
  test_step: 'test_steps',
}

const BASE = 'id, protocol_id, position, created_at, deleted_at'
export const STEP_COLUMNS = `${BASE}, test_run_id, parent_step_id, reference, description, expected_result, actual_result, status, comments, executed_by, executed_at`

export function useProtocol(protocolId: string) {
  return useQuery({
    queryKey: protocolKeys.detail(protocolId),
    queryFn: async () => {
      const { data, error } = await getSupabase().from('protocols').select(PROTOCOL_COLUMNS).eq('id', protocolId).maybeSingle()
      if (error) throw error
      return data as ProtocolRow | null
    },
  })
}

/** All structure rows of a protocol in four queries; RLS decides whether archived rows come back. */
export function useProtocolRows(protocolId: string) {
  return useQuery({
    queryKey: structureKeys.rows(protocolId),
    enabled: !!protocolId,
    queryFn: async (): Promise<ProtocolRows> => {
      const supabase = getSupabase()
      const [chapters, functions, testRuns, steps] = await Promise.all([
        supabase.from('chapters').select(`${BASE}, title, description`).eq('protocol_id', protocolId),
        supabase.from('functions').select(`${BASE}, chapter_id, title, description`).eq('protocol_id', protocolId),
        supabase.from('test_runs').select(`${BASE}, function_id, reference, title, description`).eq('protocol_id', protocolId),
        supabase.from('test_steps').select(STEP_COLUMNS).eq('protocol_id', protocolId),
      ])
      for (const result of [chapters, functions, testRuns, steps]) if (result.error) throw result.error
      return {
        chapters: chapters.data as ChapterRow[],
        functions: functions.data as FunctionRow[],
        testRuns: testRuns.data as TestRunRow[],
        steps: steps.data as TestStepRow[],
      }
    },
  })
}

/** The caller's role on this protocol, for showing or hiding controls. RLS remains the control. */
export function useMyProtocolRole(protocolId: string) {
  const { profile } = useAuth()
  return useQuery({
    queryKey: structureKeys.role(protocolId),
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('protocol_access')
        .select('role')
        .eq('protocol_id', protocolId)
        .eq('user_id', profile!.id)
        .maybeSingle()
      if (error) throw error
      return (data?.role ?? null) as ProtocolRole | null
    },
  })
}

export interface TeamMember {
  id: string
  user_id: string
  role: ProtocolRole
}

export function useProtocolTeam(protocolId: string, enabled: boolean) {
  return useQuery({
    queryKey: structureKeys.team(protocolId),
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabase().from('protocol_access').select('id, user_id, role').eq('protocol_id', protocolId)
      if (error) throw error
      return data as TeamMember[]
    },
  })
}

export type NodeFields = {
  title?: string
  description?: string
  reference?: string
  expected_result?: string
}

export interface NewNode {
  type: NodeType
  /** chapter: protocol id; function: chapter id; test_run: function id; test_step: test run id. */
  parentId: string
  /** For sub-steps: the parent step. */
  parentStepId?: string | null
  fields: NodeFields
}

const PARENT_COLUMN: Record<NodeType, string> = {
  chapter: 'protocol_id',
  function: 'chapter_id',
  test_run: 'function_id',
  test_step: 'test_run_id',
}

export function useStructureMutations(protocolId: string) {
  const queryClient = useQueryClient()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: structureKeys.rows(protocolId) }),
      queryClient.invalidateQueries({ queryKey: protocolKeys.detail(protocolId) }),
      queryClient.invalidateQueries({ queryKey: protocolKeys.all, exact: true }),
    ])

  const create = useMutation({
    mutationFn: async ({ type, parentId, parentStepId, fields }: NewNode) => {
      const row: Record<string, unknown> = { ...fields, protocol_id: protocolId, [PARENT_COLUMN[type]]: parentId }
      if (type === 'test_step') row.parent_step_id = parentStepId ?? null
      const { data, error } = await getSupabase().from(TABLE[type]).insert(row).select('id').single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: refresh,
  })

  const update = useMutation({
    mutationFn: async ({ type, id, fields }: { type: NodeType; id: string; fields: NodeFields }) => {
      const { data, error } = await getSupabase().from(TABLE[type]).update(fields).eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw { code: '42501' }
    },
    onSuccess: refresh,
  })

  const reorder = useMutation({
    mutationFn: async ({ type, parentId, orderedIds }: { type: NodeType; parentId: string; orderedIds: string[] }) => {
      const { error } = await getSupabase().rpc('reorder_siblings', { p_node_type: type, p_parent_id: parentId, p_ordered_ids: orderedIds })
      if (error) throw error
    },
    // Show the new order immediately; the refetch afterwards confirms it.
    onMutate: async ({ type, orderedIds }) => {
      const key = structureKeys.rows(protocolId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ProtocolRows>(key)
      if (previous) {
        const rank = new Map(orderedIds.map((id, index) => [id, index + 1]))
        const listKey = ({ chapter: 'chapters', function: 'functions', test_run: 'testRuns', test_step: 'steps' } as const)[type]
        queryClient.setQueryData<ProtocolRows>(key, {
          ...previous,
          [listKey]: (previous[listKey] as { id: string; position: number }[]).map((row) =>
            rank.has(row.id) ? { ...row, position: rank.get(row.id)! } : row,
          ),
        })
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(structureKeys.rows(protocolId), context.previous)
    },
    onSettled: refresh,
  })

  const archive = useMutation({
    mutationFn: async ({ type, id }: { type: NodeType | 'protocol'; id: string }) => {
      const { data, error } = await getSupabase().rpc('archive_node', { p_node_type: type, p_id: id })
      if (error) throw error
      return data as number
    },
    onSuccess: refresh,
  })

  const restore = useMutation({
    mutationFn: async ({ type, id }: { type: NodeType | 'protocol'; id: string }) => {
      const { data, error } = await getSupabase().rpc('restore_node', { p_node_type: type, p_id: id })
      if (error) throw error
      return data as number
    },
    onSuccess: refresh,
  })

  const duplicate = useMutation({
    mutationFn: async ({ type, id }: { type: NodeType; id: string }) => {
      const { data, error } = await getSupabase().rpc('duplicate_node', { p_node_type: type, p_id: id })
      if (error) throw error
      return data as string
    },
    onSuccess: refresh,
  })

  const updateProtocol = useMutation({
    mutationFn: async (fields: Partial<Pick<ProtocolRow, 'reference' | 'name' | 'description' | 'version' | 'status'>>) => {
      const { data, error } = await getSupabase().from('protocols').update(fields).eq('id', protocolId).select('id')
      if (error) throw error
      if (!data?.length) throw { code: '42501' }
    },
    onSuccess: refresh,
  })

  return { create, update, reorder, archive, restore, duplicate, updateProtocol }
}

export interface NodeCounts {
  functions: number
  test_runs: number
  test_steps: number
  evidence: number
}

export async function fetchNodeCounts(type: NodeType | 'protocol', id: string): Promise<NodeCounts> {
  const { data, error } = await getSupabase().rpc('node_counts', { p_node_type: type, p_id: id })
  if (error) throw error
  return data as NodeCounts
}
