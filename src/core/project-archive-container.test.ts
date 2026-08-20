import { describe, expect, it } from 'vitest'
import { looksLikeContainer, openContainer, packContainer } from './project-archive-container'

// unzipper is an independently written ZIP reader already shipped as a production dependency
// (core/minecraft/java.ts). Reading our writer's output with it proves the container is a REAL
// ZIP — a .nodeterm-project renamed to .zip opens in ordinary tools — not merely a format this
// module happens to round-trip with itself.
const unzipper = require('unzipper') as {
  Open: { buffer(b: Buffer): Promise<{ files: { path: string; buffer(): Promise<Buffer> }[] }> }
}

const LIMITS = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
  maxEntries: 1000
}

describe('project archive container', () => {
  it('round-trips text, binary and empty entries byte-for-byte', () => {
    const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256))
    const entries = [
      { path: 'archive.json', data: Buffer.from('{"schemaVersion":2}', 'utf-8') },
      { path: 'files/src/嵌套/main 蝦餃.ts', data: Buffer.from('export const x = 1\n'.repeat(400), 'utf-8') },
      { path: 'repo/repository.bundle', data: binary },
      { path: 'files/empty.txt', data: Buffer.alloc(0) }
    ]
    const zip = packContainer(entries)
    expect(looksLikeContainer(zip)).toBe(true)
    const read = openContainer(zip, LIMITS)
    expect([...read.keys()].sort()).toEqual(entries.map((e) => e.path).sort())
    for (const e of entries) expect(read.get(e.path)!.equals(e.data)).toBe(true)
  })

  it('compresses compressible entries (DEFLATE) and stores incompressible ones', () => {
    const compressible = Buffer.from('the same line over and over\n'.repeat(10_000), 'utf-8')
    const zip = packContainer([{ path: 'files/big.txt', data: compressible }])
    expect(zip.length).toBeLessThan(compressible.length / 4)
    const read = openContainer(zip, LIMITS)
    expect(read.get('files/big.txt')!.equals(compressible)).toBe(true)
  })

  it('is a real ZIP: unzipper (independent reader) extracts identical bytes', async () => {
    const entries = [
      { path: 'mimetype', data: Buffer.from('application/x-nodeterm-project', 'utf-8') },
      { path: 'files/a/b.txt', data: Buffer.from('deflate me '.repeat(500), 'utf-8') }
    ]
    const zip = packContainer(entries)
    const opened = await unzipper.Open.buffer(zip)
    expect(opened.files.map((f) => f.path).sort()).toEqual(entries.map((e) => e.path).sort())
    for (const e of entries) {
      const match = opened.files.find((f) => f.path === e.path)!
      expect((await match.buffer()).equals(e.data)).toBe(true)
    }
  })

  it('refuses truncated bytes, a corrupted entry, and non-ZIP input', () => {
    const zip = packContainer([{ path: 'files/x.txt', data: Buffer.from('hello world hello world') }])
    expect(() => openContainer(zip.subarray(0, zip.length - 9), LIMITS)).toThrow(/not a readable/)
    const corrupt = Buffer.from(zip)
    // Flip a byte inside the entry data (past the 30-byte local header + name).
    corrupt[30 + 'files/x.txt'.length + 2] ^= 0xff
    expect(() => openContainer(corrupt, LIMITS)).toThrow(/not a readable/)
    expect(() => openContainer(Buffer.from('{"schemaVersion":1}'), LIMITS)).toThrow(/not a readable/)
  })

  it('refuses an entry whose declared size lies (forged central directory)', () => {
    const zip = packContainer([{ path: 'files/x.txt', data: Buffer.from('abcdefghij') }])
    // The single central-directory record's uncompressed-size field sits at centralStart + 24.
    const eocd = zip.length - 22
    const centralStart = zip.readUInt32LE(eocd + 16)
    const forged = Buffer.from(zip)
    forged.writeUInt32LE(3, centralStart + 24)
    expect(() => openContainer(forged, LIMITS)).toThrow(/not a readable/)
  })

  it('enforces the archive, entry-count, per-entry and total budgets with real numbers', () => {
    const zip = packContainer([{ path: 'files/x.txt', data: Buffer.from('x'.repeat(100)) }])
    expect(() => openContainer(zip, { ...LIMITS, maxArchiveBytes: 10 })).toThrow(/limit/)
    expect(() => openContainer(zip, { ...LIMITS, maxEntries: 0 })).toThrow(/entry limit/)
    expect(() => openContainer(zip, { ...LIMITS, maxEntryBytes: 10 })).toThrow(/per-entry limit/)
    expect(() => openContainer(zip, { ...LIMITS, maxTotalBytes: 10 })).toThrow(/read budget/)
  })

  it('refuses traversal entry names instead of quietly renaming them', () => {
    const zip = packContainer([{ path: 'files/inner.txt', data: Buffer.from('x') }])
    // Rewrite the name "files/inner.txt" to "../../../etc/pwn" (same length, 16 chars vs 15 — use
    // an equal-length hostile name so offsets stay valid).
    const hostile = Buffer.from('../../etc/pwnnn', 'ascii')
    expect(hostile.length).toBe('files/inner.txt'.length)
    const forged = Buffer.from(zip)
    // Name appears twice: local header (offset 30) and central directory.
    forged.set(hostile, 30)
    const eocd = forged.length - 22
    const centralStart = forged.readUInt32LE(eocd + 16)
    forged.set(hostile, centralStart + 46)
    expect(() => openContainer(forged, LIMITS)).toThrow(/unsafe entry path/)
  })

  it('refuses unclean and duplicate paths at pack time (programmer error, loud)', () => {
    expect(() => packContainer([{ path: '../x', data: Buffer.alloc(0) }])).toThrow(/not clean/)
    expect(() =>
      packContainer([
        { path: 'a', data: Buffer.alloc(0) },
        { path: 'a', data: Buffer.alloc(0) }
      ])
    ).toThrow(/Duplicate/)
  })
})
