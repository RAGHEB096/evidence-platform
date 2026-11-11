import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProtocolStatus } from '@/domain/status'
import { getSupabase } from '@/lib/supabase'

export interface ProtocolRow {
  id: string
  reference: string
  name: string
  description: string
  version: string
  status: ProtocolStatus
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export const PROTOCOL_COLUMNS = 'id, reference, name, description, version, status, created_by, created_at, updated_at, deleted_at'

export const protocolKeys = {
  all: ['protocols'] as const,
  detail: (id: string) => ['protocols', id] as const,
}

/** Every protocol the caller can see under RLS (administrators also see archived ones). */
export function useProtocols() {
  return useQuery({
    queryKey: protocolKeys.all,
    queryFn: async () => {
      const { data, error } = await getSupabase().from('protocols').select(PROTOCOL_COLUMNS).order('updated_at', { ascending: false })
      if (error) throw error
      return data as ProtocolRow[]
    },
  })
}

export interface NewProtocol {
  reference: string
  name: string
  description: string
  version: string
}

export function useCreateProtocol() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewProtocol) => {
      const { data, error } = await getSupabase().rpc('create_protocol', {
        p_reference: input.reference,
        p_name: input.name,
        p_description: input.description,
        p_version: input.version,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: protocolKeys.all }),
  })
}
