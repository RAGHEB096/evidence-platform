import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_UPLOAD_LIMIT_BYTES, SIGNED_URL_TTL_SECONDS } from '@/config'
import { getSupabase } from '@/lib/supabase'

export interface EvidenceRow {
  id: string
  protocol_id: string
  chapter_id: string
  function_id: string
  test_run_id: string
  test_step_id: string | null
  storage_path: string
  original_filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  width: number
  height: number
  caption: string
  description: string
  uploaded_by: string
  uploaded_at: string
  deleted_at: string | null
}

export const EVIDENCE_COLUMNS =
  'id, protocol_id, chapter_id, function_id, test_run_id, test_step_id, storage_path, original_filename, mime_type, size_bytes, sha256, width, height, caption, description, uploaded_by, uploaded_at, deleted_at'

/** Names of where a library item sits, embedded through the composite foreign keys. */
export interface EvidenceLocation {
  protocol: { reference: string; name: string } | null
  chapter: { title: string } | null
  function: { title: string } | null
  test_run: { reference: string; title: string } | null
  test_step: { reference: string; description: string } | null
}

export type LibraryRow = EvidenceRow & EvidenceLocation

const LIBRARY_COLUMNS = `${EVIDENCE_COLUMNS},
  protocol:protocols!evidence_files_protocol_id_fkey(reference, name),
  chapter:chapters!evidence_files_chapter_id_protocol_id_fkey(title),
  function:functions!evidence_files_function_id_protocol_id_fkey(title),
  test_run:test_runs!evidence_files_test_run_id_protocol_id_fkey(reference, title),
  test_step:test_steps!evidence_files_test_step_id_test_run_id_fkey(reference, description)`

export const evidenceKeys = {
  run: (testRunId: string) => ['evidence', 'run', testRunId] as const,
  library: (filters: LibraryFilters, page: number) => ['evidence', 'library', filters, page] as const,
  all: ['evidence'] as const,
}

export function useRunEvidence(testRunId: string) {
  return useQuery({
    queryKey: evidenceKeys.run(testRunId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('evidence_files')
        .select(EVIDENCE_COLUMNS)
        .eq('test_run_id', testRunId)
        .is('deleted_at', null)
        .order('uploaded_at')
      if (error) throw error
      return data as EvidenceRow[]
    },
  })
}

export interface LibraryFilters {
  search: string
  protocolId: string
  chapterId: string
  functionId: string
  testRunId: string
  uploadedBy: string
  from: string
  to: string
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  search: '',
  protocolId: '',
  chapterId: '',
  functionId: '',
  testRunId: '',
  uploadedBy: '',
  from: '',
  to: '',
}

export const LIBRARY_PAGE_SIZE = 48

/** PostgREST `or` filter syntax treats , ( ) as structure; strip them from user text. */
function searchTerm(text: string): string {
  return text.replace(/[,()*%\\]/g, ' ').trim()
}

/** Server-side search, filters and paging over everything the caller can see under RLS. */
export function useEvidenceLibrary(filters: LibraryFilters, page: number) {
  return useQuery({
    queryKey: evidenceKeys.library(filters, page),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = getSupabase().from('evidence_files').select(LIBRARY_COLUMNS, { count: 'exact' }).is('deleted_at', null)
      const term = searchTerm(filters.search)
      if (term) query = query.or(`original_filename.ilike.*${term}*,caption.ilike.*${term}*,description.ilike.*${term}*`)
      if (filters.protocolId) query = query.eq('protocol_id', filters.protocolId)
      if (filters.chapterId) query = query.eq('chapter_id', filters.chapterId)
      if (filters.functionId) query = query.eq('function_id', filters.functionId)
      if (filters.testRunId) query = query.eq('test_run_id', filters.testRunId)
      if (filters.uploadedBy) query = query.eq('uploaded_by', filters.uploadedBy)
      if (filters.from) query = query.gte('uploaded_at', new Date(`${filters.from}T00:00:00`).toISOString())
      if (filters.to) {
        const end = new Date(`${filters.to}T00:00:00`)
        end.setDate(end.getDate() + 1)
        query = query.lt('uploaded_at', end.toISOString())
      }
      const start = page * LIBRARY_PAGE_SIZE
      const { data, error, count } = await query.order('uploaded_at', { ascending: false }).range(start, start + LIBRARY_PAGE_SIZE - 1)
      if (error) throw error
      return { rows: data as unknown as LibraryRow[], total: count ?? 0 }
    },
  })
}

/**
 * Short-lived signed URLs for private files (SPEC 5), fetched in one call per
 * set of paths and refreshed before they expire.
 */
export function useSignedUrls(paths: string[], bucket: 'evidence' | 'exports' = 'evidence') {
  const sorted = [...new Set(paths)].sort()
  return useQuery({
    queryKey: ['signed-urls', bucket, sorted],
    enabled: sorted.length > 0,
    staleTime: (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    refetchInterval: (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    queryFn: async () => {
      const { data, error } = await getSupabase().storage.from(bucket).createSignedUrls(sorted, SIGNED_URL_TTL_SECONDS)
      if (error) throw error
      return new Map<string, string>(data.flatMap((item) => (item.signedUrl && item.path ? [[item.path, item.signedUrl] as const] : [])))
    },
  })
}

export function useUploadLimit() {
  return useQuery({
    queryKey: ['settings', 'upload_limit_bytes'],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('app_settings').select('value').eq('key', 'upload_limit_bytes').maybeSingle()
      if (error) throw error
      return Number(data?.value ?? DEFAULT_UPLOAD_LIMIT_BYTES)
    },
    staleTime: 5 * 60_000,
  })
}

export function useEvidenceMutations() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: evidenceKeys.all })

  const updateMetadata = useMutation({
    mutationFn: async ({ id, caption, description }: { id: string; caption: string; description: string }) => {
      const { data, error } = await getSupabase().from('evidence_files').update({ caption, description }).eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw { code: '42501' }
    },
    onSuccess: refresh,
  })

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().rpc('archive_node', { p_node_type: 'evidence', p_id: id })
      if (error) throw error
    },
    onSuccess: refresh,
  })

  return { updateMetadata, archive }
}
