import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '../shared/window-minimum'

/**
 * `src/main/index.ts` boots the real desktop shell, so it cannot be imported here — this scans it
 * instead. Every needle below is anchored to the start of a line for one specific reason: the
 * usual way a wiring line dies is somebody putting `//` in front of it while debugging, and a
 * plain `toContain('minWidth: MIN_WINDOW_WIDTH')` is satisfied by `// minWidth: MIN_WINDOW_WIDTH`.
 * `^\s*` permits indentation and nothing else, so a commented-out option fails.
 *
 * Read with line endings normalised because this checkout carries CRLF, and a `\n` needle matches
 * nothing against `\r\n` — which would leave the assertion passing on an empty search rather than
 * failing loudly.
 */
const read = (...parts: string[]) =>
  readFileSync(join(__dirname, ...parts), 'utf8').replace(/\r\n/g, '\n')

const MAIN = read('index.ts')
const CLIPPING = read('..', 'renderer', 'styles.clipping.css')

/** The narrow tier every other rule in the stylesheet family uses. */
const NARROW_TIER_MAX = 720

describe('the window declares the minimum its layout is verified at', () => {
  it('enforces both minimums on the real BrowserWindow, not just in a comment', () => {
    expect(MAIN).toMatch(/^\s*minWidth: MIN_WINDOW_WIDTH,$/m)
    expect(MAIN).toMatch(/^\s*minHeight: MIN_WINDOW_HEIGHT,$/m)
  })

  it('takes both values from the one shared constant so nothing can drift', () => {
    expect(MAIN).toMatch(
      /^import \{ MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH \} from '\.\.\/shared\/window-minimum'$/m
    )
    // A hardcoded literal beside the constant would let the window and the capture matrix
    // disagree about the floor while both looked correct.
    expect(MAIN).not.toMatch(/^\s*minWidth: \d+,$/m)
    expect(MAIN).not.toMatch(/^\s*minHeight: \d+,$/m)
  })

  it('keeps the minimum inside the narrow tier, so those rules actually render', () => {
    expect(MIN_WINDOW_WIDTH).toBeGreaterThan(0)
    expect(MIN_WINDOW_HEIGHT).toBeGreaterThan(0)
    // Above this the `max-width: 720px` block is unreachable: present, passing its own source
    // guard, and never rendered by any window the app permits.
    expect(MIN_WINDOW_WIDTH).toBeLessThanOrEqual(NARROW_TIER_MAX)
  })
})

describe('the narrow tier sits on one edge', () => {
  it('uses 720px as the narrow boundary everywhere in the clipping sweep', () => {
    // At exactly 720px the old pair overlapped: `max-width: 720px` and `min-width: 720px` both
    // applied, so the notification strip and sessions card went narrow while the app bar took
    // its mid-tier padding instead.
    expect(CLIPPING).not.toContain('719px')
    expect(CLIPPING).not.toContain('min-width: 720px')
  })

  it('starts the mid tier one pixel above the narrow tier', () => {
    expect(CLIPPING).toMatch(/@media \(min-width: 721px\) and \(max-width: 1279px\)/)
  })
})
