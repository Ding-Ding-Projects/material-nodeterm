import type { NotPermittedReason } from './agentMessageDecide'

/**
 * WHO MAY BE ADDRESSED — the project boundary, resolved off the SERIALIZED store, not the live
 * canvas. Ported from upstream's `src/core/agents/agent-message-scope.ts`.
 *
 * React Flow (`nodesRef`) only ever holds the ACTIVE project's nodes, while every other open
 * project's tmux sessions keep running underneath it. Resolving a target against `nodesRef` would
 * therefore answer "not found" for any node outside the current tab, and the fix is not to travel
 * to the target's project — this resolver takes the whole `projects` array and nothing else, so
 * there is nothing to travel toward.
 *
 * Node ids come out of `.nodeterm/project.json`, which nothing on the load path validates, so the
 * id is checked here FIRST, before project membership is even asked: an id containing the
 * `agentMessageFlow.ts` pair-key separator would collide two unrelated conversations, and an id
 * that cannot be sanitised the same way tmux's `sessionName()` does could name a different node's
 * session than the one displayed. Refused as `unaddressable-node-id`, never `cross-project` — such
 * an id may be sitting in the sender's OWN project file, so `cross-project` would misstate why the
 * send was refused.
 *
 * A duplicate target id across two projects is refused as `ambiguous-target-node-id` rather than
 * resolved to either: the messaging grant is per-project, and a hostile file for a granted project
 * that merely lists an ungranted project's node id must never let that id's ambiguity resolve in
 * the attacker's favor.
 */

const SAFE_NODE_ID = /^[A-Za-z0-9._-]+$/

export function isSafeNodeId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && SAFE_NODE_ID.test(id)
}

export interface ScopeProject {
  id: string
  nodes: readonly { id: string }[]
}

export type ScopeRefusal = Extract<
  NotPermittedReason,
  'self-send' | 'cross-project' | 'unaddressable-node-id' | 'ambiguous-target-node-id'
>

export type DeliveryScope =
  | { kind: 'same-project'; projectId: string }
  | {
      kind: 'refused'
      reason: ScopeRefusal
      /** Does the target id exist in ANY project the store knows? Separates "aimed at another
       *  project" from "aimed at nothing" for the human reading the refusal. */
      targetFound: boolean
    }

function ownersOf(projects: readonly ScopeProject[], nodeId: string): ScopeProject[] {
  return projects.filter((project) => project.nodes.some((node) => node.id === nodeId))
}

/** Resolve a (source, target) pair to the project they share, or the refusal that stops it. */
export function resolveDeliveryScope(
  projects: readonly ScopeProject[],
  sourceProjectId: string,
  sourceNodeId: string,
  targetNodeId: string
): DeliveryScope {
  if (!isSafeNodeId(sourceNodeId) || !isSafeNodeId(targetNodeId)) {
    return { kind: 'refused', reason: 'unaddressable-node-id', targetFound: false }
  }
  if (sourceNodeId === targetNodeId) {
    return { kind: 'refused', reason: 'self-send', targetFound: true }
  }
  const owners = ownersOf(projects, targetNodeId)
  if (owners.length === 0) return { kind: 'refused', reason: 'cross-project', targetFound: false }
  if (owners.length > 1) return { kind: 'refused', reason: 'ambiguous-target-node-id', targetFound: true }
  const owner = owners[0]
  if (owner.id !== sourceProjectId) return { kind: 'refused', reason: 'cross-project', targetFound: true }
  return { kind: 'same-project', projectId: owner.id }
}
