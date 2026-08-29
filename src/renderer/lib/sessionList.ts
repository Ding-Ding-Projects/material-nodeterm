import type { AgentNodeStatus } from '../state/agentStatus'
import type { AgentId, BuiltinAgentId } from '@shared/agents/config'
import type { NodeKind } from '@shared/types'
import type { ProjectIcon } from '@shared/project-icon'
import { hasUsage } from '@shared/agents/config'
import { sshHostKey, type SshConnection } from '@shared/ssh'
import { normWorktreePath } from '@shared/worktree-reconcile'
import type { WorktreeEntry } from '@shared/worktree'

export interface SessionNodeInput {
  id: string
  kind: NodeKind
  title: string
  color: string
  agentId?: AgentId
  agentBaseId?: BuiltinAgentId
  cwd?: string
  ssh?: SshConnection
  /** Parent group node id when this node lives inside a canvas group frame. */
  parentId?: string
}

export interface ProjectInput {
  id: string
  name: string
  color: string
  icon?: ProjectIcon
  cwd?: string
  /** SSH identity keeps a remote repository separate from a matching local path. */
  ssh?: { server: SshConnection; remoteCwd: string }
  nodes: SessionNodeInput[]
}

export type StatusKind = 'working' | 'attention' | 'done' | 'idle'

export const STATE_LABEL: Record<StatusKind, string> = {
  working: 'Running',
  attention: 'Needs you',
  done: 'Done',
  idle: 'Idle'
}

/** Disclosure key for a project row in the sessions tree. */
export function projectCollapseKey(projectId: string): string {
  return `project:${projectId}`
}

/** Disclosure key for a canvas group frame's row, scoped to its project. */
export function groupCollapseKey(projectId: string, groupId: string): string {
  return `project:${projectId}:group:${groupId}`
}

/**
 * Whether a project row is collapsed in the sessions sidebar. `settings.sidebarAutoCollapse`
 * only supplies the DEFAULT for a project the user never toggled: on (the default) keeps the
 * active project expanded and every other one collapsed, off leaves everything expanded. An
 * explicit toggle, recorded in `overrides` under `projectCollapseKey` (true = collapsed), always
 * wins — and since 2026-08 those choices are PERSISTED (`settings.sidebarCollapsedItems`), so a
 * project switch no longer discards them. Group rows are not defaulted at all: an untouched
 * frame is expanded, which is why `renderBucket` reads the map directly.
 */
export function isGroupCollapsed(
  overrides: Record<string, boolean>,
  key: string,
  isActive: boolean,
  autoCollapse = true
): boolean {
  if (key in overrides) return overrides[key]
  return autoCollapse ? !isActive : false
}

/**
 * Every disclosure key the current tree can address. `settings.sidebarCollapsedItems` is written
 * to `settings.json`, so without pruning it grows forever: one entry per project and per group
 * frame that ever existed, kept alive long after the node was deleted or the project closed.
 */
export function liveCollapseKeys(groups: SessionGroup[]): Set<string> {
  const keys = new Set<string>()
  const walk = (projectId: string, bucket: GroupBucket): void => {
    keys.add(groupCollapseKey(projectId, bucket.id))
    bucket.children.forEach((child) => walk(projectId, child))
  }
  for (const group of groups) {
    keys.add(projectCollapseKey(group.projectId))
    group.groups.forEach((bucket) => walk(group.projectId, bucket))
  }
  return keys
}

/**
 * Drops disclosure keys that no longer address a live project or frame. Returns the SAME object
 * when nothing would change, so a no-op toggle never marks settings dirty. `keepKey` is the key
 * being written right now — it is kept even if the tree is filtered and does not list it.
 */
export function pruneCollapsedItems(
  items: Record<string, boolean>,
  live: Set<string>,
  keepKey?: string
): Record<string, boolean> {
  const dead = Object.keys(items).filter((key) => key !== keepKey && !live.has(key))
  if (dead.length === 0) return items
  const next: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(items)) {
    if (key === keepKey || live.has(key)) next[key] = value
  }
  return next
}

/** What a left-click on a project header in the sessions sidebar does. */
export type ProjectHeadAction = 'switch' | 'toggle-collapse'

/**
 * A project header's click does exactly ONE of two things, and never both.
 *
 * - An INACTIVE project **switches** to that project and leaves its disclosure choice alone.
 *   Writing one here would discard the user's explicit choice — collapse choices are persisted
 *   (`settings.sidebarCollapsedItems`), so there is nothing transient to "helpfully" reset, and
 *   a project the user never toggled is expanded by default the moment it becomes active.
 * - The ACTIVE project **toggles its own collapse** — the pre-existing behavior of the whole
 *   header, kept so the row has no dead zone. Same persisted write as the chevron button.
 *
 * The chevron is the escape hatch either way: it toggles collapse on ANY row (it
 * stops propagation), so an inactive project can be peeked into without switching.
 */
export function projectHeadClickAction(isActive: boolean): ProjectHeadAction {
  return isActive ? 'toggle-collapse' : 'switch'
}

/**
 * Header badges for a project group: how many sessions need the user right now
 * (waiting/blocked), how many finished unseen, and how many are actively working right now.
 * Mirrors the row glyph's precedence — an attention session is never double-counted as unread,
 * and a working one isn't unread yet (a new turn is running; the old mark resurfaces when it ends).
 */
export function projectSignalCounts(group: SessionGroup): { attention: number; unread: number; working: number } {
  let attention = 0
  let unread = 0
  let working = 0
  for (const s of [...group.ungrouped, ...group.groups.flatMap(groupSessionRows)]) {
    if (s.statusKind === 'attention') attention++
    else if (s.unread && s.statusKind !== 'working') unread++
    if (s.statusKind === 'working') working++
  }
  return { attention, unread, working }
}

export function sessionStatusKind(state: AgentNodeStatus['state']): StatusKind {
  switch (state) {
    case 'working':
      return 'working'
    case 'waiting':
    case 'blocked':
      return 'attention'
    case 'done':
      return 'done'
    default:
      return 'idle'
  }
}

/**
 * Resolves the Cmd/Ctrl+N project shortcut: N is 1-based, matches sidebar/store array order.
 * Only 1-9 are addressable — out of range (including an empty or short project list) is null,
 * a silent no-op at the call site rather than a wraparound or error.
 */
export function projectIdAtIndex(projects: { id: string }[], oneBasedIndex: number): string | null {
  if (oneBasedIndex < 1 || oneBasedIndex > 9) return null
  const project = projects[oneBasedIndex - 1]
  return project ? project.id : null
}

export interface SessionRowVM {
  id: string
  title: string
  color: string
  agentId?: AgentId
  agentBaseId?: BuiltinAgentId
  isAgent: boolean
  statusKind: StatusKind
  stateLabel: string
  unread: boolean
  session?: string
  loop?: { kind: 'loop' | 'schedule' | 'cron'; count: number }
  cwd?: string
  sshHost?: string
  sessionId?: string
  usesContext: boolean
}

/** A canvas group frame, the sessions directly inside it, and the frames nested inside it. */
export interface GroupBucket {
  id: string
  title: string
  color: string
  sessions: SessionRowVM[]
  children: GroupBucket[]
}

export interface SessionGroup {
  projectId: string
  projectName: string
  projectColor: string
  projectIcon?: ProjectIcon
  cwd?: string
  isActive: boolean
  /** Canvas group frames in this project, each with its member sessions. */
  groups: GroupBucket[]
  /** Sessions not inside any canvas group. */
  ungrouped: SessionRowVM[]
}

function toRow(n: SessionNodeInput, status: AgentNodeStatus | undefined): SessionRowVM {
  const statusKind = sessionStatusKind(status?.state)
  return {
    id: n.id,
    title: n.title,
    color: n.color,
    agentId: n.agentId,
    agentBaseId: n.agentBaseId,
    isAgent: !!n.agentId,
    statusKind,
    stateLabel: STATE_LABEL[statusKind],
    unread: !!status?.unread,
    session: status?.session,
    // A dismissed cron/schedule entry is retained as a fact (the hibernation guard reads it) but
    // shows nowhere it did not show before — this chip included.
    loop:
      status?.loop && !status.loop.dismissed
        ? { kind: status.loop.kind, count: status.loop.count }
        : undefined,
    cwd: n.cwd,
    sshHost: n.ssh?.host,
    sessionId: status?.sessionId,
    usesContext: n.agentBaseId || n.agentId ? hasUsage(n.agentBaseId ?? n.agentId!) : false
  }
}

function matches(row: SessionRowVM, needle: string): boolean {
  const hay = `${row.title} ${row.session ?? ''}`.toLowerCase()
  return hay.includes(needle)
}

export function groupSessionRows(group: GroupBucket): SessionRowVM[] {
  return [...group.sessions, ...group.children.flatMap(groupSessionRows)]
}

export function groupSessionCount(group: GroupBucket): number {
  return group.sessions.length + group.children.reduce((sum, child) => sum + groupSessionCount(child), 0)
}

export function buildSessionList(
  projects: ProjectInput[],
  liveActiveNodes: SessionNodeInput[] | null,
  activeProjectId: string,
  statusById: Record<string, AgentNodeStatus>,
  filter: string
): SessionGroup[] {
  const needle = filter.trim().toLowerCase()
  const keep = (r: SessionRowVM): boolean => !needle || matches(r, needle)

  const groups: SessionGroup[] = projects.map((p) => {
    const isActive = p.id === activeProjectId
    const source = isActive && liveActiveNodes ? liveActiveNodes : p.nodes
    const groupNodes = source.filter((n) => n.kind === 'group')
    const groupById = new Map(groupNodes.map((n) => [n.id, n]))
    const terminals = source.filter((n) => n.kind === 'terminal')

    // A frame's parent, but only when that parent is a frame we know AND the chain terminates.
    // A cyclic parentId (hand-edited project.json, a bad merge) would otherwise recurse forever;
    // such a frame is treated as a root instead of crashing the sidebar.
    const parentFor = (group: SessionNodeInput): string | undefined => {
      if (!group.parentId || !groupById.has(group.parentId) || group.parentId === group.id) {
        return undefined
      }
      const seen = new Set<string>([group.id])
      let parentId: string | undefined = group.parentId
      while (parentId) {
        if (seen.has(parentId)) return undefined
        seen.add(parentId)
        parentId = groupById.get(parentId)?.parentId
      }
      return group.parentId
    }
    const childGroups = new Map<string, SessionNodeInput[]>()
    for (const group of groupNodes) {
      const parentId = parentFor(group)
      if (!parentId) continue
      const children = childGroups.get(parentId) ?? []
      children.push(group)
      childGroups.set(parentId, children)
    }
    const buildBucket = (gn: SessionNodeInput): GroupBucket | null => {
      const sessions = terminals
        .filter((n) => n.parentId === gn.id)
        .map((n) => toRow(n, statusById[n.id]))
        .filter(keep)
      const children = (childGroups.get(gn.id) ?? [])
        .map(buildBucket)
        .filter((bucket): bucket is GroupBucket => bucket !== null)
      // While filtering, a frame survives if it matches by NAME or still holds anything;
      // unfiltered, empty frames stay so they remain visible drop targets.
      const groupMatches = !!needle && gn.title.toLowerCase().includes(needle)
      if (needle && !groupMatches && sessions.length === 0 && children.length === 0) return null
      return { id: gn.id, title: gn.title, color: gn.color, sessions, children }
    }
    const buckets = groupNodes
      .filter((group) => !parentFor(group))
      .map(buildBucket)
      .filter((bucket): bucket is GroupBucket => bucket !== null)

    const ungrouped = terminals
      .filter((n) => !n.parentId || !groupById.has(n.parentId))
      .map((n) => toRow(n, statusById[n.id]))
      .filter(keep)

    return {
      projectId: p.id,
      projectName: p.name,
      projectColor: p.color,
      projectIcon: p.icon,
      cwd: p.cwd,
      isActive,
      groups: buckets,
      ungrouped
    }
  })

  // Store order, NOT active-first: the sidebar mirrors the tab bar (both read the projects
  // array), and hoisting the active project to the top made every click reshuffle the list.
  return needle ? groups.filter((g) => g.groups.length > 0 || g.ungrouped.length > 0) : groups
}

/** A worktree with no bound canvas group, shown as a bindable repository row. */
export interface AdoptableWorktreeRow {
  kind: 'adoptable-worktree'
  entry: WorktreeEntry
  repoRoot: string
}

/** A repository-level grouping above the existing project/session tree. */
export interface RepoGroup {
  key: string
  repoRoot: string | null
  repoName: string
  collapsedProject: boolean
  projects: SessionGroup[]
  adoptable: AdoptableWorktreeRow[]
}

export interface RepoSessionFacts {
  repoRootByProject: Record<string, string | null | undefined>
  orphansByProject: Record<string, WorktreeEntry[]>
}

function repoMachineKey(project: ProjectInput): string {
  return project.ssh ? sshHostKey(project.ssh.server) || '' : ''
}

/**
 * Wrap the established project/session list in repository groups. The five-argument
 * `buildSessionList` remains unchanged for existing consumers and tests; this adapter is used only
 * by the sidebar that has repository-root and orphan worktree facts available.
 */
export function buildRepoSessionList(
  projects: ProjectInput[],
  liveActiveNodes: SessionNodeInput[] | null,
  activeProjectId: string,
  statusById: Record<string, AgentNodeStatus>,
  filter: string,
  facts: RepoSessionFacts
): RepoGroup[] {
  const sessionGroups = buildSessionList(
    projects,
    liveActiveNodes,
    activeProjectId,
    statusById,
    ''
  )
  const needle = filter.trim().toLowerCase()
  const keepRow = (row: SessionRowVM): boolean =>
    !needle || `${row.title} ${row.session ?? ''}`.toLowerCase().includes(needle)
  const filterBucket = (bucket: GroupBucket): GroupBucket | null => {
    const sessions = bucket.sessions.filter(keepRow)
    const children = bucket.children
      .map(filterBucket)
      .filter((child): child is GroupBucket => child !== null)
    if (needle && !bucket.title.toLowerCase().includes(needle) && sessions.length === 0 && children.length === 0) return null
    return { ...bucket, sessions, children }
  }
  const filteredSessionGroups = needle
    ? sessionGroups
        .map((group) => ({
          ...group,
          groups: group.groups
            .map(filterBucket)
            .filter((bucket): bucket is GroupBucket => bucket !== null),
          ungrouped: group.ungrouped.filter(keepRow)
        }))
        .filter((group) =>
          group.groups.length > 0 ||
          group.ungrouped.length > 0 ||
          group.projectName.toLowerCase().includes(needle) ||
          (facts.orphansByProject[group.projectId] ?? []).some((worktree) =>
            `${worktree.branch ?? ''} ${worktree.path}`.toLowerCase().includes(needle)
          )
        )
    : sessionGroups
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const order: string[] = []
  const grouped = new Map<string, { repoRoot: string | null; sessions: SessionGroup[] }>()
  for (const sessionGroup of filteredSessionGroups) {
    const project = projectById.get(sessionGroup.projectId)
    const resolved = facts.repoRootByProject[sessionGroup.projectId]
    const fallbackProject: ProjectInput = {
      id: sessionGroup.projectId,
      name: sessionGroup.projectName,
      color: sessionGroup.projectColor,
      nodes: []
    }
    const key = resolved
      ? `repo:${repoMachineKey(project ?? fallbackProject)}:${normWorktreePath(resolved)}`
      : `repo:__norepo__:${sessionGroup.projectId}`
    const existing = grouped.get(key)
    if (existing) existing.sessions.push(sessionGroup)
    else {
      order.push(key)
      grouped.set(key, {
        repoRoot: resolved ? normWorktreePath(resolved) : null,
        sessions: [sessionGroup]
      })
    }
  }
  return order
    .map((key) => {
      const entry = grouped.get(key)!
      const sole = entry.sessions.length === 1 ? entry.sessions[0] : undefined
      const repoRoot = entry.repoRoot
      const project = sole ? projectById.get(sole.projectId) : undefined
      const cwd = project?.cwd ? normWorktreePath(project.cwd) : undefined
      const collapsedProject = !repoRoot || (!!sole && cwd === repoRoot)
      const active = entry.sessions.find((session) => session.isActive)
      const adoptable = active && repoRoot
        ? (facts.orphansByProject[active.projectId] ?? []).map((worktree) => ({
            kind: 'adoptable-worktree' as const,
            entry: worktree,
            repoRoot
          }))
        : []
      const repoName = repoRoot
        ? repoRoot.split('/').filter(Boolean).pop() || repoRoot
        : sole?.projectName || entry.sessions[0]?.projectName || 'Repository'
      return {
        key,
        repoRoot,
        repoName,
        collapsedProject,
        projects: entry.sessions,
        adoptable: needle
          ? adoptable.filter((row) => `${row.entry.branch ?? ''} ${row.entry.path}`.toLowerCase().includes(needle))
          : adoptable
      }
    })
    .filter((repo) => {
      if (!needle) return true
      return repo.adoptable.length > 0 || repo.projects.some((project) => project.groups.length > 0 || project.ungrouped.length > 0)
    })
}

/** Repository-aware variant of `liveCollapseKeys`, kept separate so old callers keep their type. */
export function liveRepoCollapseKeys(groups: RepoGroup[]): Set<string> {
  const keys = new Set<string>()
  const walk = (projectId: string, bucket: GroupBucket): void => {
    keys.add(groupCollapseKey(projectId, bucket.id))
    bucket.children.forEach((child) => walk(projectId, child))
  }
  for (const repo of groups) {
    keys.add(repo.key)
    for (const project of repo.projects) {
      keys.add(projectCollapseKey(project.projectId))
      project.groups.forEach((bucket) => walk(project.projectId, bucket))
    }
  }
  return keys
}

export function repoSignalCounts(repo: RepoGroup): { attention: number; unread: number; working: number } {
  return repo.projects.reduce(
    (total, project) => {
      const current = projectSignalCounts(project)
      return {
        attention: total.attention + current.attention,
        unread: total.unread + current.unread,
        working: total.working + current.working
      }
    },
    { attention: 0, unread: 0, working: 0 }
  )
}
