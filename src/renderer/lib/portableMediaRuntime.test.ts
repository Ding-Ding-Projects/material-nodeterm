import { describe, expect, it, vi } from 'vitest'
import { replaceOwnedObjectUrl, resolvePortableMediaReference } from './portableMediaRuntime'

describe('portable media runtime resolver', () => {
  it('resolves archive references from the private imported cache only', async () => {
    const allow = vi.fn(async (path: string) => 'nt-media://' + path)
    const result = await resolvePortableMediaReference(
      { id: 'p', name: 'p', color: '#000000', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], cwd: 'C:/project' },
      { assetId: 'a'.repeat(64), sha256: 'a'.repeat(64), kind: 'image', displayName: 'photo', extension: 'png', source: 'archive' },
      { allow, allowSsh: vi.fn() }
    )
    expect(result.ok).toBe(true)
    expect(allow).toHaveBeenCalledWith('C:/project/.nodeterm/assets/media/' + 'a'.repeat(64) + '.png')
  })

  it('returns honest unavailable states and revokes replaced blob URLs', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await expect(resolvePortableMediaReference(
      { id: 'p', name: 'p', color: '#000000', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [] },
      { assetId: 'a'.repeat(64), kind: 'video', displayName: 'clip', source: 'ssh' },
      { allow: vi.fn(), allowSsh: vi.fn() }
    )).resolves.toMatchObject({ ok: false })
    replaceOwnedObjectUrl('blob:old', 'blob:new')
    expect(revoke).toHaveBeenCalledWith('blob:old')
    revoke.mockRestore()
  })
})
