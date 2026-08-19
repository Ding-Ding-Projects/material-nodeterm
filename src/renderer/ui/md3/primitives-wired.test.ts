import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The MD3 primitive sheet must actually SHIP. It did not.
//
// `ui/md3/index.ts` imports `./primitives.css`, and its own comment promises "a consumer needs no
// separate CSS import to use these". But `ui/SegmentedPill.tsx` re-exports straight from
// `./md3/SegmentedButton` — a DEEP import that never touches the barrel — and Vite only bundles a
// stylesheet that some reachable module imports. Measured on the built artifact before the fix:
//
//     out/renderer/assets/boot-*.css   mdx-seg = 0   mdx-btn = 0
//
// All 105 rules were absent, so every segmented button, switch, chip, field and dialog in the app
// rendered on BROWSER DEFAULTS. It looked like a styling bug in each component; it was one missing
// import. Nothing failed — the build was green, the typecheck was green, and the only evidence was
// a settings screenshot where the language picker had white boxes instead of a selected pill.
//
// So the load-bearing assertion here is the FIRST one: the sheet is imported from the entry that
// always runs (`boot.tsx`), not only from a barrel a consumer may bypass.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(HERE, '..', '..')

const CSS = readFileSync(join(HERE, 'primitives.css'), 'utf8')
const BOOT = readFileSync(join(RENDERER, 'boot.tsx'), 'utf8')

/** Every `.tsx`/`.ts` under src/renderer, so the class sweep sees every consumer. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.test.')) acc.push(full)
  }
  return acc
}

/**
 * Does the sheet declare a rule for this exact class? Deliberately not a substring test: a bare
 * `.mdx-btn` needle is satisfied by `.mdx-btn-legacy`, and a bare `mdx-seg` is satisfied by a
 * comment mentioning it. The class must be followed by a character that ENDS the class name.
 */
function declaresClass(css: string, cls: string): boolean {
  const needle = '.' + cls
  let from = 0
  for (;;) {
    const at = css.indexOf(needle, from)
    if (at === -1) return false
    const rest = css.slice(at + needle.length)
    const next = rest[0] ?? ''
    // `{` rule opens · `,` selector list · space/newline · `:` pseudo · `.` compound.
    //
    // A BEM suffix counts only as the DOUBLED delimiter (`--` / `__`). Accepting a single `-` here
    // is not a nicety, it is the whole difference between a guard and a decoration: this test was
    // written with `-` allowed, and renaming every `.mdx-seg` rule to `.mdx-seg-RENAMED` left it
    // GREEN — the needle was satisfied by the rename that was supposed to break it.
    if (next === '' || '{, \n\r\t:.>+~['.includes(next)) return true
    if (rest.startsWith('--') || rest.startsWith('__')) return true
    from = at + needle.length
  }
}

describe('MD3 primitives are wired, not merely written', () => {
  it('boot.tsx imports primitives.css — the barrel alone is not enough', () => {
    // A deep import bypasses ui/md3/index.ts, and then none of the sheet ships. This is the exact
    // line whose absence produced an entirely unstyled primitive set on a green build.
    const imported = BOOT.split('\n').some((line) => {
      const t = line.trim()
      return t.startsWith('import ') && t.includes('ui/md3/primitives.css')
    })
    expect(imported, 'boot.tsx must import ./ui/md3/primitives.css').toBe(true)
  })

  it('every mdx-* class the components render has a rule in the sheet', () => {
    const used = new Set<string>()
    for (const file of sourceFiles(RENDERER)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/['"`]([^'"`]*\bmdx-[a-z0-9-]+)/g)) {
        for (const word of m[1].split(/\s+/)) {
          if (!word.startsWith('mdx-')) continue
          // Collapse BEM element/modifier onto its block: the block is what must be declared.
          used.add(word.split('__')[0].split('--')[0])
        }
      }
    }
    // A sweep that found nothing would pass vacuously — this file exists because that is exactly
    // the shape of failure that shipped.
    expect(used.size).toBeGreaterThanOrEqual(10)

    const missing = [...used].filter((cls) => !declaresClass(CSS, cls)).sort()
    expect(missing, 'primitive classes rendered with no CSS rule').toEqual([])
  })
})
