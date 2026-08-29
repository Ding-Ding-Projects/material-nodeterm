import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORE_COMMAND_KILL_LINE,
  cleanCoreCommandEcho,
  deliverCoreCommand,
  type CoreCommandDeliveryIo,
  type CoreCommandDeliveryOptions,
} from './command-delivery'

const TIMING: Required<
  Pick<
    CoreCommandDeliveryOptions,
    'promptQuietMs' | 'promptSilenceCapMs' | 'verifyTimeoutMs' | 'attempts'
  >
> = {
  promptQuietMs: 20,
  promptSilenceCapMs: 100,
  verifyTimeoutMs: 50,
  attempts: 3,
}

const PRIVATE_COMMAND = `agent --prompt "雪 & pipes | apostrophe ' and ^%!"`

function fakeIo(
  options: {
    echoWrites?: boolean
    throwOn?: (data: string, count: number) => boolean
  } = {},
) {
  const writes: string[] = []
  let listener: ((chunk: string) => void) | undefined
  let unsubscribeCount = 0
  const io: CoreCommandDeliveryIo = {
    write(data) {
      writes.push(data)
      if (options.throwOn?.(data, writes.length)) {
        throw new Error(`private transport failure while writing ${data}`)
      }
      if (options.echoWrites) listener?.(data)
    },
    onData(callback) {
      listener = callback
      return () => {
        unsubscribeCount += 1
        listener = undefined
      }
    },
  }
  return {
    io,
    writes,
    emit: (chunk: string) => listener?.(chunk),
    unsubscribeCount: () => unsubscribeCount,
  }
}

describe('cleanCoreCommandEcho', () => {
  it('removes terminal formatting and explicit line wraps', () => {
    expect(
      cleanCoreCommandEcho('\x1b[32mprompt\x1b[0m a\r\nb\x1b]0;title\x07'),
    ).toBe('prompt ab')
  })
})

describe('deliverCoreCommand', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for startup output to become quiet, writes opaque Unicode/metacharacters, then submits', async () => {
    const f = fakeIo()
    const delivery = deliverCoreCommand(f.io, PRIVATE_COMMAND, {
      ...TIMING,
      promptSilenceCapMs: 200,
    })

    vi.advanceTimersByTime(70)
    expect(f.writes).toEqual([])
    f.emit('loading profile')
    vi.advanceTimersByTime(19)
    f.emit('prompt redraw')
    vi.advanceTimersByTime(19)
    expect(f.writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(f.writes).toEqual([PRIVATE_COMMAND])

    f.emit(`\x1b[32mPS>\x1b[0m ${PRIVATE_COMMAND.slice(0, 25)}\r\n`)
    f.emit(PRIVATE_COMMAND.slice(25))
    expect(f.writes).toEqual([PRIVATE_COMMAND, '\r'])
    await expect(delivery.result).resolves.toEqual({
      status: 'submitted',
      verified: true,
      attempts: 1,
    })
  })

  it('uses the silence cap when the shell produces no prompt output', () => {
    const f = fakeIo()
    deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
    vi.advanceTimersByTime(99)
    expect(f.writes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(f.writes).toEqual([PRIVATE_COMMAND])
  })

  it('kills a mangled line, waits out redraw noise, and verifies only the current retry', async () => {
    const f = fakeIo()
    const delivery = deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
    vi.advanceTimersByTime(TIMING.promptSilenceCapMs)
    f.emit(PRIVATE_COMMAND.slice(0, -8))
    vi.advanceTimersByTime(TIMING.verifyTimeoutMs)
    expect(f.writes).toEqual([PRIVATE_COMMAND, CORE_COMMAND_KILL_LINE])

    // A late full echo belongs to the cleared attempt. In the prompt-wait phase it merely delays
    // the retry and, critically, cannot submit Enter for the wrong attempt.
    f.emit(PRIVATE_COMMAND)
    vi.advanceTimersByTime(TIMING.promptQuietMs - 1)
    expect(f.writes).toEqual([PRIVATE_COMMAND, CORE_COMMAND_KILL_LINE])
    vi.advanceTimersByTime(1)
    expect(f.writes).toEqual([
      PRIVATE_COMMAND,
      CORE_COMMAND_KILL_LINE,
      PRIVATE_COMMAND,
    ])
    expect(f.writes).not.toContain('\r')

    f.emit(PRIVATE_COMMAND)
    expect(f.writes).toEqual([
      PRIVATE_COMMAND,
      CORE_COMMAND_KILL_LINE,
      PRIVATE_COMMAND,
      '\r',
    ])
    await expect(delivery.result).resolves.toEqual({
      status: 'submitted',
      verified: true,
      attempts: 2,
    })
  })

  it('submits exactly once against a synchronously echoing transport', async () => {
    const f = fakeIo({ echoWrites: true })
    const delivery = deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
    vi.advanceTimersByTime(TIMING.promptSilenceCapMs)
    expect(f.writes).toEqual([PRIVATE_COMMAND, '\r'])
    expect(f.writes.filter((write) => write === '\r')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    await expect(delivery.result).resolves.toEqual({
      status: 'submitted',
      verified: true,
      attempts: 1,
    })
  })

  it('fails open once after bounded retries, with Ctrl-U before every rewrite', async () => {
    const f = fakeIo()
    const delivery = deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
    vi.advanceTimersByTime(TIMING.promptSilenceCapMs)

    for (let attempt = 1; attempt <= TIMING.attempts; attempt++) {
      vi.advanceTimersByTime(TIMING.verifyTimeoutMs)
      if (attempt < TIMING.attempts)
        vi.advanceTimersByTime(TIMING.promptQuietMs)
    }

    expect(f.writes.filter((write) => write === PRIVATE_COMMAND)).toHaveLength(
      TIMING.attempts,
    )
    expect(
      f.writes.filter((write) => write === CORE_COMMAND_KILL_LINE),
    ).toHaveLength(TIMING.attempts - 1)
    expect(f.writes.filter((write) => write === '\r')).toHaveLength(1)
    await expect(delivery.result).resolves.toEqual({
      status: 'submitted',
      verified: false,
      attempts: TIMING.attempts,
    })
  })

  it.each(['cancelled', 'exited'] as const)(
    '%s removes the listener and every timer without submitting',
    async (reason) => {
      const f = fakeIo()
      const delivery = deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
      vi.advanceTimersByTime(TIMING.promptSilenceCapMs)
      delivery.cancel(reason)
      delivery.cancel(reason)
      vi.runAllTimers()
      f.emit(PRIVATE_COMMAND)

      expect(f.writes).toEqual([PRIVATE_COMMAND])
      expect(f.unsubscribeCount()).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
      await expect(delivery.result).resolves.toEqual({
        status: reason,
        attempts: 1,
      })
    },
  )

  it('ignores late and duplicate echoes after submission', () => {
    const f = fakeIo()
    deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
    vi.advanceTimersByTime(TIMING.promptSilenceCapMs)
    f.emit(PRIVATE_COMMAND)
    f.emit(PRIVATE_COMMAND)
    vi.runAllTimers()
    expect(f.writes).toEqual([PRIVATE_COMMAND, '\r'])
    expect(f.unsubscribeCount()).toBe(1)
  })

  it('returns a sanitized failure and never exposes private input or transport errors', async () => {
    const f = fakeIo({ throwOn: (_data, count) => count === 1 })
    const delivery = deliverCoreCommand(f.io, PRIVATE_COMMAND, TIMING)
    vi.advanceTimersByTime(TIMING.promptSilenceCapMs)
    const outcome = await delivery.result

    expect(outcome).toEqual({ status: 'io-error', attempts: 1 })
    const serialized = JSON.stringify(outcome)
    expect(serialized).not.toContain(PRIVATE_COMMAND)
    expect(serialized).not.toContain('private transport failure')
    expect(f.unsubscribeCount()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
