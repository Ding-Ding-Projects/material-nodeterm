import { describe, expect, it } from 'vitest'
import type { Workspace } from '../../shared/types'
import { serializeProjectsListWorkspace } from './projects-list-output'

describe('serializeProjectsListWorkspace', () => {
  it('strips machine-local execution state while preserving portable project and connection data', () => {
    const workspace: Workspace = {
      version: 2,
      activeProjectId: 'p1',
      projects: [{
        id: 'p1',
        name: 'Project',
        color: '#fff',
        viewport: { x: 1, y: 2, zoom: 0.5 },
        nodes: [{
          id: 'term-1',
          kind: 'terminal',
          position: { x: 10, y: 20 },
          size: { width: 640, height: 440 },
          title: 'Terminal',
          color: '#abc',
          group: null,
          shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
          terminalProfileId: 'wsl:Ubuntu 24.04',
          pendingLaunch: {
            after: ['term-dep-1'],
            launchId: '123e4567-e89b-42d3-a456-426614174000',
            launch: { kind: 'shell-command', command: 'local secret command' }
          },
          ssh: {
            host: 'example.test',
            user: 'me',
            port: 2222,
            extraArgs: '-o ProxyCommand=corp-proxy %h',
            execTrusted: true
          }
        }]
      }]
    }

    const serialized = serializeProjectsListWorkspace(workspace)
    const parsed = JSON.parse(serialized)
    expect(parsed.activeProjectId).toBe('p1')
    expect(parsed.projects[0]).toMatchObject({ name: 'Project', viewport: { x: 1, y: 2, zoom: 0.5 } })
    expect(parsed.projects[0].nodes[0].shell).toBeUndefined()
    expect(parsed.projects[0].nodes[0].terminalProfileId).toBeUndefined()
    expect(parsed.projects[0].nodes[0].pendingLaunch).toBeUndefined()
    expect(parsed.projects[0].nodes[0].ssh).toEqual({
      host: 'example.test', user: 'me', port: 2222
    })
    // Pure: the host renderer's local workspace keeps its overlay.
    expect(workspace.projects[0].nodes[0].terminalProfileId).toBe('wsl:Ubuntu 24.04')
    expect(workspace.projects[0].nodes[0].pendingLaunch?.launch.kind).toBe('shell-command')
  })
})
