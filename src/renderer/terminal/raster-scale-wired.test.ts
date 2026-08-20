import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE WIRING ITSELF, not the rules it applies.
//
// An independent review of this lane returned FAIL for one reason: deleting the call that installs
// the raster patch left all 3,294 renderer tests green. Every other test here covers the pure rules
// — the scale arithmetic, the cell-stability constraint, the renderer gate — and not one of them
// notices if `patchTerminalRasterScale` simply stops being called. That is this repository's
// recurring defect in its purest form: a feature wired at one end, with nothing asserting it stays
// wired, shipping green and doing nothing.
//
// The chain that has to hold, end to end:
//
//     TerminalNode / ModalTerminal / TerminalPreview
//       → quantizeCharSize(term)            (the one entry point all three already call)
//         → patchTerminalRasterScale(term)  (the SCALE half)
//
// Break any link and terminals render at the wrong raster density with no test complaining, which
// is exactly the state this file was written to end.
//
// NEEDLE SHAPE — the lesson this repo has now paid for several times over. Every needle below is
// LINE-ANCHORED. A bare substring is satisfied by a rename (`patchTerminalRasterScaleX`) and, worse,
// by the very line that COMMENTS THE CALL OUT — which is how a wiring guard ends up green over
// dead code. It is also why the import alone is not enough evidence: an unused import is still an
// import.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const TERMINAL_DIR = join(process.cwd(), 'src', 'renderer', 'terminal')
const RENDERER_DIR = join(process.cwd(), 'src', 'renderer')

const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** Every surface that must reach the patch, and the file that proves it does. */
const TERMINAL_SURFACES = [
  { what: 'the canvas terminal node', file: join(RENDERER_DIR, 'nodes', 'TerminalNode.tsx') },
  { what: 'the kanban card modal', file: join(RENDERER_DIR, 'components', 'kanban', 'ModalTerminal.tsx') },
  { what: 'the settings preview', file: join(RENDERER_DIR, 'components', 'settings', 'TerminalPreview.tsx') }
]

describe('the raster patch is actually installed, not merely written', () => {
  it('char-size-quantize CALLS patchTerminalRasterScale — not just imports it', () => {
    const src = read(join(TERMINAL_DIR, 'char-size-quantize.ts'))

    // The call, at the start of a line, with its opening paren. `^\s*` refuses a commented-out
    // line, because `//` would sit between the line start and the identifier.
    expect(src).toMatch(/^\s*patchTerminalRasterScale\(/m)

    // An import with no call site is the failure mode this test exists for, so prove the call is
    // not the import line being counted twice.
    const callLines = src
      .split('\n')
      .filter((l) => /^\s*patchTerminalRasterScale\(/.test(l))
    expect(callLines.length).toBeGreaterThanOrEqual(1)
    expect(callLines.every((l) => !l.trimStart().startsWith('import'))) .toBe(true)
  })

  it('every terminal surface reaches it through quantizeCharSize', () => {
    // Guarding only char-size-quantize would leave the chain breakable one level up: if a surface
    // stopped calling quantizeCharSize, the patch would be installed for nobody while the test
    // above stayed green.
    for (const { what, file } of TERMINAL_SURFACES) {
      const src = read(file)
      expect(src, `${what} must call quantizeCharSize`).toMatch(/^\s*quantizeCharSize\(/m)
    }
  })

  it('the surface list is not silently empty', () => {
    // A sweep over an empty list passes while proving nothing — the vacuous pass this repo has
    // shipped before. If a surface is ever removed, this figure must be lowered DELIBERATELY.
    expect(TERMINAL_SURFACES.length).toBe(3)
    for (const { file } of TERMINAL_SURFACES) {
      expect(read(file).length).toBeGreaterThan(500)
    }
  })

  it('the renderer gate is still consulted at the point the scale is applied', () => {
    // 8d8ca272 was pushed without this gate, and under the shared glyphgrid renderer the patch is
    // actively wrong — SharedGlyphLayer sizes its atlas from the device cell computed from this
    // dpr while drawing quads from the css cell, so inflating one side produces the stretched-slot
    // mismatch it warns about by name. Losing the gate again must be red, not quiet.
    const src = read(join(TERMINAL_DIR, 'raster-scale.ts'))
    expect(src).toMatch(/^\s*if \(!isWebglEnabled\(\)\) return dpr/m)
  })
})
