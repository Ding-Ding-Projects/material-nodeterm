import type { Workspace } from './types'
import { stripSharedNodeExec } from './node-exec'

/**
 * Remove machine-local execution choices from a workspace before it crosses a relay boundary.
 *
 * A workspace loaded by the trusted host contains values restored from its machine-local index
 * (`shell`, `terminalProfileId`, and trusted SSH arguments). They are legitimate in the host's
 * renderer, but are neither shared project data nor meaningful on the peer's machine. Sending
 * them would also let a later peer upsert echo a locally trusted execution value back over the
 * wire. Keep the host object untouched and sanitize only the copy being returned to the peer.
 */
export function sanitizeWorkspaceForRelay(ws: Workspace): Workspace {
  return {
    ...ws,
    projects: ws.projects.map((project) => ({
      ...project,
      nodes: stripSharedNodeExec(project.nodes)
    }))
  }
}

/**
 * Narrow a Workspace to the single project a relay hosting session shares with its peer.
 *
 * Returns a Workspace containing ONLY the project whose `id === projectId`, with
 * `activeProjectId` pointing at it. If no project matches (it was deleted/closed since
 * hosting started), the projects list is empty and `activeProjectId` is `''`. Every other
 * top-level field is carried through untouched. This only ever NARROWS — it can never expose
 * a project the source workspace did not already contain. Pure (does not mutate the input).
 */
export function scopeWorkspaceToProject(ws: Workspace, projectId: string): Workspace {
  const safe = sanitizeWorkspaceForRelay(ws)
  const projects = safe.projects.filter((p) => p.id === projectId)
  return { ...safe, projects, activeProjectId: projects.length > 0 ? projectId : '' }
}
