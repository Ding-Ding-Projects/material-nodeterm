import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useKidsMode } from '../state/kidsMode'
import {
  AGENT_LAUNCH_SURFACES,
  activeAgentLaunchPlan
} from '../state/permissionMode'
import { useProjects } from '../state/projects'
import { useSettings } from '../state/settings'
import type { CanvasNode } from '../state/workspace'
import {
  AGENT_NODE_DRAG_MIME,
  EXPLORER_FOLDER_DRAG_MIME,
  createAgentNodeForExplorerFolder,
  createTerminalNodeForExplorerFolder,
  hasDragType,
  readAgentNodeDrag,
  readExplorerFolderDrag,
  writeAgentNodeDrag,
  writeExplorerFolderDrag
} from './explorerNodeDrag'

class TestDragData {
  private readonly values = new Map<string, string>()

  get types(): string[] {
    return [...this.values.keys()]
  }

  getData(type: string): string {
    return this.values.get(type) ?? ''
  }

  setData(type: string, value: string): void {
    this.values.set(type, value)
  }
}

const localProject: Project = {
  id: 'local-project',
  name: 'Local',
  color: '#fff',
  cwd: 'C:\\project',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: []
}

const sshProject: Project = {
  ...localProject,
  id: 'ssh-project',
  name: 'SSH',
  cwd: undefined,
  ssh: {
    server: { host: 'box', user: 'dev' },
    remoteCwd: '/srv/project'
  }
}

function sourceAgent(agentId = 'claude'): CanvasNode {
  return {
    id: 'agent-source',
    type: 'terminal',
    position: { x: 20, y: 30 },
    data: {
      title: 'Source agent',
      color: '#fff',
      group: null,
      tags: [],
      agentId,
      cwd: 'C:\\old'
    }
  }
}

beforeEach(() => {
  useSettings.setState({ settings: DEFAULT_SETTINGS, hydrated: true })
  useKidsMode.setState({ enabled: false })
  useProjects.setState({ projects: [localProject], activeProjectId: localProject.id })
})

describe('Explorer node drag payloads', () => {
  it('uses two distinct namespaced types without borrowing the session or OS-file channels', () => {
    expect(AGENT_NODE_DRAG_MIME).toBe('application/x-nodeterm-agent-node')
    expect(EXPLORER_FOLDER_DRAG_MIME).toBe('application/x-nodeterm-folder')
    expect(new Set([AGENT_NODE_DRAG_MIME, EXPLORER_FOLDER_DRAG_MIME, 'text/plain', 'Files']).size).toBe(4)
  })

  it('round-trips only a bounded agent-node identity', () => {
    const transfer = new TestDragData()
    writeAgentNodeDrag(transfer as unknown as DataTransfer, 'agent-source')

    expect(hasDragType(transfer as unknown as DataTransfer, AGENT_NODE_DRAG_MIME)).toBe(true)
    expect(readAgentNodeDrag(transfer as unknown as DataTransfer)).toEqual({
      version: 1,
      nodeId: 'agent-source'
    })
    expect(transfer.types).toEqual([AGENT_NODE_DRAG_MIME])
  })

  it('round-trips the folder project and path without inventing an agent identity', () => {
    const transfer = new TestDragData()
    writeExplorerFolderDrag(transfer as unknown as DataTransfer, {
      projectId: 'ssh-project',
      path: '/srv/project/packages/ui'
    })

    expect(readExplorerFolderDrag(transfer as unknown as DataTransfer)).toEqual({
      version: 1,
      projectId: 'ssh-project',
      path: '/srv/project/packages/ui'
    })
    expect(transfer.types).toEqual([EXPLORER_FOLDER_DRAG_MIME])
  })

  it('refuses missing, malformed, and oversized payloads', () => {
    const transfer = new TestDragData()
    transfer.setData(AGENT_NODE_DRAG_MIME, '{nope')
    expect(readAgentNodeDrag(transfer as unknown as DataTransfer)).toBeNull()
    transfer.setData(AGENT_NODE_DRAG_MIME, JSON.stringify({ version: 1, nodeId: 'x'.repeat(5000) }))
    expect(readAgentNodeDrag(transfer as unknown as DataTransfer)).toBeNull()
    expect(readExplorerFolderDrag(transfer as unknown as DataTransfer)).toBeNull()
  })
})

describe('Explorer node creation', () => {
  it('adds the new production launch surface to the closed inventory', () => {
    expect(AGENT_LAUNCH_SURFACES).toContain('explorer-drop-agent')
  })

  it('creates a same-type local sibling without mutating the source node', () => {
    const source = sourceAgent('claude')
    const before = structuredClone(source)
    const launchPlan = activeAgentLaunchPlan('explorer-drop-agent', 'claude')
    const created = createAgentNodeForExplorerFolder({
      source,
      index: 4,
      project: localProject,
      path: 'C:\\project\\packages\\ui',
      center: { x: 400, y: 240 },
      launchPlan
    })

    expect(source).toEqual(before)
    expect(created?.data.agentId).toBe('claude')
    expect(created?.data.cwd).toBe('C:\\project\\packages\\ui')
    expect(created?.data.ssh).toBeUndefined()
  })

  it('stamps an SSH Explorer folder onto the correct remote machine for a new agent', () => {
    useProjects.setState({ projects: [sshProject], activeProjectId: sshProject.id })
    const created = createAgentNodeForExplorerFolder({
      source: sourceAgent('codex'),
      index: 1,
      project: sshProject,
      path: '/srv/project/packages/api',
      launchPlan: activeAgentLaunchPlan('explorer-drop-agent', 'codex')
    })

    expect(created?.data.agentId).toBe('codex')
    expect(created?.data.cwd).toBe('/srv/project/packages/api')
    expect(created?.data.ssh).toEqual(sshProject.ssh?.server)
    expect(created?.data.sshRemoteTmux).toBe(true)
  })

  it('creates a terminal, never an agent, for a folder dropped onto canvas', () => {
    const created = createTerminalNodeForExplorerFolder({
      index: 2,
      project: sshProject,
      path: '/srv/project/packages/docs',
      center: { x: 320, y: 180 }
    })

    expect(created.type).toBe('terminal')
    expect(created.data.agentId).toBeUndefined()
    expect(created.data.cwd).toBe('/srv/project/packages/docs')
    expect(created.data.ssh).toEqual(sshProject.ssh?.server)
    expect(created.data.sshRemoteTmux).toBe(true)
    expect(created.position).toEqual({
      x: 320 - Number(created.width) / 2,
      y: 180 - Number(created.height) / 2
    })
  })
})
