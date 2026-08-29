// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Canvas } from './Canvas'
import { SessionProvider, createSession, resetSessionsForTest, setActiveSession } from '../session/session'
import { useProjects } from '../state/projects'
import { createProject } from '../state/workspace'
import { buildStubApi, noopUnsub } from '../bridge/stubs'
import type { NodeTerminalApi, CanvasNodeState } from '@shared/types'
import { classifyLink, planBridges } from '../lib/noteLink'
import {
  OPEN_AGENT_LINK_PICKER_EVENT,
  requestAgentLinkPicker
} from '../lib/agentLink'

describe('Canvas agent-link integration seams', () => {
  let root: Root | undefined
  let originalBridge: unknown
  let originalProjectState: {
    projects: ReturnType<typeof useProjects.getState>['projects']
    activeProjectId: string
    reloadNonce: number
  }

  function makeBridge(project: ReturnType<typeof createProject>): NodeTerminalApi {
    const contextLinkSetLinks = vi.fn(async () => undefined)
    const nodeStates = project.nodes as CanvasNodeState[]
    const stub = buildStubApi()
    return {
      ...stub,
      pty: {
        create: vi.fn(async () => ({ fresh: true, screen: '' })),
        write: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
        kill: vi.fn(async () => undefined),
        sendText: vi.fn(async () => undefined),
        capture: vi.fn(async () => ''),
        onData: noopUnsub,
        onExit: noopUnsub,
        onClosed: noopUnsub,
        onResync: noopUnsub,
        onSize: noopUnsub,
        recycle: vi.fn(async () => ({ ok: true })),
        supported: true,
        recycleConfirmed: true
      },
      workspace: {
        load: vi.fn(async () => ({ projects: [project], activeProjectId: project.id })),
        save: vi.fn(async () => undefined),
        onChanged: noopUnsub,
        userDataDir: vi.fn(async () => 'C:/agent-links-data'),
        commit: vi.fn(async () => undefined)
      },
      settings: {
        load: vi.fn(async () => ({})),
        save: vi.fn(async () => undefined),
        onChanged: noopUnsub
      },
      schoolMode: {
        get: vi.fn(async () => ({ enabled: false, name: 'School mode' })),
        set: vi.fn(async () => undefined),
        onChanged: noopUnsub
      },
      kidsMode: { enabled: false, onChanged: noopUnsub },
      scheduledSettings: { list: vi.fn(async () => []), onChanged: noopUnsub },
      presence: {
        connect: vi.fn(async () => undefined),
        hello: vi.fn(async () => undefined),
        cursor: vi.fn(async () => undefined),
        focus: vi.fn(async () => undefined),
        chat: vi.fn(async () => undefined),
        project: vi.fn(async () => undefined),
        onSync: noopUnsub,
        onPeer: noopUnsub
      },
      contextLink: {
        setLinks: contextLinkSetLinks,
        info: vi.fn(async () => ({ shimPath: 'C:/agent-links-data/context.sh' }))
      },
      canvas: {
        mutate: vi.fn(async () => undefined),
        onMutation: noopUnsub
      },
      onAgentStatus: noopUnsub,
      onSubagentActivity: noopUnsub,
      onUnreadClear: noopUnsub,
      answerPermission: vi.fn(async () => undefined),
      ackDone: vi.fn(async () => undefined),
      closeWindow: vi.fn(),
      focusWindow: vi.fn(),
      onCloseNode: noopUnsub,
      onZoomActualSize: noopUnsub,
      onFocusNode: noopUnsub,
      notify: vi.fn(async () => 'skipped' as const),
      userDataDir: vi.fn(async () => 'C:/agent-links-data'),
      __testNodeStates: nodeStates
    } as unknown as NodeTerminalApi
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetSessionsForTest()
    useProjects.setState(originalProjectState)
    if (originalBridge === undefined) delete (window as unknown as { nodeTerminal?: unknown }).nodeTerminal
    else Object.defineProperty(window, 'nodeTerminal', { configurable: true, value: originalBridge })
  })

  beforeEach(() => {
    originalBridge = (window as unknown as { nodeTerminal?: unknown }).nodeTerminal
    const state = useProjects.getState()
    originalProjectState = {
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      reloadNonce: state.reloadNonce
    }
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    document.body.replaceChildren()
  })

  it('mounts the real Canvas component before exercising its agent-link listener', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    })
    vi.stubGlobal('IntersectionObserver', class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    })
    const project = createProject(0, 'Agent links', 'C:/agent-links')
    project.id = 'project-agent-links'
    project.nodes = [
      {
        id: 'source-node',
        type: 'terminal',
        position: { x: 0, y: 0 },
        data: { title: 'Lead', color: '#d97757', agentId: 'claude', tags: [] }
      },
      {
        id: 'target-node',
        type: 'terminal',
        position: { x: 400, y: 0 },
        data: { title: 'Reviewer', color: '#4f8cff', agentId: 'codex', tags: [] }
      },
      {
        id: 'plain-node',
        type: 'terminal',
        position: { x: 800, y: 0 },
        data: { title: 'Plain terminal', color: '#8a8a8a', tags: [] }
      },
      {
        id: 'eligible-node',
        type: 'terminal',
        position: { x: 1200, y: 0 },
        data: { title: 'Eligible reviewer', color: '#46a86b', agentId: 'gemini', tags: [] }
      }
    ]
    project.bridges = [{ id: 'bridge-source-node-target-node', source: 'source-node', target: 'target-node' }]
    const bridge = makeBridge(project)
    Object.defineProperty(window, 'nodeTerminal', { configurable: true, value: bridge })
    useProjects.setState({ projects: [project], activeProjectId: project.id, reloadNonce: 0 })
    const session = createSession('local', bridge, 'Local')
    setActiveSession(session.id)
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
      root!.render(
        <SessionProvider session={session}>
          <Canvas />
        </SessionProvider>
      )
    )
    const anchor = document.createElement('button')
    host.appendChild(anchor)
    act(() => requestAgentLinkPicker('source-node', anchor))
    expect(document.querySelector('[role="dialog"].agent-link-picker')).not.toBeNull()
    expect(document.querySelector('.agent-link-picker__name')?.textContent).not.toContain('Reviewer')
    expect(document.querySelector('.agent-link-picker__name')?.textContent).toContain('Eligible')
    const eligible = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
      (row) => row.textContent?.includes('Eligible')
    )
    expect(eligible).toBeDefined()
    act(() => eligible?.click())
    vi.advanceTimersByTime(200)
    expect(bridge.contextLink.setLinks).toHaveBeenCalled()
    expect(host.isConnected).toBe(true)
  })

  it('dispatches the source id and live anchor used by Canvas to open the picker', () => {
    const source = document.createElement('button')
    document.body.appendChild(source)
    const received: Event[] = []
    window.addEventListener(OPEN_AGENT_LINK_PICKER_EVENT, (event) => received.push(event))
    requestAgentLinkPicker('source-node', source)
    const detail = (received[0] as CustomEvent).detail
    expect(detail.sourceNodeId).toBe('source-node')
    expect(detail.anchorEl).toBe(source)
    source.remove()
  })

  it('keeps the canonical handles and refuses self, duplicate, and non-capable targets', () => {
    const capable = { kind: 'terminal', contextCapable: true }
    const other = { kind: 'terminal', contextCapable: false }
    expect(classifyLink(capable, capable)).toBe('context')
    expect(classifyLink(capable, other)).toBeNull()
    const lookup = (id: string) => (id === 'source' || id === 'target' ? capable : other)
    const plan = planBridges('source', ['source', 'target', 'target', 'plain'], lookup, [
      { source: 'source', target: 'target' }
    ])
    expect(plan.edges).toEqual([])
    expect(plan.skipped.map((entry) => entry.why)).toEqual([
      'same node',
      'already linked',
      'already linked',
      'not linkable (needs two context-capable agents, or a sticky + terminal)'
    ])
  })

  it('drops a stale target at the live onConnect boundary instead of creating a link', () => {
    const capable = { kind: 'terminal', contextCapable: true }
    const ids = new Set(['source'])
    const lookup = (id: string) => (ids.has(id) ? capable : null)
    const plan = planBridges('source', ['deleted-target'], lookup, [])
    expect(plan.edges).toEqual([])
    expect(plan.skipped[0]?.why).toBe('no such node')
  })
})
