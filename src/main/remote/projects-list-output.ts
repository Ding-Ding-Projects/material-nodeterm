import { stripSharedNodeExec } from '../../shared/node-exec'
import type { Workspace } from '../../shared/types'

/**
 * Serialize the assembled workspace exposed by the desktop `projects.list` relay RPC.
 *
 * `WorkspaceStore.load()` intentionally re-attaches this machine's execution overlay for the local
 * renderer. A phone/peer listing projects must receive the portable canvas instead, so strip those
 * values again at the final wire boundary without mutating the live workspace.
 */
export function serializeProjectsListWorkspace(workspace: Workspace): string {
  return JSON.stringify({
    ...workspace,
    projects: workspace.projects.map((project) => ({
      ...project,
      nodes: stripSharedNodeExec(project.nodes)
    }))
  })
}
