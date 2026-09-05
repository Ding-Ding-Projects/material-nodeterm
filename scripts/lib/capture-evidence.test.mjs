import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { captureIsCurrent, inspectPng, mergeCaptureManifest, validateExternalCaptureReceipt } from './capture-evidence.mjs'

function png(width = 2, height = 2) {
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); return out }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.alloc(1 + width * 4)))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

describe('capture evidence PNG inspection', () => {
  it('decodes CDP-compatible PNG dimensions and a content hash', () => {
    expect(inspectPng(png(3, 4))).toMatchObject({ width: 3, height: 4, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })
  it('refuses a truncated raster instead of trusting its extension', () => {
    expect(() => inspectPng(png().subarray(0, -3))).toThrow(/required raster chunks|truncated/)
  })
})

describe('versioned per-entry capture provenance', () => {
  const tuple = { label: '1600x1000-s1-dark-en' }
  const old = { commit: 'old', method: 'old route', capturedAt: 'yesterday', captured: [{ id: 'canvas', bytes: 8 }] }
  const update = { id: 'settings', bytes: 9, capturedAt: 'today', tuple, provenance: { commit: 'next', version: '1.2.3', method: 'new route', receipt: null } }
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
  const receipt = { schemaVersion: 1, route: 'cheap Lowlevel MCP headless', source: { gitHead: sha }, launch: { ok: true, focusStealing: false, terminalWindow: false, desktop: 'capture-desktop' } }
  it('accepts an externally launched canonical target only with its matching receipt', () => {
    expect(validateExternalCaptureReceipt(receipt, sha)).toEqual(receipt)
  })
  it('refuses a visible or wrong-commit target receipt', () => {
    expect(() => validateExternalCaptureReceipt({ ...receipt, launch: { ...receipt.launch, focusStealing: true } }, sha)).toThrow(/non-visible/)
    expect(() => validateExternalCaptureReceipt(receipt, 'b'.repeat(40))).toThrow(/does not match/)
  })
})
