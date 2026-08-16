// Where a session picked from the SESSION-MEMORY PANEL has to be killed.
//
// The panel is the first surface in the app that lists sessions on a machine other than the one
// the renderer runs on: an SSH project's rows come from `ps` on the HOST. That makes the ordinary
// kill path a lie in exactly the cases the panel adds.
//
// `transport.destroy(nodeId)` reaches a REMOTE tmux session only through a LIVE local client that
// carries `sshRemote` (see `PtyManager.endSession`) — i.e. only for a node that is currently
// mounted. An ORPHAN row has no node at all, and a row owned by a non-active project has no live
// client either, so for both of those `destroy` touches only the local socket while the remote
// `nt-<id>` keeps running. The confirm would promise a kill it cannot perform, and the row would
// come back on the next refresh with no explanation.
//
// So the plan is decided by the SCOPE, not by the row: **the panel kills on the machine it is
// showing you.** On an SSH scope every row is a session on that host, so the kill additionally runs
// `tmux kill-session` over that project's own ControlMaster (`sshProject.killSessions`), which
// needs no live session. It is idempotent — a session already ended by `destroy` (the mounted case)
// is a best-effort miss on the host — so no case analysis is needed at the call site.

// KNOWN GAP, recorded in docs/session-memory.md's "Known gaps": the SESSIONS SIDEBAR still calls
// `closeSession` with no remote leg, so ending an unmounted SSH node's session there leaves the
// host's `nt-<id>` running after a confirm that said otherwise — the two surfaces now disagree
// about the same session. Its correct fix is owner-routed per row (the row's OWNER project's
// master, not the active project's, which is only sound here because the panel shows one machine
// at a time); reuse this file rather than adding a third kill path.

import type { CanvasNodeState, Project } from '@shared/types'
import { sessionForProject } from '../session/session'

export type SessionTerminationScope = 'node' | 'session-memory' | 'project-deletion'

type DestroySession = (
  nodeId: string,
  options?: { everySocket?: boolean }
) => void | Promise<void>
type KillRemoteSessions = (
  projectId: string,
  nodeIds: string[],
  options?: { everySocket?: boolean }
) => Promise<void>

/**
 * Apply the socket breadth promised by the initiating surface to one local transport kill.
 *
 * Session memory inventories both tmux sockets and therefore widens every row it offers, including
 * rows that still own a canvas node. Ordinary node/project deletion knows its own socket and must
 * omit the widening option entirely.
 */
export async function destroySessionForScope(
  scope: SessionTerminationScope,
  nodeId: string,
  destroy: DestroySession
): Promise<void> {
  if (scope === 'session-memory') await destroy(nodeId, { everySocket: true })
  else await destroy(nodeId)
}

/** The remote-host counterpart to `destroySessionForScope`, kept in the same behavior seam. */
export function killRemoteSessionsForScope(
  scope: SessionTerminationScope,
  projectId: string,
  nodeIds: string[],
  killSessions: KillRemoteSessions
): Promise<void> {
  return scope === 'session-memory'
    ? killSessions(projectId, nodeIds, { everySocket: true })
    : killSessions(projectId, nodeIds)
}

export interface SessionKillPlan {
  /**
   * The project whose canvas node must go too, or `null` when no project owns this session (an
   * orphan). Resolved against EVERY project, closed ones included — `closeProject` keeps its nodes.
   */
  ownerProjectId: string | null
  /**
   * The project whose ControlMaster must run the remote `tmux kill-session`, or `null` when the
   * scope is this machine. This is the ACTIVE project, never the owner: the panel shows one
   * machine at a time, and that machine is the active project's.
   */
  remoteProjectId: string | null
}

export interface SessionDestroyFailure {
  nodeId: string
  message: string
}

export interface SessionDestroyOutcome {
  confirmed: string[]
  failed: SessionDestroyFailure[]
}

export interface ProjectEndEpoch {
  projectId: string
  sessionId: string
}

/** Everything an asynchronously-confirmed close must keep from the moment its dialog opens.
 * Neither the active project nor a project's bound session is stable while the user considers a
 * confirmation, and resolving either again on Confirm can end a different canvas's session. */
export interface ProjectEndRequestEpoch<TScope, TNode extends { id: string }> {
  projectId: string
  scope: TScope
  targets: TNode[]
}

export function captureProjectEndRequest<TScope, TNode extends { id: string }>(
  projectId: string,
  scope: TScope,
  loadedProjectId: string | null,
  nodes: readonly TNode[],
  requestedIds: readonly string[]
): ProjectEndRequestEpoch<TScope, TNode> {
  const requested = new Set(requestedIds)
  return {
    projectId,
    scope,
    // An inactive project's ids are handled against its serialized store by the sidebar path. Do
    // not capture whichever other project's React Flow nodes happen to be mounted in that case.
    targets:
      loadedProjectId === projectId ? nodes.filter((node) => requested.has(node.id)) : []
  }
}

/** Where an acknowledged node end may be applied after an async request. The session id is the
 * ownership epoch: if the project was rebound while the request was pending, the acknowledgement
 * belongs to the old core and the current node must be retained. */
export function projectEndDestination(
  captured: ProjectEndEpoch,
  current: ProjectEndEpoch & { activeProjectId: string; loadedProjectId: string | null }
): 'live' | 'stored' | 'retain' {
  if (captured.projectId !== current.projectId || captured.sessionId !== current.sessionId)
    return 'retain'
  return current.activeProjectId === captured.projectId &&
    current.loadedProjectId === captured.projectId
    ? 'live'
    : 'stored'
}

/** A whole-project delete may land only on the exact project/session generation it enumerated.
 * Project mutators replace the record, so identity catches reopen/add/edit races without an
 * incomplete hand-maintained list of fields. */
export function projectDeleteGenerationCurrent(
  capturedProject: Project,
  currentProject: Project | undefined,
  capturedSessionId: string,
  currentSessionId: string
): boolean {
  return capturedProject === currentProject && capturedSessionId === currentSessionId
}

/** Persisted-canvas counterpart of Canvas's live React Flow removal. A deleted group frees its
 * direct children to root coordinates; every other confirmed id is simply filtered. */
export function removeAcknowledgedStoredNodes(
  nodes: readonly CanvasNodeState[],
  confirmedIds: ReadonlySet<string>
): CanvasNodeState[] {
  const groupPos = new Map(
    nodes
      .filter((node) => confirmedIds.has(node.id) && node.kind === 'group')
      .map((node) => [node.id, node.position])
  )
  return nodes
    .filter((node) => !confirmedIds.has(node.id))
    .map((node) =>
      node.parentId && groupPos.has(node.parentId)
        ? {
            ...node,
            parentId: undefined,
            position: {
              x: node.position.x + groupPos.get(node.parentId)!.x,
              y: node.position.y + groupPos.get(node.parentId)!.y
            }
          }
        : node
    )
}

/** Settle a batch without letting one rejected acknowledgement abandon the nodes after it. Only
 * `confirmed` ids may be removed from a canvas; every failed id stays present for a retry because
 * a disconnected request cannot tell whether the backing host saw the kill. */
export async function settleSessionDestroys(
  nodeIds: readonly string[],
  destroy: (nodeId: string) => Promise<void>
): Promise<SessionDestroyOutcome> {
  const settled = await Promise.all(
    nodeIds.map(async (nodeId) => {
      try {
        await destroy(nodeId)
        return { nodeId, ok: true as const }
      } catch (error) {
        return {
          nodeId,
          ok: false as const,
          message:
            error instanceof Error && error.message.trim()
              ? error.message
              : String(error || 'session host did not acknowledge the kill')
        }
      }
    })
  )
  return {
    confirmed: settled.filter((entry) => entry.ok).map((entry) => entry.nodeId),
    failed: settled
      .filter((entry): entry is Extract<(typeof settled)[number], { ok: false }> => !entry.ok)
      .map(({ nodeId, message }) => ({ nodeId, message }))
  }
}

/** Route a permanent end through the core that owns the project. A relay-bound canvas must never
 * fall back to the module-level local transport: an absent local session can acknowledge while the
 * real relay-host process keeps running. Resolve once at dispatch so a tab switch cannot move an
 * in-flight request to a different core. */
export function destroySessionForProject(
  projectId: string,
  nodeId: string,
  opts?: { everySocket?: boolean }
): Promise<void> {
  return sessionForProject(projectId).api.pty.destroy(nodeId, opts)
}

export function settleProjectSessionDestroys(
  projectId: string,
  nodeIds: readonly string[]
): Promise<SessionDestroyOutcome> {
  const api = sessionForProject(projectId).api
  return settleSessionDestroys(nodeIds, (nodeId) => api.pty.destroy(nodeId))
}

export function recycleSessionForProject(projectId: string, nodeId: string): Promise<void> {
  return sessionForProject(projectId).api.pty.recycle(nodeId)
}

export function settleProjectSessionRecycles(
  projectId: string,
  nodeIds: readonly string[]
): Promise<SessionDestroyOutcome> {
  const api = sessionForProject(projectId).api
  return settleSessionDestroys(nodeIds, (nodeId) => api.pty.recycle(nodeId))
}

export function planSessionKill(
  nodeId: string,
  projects: readonly Project[],
  activeProjectId: string
): SessionKillPlan {
  const owner = projects.find((p) => (p.nodes ?? []).some((n) => n.id === nodeId))
  const active = projects.find((p) => p.id === activeProjectId)
  return {
    ownerProjectId: owner?.id ?? null,
    // `active.ssh`, not `owner.ssh`: a local scope lists LOCAL sessions, and a local `nt-<id>`
    // whose node belongs to an SSH project is precisely the stranded local fallback that
    // `requireRemote` exists to prevent — killing it on the host would leave it running here.
    remoteProjectId: active?.ssh ? active.id : null
  }
}
