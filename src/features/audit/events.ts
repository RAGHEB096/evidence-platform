import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase'

export interface AuditEvent {
  id: number
  occurred_at: string
  actor_id: string
  event_type: string
  entity_type: string
  entity_id: string | null
  protocol_id: string | null
  metadata: { changes?: Record<string, { old: unknown; new: unknown }>; row?: Record<string, unknown>; source_id?: string }
}

/** Plain-language descriptions of every event type the triggers and functions write. */
export const EVENT_LABELS: Record<string, string> = {
  'user.created': 'created a user account',
  'user.updated': 'changed a user account',
  'user.activated': 'reactivated a user',
  'user.deactivated': 'deactivated a user',
  'user.password_reset': 'reset a user’s password',
  'user.password_changed': 'changed their password',
  'protocol.created': 'created a protocol',
  'protocol.updated': 'changed a protocol',
  'protocol.archived': 'archived a protocol',
  'protocol.restored': 'restored a protocol',
  'access.granted': 'granted protocol access',
  'access.changed': 'changed a protocol role',
  'access.removed': 'removed protocol access',
  'chapter.created': 'added a chapter',
  'chapter.updated': 'changed a chapter',
  'chapter.archived': 'archived a chapter',
  'chapter.restored': 'restored a chapter',
  'chapter.duplicated': 'duplicated a chapter',
  'function.created': 'added a function',
  'function.updated': 'changed a function',
  'function.archived': 'archived a function',
  'function.restored': 'restored a function',
  'function.duplicated': 'duplicated a function',
  'test_run.created': 'added a test run',
  'test_run.updated': 'changed a test run',
  'test_run.archived': 'archived a test run',
  'test_run.restored': 'restored a test run',
  'test_run.duplicated': 'duplicated a test run',
  'test_step.created': 'added a step',
  'test_step.updated': 'changed a step',
  'test_step.archived': 'archived a step',
  'test_step.restored': 'restored a step',
  'test_step.result_recorded': 'recorded a step result',
  'evidence.created': 'uploaded evidence',
  'evidence.metadata_changed': 'changed evidence details',
  'evidence.archived': 'archived evidence',
  'evidence.restored': 'restored evidence',
  'document_export.created': 'started a report draft',
  'document_export.updated': 'changed a report draft',
  'document_export.generated': 'generated a Word report',
  'selection.added': 'selected evidence for a report',
  'selection.changed': 'changed a report selection',
  'selection.removed': 'removed evidence from a report',
  'setting.updated': 'changed an application setting',
}

export function describeEvent(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/[._]/g, ' ')
}

/** A short, human-readable form of a value in "what changed". */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value
  return JSON.stringify(value)
}

export interface AuditFilters {
  protocolId: string
  actorId: string
  eventType: string
  from: string
  to: string
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { protocolId: '', actorId: '', eventType: '', from: '', to: '' }
export const AUDIT_PAGE_SIZE = 50

/** Audit events the caller may read under RLS, newest first, filtered and paged on the server. */
export function useAuditEvents(filters: AuditFilters, page: number, pageSize = AUDIT_PAGE_SIZE) {
  return useQuery({
    queryKey: ['audit', filters, page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = getSupabase()
        .from('audit_events')
        .select('id, occurred_at, actor_id, event_type, entity_type, entity_id, protocol_id, metadata', { count: 'exact' })
      if (filters.protocolId) query = query.eq('protocol_id', filters.protocolId)
      if (filters.actorId) query = query.eq('actor_id', filters.actorId)
      if (filters.eventType) query = query.eq('event_type', filters.eventType)
      if (filters.from) query = query.gte('occurred_at', new Date(`${filters.from}T00:00:00`).toISOString())
      if (filters.to) {
        const end = new Date(`${filters.to}T00:00:00`)
        end.setDate(end.getDate() + 1)
        query = query.lt('occurred_at', end.toISOString())
      }
      const start = page * pageSize
      const { data, error, count } = await query.order('id', { ascending: false }).range(start, start + pageSize - 1)
      if (error) throw error
      return { events: data as AuditEvent[], total: count ?? 0 }
    },
  })
}
