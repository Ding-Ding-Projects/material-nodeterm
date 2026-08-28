// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeTerminalApi, Project } from '@shared/types'
import { SessionProvider, type WorkspaceSession } from '../session/session'
import { useProjects } from '../state/projects'
import { useSettings } from '../state/settings'
import { useWorktrees } from '../state/worktrees'
import { SessionsSidebar } from './SessionsSidebar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalProjects = useProjects.getState().projects
const originalActiveProjectId = useProjects.getState().activeProjectId
const originalSettings = useSettings.getState().settings
const originalBase = useSettings.getState().base
let root: Root | undefined
let host: HTMLDivElement | undefined

const project: Project = {
  id: 'project-default-terminal',
  name: 'Default profile project',
  color: '#fff',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: []
}

const session: WorkspaceSession = {
  id: 'local',
  source: 'local',
  label: 'This device',
  status: 'connected',
  // The fixture has no cwd, so the sidebar never needs a Git call. The API remains deliberately
  // empty: terminal creation is a renderer callback and this test must not accidentally exercise
  // a different host boundary.
  api: {} as NodeTerminalApi
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  useProjects.setState({ projects: originalProjects, activeProjectId: originalActiveProjectId })
  useSettings.setState({ settings: originalSettings, base: originalBase })
})

describe('SessionsSidebar terminal creation', () => {
  it('keeps the project plus button a default-only one-click action', () => {
    useProjects.setState({ projects: [project], activeProjectId: project.id })
    useWorktrees.setState({ repoRootByProject: { [project.id]: 'C:/projects/default' } })
    const onAddToProject = vi.fn<(projectId: string) => void>()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    act(() =>
      root?.render(
        <SessionProvider session={session}>
          <SessionsSidebar
            open
            pinned={false}
            liveActiveNodes={[]}
            onTogglePin={() => {}}
            onClose={() => {}}
            onFocusNode={() => {}}
            onCloseSession={() => {}}
            onRenameSession={() => {}}
            onAiNameSession={() => {}}
            onRowContextMenu={() => {}}
            onProjectContextMenu={() => {}}
            onSwitchProject={() => {}}
            onAddToProject={onAddToProject}
            onMoveToGroup={() => {}}
            onAiNameGroup={() => {}}
            onReorder={() => {}}
            onReorderGroup={() => {}}
            onReorderProject={() => {}}
          />
        </SessionProvider>
      )
    )

    const add = host.querySelector<HTMLButtonElement>(
      'button[title="Add a node to this project"]'
    )
    expect(add).not.toBeNull()
    act(() => add?.click())

    expect(onAddToProject).toHaveBeenCalledOnce()
    expect(onAddToProject).toHaveBeenCalledWith(project.id, expect.objectContaining({ clientX: 0, clientY: 0 }))
  })
})
