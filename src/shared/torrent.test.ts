import { describe, expect, it } from 'vitest'
import {
  parseMagnetUri,
  safeTorrentRelativePath,
  validateTorrentBencode,
  buildTorrentExport,
  WEBTORRENT_RUNTIME_DESCRIPTOR
} from './torrent'

describe('torrent source contracts', () => {
  it('accepts reordered and repeated v1/v2 magnet parameters without contacting a network', () => {
    const parsed = parseMagnetUri('magnet:?tr=https%3A%2F%2Ftracker.example%2Fannounce&dn=demo&xt=urn%3Abtmh%3A1220aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef01234567')
    expect(parsed.infoHashes).toHaveLength(2)
    expect(parsed.displayName).toBe('demo')
    expect(parsed.trackers).toEqual(['https://tracker.example/announce'])
  })

  it('accepts the 32-character v1 base32 form', () => {
    expect(parseMagnetUri('magnet:?xt=urn%3Abtih%3AABCDEFGHIJKLMNOPQRSTUVWXYZ234567').infoHashes[0]).toMatchObject({ version: 1, encoding: 'base32' })
  })

  it('rejects conflicting repeated identifiers and malformed bencode', () => {
    expect(() => parseMagnetUri('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98')).toThrow(/conflicting/i)
    expect(() => validateTorrentBencode(new TextEncoder().encode('d4:infod4:name3:fooe'))).toThrow()
  })

  it('validates a single-file torrent and rejects traversal, ADS, reserved and trailing names', () => {
    const bytes = new TextEncoder().encode('d4:infod6:lengthi3e4:name3:foo12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee')
    expect(validateTorrentBencode(bytes)).toMatchObject({ name: 'foo', totalBytes: 3 })
    for (const value of ['../escape', 'C:/escape', '/absolute', 'dir/file:stream', 'CON.txt', 'trailing.']) {
      expect(safeTorrentRelativePath(value)).toBe(false)
    }
  })

  it('keeps the runtime descriptor pinned and bundled-only', () => {
    expect(WEBTORRENT_RUNTIME_DESCRIPTOR).toMatchObject({ version: '2.8.1', installMode: 'bundled', license: 'MIT' })
    expect(WEBTORRENT_RUNTIME_DESCRIPTOR.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(WEBTORRENT_RUNTIME_DESCRIPTOR.origin).toMatch(/^https:\/\//)
  })

  it('redacts transport and machine paths from every export format while retaining omission facts', () => {
    const task = { id: 'task-1', nodeId: 'node-1', sourceKind: 'magnet' as const, sourceRef: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567', name: 'Demo', destination: 'C:/private/downloads', files: [{ path: 'private/file.bin', name: 'file.bin', sizeBytes: 4, selected: true, downloadedBytes: 4 }], status: 'completed' as const, integrity: 'verified' as const, progress: 1, downloadedBytes: 4, selectedBytes: 4, totalBytes: 4, speedBytesPerSecond: 0, peers: 2, etaSeconds: null, error: null, seedPolicy: { kind: 'never' } as const, seedingRemainingSeconds: null, uploadedBytes: 0, ratio: 0, createdAt: 1, updatedAt: 1 }
    for (const format of ['json', 'jsonl', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'markdown', 'html', 'sql'] as const) {
      const output = buildTorrentExport([task], format)
      expect(output.content).toContain('Omitted for privacy')
      expect(output.content).not.toContain('magnet:?xt=')
      expect(output.content).not.toContain('C:/private/downloads')
      expect(output.content).not.toContain('private/file.bin')
    }
  })
})
