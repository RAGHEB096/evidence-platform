import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { TINY_PNG, serviceClient } from './helpers'
import { buildWorld, type World } from './world'

let w: World
let objectPath: string

beforeAll(async () => {
  w = await buildWorld()
  objectPath = `${w.p.protocolId}/${randomUUID()}/login.png`
  const { error } = await w.tester.client.storage.from('evidence').upload(objectPath, TINY_PNG, { contentType: 'image/png' })
  if (error) throw new Error(`fixture upload failed: ${error.message}`)
})

async function objectExists(path: string) {
  const { data, error } = await serviceClient().storage.from('evidence').download(path)
  return !error && data !== null && data.size === TINY_PNG.length
}

describe('evidence bucket', () => {
  it('lets testers upload under their protocol', async () => {
    expect(await objectExists(objectPath)).toBe(true)
  })

  it('refuses uploads from viewers and from people outside the protocol', async () => {
    for (const user of [w.viewer, w.outsider]) {
      const path = `${w.p.protocolId}/${randomUUID()}/x.png`
      const { error } = await user.client.storage.from('evidence').upload(path, TINY_PNG, { contentType: 'image/png' })
      expect(error, user.username).not.toBeNull()
    }
    const intoOther = `${w.q.protocolId}/${randomUUID()}/x.png`
    expect((await w.tester.client.storage.from('evidence').upload(intoOther, TINY_PNG, { contentType: 'image/png' })).error).not.toBeNull()
  })

  it('refuses paths that do not follow {protocol}/{evidence}/{file}', async () => {
    for (const path of [`${w.p.protocolId}/x.png`, `${w.p.protocolId}/not-a-uuid/x.png`, `${w.p.protocolId}/${randomUUID()}/a/b.png`]) {
      const { error } = await w.tester.client.storage.from('evidence').upload(path, TINY_PNG, { contentType: 'image/png' })
      expect(error, path).not.toBeNull()
    }
  })

  it('refuses file types outside the allow-list at the bucket', async () => {
    const path = `${w.p.protocolId}/${randomUUID()}/notes.txt`
    const { error } = await w.tester.client.storage.from('evidence').upload(path, Buffer.from('hello'), { contentType: 'text/plain' })
    expect(error).not.toBeNull()
  })

  it('never lets an original be overwritten or deleted', async () => {
    for (const user of [w.tester, w.manager, w.admin]) {
      const overwrite = await user.client.storage
        .from('evidence')
        .upload(objectPath, Buffer.from('not the original'), { contentType: 'image/png', upsert: true })
      expect(overwrite.error, `${user.username} overwrite`).not.toBeNull()

      await user.client.storage.from('evidence').remove([objectPath])
      expect(await objectExists(objectPath), `${user.username} delete`).toBe(true)
    }
  })

  it('serves files to people on the protocol and nobody else', async () => {
    const viewer = await w.viewer.client.storage.from('evidence').createSignedUrl(objectPath, 60)
    expect(viewer.error).toBeNull()
    expect((await fetch(viewer.data!.signedUrl)).ok).toBe(true)

    const outsiderUrl = await w.outsider.client.storage.from('evidence').createSignedUrl(objectPath, 60)
    expect(outsiderUrl.data).toBeNull()
    const outsiderDownload = await w.outsider.client.storage.from('evidence').download(objectPath)
    expect(outsiderDownload.data).toBeNull()
    const outsiderList = await w.outsider.client.storage.from('evidence').list(w.p.protocolId)
    expect(outsiderList.data ?? []).toEqual([])

    const otherManager = await w.otherManager.client.storage.from('evidence').createSignedUrl(objectPath, 60)
    expect(otherManager.data).toBeNull()
  })
})

describe('exports bucket', () => {
  it('accepts reports from managers only, at {protocol}/{export}.docx', async () => {
    const docx = Buffer.from('PK\u0003\u0004')
    const type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const path = `${w.p.protocolId}/${randomUUID()}.docx`
    expect((await w.tester.client.storage.from('exports').upload(path, docx, { contentType: type })).error).not.toBeNull()
    expect((await w.manager.client.storage.from('exports').upload(path, docx, { contentType: type })).error).toBeNull()
    expect((await w.viewer.client.storage.from('exports').download(path)).error).toBeNull()
    expect((await w.outsider.client.storage.from('exports').download(path)).data).toBeNull()

    await w.manager.client.storage.from('exports').remove([path])
    expect((await serviceClient().storage.from('exports').download(path)).error).toBeNull()
  })
})
