import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/auth/useAuth'
import type { ProtocolRole } from '@/domain/roles'
import { getSupabase } from '@/lib/supabase'

/** The caller's role on every protocol they are assigned to (their own access rows). */
export function useMyRoles() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['my-roles', profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error } = await getSupabase().from('protocol_access').select('protocol_id, role').eq('user_id', profile!.id)
      if (error) throw error
      return new Map((data as { protocol_id: string; role: ProtocolRole }[]).map((row) => [row.protocol_id, row.role]))
    },
  })
}
