import { describe, expect, it, vi } from 'vitest'
import {
  NativeFrameDecoder,
  NodeTermBrowserUseRouter,
  encodeNativeFrame,
  type BrowserContentsLike,
  type BrowserDebuggerLike
} from './browser-use-backend-core'

function fakeContents(
  id: number,
  url: string
): BrowserContentsLike & { sendCommand: ReturnType<typeof vi.fn> } {
  let attached = false
  const sendCommand = vi.fn(async () => ({}))
  const debuggerApi: BrowserDebuggerLike = {
    isAttached: () => attached,
    attach: () => {
      attached = true
    },
    detach: () => {
      attached = false
    },
    sendCommand,
    on: vi.fn(),
    removeListener: vi.fn()
  }
  return {
    id,
    debugger: debuggerApi,
    focus: vi.fn(),
    getTitle: () => `Tab ${id}`,
    getURL: () => url,
    isDestroyed: () => false,
    sendCommand
  }
}

describe('NodeTerm Browser Plugin backend', () => {
  it('decodes partial and coalesced native-pipe frames', () => {
    const decoder = new NativeFrameDecoder()
    const first = encodeNativeFrame({ id: 1, method: 'one' })
    const second = encodeNativeFrame({ id: 2, method: 'two' })
    expect(decoder.push(first.subarray(0, 3))).toEqual([])
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { id: 1, method: 'one' },
      { id: 2, method: 'two' }
    ])
  })

  it('keeps two simultaneous Codex sessions scoped to their own browser nodes', async () => {
    const nodeBySession = new Map([
      ['session-a', 'agent-a'],
      ['session-b', 'agent-b']
    ])
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => nodeBySession.get(sessionId),
      vi.fn()
    )
    router.register({
      contents: fakeContents(11, 'https://a.test'),
      nodeId: 'browser-a',
      ownerNodeId: 'agent-a'
    })
    router.register({
      contents: fakeContents(22, 'https://b.test'),
      nodeId: 'browser-b',
      ownerNodeId: 'agent-b'
    })

    await expect(
      router.dispatch('getTabs', {
        session_id: 'session-a',
        turn_id: 'turn-a'
      })
    ).resolves.toEqual([
      expect.objectContaining({ id: 11, url: 'https://a.test' })
    ])
    await expect(
      router.dispatch('getTabs', {
        session_id: 'session-b',
        turn_id: 'turn-b'
      })
    ).resolves.toEqual([
      expect.objectContaining({ id: 22, url: 'https://b.test' })
    ])
    await expect(
      router.dispatch('executeCdp', {
        session_id: 'session-a',
        turn_id: 'turn-a',
        target: { tabId: 22 },
        method: 'Page.getFrameTree',
        commandParams: {}
      })
    ).rejects.toThrow('Unknown browser tab: 22')
  })

  it('fails closed for missing or invalid session mappings', async () => {
    const router = new NodeTermBrowserUseRouter(() => undefined, vi.fn())
    router.register({
      contents: fakeContents(33, 'https://private.test'),
      nodeId: 'browser',
      ownerNodeId: 'agent'
    })

    await expect(
      router.dispatch('getTabs', { session_id: 'unknown', turn_id: 'turn' })
    ).rejects.toThrow('not mapped')
    await expect(
      router.dispatch('getTabs', { turn_id: 'turn' })
    ).rejects.toThrow('Missing required browser session_id')
  })

  it('routes CDP only after attaching the owned webview debugger', async () => {
    const contents = fakeContents(44, 'https://owned.test')
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => (sessionId === 'session' ? 'agent' : undefined),
      vi.fn()
    )
    router.register({ contents, nodeId: 'browser', ownerNodeId: 'agent' })

    await router.dispatch('executeCdp', {
      session_id: 'session',
      turn_id: 'turn',
      target: { tabId: 44 },
      method: 'Runtime.evaluate',
      commandParams: { expression: 'document.title' }
    })

    expect(contents.debugger.isAttached()).toBe(true)
    expect(contents.sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      { expression: 'document.title' },
      undefined
    )
  })
})
