import { describe, expect, it } from 'vitest'
import { resolveTerminalRenderer } from './webgl'

// The renderer mode is the one thing every terminal on the canvas reads, and its DEFAULT ('auto')
// resolution is what every user who never touched the setting is on — so each answer below is
// pinned, and moving one is a deliberate act with device evidence behind it (see webgl.ts).
describe('resolveTerminalRenderer', () => {
  it("'auto' is the DOM renderer on macOS — stable sharpness without compositor pressure", () => {
    // Shared contradicted text-parity evidence on 2026-08-10: drag switched to xterm-sharp,
    // drop switched back to Shared-soft. Keep Shared explicit rather than changing on gesture.
    expect(resolveTerminalRenderer('auto', true)).toBe('dom')
  })

  it("'auto' is unchanged off macOS — per-terminal WebGL", () => {
    // Deliberately NOT promoted: the failure this answers is a macOS compositor failure, and
    // Linux/Windows have been on per-terminal WebGL all along with no such reports.
    expect(resolveTerminalRenderer('auto', false)).toBe('webgl')
  })

  it('an explicit choice still wins over the platform — the escape hatch survives', () => {
    expect(resolveTerminalRenderer('off', true)).toBe('dom')
    expect(resolveTerminalRenderer('on', true)).toBe('webgl')
    expect(resolveTerminalRenderer('shared', false)).toBe('shared')
  })

  it("'on' is per-terminal WebGL on every platform (a deliberate opt-in on macOS)", () => {
    expect(resolveTerminalRenderer('on', true)).toBe('webgl')
    expect(resolveTerminalRenderer('on', false)).toBe('webgl')
  })

  it("'off' is the DOM renderer on every platform", () => {
    expect(resolveTerminalRenderer('off', true)).toBe('dom')
    expect(resolveTerminalRenderer('off', false)).toBe('dom')
  })

  it("'shared' is the shared canvas on every platform — it is the escape from the context cap", () => {
    // Platform-independent by design: the whole point of one context for the whole canvas is that
    // the per-terminal context pressure (the macOS failure mode) does not exist.
    expect(resolveTerminalRenderer('shared', true)).toBe('shared')
    expect(resolveTerminalRenderer('shared', false)).toBe('shared')
  })

  it('resolves legacy booleans and garbage the way the migration would', () => {
    // Settings arrive from a hand-editable JSON file and the store migrates them — but the
    // resolver is also called with whatever is in memory, so an unknown value must land on the
    // DEFAULT, i.e. exactly what 'auto' answers on that platform. A legacy BOOLEAN is not
    // unknown: it is the old two-way setting and still means its own explicit choice.
    expect(resolveTerminalRenderer(true, false)).toBe('webgl')
    expect(resolveTerminalRenderer(true, true)).toBe('webgl')
    expect(resolveTerminalRenderer(false, false)).toBe('dom')
    expect(resolveTerminalRenderer(false, true)).toBe('dom')
    expect(resolveTerminalRenderer(undefined, true)).toBe('dom')
    expect(resolveTerminalRenderer(undefined, false)).toBe('webgl')
    expect(resolveTerminalRenderer('warp-speed' as 'auto', true)).toBe('dom')
    expect(resolveTerminalRenderer('warp-speed' as 'auto', false)).toBe('webgl')
  })
})
