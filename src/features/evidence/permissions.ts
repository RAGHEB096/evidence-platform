import { roleAtLeast, type ProtocolRole } from '@/domain/roles'
import type { EvidenceRow } from '@/features/evidence/api'

export interface EvidencePermissions {
  userId: string
  isAdmin: boolean
  /** The caller's role on the evidence's protocol. */
  roleFor: (protocolId: string) => ProtocolRole | null
}

/** Mirrors the RLS policy "evidence: edit metadata" for showing controls. */
export function canEditEvidence(row: EvidenceRow, permissions: EvidencePermissions): boolean {
  const role = permissions.roleFor(row.protocol_id)
  return roleAtLeast(role, 'manager', permissions.isAdmin) || (row.uploaded_by === permissions.userId && roleAtLeast(role, 'tester'))
}

export function canArchiveEvidence(row: EvidenceRow, permissions: EvidencePermissions): boolean {
  return roleAtLeast(permissions.roleFor(row.protocol_id), 'manager', permissions.isAdmin)
}
