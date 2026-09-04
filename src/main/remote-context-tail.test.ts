import { describe, expect, it, vi } from 'vitest'
import { createRemoteContextTail } from './remote-context-tail'
import type { RemoteFileRef } from './remote-ssh/remote-file'

const ref: RemoteFileRef = { conn: { host: 'h', user: 'u' }, controlPath: '/s', path: '/abs/x.jsonl' }
const line = (used: number, model: string): string =>
  JSON.stringify({ type: 'assistant', message: { model, usage: { input_tokens: used } } })

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

function fakeWin(): { win: never; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  return { win: { isDestroyed: () => false, webContents: { send } } as never, send }
}

describe('createRemoteContextTail', () => {
  it('reads the remote transcript with its absolute size and pushes ContextWindowUsage on first usage', async () => {
    const { win, send } = fakeWin()
    const remoteFile = {
      readTailWithSize: vi.fn(async () => ({
        data: Buffer.from(line(120, 'claude-opus-4-8')),
        size: Buffer.byteLength(line(120, 'claude-opus-4-8'))
      })),
      readFromCapped: vi.fn(async (_r: RemoteFileRef, o: number, _cap: number) => ({
        data: Buffer.alloc(0),
        newOffset: o
      }))
    }
    const tail = createRemoteContextTail(win, remoteFile as never)
    tail.track('sess1', ref)
    await tick()
    expect(remoteFile.readTailWithSize).toHaveBeenCalled()
    expect(send).toHaveBeenCalled()
    const [channel, payload] = send.mock.calls.at(-1)!
    expect(channel).toBe('context:update')
    expect(payload).toMatchObject({
      sessionId: 'sess1',
      usedTokens: 120,
      model: 'claude-opus-4-8',
      windowTokens: 1_000_000
    })
    tail.untrack('sess1')
  })

  it('uses the capped read with the advancing offset after the first tail read', async () => {
    const { win } = fakeWin()
    const readFromCapped = vi.fn(async (_r: RemoteFileRef, o: number, _cap: number) => ({
      data: Buffer.alloc(0),
      newOffset: o
    }))
    const remoteFile = {
      readTailWithSize: vi.fn(async () => ({
        data: Buffer.from(line(50, 'claude-haiku')),
        size: Buffer.byteLength(line(50, 'claude-haiku'))
      })),
      readFromCapped
    }
    const tail = createRemoteContextTail(win, remoteFile as never)
    tail.track('sess2', ref)
    await new Promise((r) => setTimeout(r, 1100))
    expect(remoteFile.readTailWithSize).toHaveBeenCalledTimes(1)
    expect(remoteFile.readFromCapped).toHaveBeenCalledWith(ref, expect.any(Number), 1024 * 1024)
    // pathFor exposes the tracked path
    expect(tail.pathFor('sess2')).toBe('/abs/x.jsonl')
    tail.untrack('sess2')
  })

  it('fires onTaskNotification for a <task-notification> line in the remote transcript', async () => {
    const { win } = fakeWin()
    const notif = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      content: '<task-notification>\n<tool-use-id>tu-remote</tool-use-id>\n<status>completed</status>\n<result>remote done</result>\n</task-notification>'
    })
    let phase = 0
    const remoteFile = {
      readTailWithSize: vi.fn(async () => ({
        data: Buffer.from(line(10, 'claude-opus-4-8') + '\n'),
        size: Buffer.byteLength(line(10, 'claude-opus-4-8') + '\n')
      })),
      readFromCapped: vi.fn(async (_r: RemoteFileRef, o: number, _cap: number) => {
        if (served) return { data: Buffer.alloc(0), newOffset: o }
        served = true
        return {
          data: Buffer.from(notif + '\n'),
          newOffset: o + Buffer.byteLength(notif + '\n')
        }
      })
    }
    const onTaskNotification = vi.fn()
    const tail = createRemoteContextTail(win, remoteFile as never, { onTaskNotification })
    tail.track('sess4', ref)
    await new Promise((r) => setTimeout(r, 1200)) // first read + one poll tick
    expect(onTaskNotification).toHaveBeenCalledTimes(1)
    expect(onTaskNotification.mock.calls[0][0]).toBe('sess4')
    expect(onTaskNotification.mock.calls[0][1]).toMatchObject({ toolUseId: 'tu-remote', result: 'remote done' })
    tail.untrack('sess4')
  }, 5000)

  it('keeps adapter read rejections out of the fire-and-forget polling loop', async () => {
    const { win, send } = fakeWin()
    const remoteFile = {
      readTailWithSize: vi.fn(async () => ({
        data: Buffer.from(line(12, 'claude-opus-4-8') + '\n'),
        size: Buffer.byteLength(line(12, 'claude-opus-4-8') + '\n')
      })),
      readFromCapped: vi.fn(async () => {
        throw new Error('adapter unavailable')
      })
    }
    const tail = createRemoteContextTail(win, remoteFile as never)
    tail.track('sess-rejected', ref)
    await new Promise((r) => setTimeout(r, 1100))
    expect(send.mock.calls.map((call) => call[1].usedTokens)).toContain(12)
    expect(remoteFile.readFromCapped).toHaveBeenCalled()
    tail.untrack('sess-rejected')
  })

  it('only pushes again when the usage changes', async () => {
    const { win, send } = fakeWin()
    // Realistic JSONL: records are newline-terminated (the tail carries a torn trailing
    // line into the next read, so un-delimited records would garble on purpose).
    let nextFrom = line(200, 'claude-opus-4-8') + '\n'
    const remoteFile = {
      readTailWithSize: vi.fn(async () => ({
        data: Buffer.from(line(100, 'claude-opus-4-8') + '\n'),
        size: Buffer.byteLength(line(100, 'claude-opus-4-8') + '\n')
      })),
      readFromCapped: vi.fn(async (_r: RemoteFileRef, o: number, _cap: number) => {
        const text = nextFrom
        nextFrom = ''
        return { data: Buffer.from(text), newOffset: o + Buffer.byteLength(text) }
      })
    }
    const tail = createRemoteContextTail(win, remoteFile as never)
    tail.track('sess3', ref)
    await new Promise((r) => setTimeout(r, 1200)) // first tick (track) + one interval tick
    const usedValues = send.mock.calls.map((c) => c[1].usedTokens)
    expect(usedValues).toContain(100)
    expect(usedValues).toContain(200)
    tail.untrack('sess3')
  })
})
