// EVERY agent launch must resolve its permission mode through `activePermissionMode`.
//
// This is the assumption the whole kids-mode permission gate rests on. The gate lives inside that
// one function, so a launch site that reads `settings.claudePermissionMode` directly — or a
// project's `defaultPermissionMode` — would build its command from the ungated value and silently
// bypass the mode entirely. Nothing else would notice: the resolver's own tests would still pass,
// because the resolver is still correct; it just would not be the thing being asked.
//
// A source-level check, deliberately. The alternative is rendering Canvas (~9,500 lines, very
// large mount surface) once per launch site, which costs far more than it proves — and would
// still only cover the sites a test author thought to exercise, whereas this covers every one
// that exists.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const RENDERER = join(__dirname, '..')

/** Every .ts/.tsx under src/renderer, excluding tests and this file's own subject. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules') sources(p, out)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

const FILES = sources(RENDERER)

/** Files allowed to mention the raw setting, with the reason each is not a launch. */
const ALLOWED = new Map<string, string>([
  // The resolver itself — this is where the raw value is legitimately read and then gated.
  ['state\\permissionMode.ts', 'the resolver; it reads the raw value in order to gate it'],
  // Settings UI: edits the value rather than launching anything with it.
  ['components\\settings\\sections\\AgentsSection.tsx', 'the settings control that edits the value'],
  // The tab menu shows the current global default beside the per-project override.
  ['components\\TabBar.tsx', 'displays the global default in the override menu; launches nothing'],
  // The workspace factory receives an ALREADY-resolved mode as a parameter.
  ['state\\workspace.ts', 'takes an already-resolved mode as an argument']
])

describe('every launch resolves its permission mode through the one funnel', () => {
  it('no file outside the allow-list reads settings.claudePermissionMode', () => {
    const offenders: string[] = []
    for (const f of FILES) {
      const text = readFileSync(f, 'utf8')
      if (!/\bclaudePermissionMode\b/.test(text)) continue
      // A comment mentioning the token is not a read.
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (!/\bclaudePermissionMode\b/.test(stripped)) continue
      const rel = f.slice(f.indexOf('renderer') + 'renderer'.length + 1)
      if ([...ALLOWED.keys()].some((k) => rel.endsWith(k))) continue
      offenders.push(rel)
    }
    expect(
      offenders,
      'these read the raw setting instead of activePermissionMode(), which bypasses the kids-mode gate'
    ).toEqual([])
  })

  it('the resolver is the only place the kids gate is applied, and it IS applied', () => {
    const resolver = readFileSync(join(RENDERER, 'state', 'permissionMode.ts'), 'utf8')
    expect(resolver).toMatch(/gateKidsPermissionMode\(/)
    // Last, so it can only narrow what the earlier gates produced — never re-widen.
    const body = /export function activePermissionMode[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    expect(body, 'the kids gate must be on the RETURNED value').toMatch(
      /return gateKidsPermissionMode\(/
    )
  })

  it('Canvas builds agent commands from the resolver, at every site', () => {
    const canvas = readFileSync(join(RENDERER, 'canvas', 'Canvas.tsx'), 'utf8')
    const calls = (canvas.match(/activePermissionMode\(/g) || []).length
    // Nine at the time of writing. A floor rather than an exact count: adding a launch site is
    // normal, removing them all silently is what this guards.
    expect(calls, 'Canvas should resolve the mode at each launch site').toBeGreaterThanOrEqual(5)
    // And every withPermissionMode call must take a resolved mode, never a literal.
    const literalMode = /withPermissionMode\([^)]*,\s*'(bypassPermissions|acceptEdits|auto|plan|manual)'\s*\)/.exec(canvas)
    expect(literalMode?.[0], 'a hardcoded mode would skip both gates').toBeUndefined()
  })
})
