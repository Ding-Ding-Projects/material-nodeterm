import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  buildArchive,
  buildDocumentExport,
  crc32,
  sanitizeZipPath,
  type ArchiveMember
} from './index'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load(text: string): unknown }
const unzipper = require('unzipper') as {
  Open: {
    buffer(input: Buffer): Promise<{
      files: Array<{
        path: string
        flags: number
        isUnicode: boolean
        crc32: number
        offsetToLocalFileHeader: number
        buffer(): Promise<Buffer>
      }>
    }>
  }
}

function textMember(path: string, content: string): ArchiveMember {
  return {
    path,
    built: {
      filename: '飲茶-notes.txt',
      mimeType: 'text/plain',
      content,
      encoding: 'utf-8',
      lineEnding: 'LF',
      lossy: []
    }
  }
}

describe('export codec round trips', () => {
  it('round-trips hostile YAML mapping keys through a real YAML 1.2 parser', () => {
    const data = {
      '廣東話: 飲茶': '好味 🫖',
      'quote "key"': 'value: "still one value"',
      'note # not a comment': '保留 # 全部',
      nested: [{ '陣列: "鍵"': '🐉' }]
    }

    const built = buildDocumentExport({ name: '粵語 export', data }, 'yaml')

    expect(yaml.load(built.content)).toEqual(data)
    expect(built.content).toContain(`${JSON.stringify('廣東話: 飲茶')}:`)
    expect(built.content).toContain(`${JSON.stringify('quote "key"')}:`)
    expect(built.content).toContain(`${JSON.stringify('note # not a comment')}:`)
  })

  it('writes UTF-8 archive names and byte-accurate manifests readable by a real ZIP reader', async () => {
    const content = '廣東話 🐉\nemoji: 🫖\n'
    const unsafePath = 'C:\\private\\..\\匯出\\飲茶 🫖: "甲".txt'
    const expectedPath = '匯出/飲茶 🫖: "甲".txt'
    const archive = buildArchive('粵語 archive', [textMember(unsafePath, content)])
    const bytes = Buffer.from(archive.bytes)
    const opened = await unzipper.Open.buffer(bytes)

    expect(opened.files.map((file) => file.path).sort()).toEqual(
      ['MANIFEST.json', expectedPath].sort()
    )
    const contentEntry = opened.files.find((file) => file.path === expectedPath)
    const manifestEntry = opened.files.find((file) => file.path === 'MANIFEST.json')
    expect(contentEntry).toBeDefined()
    expect(manifestEntry).toBeDefined()
    if (!contentEntry || !manifestEntry) return

    const contentBytes = await contentEntry.buffer()
    const manifest = JSON.parse((await manifestEntry.buffer()).toString('utf8')) as {
      members: Array<{ path: string; bytes: number }>
    }
    expect(contentBytes.toString('utf8')).toBe(content)
    expect(manifest.members).toMatchObject([
      { path: expectedPath, bytes: new TextEncoder().encode(content).length }
    ])
    expect(manifest.members[0].bytes).toBeGreaterThan(content.length)

    // unzipper exposes central-directory metadata. The local header has its own copy of the
    // flag, so inspect that independent location too; both are required by the ZIP format.
    for (const entry of opened.files) {
      const localFlags = bytes.readUInt16LE(entry.offsetToLocalFileHeader + 6)
      const actual = await entry.buffer()
      expect(entry.isUnicode).toBe(true)
      expect(entry.flags & 0x0800).toBe(0x0800)
      expect(localFlags & 0x0800).toBe(0x0800)
      expect(entry.crc32).toBe(crc32(actual))
    }
  })

  it('uses the standard CRC-32 vector and keeps archive paths relative', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(sanitizeZipPath('C:\\..\\..\\報告\\..\\飲茶.json')).toBe('飲茶.json')
    expect(sanitizeZipPath('C:\\safe\\飲茶.json')).toBe('safe/飲茶.json')
    expect(sanitizeZipPath('/absolute/../safe/./檔案.json')).toBe('safe/檔案.json')
  })

  it('rejects members that collide after path sanitization or replace the manifest', () => {
    expect(() =>
      buildArchive('collision', [textMember('../same.txt', 'one'), textMember('same.txt', 'two')])
    ).toThrow(/duplicate or reserved archive path/)
    expect(() => buildArchive('manifest', [textMember('../MANIFEST.json', 'shadow')])).toThrow(
      /duplicate or reserved archive path/
    )
  })
})
