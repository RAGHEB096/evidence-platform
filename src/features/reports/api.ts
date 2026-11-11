import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_IMAGE_LONG_EDGE_PX, DEFAULT_REPORT_PAGE_SIZE } from '@/config'
import type { ExportStatus } from '@/domain/status'
import { EVIDENCE_COLUMNS, type EvidenceRow } from '@/features/evidence/api'
import type { PageSizeName } from '@/features/reports/docx-builder'
import type { SelectionItem } from '@/features/reports/model'
import { getSupabase } from '@/lib/supabase'

export interface ExportRow {
  id: string
  protocol_id: string
  name: string
  status: ExportStatus
  include_steps_without_evidence: boolean
  storage_path: string | null
  sha256: string | null
  file_size_bytes: number | null
  chapter_count: number | null
  test_run_count: number | null
  step_count: number | null
  image_count: number | null
  generated_by: string | null
  generated_at: string | null
  created_by: string
  created_at: string
}

const EXPORT_COLUMNS =
  'id, protocol_id, name, status, include_steps_without_evidence, storage_path, sha256, file_size_bytes, chapter_count, test_run_count, step_count, image_count, generated_by, generated_at, created_by, created_at'

export interface ExportItemRow extends SelectionItem {
  id: string
}

export const reportKeys = {
  draft: (protocolId: string) => ['reports', 'draft', protocolId] as const,
  items: (exportId: string) => ['reports', 'items', exportId] as const,
  evidence: (protocolId: string) => ['reports', 'evidence', protocolId] as const,
  history: ['reports', 'history'] as const,
  detail: (exportId: string) => ['reports', 'detail', exportId] as const,
  settings: ['settings', 'report'] as const,
}

/** The protocol's current draft (the most recent one), or null when there is none yet. */
export function useDraftExport(protocolId: string) {
  return useQuery({
    queryKey: reportKeys.draft(protocolId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('document_exports')
        .select(EXPORT_COLUMNS)
        .eq('protocol_id', protocolId)
        .eq('status', 'draft')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as ExportRow | null
    },
  })
}

export function useExportItems(exportId: string | undefined) {
  return useQuery({
    queryKey: reportKeys.items(exportId ?? 'none'),
    enabled: !!exportId,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('document_export_items')
        .select('id, evidence_id, position, caption_override')
        .eq('export_id', exportId!)
      if (error) throw error
      return data as ExportItemRow[]
    },
  })
}

/** Every live evidence item of the protocol, oldest first. */
export function useProtocolEvidence(protocolId: string) {
  return useQuery({
    queryKey: reportKeys.evidence(protocolId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('evidence_files')
        .select(EVIDENCE_COLUMNS)
        .eq('protocol_id', protocolId)
        .is('deleted_at', null)
        .order('uploaded_at')
      if (error) throw error
      return data as EvidenceRow[]
    },
  })
}

export function useReportSettings() {
  return useQuery({
    queryKey: reportKeys.settings,
    queryFn: async () => {
      const { data, error } = await getSupabase().from('app_settings').select('key, value').in('key', ['report_page_size', 'image_long_edge_px'])
      if (error) throw error
      const values = new Map((data as { key: string; value: unknown }[]).map((row) => [row.key, row.value]))
      return {
        pageSize: (values.get('report_page_size') as PageSizeName | undefined) ?? DEFAULT_REPORT_PAGE_SIZE,
        longEdge: Number(values.get('image_long_edge_px') ?? DEFAULT_IMAGE_LONG_EDGE_PX),
      }
    },
  })
}

/**
 * Edits to the draft selection. Every change is a row change, so it is saved
 * as it happens and audited (ADR-006). The draft is created on first change.
 */
export function useSelectionMutations(protocolId: string, reference: string) {
  const queryClient = useQueryClient()
  const supabase = getSupabase()

  async function ensureDraft(): Promise<string> {
    const existing = queryClient.getQueryData<ExportRow | null>(reportKeys.draft(protocolId))
    if (existing) return existing.id
    const { data, error } = await supabase
      .from('document_exports')
      .insert({ protocol_id: protocolId, name: `${reference} test evidence report` })
      .select(EXPORT_COLUMNS)
      .single()
    if (error) throw error
    // Carry any optimistic selection over to the new draft's key first, so
    // nothing flickers when the page switches to it.
    queryClient.setQueryData(reportKeys.items((data as ExportRow).id), queryClient.getQueryData<ExportItemRow[]>(reportKeys.items('none')) ?? [])
    queryClient.setQueryData(reportKeys.draft(protocolId), data)
    return (data as ExportRow).id
  }

  const refreshItems = async (exportId: string) => queryClient.invalidateQueries({ queryKey: reportKeys.items(exportId) })

  const draftItemsKey = () => reportKeys.items(queryClient.getQueryData<ExportRow | null>(reportKeys.draft(protocolId))?.id ?? 'none')

  const select = useMutation({
    // Checkboxes respond at once; the refetch afterwards confirms the database state.
    onMutate: async ({ add, remove }: { add: { evidenceId: string; position: number }[]; remove: string[] }) => {
      const key = draftItemsKey()
      const previous = queryClient.getQueryData<ExportItemRow[]>(key)
      const removed = new Set(remove)
      // Write first, synchronously, so the checkbox changes in the same frame
      // as the click; then stop any in-flight fetch from overwriting it.
      queryClient.setQueryData<ExportItemRow[]>(key, [
        ...(previous ?? []).filter((item) => !removed.has(item.evidence_id)),
        ...add.map((item) => ({ id: `pending-${item.evidenceId}`, evidence_id: item.evidenceId, position: item.position, caption_override: null })),
      ])
      await queryClient.cancelQueries({ queryKey: key })
      return { key, previous }
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous)
    },
    mutationFn: async ({ add, remove }: { add: { evidenceId: string; position: number }[]; remove: string[] }) => {
      const exportId = await ensureDraft()
      if (add.length) {
        const { error } = await supabase
          .from('document_export_items')
          .insert(add.map((item) => ({ export_id: exportId, protocol_id: protocolId, evidence_id: item.evidenceId, position: item.position })))
        if (error) throw error
      }
      if (remove.length) {
        const { error } = await supabase.from('document_export_items').delete().eq('export_id', exportId).in('evidence_id', remove)
        if (error) throw error
      }
      return exportId
    },
    onSettled: (exportId) => exportId && refreshItems(exportId),
  })

  const setCaption = useMutation({
    mutationFn: async ({ exportId, evidenceId, caption }: { exportId: string; evidenceId: string; caption: string | null }) => {
      const { error } = await supabase.from('document_export_items').update({ caption_override: caption }).eq('export_id', exportId).eq('evidence_id', evidenceId)
      if (error) throw error
      return exportId
    },
    onSettled: (exportId) => exportId && refreshItems(exportId),
  })

  const reorder = useMutation({
    mutationFn: async ({ exportId, evidenceIds }: { exportId: string; evidenceIds: string[] }) => {
      const { error } = await supabase.rpc('reorder_export_items', { p_export_id: exportId, p_evidence_ids: evidenceIds })
      if (error) throw error
      return exportId
    },
    onSettled: (exportId) => exportId && refreshItems(exportId),
  })

  const updateDraft = useMutation({
    mutationFn: async (fields: Partial<Pick<ExportRow, 'name' | 'include_steps_without_evidence'>>) => {
      const exportId = await ensureDraft()
      const { error } = await supabase.from('document_exports').update(fields).eq('id', exportId)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: reportKeys.draft(protocolId) }),
  })

  /** After generating: carry the selection into a fresh draft so work can continue. */
  const continueInNewDraft = useMutation({
    mutationFn: async ({ exportId, name }: { exportId: string; name: string }) => {
      const { error } = await supabase.rpc('copy_export_to_draft', { p_export_id: exportId, p_name: name })
      if (error) throw error
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: reportKeys.draft(protocolId) }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]),
  })

  return { select, setCaption, reorder, updateDraft, continueInNewDraft }
}

export interface HistoryRow extends ExportRow {
  protocol: { reference: string; name: string } | null
}

/** Exports of every protocol the caller can see (RLS), newest first. */
export function useExportHistory() {
  return useQuery({
    queryKey: reportKeys.history,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('document_exports')
        .select(`${EXPORT_COLUMNS}, protocol:protocols!document_exports_protocol_id_fkey(reference, name)`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as HistoryRow[]
    },
  })
}

export interface ExportDetail {
  export: HistoryRow | null
  items: (ExportItemRow & { evidence: EvidenceRow | null })[]
}

export function useExportDetail(exportId: string) {
  return useQuery({
    queryKey: reportKeys.detail(exportId),
    queryFn: async (): Promise<ExportDetail> => {
      const supabase = getSupabase()
      const [exportResult, itemsResult] = await Promise.all([
        supabase
          .from('document_exports')
          .select(`${EXPORT_COLUMNS}, protocol:protocols!document_exports_protocol_id_fkey(reference, name)`)
          .eq('id', exportId)
          .maybeSingle(),
        supabase
          .from('document_export_items')
          .select(`id, evidence_id, position, caption_override, evidence:evidence_files!document_export_items_evidence_id_protocol_id_fkey(${EVIDENCE_COLUMNS})`)
          .eq('export_id', exportId)
          .order('position'),
      ])
      if (exportResult.error) throw exportResult.error
      if (itemsResult.error) throw itemsResult.error
      return { export: exportResult.data as unknown as HistoryRow | null, items: itemsResult.data as unknown as ExportDetail['items'] }
    },
  })
}

/** A short-lived download link for a saved report. */
export async function reportDownloadUrl(storagePath: string, fileName: string): Promise<string> {
  const { data, error } = await getSupabase().storage.from('exports').createSignedUrl(storagePath, 60, { download: fileName })
  if (error) throw error
  return data.signedUrl
}
