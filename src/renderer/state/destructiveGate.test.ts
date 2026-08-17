// The destructive gate is reachable from every surface, and every GuardedAction reaches it.
//
// The second half is the one that matters. A security review found three of the six actions the
// policy names — discard-changes, remove-worktree, revoke-device — going through a plain confirm
// or no dialog at all, while the docs table claimed otherwise. Nothing failed: the policy was
// correct, `requiresDestructiveGate` was correct, and the actions simply never called it. A test
// per wired action would have gone on passing, because the ones nobody wired had no test to fail.
//
// So the coverage check below is inverted: it starts from the POLICY's list of actions and
// demands that each one appears in a source file, rather than starting from what happens to be
// wired. A new GuardedAction is unguarded until someone wires it, and this goes red until they do.

import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { useDestructiveGate, openDestructiveGate } from './destructiveGate'

const RENDERER = join(__dirname, '..')

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
const ALL_SOURCE = FILES.map((f) => readFileSync(f, 'utf8')).join('\n')

/** The policy's own list, read from source so it cannot drift from a copy kept here.
 *
 *  Line endings are normalised first, and that is not housekeeping. This regex ends the union at a
 *  blank line; written as `\n\n` it does not match `\r\n\r\n`, so on a CRLF checkout it returned
 *  NOTHING — and `it.each([])` generates no tests at all, so the entire coverage check below
 *  silently disappeared rather than failing. It was caught only by the count assertion in the
 *  first test, which exists for precisely this. A guard that can quietly stop guarding is the
 *  failure this whole file was written about. */
function guardedActions(): string[] {
  const policy = readFileSync(join(__dirname, '..', '..', 'shared', 'kids-mode-policy.ts'), 'utf8')
  const block = /export type GuardedAction =([\s\S]*?)\n\s*\n/.exec(policy.replace(/\r\n/g, '\n'))?.[1] ?? ''
  return [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
}

describe('the gate is reachable from anywhere', () => {
  beforeEach(() => useDestructiveGate.setState({ request: null }))

  it('opens', () => {
    expect(openDestructiveGate({ title: 't', description: 'd', onConfirm: () => {} })).toBe(true)
    expect(useDestructiveGate.getState().request?.title).toBe('t')
  })

  it('REFUSES a second gate while one is open, rather than stacking or replacing', () => {
    // Two sliders for two different irreversible actions, with nothing on screen saying which key
    // belongs to which. Replacing the first would be worse still: the user finishes a slider that
    // now belongs to an action they never saw.
    const first = { title: 'first', description: 'd', onConfirm: () => {} }
    openDestructiveGate(first)
    expect(openDestructiveGate({ title: 'second', description: 'd', onConfirm: () => {} })).toBe(
      false
    )
    expect(useDestructiveGate.getState().request?.title).toBe('first')
  })

  it('a refused open reports it, so the caller does not report a delete that never ran', () => {
    openDestructiveGate({ title: 'first', description: 'd', onConfirm: () => {} })
    const accepted = openDestructiveGate({ title: 'x', description: 'd', onConfirm: () => {} })
    expect(accepted).toBe(false)
  })

  it('closes back to empty, so the next action is not refused forever', () => {
    openDestructiveGate({ title: 't', description: 'd', onConfirm: () => {} })
    useDestructiveGate.getState().close()
    expect(useDestructiveGate.getState().request).toBeNull()
    expect(openDestructiveGate({ title: 'next', description: 'd', onConfirm: () => {} })).toBe(true)
  })
})

describe('every GuardedAction is actually wired to something', () => {
  it('the policy names at least the six actions with real destructive surfaces', () => {
    // If this shrinks, the coverage test below silently checks less. The union once carried
    // `clear-history` and nothing in the app clears history — see the comment on GuardedAction.
    // `remove-account` is the sixth only because its credential/session transaction is now real
    // and gated. A safety list naming a nonexistent protection reads as coverage to a reviewer.
    expect(guardedActions().length).toBeGreaterThanOrEqual(6)
  })

  // An action can be satisfied two ways, and the second is STRONGER than the policy asks for:
  //   - consult the policy, so the gate appears under kids mode and a plain confirm otherwise;
  //   - always gate, for something irreversible enough that the mode should not be what decides.
  // Each unconditional entry names its site and a needle proving the gate is opened there with no
  // condition around it, so this is checkable evidence rather than an exemption someone typed.
  const ALWAYS_GATED: Record<string, { file: string; needle: RegExp; why: string }> = {
    'delete-project': {
      file: 'canvas/Canvas.tsx',
      needle: /const requestDeleteProject = useCallback\([\s\S]{0,400}?openDestructiveGate\(\{/,
      why: 'ends every terminal in the project including running work, so it is gated for everyone rather than only under kids mode'
    }
  }

  it.each(guardedActions())('%s reaches the gate at a real call site', (action) => {
    // The needle is the CALL with this action as its argument — not a bare mention, which a docs
    // comment or a type union would satisfy. Commenting the line out fails this.
    const consulted = new RegExp(`requiresDestructiveGate\\(\\s*'${action}'`).test(ALL_SOURCE)
    const always = ALWAYS_GATED[action]
    if (always && !consulted) {
      const src = readFileSync(join(RENDERER, ...always.file.split('/')), 'utf8')
      expect(
        always.needle.test(src),
        `'${action}' is recorded as always-gated (${always.why}) but ${always.file} no longer ` +
          `opens the gate unconditionally there — so it is now guarded by nothing`
      ).toBe(true)
      return
    }
    expect(
      consulted,
      `'${action}' is in the GuardedAction union but no surface asks the policy about it — ` +
        `kids mode does not protect it, whatever docs/kids-mode.md says`
    ).toBe(true)
  })
})

describe('the gate has exactly one mount point', () => {
  it('is rendered by DestructiveGateHost and nowhere else', () => {
    // Two hosts would mean two gates for one request. The component is a portal, so a duplicate
    // would not be visible in any layout — it would be two overlapping dialogs for one action.
    const renderers = FILES.filter((f) => {
      if (f.endsWith('DestructiveConfirmGate.tsx')) return false
      return /<DestructiveConfirmGate\b/.test(readFileSync(f, 'utf8'))
    }).map((f) => f.slice(f.lastIndexOf('\\') + 1).replace(/^.*\//, ''))
    expect(renderers).toEqual(['DestructiveGateHost.tsx'])
  })

  it('the host is mounted at the app root', () => {
    // Mounted inside a view, an open gate can be torn down mid-confirmation by a project switch,
    // leaving the person unsure whether the irreversible thing happened.
    const app = readFileSync(join(RENDERER, 'App.tsx'), 'utf8')
    expect(app).toMatch(/<DestructiveGateHost \/>/)
  })
})
