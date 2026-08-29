// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
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

// Keep this integration probe focused on Canvas's link-picker seam. These chrome children each
// own unrelated host polls that need a full application bootstrap, while their rendered output is
// not part of the link contract under test.
vi.mock('../components/TmuxBanner', () => ({ TmuxBanner: () => null }))
vi.mock('../components/ServerDeploymentPill', () => ({ ServerDeploymentPill: () => null }))
vi.mock('../components/SessionsSidebar', () => ({ SessionsSidebar: () => null }))

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
        setFlow: vi.fn(async () => undefined),
        kill: vi.fn(async () => undefined),
        destroy: vi.fn(async () => undefined),
        recycle: vi.fn(async () => undefined),
        generateName: vi.fn(async () => ({ ok: false, error: 'not available' })),
        generateGroupName: vi.fn(async () => ({ ok: false, error: 'not available' })),
        sendText: vi.fn(async () => undefined),
        capture: vi.fn(async () => ''),
        readScrollback: vi.fn(async () => ''),
        tmuxStatus: vi.fn(async () => ({
          available: false,
          installCommand: null,
          installLabel: null,
          platform: 'win32'
        })),
        paneCommand: vi.fn(async () => null),
        correctTeamLeadPaneWidth: vi.fn(async () => false),
        terminateForeground: vi.fn(async () => false),
        readSessionName: vi.fn(async () => null),
        onData: noopUnsub,
        onExit: noopUnsub,
        onClosed: noopUnsub,
        onResync: noopUnsub,
        onSize: noopUnsub,
        supported: true,
        recycleConfirmed: true
      },
      workspace: {
        load: vi.fn(async () => ({ projects: [project], activeProjectId: project.id })),
        save: vi.fn(async () => undefined),
        onChanged: noopUnsub,
        onExternalChange: noopUnsub,
        onMigrated: noopUnsub,
        onCorruptRecovered: noopUnsub,
        userDataDir: vi.fn(async () => 'C:/agent-links-data'),
        commit: vi.fn(async () => undefined)
      },
      ssh: {
        ...stub.ssh,
        list: vi.fn(async () => [])
      },
      git: {
        status: vi.fn(async () => null),
        repoRoot: vi.fn(async () => null),
        setActiveRemote: vi.fn(async () => undefined)
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
      scheduledSettings: {
        load: vi.fn(async () => ({
          ok: true as const,
          file: { version: 1, timezone: 'UTC', rules: [] },
          error: null
        })),
        save: vi.fn(async () => ({ ok: true as const })),
        setHomeAssistantToken: vi.fn(async () => undefined),
        tokenStatus: vi.fn(async () => ({})),
        refreshRule: vi.fn(async () => undefined),
        activeState: vi.fn(async () => ({ computedAtMs: 0, active: null, sources: {} })),
        onActiveChange: noopUnsub
      },
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
      context: {
        onUpdate: noopUnsub,
        ensure: vi.fn()
      },
      canvas: {
        mutate: vi.fn(async () => undefined),
        onMutation: noopUnsub
      },
      onAgentStatus: noopUnsub,
      agentStatusSnapshot: vi.fn(async () => []),
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
    // Canvas imports the local-session bootstrap, which may have registered a placeholder local
    // entry before this test installs its bridge. Start from an empty registry so createSession
    // owns the exact bridge under test rather than reusing that earlier entry.
    resetSessionsForTest()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
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
    vi.stubGlobal('DOMMatrixReadOnly', class {
      m22 = 1
    })
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener(): void {},
      removeListener(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
      dispatchEvent(): boolean { return false }
    }))
    const project = createProject(0, 'Agent links', 'C:/agent-links')
    project.id = 'project-agent-links'
    project.nodes = [
      {
        id: 'source-node',
        kind: 'terminal',
        position: { x: 0, y: 0 },
        size: { width: 300, height: 180 }, title: 'Lead', color: '#d97757', group: null, agentId: 'claude', tags: []
      },
      {
        id: 'target-node',
        kind: 'terminal',
        position: { x: 400, y: 0 },
        size: { width: 300, height: 180 }, title: 'Reviewer', color: '#4f8cff', group: null, agentId: 'codex', tags: []
      },
      {
        id: 'plain-node',
        kind: 'terminal',
        position: { x: 800, y: 0 },
        size: { width: 300, height: 180 }, title: 'Plain terminal', color: '#8a8a8a', group: null, tags: []
      },
      {
        id: 'eligible-node',
        kind: 'terminal',
        position: { x: 1200, y: 0 },
        size: { width: 300, height: 180 }, title: 'Eligible reviewer', color: '#46a86b', group: null, agentId: 'gemini', tags: []
      }
    ]
    project.bridges = [{ id: 'bridge-source-node-target-node', source: 'source-node', target: 'target-node' }]
    const bridge = makeBridge(project)
    Object.defineProperty(window, 'nodeTerminal', { configurable: true, value: bridge })
    useProjects.setState({ projects: [project], activeProjectId: project.id, reloadNonce: 0 })
    // The real Canvas nests a project-resolved provider. A server-scoped test session avoids the
    // module-time local bootstrap entry while still exercising the same API and event listener.
    const session = createSession('server', bridge, 'Local')
    expect(session.api).toBe(bridge)
    setActiveSession(session.id)
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() =>
      root!.render(
        <SessionProvider session={session}>
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
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
