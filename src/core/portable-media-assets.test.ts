import { describe, expect, it } from 'vitest'
import {
  applyPortableMediaDecisions,
  createPortableMediaManifest,
  inspectPortableMedia,
  parsePortableMediaManifest,
  sha256Media,
  type PortableMediaCollected
} from './portable-media-assets'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const asset = {
  id: sha256Media(png),
  kind: 'image' as const,
  mime: 'image/png',
  extension: 'png',
  bytes: png.byteLength,
  sha256: sha256Media(png),
  label: 'Photo'
}

describe('portable media assets', () => {
  it('detects bytes by signature and preserves exact hash and length', () => {
    expect(inspectPortableMedia(png, 'photo.png')).toMatchObject({ kind: 'image', mime: 'image/png', extension: 'png', bytes: png.byteLength })
    expect(sha256Media(png)).toHaveLength(64)
  })

  it('rejects a manifest with unknown keys and round-trips canonical metadata', () => {
    const manifest = createPortableMediaManifest([asset])
    const bytes = new TextEncoder().encode(JSON.stringify(manifest))
    expect(parsePortableMediaManifest(bytes).assets[0]).toEqual(asset)
    const unknown = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    unknown.extra = true
    expect(() => parsePortableMediaManifest(new TextEncoder().encode(JSON.stringify(unknown)))).toThrow(/unknown key/)
  })

  it('makes Include, Omit, and Locate Later materially different archive decisions', () => {
    const collected = (id: string): PortableMediaCollected => ({ asset: { ...asset, id, sha256: id }, data: png, sourceName: 'photo.png' })
    const first = collected(asset.id)
    const second = collected('b'.repeat(64))
    const third = collected('c'.repeat(64))
    const result = applyPortableMediaDecisions([first, second, third], new Map([
      [asset.id, 'include'],
      [second.asset.id, 'omit'],
      [third.asset.id, 'locate-later']
    ]))
    // Locate Later keeps a content-addressed placeholder ASSET (the destination can offer a file
    // picker later); only Omit becomes an omission record, whose assetId the manifest schema
    // requires to be the SHA-256 content address.
    expect(result.assets.map((item) => item.asset.id)).toEqual([asset.id, third.asset.id])
    expect(result.assets[1]?.asset.unresolved).toBe(true)
    expect(result.assets[1]?.data).toBeUndefined()
    expect(result.omissions).toHaveLength(1)
    expect(result.omissions[0]).toMatchObject({ assetId: second.asset.id, decision: 'omit' })
    expect(result.omissions[0].assetId).toMatch(/^[0-9a-f]{64}$/)
  })
})
