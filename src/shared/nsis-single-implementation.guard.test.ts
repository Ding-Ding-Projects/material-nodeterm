// Guard: there must be exactly ONE thing that emits raw NSIS (.nsi) script directives in this
// repo. Two lanes independently built one each -- `src/core/nsis` and `src/shared/nsis-render.ts`
// -- and nothing caught it until a human noticed. This test is the mechanical check that class of
// drift can't happen again silently: any file outside the canonical `src/shared/nsis/` module that
// starts emitting raw NSIS directive text (`OutFile`, `SetOutPath`, `WriteUninstaller`, an
// `nsisQuote`-shaped helper, ...) should fail this test, not slip in as a second renderer.
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CANONICAL_DIR = path.join('src', 'shared', 'nsis')

// A generous but real signal: lines that look like NSIS directive text being built/emitted
// directly, rather than going through the canonical renderer. Deliberately over-matches a little
// (comments, strings describing NSIS) -- the point is a human reviews any new hit, not that the
// regex is a perfect parser.
const NSIS_DIRECTIVE_SIGNAL = /\b(OutFile|SetOutPath|WriteUninstaller|VIProductVersion|RequestExecutionLevel)\s+["$]/

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listTsFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('exactly one NSIS renderer', () => {
  it('finds the canonical directive-emitting source inside src/shared/nsis/', () => {
    const rendererPath = path.join(REPO_ROOT, CANONICAL_DIR, 'render.ts')
    const contents = fs.readFileSync(rendererPath, 'utf8')
    expect(NSIS_DIRECTIVE_SIGNAL.test(contents)).toBe(true)
  })

  it('no other source file under src/ builds raw NSIS directive text itself', () => {
    const offenders: string[] = []
    for (const dir of ['src/main', 'src/core', 'src/shared', 'src/renderer', 'src/server']) {
      const abs = path.join(REPO_ROOT, dir)
      if (!fs.existsSync(abs)) continue
      for (const file of listTsFiles(abs)) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/')
        if (rel.startsWith('src/shared/nsis/')) continue // the canonical module itself
        if (rel === 'src/core/nsis/spec.ts' || rel === 'src/core/nsis/escape.ts' || rel === 'src/core/nsis/render.ts') {
          continue // re-export shims -- see src/core/nsis/spec.ts for why they exist
        }
        const contents = fs.readFileSync(file, 'utf8')
        if (NSIS_DIRECTIVE_SIGNAL.test(contents)) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })
})
