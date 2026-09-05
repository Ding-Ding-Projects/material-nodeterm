import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { captureIsCurrent, inspectPng, mergeCaptureManifest, validateAttachedTarget, validateExternalCaptureReceipt } from './capture-evidence.mjs'

function png(width = 2, height = 2) {
  const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length); return out }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.concat(Array.from({ length: height }, (_, row) => { const line = Buffer.alloc(1 + width * 4); line[1 + ((row + 1) % width) * 4] = 255; return line }))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

describe('capture evidence PNG inspection', () => {
  it('decodes CDP-compatible PNG dimensions and a content hash', () => {
    expect(inspectPng(png(3, 4))).toMatchObject({ width: 3, height: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })
  it('refuses a truncated raster instead of trusting its extension', () => {
    expect(() => inspectPng(png().subarray(0, -3))).toThrow(/required raster chunks|truncated/)
  })
  it('refuses bad CRC bytes and trailing padding', () => {
    const badCrc = Buffer.from(png()); badCrc[badCrc.length - 1] ^= 1
    expect(() => inspectPng(badCrc)).toThrow(/CRC/)
    expect(() => inspectPng(Buffer.concat([png(), Buffer.alloc(7000)]) )).toThrow(/trailing/)
  })
})

describe('versioned per-entry capture provenance', () => {
  const tuple = { label: '1600x1000-s1-dark-en' }
  const old = { commit: 'old', method: 'old route', capturedAt: 'yesterday', captured: [{ id: 'canvas', bytes: 8 }] }
  const update = { id: 'settings', bytes: 9, capturedAt: 'today', tuple, provenance: { commit: 'next', version: '1.2.3', buildKind: 'packaged', method: 'new route', receipt: null } }
  it('keeps unselected legacy rows when a filtered run updates another row', () => {
    const manifest = mergeCaptureManifest(old, [update], 'today')
    expect(manifest.schemaVersion).toBe(2)
    expect(Object.keys(manifest.entries)).toEqual(['canvas', 'settings'])
    expect(manifest.captured.map((entry) => entry.id)).toEqual(['canvas', 'settings'])
  })
  it('requires exact commit and tuple currentness', () => {
    expect(captureIsCurrent(update, { commit: 'next', tuple })).toBe(true)
    expect(captureIsCurrent(update, { commit: 'other', tuple })).toBe(false)
    expect(captureIsCurrent(update, { commit: 'next', tuple: { label: 'other' } })).toBe(false)
  })
})

describe('external hidden-desktop receipt', () => {
  const sha = 'a'.repeat(40)
  const receipt = { schemaVersion: 1, route: 'cheap-lowlevel-headless', method: 'cheap Lowlevel MCP headless packaged-gallery launch', source: { gitHead: sha, workingTreeDigest: 'd'.repeat(64), provenanceSha256: 'e'.repeat(64) }, candidate: { sha256: 'a'.repeat(64), appAsarSha256: 'b'.repeat(64) }, launch: { ok: true, pid: 42, focusStealing: false, terminalWindow: false, desktop: 'capture-desktop' }, cdp: { count: 1, id: 'target', url: 'file:///expected', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target' } }
  it('accepts an externally launched canonical target only with its matching receipt', () => {
    expect(validateExternalCaptureReceipt(receipt, sha)).toEqual(receipt)
  })
  it('refuses a visible or wrong-commit target receipt', () => {
    expect(() => validateExternalCaptureReceipt({ ...receipt, launch: { ...receipt.launch, focusStealing: true } }, sha)).toThrow(/non-visible/)
    expect(() => validateExternalCaptureReceipt(receipt, 'b'.repeat(40))).toThrow(/does not match/)
  })
  it('binds the live attached CDP target to the receipt', () => {
    expect(() => validateAttachedTarget(receipt, { id: 'other', url: 'file:///expected', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/other' }, 9222)).toThrow(/does not match/)
  })
})
