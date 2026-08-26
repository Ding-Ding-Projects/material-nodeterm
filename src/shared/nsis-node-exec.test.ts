import { describe, expect, it } from 'vitest'
import type { CanvasNodeState } from './types'
import {
  applyLocalNodeExec,
  carryLocalNodeExec,
  localNodeExec,
  safeNsisLocalPaths,
  sanitizeInboundNode,
  stripSharedNodeExec
} from './node-exec'

/**
 * The `nsisLocalPaths` trust boundary, mirroring `node-exec.test.ts`'s coverage of
 * `serviceConnection` exactly — same shape, same reasoning: an absolute path is one person's
 * disk, and it must never survive a trip through a shared project file or an inbound peer
 * mutation.
 */

const node = (over: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id: 'nsis-abc',
  kind: 'nsis',
  position: { x: 0, y: 0 },
  size: { width: 460, height: 520 },
  title: 'Installer builder',
  color: '#fff',
  group: null,
  ...over
})

describe('safeNsisLocalPaths', () => {
  it('accepts a well-formed record', () => {
    const value = safeNsisLocalPaths({
      sourcePaths: ['C:\\build\\out'],
      licensePath: 'C:\\src\\LICENSE.txt',
      iconPath: 'C:\\src\\app.ico'
    })
    expect(value).toEqual({
      sourcePaths: ['C:\\build\\out'],
      licensePath: 'C:\\src\\LICENSE.txt',
      iconPath: 'C:\\src\\app.ico'
    })
  })

  it('degrades tolerantly rather than throwing on hostile/malformed input', () => {
    expect(safeNsisLocalPaths(undefined)).toBeUndefined()
    expect(safeNsisLocalPaths(null)).toBeUndefined()
    expect(safeNsisLocalPaths('C:\\evil')).toBeUndefined()
    expect(safeNsisLocalPaths({})).toBeUndefined()
    // Non-array sourcePaths degrades to empty rather than throwing.
    expect(safeNsisLocalPaths({ sourcePaths: 'C:\\not-an-array' })).toBeUndefined()
    // A control character (e.g. a smuggled newline) drops that one path rather than the record.
    const withControlChar = safeNsisLocalPaths({ sourcePaths: ['C:\\ok', 'C:\\bad\nline'] })
    expect(withControlChar).toEqual({ sourcePaths: ['C:\\ok'] })
    // Non-string license/icon paths are dropped, not coerced.
    const withBadOptional = safeNsisLocalPaths({ sourcePaths: ['C:\\ok'], licensePath: 42 })
    expect(withBadOptional).toEqual({ sourcePaths: ['C:\\ok'] })
  })

  it('bounds the number of source paths so a hostile index cannot bloat the store', () => {
    const many = Array.from({ length: 1000 }, (_, i) => `C:\\p${i}`)
    const value = safeNsisLocalPaths({ sourcePaths: many })
    expect(value?.sourcePaths.length).toBe(512)
  })
})

describe('nsisLocalPaths trust boundary', () => {
  const local = {
    sourcePaths: ['C:\\build\\out\\App'],
    licensePath: 'C:\\src\\LICENSE.txt',
    iconPath: 'C:\\src\\app.ico'
  }

  it('is stripped from a node about to be written into the shared project file', () => {
    const n = node({ nsisLocalPaths: local })
    const [stripped] = stripSharedNodeExec([n])
    expect(stripped.nsisLocalPaths).toBeUndefined()
    // Round-trips it out into the machine-local index instead.
    const map = localNodeExec([n])
    expect(map?.['nsis-abc']?.nsisLocalPaths).toEqual(local)
  })

  it('is stripped from a node arriving over the wire (peer mutation / relay)', () => {
    const inbound = node({ nsisLocalPaths: local })
    const clean = sanitizeInboundNode(inbound)
    expect(clean.nsisLocalPaths).toBeUndefined()
  })

  it('re-attaches from the machine-local index on load, never from the file', () => {
    const fromFile = node({ nsisLocalPaths: { sourcePaths: ['C:\\someone-elses-disk'] } })
    const restored = applyLocalNodeExec([fromFile], {
      'nsis-abc': { nsisLocalPaths: local }
    })
    expect(restored[0].nsisLocalPaths).toEqual(local)
  })

  it('a hostile machine-local index entry degrades to safe defaults on restore, not a throw', () => {
    const fromFile = node()
    const restored = applyLocalNodeExec([fromFile], {
      // @ts-expect-error — deliberately malformed, as a hand-edited workspace.json would be
      'nsis-abc': { nsisLocalPaths: { sourcePaths: 'not-an-array' } }
    })
    expect(restored[0].nsisLocalPaths).toBeUndefined()
  })

  it('survives a peer upsert overwriting the node (carryLocalNodeExec)', () => {
    const prev = node({ nsisLocalPaths: local })
    const next = node({ title: 'renamed by a teammate' })
    const merged = carryLocalNodeExec(prev, next)
    expect(merged.nsisLocalPaths).toEqual(local)
    expect(merged.title).toBe('renamed by a teammate')
  })

  it('the shared nsisSpec field is untouched by any of this — it travels with the document', () => {
    const spec = {
      appName: 'Acme',
      version: '1.0.0',
      publisher: '',
      outputFileName: '',
      installRoot: 'per-user-program-files' as const,
      compression: 'lzma' as const,
      perMachine: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      includeUninstaller: true
    }
    const n = node({ nsisSpec: spec, nsisLocalPaths: local })
    const [stripped] = stripSharedNodeExec([n])
    expect(stripped.nsisSpec).toEqual(spec)
    const clean = sanitizeInboundNode(n)
    expect(clean.nsisSpec).toEqual(spec)
  })
})
