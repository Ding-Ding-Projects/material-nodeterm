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
): BrowserContentsLike & {
  destroy(): void
  emitDebugger(method: string): void
  sendCommand: ReturnType<typeof vi.fn>
} {
  let attached = false
  let destroyed = false
  let listener: Parameters<BrowserDebuggerLike['on']>[1] | undefined
  const sendCommand = vi.fn(async (method: string) =>
    method === 'Page.getLayoutMetrics'
      ? {
          cssLayoutViewport: { clientWidth: 1000, clientHeight: 800 },
          cssVisualViewport: { clientWidth: 1000, clientHeight: 800 }
        }
      : {}
  )
  const debuggerApi: BrowserDebuggerLike = {
    isAttached: () => attached,
    attach: () => {
      attached = true
    },
    detach: () => {
      attached = false
    },
    sendCommand,
    on: vi.fn((_event, next) => {
      listener = next
    }),
    removeListener: vi.fn((_event, current) => {
      if (listener === current) listener = undefined
    })
  }
  return {
    id,
    debugger: debuggerApi,
    focus: vi.fn(),
    getTitle: () => `Tab ${id}`,
    getURL: () => url,
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true
    },
    emitDebugger: (method) => listener?.({}, method, {}),
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

  it('advertises the production Codex Browser flavor for the requesting session', async () => {
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => (sessionId === 'session-a' ? 'agent-a' : undefined),
      vi.fn()
    )

    await expect(
      router.dispatch('getInfo', {
        session_id: 'session-a',
        turn_id: 'turn-a'
      })
    ).resolves.toMatchObject({
      metadata: {
        codexAppBuildFlavor: 'prod',
        codexSessionId: 'session-a'
      },
      name: 'NodeTerm Browser',
      type: 'iab'
    })
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
      method: 'Runtime.enable',
      commandParams: {}
    })

    expect(contents.debugger.isAttached()).toBe(true)
    expect(contents.sendCommand).toHaveBeenCalledWith(
      'Runtime.enable',
      {},
      undefined
    )
  })

  it('translates Codex synthetic scroll gestures into Electron webview wheel input', async () => {
    const contents = fakeContents(45, 'https://scroll.test')
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => (sessionId === 'session' ? 'agent' : undefined),
      vi.fn()
    )
    router.register({ contents, nodeId: 'browser', ownerNodeId: 'agent' })

    // Input.dispatchMouseEvent is bounded by the last measured page viewport. Populate that
    // measurement through the same owned CDP route before translating the synthetic gesture.
    await router.dispatch('executeCdp', {
      session_id: 'session',
      turn_id: 'metrics-turn',
      target: { tabId: 45 },
      method: 'Page.getLayoutMetrics',
      commandParams: {}
    })

    await router.dispatch('executeCdp', {
      session_id: 'session',
      turn_id: 'turn',
      target: { tabId: 45 },
      method: 'Input.synthesizeScrollGesture',
      commandParams: {
        gestureSourceType: 'mouse',
        preventFling: true,
        speed: 8000,
        x: 400,
        xDistance: 25,
        y: 245,
        yDistance: -500
      }
    })

    expect(contents.sendCommand).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseWheel',
        x: 400,
        y: 245,
        deltaX: -25,
        deltaY: 500,
        modifiers: 0
      },
      undefined
    )
  })

  it('hands one browser node event stream from the old Codex session to the new one', async () => {
    const contents = fakeContents(55, 'https://handoff.test')
    const notify = vi.fn()
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => (sessionId === 'session-a' || sessionId === 'session-b' ? 'agent' : undefined),
      notify
    )
    router.register({ contents, nodeId: 'browser', ownerNodeId: 'agent' })
    const execute = (sessionId: string) => router.dispatch('executeCdp', {
      session_id: sessionId,
      turn_id: `turn-${sessionId}`,
      target: { tabId: 55 },
      method: 'Runtime.enable',
      commandParams: {}
    })

    await execute('session-a')
    contents.emitDebugger('Runtime.consoleAPICalled')
    await execute('session-b')
    contents.emitDebugger('Runtime.exceptionThrown')

    expect(notify.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      'session-a',
      'session-b'
    ])
    expect(contents.debugger.removeListener).toHaveBeenCalledTimes(1)
  })

  it('unregisters a loaded browser node after Electron destroyed its webContents', async () => {
    const contents = fakeContents(66, 'https://loaded.test')
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => (sessionId === 'session' ? 'agent' : undefined),
      vi.fn()
    )
    router.register({ contents, nodeId: 'browser', ownerNodeId: 'agent' })
    await router.dispatch('attach', {
      session_id: 'session',
      turn_id: 'turn',
      tabId: 66
    })
    contents.destroy()

    expect(() => router.unregister(66)).not.toThrow()
    await expect(
      router.dispatch('getTabs', {
        session_id: 'session',
        turn_id: 'next-turn'
      })
    ).resolves.toEqual([])
  })

  it('does not reuse child-target sessions after an explicit debugger detach', async () => {
    const contents = fakeContents(77, 'https://targets.test')
    contents.sendCommand.mockImplementation(async (method: string) =>
      method === 'Target.attachToTarget' ? { sessionId: 'child-session' } : {}
    )
    const router = new NodeTermBrowserUseRouter(
      (sessionId) => (sessionId === 'session' ? 'agent' : undefined),
      vi.fn()
    )
    router.register({ contents, nodeId: 'browser', ownerNodeId: 'agent' })
    await router.dispatch('attachTarget', {
      session_id: 'session',
      turn_id: 'turn',
      tabId: 77,
      targetId: 'child-target'
    })
    await router.dispatch('detach', {
      session_id: 'session',
      turn_id: 'turn',
      tabId: 77
    })

    await router.dispatch('executeCdp', {
      session_id: 'session',
      turn_id: 'next-turn',
      target: { tabId: 77, targetId: 'child-target' },
      method: 'Runtime.enable',
      commandParams: {}
    })

    expect(contents.sendCommand).toHaveBeenLastCalledWith(
      'Runtime.enable',
      {},
      undefined
    )
  })
})
