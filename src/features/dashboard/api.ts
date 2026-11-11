import { useQuery } from '@tanstack/react-query'
import type { ProtocolStatus } from '@/domain/status'
import { getSupabase } from '@/lib/supabase'

export interface DashboardTotals {
  protocols: number
  assigned_protocols: number
  chapters: number
  test_runs: number
  evidence_files: number
  generated_documents: number
}

export interface ProtocolOverviewRow {
  id: string
  reference: string
  name: string
  version: string
  status: ProtocolStatus
  chapters: number
  test_runs: number
  steps: number
  steps_executed: number
  steps_passed: number
  updated_at: string
}

export interface StorageUsage {
  evidence_bytes: number
  exports_bytes: number
  orphan_bytes: number
  objects: number
}

/** Counts computed in Postgres with the caller's RLS (SPEC 4.9). */
export function useDashboardTotals() {
  return useQuery({
    queryKey: ['dashboard', 'totals'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('dashboard_totals')
      if (error) throw error
      return data as DashboardTotals
    },
  })
}

export function useProtocolOverview() {
  return useQuery({
    queryKey: ['dashboard', 'protocols'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('protocol_overview')
      if (error) throw error
      return (data as ProtocolOverviewRow[]).map((row) => ({
        ...row,
        chapters: Number(row.chapters),
        test_runs: Number(row.test_runs),
        steps: Number(row.steps),
        steps_executed: Number(row.steps_executed),
        steps_passed: Number(row.steps_passed),
      }))
    },
  })
}

export function useStorageUsage(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'storage'],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('storage_usage')
      if (error) throw error
      return data as StorageUsage
    },
  })
}
