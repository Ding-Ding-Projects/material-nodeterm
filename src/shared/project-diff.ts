// Turning two canonical project-file snapshots into "what the user actually did".
//
// The project history (see docs/local-history.md and core/workspace-store.ts) already recorded a
// commit per save, but every one of them was labelled `Saved project X` with action `updated` —
// so the log said that something changed and never what, which is precisely the failure
// `settings-diff.ts` exists to avoid for settings. This is the same idea for a canvas: diff the
// two snapshots BY NODE ID, so adding a terminal reads as an add, closing one reads as a delete,
// and moving one reads as an edit.
//
// Pure and Electron-free, like `settings-diff.ts`: importable from core and the renderer alike and
// unit tested without a filesystem, a repo, or a running app.
//
// Deliberately structural rather than semantic. It reports node ids, kinds and titles because
// those are what a project file actually carries; it does not attempt to describe *why* a node's
// data changed. An honest "Edited 2 nodes (Build, Notes)" beats an invented sentence.

import type { HistoryAction } from './local-history'

/** The subset of a project file this diff reads. Everything else in the file is ignored rather
 *  than guessed at — a field this module does not understand must never produce a label claiming
 *  it does. */
interface DiffableProjectFile {
  name?: unknown
  nodes?: unknown
  kanban?: unknown
}

interface DiffableNode {
  id: string
  kind?: string
  title?: string
}

export interface ProjectChangeDescription {
  label: string
  /** Prioritised created → deleted → updated when one save carries several kinds of change, the
   *  same precedence `describeSettingsChange` uses, so the filter chips in the history panel stay
   *  comparable across domains. */
  action: HistoryAction
}

/** Parse defensively: a project file is user-editable JSON on disk and a git checkout can hand us
 *  anything. A snapshot we cannot read is `null`, which callers treat as "no diff to describe"
 *  rather than as an empty project (which would report every node as deleted). */
function parse(json: string | null | undefined): DiffableProjectFile | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' ? (value as DiffableProjectFile) : null
  } catch {
    return null
  }
}

function nodesOf(file: DiffableProjectFile | null): Map<string, DiffableNode> | null {
  if (!file) return null
  const raw = file.nodes
  if (!Array.isArray(raw)) return null
  const out = new Map<string, DiffableNode>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const node = entry as Record<string, unknown>
    const id = typeof node.id === 'string' ? node.id : null
    if (!id) continue
    out.set(id, {
      id,
      kind: typeof node.kind === 'string' ? node.kind : undefined,
      title: typeof node.title === 'string' ? node.title : undefined
    })
  }
  return out
}

/** A node's most useful name for a log line, in the order a human would reach for it. */
function nameOf(node: DiffableNode): string {
  return node.title?.trim() || node.kind || node.id
}

/** `a, b and c` — with a cap, because a bulk operation must not produce a commit subject the
 *  history panel has to truncate mid-word. */
function list(names: string[], cap = 3): string {
  if (names.length <= cap) {
    if (names.length <= 1) return names[0] ?? ''
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  return `${names.slice(0, cap).join(', ')} and ${names.length - cap} more`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Describe the change between two canonical project-file snapshots.
 *
 * Returns `null` when the two snapshots are byte-identical — an unchanged state records nothing,
 * the same rule `describeSettingsChange` follows, so the autosave cadence cannot manufacture a log
 * full of empty entries.
 *
 * `before === null` means this project has no recorded history yet (its first save, or the first
 * save since this process started): that is reported as a creation rather than as an edit of
 * nothing.
 */
export function describeProjectChange(
  before: string | null | undefined,
  after: string,
  projectName: string
): ProjectChangeDescription | null {
  if (before === after) return null
  if (before === null || before === undefined) {
    return { label: `Created project ${projectName}`, action: 'created' }
  }

  const beforeNodes = nodesOf(parse(before))
  const afterNodes = nodesOf(parse(after))
  if (!beforeNodes || !afterNodes) {
    // One side is unparseable or carries no node list. Say the honest generic thing rather than
    // reporting an unreadable snapshot as "every node deleted".
    return { label: `Saved project ${projectName}`, action: 'updated' }
  }

  const added: DiffableNode[] = []
  const removed: DiffableNode[] = []
  const changed: DiffableNode[] = []
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) added.push(node)
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) removed.push(node)
  }
  // A node present on both sides that is not byte-identical was edited — moved, resized, renamed,
  // recoloured, retagged. The snapshot is canonical (stable key order), so a re-serialisation
  // cannot masquerade as an edit.
  const beforeRaw = rawNodesById(before)
  const afterRaw = rawNodesById(after)
  if (beforeRaw && afterRaw) {
    for (const [id, node] of afterNodes) {
      if (!beforeNodes.has(id)) continue
      if (beforeRaw.get(id) !== afterRaw.get(id)) changed.push(node)
    }
  }

  const parts: string[] = []
  if (added.length) parts.push(`Added ${plural(added.length, 'node')} (${list(added.map(nameOf))})`)
  if (removed.length) {
    parts.push(`Deleted ${plural(removed.length, 'node')} (${list(removed.map(nameOf))})`)
  }
  if (changed.length) {
    parts.push(`Edited ${plural(changed.length, 'node')} (${list(changed.map(nameOf))})`)
  }

  if (parts.length === 0) {
    // The nodes are identical, so something else in the file moved: the project name, the kanban
    // board, the viewport. Name what we can rather than claiming a node changed.
    const beforeFile = parse(before)
    const afterFile = parse(after)
    if (beforeFile && afterFile && beforeFile.name !== afterFile.name) {
      return { label: `Renamed project to ${String(afterFile.name ?? projectName)}`, action: 'updated' }
    }
    if (JSON.stringify(beforeFile?.kanban) !== JSON.stringify(afterFile?.kanban)) {
      return { label: `Updated the board in ${projectName}`, action: 'updated' }
    }
    return { label: `Saved project ${projectName}`, action: 'updated' }
  }

  const action: HistoryAction = added.length ? 'created' : removed.length ? 'deleted' : 'updated'
  return { label: parts.join('; '), action }
}

/** id → the exact serialised bytes of that node in the snapshot, so an edit is detected without
 *  re-serialising (which could differ from the canonical form and report a phantom change). */
function rawNodesById(json: string): Map<string, string> | null {
  const file = parse(json)
  if (!file || !Array.isArray(file.nodes)) return null
  const out = new Map<string, string>()
  for (const entry of file.nodes) {
    if (!entry || typeof entry !== 'object') continue
    const id = (entry as Record<string, unknown>).id
    if (typeof id !== 'string') continue
    out.set(id, JSON.stringify(entry))
  }
  return out
}
