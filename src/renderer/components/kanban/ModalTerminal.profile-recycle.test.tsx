// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModalTerminal, type ModalSpawn } from './ModalTerminal'

interface FakeTerminalInstance {
  dispose: ReturnType<typeof vi.fn>
}

const harness = vi.hoisted(() => ({
  session: null as unknown as {
    id: string
    source: 'local'
    label: string
    status: 'connected'
    api: Record<string, unknown>
  },
  settings: {
    terminalMiddleClickPaste: false,
    defaultTerminalProfileId: 'auto'
  },
  terminals: [] as FakeTerminalInstance[],
  recycled: new Map<string, (info: { ready: boolean }) => void>()
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class Terminal {
    cols = 80
    rows = 24
    parser = { registerOscHandler: vi.fn() }
    buffer = {
      active: {
        length: 0,
        getLine: vi.fn()
      }
    }
    options: Record<string, unknown> = {}
    dispose = vi.fn()
    write = vi.fn()
    resize = vi.fn()
    focus = vi.fn()
    paste = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    registerLinkProvider = vi.fn(() => ({ dispose: vi.fn() }))
    attachCustomKeyEventHandler = vi.fn()
    hasSelection = vi.fn(() => false)
    getSelection = vi.fn(() => '')
    onData = vi.fn()

    constructor() {
      harness.terminals.push(this)
    }
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    fit = vi.fn()
  }
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class SearchAddon {
    findNext = vi.fn()
    findPrevious = vi.fn()
  }
}))

vi.mock('../../terminal/char-size-quantize', () => ({ quantizeCharSize: vi.fn() }))
vi.mock('../../terminal/unicode-width', () => ({ activateUnicode11: vi.fn() }))
vi.mock('../../terminal/middle-click', () => ({ guardMiddleClickPaste: () => vi.fn() }))
vi.mock('../../terminal/osc52', () => ({ parseOsc52: () => null }))
vi.mock('../../terminal/file-drop', () => ({
  clipboardImages: vi.fn(async () => []),
  droppedPaths: vi.fn(async () => []),
  pasteHasText: vi.fn(() => false),
  pastedFiles: vi.fn(() => [])
}))

vi.mock('../../terminal/terminal-config', () => ({
  attachReplay: vi.fn(() => 'none'),
  cursorPlacementSeq: vi.fn(() => ''),
  seedPaint: vi.fn(() => 'none'),
  stripTrailingNewline: vi.fn((value: string) => value),
  terminalKeyAction: vi.fn(() => 'pass'),
  toXtermText: vi.fn((value: string) => value),
  applyLiveOptions: vi.fn(() => ({ metricsChanged: false })),
  xtermOptionsFromSettings: vi.fn(() => ({})),
  recycleAction: (info: { ready: boolean } | undefined) => (info?.ready ? 'restart' : 'ended'),
  SHIFT_ENTER_SEQ: '\u001b\r',
  CO_ATTACH_MOUSE_SEQ: '\u001b[?1000h'
}))

vi.mock('../../terminal/useXtermVisualSettings', () => ({
  useXtermVisualSettings: () => ({})
}))

vi.mock('../../terminal/useTerminalSearch', () => ({
  useTerminalSearch: () => ({
    query: '',
    setQuery: vi.fn(),
    matchCount: 0,
    matchIndex: 0,
    current: null,
    next: vi.fn(),
    prev: vi.fn(),
    mode: 'text',
    setMode: vi.fn(),
    pattern: '',
    flags: '',
    setFlags: vi.fn(),
    error: null
  })
}))

vi.mock('../../terminal/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ notifyCopy: vi.fn() })
}))

vi.mock('../../lib/personalVocabulary/useLocalizedVocabularyText', () => ({
  useLocalizedVocabularyText: () =>
    (_id: string, fallback: string, params?: Record<string, string>) =>
      Object.entries(params ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        fallback
      )
}))

vi.mock('../../lib/projectJump', () => ({ liveProjectJumpTarget: () => null }))
vi.mock('../../lib/transcriptGates', () => ({ readsClaudeTranscript: () => false }))
vi.mock('@shared/agents/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/agents/config')>()),
  reportsOwnCopy: () => false
}))
vi.mock('@shared/platform-utils', () => ({ isWindowsPlatform: () => true }))
vi.mock('../FindBar', () => ({ FindBar: () => null }))

vi.mock('../../nodes/TerminalNode', () => ({
  resolveSshRemote: vi.fn(async () => undefined),
  reportSshDrop: vi.fn(),
  sshConnectionScope: vi.fn(() => 'ssh-scope'),
  owningProjectId: vi.fn(() => 'project-1')
}))

vi.mock('../../state/agentStatus', () => ({
  useAgentStatus: (selector: (state: { byId: Record<string, never> }) => unknown) =>
    selector({ byId: {} })
}))

vi.mock('../../state/projects', () => {
  const useProjects = (selector: (state: { activeProjectId: string }) => unknown) =>
    selector({ activeProjectId: 'project-1' })
  useProjects.getState = () => ({ activeProjectId: 'project-1' })
  return { useProjects }
})

vi.mock('../../state/settings', () => {
  const useSettings = (
    selector: (state: { settings: typeof harness.settings; base: typeof harness.settings }) => unknown
  ) => selector({ settings: harness.settings, base: harness.settings })
  useSettings.getState = () => ({ settings: harness.settings, base: harness.settings })
  return { useSettings }
})

vi.mock('../../session/session', () => ({ useSession: () => harness.session }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: TestResizeObserver
})

let root: Root
let host: HTMLDivElement
let createCount: number
let api: {
  terminalProfiles: Record<string, never>
  pty: {
    create: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    setFlow: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    recycle: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    onExit: ReturnType<typeof vi.fn>
    onSize: ReturnType<typeof vi.fn>
    onClosed: ReturnType<typeof vi.fn>
    onRecycled: ReturnType<typeof vi.fn>
    onResync: ReturnType<typeof vi.fn>
    readScrollback: ReturnType<typeof vi.fn>
  }
  clipboard: { writeText: ReturnType<typeof vi.fn> }
  getPathForFile: ReturnType<typeof vi.fn>
  focusWindow: ReturnType<typeof vi.fn>
}

function listenerRegistration() {
  return vi.fn((_sessionId: string, _listener: (...args: never[]) => void) => vi.fn())
}

beforeEach(() => {
  createCount = 0
  harness.terminals.length = 0
  harness.recycled.clear()

  api = {
    terminalProfiles: {},
    pty: {
      create: vi.fn(async () => {
        createCount += 1
        return {
          sessionId: `session-${createCount}`,
          fresh: false,
          persistent: true,
          screen: '',
          coAttachMouse: false
        }
      }),
      write: vi.fn(),
      resize: vi.fn(),
      setFlow: vi.fn(),
      kill: vi.fn(),
      destroy: vi.fn(),
      recycle: vi.fn(),
      onData: listenerRegistration(),
      onExit: listenerRegistration(),
      onSize: listenerRegistration(),
      onClosed: listenerRegistration(),
      onRecycled: vi.fn((sessionId: string, listener: (info: { ready: boolean }) => void) => {
        harness.recycled.set(sessionId, listener)
        return () => {
          if (harness.recycled.get(sessionId) === listener) harness.recycled.delete(sessionId)
        }
      }),
      onResync: listenerRegistration(),
      readScrollback: vi.fn(async () => null)
    },
    clipboard: { writeText: vi.fn() },
    getPathForFile: vi.fn(() => ''),
    focusWindow: vi.fn()
  }

  harness.session = {
    id: 'local',
    source: 'local',
    label: 'Local',
    status: 'connected',
    api
  }
  Object.defineProperty(window, 'nodeTerminal', {
    configurable: true,
    writable: true,
    value: api
  })

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(spawn: ModalSpawn, onOpenCanvas = vi.fn()): Promise<void> {
  await act(async () => {
    root.render(
      <ModalTerminal
        nodeId="terminal-1"
        spawn={spawn}
        searchOpen={false}
        onCloseSearch={() => {}}
        onOpenCanvas={onOpenCanvas}
      />
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ModalTerminal profile recycle lifecycle', () => {
  it('detaches the old viewer and creates exactly one co-view with the replacement profile', async () => {
    await render({ terminalProfileId: 'pwsh', respawnNonce: 4, cwd: 'C:\\project' })

    expect(api.pty.create).toHaveBeenCalledTimes(1)
    const firstOptions = api.pty.create.mock.calls[0][0] as {
      profileId?: string
      viewerId?: string
    }
    expect(firstOptions).toMatchObject({ profileId: 'pwsh' })
    expect(firstOptions.viewerId).toMatch(/^modal-terminal-1-/)

    await render({ terminalProfileId: 'cmd', respawnNonce: 5, cwd: 'C:\\project' })

    expect(api.pty.kill).toHaveBeenCalledWith('session-1', firstOptions.viewerId)
    expect(harness.terminals[0].dispose).toHaveBeenCalledOnce()
    expect(harness.recycled.has('session-1')).toBe(false)
    expect(api.pty.create).toHaveBeenCalledTimes(2)
    expect(api.pty.create.mock.calls[1][0]).toMatchObject({
      profileId: 'cmd',
      persistKey: 'terminal-1',
      cwd: 'C:\\project'
    })

    // A normal parent re-render does not create a third viewer for the same generation.
    await render({ terminalProfileId: 'cmd', respawnNonce: 5, cwd: 'C:\\project' })
    expect(api.pty.create).toHaveBeenCalledTimes(2)
  })

  it('fails closed on a recycle without a ready replacement and offers the canvas recovery path', async () => {
    const onOpenCanvas = vi.fn()
    await render({ terminalProfileId: 'pwsh', respawnNonce: 1 }, onOpenCanvas)

    expect(api.pty.create).toHaveBeenCalledOnce()
    const recycled = harness.recycled.get('session-1')
    expect(recycled).toBeTypeOf('function')

    await act(async () => {
      recycled?.({ ready: false })
      await Promise.resolve()
    })

    // The modal must not race the primary canvas viewer by spawning from stale profile/cwd state.
    expect(api.pty.create).toHaveBeenCalledOnce()
    const alert = host.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain(
      'This persistent session ended before a replacement was ready. Nothing was restarted.'
    )
    const reopen = alert?.querySelector<HTMLButtonElement>('button')
    expect(reopen?.textContent).toBe('Open on canvas to reopen')

    act(() => reopen?.click())
    expect(onOpenCanvas).toHaveBeenCalledOnce()
    expect(api.pty.create).toHaveBeenCalledOnce()
  })
})
