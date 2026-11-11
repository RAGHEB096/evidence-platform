import type { StatusDefinition } from '@/domain/status'

export const PROTOCOL_ROLES = ['viewer', 'tester', 'manager'] as const
export type ProtocolRole = (typeof PROTOCOL_ROLES)[number]

export const ROLE_LABELS: Record<ProtocolRole, string> = {
  viewer: 'Viewer',
  tester: 'Tester',
  manager: 'Manager',
}

export const ROLE_DESCRIPTIONS: Record<ProtocolRole, string> = {
  viewer: 'Sees the protocol, its structure and evidence, and downloads saved reports.',
  tester: 'Also records results and uploads evidence.',
  manager: 'Also edits structure and protocol details, manages any evidence and builds reports.',
}

const RANK: Record<ProtocolRole, number> = { viewer: 1, tester: 2, manager: 3 }

/** Mirrors private.has_protocol_role for UI decisions. The database remains the control. */
export function roleAtLeast(role: ProtocolRole | null | undefined, minimum: ProtocolRole, isAdmin = false): boolean {
  if (isAdmin) return true
  return !!role && RANK[role] >= RANK[minimum]
}

export const ACCOUNT_STATUSES = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Inactive', tone: 'muted' },
  password_change: { label: 'Must change password', tone: 'warning' },
} as const satisfies Record<string, StatusDefinition>

export function accountStatus(user: { is_active: boolean; must_change_password: boolean }): StatusDefinition {
  if (!user.is_active) return ACCOUNT_STATUSES.inactive
  if (user.must_change_password) return ACCOUNT_STATUSES.password_change
  return ACCOUNT_STATUSES.active
}
