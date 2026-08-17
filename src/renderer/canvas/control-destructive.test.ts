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
  })
})
