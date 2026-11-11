import {
  buildHierarchy,
  createProtocol,
  createUser,
  grantAccess,
  insertEvidence,
  type Hierarchy,
  type TestUser,
} from './helpers'

export interface World {
  admin: TestUser
  manager: TestUser
  tester: TestUser
  viewer: TestUser
  outsider: TestUser
  /** Manager of protocol Q only. */
  otherManager: TestUser
  p: Hierarchy
  q: Hierarchy
  evidenceP: { id: string; storagePath: string }
  evidenceQ: { id: string; storagePath: string }
}

/**
 * Two protocols. P: manager (its creator), tester, viewer. Q: otherManager.
 * outsider is active but assigned to nothing.
 */
export async function buildWorld(): Promise<World> {
  const [admin, manager, tester, viewer, outsider, otherManager] = await Promise.all([
    createUser({ prefix: 'admin', isAdmin: true }),
    createUser({ prefix: 'manager', canCreate: true }),
    createUser({ prefix: 'tester' }),
    createUser({ prefix: 'viewer' }),
    createUser({ prefix: 'outsider' }),
    createUser({ prefix: 'manager2', canCreate: true }),
  ])

  const pId = await createProtocol(manager.client, 'Protocol P')
  const qId = await createProtocol(otherManager.client, 'Protocol Q')
  await grantAccess(admin.client, pId, tester.id, 'tester')
  await grantAccess(admin.client, pId, viewer.id, 'viewer')

  const p = await buildHierarchy(manager.client, pId)
  const q = await buildHierarchy(otherManager.client, qId)
  const evidenceP = await insertEvidence(p, tester.id)
  const evidenceQ = await insertEvidence(q, otherManager.id)

  return { admin, manager, tester, viewer, outsider, otherManager, p, q, evidenceP, evidenceQ }
}
