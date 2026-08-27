import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DESTRUCTIVE_VERBS } from '@shared/control-verbs'
import {
  dispatchDestructiveControl,
  type ControlActionReply
} from '../lib/controlDestructive'
import { __resetAgentRestartForTests, guardConcurrentRestart } from '../terminal/agent-restart'

function harness(verb: string, confirmationBusy = false) {
  let writeConfirm: (() => void | Promise<void>) | undefined
  let writeCancel: (() => void) | undefined
  let closeConfirm: (() => void) | undefined
  let closeCancel: (() => void) | undefined
  const replies: ControlActionReply[] = []
  const performWrite = vi.fn(async () => ({ ok: true, message: 'sent' }))
  const performClose = vi.fn()

  const handled = dispatchDestructiveControl(
    {
      verb,
      args: { node: 'node-1', text: 'hello' },
      sourceTitle: 'Agent one'
    },
    {
      confirmationBusy: () => confirmationBusy,
      openWriteConfirmation: (request) => {
        writeConfirm = request.onConfirm
        writeCancel = request.onCancel
      },
      openCloseConfirmation: (request) => {
        closeConfirm = request.onConfirm
        closeCancel = request.onCancel
        return true
      },
      performWrite,
      performClose,
      reply: (result) => replies.push(result)
    }
  )

  return {
    handled,
    performWrite,
    performClose,
    replies,
    confirm: verb === 'write' ? writeConfirm : closeConfirm,
    cancel: verb === 'write' ? writeCancel : closeCancel
  }
}

describe('destructive canvas-control behavior', () => {
  beforeEach(() => __resetAgentRestartForTests())

  it('has an exact, behavior-implemented destructive inventory', () => {
    expect([...DESTRUCTIVE_VERBS].sort()).toEqual(['close', 'write'])
    for (const verb of DESTRUCTIVE_VERBS) {
      const run = harness(verb)
      expect(run.handled, verb).toBe(true)
      expect(run.confirm, `${verb} must expose a confirmation callback`).toBeTypeOf('function')
    }
  })

  for (const verb of ['write', 'close'] as const) {
    it(`${verb} cannot perform before confirm and performs exactly once after confirm`, async () => {
      const run = harness(verb)
      expect(run.performWrite).not.toHaveBeenCalled()
      expect(run.performClose).not.toHaveBeenCalled()
      expect(run.replies).toEqual([])

      await run.confirm?.()

      const effect = verb === 'write' ? run.performWrite : run.performClose
      expect(effect).toHaveBeenCalledTimes(1)
      expect(effect).toHaveBeenLastCalledWith('node-1', ...(verb === 'write' ? ['hello'] : []))
      expect(run.replies).toEqual(
        verb === 'write'
          ? [{ ok: true, message: 'sent' }]
          : [{ ok: true, message: 'closed node-1' }]
      )
    })

    it(`${verb} cancellation never performs`, () => {
      const run = harness(verb)
      run.cancel?.()
      expect(run.performWrite).not.toHaveBeenCalled()
      expect(run.performClose).not.toHaveBeenCalled()
      expect(run.replies).toEqual([{ ok: false, error: 'denied by user' }])
    })

    it(`${verb} refuses while another confirmation is pending`, () => {
      const run = harness(verb, true)
      expect(run.confirm).toBeUndefined()
      expect(run.performWrite).not.toHaveBeenCalled()
      expect(run.performClose).not.toHaveBeenCalled()
      expect(run.replies).toEqual([
        { ok: false, error: 'a confirmation is already pending — try again' }
      ])
    })
  }

  it('does not claim ordinary verbs', () => {
    const run = harness('list')
    expect(run.handled).toBe(false)
    expect(run.confirm).toBeUndefined()
    expect(run.replies).toEqual([])
  })

  it('a confirmed write cannot perform while the target is owned by a restart', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const restart = guardConcurrentRestart('node-1', async () => {
      await held
      return 'restarted' as const
    })()

    const run = harness('write')
    await run.confirm?.()

    expect(run.performWrite).not.toHaveBeenCalled()
    expect(run.replies).toEqual([
      { ok: false, error: 'target is busy with a restart or wake — try again' }
    ])

    release()
    await restart
  })

  it('answers a malformed destructive request without opening or performing', () => {
    const replies: ControlActionReply[] = []
    const open = vi.fn()
    const perform = vi.fn()
    expect(
      dispatchDestructiveControl(
        { verb: 'write', args: {}, sourceTitle: 'Agent' },
        {
          confirmationBusy: () => false,
          openWriteConfirmation: open,
          openCloseConfirmation: open,
          performWrite: perform,
          performClose: perform,
          reply: (result) => replies.push(result)
        }
      )
    ).toBe(true)
    expect(open).not.toHaveBeenCalled()
    expect(perform).not.toHaveBeenCalled()
    expect(replies).toEqual([{ ok: false, error: 'write requires --node' }])
/**
 * The body of an EARLY-HANDLED verb's block — `open-project` is dispatched before the
 * source-routing machinery (a STORE_ANSWERED_VERBS member, spec §2.3), so it has no `case` label.
 * Delimited by its `if (verb === '<verb>')` guard and the next section-comment rule (`// ──`),
 * the same way the switch slice above is delimited by the next case label.
 */
function earlyBody(verb: string): string {
  const start = src.indexOf(`if (verb === '${verb}')`)
  if (start === -1) return ''
  const rest = src.slice(start)
  const end = rest.indexOf('// ──', 10)
  return end === -1 ? rest : rest.slice(0, end)
}

/** A verb's dispatch body wherever it lives: its switch case, or its early-handled block. */
function dispatchBody(verb: string): string {
  return caseBody(verb) || earlyBody(verb)
}

describe('the confirm-gated set and the dispatch that reads it stay in agreement', () => {
  it('the dispatch imports the set rather than restating it', () => {
    expect(src).toMatch(/import \{[^}]*isDestructiveVerb[^}]*\} from '@shared\/control-verbs'/)
  })

  for (const verb of ['write', 'close', 'open-project'] as const) {
    it(`${verb} reaches its confirm through isDestructiveVerb`, () => {
      expect(isDestructiveVerb(verb)).toBe(true)
      const body = dispatchBody(verb)
      expect(body).not.toBe('')
      // The guard CALL, not a hardcoded truth: adding a verb to the set must change behaviour.
      expect(body).toMatch(/isDestructiveVerb\(verb\) && confirmBusy\(\)/)
      // …and no leftover bare gate beside it, which would make the set decorative again.
      expect(body).not.toMatch(/\bif \(confirmBusy\(\)\)/)
      expect(body).toContain('setConfirm({')
      // Denial is honored on every confirm this set gates (spec P4): the cancel leg replies the
      // shared refusal instead of hanging the CLI to its 120s timeout.
      expect(body).toContain("'denied by user'")
    })
  }

  it('no other case reads isDestructiveVerb', () => {
    // Every `isDestructiveVerb(verb)` in the dispatch must sit in a case the set actually holds.
    // If a third case ever grows one, either the set or the dispatch is wrong — say so here rather
    // than let the two drift apart the way the constant and the switch already did once.
    //
    // This scans for the CALL, so a hand-written confirm that never reads the set is invisible to
    // it — `close-worktree --mode remove` is exactly that, on purpose. This is not "no other verb
    // is confirm-gated"; it is "no other case claims to be gated by this set".
    const labels = [...src.matchAll(/\n {10}case '([a-z-]+)': \{/g)].map((m) => m[1])
    const gated = labels.filter((v) => /isDestructiveVerb\(verb\)/.test(caseBody(v)))
    // The early-handled block (`open-project`) is counted the same way, off its own slice.
    for (const early of ['open-project']) {
      if (/isDestructiveVerb\(verb\)/.test(earlyBody(early))) gated.push(early)
    }
    expect(new Set(gated)).toEqual(new Set(DESTRUCTIVE_VERBS))
  })
})
