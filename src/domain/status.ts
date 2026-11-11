/**
 * Every status in the app, with the label and colour tone used to show it.
 * Status is always rendered with both (SPEC 4.1), via <StatusBadge>.
 */

export type StatusTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning' | 'muted'

export interface StatusDefinition {
  label: string
  tone: StatusTone
}

export const STEP_STATUSES = {
  not_started: { label: 'Not Started', tone: 'neutral' },
  in_progress: { label: 'In Progress', tone: 'info' },
  passed: { label: 'Passed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  blocked: { label: 'Blocked', tone: 'warning' },
  not_applicable: { label: 'Not Applicable', tone: 'muted' },
} as const satisfies Record<string, StatusDefinition>

export type StepStatus = keyof typeof STEP_STATUSES

export const PROTOCOL_STATUSES = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
} as const satisfies Record<string, StatusDefinition>

export type ProtocolStatus = keyof typeof PROTOCOL_STATUSES

/** Shown for any archived (soft-deleted) record, whatever its stored status (ADR-015). */
export const ARCHIVED_STATUS: StatusDefinition = { label: 'Archived', tone: 'muted' }

export const EXPORT_STATUSES = {
  draft: { label: 'Draft', tone: 'neutral' },
  generated: { label: 'Generated', tone: 'success' },
} as const satisfies Record<string, StatusDefinition>

export type ExportStatus = keyof typeof EXPORT_STATUSES

/** Statuses that count as "executed" for progress figures. */
export const FINAL_STEP_STATUSES: readonly StepStatus[] = ['passed', 'failed', 'blocked', 'not_applicable']
