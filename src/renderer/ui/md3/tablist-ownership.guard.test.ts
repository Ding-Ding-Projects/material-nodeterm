import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One component owns the ARIA tabs contract.
 *
 * `role="tab"` is a promise: a screen reader announces the control as a tab, and the APG pattern
 * says arrow keys traverse the set, Home/End jump to its ends, and exactly one tab is in the tab
 * order at a time. A hand-rolled strip that renders the role and wires only `onClick` keeps the
 * announcement and drops the behaviour, so a keyboard user is told these are tabs and then finds
 * they cannot move between them. `Tabs.tsx` implements the whole contract once; this refuses a
 * second implementation of it.
 *
 * Deliberately a scan and not a rule about the files it happens to find: it walks every renderer
 * source file and fails on any occurrence outside the allowlist, so a NEW hand-rolled strip is
 * caught by the guard existing rather than by somebody remembering to add it to a list.
 */

const RENDERER = join(__dirname, '..', '..')

/**
 * The one legitimate owner. Anything else added here needs the full contract -- roving tabIndex,
 * aria-orientation, and Arrow/Home/End -- and a test proving the keys actually move focus.
 */
const ALLOWED = new Set([
  // Renders a whole tab strip, and owns the contract end to end.
  join('ui', 'md3', 'Tabs.tsx'),
  // Wraps an existing chip/segmented strip, and gets the contract from useTablistKeys.
  join('ui', 'md3', 'Tablist.tsx')
])

const SKIP_DIRS = new Set(['node_modules', '__snapshots__'])

function sourceFiles(dir: string, rel = ''): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    const next = join(rel, entry)
    if (statSync(abs).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) found.push(...sourceFiles(abs, next))
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue
    if (/\.test\.tsx?$/.test(entry)) continue
    found.push(next)
  }
  return found
}

/** Strip comments so a `role="tablist"` inside an explanatory block does not read as markup. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
}

describe('the ARIA tabs contract has exactly one implementation', () => {
  const offenders = sourceFiles(RENDERER)
    .filter((file) => !ALLOWED.has(file))
    .filter((file) => {
      const source = withoutComments(readFileSync(join(RENDERER, file), 'utf8'))
      return source.includes('role="tablist"') || source.includes("role: 'tablist'")
    })

  it('has no hand-rolled tab strip outside Tabs.tsx', () => {
    expect(offenders).toEqual([])
  })

  it('still finds the owner, so an empty result cannot mean the scan is broken', () => {
    // A scan that silently matched nothing would report clean forever. This proves the needle
    // works by requiring it to hit the one file that legitimately declares the role.
    const owner = readFileSync(join(RENDERER, 'ui', 'md3', 'Tabs.tsx'), 'utf8')
    expect(owner).toContain('role="tablist"')
    expect(sourceFiles(RENDERER).length).toBeGreaterThan(100)
  })
})
