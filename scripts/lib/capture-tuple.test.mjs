import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

import {
  NORMAL_VIEWPORT,
  SUPPORTED_LANGUAGE_MODES,
  SUPPORTED_SCALES,
  SUPPORTED_THEMES,
  readWindowMinimum,
  resolveCaptureTuple,
  resolveScale,
  resolveViewport,
  tupleSettings
} from './capture-tuple.mjs'

/** Build a throwaway tree holding only the one source file the parser reads. */
const fixture = (body) => {
  const root = mkdtempSync(join(tmpdir(), 'nt-tuple-'))
  mkdirSync(join(root, 'src', 'shared'), { recursive: true })
  writeFileSync(join(root, 'src', 'shared', 'window-minimum.ts'), body, 'utf8')
  return root
}

describe('the minimum is read from source, never restated', () => {
  it('reads the real repository constants', () => {
    const min = readWindowMinimum()
    expect(min.width).toBeGreaterThan(0)
    expect(min.height).toBeGreaterThan(0)
  })

  it('parses a CRLF file, because this checkout is one', () => {
    const root = fixture('export const MIN_WINDOW_WIDTH = 800\r\nexport const MIN_WINDOW_HEIGHT = 600\r\n')
    expect(readWindowMinimum(root)).toEqual({ width: 800, height: 600 })
  })

  // The load-bearing half. A parser that fell back to a default on a missing constant would let a
  // capture claim a width the application never permits, which reads as evidence.
  it('throws rather than guessing when a constant is renamed away', () => {
    const root = fixture('export const MIN_WINDOW_WIDE = 640\nexport const MIN_WINDOW_HEIGHT = 540\n')
    expect(() => readWindowMinimum(root)).toThrow(/MIN_WINDOW_WIDTH not found/)
  })

  it('throws rather than guessing when a constant is missing entirely', () => {
    const root = fixture('export const MIN_WINDOW_WIDTH = 640\n')
    expect(() => readWindowMinimum(root)).toThrow(/MIN_WINDOW_HEIGHT not found/)
  })

  it('refuses a commented-out declaration', () => {
    const root = fixture(
      '// export const MIN_WINDOW_WIDTH = 640\nexport const MIN_WINDOW_HEIGHT = 540\n'
    )
    expect(() => readWindowMinimum(root)).toThrow(/not found at a line start/)
  })

  it('refuses a non-numeric value', () => {
    const root = fixture(
      'export const MIN_WINDOW_WIDTH = wide\nexport const MIN_WINDOW_HEIGHT = 540\n'
    )
    expect(() => readWindowMinimum(root)).toThrow(/MIN_WINDOW_WIDTH not found/)
  })
})

describe('the viewport axis', () => {
  it('defaults to the comfortable viewport the harness used to be pinned to', () => {
    expect(resolveViewport(undefined)).toMatchObject({ ...NORMAL_VIEWPORT, name: 'normal' })
  })

  it('resolves "min" from the declared minimum rather than a literal', () => {
    const root = fixture('export const MIN_WINDOW_WIDTH = 700\nexport const MIN_WINDOW_HEIGHT = 500\n')
    expect(resolveViewport('min', root)).toEqual({ width: 700, height: 500, name: 'min' })
  })

  it('accepts an explicit WxH', () => {
    expect(resolveViewport('1024x768')).toEqual({ width: 1024, height: 768, name: '1024x768' })
  })

  it('refuses a value it cannot interpret instead of falling back', () => {
    expect(() => resolveViewport('narrow')).toThrow(/expects "min", "normal", or WxH/)
  })
})

describe('the scale axis', () => {
  it.each(SUPPORTED_SCALES)('accepts %s', (scale) => {
    expect(resolveScale(scale)).toBe(scale)
  })

  it('refuses a scale the contract does not name', () => {
    expect(() => resolveScale(1.75)).toThrow(/expects one of/)
  })
})

describe('the whole tuple', () => {
  it('labels every axis, so two tuples cannot share one output path', () => {
    const worst = resolveCaptureTuple({ viewport: 'min', scale: 2, theme: 'light', lang: 'bilingual' })
    const normal = resolveCaptureTuple({})
    expect(worst.label).not.toBe(normal.label)
    expect(worst.label).toContain('s2')
    expect(worst.label).toContain('light')
    expect(worst.label).toContain('bilingual')
    // A dot in a directory name is a filename hazard; the label keeps the scale readable instead.
    expect(resolveCaptureTuple({ scale: 1.25 }).label).toContain('s1_25')
  })

  it('refuses an unknown theme or language rather than defaulting quietly', () => {
    expect(() => resolveCaptureTuple({ theme: 'sepia' })).toThrow(/--theme expects one of/)
    expect(() => resolveCaptureTuple({ lang: 'pirate' })).toThrow(/--lang expects one of/)
  })

  it('writes the settings keys the application actually reads', () => {
    // `appTheme` and `languageMode` are the real fields in src/shared/types.ts. A key nobody reads
    // would persist perfectly and change nothing, leaving the axis inert while captures looked fine.
    const settings = tupleSettings(resolveCaptureTuple({ theme: 'light', lang: 'yue' }))
    expect(settings).toEqual({ languageMode: 'yue', appTheme: 'light' })
    expect(SUPPORTED_THEMES).toContain(settings.appTheme)
    expect(SUPPORTED_LANGUAGE_MODES).toContain(settings.languageMode)
  })
})

describe('the settings keys have not drifted from the application', () => {
  it('finds both fields declared in src/shared/types.ts', () => {
    // Asserting the literal string in this file only proves this file is self-consistent. If the
    // real field were renamed, the harness would keep writing a key nobody reads and every capture
    // in the theme or language axis would silently show the default. This is the drift guard.
    const types = readFileSync(join(REPO_ROOT, 'src', 'shared', 'types.ts'), 'utf8')
    const settings = tupleSettings(resolveCaptureTuple({}))
    for (const key of Object.keys(settings)) {
      expect(types).toContain(`${key}: `)
    }
  })
})
