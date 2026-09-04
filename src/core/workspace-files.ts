import path from 'path'
import type { AgentPermissionMode } from '../shared/agents/config'
import { collisionSeed, derivedProjectId, legacyFileId } from '../shared/project-id'
import {
  applyLocalNodeExec,
  localNodeExec,
  stripSharedNodeExec,
  type LocalNodeExecMap
} from '../shared/node-exec'
import type {
  BridgeLink,
  BrowserProfile,
  DebugBrowserProfile,
  CanvasNodeState,
  Link,
  NavStop,
  Project,
  ProjectMultiverseCanvas,
  ProjectChildCanvas,
  ProjectPortalState,
  ProjectKanban,
  SavedCanvasLayout,
  Viewport,
  Workspace
} from '../shared/types'
import { sanitizeMultiverseCanvases } from '../shared/multiverse-canvases'
import { projectCapabilityFields, readProjectCapabilities } from '../shared/project-capabilities'
import type { CapabilityAckMap } from '../shared/project-capability-consent'
import { sanitizeProjectIcon, type ProjectIcon } from '../shared/project-icon'
import { loadedAgentBrowserPartition } from '../shared/browser-partition'
import { validatePortableDoorConstruction } from '../shared/door-construction'
import { validateCalendarConfig } from '../shared/calendar'
import { normalizeDebugBrowserProfiles } from '../shared/browser-debug-sessions'
import { sanitizeTriggerSpec } from '../shared/trigger'
import { sanitizeProviderBlueprint, validateProviderBlueprint, type ProviderBinding, type ProviderBlueprint } from '../shared/provider-accounts'

/**
 * Drop a browser node's persisted `partition` unless it is exactly the jar THIS project (its
 * machine-local id) would mint. `project.json` is hostile input and `partition` is copied straight
 * to `<webview partition>`, so a foreign/cloned/unsafe stored value is jar forgery; it falls back to
 * the un-owned default session. Non-browser nodes and un-partitioned browser nodes are untouched.
 * See `loadedAgentBrowserPartition`. Pure and side-effect free (only clones the nodes it changes).
 */
function sanitizeBrowserPartitions(nodes: CanvasNodeState[], projectId: string): CanvasNodeState[] {
  return nodes.map((n) => {
    if (n.kind !== 'browser' || n.partition === undefined) return n
    const safe = loadedAgentBrowserPartition(n.partition, projectId)
    if (safe === n.partition) return n
    const { partition: _dropped, ...rest } = n
    return safe === undefined ? rest : { ...rest, partition: safe }
  })
}

/** Keep calendar node data to the portable allowlist at every project-file boundary. */
function sanitizeCalendarConfigs(nodes: CanvasNodeState[]): CanvasNodeState[] {
  return nodes.map((n) => n.kind === 'calendar' && n.calendarConfig
    ? { ...n, calendarConfig: validateCalendarConfig(n.calendarConfig) }
    : n)
}

/** Sanitize trigger definitions at every shared project boundary. A trigger definition is
 * content only, never local execution consent. Invalid or misplaced definitions become inert. */
export function sanitizeNodeTriggers(nodes: CanvasNodeState[]): CanvasNodeState[] {
  return nodes.map((node) => {
    if (node.trigger === undefined) return node
    if (node.kind === 'trigger') {
      const safe = sanitizeTriggerSpec(node.trigger)
      if (safe) return { ...node, trigger: safe }
    }
    const { trigger: _dropped, ...rest } = node
    return rest
  })
}

export const PROJECT_DIR = '.nodeterm'
export const PROJECT_FILE = 'project.json'

/**
 * Lift legacy bridge and rope arrays into the unified link substrate while reading a project.
 *
 * Bridge ids and rope ids remain unchanged so existing edge identity and deduplication survive
 * the migration. Ropes are explicitly marked display-only, preserving their historical
 * non-context semantics. An already-written links array wins over stale legacy fields, and an
 * empty legacy canvas stays empty so loading it does not create a needless file change.
 */
export function migrateLinks(f: {
  links?: Link[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}): Link[] | undefined {
  if (f.links) return f.links
  const out: Link[] = []
  for (const bridge of f.bridges ?? []) {
    out.push({
      id: bridge.id,
      kind: 'context',
      source: { ref: 'node', nodeId: bridge.source },
      target: { ref: 'node', nodeId: bridge.target }
    })
  }
  for (const rope of f.ropes ?? []) {
    out.push({
      id: rope.id,
      kind: 'lineage',
      source: { ref: 'node', nodeId: rope.source },
      target: { ref: 'node', nodeId: rope.target },
      meta: { displayOnly: true }
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * On-disk shape of <cwd>/.nodeterm/project.json — a GIT-SHARED document (users are asked to
 * commit it so the canvas travels with the repo).
 *
 * It carries CONTENT ONLY. Nothing in here may be state two machines opening the same repo would
 * legitimately disagree about, because git copies this file verbatim: `git worktree add`, a branch
 * checkout, `reset --hard` or a `stash pop` re-materialise every field into a second folder. That
 * is how one machine's project `id` came to name two folders — two tabs answering to one id, the
 * active canvas written into both, then flushed into the other folder's file (field corruption,
 * 2026-08). Machine-local state lives in the machine-local index instead (`IndexEntryV3`).
 *
 * No `cwd` field — the containing folder IS the cwd (that's what makes the folder relocatable).
 * Node cwds inside the root are stored relative ("./sub").
 */
export interface ProjectFileV1 {
  version: 1
  /** Monotonic save counter; picks a winner when an offline cache and the file diverge (SSH). */
  rev: number
  savedAt: string
  /**
   * LEGACY, and never identity. Written as a machine-INDEPENDENT value (`legacyFileId`) purely so
   * a build older than this one still accepts the file instead of sidelining it to `.corrupt-<ts>`
   * inside the user's repo; ignored on read — the index entry says who this project is. Optional
   * because a newer writer may already have dropped it, and because the SSH branch still puts its
   * entry id here as an opaque lineage marker (see `splitWorkspace` / `reconcileSsh`).
   */
  id?: string
  name: string
  color: string
  /** Sanitized on the way in (`fileToProject`) and only ever emitted when valid
   *  (`projectToFile`) — see `sanitizeProjectIcon`. An off/invalid icon adds no bytes to the
   *  committed file. */
  /** Sanitized on the way in (`fileToProject`) and only ever emitted when valid (`projectToFile`) —
   *  see `sanitizeProjectIcon`. An off/invalid icon adds no bytes to the committed file. */
  icon?: ProjectIcon
  /**
   * NOT a camera any more — a SUGGESTED one, derived from where the canvas's own nodes sit
   * (`framingViewport`).
   *
   * This user's actual camera is machine-local (a pan is not an edit two people share, yet it
   * dirtied the committed file on every gesture) and rides `IndexEntryV3.viewport`. What is
   * written here is a function of the content, so it is identical on every machine, and it is
   * still written at all because a pre-change build REQUIRES the field — without it that build
   * renders the project with `viewport.zoom` undefined and takes the canvas down.
   *
   * On read it is a fallback only: the index entry wins, and a pre-change file's real camera is
   * inherited once on the way into the index.
   */
  viewport?: Viewport
  nodes: CanvasNodeState[]
  /** Named portable canvas arrangements. Runtime sessions and machine paths are never stored. */
  savedLayouts?: SavedCanvasLayout[]
  /** Unified typed links written by current builds. Legacy arrays remain read-only migration input. */
  links?: Link[]
  /** Safe shared hierarchy. Runtime selection remains machine-local and is never written here. */
  multiverseCanvases?: ProjectMultiverseCanvas[]
  /** Schema 3 child-canvas content. These fields contain safe presentation only. */
  childCanvases?: ProjectChildCanvas[]
  portals?: ProjectPortalState[]
  /** LEGACY read-only migration source; new writes emit `links` instead. */
  bridges?: BridgeLink[]
  /** LEGACY read-only migration source; new writes emit `links` instead. */
  ropes?: BridgeLink[]
  /**
   * LEGACY (read-only), same rule as `viewport`: a managed Claude account id names a credential
   * dir under THIS machine's userData ({userData}/claude-accounts/<id>), so a teammate's copy of
   * the file pointed at an account that does not exist for them. It rides
   * `IndexEntryV3.defaultAccountId` now; still read once for a file this machine has not seen.
   */
  defaultAccountId?: string
  defaultPermissionMode?: AgentPermissionMode
  /**
   * Per-project capability switch (see @shared/project-capabilities): deliberately IN the
   * git-shared file — the team shares the policy — which is exactly why reads are strict
   * (`readProjectCapabilities`, literal `true` only) and why the switch alone grants nothing.
   */
  agentBrowserControl?: boolean
  /** Per-project capability switch (@shared/project-capabilities): agents may message other agent
   *  nodes in this project. Git-shared like `agentBrowserControl`, read with the same strictness. */
  agentMessaging?: boolean
  dinoHighScore?: number
  kanban?: ProjectKanban
  /** Named browser profiles — see `BrowserProfile` in `../shared/types` and
   *  `shared/browser-profiles.ts`. Names only; the cookie jar is machine-local. */
  browserProfiles?: BrowserProfile[]
  /** Safe debugging-browser profiles. Local proxy credentials, certificates and runtime state are omitted. */
  debugBrowserProfiles?: DebugBrowserProfile[]
  /** Portable provider intent only. Credentials and machine-local bindings stay out of this file. */
  providerBlueprints?: ProviderBlueprint[]
}

/** One workspace.json v3 entry. Exactly one of: `cwd` (local ref), `ssh` (remote ref),
 *  `project` (inline, cwd-less canvas). name/color are a cached header so an
 *  unavailable ref still renders a labeled grey tab. `cache` (ssh only) is the last
 *  ProjectFileV1 seen/written — used while the server is unreachable. */
export interface IndexEntryV3 {
  /**
   * THE project id — this machine's, and the only authority for it. It is minted here (a new
   * project, or `probeFolder`'s adoption of a folder) and never read back out of the shared
   * project file, which is what makes two copies of one canvas two independent projects.
   */
  id: string
  /** Stable machine-local trust identity. Never copied into the shared project file. */
  localApprovalId?: string
  name: string
  color: string
  closed?: boolean
  /** MACHINE-LOCAL camera for a ref'd project (local folder or ssh). Where this user is looking is
   *  not something a repo shares — the file's copy churned the git diff on every pan. */
  viewport?: Viewport
  /** MACHINE-LOCAL default managed Claude account for a ref'd project: the id names a credential
   *  dir in THIS machine's userData, so it is meaningless in anyone else's checkout. */
  defaultAccountId?: string
  /**
   * MACHINE-LOCAL record that this machine's user has answered each capability switch for THIS
   * entry (the one-time clone notice, @shared/project-capability-consent). Never copied into
   * the shared project file — a repo must not be able to carry its own consent — and keyed to
   * the entry, so a second worktree of the same repo (a second entry) notifies again, on purpose.
   */
  capabilityAck?: CapabilityAckMap
  /** MACHINE-LOCAL camera navigation history for a ref'd project. Same rule as `viewport`: this
   *  user's "where was I" is not something a repo shares. See NavStop. */
  breadcrumbs?: NavStop[]
  /** Sparse machine-local project settings overlay. Never serialized into ProjectFileV1. */
  settingsOverrides?: Project['settingsOverrides']
  cwd?: string
  ssh?: Project['ssh']
  cache?: ProjectFileV1
  project?: Project
  /** MACHINE-LOCAL per-node exec values (`shell`, `ssh.extraArgs`) for a ref'd project. They are
   *  stripped from the shared project file precisely so a cloned/hostile one cannot run code
   *  (@shared/node-exec), and kept here — in userData, never git-shared — so the user's own custom
   *  shell / advanced ssh args still survive a restart. Inline (`project`) entries need none: they
   *  live in this same machine-local file already. */
  localExec?: LocalNodeExecMap
  /**
   * The one-time exec migration has completed for this entry: its shared project file was readable
   * and therefore could be loaded through the strip boundary and rewritten without machine-local
   * execution fields. No value is harvested from that file; only a pre-existing `localExec` above
   * is trusted.
   * MACHINE-LOCAL settings overlay for this entry — the half of the project settings that is NOT
   * git-shared (`.nodeterm/settings.json` is the shared half). Same rule as `localExec`: it lives in
   * userData because a shell, a launch command or an env var this user chose for THIS checkout is
   * not something a repo may carry — and, read the other way, a repo may not put values here.
   * Re-sanitized on every load (`sanitizeProjectLocalSettings`): workspace.json is hand-editable,
   * so what comes back out of it is input, not state we wrote.
   */
  localSettings?: import('../shared/project-settings').ProjectLocalSettings
  /** The last shared settings.json seen for an SSH entry — the settings twin of `cache`, used while
   *  the server is unreachable. Never set for a local/inline entry (their shared doc is one disk
   *  read away). Validated on load by re-parsing it, exactly like a file read off the remote host:
   *  what sits in workspace.json is no more trusted than what sits on the server. */
  settingsCache?: import('../shared/project-settings').ProjectSettingsFileV1
  /**
   * The one-time exec migration has run for this entry: its project file has been searched once for
   * the exec values it carried from BEFORE the trust boundary existed (a jump host's `ProxyCommand`
   * put there by `createSshTerminalNode`), and they were hoisted into `localExec` above.
   *
   * Absent = not migrated yet. Set on the first save after the upgrade for every entry whose file we
   * could actually READ — an entry that was unavailable at that moment stays unmarked, so its file
   * is stripped when the folder/server comes back. A folder adopted AFTER the upgrade is written
   * with the flag already set. See `WorkspaceStore.execOverlay`.
   */
  execMigrated?: boolean
  /** Machine-local links from this project to portable provider blueprints. */
  providerBindings?: ProviderBinding[]
}

export interface WorkspaceIndexV3 {
  version: 3
  activeProjectId: string
  entries: IndexEntryV3[]
}

const isUnder = (p: string, root: string): boolean => {
  const rel = path.relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Rewrites node cwds under `root` to portable "./…" form; other paths untouched. */
export function toPortableNodes(nodes: CanvasNodeState[], root: string): CanvasNodeState[] {
  return nodes.map((n) => {
    if (!n.cwd || !isUnder(n.cwd, root)) return n
    const rel = path.relative(root, n.cwd)
    return { ...n, cwd: rel === '' ? '.' : `./${rel.split(path.sep).join('/')}` }
  })
}

/** Resolves portable "./…" node cwds against `root`; absolute cwds pass through. */
export function resolveNodes(nodes: CanvasNodeState[], root: string): CanvasNodeState[] {
  return nodes.map((n) => {
    if (!n.cwd || !(n.cwd === '.' || n.cwd.startsWith('./'))) return n
    return { ...n, cwd: n.cwd === '.' ? root : path.join(root, n.cwd.slice(2)) }
  })
}

/**
 * The project as it is written to the SHARED file: content only.
 *
 * Dropped on the way out, because a second machine opening the same repo would legitimately
 * disagree about them: the project `id` (identity — see `IndexEntryV3.id`), the `viewport` (this
 * user's camera) and `defaultAccountId` (a credential dir under this userData). Kept, because a
 * team genuinely shares them: name, color, nodes, links, the kanban board, the permission
 * default, the dino record.
 *
 * The two fields a pre-change build cannot do without are still emitted, as machine-INDEPENDENT
 * stand-ins: `id` (`legacyFileId`, derived from the name — it refuses a file without one) and
 * `viewport` (`framingViewport`, derived from the nodes — it dereferences the field unguarded).
 * Both are functions of content, so every machine writes the same bytes. Override `id` only where
 * the file is NOT a git-copied artifact and something still reads it as a lineage marker (the ssh
 * mirror; see `splitWorkspace`).
 */
export function projectToFile(
  p: Project,
  rev: number,
  savedAt: string,
  id: string = legacyFileId(p.name)
): ProjectFileV1 {
  // The project file is a SHARED document (git, or the remote host). Exec-enabling node fields
  // (`shell`, `ssh.extraArgs`) never leave this machine in it — they ride the machine-local index
  // entry instead (`localNodeExec` / `IndexEntryV3.localExec`). See @shared/node-exec.
  const nodes = sanitizeNodeTriggers(sanitizeCalendarConfigs(stripSharedNodeExec(p.cwd ? toPortableNodes(p.nodes, p.cwd) : p.nodes)))
  const multiverseCanvases = sanitizeMultiverseCanvases(p.multiverseCanvases)?.map((canvas) => ({
    ...canvas,
    nodes: sanitizeNodeTriggers(sanitizeCalendarConfigs(stripSharedNodeExec(p.cwd ? toPortableNodes(canvas.nodes, p.cwd) : canvas.nodes)))
  }))
  const childCanvases = p.childCanvases?.map((canvas) => ({
    ...canvas,
    ...(canvas.viewport ? { viewport: { ...canvas.viewport } } : {}),
    nodes: sanitizeNodeTriggers(sanitizeCalendarConfigs(stripSharedNodeExec(p.cwd ? toPortableNodes(canvas.nodes, p.cwd) : canvas.nodes)))
  }))
  const icon = sanitizeProjectIcon(p.icon)
  const links = p.links ?? migrateLinks(p)
  const savedLayouts = validSavedLayouts(p.savedLayouts)
  const providerBlueprints = validProviderBlueprints(p.providerBlueprints)
  return {
    version: 1,
    rev,
    savedAt,
    id,
    name: p.name,
    color: p.color,
    viewport: framingViewport(nodes),
    nodes,
    ...(savedLayouts ? { savedLayouts } : {}),
    ...(multiverseCanvases ? { multiverseCanvases } : {}),
    ...(childCanvases && childCanvases.length > 0 ? { childCanvases } : {}),
    ...(p.portals && p.portals.length > 0 ? { portals: p.portals.map((portal) => ({ ...portal })) } : {}),
    ...(icon ? { icon } : {}),
    ...(links ? { links } : {}),
    ...(p.bridges && p.bridges.length > 0 ? { bridges: p.bridges.map((bridge) => ({ ...bridge })) } : {}),
    ...(p.ropes && p.ropes.length > 0 ? { ropes: p.ropes.map((rope) => ({ ...rope })) } : {}),
    ...(p.defaultPermissionMode ? { defaultPermissionMode: p.defaultPermissionMode } : {}),
    // Strict-normalised (literal true only, known keys only) and omitted when off — an off
    // capability adds no bytes to the committed file. `capabilityAck` is deliberately NOT here:
    // the acknowledgment is machine-local (IndexEntryV3.capabilityAck) and must never travel.
    ...projectCapabilityFields(p),
    ...(p.dinoHighScore ? { dinoHighScore: p.dinoHighScore } : {}),
    ...(p.kanban ? { kanban: p.kanban } : {}),
    ...(p.browserProfiles && p.browserProfiles.length > 0 ? { browserProfiles: p.browserProfiles } : {}),
    ...(p.debugBrowserProfiles && p.debugBrowserProfiles.length > 0 ? { debugBrowserProfiles: p.debugBrowserProfiles } : {}),
    ...(providerBlueprints ? { providerBlueprints } : {})
  }
}

/** The kanban shape rule used on every load path (file refs, ssh cache, inline projects):
 *  anything but {columns: [], assignments: []} arrays — including v1 {columns, cards}
 *  boards — is dropped, so a legacy/hand-edited shape degrades to the fresh default
 *  instead of crashing the board render. */
export function validKanban(k: unknown): k is ProjectKanban {
  return (
    !!k &&
    Array.isArray((k as ProjectKanban).columns) &&
    Array.isArray((k as ProjectKanban).assignments)
  )
}

/** The browser-profiles shape rule used on every load path — same discipline as `validKanban`:
 *  anything but a real array of `{id, name, color}` objects is dropped, so a hand-edited or
 *  legacy-shaped file degrades to "no profiles yet" instead of crashing the picker. A malformed
 *  ENTRY inside an otherwise-valid array is dropped individually rather than discarding the whole
 *  list — one bad row must not take a teammate's real profiles down with it. */
export function validBrowserProfiles(v: unknown): BrowserProfile[] | undefined {
  if (!Array.isArray(v)) return undefined
  const cleaned = v.filter(
    (p): p is BrowserProfile =>
      !!p &&
      typeof (p as BrowserProfile).id === 'string' &&
      typeof (p as BrowserProfile).name === 'string' &&
      typeof (p as BrowserProfile).color === 'string'
  )
  return cleaned.length > 0 ? cleaned : undefined
}

/** Read only safe debugging-browser intent. Malformed rows are dropped individually. */
export function validDebugBrowserProfiles(v: unknown): DebugBrowserProfile[] | undefined {
  return normalizeDebugBrowserProfiles(v)
}

/** Read portable provider intent with bounded, per-row validation. Invalid or duplicate rows are
 * omitted so one hand-edited blueprint cannot make the whole project unusable. */
export function validProviderBlueprints(v: unknown): ProviderBlueprint[] | undefined {
  if (!Array.isArray(v) || v.length > 128) return undefined
  const ids = new Set<string>()
  const result: ProviderBlueprint[] = []
  for (const item of v) {
    if (!validateProviderBlueprint(item)) continue
    const blueprint = sanitizeProviderBlueprint(item)
    if (ids.has(blueprint.id)) continue
    ids.add(blueprint.id)
    result.push(blueprint)
  }
  return result.length > 0 ? result : undefined
}

export function validSavedLayouts(v: unknown): SavedCanvasLayout[] | undefined {
  if (!Array.isArray(v) || v.length > 32) return undefined
  const result: SavedCanvasLayout[] = []
  const layoutIds = new Set<string>()
  for (const item of v) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Partial<SavedCanvasLayout>
    const canvasId = candidate.canvasId === undefined ? 'root' : candidate.canvasId
    if (
      typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 128 || layoutIds.has(candidate.id) ||
      typeof candidate.name !== 'string' || candidate.name.trim().length === 0 || candidate.name.length > 160 ||
      typeof canvasId !== 'string' || canvasId.length === 0 || canvasId.length > 160 || /[\u0000-\u001f\u007f]/.test(canvasId) ||
      typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt) ||
      typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt) ||
      !candidate.viewport || typeof candidate.viewport !== 'object' ||
      typeof candidate.viewport.x !== 'number' || !Number.isFinite(candidate.viewport.x) ||
      typeof candidate.viewport.y !== 'number' || !Number.isFinite(candidate.viewport.y) ||
      typeof candidate.viewport.zoom !== 'number' || !Number.isFinite(candidate.viewport.zoom) || candidate.viewport.zoom <= 0 ||
      !Array.isArray(candidate.nodes) || candidate.nodes.length > 1000
    ) continue
    const nodeIds = new Set<string>()
    const nodes = candidate.nodes.filter((entry): entry is SavedCanvasLayout['nodes'][number] => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const node = entry as Partial<SavedCanvasLayout['nodes'][number]>
      if (typeof node.id !== 'string' || node.id.length === 0 || node.id.length > 128 || nodeIds.has(node.id)) return false
      const valid = !!node.position && typeof node.position.x === 'number' && Number.isFinite(node.position.x) &&
        typeof node.position.y === 'number' && Number.isFinite(node.position.y) && !!node.size &&
        typeof node.size.width === 'number' && Number.isFinite(node.size.width) && node.size.width > 0 &&
        typeof node.size.height === 'number' && Number.isFinite(node.size.height) && node.size.height > 0 &&
        (node.parentId === undefined || (typeof node.parentId === 'string' && node.parentId.length <= 128)) &&
        (node.collapsed === undefined || typeof node.collapsed === 'boolean')
      if (valid) nodeIds.add(node.id)
      return valid
    })
    if (nodes.length !== candidate.nodes.length) continue
    layoutIds.add(candidate.id)
    result.push({
      id: candidate.id,
      name: candidate.name.trim(),
      canvasId,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      viewport: { x: candidate.viewport.x, y: candidate.viewport.y, zoom: candidate.viewport.zoom },
      nodes: nodes.map((node) => ({ ...node, position: { ...node.position }, size: { ...node.size } }))
    })
  }
  return result.length > 0 ? result : undefined
}

/** Tolerant reader for imported child-canvas content. A malformed child record is omitted as an
 * unavailable optional section, while valid sibling canvases and their nodes remain usable. */
function validChildCanvases(value: unknown, _projectId: string): ProjectChildCanvas[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: ProjectChildCanvas[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Partial<ProjectChildCanvas>
    if (
      typeof candidate.id !== 'string' || !candidate.id ||
      (candidate.scope !== 'multiverse' && candidate.scope !== 'aws-universe') ||
      typeof candidate.parentCanvasId !== 'string' || !candidate.parentCanvasId ||
      typeof candidate.depth !== 'number' || !Number.isInteger(candidate.depth) || candidate.depth < 1 ||
      typeof candidate.title !== 'string' || !candidate.title ||
      typeof candidate.order !== 'number' || !Number.isFinite(candidate.order) ||
      !Array.isArray(candidate.nodes)
    ) continue
    if (candidate.scope === 'aws-universe' && (candidate.parentCanvasId !== 'root' || candidate.depth !== 1)) continue
    const viewport = candidate.viewport && typeof candidate.viewport === 'object' &&
      typeof candidate.viewport.x === 'number' && Number.isFinite(candidate.viewport.x) &&
      typeof candidate.viewport.y === 'number' && Number.isFinite(candidate.viewport.y) &&
      typeof candidate.viewport.zoom === 'number' && Number.isFinite(candidate.viewport.zoom)
      ? { x: candidate.viewport.x, y: candidate.viewport.y, zoom: candidate.viewport.zoom }
      : undefined
    result.push({
      id: candidate.id,
      scope: candidate.scope,
      parentCanvasId: candidate.parentCanvasId,
      depth: candidate.depth,
      title: candidate.title,
      order: candidate.order,
      ...(viewport ? { viewport } : {}),
      nodes: candidate.nodes.filter((node): node is CanvasNodeState => !!node && typeof node === 'object' && typeof node.id === 'string' && typeof node.kind === 'string'),
      ...(Array.isArray(candidate.bridges) ? { bridges: candidate.bridges } : {}),
      ...(Array.isArray(candidate.ropes) ? { ropes: candidate.ropes } : {})
    })
  }
  return result.length > 0 ? result : undefined
}

function validPortals(value: unknown): value is ProjectPortalState[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const portal = item as Partial<ProjectPortalState>
    if (![portal.id, portal.parentCanvasId, portal.childCanvasId, portal.entryDoorId, portal.returnDoorId, portal.title].every((part) => typeof part === 'string' && part.length > 0) ||
      typeof portal.depth !== 'number' || !Number.isInteger(portal.depth) || portal.depth <= 0 ||
      (portal.status !== 'open' && portal.status !== 'closed')) return false
    try {
      if (portal.entryConstruction !== undefined) validatePortableDoorConstruction(portal.entryConstruction)
      if (portal.returnConstruction !== undefined) validatePortableDoorConstruction(portal.returnConstruction)
      return true
    } catch { return false }
  })
}

/**
 * Validate child-canvas metadata at the shared-file boundary. A malformed portal record must
 * degrade to no special canvas, never create a route that can skip its matching door.
 */
export function validProjectCanvases(v: unknown): ProjectCanvas[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: ProjectCanvas[] = []
  const ids = new Set<string>()
  for (const value of v) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const c = value as Partial<ProjectCanvas>
    if (
      typeof c.id !== 'string' || !c.id || ids.has(c.id) ||
      (c.scope !== 'multiverse' && c.scope !== 'aws-universe') ||
      typeof c.parentCanvasId !== 'string' || !c.parentCanvasId ||
      typeof c.title !== 'string' || !c.title || typeof c.order !== 'number' || !Number.isFinite(c.order)
    ) continue
    if (c.viewport !== undefined) {
      const vp = c.viewport
      if (!vp || !Number.isFinite(vp.x) || !Number.isFinite(vp.y) || !Number.isFinite(vp.zoom) || vp.zoom <= 0) continue
    }
    if ((c.entryDoorPairId !== undefined && (typeof c.entryDoorPairId !== 'string' || !c.entryDoorPairId)) || (c.returnDoorPairId !== undefined && (typeof c.returnDoorPairId !== 'string' || !c.returnDoorPairId))) continue
    ids.add(c.id)
    out.push({
      id: c.id,
      scope: c.scope,
      parentCanvasId: c.parentCanvasId,
      title: c.title,
      order: c.order,
      ...(c.viewport ? { viewport: { x: c.viewport.x, y: c.viewport.y, zoom: c.viewport.zoom } } : {}),
      ...(c.entryDoorPairId ? { entryDoorPairId: c.entryDoorPairId } : {}),
      ...(c.returnDoorPairId ? { returnDoorPairId: c.returnDoorPairId } : {})
    })
  }
  return out.length ? out : undefined
}

/**
 * The shared file plus this machine's own half of the project.
 *
 * `base.id` is REQUIRED and never defaulted from the file: identity comes from the index entry
 * (or, for a folder that has none yet, from `probeFolder` minting one). Making it a parameter is
 * the structural version of that rule — there is no code path left that can accidentally adopt a
 * git-shared id.
 */
export function fileToProject(
  f: ProjectFileV1,
  base: {
    /** This machine's id for the project (index entry, or freshly minted on adoption). */
    id: string
    cwd?: string
    ssh?: Project['ssh']
    closed?: boolean
    /** This machine's camera. Falls back to the file's legacy one (a pre-change file, or a
     *  teammate's) and then to a frame that puts the canvas on screen. */
    viewport?: Viewport
    /** This machine's default managed account; falls back to the file's legacy value. */
    defaultAccountId?: string
    /** This machine's clone-notice answers for this entry (never from the file). */
    capabilityAck?: CapabilityAckMap
    /** This machine's navigation history for this entry (never from the file). */
    breadcrumbs?: NavStop[]
    settingsOverrides?: Project['settingsOverrides']
    /** Machine-local provider links from the workspace index. */
    providerBindings?: ProviderBinding[]
    /** This machine's own exec values for these nodes (from the local index entry). A file read
     *  WITHOUT them — an adopted/cloned folder, a probe — gets the safe defaults, never the file's
     *  own `shell`/`ssh.extraArgs`. */
    localExec?: LocalNodeExecMap
  }
): Project {
  const defaultAccountId = base.defaultAccountId ?? f.defaultAccountId
  const browserProfiles = validBrowserProfiles(f.browserProfiles)
  const debugBrowserProfiles = validDebugBrowserProfiles(f.debugBrowserProfiles)
  const providerBlueprints = validProviderBlueprints(f.providerBlueprints)
  const multiverseCanvases = sanitizeMultiverseCanvases(f.multiverseCanvases)?.map((canvas) => ({
    ...canvas,
    nodes: sanitizeBrowserPartitions(
      applyLocalNodeExec(base.cwd ? resolveNodes(canvas.nodes, base.cwd) : canvas.nodes, base.localExec),
      base.id
    )
  }))
  const childCanvases = validChildCanvases(f.childCanvases, base.id)
  const icon = sanitizeProjectIcon(f.icon)
  const links = migrateLinks(f)
  const savedLayouts = validSavedLayouts(f.savedLayouts)
  return {
    id: base.id,
    name: f.name,
    color: f.color,
    ...(icon ? { icon } : {}),
    viewport: base.viewport ?? f.viewport ?? framingViewport(f.nodes),
    // applyLocalNodeExec DROPS whatever the file carried in the exec fields (it is not ours) and
    // re-attaches only what this machine typed. See @shared/node-exec. `sanitizeBrowserPartitions`
    // is the same "the file is hostile input" treatment for a browser node's session jar: a stored
    // `partition` survives only when it is exactly the one THIS project (base.id, machine-local)
    // would mint — a foreign/cloned/unsafe one drops to un-owned default session. See
    // loadedAgentBrowserPartition; without it a cloned project.json forges another project's jar.
    nodes: sanitizeBrowserPartitions(
      sanitizeNodeTriggers(
        sanitizeCalendarConfigs(applyLocalNodeExec(base.cwd ? resolveNodes(f.nodes, base.cwd) : f.nodes, base.localExec))
      ),
      base.id
    ),
    ...(savedLayouts ? { savedLayouts } : {}),
    ...(multiverseCanvases ? { multiverseCanvases } : {}),
    ...(childCanvases ? {
      childCanvases: childCanvases.map((canvas) => ({
        ...canvas,
        nodes: sanitizeBrowserPartitions(
          sanitizeNodeTriggers(
            sanitizeCalendarConfigs(applyLocalNodeExec(base.cwd ? resolveNodes(canvas.nodes, base.cwd) : canvas.nodes, base.localExec))
          ),
          base.id
        )
      }))
    } : {}),
    ...(validPortals(f.portals) ? { portals: f.portals.map((portal) => ({ ...portal })) } : {}),
    ...(links ? { links } : {}),
    ...(f.bridges && Array.isArray(f.bridges) ? { bridges: f.bridges.map((bridge) => ({ ...bridge })) } : {}),
    ...(f.ropes && Array.isArray(f.ropes) ? { ropes: f.ropes.map((rope) => ({ ...rope })) } : {}),
    ...(defaultAccountId ? { defaultAccountId } : {}),
    ...(base.settingsOverrides ? { settingsOverrides: base.settingsOverrides } : {}),
    // Machine-local, from the index entry ONLY: a file field named `breadcrumbs` is a forgery
    // attempt (the shared file cannot carry this machine's navigation history) and is never read.
    ...(base.breadcrumbs?.length ? { breadcrumbs: base.breadcrumbs } : {}),
    ...(f.defaultPermissionMode ? { defaultPermissionMode: f.defaultPermissionMode } : {}),
    // The file is hostile input: only a literal `true` under a known key survives the read
    // (readProjectCapabilities). `"true"`, 1, {} et al. vanish here, at the boundary.
    ...readProjectCapabilities(f),
    ...(f.dinoHighScore ? { dinoHighScore: f.dinoHighScore } : {}),
    ...(validKanban(f.kanban) ? { kanban: f.kanban } : {}),
    ...(browserProfiles ? { browserProfiles } : {}),
    ...(debugBrowserProfiles ? { debugBrowserProfiles } : {}),
    ...(providerBlueprints ? { providerBlueprints } : {}),
    ...(base.providerBindings ? { providerBindings: base.providerBindings.map((binding) => ({ ...binding })) } : {}),
    ...(base.cwd ? { cwd: base.cwd } : {}),
    ...(base.ssh ? { ssh: base.ssh } : {}),
    ...(base.closed ? { closed: true } : {}),
    // Machine-local, from the index entry ONLY: a file field named `capabilityAck` is a forgery
    // attempt (the shared file cannot carry this machine's consent) and is simply never read.
    ...(base.capabilityAck ? { capabilityAck: base.capabilityAck } : {}),
    // Machine-local, from the index entry ONLY: a file field named `breadcrumbs` is a forgery
    // attempt (the shared file cannot carry this machine's navigation history) and is never read.
    ...(base.breadcrumbs?.length ? { breadcrumbs: base.breadcrumbs } : {})
  }
}

/**
 * The camera for a canvas nobody on this machine has ever framed (an adopted folder, a teammate's
 * committed canvas): zoom 1, panned so the top-left node sits just inside the corner.
 *
 * Without it a shared canvas whose nodes live at x=4000 opened onto empty space — the file no
 * longer carries the author's camera, so the default {0,0,1} would have been a blank screen and
 * "commit it to share the canvas" would have been a lie.
 *
 * A plain loop with a finiteness guard per AXIS, not `Math.min(...map())`, because this now runs
 * inside `projectToFile` — i.e. inside every `save()` — where the old shape had two ways to ruin
 * one: a hand-edited/corrupt `position` made `Math.min` return NaN, which `JSON.stringify` writes
 * into the COMMITTED file as `"x": null` (a field that used to be the user's own viewport and
 * could not be poisoned by node data), and spreading a large enough node array blows the call
 * stack, which would now fail the whole save rather than one node.
 */
export function framingViewport(nodes: CanvasNodeState[]): Viewport {
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    // A child's position is relative to its frame, so it cannot anchor the camera.
    if (n.parentId) continue
    const pos = n.position as { x?: unknown; y?: unknown } | undefined
    if (typeof pos?.x === 'number' && Number.isFinite(pos.x) && pos.x < minX) minX = pos.x
    if (typeof pos?.y === 'number' && Number.isFinite(pos.y) && pos.y < minY) minY = pos.y
  }
  return {
    x: Number.isFinite(minX) ? 80 - minX : 0,
    y: Number.isFinite(minY) ? 80 - minY : 0,
    zoom: 1
  }
}

/**
 * Content equality ignoring the bookkeeping fields — decides whether a save must bump rev +
 * rewrite.
 *
 * The legacy `id` (and a pre-change file's `viewport` / `defaultAccountId`) IS compared, because a
 * file still carrying a machine's project id must be rewritten exactly once — that is the
 * migration that scrubs the identity out of the repo. Both sides agree from then on
 * (`legacyFileId` is derived from the name, so it is the same on every machine), which is what
 * keeps the answer "unchanged" on every later save.
 */
export function sameProjectContent(a: ProjectFileV1, b: ProjectFileV1): boolean {
  const strip = ({ rev: _r, savedAt: _s, ...rest }: ProjectFileV1) => rest
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/** Splits an in-memory workspace into the v3 index + the local project files to write. */
export function splitWorkspace(
  ws: Workspace,
  revOf: (projectId: string) => number,
  savedAt: string
): { index: WorkspaceIndexV3; files: Map<string, ProjectFileV1> } {
  const entries: IndexEntryV3[] = []
  const files = new Map<string, ProjectFileV1>()
  const seenIds = new Set<string>()
  for (const incoming of ws.projects) {
    // A relay tab is a LIVE connection to another machine's project, not a workspace on this
    // disk — it has no disk representation at all. Drop it entirely (no ref, no inline, no
    // cache) BEFORE the unavailable handling, so it leaks in none of the branches below.
    if (incoming.remote) continue
    // Two entries may never share an id. The index is keyed by it — which folder's project.json a
    // save writes, and every id-keyed lookup that reads the index back (ssh control paths,
    // board-log + approval routing, presence, agent status) resolves only the FIRST match. The
    // load-time repair (WorkspaceStore.repairDuplicateIds) is where a corrupt store is normally
    // healed; this is the last resort for a duplicate that reaches save some other way — a
    // hand-edited index, a runtime collision — and it uses the same deterministic derivation, so
    // both paths agree on the id instead of fighting over it.
    const id = seenIds.has(incoming.id)
      ? derivedProjectId(incoming.id, collisionSeed(incoming), (candidate) => seenIds.has(candidate))
      : incoming.id
    seenIds.add(id)
    const p = id === incoming.id ? incoming : { ...incoming, id }
    const header = { id: p.id, name: p.name, color: p.color, ...(p.closed ? { closed: true } : {}) }
    // The machine-local half of a REF'd project (a folder or an ssh endpoint), which used to ride
    // the shared file: this user's camera and this machine's default managed account. Deliberately
    // NOT added to the `unavailable` branch below — a placeholder's viewport is the {0,0,1} of an
    // empty stand-in, and writing it would forget where the user actually was; `WorkspaceStore.save`
    // restores both from the previous entry instead, exactly as it does for `cache`/`localExec`.
    // Inline entries need none of this: they store the whole Project verbatim.
    const localState = {
      ...(p.viewport ? { viewport: p.viewport } : {}),
      ...(p.defaultAccountId ? { defaultAccountId: p.defaultAccountId } : {}),
      // The clone-notice answer rides the machine-local entry, never the shared file
      // (projectToFile does not emit it — pinned by project-capability-consent.test.ts).
      ...(p.capabilityAck ? { capabilityAck: p.capabilityAck } : {}),
      ...(p.breadcrumbs?.length ? { breadcrumbs: p.breadcrumbs } : {}),
      ...(p.settingsOverrides ? { settingsOverrides: p.settingsOverrides } : {}),
      ...(p.providerBindings ? { providerBindings: p.providerBindings.map((binding) => ({ ...binding })) } : {}),
    }
    if (p.unavailable) {
      // Placeholder (folder missing / server unreachable at load): its nodes:[] is not real
      // data. Emit a header-only ref preserving the ref shape — NEVER a file and NEVER an ssh
      // cache built from the placeholder, so a later save can't clobber the on-disk source.
      if (p.ssh) entries.push({ ...header, ssh: p.ssh })
      else if (p.cwd) entries.push({ ...header, cwd: p.cwd })
      else {
        const { unavailable: _u, ...inline } = p
        entries.push({ ...header, project: inline })
      }
      continue
    }
    // Exec-enabling node fields are stripped from every project file / ssh cache; the local user's
    // own values are preserved HERE, in the machine-local index (@shared/node-exec).
    const local = localNodeExec([
      ...p.nodes,
      ...(p.multiverseCanvases ?? []).flatMap((canvas) => canvas.nodes)
    ])
    const localRef = local ? { localExec: local } : {}
    if (p.ssh) {
      entries.push({
        ...header,
        ...localState,
        ...localRef,
        ssh: p.ssh,
        // The ssh mirror keeps the ENTRY id in its `id` field. That file is not a git-copied
        // artifact — it is one folder on one host — and `reconcileSsh` reads the id as the marker
        // that tells a DIFFERENT lineage (another machine's project, a re-added folder) from our
        // own, which is what stops an empty newborn canvas from clobbering a populated server
        // file. It is no longer identity even there: `fileToProject` is handed `e.id` regardless.
        cache: projectToFile(p, revOf(p.id), savedAt, p.id)
      })
    } else if (p.cwd && !files.has(p.cwd)) {
      files.set(p.cwd, projectToFile(p, revOf(p.id), savedAt))
      entries.push({ ...header, ...localState, ...localRef, cwd: p.cwd })
    } else if (p.cwd) {
      // Another project already claimed this cwd (two tabs on one folder). Keying `files` by cwd
      // would collapse them last-wins, and reload would resurrect BOTH entries from the one file
      // (duplicate ids, first canvas lost). Emit this one INLINE instead — kept verbatim in the
      // index, no file write — so both canvases survive a save→load round trip.
      const { unavailable: _u, ...inline } = p
      entries.push({ ...header, project: inline })
    } else {
      const { unavailable: _u, ...inline } = p
      entries.push({ ...header, project: inline })
    }
  }
  return { index: { version: 3, activeProjectId: ws.activeProjectId, entries }, files }
}

/** Pretty, stable-order JSON for the project file (git-diffable; the index stays compact).
 *
 * Defensively re-strip nodes here even though `projectToFile` already does it. SSH reconciliation
 * can serialize a parsed/cache `ProjectFileV1` directly; without this last gate, a hostile remote
 * file could be adopted and then mirrored back with its execution fields intact.
 */
export function serializeProjectFile(f: ProjectFileV1): string {
  const providerBlueprints = validProviderBlueprints(f.providerBlueprints)
  return JSON.stringify({
    ...f,
    nodes: sanitizeNodeTriggers(sanitizeCalendarConfigs(stripSharedNodeExec(f.nodes))),
    ...(f.multiverseCanvases
      ? { multiverseCanvases: f.multiverseCanvases.map((canvas) => ({ ...canvas, nodes: sanitizeNodeTriggers(sanitizeCalendarConfigs(stripSharedNodeExec(canvas.nodes))) })) }
      : {}),
    ...(providerBlueprints ? { providerBlueprints } : { providerBlueprints: undefined })
  }, null, 2)
}
