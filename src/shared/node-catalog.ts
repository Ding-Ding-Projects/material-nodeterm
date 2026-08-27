import type { NodeKind } from './types'
import { DOCKER_HOST_PORTABLE_BLUEPRINT } from './docker-host-manager'

/** The guided categories shown by the Node Catalog. Keep this list explicit so a new category
 * cannot disappear from the picker simply because no current entry happens to use it. */
export const NODE_CATALOG_CATEGORIES = [
  'terminals',
  'agents',
  'canvas',
  'files',
  'media',
  'managers',
  'automation',
  'tools',
  'universes',
  'hosting'
] as const

export type NodeCatalogCategory = (typeof NODE_CATALOG_CATEGORIES)[number]

/** Facts available to a catalog surface. These are capability facts, not credentials or paths. */
export interface NodeCatalogAvailabilityContext {
  sessionSource: 'local' | 'server' | 'relay'
  hasProjectFolder: boolean
  isSshProject: boolean
  hasRemoteConnection: boolean
  supportsWindowsTerminalProfiles: boolean
  /** Child-canvas scope facts used to keep AWS and Multiverse rows from crossing boundaries. */
  universeScope: 'root' | 'multiverse' | 'aws-universe'
  universeId?: string
  universeDepth: number
  hasShopNode: boolean
  parentCanvasId?: string
}

export interface NodeCatalogAvailability {
  available: boolean
  /** A disabled row must explain the exact next action rather than looking broken. */
  reason?: string
  /** Stable capability id for telemetry-free UI filtering and future documentation. */
  dependencyIds?: readonly string[]
}

/** A typed, serializable catalog row. Factories stay outside this module so the registry can be
 * shared by the desktop renderer, server shell, portable projection and documentation browser. */
export interface NodeCatalogEntry {
  id: string
  nodeKind: NodeKind | null
  category: NodeCatalogCategory
  label: string
  description: string
  keywords: readonly string[]
  documentationPath: string
  /** Safe, portable-by-default values only. Machine paths, credentials and process state do not
   * belong here. The creation executor adds machine-local values at the point of use. */
  safeDefaults: Readonly<Record<string, unknown>>
  dependencies: readonly string[]
  /** Whether the row is currently executable or a visible planned capability. */
  status?: 'available' | 'planned'
  availabilityMode?: 'required-for-creation' | 'configure-later'
  scope?: 'root' | 'multiverse' | 'aws-universe' | 'any'
  maxUniverseDepth?: number
  availability: (context: NodeCatalogAvailabilityContext) => NodeCatalogAvailability
}

const alwaysAvailable = (): NodeCatalogAvailability => ({ available: true })
const needsFolder = (context: NodeCatalogAvailabilityContext): NodeCatalogAvailability =>
  context.hasProjectFolder
    ? { available: true }
    : {
        available: false,
        reason: 'Open or create a project folder before using this node.',
        dependencyIds: ['project-folder']
      }

const unsupportedInRelay = (context: NodeCatalogAvailabilityContext): NodeCatalogAvailability =>
  context.sessionSource === 'relay'
    ? {
        available: false,
        reason: 'This node is not available in a relay session. Open a local or server session.',
        dependencyIds: ['session-local-or-server']
      }
    : { available: true }

const remoteTerminalRequiresPicker = (_context: NodeCatalogAvailabilityContext): NodeCatalogAvailability => ({
  available: false,
  reason: 'Choose a saved remote connection from New Remote Connection before creating a remote terminal.',
  dependencyIds: ['remote-connection-selection']
})

const unavailableUntilPicked = (reason: string, dependencyId: string) =>
  (_context: NodeCatalogAvailabilityContext): NodeCatalogAvailability => ({
    available: false,
    reason,
    dependencyIds: [dependencyId]
  })

const planned = (feature: string, dependencyId: string) =>
  (_context: NodeCatalogAvailabilityContext): NodeCatalogAvailability => ({
    available: false,
    reason: `${feature} is planned and not implemented yet. Keep the intent here and configure it when its adapter ships.`,
    dependencyIds: [dependencyId]
  })

const inScope = (
  scope: 'root' | 'multiverse' | 'aws-universe' | 'any',
  maxDepth?: number
) =>
  (context: NodeCatalogAvailabilityContext): NodeCatalogAvailability => {
    if (scope !== 'any' && context.universeScope !== scope) {
      return {
        available: false,
        reason: `This node is scoped to ${scope} canvases. Open a matching universe canvas first.`,
        dependencyIds: [`canvas-scope:${scope}`]
      }
    }
    if (maxDepth !== undefined && context.universeDepth > maxDepth) {
      return {
        available: false,
        reason: `Multiverse nodes are limited to depth ${maxDepth}. Open a shallower canvas first.`,
        dependencyIds: ['multiverse-depth']
      }
    }
    return { available: true }
  }

const plannedEntry = (
  id: string,
  category: NodeCatalogCategory,
  label: string,
  description: string,
  dependencyId: string,
  scope: 'root' | 'multiverse' | 'aws-universe' | 'any' = 'any',
  maxUniverseDepth?: number
): NodeCatalogEntry => ({
  id,
  nodeKind: null,
  category,
  label,
  description,
  keywords: [label.toLowerCase(), 'planned', 'blueprint'],
  documentationPath: 'docs/plans/2026-08-26-portable-node-universes-and-hosting-program.md',
  safeDefaults: {},
  dependencies: [dependencyId],
  status: 'planned',
  availabilityMode: 'configure-later',
  scope,
  maxUniverseDepth,
  availability: (context) => {
    const scopeState = inScope(scope, maxUniverseDepth)(context)
    if (!scopeState.available) return scopeState
    return planned(label, dependencyId)(context)
  }
})

/**
 * The one source of truth for user-created node intents. Labels and descriptions deliberately stay
 * neutral English here; the renderer resolves them through the normal i18n catalogue, while this
 * shared registry remains safe to load in the server shell and portable tooling.
 */
export const NODE_CATALOG: readonly NodeCatalogEntry[] = [
  {
    id: 'terminal',
    nodeKind: 'terminal',
    category: 'terminals',
    label: 'Terminal',
    description: 'Open a real shell with the saved safe profile.',
    keywords: ['shell', 'command line', 'console', 'profile'],
    documentationPath: 'docs/features/terminals/README.md',
    safeDefaults: { initialCommand: null },
    dependencies: ['session'],
    availability: unsupportedInRelay
  },
  {
    id: 'remote-terminal',
    nodeKind: 'terminal',
    category: 'terminals',
    label: 'Remote terminal',
    description: 'Open a terminal through a selected saved remote connection.',
    keywords: ['ssh', 'remote', 'server', 'shell'],
    documentationPath: 'docs/features/remote/README.md',
    safeDefaults: { initialCommand: null },
    dependencies: ['remote-connection'],
    availability: remoteTerminalRequiresPicker,
  },
  {
    id: 'agent:claude',
    nodeKind: 'terminal',
    category: 'agents',
    label: 'Claude',
    description: 'Start an agent session with the active account and permission plan.',
    keywords: ['agent', 'assistant', 'coding', 'claude'],
    documentationPath: 'docs/features/agents/README.md',
    safeDefaults: { agentId: 'claude', prompt: null },
    dependencies: ['session', 'agent-cli'],
    availability: unsupportedInRelay
  },
  {
    id: 'agent:codex',
    nodeKind: 'terminal',
    category: 'agents',
    label: 'Codex',
    description: 'Start a Codex agent session using a selectable local account.',
    keywords: ['agent', 'assistant', 'coding', 'codex'],
    documentationPath: 'docs/features/agents/README.md',
    safeDefaults: { agentId: 'codex', prompt: null },
    dependencies: ['session', 'agent-cli'],
    availability: unsupportedInRelay
  },
  {
    id: 'agent:gemini',
    nodeKind: 'terminal',
    category: 'agents',
    label: 'Gemini',
    description: 'Start a Gemini agent session with the configured launch command.',
    keywords: ['agent', 'assistant', 'coding', 'gemini'],
    documentationPath: 'docs/features/agents/README.md',
    safeDefaults: { agentId: 'gemini', prompt: null },
    dependencies: ['session', 'agent-cli'],
    availability: unsupportedInRelay
  },
  {
    id: 'sticky',
    nodeKind: 'sticky',
    category: 'canvas',
    label: 'Sticky note',
    description: 'Add an editable note that can carry project context.',
    keywords: ['note', 'memo', 'context', 'text'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { text: '' },
    dependencies: [],
    availability: alwaysAvailable
  },
  {
    id: 'group',
    nodeKind: 'group',
    category: 'canvas',
    label: 'Group frame',
    description: 'Add an empty frame for organizing related nodes.',
    keywords: ['group', 'frame', 'organize', 'container'],
    documentationPath: 'docs/features/canvas/group-picker.md',
    safeDefaults: { title: 'Group' },
    dependencies: [],
    availability: alwaysAvailable
  },
  {
    id: 'annotation',
    nodeKind: 'annotation',
    category: 'canvas',
    label: 'Drawing annotation',
    description: 'Arm the drawing tool, then drag a line or arrow on the canvas.',
    keywords: ['draw', 'line', 'arrow', 'annotation'],
    documentationPath: 'docs/features/canvas/canvas-and-lifecycle.md',
    safeDefaults: {},
    dependencies: ['canvas-drag'],
    availability: unavailableUntilPicked(
      'Choose Draw line or Draw arrow to provide the annotation geometry.',
      'canvas-drag'
    )
  },
  {
    id: 'browser',
    nodeKind: 'browser',
    category: 'canvas',
    label: 'Browser',
    description: 'Open a browser node with a blank address bar.',
    keywords: ['web', 'internet', 'tab', 'url'],
    documentationPath: 'docs/features/remote/README.md',
    safeDefaults: { url: '' },
    dependencies: [],
    availability: alwaysAvailable
  },
  {
    id: 'web',
    nodeKind: 'web',
    category: 'media',
    label: 'Web view',
    description: 'Open a web view with a URL chosen in its guided address field.',
    keywords: ['web', 'url', 'site', 'preview'],
    documentationPath: 'docs/features/remote/README.md',
    safeDefaults: { url: '' },
    dependencies: [],
    availability: alwaysAvailable
  },
  {
    id: 'video',
    nodeKind: 'video',
    category: 'media',
    label: 'Video',
    description: 'Open a local video node and choose the media file in its picker.',
    keywords: ['video', 'media', 'movie', 'file'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: {},
    dependencies: ['media-file'],
    availability: (context) =>
      needsFolder(context).available
        ? unavailableUntilPicked('Choose a media file before creating a video node.', 'media-file')(context)
        : needsFolder(context)
  },
  {
    id: 'authenticator',
    nodeKind: 'authenticator',
    category: 'tools',
    label: 'Authenticator',
    description: 'Open the local TOTP authenticator without moving secrets into the project.',
    keywords: ['totp', 'otp', 'two factor', 'security'],
    documentationPath: 'docs/authenticator.md',
    safeDefaults: {},
    dependencies: ['credential-vault'],
    availability: alwaysAvailable
  },
  {
    id: 'dino',
    nodeKind: 'dino',
    category: 'tools',
    label: 'Dino game',
    description: 'Open the small local canvas game.',
    keywords: ['game', 'dino', 'break'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { highScore: 0 },
    dependencies: [],
    availability: alwaysAvailable
  },
  {
    id: 'recovery-game',
    nodeKind: 'recovery-game',
    category: 'tools',
    label: 'Recovery game',
    description: 'Energize three keys, avoid hazards, and activate the central core.',
    keywords: ['game', 'recovery', 'energy keys', 'hazards', 'activation core'],
    documentationPath: 'docs/features/canvas/recovery-game.md',
    safeDefaults: { recoveryGame: { player: { x: 1, y: 5 }, energizedKeys: [], coreActivated: false, hazardHits: 0 } },
    dependencies: [],
    availability: alwaysAvailable
  },
  {
    id: 'loop',
    nodeKind: 'scheduler',
    category: 'automation',
    label: 'Loop',
    description: 'Create a paused local schedule with an explicit next action.',
    keywords: ['schedule', 'automation', 'timer', 'recurring'],
    documentationPath: 'docs/features/canvas/canvas-and-lifecycle.md',
    safeDefaults: { enabled: false, task: '', intervalMs: 900000 },
    dependencies: ['local-scheduler'],
    availability: alwaysAvailable
  },
  {
    id: 'nsis',
    nodeKind: 'nsis',
    category: 'tools',
    label: 'Installer builder',
    description: 'Start a guided installer-builder form with safe project defaults.',
    keywords: ['installer', 'windows', 'nsis', 'package'],
    documentationPath: 'docs/features/packaging/README.md',
    safeDefaults: {},
    dependencies: ['project-folder'],
    availability: needsFolder
  },
  {
    id: 'service:minecraft',
    nodeKind: 'minecraft',
    category: 'managers',
    label: 'Minecraft manager',
    description: 'Open a manager for a locally bound Minecraft service.',
    keywords: ['service', 'server', 'minecraft'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { serviceLabel: '' },
    dependencies: ['service-binding'],
    availability: alwaysAvailable
  },
  {
    id: 'service:dockerhost',
    nodeKind: 'dockerhost',
    category: 'managers',
    label: 'Docker host manager',
    description: 'Open a typed manager for a local or saved Docker host.',
    keywords: ['service', 'container', 'docker', 'host'],
    documentationPath: 'docs/features/remote/docker-host.md',
    safeDefaults: { serviceLabel: '', dockerHostBlueprint: DOCKER_HOST_PORTABLE_BLUEPRINT },
    dependencies: ['service-binding'],
    availability: alwaysAvailable
  },
  {
    id: 'service:proxmox',
    nodeKind: 'proxmox',
    category: 'managers',
    label: 'Proxmox manager',
    description: 'Open a typed manager for a saved Proxmox connection.',
    keywords: ['service', 'virtual machine', 'proxmox'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { serviceLabel: '' },
    dependencies: ['service-binding'],
    availability: alwaysAvailable
  },
  {
    id: 'service:gitlab',
    nodeKind: 'gitlab',
    category: 'managers',
    label: 'GitLab manager',
    description: 'Open a typed manager for a saved GitLab connection.',
    keywords: ['service', 'git', 'gitlab', 'remote'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { serviceLabel: '' },
    dependencies: ['service-binding'],
    availability: alwaysAvailable
  },
  {
    id: 'service:homeassistant',
    nodeKind: 'homeassistant',
    category: 'managers',
    label: 'Home Assistant manager',
    description: 'Open a typed manager for a saved Home Assistant connection.',
    keywords: ['service', 'home assistant', 'sensor', 'automation'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { serviceLabel: '' },
    dependencies: ['service-binding'],
    availability: alwaysAvailable
  },
  {
    id: 'service:freepbx',
    nodeKind: 'freepbx',
    category: 'managers',
    label: 'FreePBX manager',
    description: 'Open a typed manager for a saved FreePBX connection.',
    keywords: ['service', 'phone', 'telephony', 'freepbx'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: { serviceLabel: '' },
    dependencies: ['service-binding'],
    availability: alwaysAvailable
  },
  {
    id: 'editor',
    nodeKind: 'editor',
    category: 'files',
    label: 'Editor',
    description: 'Open a selected project file in the embedded editor.',
    keywords: ['file', 'code', 'editor', 'monaco'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: {},
    dependencies: ['selected-file'],
    availability: unavailableUntilPicked(
      'Choose a project file from Open file before creating an editor node.',
      'selected-file'
    )
  },
  {
    id: 'diff',
    nodeKind: 'diff',
    category: 'files',
    label: 'Diff viewer',
    description: 'Open a selected project file in the read-only diff viewer.',
    keywords: ['file', 'git', 'diff', 'changes'],
    documentationPath: 'docs/features/canvas/node-kinds.md',
    safeDefaults: {},
    dependencies: ['selected-file', 'project-folder'],
    availability: (context) =>
      needsFolder(context).available
        ? unavailableUntilPicked(
            'Choose a project file from Open file before creating a diff viewer.',
            'selected-file'
          )(context)
          : needsFolder(context)
  },
  plannedEntry('photo', 'media', 'Photo', 'Place a project-owned photo asset with a portable reference.', 'photo-adapter'),
  plannedEntry('gallery', 'media', 'Gallery', 'Arrange project-owned photos and videos in a mixed-media gallery.', 'gallery-adapter'),
  plannedEntry('torrent', 'tools', 'Torrent downloader', 'Queue a bounded, resumable torrent download with an explicit destination.', 'webtorrent-runtime'),
  plannedEntry('linux-vm', 'tools', 'Linux VM', 'Create a guided QEMU Linux VM blueprint with network off by default.', 'qemu-runtime'),
  {
    id: 'wild-dim-sum',
    nodeKind: 'wild-dim-sum',
    category: 'tools',
    label: 'Wild dim sum',
    description: 'Browse or randomly choose a dish from the public catalog without copying its photo.',
    keywords: ['dim sum', 'dish', 'photo', 'public catalog', 'surprise'],
    documentationPath: 'docs/features/canvas/wild-dim-sum-node.md',
    safeDefaults: {},
    dependencies: ['public-network'],
    availability: alwaysAvailable
  },
  {
    id: 'homeassistant-control',
    nodeKind: 'homeassistant-control',
    category: 'managers',
    label: 'Home Assistant control',
    description: 'Control a locally bound Home Assistant entity with rich domain controls and verified service schemas.',
    keywords: ['home assistant', 'entity', 'service', 'automation', 'schema', 'control'],
    documentationPath: 'docs/features/integrations/home-assistant-controls.md',
    safeDefaults: { connection: null, entityHint: null, serviceHint: null },
    dependencies: [],
    status: 'available',
    availabilityMode: 'configure-later',
    availability: inScope('any')
  },
  {
    id: 'homeassistant-sensor',
    nodeKind: 'homeassistant-sensor',
    category: 'managers',
    label: 'Home Assistant sensor',
    description: 'Display selected Home Assistant values, states, gauges, trends, events, weather, calendars, and attributes through a machine-local binding.',
    keywords: ['home assistant', 'sensor', 'binary', 'gauge', 'trend', 'weather', 'calendar', 'event', 'history'],
    documentationPath: 'docs/features/integrations/home-assistant-sensor-display.md',
    safeDefaults: { entities: [], refreshSeconds: 30, historyLimit: 60 },
    dependencies: ['homeassistant-adapter'],
    status: 'current',
    availabilityMode: 'configure-later',
    scope: 'any',
    availability: unsupportedInRelay
  },
  plannedEntry('calendar', 'automation', 'Calendar', 'Create a portable calendar definition with local account binding later.', 'calendar-service'),
  plannedEntry('timer', 'automation', 'Timer', 'Create a timer blueprint with a local execution binding later.', 'planner-service'),
  {
    id: 'alarm',
    nodeKind: 'alarm',
    category: 'automation',
    label: 'Alarm clock',
    description: 'Create a one-shot or recurring wall-clock alarm with an explicit timezone.',
    keywords: ['alarm', 'clock', 'reminder', 'timezone', 'snooze'],
    documentationPath: 'docs/alarm-clock.md',
    safeDefaults: { enabled: false, recurrence: 'once', time: '09:00' },
    dependencies: ['planner-service'],
    availability: alwaysAvailable
  },
  plannedEntry('planner', 'automation', 'Planner', 'Create a planner occurrence definition with explicit local binding.', 'planner-service'),
  plannedEntry('multiverse-portal', 'universes', 'Multiverse portal', 'Create a door-only Multiverse canvas below the depth limit.', 'multiverse-service', 'multiverse', 8),
  plannedEntry('aws-universe', 'universes', 'AWS Universe', 'Create an AWS-only child canvas with a dedicated Shop node.', 'aws-cli-v2', 'aws-universe'),
  plannedEntry('aws-service', 'universes', 'AWS service node', 'Create a typed AWS service blueprint from installed CLI models.', 'aws-cli-v2', 'aws-universe'),
  plannedEntry('cloudflare-hosting', 'hosting', 'Cloudflare hosting', 'Create a private-first hosting blueprint with explicit tunnel exposure later.', 'hosting-adapter'),
  plannedEntry('gitlab-hosting', 'hosting', 'GitLab hosting', 'Create a guided GitLab hosting blueprint with local credentials later.', 'hosting-adapter'),
  plannedEntry('nextcloud-hosting', 'hosting', 'Nextcloud hosting', 'Create a managed Nextcloud hosting blueprint with local binding later.', 'hosting-adapter'),
  plannedEntry('open-webui-hosting', 'hosting', 'Open WebUI hosting', 'Create an Open WebUI hosting blueprint that can reuse local Ollama.', 'hosting-adapter')
] as const

const CATALOG_BY_ID = new Map(NODE_CATALOG.map((entry) => [entry.id, entry]))

export interface NodeCatalogCompletenessRecord {
  id: string
  state: 'current' | 'ephemeral' | 'planned'
  scope: 'root' | 'multiverse' | 'aws-universe' | 'any' | 'none'
  reason: string
}

/** Hand-written inventory. Keep ephemeral render-only cards explicit so deleting a catalog row or
 * accidentally adding a duplicate cannot make the completeness check pass vacuously. */
export const NODE_CATALOG_COMPLETENESS: readonly NodeCatalogCompletenessRecord[] = [
  { id: 'terminal', state: 'current', scope: 'any', reason: 'persisted terminal node' },
  { id: 'remote-terminal', state: 'current', scope: 'any', reason: 'saved remote-terminal intent' },
  { id: 'agent:claude', state: 'current', scope: 'any', reason: 'Claude terminal preset' },
  { id: 'agent:codex', state: 'current', scope: 'any', reason: 'Codex terminal preset' },
  { id: 'agent:gemini', state: 'current', scope: 'any', reason: 'Gemini terminal preset' },
  { id: 'sticky', state: 'current', scope: 'any', reason: 'persisted sticky note' },
  { id: 'group', state: 'current', scope: 'any', reason: 'persisted group frame' },
  { id: 'annotation', state: 'current', scope: 'none', reason: 'geometry comes from a draw gesture' },
  { id: 'browser', state: 'current', scope: 'any', reason: 'persisted browser node' },
  { id: 'web', state: 'current', scope: 'any', reason: 'persisted web view node' },
  { id: 'video', state: 'current', scope: 'any', reason: 'media file picker required' },
  { id: 'editor', state: 'current', scope: 'any', reason: 'project file picker required' },
  { id: 'diff', state: 'current', scope: 'any', reason: 'project file picker required' },
  { id: 'authenticator', state: 'current', scope: 'any', reason: 'local authenticator node' },
  { id: 'dino', state: 'current', scope: 'any', reason: 'local dino node' },
  { id: 'recovery-game', state: 'current', scope: 'any', reason: 'portable local recovery game' },
  { id: 'loop', state: 'current', scope: 'any', reason: 'persisted scheduler node' },
  { id: 'nsis', state: 'current', scope: 'any', reason: 'persisted installer-builder node' },
  { id: 'service:minecraft', state: 'current', scope: 'any', reason: 'service manager node' },
  { id: 'service:dockerhost', state: 'current', scope: 'any', reason: 'service manager node' },
  { id: 'service:proxmox', state: 'current', scope: 'any', reason: 'service manager node' },
  { id: 'service:gitlab', state: 'current', scope: 'any', reason: 'service manager node' },
  { id: 'service:homeassistant', state: 'current', scope: 'any', reason: 'service manager node' },
  { id: 'service:freepbx', state: 'current', scope: 'any', reason: 'service manager node' },
  { id: 'subagent', state: 'ephemeral', scope: 'none', reason: 'hook-derived render-only card' },
  { id: 'loop-card', state: 'ephemeral', scope: 'none', reason: 'schedule-derived render-only card' },
  { id: 'photo', state: 'planned', scope: 'any', reason: 'photo adapter not implemented' },
  { id: 'gallery', state: 'planned', scope: 'any', reason: 'gallery adapter not implemented' },
  { id: 'torrent', state: 'planned', scope: 'any', reason: 'WebTorrent runtime not implemented' },
  { id: 'linux-vm', state: 'planned', scope: 'any', reason: 'QEMU runtime not implemented' },
  { id: 'wild-dim-sum', state: 'current', scope: 'any', reason: 'portable public-catalog selection node' },
  { id: 'homeassistant-control', state: 'current', scope: 'any', reason: 'schema-driven local binding control node' },
  { id: 'homeassistant-sensor', state: 'current', scope: 'any', reason: 'portable sensor display with machine-local binding' },
  { id: 'calendar', state: 'planned', scope: 'any', reason: 'calendar service not implemented' },
  { id: 'timer', state: 'planned', scope: 'any', reason: 'timer service not implemented' },
  { id: 'alarm', state: 'current', scope: 'any', reason: 'persisted Alarm Clock node with host planner' },
  { id: 'planner', state: 'planned', scope: 'any', reason: 'planner service not implemented' },
  { id: 'multiverse-portal', state: 'planned', scope: 'multiverse', reason: 'Multiverse portal not implemented' },
  { id: 'aws-universe', state: 'planned', scope: 'aws-universe', reason: 'AWS Universe not implemented' },
  { id: 'aws-service', state: 'planned', scope: 'aws-universe', reason: 'AWS service node not implemented' },
  { id: 'cloudflare-hosting', state: 'planned', scope: 'any', reason: 'Cloudflare hosting not implemented' },
  { id: 'gitlab-hosting', state: 'planned', scope: 'any', reason: 'GitLab hosting not implemented' },
  { id: 'nextcloud-hosting', state: 'planned', scope: 'any', reason: 'Nextcloud hosting not implemented' },
  { id: 'open-webui-hosting', state: 'planned', scope: 'any', reason: 'Open WebUI hosting not implemented' }
]

/** Completeness guard data is intentionally exact and red when a row is removed, duplicated, or
 * scoped incorrectly. Callers can surface these messages in a build Chut without guessing. */
export function validateNodeCatalogCompleteness(
  entries: readonly NodeCatalogEntry[] = NODE_CATALOG
): string[] {
  const errors: string[] = []
  const inventoryIds = new Set(NODE_CATALOG_COMPLETENESS.map((row) => row.id))
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) errors.push(`duplicate catalog id: ${entry.id}`)
    seen.add(entry.id)
    if (!inventoryIds.has(entry.id)) errors.push(`unscoped catalog id: ${entry.id}`)
  }
  for (const row of NODE_CATALOG_COMPLETENESS) {
    if (row.state === 'ephemeral') continue
    const entry = entries.find((candidate) => candidate.id === row.id)
    if (!entry) {
      errors.push(`missing catalog id: ${row.id}`)
      continue
    }
    if (row.state === 'planned' && entry.status !== 'planned') errors.push(`planned row is not disabled: ${row.id}`)
    if (row.scope !== 'any' && row.scope !== 'none' && entry.scope !== row.scope) errors.push(`wrong catalog scope: ${row.id}`)
  }
  return errors
}

export function getNodeCatalogEntry(id: string): NodeCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id)
}

export function nodeCatalogAvailability(
  entry: NodeCatalogEntry,
  context: NodeCatalogAvailabilityContext
): NodeCatalogAvailability {
  return entry.availability(context)
}

/** Plain text is the default search. Regex callers should pass their own bounded tester from the
 * shared regex builder, keeping this helper deterministic and free of an evaluation engine. */
export function searchNodeCatalog(
  entries: readonly NodeCatalogEntry[],
  query: string,
  tester?: (text: string) => boolean
): NodeCatalogEntry[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized && !tester) return [...entries]
  return entries.filter((entry) => {
    const corpus = [entry.label, entry.description, entry.category, ...entry.keywords]
      .join(' ')
      .toLocaleLowerCase()
    return tester ? tester(corpus) : corpus.includes(normalized)
  })
}

/** Generate an immutable creation event id without assuming randomUUID exists in the browser or
 * Server Edition. The coordinator records this id on the node and uses it for deduplication. */
export function newCreationEventId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random) return random
  return `creation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
