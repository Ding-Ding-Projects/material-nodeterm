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
//
// This is NOT control-flow analysis. A raw read in dead code is still refused (fail closed), while
// a resolver call hidden in dead code could still contribute to the Canvas call-count floor. The
// behavioral tests in permissionMode.kids.test.ts prove that the resolver itself narrows a live
// bypass/accept-edits setting; this scan's narrower promise is that no source file can read around
// that resolver without appearing as a new, reviewable exception.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

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

/**
 * Files allowed to mention the raw setting, with the reason each is not a launch.
 *
 * Keys are renderer-relative POSIX paths even on Windows. Keeping one canonical spelling makes
 * the comparison portable; exact membership prevents `nested/components/TabBar.tsx` from
 * inheriting TabBar's exception merely because its path has the same suffix.
 */
const ALLOWED = new Map<string, string>([
  // Settings UI: edits the value rather than launching anything with it.
  ['components/settings/sections/AgentsSection.tsx', 'the settings control that edits the value'],
  // The tab menu shows the current global default beside the per-project override.
  ['components/TabBar.tsx', 'displays the global default in the override menu; launches nothing']
])

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function rendererRelativePath(file: string): string {
  return normalizeRelativePath(relative(RENDERER, file))
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readsRawPermissionMode(source: string): boolean {
  return /\bclaudePermissionMode\b/.test(withoutComments(source))
}

function isAllowedRawConsumer(path: string): boolean {
  return ALLOWED.has(normalizeRelativePath(path))
}

function rawConsumers(files: string[]): string[] {
  return files
    .filter((file) => readsRawPermissionMode(readFileSync(file, 'utf8')))
    .map(rendererRelativePath)
}

describe('every launch resolves its permission mode through the one funnel', () => {
  it('no file outside the allow-list reads settings.claudePermissionMode', () => {
    const offenders = rawConsumers(FILES).filter((path) => !isAllowedRawConsumer(path))
    expect(
      offenders,
      'these read the raw setting instead of activePermissionMode(), which bypasses the kids-mode gate'
    ).toEqual([])
  })

  it('keeps every allow-list entry live and justified', () => {
    const consumers = new Set(rawConsumers(FILES))
    expect(
      [...ALLOWED.keys()].filter((path) => !consumers.has(path)),
      'a stale exception can silently excuse a future unrelated file at that path'
    ).toEqual([])
  })

  it('normalizes slash dialects but does not suffix-match a lookalike path', () => {
    expect(isAllowedRawConsumer('components/TabBar.tsx')).toBe(true)
    expect(isAllowedRawConsumer('components\\TabBar.tsx')).toBe(true)
    expect(isAllowedRawConsumer('nested/components/TabBar.tsx')).toBe(false)
    expect(isAllowedRawConsumer('components/TabBar.tsx.backup')).toBe(false)
  })

  it('ignores comments but fails closed on a raw read even in obvious dead code', () => {
    expect(readsRawPermissionMode('// settings.claudePermissionMode')).toBe(false)
    expect(readsRawPermissionMode('/* settings.claudePermissionMode */')).toBe(false)
    expect(
      readsRawPermissionMode(
        'const endpoint = "https://example.invalid" // settings.claudePermissionMode'
      )
    ).toBe(false)
    expect(readsRawPermissionMode('if (false) settings.claudePermissionMode')).toBe(true)
  })

  it('the resolver is the only place the kids gate is applied, and it IS applied', () => {
    const resolver = withoutComments(
      readFileSync(join(RENDERER, 'state', 'permissionMode.ts'), 'utf8')
    )
    expect(resolver).toMatch(/gateKidsPermissionMode\(/)
    // Last, so it can only narrow what the earlier gates produced — never re-widen.
    const body = /export function activePermissionMode[\s\S]*?\n}/.exec(resolver)?.[0] ?? ''
    expect(body, 'the kids gate must be on the RETURNED value').toMatch(
      /return gateKidsPermissionMode\(/
    )
  })

  it('Canvas builds agent commands from the resolver, at every site', () => {
    const canvas = withoutComments(readFileSync(join(RENDERER, 'canvas', 'Canvas.tsx'), 'utf8'))
    const calls = (canvas.match(/activePermissionMode\(/g) || []).length
    // Nine at the time of writing. A floor rather than an exact count: adding a launch site is
    // normal, removing them all silently is what this guards.
    expect(calls, 'Canvas should resolve the mode at each launch site').toBeGreaterThanOrEqual(5)
    // And every withPermissionMode call must take a resolved mode, never a literal.
    const literalMode =
      /withPermissionMode\([^)]*,\s*'(bypassPermissions|acceptEdits|auto|plan|manual)'\s*\)/.exec(
        canvas
      )
    expect(literalMode?.[0], 'a hardcoded mode would skip both gates').toBeUndefined()
  })
})
