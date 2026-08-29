import { describe, it, expect } from 'vitest'
import { sanitizeWorkspaceForRelay, scopeWorkspaceToProject } from './relay-workspace-scope'
import type { Project, Workspace } from './types'

const project = (id: string): Project => ({
  id,
  name: id,
  color: '#fff',
  nodes: [],
  viewport: { x: 0, y: 0, zoom: 1 }
})

const executionNode = () => ({
  id: 'term-1',
  kind: 'terminal' as const,
  position: { x: 12, y: 34 },
  size: { width: 640, height: 360 },
  title: 'Local terminal',
  color: '#123456',
  group: null,
  cwd: 'C:\\work\\project',
  shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  terminalProfileId: 'wsl:Ubuntu 24.04',
  pendingLaunch: {
    after: ['term-dep-1'],
    launchId: '123e4567-e89b-42d3-a456-426614174000',
    launch: { kind: 'shell-command' as const, command: 'local secret command' }
  },
  ssh: {
    host: 'example.internal',
    user: 'alice',
    port: 2222,
    extraArgs: '-o ProxyCommand=corp-proxy %h',
    execTrusted: true
  }
})

const ws = (): Workspace => ({
  version: 2,
  activeProjectId: 'a',
  projects: [project('a'), project('b'), project('c')]
})

describe('scopeWorkspaceToProject', () => {
  it('keeps only the named project and points activeProjectId at it', () => {
    const scoped = scopeWorkspaceToProject(ws(), 'b')
    expect(scoped.projects.map((p) => p.id)).toEqual(['b'])
    expect(scoped.activeProjectId).toBe('b')
  })

  it('returns an empty-projects workspace when the id is gone', () => {
    const scoped = scopeWorkspaceToProject(ws(), 'missing')
    expect(scoped.projects).toEqual([])
    expect(scoped.activeProjectId).toBe('')
  })

  it('preserves every other top-level workspace field as-is', () => {
    const scoped = scopeWorkspaceToProject(ws(), 'b')
    expect(scoped.version).toBe(2)
  })

  it('does not mutate the input workspace', () => {
    const input = ws()
    scopeWorkspaceToProject(input, 'b')
    expect(input.projects.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(input.activeProjectId).toBe('a')
  })

  it('strips machine-local execution fields from the selected project', () => {
    const input = ws()
    input.projects[1].nodes = [executionNode()]

    const scoped = scopeWorkspaceToProject(input, 'b')
    const node = scoped.projects[0].nodes[0]
    expect(node).toMatchObject({
      id: 'term-1',
      title: 'Local terminal',
      cwd: 'C:\\work\\project',
      ssh: { host: 'example.internal', user: 'alice', port: 2222 }
    })
    expect(node.shell).toBeUndefined()
    expect(node.terminalProfileId).toBeUndefined()
    expect(node.pendingLaunch).toBeUndefined()
    expect(node.ssh?.extraArgs).toBeUndefined()
    expect(node.ssh?.execTrusted).toBeUndefined()
  })
})

describe('sanitizeWorkspaceForRelay', () => {
  it('sanitizes every project without changing ordinary workspace, project, or node data', () => {
    const input = ws()
    input.projects[0].cwd = 'C:\\work\\a'
    input.projects[0].nodes = [executionNode()]
    input.projects[2].nodes = [{ ...executionNode(), id: 'term-2', title: 'Second terminal' }]

    const safe = sanitizeWorkspaceForRelay(input)

    expect(safe.activeProjectId).toBe('a')
    expect(safe.projects.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(safe.projects[0]).toMatchObject({ id: 'a', cwd: 'C:\\work\\a' })
    expect(safe.projects[0].nodes[0]).toMatchObject({
      id: 'term-1',
      title: 'Local terminal',
      position: { x: 12, y: 34 },
      cwd: 'C:\\work\\project',
      ssh: { host: 'example.internal', user: 'alice', port: 2222 }
    })
    for (const node of [safe.projects[0].nodes[0], safe.projects[2].nodes[0]]) {
      expect(node.shell).toBeUndefined()
      expect(node.terminalProfileId).toBeUndefined()
      expect(node.pendingLaunch).toBeUndefined()
      expect(node.ssh?.extraArgs).toBeUndefined()
      expect(node.ssh?.execTrusted).toBeUndefined()
    }
  })

  it('leaves the host workspace and its renderer-local node state intact', () => {
    const local = executionNode()
    const input = ws()
    input.projects[0].nodes = [local]

    const safe = sanitizeWorkspaceForRelay(input)

    expect(safe).not.toBe(input)
    expect(safe.projects[0]).not.toBe(input.projects[0])
    expect(safe.projects[0].nodes[0]).not.toBe(local)
    expect(local.shell).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    expect(local.terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(local.pendingLaunch.launch.command).toBe('local secret command')
    expect(local.ssh?.extraArgs).toBe('-o ProxyCommand=corp-proxy %h')
    expect(local.ssh?.execTrusted).toBe(true)
  })
})
