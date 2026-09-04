import { describe, expect, it } from 'vitest'
import { PortableAttachmentSessionManager } from './portable-attachment-sessions'

describe('portable attachment upload sessions', () => {
  it('serializes appends, enforces ownership and quota, and commits', async () => {
    let now = 10_000
    const manager = new PortableAttachmentSessionManager({ now: () => now, defaultQuotaBytes: 8, maxSessionTtlMs: 100 })
    const session = manager.create('owner-a', 'clip.mp4', { quotaBytes: 8 })
    const [one, two] = await Promise.all([
      manager.append(session.id, 'owner-a', new Uint8Array([1, 2, 3])),
      manager.append(session.id, 'owner-a', new Uint8Array([4, 5, 6, 7, 8]))
    ])
    expect(one.receivedBytes).toBeGreaterThan(0)
    expect(two.receivedBytes).toBe(8)
    await expect(manager.append(session.id, 'owner-a', new Uint8Array([9]))).rejects.toThrow(/quota/)
    await expect(manager.append(session.id, 'owner-b', new Uint8Array([9]))).rejects.toThrow(/owned/)
    expect((await manager.commit(session.id, 'owner-a')).state).toBe('committed')
  })

  it('expires and reaps only open sessions, while rollback is owner-bound', async () => {
    let now = 1_000
    const manager = new PortableAttachmentSessionManager({ now: () => now, maxSessionTtlMs: 50 })
    const session = manager.create('owner-a', 'photo.png')
    expect(await manager.rollback(session.id, 'owner-b')).toBe(false)
    now += 60
    expect(manager.reap()).toBe(1)
    expect(manager.get(session.id, 'owner-a')).toBeNull()
  })
})
