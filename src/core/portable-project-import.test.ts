import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { exportPortableProjectV3, importPortableProjectV3 } from './portable-project-import'
import { sha256Media } from './portable-media-assets'
import { createPortableProjectV3Manifest } from './portable-project-v3'
import { openContainer, packContainer } from './project-archive-container'
import type { Project } from '../shared/types'

const project = {
  id: 'source-project',
  name: 'Portable board',
  color: '#6750A4',
  viewport: { x: 22, y: -17, zoom: 1.25 },
  nodes: [{
    id: 'sticky-1',
    kind: 'sticky',
    position: { x: 40, y: 80 },
    size: { width: 240, height: 200 },
    title: 'Notes',
    color: '#6750A4',
    group: null,
    text: 'Keep the viewport and the note.'
  }]
} as Project

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('portable schema 3 import/export', () => {
  it('is deterministic and preserves viewport while hydrating no machine state', async () => {
    const one = await exportPortableProjectV3(project, { historyBundle: Buffer.from('history') })
    const two = await exportPortableProjectV3(project, { historyBundle: Buffer.from('history') })
    expect(one.bytes.equals(two.bytes)).toBe(true)
    const imported = await importPortableProjectV3(one.bytes)
    expect(imported.projection.canvases.find((canvas) => canvas.id === 'root')?.viewport).toEqual(project.viewport)
    expect(imported.project.viewport).toEqual(project.viewport)
    expect(imported.project.id).not.toBe(project.id)
    expect(imported.project.cwd).toBeUndefined()
    expect(imported.project.ssh).toBeUndefined()
    expect(imported.bindings).toEqual([])
  })

  it('includes media under the content-addressed namespace with final byte checks', async () => {
    const id = sha256Media(png)
    const asset = {
      id,
      kind: 'image' as const,
      mime: 'image/png',
      extension: 'png',
      bytes: png.byteLength,
      sha256: id,
      label: 'Canvas photo'
    }
    const exported = await exportPortableProjectV3(project, {
      historyBundle: Buffer.from('history'),
      media: { assets: [{ asset, data: png, sourceName: 'photo.png' }] }
    })
    expect(exported.manifest.entries.some((entry) => entry.path === `assets/media/${id}.png`)).toBe(true)
    expect(exported.projection.media?.assets[0].label).toBe('Canvas photo')
    const imported = await importPortableProjectV3(exported.bytes)
    expect(imported.projection.media?.assets[0].sha256).toBe(id)
  })

  it('atomically stages validated media bytes and rejects orphan media', async () => {
    const id = sha256Media(png)
    const asset = { id, kind: 'image' as const, mime: 'image/png', extension: 'png', bytes: png.byteLength, sha256: id, label: 'Canvas photo' }
    const exported = await exportPortableProjectV3(project, { historyBundle: Buffer.from('history'), media: { assets: [{ asset, data: png, sourceName: 'photo.png' }] } })
    const parent = await mkdtemp(join(tmpdir(), 'nodeterm-portable-'))
    try {
      const destination = join(parent, 'imported')
      const imported = await importPortableProjectV3(exported.bytes, { destination })
      expect(imported.stagedPath).toBe(destination)
      expect(await readFile(join(destination, '.nodeterm', 'assets', 'media', id + '.png'))).toEqual(Buffer.from(png))
      const plain = await exportPortableProjectV3(project, { historyBundle: Buffer.from('history') })
      const entries = openContainer(plain.bytes, { maxArchiveBytes: 512 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024 * 1024, maxEntries: 60000 })
      const orphanPath = 'assets/media/' + id + '.png'
      const payload = [...entries.entries()].filter(([name]) => name !== 'manifest.json').map(([name, data]) => ({ path: name, data, required: name === 'project.json' || name === 'history.bundle', compressedBytes: Math.min(data.length, deflateRawSync(data).length) }))
      payload.push({ path: orphanPath, data: Buffer.from(png), required: false, compressedBytes: Math.min(png.length, deflateRawSync(png).length) })
      const manifest = await createPortableProjectV3Manifest({ name: project.name, color: project.color }, payload)
      const orphan = packContainer([
        { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest) + '\n') },
        ...payload.map((entry) => ({ path: entry.path, data: Buffer.from(entry.data) }))
      ])
      await expect(importPortableProjectV3(orphan)).rejects.toThrow(/without a media manifest/)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
