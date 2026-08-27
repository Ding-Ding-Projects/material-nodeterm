import type { Node } from '@xyflow/react'
import type { AgentLaunchIntent, BrowserTab, CanvasMutation, CanvasNodeState, ClaudeAccount, NodeKind, PendingLaunch, Project, ServiceNodeKind } from '@shared/types'
import { normalizeMediaReference, type MediaAssetReference } from '@shared/media-catalog'
import { normalizePublicDimSumSelection, type PublicDimSumSelection } from '@shared/public-dim-sum'
import type { CalendarNodeConfig } from '@shared/calendar'
import type { HomeAssistantNodeIntent } from '@shared/home-assistant'
import { DEFAULT_HOME_ASSISTANT_NODE_INTENT } from '@shared/home-assistant'
import type { HomeAssistantControlConfig } from '@shared/home-assistant-control'
import { DEFAULT_HOME_ASSISTANT_CONTROL_CONFIG, validateHomeAssistantControlConfig } from '@shared/home-assistant-control'
import { DEFAULT_HOME_ASSISTANT_SENSOR_CONFIG, type HomeAssistantSensorConfig } from '@shared/home-assistant-sensor'
import type { AlarmOccurrence, AlarmRecurrence } from '@shared/alarm-clock'
import type { ServiceConnection } from '@shared/node-exec'
import { OPEN_WEBUI_DEFAULT_INTENT, type OpenWebUiIntent, type OpenWebUiLocalBinding } from '@shared/open-webui-hosting'
import { DEFAULT_GITLAB_HOSTING_CONFIG, type GitLabHostingConfig } from '@shared/gitlab-hosting'
import { NEXTCLOUD_AIO_DEFAULT_CONFIG } from '@shared/nextcloud-aio'
import { DEFAULT_NEXTCLOUD_MANAGED_INTENT, type NextcloudManagedBinding, type NextcloudManagedIntent } from '@shared/nextcloud-managed'
import { GITHUB_WORK_ITEM_NODE_SIZE } from '@shared/github-work-items'
import type { NsisLocalPaths, NsisSpec } from '@shared/nsis-form-types'
import { defaultNsisLocalPaths, defaultNsisSpec } from '@shared/nsis-form-types'
import type { AgentId, AgentPermissionMode, BuiltinAgentId } from '@shared/agents/config'
import {
  agentConfig,
  agentLaunchProgram,
  explicitCodexResumeSession,
  mintsSessionId,
  resumeCommand,
  withSessionId
} from '@shared/agents/config'
import { withPermissionMode } from '@shared/agents/approval-mode'
import { uuid } from '@renderer/lib/uuid'
import {
  claudeCliCapsNow,
  permissionModeFromLaunchPlan,
  type ActiveAgentLaunchPlan
} from './permissionMode'
import type {
  CanvasMutation,
  CanvasNodeState,
  ClaudeAccount,
  NodeKind,
  PendingLaunch,
  Project,
  Settings
} from '@shared/types'
import type { AgentId, AgentPermissionMode, BuiltinAgentId } from '@shared/agents/config'
import { agentConfig, supportsSessionIdFlag } from '@shared/agents/config'
import { assembleLaunchCommand } from '@shared/agents/launch'
import { agentAccountColor } from '@shared/agents/account-color'
import { boundAccountId } from '@shared/agents/account-binding'
import { agentEnvSnapshot } from '../lib/agentEnv'
import { uuid } from '@renderer/lib/uuid'
import { claudeCliCapsNow } from './permissionMode'
import { projectLaunchInfoNow } from './projectLaunchInfo'
import { isAgentEnabled, launchableDefaultAgent } from './agentAvailability'
import { codexSharedIdentity } from './codexIdentity'
import { sshHostKey } from '@shared/ssh'
import { useSettings } from './settings'
import type { SessionSource } from '../session/session'
import { supportsWindowsTerminalProfiles } from './terminal-profiles'
import type { AnnotationRect, AnnotationVariant } from '../lib/annotation'
import { newUniverseCreationEventId, shopNodeIdForCanvas } from '../../core/universe-shop'
import { TORRENT_NODE_CATALOG_ENTRY } from '@shared/torrent'
import { DEFAULT_VIRTUAL_MACHINE_CONFIG } from '@shared/virtual-machine'
import { TIMER_DEFAULT_DURATION_MS, type TimerNodeData } from '@shared/timer'
import { normalizeAwsIdentityIntent } from '@shared/aws-identity'
import { createRecoveryGameSnapshot, normalizeRecoveryGameSnapshot, type RecoveryGameSnapshot } from '@shared/recovery-game'
import type { PortableKioskPwaIntent } from '@shared/kiosk-pwa'
import { normalizeNodeIcon } from '@shared/node-icon'
import { CLOUDFLARE_DEFAULT_INTENT, type CloudflarePortableIntent } from '@shared/cloudflare-core-managers'
import { AWS_MANAGER_DEFAULT_INTENT, type AwsManagerMode, type AwsManagerPortableIntent } from '@shared/aws-resource'
import type { TunnelPortableIntent } from '@shared/tunnel-state'

// Re-exported so Canvas (and anything else in the renderer) keeps importing it from here, while the
// single implementation lives in src/shared and is shared with the relay host + the canvas-sync
// reflector.
export { applyCanvasMutation } from '@shared/canvas-mutations'
export { accountNodeColor, agentAccountColor } from '@shared/agents/account-color'
import { acceptNewInboundNode, sanitizeInboundNode } from '@shared/node-exec'
import { newCreationEventId } from '@shared/node-catalog'

/** Preset color palette — macOS system colors (dark mode). */
export const NODE_COLORS = [
  '#0a84ff', // systemBlue
  '#32d74b', // systemGreen
  '#ffd60a', // systemYellow
  '#ff453a', // systemRed
  '#bf5af2', // systemPurple
  '#6ac4dc', // systemTeal
  '#ff9f0a' // systemOrange
]

const TERMINAL_SIZE = { width: 640, height: 440 }
const STICKY_SIZE = { width: 240, height: 200 }
const GROUP_SIZE = { width: 520, height: 360 }
/** A fresh worktree group starts empty but exists to HOLD terminals/agents, and the default
 *  GROUP_SIZE (520×360) is smaller than a single terminal (600×400) — a dropped-in terminal would
 *  overflow the frame. Open it large enough for one terminal with margin, and room to add another. */
export const WORKTREE_GROUP_SIZE = { width: 760, height: 540 }
const EDITOR_SIZE = { width: 660, height: 460 }
const DIFF_SIZE = { width: 860, height: 500 }
const DINO_SIZE = { width: 600, height: 200 }
const RECOVERY_GAME_SIZE = { width: 540, height: 620 }
const VIDEO_SIZE = { width: 640, height: 420 }
const PHOTO_SIZE = { width: 560, height: 440 }
const GALLERY_SIZE = { width: 760, height: 520 }
const WILD_DIM_SUM_SIZE = { width: 560, height: 560 }
const WEB_SIZE = { width: 720, height: 520 }
const BROWSER_SIZE = { width: 800, height: 560 }
const NATIVE_LOOP_SIZE = { width: 340, height: 280 }
const SHOP_SIZE = { width: 480, height: 420 }
export const AWS_RESOURCE_SIZE = { width: 720, height: 580 }
export const TORRENT_SIZE = { width: 620, height: 520 }
export const CLOUDFLARE_CORE_MANAGERS_SIZE = { width: 760, height: 680 }
const LINUX_VM_SIZE = { width: 760, height: 560 }
const WINDOWS_DIAGNOSTICS_SIZE = { width: 760, height: 560 }
const TIMER_SIZE = { width: 380, height: 360 }
const ALARM_SIZE = { width: 380, height: 360 }
const OPEN_WEBUI_SIZE = { width: 680, height: 560 }
/** Fallback bounding box `flowToNodeStates` uses if an annotation node somehow has no live
 *  width/height at all (every production creation path draws a real rect — see createAnnotationNode
 *  — so this is a defensive floor, matching how every other kind gets a fallback in `sizeFor`). */
const ANNOTATION_SIZE = { width: 240, height: 160 }
/**
 * Service managers. Two shapes rather than six numbers, because the distinction that matters is how
 * much a surface has to SHOW, not which product it manages:
 *
 * - a console-and-list manager (Minecraft, Docker, Proxmox) needs room for output beside a list, so
 *   it starts nearer a terminal's footprint;
 * - a summary manager (GitLab, Home Assistant, FreePBX) opens on counts and status rows and can
 *   start smaller without immediately needing a resize.
 *
 * Both are only STARTING sizes; every one of these nodes resizes like any other.
 */
const SERVICE_CONSOLE_SIZE = { width: 720, height: 520 }
const SERVICE_SUMMARY_SIZE = { width: 520, height: 400 }

/** Height of a node when collapsed (header only). */
export const COLLAPSED_HEIGHT = 40

/** User data carried in the React Flow node's data field. */
export interface NodeData {
  /** Immutable creation event key. Hydration reads it but never mints a replacement event. */
  creationEventId?: string
  /** A live canvas object that was never asked to survive the session — today only a browser
   *  popup. `flowToNodeStates` drops it, so it is absent from project.json, the SSH mirror and the
   *  export archive alike; the node's own "Keep" action clears the flag to promote it. */
  temporary?: boolean
  /** Set by ADHD focus mode on every node that is NOT the focus target; the stylesheet fades it.
   *  Marked rather than filtered, because focus DIMS and never hides — the node stays in the graph,
   *  stays clickable, and returns to full opacity on hover. Transient: derived on every render from
   *  the live selection and never written by `flowToNodeStates`, so it cannot reach project.json. */
  adhdDimmed?: boolean
  title: string
  /**
   * Agent nodes only: while true (the default for agent nodes), the title auto-tracks the
   * agent's session name (see TerminalNode's onTitleChange). Flipped to false the moment the
   * user renames the node by hand — then the user's name is pushed back via `/rename`.
   */
  titleAuto?: boolean
  color: string
  group: string | null
  tags?: string[]
  /** User-chosen terminal-session mark, validated before entering or leaving live state. */
  icon?: import('@shared/node-icon').NodeIcon
  collapsed?: boolean
  /** Native persisted Loop node fields (type='scheduler'). */
  loopTask?: string
  loopIntervalMs?: number
  loopEnabled?: boolean
  loopNextRunAt?: number
  loopLastRunAt?: number
  loopTargetIds?: string[]
  /** Alarm Clock node intent and machine-local planner projection. */
  alarmSchedule?: { recurrence: AlarmRecurrence; date?: string; time: string; weekdays?: number[]; monthDay?: number }
  alarmTimeZone?: string
  alarmEnabled?: boolean
  alarmSnoozeMinutes?: number
  alarmSoundEnabled?: boolean
  alarmNarratorEnabled?: boolean
  alarmNextOccurrenceAt?: number
  alarmHistory?: AlarmOccurrence[]
  /** Agent nodes only: when true, this node's subagent/loop fan-out cards are hidden. */
  hideFanout?: boolean
  /** Expanded height to restore when un-collapsing (kept out of the persisted size). */
  expandedHeight?: number
  /**
   * Set while the node is maximized to the viewport (issue #399): the ROOT-space rect the
   * restore toggle gives back. Persisted — see CanvasNodeState.premaxRect.
   */
  premaxRect?: { x: number; y: number; width: number; height: number }
  /** One-shot command run once when the terminal first opens (not persisted). */
  initialCommand?: string
  /**
   * Shell-independent first launch for a Windows-profile agent node. The trusted core consumes it;
   * unlike `initialCommand`, no renderer code turns this into Windows shell syntax.
   */
  agentLaunchIntent?: AgentLaunchIntent
  /**
   * Terminal nodes armed with canvas-control's `--after`: the launch is held until every node
   * in `after` reports idle. Unlike `initialCommand` this is durable in the trusted machine-local
   * execution overlay, but is stripped from shared project files and peer traffic. Cleared only
   * after the opaque executor reports success.
   */
  pendingLaunch?: PendingLaunch
  /** Sanitized failure from the last opaque pending-launch attempt; transient and local-only. */
  pendingLaunchError?: string
  /** Whether a retry may mint a new id (`confirmed`) or must query the same host ledger (`unknown`). */
  pendingLaunchErrorKind?: 'confirmed' | 'unknown'
  /** Ownership of the displayed pending-launch error, so authored recovery copy never gets
   * accidentally treated as an external diagnostic merely because both are strings. */
  pendingLaunchErrorOwnership?: 'authored' | 'external-factual'
  /**
   * Transient respawn trigger: bumping this number tears down a terminal node's session and
   * recreates it (used to move an existing terminal into a worktree cwd). Not persisted —
   * deliberately absent from flowToNodeStates, like initialCommand/expandedHeight.
   */
  respawnNonce?: number
  shell?: string
  /**
   * Machine-local Windows terminal profile snapshotted when this node was created. Legacy nodes
   * deliberately leave this unset so the trusted spawn path can continue using the current
   * configured default.
   */
  terminalProfileId?: string
  cwd?: string
  text?: string
  /** sticky-only: last canvas-control `sticky` write (when / by which agent node). Cleared on a
   *  hand edit — the stamp means "an agent synced this", not "last touched". */
  textUpdatedAt?: number
  textUpdatedBy?: string
  filePath?: string
  /** Wild dim sum only: validated portable selection from the public catalog. */
  wildDimSumDish?: PublicDimSumSelection
  /**
   * editor/diff-only: true once this node's `filePath` was confirmed gone — e.g. a worktree
   * that contained it was removed (`displacedByWorktree` in @shared/worktree sweeps these up
   * alongside terminal/chat cwds). Unlike a terminal's cwd, there is nothing to re-point an
   * editor/diff node AT — the file itself no longer exists — so instead of silently opening
   * blank (editor) or failing a `git show` (diff), the node shows a persistent notice. Persisted:
   * the fact is durable, not a one-shot event like `respawnNonce`.
   */
  fileMissing?: boolean
  /** web-only: live URL to load in the web (webview) node. */
  url?: string
  /** Browser-only: agent node allowed to control this tab through the Browser Plugin. */
  browserOwnerNodeId?: string
  /** Browser-only: which of the project's browserProfiles this node's webview session uses.
   *  Undefined = the app's default (unpartitioned) session — see @shared/browser-profiles. */
  browserProfileId?: string
  /** Browser-only: the node's open tabs (git-shared project content — see `CanvasNodeState`). */
  browserTabs?: BrowserTab[]
  /** Browser-only: which `browserTabs[].id` is currently shown. Undefined = the first tab. */
  browserActiveTabId?: string
  /** Portable kiosk/PWA launch intent only. Host profiles and runtime lifecycle are local. */
  kioskPwaIntent?: PortableKioskPwaIntent
  /**
   * browser-only: the Electron session partition for this <webview>. Set ONCE at creation for an
   * AGENT-opened node (`agentBrowserPartition`, `persist:nt-agent-browser-<projectId>`) and never
   * mutated — [MEASURED, Electron 42.8.1] `partition` is honoured only at attach. Absent (undefined)
   * for a USER-opened node, which keeps the default session (no migration, no lost logins). Carried
   * through persistence untouched on Server Edition / mobile, where a browser node has no <webview>.
   */
  partition?: string
  /**
   * browser/web-only, NEVER persisted: this node object is a background KEEP-ALIVE GHOST — a
   * `display:none` stand-in merged into the `<ReactFlow>` prop so the `<webview>` of a project the
   * user switched away from stays mounted (its guest process dies on DOM detach). Ghosts live only
   * in `state/webviewKeepAlive.ts` pool entries; Canvas state, persistence, undo and the wire never
   * hold one. The surfaces read it to route their callbacks at the pool instead of React Flow.
   */
  ghost?: boolean
  diffStaged?: boolean
  commitOid?: string
  /** dino-only: best score reached in the T-Rex Runner game. */
  highScore?: number
  /** recovery-game-only: bounded portable progress. */
  recoveryGame?: RecoveryGameSnapshot
  /** service-kinds only: the display name the user gave this manager. See `CanvasNodeState`. */
  serviceLabel?: string
  gitlabHostingConfig?: GitLabHostingConfig
  /** Nextcloud AIO safe deployment intent; live Docker bindings remain outside project data. */
  nextcloudAioConfig?: import('@shared/nextcloud-aio').NextcloudAioConfig
  nextcloudManagedIntent?: NextcloudManagedIntent
  nextcloudManagedBinding?: NextcloudManagedBinding
  /** Cloudflare manager safe intent; local credential and provider state never enters project data. */
  cloudflareCoreIntent?: CloudflarePortableIntent
  /** Cloudflare Tunnel route intent; local observations and provider bindings stay outside project data. */
  cloudflareTunnelIntent?: TunnelPortableIntent
  /** Access, Zero Trust, Workers, Pages, R2, D1 and Queues intent; account state stays local. */
  cloudflareZeroTrustIntent?: import('@shared/cloudflare-zero-trust').CloudflarePortableIntent
  homeAssistantIntent?: HomeAssistantNodeIntent
  /** Safe Cloudflare Tunnel routing intent; provider and local runtime state stays machine-local. */
  cloudflareTunnelIntent?: import('@shared/cloudflare-tunnel-handoff').CloudflareTunnelIntent
  /** Safe ownership metadata for a special-universe Shop node. */
  universeCanvasId?: string
  universeScope?: 'multiverse' | 'aws-universe'
  /** The Shop is permanently owned by its universe canvas. */
  nonDeletable?: boolean
  /** Last catalog choice is safe user intent only, not an execution or provider binding. */
  shopSelection?: string
  /** Portable Linux ISO VM intent and machine-local asset bindings. */
  virtualMachineConfig?: import('@shared/virtual-machine').VirtualMachineConfig
  virtualMachineLocalPaths?: import('@shared/virtual-machine').VirtualMachineLocalPaths
  /** service-kinds only, MACHINE-LOCAL: where this node reaches its service. Stripped from the
   *  shared document and from inbound peers; see shared/node-exec.ts. */
  serviceConnection?: ServiceConnection
  /** Open WebUI safe provider/port intent is project-portable; the live binding stays local. */
  openWebUiIntent?: OpenWebUiIntent
  openWebUiLocalBinding?: OpenWebUiLocalBinding
  /** Safe torrent magnet intent shared with the canvas. */
  torrentMagnet?: string
  /** AWS Resource Explorer and Cloud Control safe portable intent. */
  awsManagerIntent?: AwsManagerPortableIntent
  /** nsis-only, GIT-SHARED: the installer's description. See `NsisSpec`. */
  nsisSpec?: NsisSpec
  /** nsis-only, MACHINE-LOCAL: absolute source/license/icon paths on this machine. Stripped
   *  from the shared document and from inbound peers; see shared/node-exec.ts. */
  nsisLocalPaths?: NsisLocalPaths
  /** calendar-only, portable selection intent; local cache and credentials are never here. */
  calendarConfig?: CalendarNodeConfig
  /** Home Assistant control portable intent. Local connection state belongs to the host service. */
  homeAssistantControlConfig?: HomeAssistantControlConfig
  /** Home Assistant sensor-only portable entity and display intent. */
  homeAssistantSensorConfig?: HomeAssistantSensorConfig
  /** Which agent runs in this terminal node (claude/codex/gemini/custom). */
  agentId?: AgentId
  /** Model selected for this node through the shared model gateway. */
  agentModel?: string
  /**
   * Claude nodes only: the managed Claude account (config-dir isolated) this node runs under.
   * Persisted so cold-restore resume reads the transcript from the right account dir.
   */
  accountId?: string
  /** Durable purpose marker; titles can be renamed and initialCommand is consumed on first use. */
  accountLogin?: boolean
  /**
   * Agents in `SESSION_ID_CAPABLE` (claude): the session id nodeterm MINTED for this node and
   * launched the CLI with. Persisted so a resume is possible even when no hook ever delivered an
   * id — the case that turned 18 of 40 nodes into blank conversations after one host reboot.
   * The live id from hooks still wins when present: `/clear` and `--fork-session` mint a new one
   * inside the CLI, and this field only remembers the id we chose at first launch.
   */
  agentSessionId?: string
  /** Codex nodes only: managed CODEX_HOME. Undefined = system ~/.codex account. */
  codexAccountId?: string
  /** group-only: the git worktree this group is bound to (single source of truth). */
  worktree?: import('@shared/worktree').GroupWorktree
  /**
   * When set, this terminal runs `ssh` to a remote host on the LOCAL PTY (LocalTransport).
   * Unlike `remote` (relay), this IS persisted — the node auto-reconnects on relaunch.
   */
  ssh?: import('@shared/ssh').SshConnection
  /**
   * When true (SSH-project terminals), this node runs in REMOTE tmux on the host in `ssh`
   * (LocalTransport passes `sshRemote` to the PTY), rather than plain `ssh`-on-local-PTY. Persisted.
   */
  sshRemoteTmux?: boolean
  /**
   * editor-only: when true (an editor created in an SSH project), reads/writes/image-previews go to
   * the project's REMOTE filesystem via `sshFs(projectId)` instead of the local fs. Persisted, so an
   * SSH-project editor still routes to the remote fs after reopen.
   */
  sshFs?: boolean
  /** annotation-only: 'line' or 'arrow' — see createAnnotationNode and AnnotationNode.tsx. */
  annotationVariant?: 'line' | 'arrow'
  /** annotation-only: which corner-to-corner diagonal of the node's box the line/arrow follows. */
  annotationDir?: 'tl-br' | 'tr-bl'
  [key: string]: unknown
}

/** React Flow node type string mirrors the persisted NodeKind. */
export type CanvasNode = Node<NodeData, NodeKind>

/** Single-quote a string for safe use as one shell argument (POSIX).
 *  Imported from `@shared/shell-quote` so the renderer and the shared command-assembly layer share
 *  one definition, and re-exported so the renderer keeps its historical import path. */
import { shellSingleQuote } from '@shared/shell-quote'
export { shellSingleQuote }

/**
 * 8 hex characters of CSPRNG — the unique tail of every node and project id.
 *
 * It replaces a module-level `let idCounter = 0`, which was a latent collision generator: the
 * counter restarted at 0 on every renderer start AND on every HMR reload, so `term-<ms36>-1` was
 * minted again and again and only `Date.now()` (millisecond resolution) kept the ids apart. A node
 * id IS the tmux session name and the persistence key, so a repeat means two nodes co-attached to
 * one terminal.
 *
 * Kept inside `[A-Za-z0-9._-]` and short, because these ids become tmux session names and are
 * charset-validated on several paths (tmux-naming, hook-server, codex-identity-proxy,
 * project-node-append). No `Math.random()`: bulk flows (duplicate, "spawn a team") mint many ids in
 * one tick, which is exactly where a weak generator repeats.
 */
function randomToken(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.getRandomValues) {
    return Array.from(c.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Non-browser, non-Node-19 fallback (never taken in the app or in tests): still 8 chars.
  return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomToken()}`
}

/** Stagger placement so new nodes don't overlap. */
function staggeredPosition(index: number) {
  return { x: 80 + (index % 4) * 360, y: 120 + Math.floor(index / 4) * 320 }
}

/** Top-left position so a node of the given size is centered on `center`. */
function placeAt(center: { x: number; y: number } | undefined, index: number, w: number, h: number) {
  return center ? { x: center.x - w / 2, y: center.y - h / 2 } : staggeredPosition(index)
}

/**
 * Default size for NEW terminal/agent nodes: the user's setting (Settings → Canvas), clamped
 * to sane canvas bounds — settings.json is hand-editable, and a 0×0 or NaN node would be
 * unclickable/ungrabbable forever. Falls back to the historical 600×400.
 */
function terminalNodeSize(): { width: number; height: number } {
  const s = useSettings.getState().settings
  const clamp = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
    return Math.min(hi, Math.max(lo, n))
  }
  return {
    width: clamp(s.defaultNodeWidth, 280, 2400, TERMINAL_SIZE.width),
    height: clamp(s.defaultNodeHeight, 160, 1600, TERMINAL_SIZE.height)
  }
}

/**
 * Creates a new terminal node. `cwd` comes from the active project's default folder. When `ssh`
 * (the active SSH project's binding) is given, the node runs in REMOTE tmux on that host: its
 * `data.ssh`/`data.sshRemoteTmux`/`data.cwd` are stamped from the binding instead of `cwd`.
 */
/**
 * The `ssh` argument a node factory needs so a new node runs on the SAME host as the project.
 *
 * Two things are easy to get wrong here, and both have shipped as bugs: passing `undefined` on an
 * SSH project builds a LOCAL node carrying a REMOTE cwd — it opens on the desktop, in a directory
 * that does not exist there — and passing the project's `ssh` unchanged silently REPLACES the
 * caller's cwd, because the factories read a node's cwd out of `remoteCwd`. So the effective cwd
 * is threaded through `remoteCwd`, and a local project still yields `undefined` (byte-identical to
 * the pre-SSH behaviour).
 */
export function nodeSshFor(
  projectSsh: Project['ssh'] | undefined,
  cwd?: string
): Project['ssh'] | undefined {
  if (!projectSsh) return undefined
  return { server: projectSsh.server, remoteCwd: cwd || projectSsh.remoteCwd }
}

export interface TerminalNodeCreationOptions {
  /** Session that will own the node; relay/server cores must resolve their own shell. */
  sessionSource: SessionSource
  /** Explicit selection from a profile picker; omitted means snapshot the current default. */
  terminalProfileId?: string
}

/**
 * Profile selection for a newly-created local terminal or agent node. The SSH argument is the
 * authoritative locality boundary: an SSH-project node must never inherit a Windows profile from
 * the renderer machine, even when a caller accidentally supplies an explicit one.
 */
function terminalProfileForNewNode(
  ssh: Project['ssh'] | undefined,
  options: TerminalNodeCreationOptions | undefined
): string | undefined {
  if (ssh || options?.sessionSource !== 'local' || !supportsWindowsTerminalProfiles()) return undefined
  return options?.terminalProfileId ?? useSettings.getState().settings.defaultTerminalProfileId
}

export function createTerminalNode(
  index: number,
  cwd?: string,
  center?: { x: number; y: number },
  initialCommand?: string,
  ssh?: Project['ssh'],
  options?: TerminalNodeCreationOptions
): CanvasNode {
  const size = terminalNodeSize()
  const terminalProfileId = terminalProfileForNewNode(ssh, options)
  return {
    id: nextId('term'),
    type: 'terminal',
    position: placeAt(center, index, size.width, size.height),
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title: `Terminal ${index + 1}`,
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      tags: [],
      cwd: ssh ? ssh.remoteCwd : cwd,
      initialCommand,
      ...(terminalProfileId !== undefined ? { terminalProfileId } : {}),
      accountLogin: false,
      ...(ssh ? { ssh: ssh.server, sshRemoteTmux: true } : {})
    }
  }
}

/**
 * Creates a terminal node that runs `ssh` to a saved server on the local PTY. The connection
 * is snapshotted inline (`data.ssh`) so the node survives the server being edited/deleted.
 */
export function createSshTerminalNode(
  server: import('@shared/ssh').SshServer,
  index: number,
  center?: { x: number; y: number }
): CanvasNode {
  const size = terminalNodeSize()
  return {
    id: nextId('ssh'),
    type: 'terminal',
    position: placeAt(center, index, size.width, size.height),
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title: server.label,
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      tags: [],
      ssh: {
        host: server.host,
        user: server.user,
        port: server.port,
        identityFile: server.identityFile,
        extraArgs: server.extraArgs,
        // Provenance: this came from the machine-local SSH server store — the local user typed it.
        // So the exec site may honor an advanced option like a jump host's `-o ProxyCommand=…`.
        // The marker never reaches a project file or the wire (@shared/node-exec).
        execTrusted: server.extraArgs ? true : undefined,
        label: server.label
      }
    }
  }
}

/** The user's OWN global launch-command override, with no project layered over it. */
function globalLaunchOverride(agentId: AgentId): string | undefined {
  const raw = useSettings.getState().settings.agentLaunchCommands?.[agentId as BuiltinAgentId]
  const cmd = typeof raw === 'string' ? raw.trim() : ''
  return cmd || undefined
}

/**
 * Projects whose SHARED `agents` family we have already asked the human to trust this session.
 * The ask is fire-and-forget from a synchronous launch path (a launch is never blocked on it), so
 * without this every single launch in an untrusted project would re-raise the dialog. Once per
 * project is enough: an approval makes main fire `projectSettings.onTrustChanged`, Canvas
 * invalidates that project's launch-info cache, and the NEXT launch reads the fresh verdict and
 * picks the shared launchCmd up on its own.
 */
const agentsTrustAsked = new Set<string>()

/** Test seam: forget which projects have already been asked (see `agentsTrustAsked`). */
export function resetLaunchTrustAsksForTests(): void {
  agentsTrustAsked.clear()
}

/** Raise the `agents` trust prompt for a project, at most once per project per session. Never
 *  awaited and never allowed to throw: this runs inside a synchronous launch resolution, and the
 *  answer (if any) arrives via the trust-changed invalidation, not via this call. */
function askAgentsTrustOnce(projectId: string): void {
  if (agentsTrustAsked.has(projectId)) return
  agentsTrustAsked.add(projectId)
  try {
    // The preload leg REJECTS when the main handler throws (the ws-bridge leg maps that to false),
    // so the `.catch` is load-bearing — an unhandled rejection here would surface as a renderer
    // error on a path whose whole contract is "the launch does not care about the answer".
    void window.nodeTerminal?.projectSetup?.requestTrust(projectId, 'agents').catch(() => {})
  } catch {
    // No bridge leg at all (older relay host, a stub) — the launch proceeds on the global value.
  }
}

/**
 * The launch-command override for an agent, or undefined when nothing overrides the bare CLI.
 * This is the ONE place launch commands are read; every launch site (new node, cold restore,
 * in-place restart, hibernation wake, transcript resume) either calls this or receives its result
 * — shared/agents/config.ts cannot read settings (layering), so the renderer resolves the override
 * and passes it down (`resumeCommand`'s `base` param).
 *
 * Three layers, most specific first, with `projectId` naming the project that OWNS the node:
 *  1. the project's LOCAL `.nodeterm/settings.json` `agents.launchCmd` — this machine's own file,
 *     the user's own typing, never gated;
 *  2. the project's git-SHARED `agents.launchCmd`, but ONLY while that family is trusted at this
 *     location. Falling PAST an untrusted one raises the trust prompt (once per project, see
 *     `askAgentsTrustOnce`) and resolves on the layer below meanwhile — a launch is never blocked,
 *     never delayed, and never runs a shared command the human has not seen;
 *  3. the user's global Settings → Agents → Launch commands entry (builtin-keyed: custom agents
 *     index past it to undefined — they already own their launchCmd).
 *
 * SCOPE: the project's launchCmd applies ONLY to the agent that project ITSELF names —
 * `projectDefaultAgent`, its own valid `agents.defaultAgentId`, never the global default. The
 * family holds one launchCmd, not one per agent id, and the panel's copy is "Overrides how the
 * default agent is launched", so it needs an agent to be about; the pair is what makes it
 * meaningful. Falling back to the GLOBAL default here would have been a cross-agent misfire that
 * the builtin-KEYED global map made structurally impossible: a doc shipping only `launchCmd` would
 * follow whatever this user's mutable global default happens to be, so `nix develop -c claude`
 * could end up typed into a codex node, differently on each teammate's machine, and could change
 * under a node on cold restore after an unrelated Settings change.
 *
 * So an UNPAIRED launchCmd (a project that sets no valid `defaultAgentId` of its own) is a dead
 * setting: never consumed for any agent, and never prompts for trust. The Agents panel says so
 * on the row itself (`ProjectSettingsFamilies.tsx`) rather than leaving it silently inert.
 *
 * Fails OPEN in the ordinary sense: no project id, or no warm snapshot for it
 * (`projectLaunchInfoNow` is synchronous by design — see its module doc), resolves layer 3 alone,
 * byte-identical to the behavior before per-project settings existed.
 */
export function agentLaunchOverride(agentId: AgentId, projectId?: string): string | undefined {
  const global = globalLaunchOverride(agentId)
  if (!projectId) return global
  const info = projectLaunchInfoNow(projectId)
  if (!info) return global
  const entry = info.resolved.agents.launchCmd
  if (!entry) return global
  // Scope check BEFORE anything else: an agent this project does not name consumes nothing here,
  // so it must not even raise a trust prompt about a value it would never use.
  const target = projectDefaultAgent(projectId, useSettings.getState().settings)
  if (!target || target !== agentId) return global
  // `.nodeterm/settings.json` is hand-editable, git-shared, hostile input (see @shared/project-settings):
  // a non-string that slipped through is simply not a launch command.
  const cmd = typeof entry.value === 'string' ? entry.value.trim() : ''
  if (!cmd) return global
  // LITERAL ONLY — the same rule the project's ENV already obeys (`ProjectSpawnOverrides.env`:
  // "`${env:VAR}` is NOT expanded here"), and for the same reason. The assembler expands
  // `${env:…}` in whatever `launchCmdOverride` it is handed (`shared/agents/launch.ts`
  // `expandedProgram`) — a CUSTOM-AGENT feature, where the value is the local user's own typing and
  // Settings previews the expansion. Inheriting it for a project document would turn a hand-edited,
  // git-shared settings.json into a read of THIS machine's environment, laundered past a consent
  // dialog that rendered the token verbatim. Nor is honoring it literally an option: `${env:X}` is a
  // bad substitution at bash/zsh, so the typed line would fail anyway. So a project launchCmd
  // carrying a token is not a launch command — the same verdict, and the same fall-through, as the
  // non-string case above. Checked BEFORE the trust branch so a value that can never be consumed
  // never raises a question about itself, exactly like the out-of-scope agent check.
  //
  // BOTH halves, local as well as shared — the deliberate overreach `isReservedSpawnEnvKey` explains
  // for the env list: one auditable rule beats a provenance check at every launch. The cost is that
  // a local overlay cannot use expansion either; the global Settings → Agents override (which does
  // expand, and is previewed) is where a wrapper that needs `${env:…}` belongs.
  if (cmd.includes('${env:')) return global
  if (entry.source === 'local') return cmd
  // NOTE (carried from Task 2's review): the trust-changed invalidation this ask relies on is
  // keyed by projectId while the grant itself is keyed by LOCATION — two projects pointing at the
  // same folder each keep their own cached verdict, so the sibling stays cold until its own
  // refresh. Known and deliberate; the cost is one extra prompt, never a wrong grant.
  if (info.trusted.agents) return cmd
  askAgentsTrustOnce(projectId)
  return global
}

/**
 * The user's launch-command override for a builtin agent (Settings → Agents → Launch commands),
 * or undefined when unset/blank. This is the ONE place the setting is read; every launch site
 * (new node, cold restore, in-place restart, hibernation wake, transcript resume) either calls
 * this or receives its result — shared/agents/config.ts cannot read settings (layering), so the
 * renderer resolves the override and passes it down (`resumeCommand`'s `base` param).
 *
 * Trusted verbatim, like a custom agent's `launchCmd`: it comes from the local user's own
 * settings.json (never the shared, git-tracked `.nodeterm/project.json`) and is typed into their
 * own pane. Custom agents index past the builtin-keyed map to undefined — they already own their
 * launchCmd.
 */
export function agentLaunchOverride(agentId: AgentId): string | undefined {
  const raw = useSettings.getState().settings.agentLaunchCommands?.[agentId as BuiltinAgentId]
  const cmd = typeof raw === 'string' ? raw.trim() : ''
  return cmd || undefined
}

/**
 * Command that launches Claude Code. Detection works via hooks installed globally in
 * ~/.claude/settings.json (gated by NODETERM_* env that the PTY manager sets), so a plain
 * `claude` is enough — which is also why an override wrapper (account switchers etc.) is safe
 * here: hooks identify the session whatever the launch line was, as long as the wrapper ends up
 * exec-ing the real CLI. Append `-r <id>` to resume a specific session (used by Branch).
 */
export function claudeLaunchCommand(): string {
  return agentLaunchOverride('claude') ?? 'claude'
 * `projectId` layers that project's own launchCmd over the global one (`agentLaunchOverride`).
 */
export function claudeLaunchCommand(projectId?: string): string {
  return agentLaunchOverride('claude', projectId) ?? 'claude'
}

/**
 * The agent THIS PROJECT names as its own default (`agents.defaultAgentId`), or undefined when it
 * names none — deliberately WITHOUT any global fallback, so a caller can tell "the project chose
 * this agent" from "nobody chose, so the app's default applies". `agentLaunchOverride`'s scoping
 * turns on exactly that difference; `resolveNewNodeAgent` adds the fallback on top.
 *
 * VALIDATED against what this machine can actually launch — a known builtin, or a custom agent the
 * user still has — and against `disabledAgents`: `.nodeterm/settings.json` is git-shared and
 * hand-editable, so it may name an agent that was removed, never existed, or that this user
 * deliberately switched off, and none of those may become the id typed into a shell
 * (`resolveAgent`'s unknown-id fallback launches the id itself — the same failure
 * `launchableDefaultAgent` exists to prevent for the global setting).
 *
 * Deliberately NOT trust-gated: naming which of the user's own installed agents to open is not
 * executable content (`projectTrustContent('agents', …)` hashes launchCmd + env, not this), and
 * every id it can select resolves to a command the user already configured themselves.
 */
function projectDefaultAgent(
  projectId: string | undefined,
  settings: Settings
): AgentId | undefined {
  const raw = projectId ? projectLaunchInfoNow(projectId)?.resolved.agents.defaultAgentId : undefined
  const id = typeof raw?.value === 'string' ? raw.value.trim() : ''
  if (!id) return undefined
  const known = !!agentConfig(id) || settings.customAgents.some((c) => c.id === id)
  return known && isAgentEnabled(settings, id) ? id : undefined
}

/**
 * The agent a NEW node launches: an explicit pick always wins, then the project's own validated
 * `agents.defaultAgentId` (`projectDefaultAgent`), then the global default.
 */
export function resolveNewNodeAgent(
  explicit: AgentId | undefined,
  projectId: string | undefined,
  settings: Settings
): AgentId {
  return explicit ?? projectDefaultAgent(projectId, settings) ?? launchableDefaultAgent(settings)
}

/** Fallback color for custom / unknown agents that have no config-provided color. */
const FALLBACK_AGENT_COLOR = '#888888'

/**
 * Resolves an agent's label/color/launch command. Builtins come from the static config;
 * custom agents are looked up by id in the settings store. Falls back to the id itself for
 * unknown agents so a node still spawns something sensible.
 */
function resolveAgent(agentId: AgentId): {
  label: string
  color: string
  launchCmd: string
} {
  const builtin = agentConfig(agentId)
  if (builtin) return { label: builtin.label, color: builtin.color, launchCmd: builtin.launchCmd }
  const custom = useSettings.getState().settings.customAgents.find((c) => c.id === agentId)
  if (custom) return { label: custom.label, color: FALLBACK_AGENT_COLOR, launchCmd: custom.launchCmd }
  return { label: agentId, color: FALLBACK_AGENT_COLOR, launchCmd: agentId }
}

/**
 * The managed accounts selectable in a given project, host-scoped. A LOCAL project shows only
 * local accounts (no `host`); an SSH project shows only accounts whose `host` matches that
 * project's connection identity (`sshHostKey` = `user@host`). Pending (not-yet-logged-in) accounts
 * are always excluded. Keeps a project's add-menus / default-account picker from offering an
 * account that can't run there (a remote account's credentials live on its host's filesystem).
 */
export function accountsForProject<T extends Pick<ClaudeAccount, 'pending' | 'host'>>(
  accounts: T[],
  project: { ssh?: { server: { host: string; user: string } } } | undefined
): T[] {
  const hostKey = project?.ssh ? sshHostKey(project.ssh.server) : undefined
  return accounts.filter((a) => !a.pending && (hostKey ? a.host === hostKey : !a.host))
}

/**
 * Hint row for an SSH project's account pickers when the host has no eligible accounts —
 * local accounts are (correctly) filtered out there, which reads as "multi-account is broken
 * on SSH" unless the menu says where this host's accounts come from. Null for local projects
 * (an empty list there just means no managed accounts) and once a matching account exists.
 * Takes the ALREADY-FILTERED list (`accountsForProject`), which every picker computes anyway.
 */
export function sshAccountsHint(
  project: { ssh?: unknown } | undefined,
  eligibleAccounts: ClaudeAccount[]
): string | null {
  return project?.ssh && eligibleAccounts.length === 0
    ? 'No accounts on this host yet — add one in Settings → Accounts while this project is connected.'
    : null
}

/**
 * Account for a NEW Claude node: explicit pick, else the project default, else system.
 *
 * `explicit === null` is an EXPLICIT "System account" pick and short-circuits past the project
 * default. Before it existed, the submenu row wearing the user's system email launched the
 * PROJECT DEFAULT account — the clearest "picked X, ran as Y" in issue #419 — because "no
 * account passed" and "system picked" were the same value.
 *
 * Validation runs against the accounts ELIGIBLE for this project (`accountsForProject`), not the
 * raw list, mirroring what every picker offers. The raw list also holds `pending` rows (their dir
 * exists but no login lives in it yet) and accounts pinned to ANOTHER machine's host (their dir
 * exists only over there) — a `defaultAccountId` pointing at either used to be stamped onto the
 * node, whose spawn then fell into the missing/empty-dir fallback and silently ran under a
 * different identity (#419 again). Ineligible ⇒ undefined ⇒ the honest system default.
 */
export function resolveNewNodeAccount(
  explicit: string | null | undefined,
  project:
    | { defaultAccountId?: string; ssh?: { server: { host: string; user: string } } }
    | undefined,
  accounts: ClaudeAccount[]
): string | undefined {
  if (explicit === null) return undefined
  const id = explicit ?? project?.defaultAccountId
  // A stale default (account since removed) must not stamp dead ids onto new nodes.
  return id && accountsForProject(accounts, project).some((a) => a.id === id) ? id : undefined
}

/**
 * Creates a terminal node that launches the given agent on open. Title, color, and the
 * launch command come from the resolved agent config (builtin or custom); the node carries
 * `agentId` so the rest of the app (hooks, capabilities, UI) can branch on it. For `claude`
 * we use `claudeLaunchCommand()`.
 */
export function createAgentNode(
  agentId: AgentId,
  index: number,
  cwd?: string,
  center?: { x: number; y: number },
  initialPrompt?: string,
  ssh?: Project['ssh'],
  accountId?: string,
  launchPlanOrPermission?: ActiveAgentLaunchPlan | AgentPermissionMode,
  options?: TerminalNodeCreationOptions
): CanvasNode {
  const { label, color: agentColor, launchCmd } = resolveAgent(agentId)
  const settings = useSettings.getState().settings
  const bound = boundAccountId(accountId, agentId)
  const color =
    agentAccountColor(agentId, bound, {
      claude: settings.claudeAccounts,
      codex: settings.codexAccounts
    }) ?? agentColor
  // A SHARED_IDENTITY_CAPABLE agent (codex) launches through its managed launcher when this
  // machine actually has one — otherwise the bare CLI, byte-identical to before. Asked through the
  // capability helper, never `agentId === 'codex'`; `codexSharedIdentity` folds in the SSH answer
  // too. An SSH node stays bare at factory construction so TerminalNode can rewrite the trusted
  // launch to the host's preflight-resolved `codexLauncherPath` once its attachment is available.
  // A user launch-command override wins over BOTH the builtin default and the managed launcher —
  // an explicit "launch it exactly like this" (see agentLaunchOverride / resumeCommand's `base`).
  const override = agentLaunchOverride(agentId)
  const baseCmd =
    agentId === 'claude'
      ? claudeLaunchCommand()
      : (override ?? agentLaunchProgram(agentId, launchCmd, codexSharedIdentity(ssh)))
  // A flag-prompt agent (opencode) takes the initial prompt via its flag — a bare positional
  // would be misread (opencode treats it as a project path). Everything else keeps the
  // historical argv append, INCLUDING stdin-after-start agents (gemini has always launched
  // via argv here; changing that is a separate decision).
  const normalizedPrompt = initialPrompt?.replace(/\s+/g, ' ').trim() || undefined
  const promptArg = normalizedPrompt ? shellSingleQuote(normalizedPrompt) : null
  // A CLI whose positional prompt shares its slot with subcommands needs a separator, or a
  // one-word prompt runs as a command instead (grok: `grok version` prints the version, `grok --
  // version` asks the model about "version"). Absent for everyone else, so their command line is
  // byte-identical to what it was.
  const sep = agentConfig(agentId)?.argvPromptSeparator
  const isFlagPrompt = agentConfig(agentId)?.promptInjectionMode === 'flag-prompt'
  // The separator only participates when there is actually a prompt to separate (no dangling `--`),
  // and never for a flag-prompt agent, whose prompt is not a positional at all.
  const usesSep = !!promptArg && !!sep && !isFlagPrompt
  // `withPrompt` is the NO-separator shape, and only that: it is read at exactly one place below,
  // in the `!usesSep` arm. Reaching it with a prompt and no flag-prompt mode means `sep` was falsy,
  // so an inline `${sep ? … : ''}` here could only ever expand to '' — the separator's one home is
  // the `usesSep` arm, which spells it out.
  const withPrompt = promptArg
    ? isFlagPrompt
      ? `${baseCmd} --prompt ${promptArg}`
      : `${baseCmd} ${promptArg}`
    : baseCmd
  permissionMode?: AgentPermissionMode,
  projectId?: string,
  /** Per-node model override for a MODEL_SWITCH_CAPABLE agent (claude/codex/copilot, base-resolved).
   *  Applied through the effective base harness via `withAgentModel` (a no-op for a non-capable
   *  agent, so passing a model for one is harmless — it's simply not appended). Persisted as
   *  `data.agentModel` so cold-restore and later restarts keep the model. Trails `projectId`: every
   *  existing caller passes that ninth argument, so the model is the one that had to move. */
  model?: string
): CanvasNode {
  const { label, color: agentColor } = resolveAgent(agentId)
  const settings = useSettings.getState().settings
  const bound = boundAccountId(accountId, agentId)
  const color =
    agentAccountColor(agentId, bound, {
      claude: settings.claudeAccounts,
      codex: settings.codexAccounts
    }) ?? agentColor
  // The launch-command override (this project's `.nodeterm/settings.json` first, then Settings →
  // Agents → Launch commands — see `agentLaunchOverride`) replaces the bare CLI in the assembled
  // command. Threaded into the shared assembler below as `launchCmdOverride` so fresh launch,
  // cold-restore resume and in-place restart all pick it up identically. Custom agents already own
  // their `launchCmd`, so the global layer returns undefined for them.
  const launchCmdOverride = agentLaunchOverride(agentId, projectId)
  // The session id is DECIDED here rather than learned from a hook later, so this node always has
  // something to resume with — see SESSION_ID_CAPABLE for the failure this closes. `uuid()` (not
  // crypto.randomUUID) because the Server Edition serves plain HTTP on a LAN, where randomUUID is
  // absent: that exact call already broke "Add agent" once.
  //
  // Gated on the CLI actually advertising `--session-id`, because an unknown flag does not degrade
  // — it makes claude exit, taking the launch with it. Unprobed or older CLI ⇒ no mint ⇒ the
  // command line stays byte-identical to what it has always been, and the node falls back to
  // learning its id from hooks exactly as before.
  const mintedSessionId =
    mintsSessionId(agentId) && claudeCliCapsNow().sessionIdFlag ? uuid() : undefined
  const launchPlan =
    typeof launchPlanOrPermission === 'object' ? launchPlanOrPermission : undefined
  const explicitPermissionMode =
    typeof launchPlanOrPermission === 'string' ? launchPlanOrPermission : undefined
  const permissionMode =
    explicitPermissionMode ?? permissionModeFromLaunchPlan(launchPlan, agentId)
  // No plan passed (e.g. a legacy/test call site) = bare command, exactly as before this setting.
  // Production launch sites pass the branded plan, so a raw hand-edited settings value cannot be
  // threaded around the live version/Kids gates.
  // Both flags ride the same helper so they land on the same side of an argv separator: for grok
  // that is BEFORE `--` (end-of-options), and getting it wrong makes a flag part of the prompt.
  const flagged = (cmd: string): string => {
    const withMode = permissionMode ? withPermissionMode(cmd, agentId, permissionMode) : cmd
    return mintedSessionId ? withSessionId(withMode, agentId, mintedSessionId) : withMode
  }
  // WHERE the mode flag goes is decided by the agent's prompt convention, and the two conventions
  // are opposites:
  //  - No separator (claude): the prompt is a positional that must stay adjacent to the binary, so
  //    the flag goes LAST — `claude 'fix the bug' --permission-mode auto`, byte-identical to what
  //    nodeterm has always emitted.
  //  - With a separator (grok): `--` means END OF OPTIONS, which is the whole reason it is there
  //    (`grok -- version` sends "version" to the model instead of running the subcommand). By that
  //    same convention anything AFTER it is a positional, so a flag appended last would either be
  //    swallowed into the prompt text or rejected by clap as an unexpected argument — the setting
  //    would silently do nothing, or the launch would die on a usage message. It therefore goes
  //    BEFORE the separator: `grok --permission-mode plan -- 'explain this repo'`, matching grok's
  //    own usage line `grok [OPTIONS] [PROMPT] [COMMAND]`.
  const initialCommand = usesSep ? `${flagged(baseCmd)} ${sep} ${promptArg}` : flagged(withPrompt)
  const agentLaunchIntent: AgentLaunchIntent = {
    kind: 'agent',
    action: 'start',
    agentId,
    ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(mintedSessionId ? { newSessionId: mintedSessionId } : {})
  }
  // learning its id from hooks exactly as before. Inheritance-aware: a custom agent with
  // baseAgent:'claude' mints an id too (capabilityAgentId resolves it to claude).
  const cliCaps = claudeCliCapsNow()
  const sessionIdFlagSupported = supportsSessionIdFlag(agentId, cliCaps.sessionIdFlag)
  const mintedSessionId = sessionIdFlagSupported ? uuid() : undefined
  // Command assembly is delegated to the ONE shared builder (src/shared/agents/launch.ts), used by
  // fresh launch AND cold-restore resume, so a custom agent's baseAgent/args/expansion are applied
  // identically in both paths. ${env:...} in launchCmd/args expands against the boot-time env
  // snapshot (lib/agentEnv.ts) — the SAME object the Settings preview expands against, so the
  // typed line is the previewed line. Env-var VALUES (the env map) are separate: pty-manager
  // injects them as process env main-side, never into the typed command. For a builtin with no
  // custom args this is byte-identical to the old hand-built command line.
  const customAgent = agentConfig(agentId)
    ? undefined
    : useSettings.getState().settings.customAgents.find((c) => c.id === agentId)
  const { command: initialCommand, missingEnv } = assembleLaunchCommand(
    {
      agentId,
      customAgent,
      initialPrompt,
      permissionMode,
      sessionId: mintedSessionId,
      sessionIdFlagSupported,
      // A per-builtin launch-command override (Settings → Agents → Launch commands) replaces the
      // program in the assembled line; undefined for a builtin with no override and for custom
      // agents (they own their launchCmd). Wins over the shared-identity launcher, like a custom
      // launchCmd — an explicit "launch it exactly like this".
      launchCmdOverride,
      // A SHARED_IDENTITY_CAPABLE agent (codex) launches through its managed launcher when this
      // machine actually has one — otherwise the bare CLI, byte-identical to before. `codexSharedIdentity`
      // folds in the SSH answer (a host has no launcher installed yet, so a remote node stays bare).
      sharedIdentity: codexSharedIdentity(ssh),
      // A model picked at creation (e.g. Transfer-to-agent-with-model). `withAgentModel` appends
      // `--model <value>` for a switch-capable agent and no-ops otherwise, so the line stays
      // byte-identical when no model is chosen.
      model
    },
    // The boot-time snapshot of the desktop env (empty on browser/relay by design, where the
    // missing-env warning below is the honest outcome — the same markers the preview shows).
    agentEnvSnapshot()
  )
  if (missingEnv.length) {
    // A missing var in the typed command (launchCmd/args) would launch with a blank — surface it,
    // matching the preview. Env-var VALUES (the env map) are merged main-side and warned there.
    console.warn(
      `[custom-agent] ${label}: ${missingEnv.map((m) => '${env:' + m + '}').join(', ')} unset in launch command — expanded to empty.`
    )
  }
  const size = terminalNodeSize()
  const terminalProfileId = terminalProfileForNewNode(ssh, options)
  return {
    id: nextId('term'),
    type: 'terminal',
    position: placeAt(center, index, size.width, size.height),
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title: label,
      // Adopt the agent's own session name into the title until the user renames it by hand.
      titleAuto: true,
      color,
      group: null,
      tags: [],
      agentId,
      ...(bound ? { accountId: bound } : {}),
      // Persisted alongside the node (unlike initialCommand, which is consumed on first open), so
      // a cold restore months later still knows which conversation this node owns.
      ...(mintedSessionId ? { agentSessionId: mintedSessionId } : {}),
      ...(accountId && agentId === 'codex' ? { codexAccountId: accountId } : {}),
      // Managed accounts bind to the builtin Claude and Codex agents (S6) — never to another
      // builtin, and never to a custom agent even when it inherits one of those bases. A custom
      // agent inheriting claude/codex is still its own agent; account binding stays with the
      // builtin the account picker offered it for. The Codex spawn side honours `data.accountId`
      // (resolveCodexSessionScope), the same field Claude uses.
      ...(bound ? { accountId: bound } : {}),
      // Persisted alongside the node (unlike initialCommand, which is consumed on first open), so
      // a cold restore months later still knows which conversation this node owns.
      ...(mintedSessionId ? { agentSessionId: mintedSessionId } : {}),
      // A model chosen at creation (Transfer-to-agent-with-model). Persisted so cold-restore and
      // later restarts keep it; `withAgentModel` re-applies it on relaunch. Only stamped when set.
      ...(model ? { agentModel: model } : {}),
      cwd: ssh ? ssh.remoteCwd : cwd,
      initialCommand,
      agentLaunchIntent,
      ...(terminalProfileId !== undefined ? { terminalProfileId } : {}),
      ...(ssh ? { ssh: ssh.server, sshRemoteTmux: true } : {})
    }
  }
}

/**
 * Canvas-control compatibility for older agents that invoke an exact Codex resume through
 * `open-terminal --cmd`. Promote only that narrow command to a real agent node so account metadata
 * and capability-gated shared identity are retained; every other command remains an ordinary
 * terminal command.
 */
export function createCanvasControlTerminalNode(
  index: number,
  cwd?: string,
  center?: { x: number; y: number },
  initialCommand?: string,
  ssh?: Project['ssh'],
  selectedCodexAccountId?: string,
  permissionMode?: AgentPermissionMode,
  options?: TerminalNodeCreationOptions
): CanvasNode {
  const sessionId = explicitCodexResumeSession(initialCommand)
  if (!sessionId) return createTerminalNode(index, cwd, center, initialCommand, ssh, options)

  const node = createAgentNode(
    'codex',
    index,
    cwd,
    center,
    undefined,
    ssh,
    ssh ? undefined : selectedCodexAccountId,
    permissionMode,
    options
  )
  const command = resumeCommand('codex', sessionId, {
    sharedIdentity: codexSharedIdentity(ssh),
    base: agentLaunchOverride('codex')
  })
  if (!command) return createTerminalNode(index, cwd, center, initialCommand, ssh, options)
  node.data.initialCommand = permissionMode
    ? withPermissionMode(command, 'codex', permissionMode)
    : command
  node.data.agentLaunchIntent = {
    kind: 'agent',
    action: 'resume',
    agentId: 'codex',
    sessionId,
    ...(permissionMode ? { permissionMode } : {})
  }
  node.data.agentSessionId = sessionId
  return node
}

/**
 * Chip text for an account-bound node header. Given a node's `accountId` and the known
 * accounts, returns the short chip label (the part of the account label before `@`, capped
 * at ~10 chars with an ellipsis) plus a tooltip (`label (email)`, or just the label when no
 * email). Returns `null` when there's no `accountId` (render no chip). An `accountId` that no
 * longer resolves to a known account (removed) yields `Unknown account` for both.
 */
export function accountChipLabel(
  accountId: string | undefined,
  accounts: ClaudeAccount[]
): { short: string; tooltip: string } | null {
  if (!accountId) return null
  const acct = accounts.find((a) => a.id === accountId)
  if (!acct) return { short: 'Unknown account', tooltip: 'Unknown account' }
  const base = acct.label.split('@')[0]
  const short = base.length > 10 ? `${base.slice(0, 10)}…` : base
  const tooltip = acct.email ? `${acct.label} (${acct.email})` : acct.label
  return { short, tooltip }
}

/**
 * Display name for the SYSTEM (default `~/.claude`) account in pickers, settings, and the
 * usage popover: the user's custom label (settings.systemAccountLabel) wins, else the
 * detected login email, else the generic "System account". Keeps the system entry
 * distinguishable once managed accounts exist.
 */
export function systemAccountDisplay(label: string | undefined, email?: string | null): string {
  return (label ?? '').trim() || email || 'Default account'
}

/**
 * Terminal node used to log a new managed account in: the session runs under the account's
 * CLAUDE_CONFIG_DIR (Task-3 env injection keyed off `data.accountId`), so `claude /login`
 * writes credentials + `.claude.json` into the account dir, where the main process captures
 * the email. A plain terminal (not an agent node) so no session-name tracking kicks in.
 *
 * In an SSH project, pass the project's `ssh` binding: the node then runs in REMOTE tmux (Task 12),
 * so `CLAUDE_CONFIG_DIR` resolves to the account dir ON THE HOST and `claude /login` writes the
 * remote `.claude.json` (the main process polls it over ssh). For a local account, omit `ssh`.
 */
export function createAccountLoginNode(
  accountId: string,
  index: number,
  center?: { x: number; y: number },
  ssh?: Project['ssh'],
  options?: TerminalNodeCreationOptions
): CanvasNode {
  const node = createTerminalNode(index, undefined, center, undefined, ssh, options)
  node.data = {
    ...node.data,
    title: 'Claude login',
    accountId,
    accountLogin: true,
    initialCommand: 'claude /login'
  }
  return node
}

/**
 * Terminal node used to log a new managed CODEX account in — the sibling of
 * `createAccountLoginNode`. The session runs under that account's `CODEX_HOME` (S6 §2.1 env
 * injection, gated by `needsCodexAccountScope` asking whether the id is a managed Codex one), so
 * `codex login` writes `auth.json` into the managed home rather than the user's system `~/.codex`.
 * That file is exactly what `codexAccounts.waitLogin` polls for, so without this node the add flow
 * waits on a credential nothing is writing (issue #346).
 *
 * A plain terminal (not an agent node), like the Claude one: no session-name tracking, and the
 * agent-less shape is what keeps the node out of the Codex AGENT paths while still being scoped.
 * Local only — `codexAccounts.add()` mints on THIS machine, so there is no ssh binding to pass.
 */
export function createCodexAccountLoginNode(
  accountId: string,
  index: number,
  center?: { x: number; y: number }
): CanvasNode {
  const node = createTerminalNode(index, undefined, center)
  node.data = {
    ...node.data,
    title: 'Codex login',
    accountId,
    initialCommand: 'codex login'
  }
  return node
}

/**
 * Terminal node that SWITCHES the system (~/.claude) Claude identity — the usage popover's
 * "Switch account" action (issue #420). Runs `claude /login` with NO `accountId`, so the spawn
 * env is bit-for-bit the plain-terminal one and the OAuth writes the system `~/.claude` —
 * which is the point: every system-scope session follows the new org, exactly as a hand-typed
 * `claude /login` would make them. Deliberately a SEPARATE factory from
 * `createAccountLoginNode`: that one REQUIRES an accountId because config-dir scoping is its
 * purpose, and its 'Claude login' title is the durable signature `isAccountLoginNode` keys on
 * to destroy login nodes together with their removed account — a sweep this node must never be
 * caught by (both destroy paths also gate on accountId equality, and this node has none).
 *
 * The docblock hazard on `isAccountLoginNode` — a respawned `claude /login` overwriting the
 * system identity — is only a hazard when it happens UNASKED. Here the overwrite is the feature,
 * and "once" is structural rather than promised: `initialCommand` is consumed on first mount and
 * never serialized (`flowToNodeStates` drops it), so after an app restart or a machine reboot
 * this node is an inert plain terminal, not a login prompt nobody requested.
 *
 * Local only, on purpose: on an SSH project a system login would rewrite THAT host's ~/.claude,
 * so the popover does not offer the action there (see UsageIndicator).
 */
export function createSystemLoginNode(index: number, center?: { x: number; y: number }): CanvasNode {
  const node = createTerminalNode(index, undefined, center)
  node.data = {
    ...node.data,
    title: 'Switch Claude account',
    initialCommand: 'claude /login'
  }
  return node
}

/**
 * True when node data is (or started as) an account-login terminal (`claude /login`).
 * New nodes carry a durable marker. The title/command check is retained only to migrate legacy
 * workspaces that predate it. Used to DESTROY the login node together with its removed account:
 * left alive, a cold restart would respawn it under the system env, where completing OAuth can
 * overwrite the user's ~/.claude identity.
 */
export function isAccountLoginNode(data: {
  accountLogin?: boolean
  title?: string
  initialCommand?: string
}): boolean {
  if (data.accountLogin !== undefined) return data.accountLogin
  return data.title === 'Claude login' || (data.initialCommand ?? '').startsWith('claude /login')
}

export function createCodexAccountLoginNode(
  accountId: string,
  index: number,
  center?: { x: number; y: number },
  ssh?: Parameters<typeof createTerminalNode>[4]
): CanvasNode {
  const node = createTerminalNode(index, undefined, center, undefined, ssh)
  node.data = {
    ...node.data,
    title: 'Codex login',
    codexAccountId: accountId,
    // Account login has no relationship to the active project. In particular, keeping the
    // project's cwd here makes macOS evaluate Documents/Desktop TCC before Codex can even show
    // its device-flow URL. A denied project directory then looks like a broken account home.
    // So this must start in the user's neutral home; the selected CODEX_HOME still comes from the
    // node's codexAccountId and remains fully isolated either way.
    //
    // HOW it gets there is split, because `&&` is not a statement separator in Windows PowerShell
    // 5.1 — the stock shell on a machine without pwsh 7. The chained form parsed as far as `&&`
    // and died with "The token '&&' is not a valid statement separator in this version", so the
    // login never ran and the node just showed a red parser error. Locally there is nothing to
    // chain: this factory passes NO cwd, and core resolves an unset cwd to os.homedir() already
    // (pty-manager), so the bare command starts in home on every platform. Only the SSH leg needs
    // the `cd`, because there data.cwd is the project's remoteCwd — and that leg is always a POSIX
    // remote shell, where `&&` is fine. Do not "unify" these back into one line: there is no
    // separator that means and-then in POSIX sh, PowerShell 5.1 and cmd alike.
    initialCommand: ssh
      ? `cd \"$HOME\" && codex -c cli_auth_credentials_store=\"file\" login --device-auth`
      : `codex -c cli_auth_credentials_store=\"file\" login --device-auth`
  }
  return node
}

export function isCodexAccountLoginNode(data: {
  title?: string
  initialCommand?: string
}): boolean {
  return data.title === 'Codex login' || (data.initialCommand ?? '').includes('login --device-auth')
}

/**
 * Creates a code editor node for a file. When `sshFs` is true, `data.sshFs` is stamped so EditorNode
 * reads/writes over the project's remote fs (`sshFs`) and `filePath` is the remote path — mirroring
 * how `createTerminalNode` stamps `data.sshRemoteTmux`. The SSH-ness is passed EXPLICITLY by the
 * caller (only genuinely-remote, Explorer-opened files pass `true`); native-dialog-opened files
 * carry LOCAL paths and must stay local, so they omit it. (Self-detecting the active SSH project
 * here would wrongly stamp a dialog-opened local path and route its ⌘S write to the remote host.)
 */
export function createEditorNode(
  index: number,
  filePath: string,
  center?: { x: number; y: number },
  sshFs?: boolean
): CanvasNode {
  return {
    id: nextId('editor'),
    type: 'editor',
    position: placeAt(center, index, EDITOR_SIZE.width, EDITOR_SIZE.height),
    width: EDITOR_SIZE.width,
    height: EDITOR_SIZE.height,
    style: { width: EDITOR_SIZE.width, height: EDITOR_SIZE.height },
    data: {
      title: filePath.split('/').pop() || 'untitled',
      color: '#6ac4dc',
      group: null,
      filePath,
      ...(sshFs ? { sshFs: true } : {})
    }
  }
}

const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi']

/** True when a path looks like a playable video file (by extension). */
export function isVideoFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXTS.includes(ext)
}

/** Creates a video player node for a video file (streamed via nt-media://). When `sshFs` is true,
 *  `data.sshFs` is stamped so VideoNode fetches the file from the SSH project's host into the
 *  local media cache (media.allowSsh) instead of allowlisting a local path — mirroring
 *  createEditorNode's remote-fs flag. */
export function createVideoNode(
  index: number,
  filePath: string,
  center?: { x: number; y: number },
  sshFs?: boolean
): CanvasNode {
  return {
    id: nextId('video'),
    type: 'video',
    position: placeAt(center, index, VIDEO_SIZE.width, VIDEO_SIZE.height),
    width: VIDEO_SIZE.width,
    height: VIDEO_SIZE.height,
    style: { width: VIDEO_SIZE.width, height: VIDEO_SIZE.height },
    data: {
      title: filePath.split('/').pop() || 'video',
      color: '#bf5af2',
      group: null,
      filePath,
      ...(sshFs ? { sshFs: true } : {})
    }
  }
}

export function createPhotoNode(index: number, filePath: string, center?: { x: number; y: number }, sshFs?: boolean): CanvasNode {
  return {
    id: nextId('photo'), type: 'photo', position: placeAt(center, index, PHOTO_SIZE.width, PHOTO_SIZE.height),
    width: PHOTO_SIZE.width, height: PHOTO_SIZE.height, style: { width: PHOTO_SIZE.width, height: PHOTO_SIZE.height },
    data: { title: filePath.split(/[\\/]/).pop() || 'photo', color: '#4db6ac', group: null, filePath, ...(sshFs ? { sshFs: true } : {}) }
  }
}

export function createGalleryNode(index: number, assets: MediaAssetReference[] = [], center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('gallery'), type: 'gallery', position: placeAt(center, index, GALLERY_SIZE.width, GALLERY_SIZE.height),
    width: GALLERY_SIZE.width, height: GALLERY_SIZE.height, style: { width: GALLERY_SIZE.width, height: GALLERY_SIZE.height },
    data: { title: 'Gallery', color: '#ff9f0a', group: null, mediaAssets: assets, mediaActiveAssetId: assets[0]?.assetId }
  }
}

export function createWildDimSumNode(index: number, selection?: PublicDimSumSelection, center?: { x: number; y: number }): CanvasNode {
  const dish = normalizePublicDimSumSelection(selection)
  return {
    id: nextId('wild-dim-sum'), type: 'wild-dim-sum', position: placeAt(center, index, WILD_DIM_SUM_SIZE.width, WILD_DIM_SUM_SIZE.height),
    width: WILD_DIM_SUM_SIZE.width, height: WILD_DIM_SUM_SIZE.height, style: { width: WILD_DIM_SUM_SIZE.width, height: WILD_DIM_SUM_SIZE.height },
    data: { title: dish ? `Wild dim sum · ${dish.name.en}` : 'Wild dim sum', color: '#f59e0b', group: null, ...(dish ? { wildDimSumDish: dish } : {}) }
  }
}

/** Creates a web (webview) node showing a live URL or a local html file. */
export function createWebNode(
  index: number,
  src: { url?: string; filePath?: string },
  center?: { x: number; y: number }
): CanvasNode {
  const title = src.url
    ? src.url.replace(/^https?:\/\//, '').slice(0, 40)
    : src.filePath?.split('/').pop() || 'web'
  return {
    id: nextId('web'),
    type: 'web',
    position: placeAt(center, index, WEB_SIZE.width, WEB_SIZE.height),
    width: WEB_SIZE.width,
    height: WEB_SIZE.height,
    style: { width: WEB_SIZE.width, height: WEB_SIZE.height },
    data: {
      title,
      color: '#6ac4dc',
      group: null,
      ...(src.url ? { url: src.url } : {}),
      ...(src.filePath ? { filePath: src.filePath } : {})
    }
  }
}

/**
 * Creates a navigable browser node (Electron <webview>) starting at `url` ('' = blank).
 *
 * `partition` is set ONLY for an AGENT-opened node (`open-browser`), to its per-project session jar
 * (`agentBrowserPartition`). A USER-opened node passes none and keeps the default session, unchanged
 * — the zero-migration path, so nobody loses a login on upgrade. It is written once here and never
 * mutated: [MEASURED, Electron 42.8.1] `<webview partition>` is honoured only at attach, so a later
 * change would be a silent no-op anyway (docs/superpowers/probes/2026-08-browser-partition.md).
 */
export function createBrowserNode(
  index: number,
  url: string,
  center?: { x: number; y: number },
  ownerNodeId?: string,
  profileId?: string,
  /** A popup (`target=_blank` / `window.open`) opens as a TEMPORARY canvas node: real, live and
   *  interactive, but never written to project.json — closing it leaves nothing behind, which is
   *  what a popup is. The node's own "Keep" action clears this flag and promotes it into an
   *  ordinary persisted node. See `flowToNodeStates`, which is where the promise is actually
   *  kept. */
  temporary?: boolean
  partition?: string
): CanvasNode {
  const title = url ? url.replace(/^https?:\/\//, '').slice(0, 40) : 'Browser'
  return {
    id: nextId('browser'),
    type: 'browser',
    position: placeAt(center, index, BROWSER_SIZE.width, BROWSER_SIZE.height),
    width: BROWSER_SIZE.width,
    height: BROWSER_SIZE.height,
    style: { width: BROWSER_SIZE.width, height: BROWSER_SIZE.height },
    data: {
      title,
      color: '#0a84ff',
      group: null,
      ...(url ? { url } : {}),
      ...(ownerNodeId ? { browserOwnerNodeId: ownerNodeId } : {}),
      ...(profileId ? { browserProfileId: profileId } : {}),
      ...(temporary ? { temporary: true } : {}),
      ...(partition ? { partition } : {})
    }
  }
}

/** Creates a browser-kind canvas node with a portable kiosk/PWA intent. Runtime profile state is
 * deliberately not part of the project record and is created by KioskPwaNode on this host. */
export function createKioskPwaNode(
  index: number,
  intent: PortableKioskPwaIntent,
  center?: { x: number; y: number }
): CanvasNode {
  return {
    id: nextId('kiosk-pwa'),
    type: 'browser',
    position: placeAt(center, index, BROWSER_SIZE.width, BROWSER_SIZE.height),
    width: BROWSER_SIZE.width,
    height: BROWSER_SIZE.height,
    style: { width: BROWSER_SIZE.width, height: BROWSER_SIZE.height },
    data: {
      title: intent.displayName,
      color: '#6ac4dc',
      group: null,
      kioskPwaIntent: intent,
      url: intent.target.kind === 'url' ? intent.target.url : intent.target.startUrl
    }
  }
}

/** Creates a diff editor node for a changed file (relative path + repo cwd). */
export function createDiffNode(
  index: number,
  cwd: string,
  relPath: string,
  staged: boolean,
  center?: { x: number; y: number },
  commitOid?: string
): CanvasNode {
  return {
    id: nextId('diff'),
    type: 'diff',
    position: placeAt(center, index, DIFF_SIZE.width, DIFF_SIZE.height),
    width: DIFF_SIZE.width,
    height: DIFF_SIZE.height,
    style: { width: DIFF_SIZE.width, height: DIFF_SIZE.height },
    data: {
      title: `${relPath.split('/').pop() || relPath} (${commitOid ? commitOid.slice(0, 7) : 'diff'})`,
      color: '#e0af68',
      group: null,
      cwd,
      filePath: relPath,
      diffStaged: staged,
      commitOid
    }
  }
}

/** Creates a new sticky note. */
const AUTHENTICATOR_SIZE = { width: 340, height: 260 }
const CALENDAR_SIZE = { width: 620, height: 520 }
const HOME_ASSISTANT_CONTROL_SIZE = { width: 620, height: 620 }
const HOME_ASSISTANT_SENSOR_SIZE = { width: 660, height: 560 }
const NSIS_SIZE = { width: 460, height: 520 }

/**
 * A view of this machine's own TOTP generators, on the canvas.
 *
 * Carries a title and a colour and nothing else. Which entries exist is read live from this
 * machine's credential store every time the node renders, never persisted here - see
 * AuthenticatorNode.tsx for why a list of entry ids must not travel in a git-shared project file.
 */
export function createAuthenticatorNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('authenticator'),
    type: 'authenticator',
    position: placeAt(center, index, AUTHENTICATOR_SIZE.width, AUTHENTICATOR_SIZE.height),
    width: AUTHENTICATOR_SIZE.width,
    height: AUTHENTICATOR_SIZE.height,
    style: { width: AUTHENTICATOR_SIZE.width, height: AUTHENTICATOR_SIZE.height },
    data: {
      title: 'Authenticator',
      color: NODE_COLORS[4] ?? NODE_COLORS[0],
      group: null
    }
  }
}

/** Creates the permanent catalog surface for a special-universe child canvas. */
export function createShopNode(
  canvasId: string,
  scope: 'multiverse' | 'aws-universe',
  index = 0,
  center?: { x: number; y: number },
  options: { existingNodeIds?: readonly string[]; creationEventId?: string; universeDepth?: number } = {}
): CanvasNode {
  if (typeof options.universeDepth !== 'number' || !Number.isInteger(options.universeDepth) || options.universeDepth < 1 || (scope === 'multiverse' && options.universeDepth > 8)) {
    throw new Error('A Shop needs a valid persisted universe depth.')
  }
  const id = shopNodeIdForCanvas(canvasId, options.existingNodeIds ?? [])
  return {
    id,
    type: 'shop',
    position: placeAt(center, index, SHOP_SIZE.width, SHOP_SIZE.height),
    width: SHOP_SIZE.width,
    height: SHOP_SIZE.height,
    style: { width: SHOP_SIZE.width, height: SHOP_SIZE.height },
    draggable: false,
    selectable: true,
    data: {
      title: 'Shop',
      color: '#6750a4',
      group: null,
      universeCanvasId: canvasId,
      universeScope: scope,
      universeDepth: options.universeDepth,
      nonDeletable: true,
      tags: ['universe-shop', scope],
      creationEventId: options.creationEventId ?? newUniverseCreationEventId()
/** Creates a torrent downloader node. Magnet intent is safe project content; task state, source
 * file paths, destinations and runtime handles remain on the owning machine. */
export function createTorrentNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('torrent'),
    type: 'torrent',
    position: placeAt(center, index, TORRENT_SIZE.width, TORRENT_SIZE.height),
    width: TORRENT_SIZE.width,
    height: TORRENT_SIZE.height,
    style: { width: TORRENT_SIZE.width, height: TORRENT_SIZE.height },
    data: {
      title: TORRENT_NODE_CATALOG_ENTRY.label,
      color: NODE_COLORS[(index + 2) % NODE_COLORS.length],
      group: null,
      torrentMagnet: ''
/** Creates a calendar node with a safe local source as the guided starting point. */
export function createCalendarNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('calendar'),
    type: 'calendar',
    position: placeAt(center, index, CALENDAR_SIZE.width, CALENDAR_SIZE.height),
    width: CALENDAR_SIZE.width,
    height: CALENDAR_SIZE.height,
    style: { width: CALENDAR_SIZE.width, height: CALENDAR_SIZE.height },
    data: {
      title: 'Calendar',
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      calendarConfig: { provider: 'local', accountId: null, calendarId: null, timezone: 'local', view: 'agenda', showWeekends: true, cacheEnabled: true }
    }
  }
export function createTimerNode(index: number, center?: { x: number; y: number }): CanvasNode {
  const data: TimerNodeData = {
    title: 'Timer', color: NODE_COLORS[index % NODE_COLORS.length], group: null,
    timerMode: 'countdown', durationMs: TIMER_DEFAULT_DURATION_MS, remainingMs: TIMER_DEFAULT_DURATION_MS,
    elapsedMs: 0, running: false, paused: false, repeatCount: 0, repeatRemaining: 0,
    sequence: [], sequenceIndex: 0, lapsMs: [], occurrenceState: 'scheduled', alarmEnabled: true,
    alarmTone: 'chime', missedCount: 0
  }
  return { id: nextId('timer'), type: 'timer', position: placeAt(center, index, TIMER_SIZE.width, TIMER_SIZE.height), width: TIMER_SIZE.width, height: TIMER_SIZE.height, style: { width: TIMER_SIZE.width, height: TIMER_SIZE.height }, data }
}

/** Creates one guided AWS manager node; local profiles and provider state remain in core. */
export function createAwsResourceNode(index: number, mode: AwsManagerMode = 'resource-explorer', center?: { x: number; y: number }, coreService?: import('@shared/aws-resource').AwsCoreServiceId, platformService?: import('@shared/aws-resource').AwsPlatformServiceId): CanvasNode {
  return {
    id: nextId('aws-resource'),
    type: 'aws-resource',
    position: placeAt(center, index, AWS_RESOURCE_SIZE.width, AWS_RESOURCE_SIZE.height),
    width: AWS_RESOURCE_SIZE.width,
    height: AWS_RESOURCE_SIZE.height,
    style: { width: AWS_RESOURCE_SIZE.width, height: AWS_RESOURCE_SIZE.height },
    data: {
      title: mode === 'cloud-control' ? 'AWS Cloud Control' : mode === 'core-services' ? `${coreService?.toUpperCase() ?? 'AWS'} manager` : mode === 'cloudformation' ? 'AWS CloudFormation' : mode === 'cdk' ? 'AWS CDK' : mode === 'platform-managers' ? `${platformService?.toUpperCase() ?? 'AWS'} manager` : 'AWS Resource Explorer',
      color: '#ff9900',
      group: null,
      awsManagerIntent: { ...AWS_MANAGER_DEFAULT_INTENT, mode, ...(coreService ? { coreService, coreOperation: import('@shared/aws-resource').AWS_CORE_OPERATIONS[coreService][0] } : {}), ...(platformService ? { platformService, platformOperation: import('@shared/aws-resource').AWS_PLATFORM_OPERATIONS.find((item) => item.startsWith(`${platformService}-`)) } : {}) }
    }
  }
}

/** Creates a root portal card for one AWS-only child canvas. */
export function createAwsUniversePortalNode(index: number, canvasId: string, title: string, center?: { x: number; y: number }): CanvasNode {
  const size = NODE_START_SIZE['aws-universe']
  return {
    id: nextId('aws-universe'),
    type: 'aws-universe',
    position: placeAt(center, index, size.width, size.height),
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title,
      color: '#7d5260',
      group: null,
      universeCanvasId: canvasId,
      universeScope: 'aws-universe',
      universeDepth: 1,
      tags: ['aws-universe', 'universe-portal']
    }
  }
}

/** Creates an unbound Home Assistant control. Import and creation perform no network request. */
export function createHomeAssistantControlNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('homeassistant-control'),
    type: 'homeassistant-control',
    position: placeAt(center, index, HOME_ASSISTANT_CONTROL_SIZE.width, HOME_ASSISTANT_CONTROL_SIZE.height),
    width: HOME_ASSISTANT_CONTROL_SIZE.width,
    height: HOME_ASSISTANT_CONTROL_SIZE.height,
    style: { width: HOME_ASSISTANT_CONTROL_SIZE.width, height: HOME_ASSISTANT_CONTROL_SIZE.height },
    data: {
      title: 'Home Assistant control',
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      homeAssistantControlConfig: { ...DEFAULT_HOME_ASSISTANT_CONTROL_CONFIG }
    }
  }
}

export function createStickyNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('sticky'),
    type: 'sticky',
    position: placeAt(center, index, STICKY_SIZE.width, STICKY_SIZE.height),
    width: STICKY_SIZE.width,
    height: STICKY_SIZE.height,
    style: { width: STICKY_SIZE.width, height: STICKY_SIZE.height },
    data: {
      title: 'Note',
      color: '#ffd60a',
      group: null,
      text: ''
    }
  }
}

/** Creates an unbound Home Assistant sensor display. Importing it performs no network action. */
export function createHomeAssistantSensorNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('homeassistant-sensor'),
    type: 'homeassistant-sensor',
    position: placeAt(center, index, HOME_ASSISTANT_SENSOR_SIZE.width, HOME_ASSISTANT_SENSOR_SIZE.height),
    width: HOME_ASSISTANT_SENSOR_SIZE.width,
    height: HOME_ASSISTANT_SENSOR_SIZE.height,
    style: { width: HOME_ASSISTANT_SENSOR_SIZE.width, height: HOME_ASSISTANT_SENSOR_SIZE.height },
    data: {
      title: 'Home Assistant sensors',
      color: NODE_COLORS[(index + 4) % NODE_COLORS.length],
      group: null,
      homeAssistantSensorConfig: { ...DEFAULT_HOME_ASSISTANT_SENSOR_CONFIG, entities: [] }
    }
  }
}

/**
 * Human-readable name and default title per service kind. One table, so the menu row, the node
 * header and any future palette entry cannot disagree about what a kind is called.
 */
export const SERVICE_NODE_LABELS: Record<ServiceNodeKind, string> = {
  minecraft: 'Minecraft server',
  dockerhost: 'Docker host',
  proxmox: 'Proxmox',
  gitlab: 'GitLab',
  homeassistant: 'Home Assistant',
  freepbx: 'FreePBX',
  'cloudflare-tunnel': 'Cloudflare Tunnel',
  awsidentity: 'AWS identity',
  'cloudflare-zero-trust': 'Cloudflare managers',
  'nextcloud-aio': 'Nextcloud AIO',
  'nextcloud-managed': 'Managed Nextcloud'
}

/**
 * Creates a service-manager node.
 *
 * ONE factory with six callers rather than six near-identical factories, because the only thing that
 * varies is the kind, its starting size and its default title — and this codebase's most repeated
 * lesson is that a duplicated rule drifts from its copies.
 *
 * The id prefix is the kind's own name and is deliberately NOT `term-`. That is not tidiness:
 * `SAFE_NODE_ID` in `core/project-node-append.ts` is `/^term-…/`, and it is how the relay and the
 * mobile-companion append path decide an incoming id may register as a real terminal session. A
 * service node borrowing that prefix would let a peer be persuaded to treat a manager as a shell.
 *
 * Nothing identifying is seeded into `data`. See `serviceLabel` on `CanvasNodeState` for why a host
 * must not live there.
 */
export function createServiceNode(
  kind: ServiceNodeKind,
  index: number,
  center?: { x: number; y: number }
): CanvasNode {
  const size = NODE_START_SIZE[kind]
  return {
    id: nextId(kind),
    type: kind,
    position: placeAt(center, index, size.width, size.height),
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title: SERVICE_NODE_LABELS[kind],
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      serviceLabel: '',
      ...(kind === 'awsidentity'
        ? {
            awsIdentityIntent: {
              schemaVersion: 1 as const,
              mode: 'profile' as const,
              preferredRegion: null,
              requireMfa: false,
              requireRole: false,
              endpointServices: []
            }
          }
        : {}),
      ...(kind === 'homeassistant' ? { homeAssistantIntent: { ...DEFAULT_HOME_ASSISTANT_NODE_INTENT } } : {}),
      ...(kind === 'cloudflare-zero-trust' ? { cloudflareZeroTrustIntent: { schemaVersion: 1, manager: null, operation: null, accountHint: null, resourceHint: null, values: {} } } : {}),
      ...(kind === 'nextcloud-aio' ? { nextcloudAioConfig: { ...NEXTCLOUD_AIO_DEFAULT_CONFIG } } : {}),
      ...(kind === 'nextcloud-managed' ? { nextcloudManagedIntent: { ...DEFAULT_NEXTCLOUD_MANAGED_INTENT } } : {})
    }
  }
}

/** Creates a safe, unconfigured GitHub issue or pull-request work-item node. */
export function createGitHubWorkItemNode(index: number, center?: { x: number; y: number }): CanvasNode {
  const size = GITHUB_WORK_ITEM_NODE_SIZE
  return { id: nextId('github-work-item'), type: 'github-work-item', position: placeAt(center, index, size.width, size.height), width: size.width, height: size.height, style: { width: size.width, height: size.height }, data: { title: 'GitHub work item', color: NODE_COLORS[(index + 2) % NODE_COLORS.length], group: null, githubWorkItem: { schemaVersion: 1, kind: 'issue', repository: '', number: 1, title: '', bodyMarkdown: '', state: 'unknown', author: null, labels: [], htmlUrl: '', sessionIds: [], refreshState: 'never' } } }
}

/** Creates a portable GitLab hosting blueprint. Deployment, context, volumes, and credentials
 * remain machine-local until the user chooses a guided operation on the node. */
export function createGitLabHostingNode(index: number, center?: { x: number; y: number }): CanvasNode {
  const size = { width: 700, height: 620 }
  return {
    id: nextId('gitlab-hosting'),
    type: 'gitlab-hosting',
    position: placeAt(center, index, size.width, size.height),
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title: 'GitLab hosting',
      color: NODE_COLORS[(index + 1) % NODE_COLORS.length],
      group: null,
      gitlabHostingConfig: { ...DEFAULT_GITLAB_HOSTING_CONFIG }
    }
  }
}

/** Creates an unbound Cloudflare manager. Only typed safe operation intent is portable. */
export function createCloudflareCoreManagersNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('cloudflare-core-managers'),
    type: 'cloudflare-core-managers',
    position: placeAt(center, index, CLOUDFLARE_CORE_MANAGERS_SIZE.width, CLOUDFLARE_CORE_MANAGERS_SIZE.height),
    width: CLOUDFLARE_CORE_MANAGERS_SIZE.width,
    height: CLOUDFLARE_CORE_MANAGERS_SIZE.height,
    style: { width: CLOUDFLARE_CORE_MANAGERS_SIZE.width, height: CLOUDFLARE_CORE_MANAGERS_SIZE.height },
    data: {
      title: 'Cloudflare managers',
      color: '#f38020',
      group: null,
      cloudflareCoreIntent: { ...CLOUDFLARE_DEFAULT_INTENT, input: {} },
      tags: ['cloudflare', 'account', 'zone', 'dns', 'ssl-tls', 'ruleset', 'redirect', 'cache', 'analytics']
    }
  }
}

/** Creates a guided Open WebUI hosting node. Only safe provider intent enters the project file. */
export function createOpenWebUiNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('open-webui-hosting'),
    type: 'open-webui-hosting',
    position: placeAt(center, index, OPEN_WEBUI_SIZE.width, OPEN_WEBUI_SIZE.height),
    width: OPEN_WEBUI_SIZE.width,
    height: OPEN_WEBUI_SIZE.height,
    style: { width: OPEN_WEBUI_SIZE.width, height: OPEN_WEBUI_SIZE.height },
    data: {
      title: 'Open WebUI hosting',
      color: '#6ac4dc',
      group: null,
      openWebUiIntent: { ...OPEN_WEBUI_DEFAULT_INTENT }
    }
  }
}

/** Creates a Linux ISO VM node. The node is a canvas object, not a WSL terminal profile. */
export function createVirtualMachineNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('linux-vm'),
    type: 'linux-vm',
    position: placeAt(center, index, LINUX_VM_SIZE.width, LINUX_VM_SIZE.height),
    width: LINUX_VM_SIZE.width,
    height: LINUX_VM_SIZE.height,
    style: { width: LINUX_VM_SIZE.width, height: LINUX_VM_SIZE.height },
    data: {
      title: 'Linux ISO VM',
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      virtualMachineConfig: { ...DEFAULT_VIRTUAL_MACHINE_CONFIG },
      virtualMachineLocalPaths: {}
    }
  }
}

/** Creates a read-only host diagnostics node. Host state is queried live and never persisted. */
export function createWindowsDiagnosticsNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('windows-diagnostics'),
    type: 'windows-diagnostics',
    position: placeAt(center, index, WINDOWS_DIAGNOSTICS_SIZE.width, WINDOWS_DIAGNOSTICS_SIZE.height),
    width: WINDOWS_DIAGNOSTICS_SIZE.width,
    height: WINDOWS_DIAGNOSTICS_SIZE.height,
    style: { width: WINDOWS_DIAGNOSTICS_SIZE.width, height: WINDOWS_DIAGNOSTICS_SIZE.height },
    data: {
      title: 'Windows diagnostics',
      color: NODE_COLORS[0],
      group: null
    }
  }
}

/**
 * Creates an NSIS installer-builder node — a GUI for authoring a Windows NSIS installer script for
 * ANOTHER project. Not this app's own installer, which stays Squirrel.Windows (see CLAUDE.md's
 * Packaging section) — this is a tool the user reaches for, exactly like the authenticator or a
 * service manager is a tool on the canvas rather than a modal.
 *
 * `nsisSpec` seeds with real, useful defaults (a real install root, real shortcut/uninstaller
 * choices) rather than an empty form the user must fully configure before anything renders — the
 * guided-forms rule that a picker should suggest a sane default rather than start blank.
 * `nsisLocalPaths` starts empty: there is no safe default for "which files on THIS machine".
 */
export function createNsisNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('nsis'),
    type: 'nsis',
    position: placeAt(center, index, NSIS_SIZE.width, NSIS_SIZE.height),
    width: NSIS_SIZE.width,
    height: NSIS_SIZE.height,
    style: { width: NSIS_SIZE.width, height: NSIS_SIZE.height },
    data: {
      title: 'Installer builder',
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      nsisSpec: defaultNsisSpec(),
      nsisLocalPaths: defaultNsisLocalPaths()
    }
  }
}

/** Creates a user-owned Loop scheduler. It has no PTY; outgoing schedule handles target agents. */
export function createNativeLoopNode(index: number, center?: { x: number; y: number }): CanvasNode {
  return {
    id: nextId('scheduler'),
    type: 'scheduler',
    position: placeAt(center, index, NATIVE_LOOP_SIZE.width, NATIVE_LOOP_SIZE.height),
    width: NATIVE_LOOP_SIZE.width,
    height: NATIVE_LOOP_SIZE.height,
    style: { width: NATIVE_LOOP_SIZE.width, height: NATIVE_LOOP_SIZE.height },
    data: {
      title: 'Loop',
      color: '#ffb340',
      group: null,
      loopTask: '',
      loopIntervalMs: 15 * 60_000,
      loopEnabled: false,
      loopTargetIds: []
    }
  }
}

/** Creates a durable Alarm Clock node. Recurring values are wall-clock intent, never fixed offsets. */
export function createAlarmClockNode(index: number, center?: { x: number; y: number }): CanvasNode {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return {
    id: nextId('alarm'),
    type: 'alarm',
    position: placeAt(center, index, ALARM_SIZE.width, ALARM_SIZE.height),
    width: ALARM_SIZE.width,
    height: ALARM_SIZE.height,
    style: { width: ALARM_SIZE.width, height: ALARM_SIZE.height },
    data: {
      title: 'Alarm Clock',
      color: '#ef9a9a',
      group: null,
      alarmSchedule: { recurrence: 'once', date, time: '09:00' },
      alarmTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      alarmEnabled: false,
      alarmSnoozeMinutes: 10,
      alarmSoundEnabled: true,
      alarmNarratorEnabled: true,
      alarmHistory: []
    }
  }
}

/** Creates a new dino (T-Rex Runner) game node, seeded with the project's record. */
export function createDinoNode(
  index: number,
  center?: { x: number; y: number },
  highScore = 0
): CanvasNode {
  return {
    id: nextId('dino'),
    type: 'dino',
    position: placeAt(center, index, DINO_SIZE.width, DINO_SIZE.height),
    width: DINO_SIZE.width,
    height: DINO_SIZE.height,
    style: { width: DINO_SIZE.width, height: DINO_SIZE.height },
    data: {
      title: 'Dino',
      color: '#a2a2a2',
      group: null,
      highScore
    }
  }
}

/** Creates the deterministic three-key recovery game without launching any external operation. */
export function createRecoveryGameNode(
  index: number,
  center?: { x: number; y: number },
  recoveryGame: RecoveryGameSnapshot = createRecoveryGameSnapshot()
): CanvasNode {
  return {
    id: nextId('recovery-game'),
    type: 'recovery-game',
    position: placeAt(center, index, RECOVERY_GAME_SIZE.width, RECOVERY_GAME_SIZE.height),
    width: RECOVERY_GAME_SIZE.width,
    height: RECOVERY_GAME_SIZE.height,
    style: { width: RECOVERY_GAME_SIZE.width, height: RECOVERY_GAME_SIZE.height },
    data: {
      title: 'Recovery game',
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      recoveryGame
    }
  }
}

/** Creates a group frame node at a given position/size (children get parentId = its id). */
export function createGroupNode(
  position: { x: number; y: number },
  size: { width: number; height: number } = GROUP_SIZE,
  index = 0
): CanvasNode {
  return {
    id: nextId('group'),
    type: 'group',
    // A frame is a background container, not a giant drag target: only its label pill drags it,
    // so a click on the body reaches the pane (pan / rubber-band) and a NESTED frame's body is
    // not stolen by its ancestor. Mirrored in `nodeStatesToFlow` for persisted frames.
    dragHandle: '.group-node__label',
    position,
    width: size.width,
    height: size.height,
    style: { width: size.width, height: size.height },
    data: {
      title: `Group ${index + 1}`,
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null
    }
  }
}

/**
 * Creates a standalone line/arrow annotation — pure decoration with no relationship to any other
 * node (issue #145). This is deliberately NOT an edge: unlike a bridge (context link), a rope
 * (spawn lineage) or a canvas-control dependency edge, it is rendered as an ordinary node
 * (AnnotationNode.tsx) and never carries a `source`/`target` referencing another node, has no
 * connect handles, and cannot be drawn between two nodes — the structural fact that keeps it
 * impossible to mistake for a link that changes what an agent can read.
 *
 * `rect` is normally the geometry a drag produced (`annotationRectFromPoints`); a caller with no
 * drag (e.g. a hypothetical future palette-only path) may pass a default box instead. `index`
 * only picks the initial color off the shared palette — the color dot on the node lets the user
 * repick afterwards, same as every other colorable node.
 */
export function createAnnotationNode(
  rect: AnnotationRect,
  variant: AnnotationVariant,
  index = 0
): CanvasNode {
  return {
    id: nextId('annotation'),
    type: 'annotation',
    position: rect.position,
    width: rect.size.width,
    height: rect.size.height,
    style: { width: rect.size.width, height: rect.size.height },
    data: {
      title: variant === 'arrow' ? 'Arrow' : 'Line',
      color: NODE_COLORS[index % NODE_COLORS.length],
      group: null,
      annotationVariant: variant,
      annotationDir: rect.dir
    }
  }
}

/** Creates a new project. When `ssh` is set, this is an SSH project (its terminals run remote). */
export function createProject(
  index: number,
  name?: string,
  cwd?: string,
  ssh?: Project['ssh']
): Project {
  return {
    id: nextId('project'),
    name: name ?? `Project ${index + 1}`,
    color: NODE_COLORS[index % NODE_COLORS.length],
    cwd,
    ...(ssh ? { ssh } : {}),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: []
  }
}

const GROUP_PAD = 28
const GROUP_HEADER = 34

const nodeW = (n: CanvasNode) => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode) => n.measured?.height ?? (n.height as number) ?? 0

export type ArrangeLayout = 'grid' | 'row' | 'column'

/**
 * The single container the given ids all live in: `null` (all top-level), a group id (all
 * children of that one group), or `undefined` when they resolve to no node OR span more than
 * one container (a group's children mixed with top-level, or two different groups). Positions
 * are only comparable within one container — top-level positions are absolute, a group child's
 * are relative to its frame — so arrange/align refuse a mixed set rather than scramble it.
 */
export function commonParentId(nodes: CanvasNode[], ids: string[]): string | null | undefined {
  const set = new Set(ids)
  const members = nodes.filter((nd) => set.has(nd.id))
  if (members.length === 0) return undefined
  const parents = new Set(members.map((m) => m.parentId ?? null))
  return parents.size === 1 ? (members[0].parentId ?? null) : undefined
}

/**
 * Repositions the given ids into a non-overlapping layout starting at `origin` (default: the
 * bounding-box top-left of their current positions). 'row' packs left-to-right, 'column'
 * top-to-bottom, 'grid' wraps at `cols` (default ~square) with each row advancing by its tallest
 * member. The ids must share ONE container — all top-level, or all children of the same group
 * (the layout then runs in that group's coordinate space); a mixed set is a no-op. Unknown ids
 * are skipped; returns the input array unchanged when nothing resolves. Pure and deterministic.
 */
export function arrangeNodes(
  nodes: CanvasNode[],
  ids: string[],
  opts?: {
    layout?: ArrangeLayout
    cols?: number
    gap?: number
    origin?: { x: number; y: number }
  }
): CanvasNode[] {
  const set = new Set(ids)
  const members = nodes.filter((nd) => set.has(nd.id))
  // Only meaningful within one coordinate space (see commonParentId) — mixed containers → no-op.
  if (members.length === 0 || new Set(members.map((m) => m.parentId ?? null)).size > 1) return nodes
  const layout = opts?.layout ?? 'grid'
  const gap = opts?.gap ?? 40
  const origin = opts?.origin ?? {
    x: Math.min(...members.map((m) => m.position.x)),
    y: Math.min(...members.map((m) => m.position.y))
  }
  const cols =
    layout === 'row' ? members.length : layout === 'column' ? 1 : Math.max(1, opts?.cols ?? Math.ceil(Math.sqrt(members.length)))

  const pos = new Map<string, { x: number; y: number }>()
  let x = origin.x
  let y = origin.y
  let rowH = 0
  members.forEach((m, i) => {
    if (i > 0 && i % cols === 0) {
      x = origin.x
      y += rowH + gap
      rowH = 0
    }
    pos.set(m.id, { x, y })
    x += nodeW(m) + gap
    rowH = Math.max(rowH, nodeH(m))
  })
  return nodes.map((nd) => (pos.has(nd.id) ? { ...nd, position: pos.get(nd.id)! } : nd))
}

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'

/**
 * Snaps the given ids to a shared edge/center computed from their joint bounding box.
 * left/right/hcenter move x; top/bottom/vcenter move y. The ids must share ONE container (all
 * top-level, or all children of the same group — see `arrangeNodes`); a mixed set is a no-op.
 * Unknown ids are skipped; returns the input array unchanged when nothing resolves. Pure.
 */
export function alignNodes(nodes: CanvasNode[], ids: string[], edge: AlignEdge): CanvasNode[] {
  const set = new Set(ids)
  const members = nodes.filter((nd) => set.has(nd.id))
  if (members.length === 0 || new Set(members.map((m) => m.parentId ?? null)).size > 1) return nodes
  const minX = Math.min(...members.map((m) => m.position.x))
  const maxR = Math.max(...members.map((m) => m.position.x + nodeW(m)))
  const minY = Math.min(...members.map((m) => m.position.y))
  const maxB = Math.max(...members.map((m) => m.position.y + nodeH(m)))
  const cx = (minX + maxR) / 2
  const cy = (minY + maxB) / 2
  const move = (m: CanvasNode): { x: number; y: number } => {
    switch (edge) {
      case 'left':
        return { x: minX, y: m.position.y }
      case 'right':
        return { x: maxR - nodeW(m), y: m.position.y }
      case 'hcenter':
        return { x: cx - nodeW(m) / 2, y: m.position.y }
      case 'top':
        return { x: m.position.x, y: minY }
      case 'bottom':
        return { x: m.position.x, y: maxB - nodeH(m) }
      case 'vcenter':
        return { x: m.position.x, y: cy - nodeH(m) / 2 }
    }
  }
  const set2 = new Set(members.map((m) => m.id))
  return nodes.map((nd) => (set2.has(nd.id) ? { ...nd, position: move(nd) } : nd))
}

/** Group (parent) nodes must precede their descendants in the array (React Flow requirement). */
function groupsFirst(nodes: CanvasNode[]): CanvasNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const emitted = new Set<string>()
  const visiting = new Set<string>()
  const groups: CanvasNode[] = []
  const emitGroup = (node: CanvasNode): void => {
    if (emitted.has(node.id) || node.type !== 'group') return
    if (visiting.has(node.id)) return
    visiting.add(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent?.type === 'group') emitGroup(parent)
    visiting.delete(node.id)
    if (!emitted.has(node.id)) {
      emitted.add(node.id)
      groups.push(node)
    }
  }
  nodes.forEach(emitGroup)
  return [...groups, ...nodes.filter((node) => node.type !== 'group')]
}

function rootPosition(node: CanvasNode, nodes: CanvasNode[]): { x: number; y: number } {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  const seen = new Set<string>([node.id])
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId
  }
  return { x, y }
}

function isDescendant(nodes: CanvasNode[], candidateId: string, ancestorId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  let current = byId.get(candidateId)
  while (current?.parentId && !seen.has(current.parentId)) {
    if (current.parentId === ancestorId) return true
    seen.add(current.parentId)
    current = byId.get(current.parentId)
  }
  return false
}

/** Returns only selected subtree roots. Box-selection often includes a group and its children;
 *  structural actions must move/group that subtree once, through its selected ancestor. */
export function selectedRootIds(nodes: CanvasNode[], ids: string[]): string[] {
  const selected = new Set(ids)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return ids.filter((id) => {
    let node = byId.get(id)
    if (!node) return false
    const seen = new Set<string>()
    while (node.parentId && !seen.has(node.parentId)) {
      if (selected.has(node.parentId)) return false
      seen.add(node.parentId)
      const parent = byId.get(node.parentId)
      if (!parent) break
      node = parent
    }
    return true
  })
}

/**
 * Grows every ancestor frame of `groupId` to hug its children again, innermost first. A frame
 * that gained a child bigger than itself must be re-fitted BEFORE its own parent is, or the
 * parent is fitted around a size that is about to change.
 */
function fitAncestorChain(nodes: CanvasNode[], groupId: string | undefined): CanvasNode[] {
  let next = nodes
  const seen = new Set<string>()
  let currentId = groupId
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    next = fitGroupToChildren(next, currentId)
    currentId = next.find((n) => n.id === currentId)?.parentId
  }
  return next
}

/**
 * Maximize (issue #399): resize `nodeId` to occupy `rect` — the visible viewport in ROOT/flow
 * coordinates, computed by the caller from the camera (`maximizeTargetRect`) — remembering the
 * node's own rect in `data.premaxRect` so `restoreMaximizedNode` can put everything back. This is
 * a real resize, not a camera move: the node goes through its normal resize path, so a terminal
 * reflows and the pty gets its new cols/rows.
 *
 * Grouped nodes work too: the new position is written parent-relative and every ancestor frame is
 * re-fitted (`fitAncestorChain`) in the SAME transform — `extent:'parent'` would otherwise clamp a
 * child bigger than its frame into an inverted range (the snap `groupSelectedNodes` documents).
 *
 * Refused (returned unchanged): unknown id, a group frame (maximizing the container would drag its
 * whole subtree), a collapsed node (header-only; expand first), and a node already maximized.
 */
export function maximizeNodeToRect(
  nodes: CanvasNode[],
  nodeId: string,
  rect: { x: number; y: number; width: number; height: number }
): CanvasNode[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || node.type === 'group' || node.data.collapsed || node.data.premaxRect) return nodes
  // The remembered position is ROOT-space, not parent-relative: re-fitting the frame around the
  // maximized child MOVES the frame's origin (it hugs), so a parent-relative restore would come
  // back a few px off — and root-space also survives the frame being ungrouped meanwhile.
  const root = rootPosition(node, nodes)
  const premaxRect = {
    x: root.x,
    y: root.y,
    width: nodeW(node) || (node.style?.width as number) || 0,
    height: nodeH(node) || (node.style?.height as number) || 0
  }
  if (!(premaxRect.width > 0) || !(premaxRect.height > 0)) return nodes
  return withNodeRect(nodes, node, rect, { premaxRect })
}

/**
 * Zone snap (issue #394 v1): place `nodeId` at `rect` — a zone of the visible viewport in
 * ROOT/flow coordinates (`zoneTargetRect`). Plain placement, no toggle state: unlike maximize it
 * writes no `premaxRect` (a node sent to "left half" has simply been MOVED, exactly as if by
 * hand) and an existing `premaxRect` is left alone, so a maximized node snapped into a zone still
 * restores to its pre-maximize spot. Refusals match the maximize matrix minus already-maximized:
 * unknown id, group frame, collapsed node.
 */
export function placeNodeInRect(
  nodes: CanvasNode[],
  nodeId: string,
  rect: { x: number; y: number; width: number; height: number }
): CanvasNode[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || node.type === 'group' || node.data.collapsed) return nodes
  return withNodeRect(nodes, node, rect, {})
}

/**
 * The shared placement core: put `node` at the ROOT-space `rect` (converted to parent-relative),
 * patch its data, and re-fit the ancestor frames in the same transform — `extent:'parent'` would
 * otherwise clamp a child bigger than its frame into an inverted range (the snap
 * `groupSelectedNodes` documents).
 */
function withNodeRect(
  nodes: CanvasNode[],
  node: CanvasNode,
  rect: { x: number; y: number; width: number; height: number },
  dataPatch: Partial<NodeData>
): CanvasNode[] {
  // rect is root-space; a grouped node's position is relative to its frame, so subtract the
  // ancestor origins (root position minus own offset = the parent chain's origin).
  const root = rootPosition(node, nodes)
  const originX = root.x - node.position.x
  const originY = root.y - node.position.y
  const next = nodes.map((n) =>
    n.id === node.id
      ? {
          ...n,
          position: { x: rect.x - originX, y: rect.y - originY },
          width: rect.width,
          height: rect.height,
          style: { ...n.style, width: rect.width, height: rect.height },
          // Drop the stale measurement in the same tick: flowToNodeStates prefers `measured` over
          // `width`/`height`, and a commit racing the re-measure would persist the OLD size.
          measured: undefined,
          data: { ...n.data, expandedHeight: rect.height, ...dataPatch }
        }
      : n
  )
  return fitAncestorChain(next, node.parentId)
}

/**
 * The toggle's second click: give the node back the rect `maximizeNodeToRect` remembered — the
 * exact canvas spot it occupied, converted from root-space into wherever its parent chain sits
 * now — and re-fit the ancestor frames back down around it. No-op when the node is missing or
 * not maximized.
 */
export function restoreMaximizedNode(nodes: CanvasNode[], nodeId: string): CanvasNode[] {
  const node = nodes.find((n) => n.id === nodeId)
  const prev = node?.data.premaxRect
  if (!node || !prev) return nodes
  return withNodeRect(nodes, node, prev, { premaxRect: undefined })
}

/**
 * Wraps nodes that share ONE container in a new group frame. The members may themselves be
 * frames, so this is how a nested tree is built. The frame is created beside its members inside
 * their current parent and every root-space position stays fixed. Mixed containers and
 * ancestor+descendant selections are refused (their positions are not comparable, and the
 * descendant would be torn out of the ancestor being wrapped).
 *
 * When the members live inside a parent frame, that parent (and its own ancestors) are re-fitted
 * around the new wrapper. Without this the wrapper is created at `(minX - 28, minY - 62)` — often
 * NEGATIVE — inside a parent that is by construction too small to hold it, and `extent: 'parent'`
 * makes React Flow clamp it to `parentSize - wrapperSize`, i.e. hundreds of px off, dragging the
 * whole wrapped subtree with it. Same trap `addGrouped` documents in Canvas.
 */
export function groupSelectedNodes(
  nodes: CanvasNode[],
  ids: string[],
  groupIndex: number
): CanvasNode[] {
  const set = new Set(ids)
  const members = nodes.filter((n) => set.has(n.id))
  if (members.length === 0 || new Set(members.map((n) => n.parentId ?? null)).size !== 1) {
    return nodes
  }
  // A Shop is the fixed catalog entry point for its universe. Grouping it would make the
  // supposedly permanent surface inherit a user frame and become movable with that frame.
  if (members.some((member) => member.type === 'shop' || member.data.nonDeletable === true)) return nodes
  if (
    members.some((member) =>
      members.some((other) => other.id !== member.id && isDescendant(nodes, other.id, member.id))
    )
  ) {
    return nodes
  }

  const minX = Math.min(...members.map((n) => n.position.x))
  const minY = Math.min(...members.map((n) => n.position.y))
  const maxX = Math.max(...members.map((n) => n.position.x + nodeW(n)))
  const maxY = Math.max(...members.map((n) => n.position.y + nodeH(n)))

  const gx = minX - GROUP_PAD
  const gy = minY - GROUP_PAD - GROUP_HEADER
  const group = createGroupNode(
    { x: gx, y: gy },
    { width: maxX - minX + GROUP_PAD * 2, height: maxY - minY + GROUP_PAD * 2 + GROUP_HEADER },
    groupIndex
  )
  const parentId = members[0].parentId
  if (parentId) {
    group.parentId = parentId
    group.extent = 'parent'
  }

  const updated = nodes.map((n) =>
    set.has(n.id)
      ? {
          ...n,
          parentId: group.id,
          extent: 'parent' as const,
          position: { x: n.position.x - gx, y: n.position.y - gy },
          selected: false
        }
      : n
  )
  return fitAncestorChain(groupsFirst([group, ...updated]), parentId)
}

/**
 * Every `NodeKind`, as a table rather than a list, so adding a kind to the union is a typecheck
 * error here until somebody classifies it. `duplicateKind` needs a RUNTIME check: `node.type` is
 * a plain string once it has been through a hand-editable project.json (a legacy `chat` record,
 * a kind written by a newer build), so the compile-time union cannot validate it on its own.
 */
const NODE_KIND_TABLE: Record<NodeKind, true> = {
  terminal: true,
  authenticator: true,
  calendar: true,
  'homeassistant-control': true,
  timer: true,
  alarm: true,
  sticky: true,
  group: true,
  editor: true,
  diff: true,
  photo: true,
  gallery: true,
  'wild-dim-sum': true,
  video: true,
  web: true,
  browser: true,
  subagent: true,
  loop: true,
  scheduler: true,
  dino: true,
  'recovery-game': true,
  annotation: true,
  minecraft: true,
  dockerhost: true,
  proxmox: true,
  gitlab: true,
  homeassistant: true,
  'homeassistant-sensor': true,
  freepbx: true,
  awsidentity: true,
  'nextcloud-aio': true,
  'nextcloud-managed': true,
  'gitlab-hosting': true,
  'cloudflare-zero-trust': true,
  'cloudflare-core-managers': true,
  nsis: true,
  shop: true,
  'aws-universe': true,
  'aws-resource': true,
  torrent: true,
  'linux-vm': true,
  'open-webui-hosting': true,
  'github-work-item': true,
  'windows-diagnostics': true
}

/**
 * Every kind's starting size, as a table for exactly the reason `NODE_KIND_TABLE` is one.
 *
 * This replaced a hand-written nested ternary that ended in `TERMINAL_SIZE`. That shape had a trap
 * the compiler could not see: a new kind which simply was not mentioned fell through to the terminal
 * fallback and persisted at 640x440, with nothing failing and no test noticing. `Record<NodeKind, …>`
 * turns that silent default into a typecheck error, so the size question has to be answered for
 * every kind that is ever added — which is the same guarantee, and the same reasoning, as the table
 * above.
 *
 * `terminal` keeps its own entry rather than being a default, because a value nothing names is a
 * value nobody has decided.
 */
const NODE_START_SIZE: Record<NodeKind, { width: number; height: number }> = {
  terminal: TERMINAL_SIZE,
  authenticator: AUTHENTICATOR_SIZE,
  calendar: CALENDAR_SIZE,
  'homeassistant-control': HOME_ASSISTANT_CONTROL_SIZE,
  timer: TIMER_SIZE,
  alarm: ALARM_SIZE,
  sticky: STICKY_SIZE,
  group: GROUP_SIZE,
  editor: EDITOR_SIZE,
  diff: DIFF_SIZE,
  photo: PHOTO_SIZE,
  gallery: GALLERY_SIZE,
  'wild-dim-sum': WILD_DIM_SUM_SIZE,
  video: VIDEO_SIZE,
  web: WEB_SIZE,
  browser: BROWSER_SIZE,
  // Ephemeral kinds are never persisted (they are derived from live hook events), so these are
  // defensive floors rather than values a project.json will ever carry.
  subagent: TERMINAL_SIZE,
  loop: NATIVE_LOOP_SIZE,
  scheduler: NATIVE_LOOP_SIZE,
  dino: DINO_SIZE,
  'recovery-game': RECOVERY_GAME_SIZE,
  annotation: ANNOTATION_SIZE,
  minecraft: SERVICE_CONSOLE_SIZE,
  dockerhost: SERVICE_CONSOLE_SIZE,
  proxmox: SERVICE_CONSOLE_SIZE,
  gitlab: SERVICE_SUMMARY_SIZE,
  homeassistant: SERVICE_SUMMARY_SIZE,
  'homeassistant-sensor': HOME_ASSISTANT_SENSOR_SIZE,
  freepbx: SERVICE_SUMMARY_SIZE,
  'cloudflare-tunnel': SERVICE_CONSOLE_SIZE,
  awsidentity: SERVICE_CONSOLE_SIZE,
  'nextcloud-aio': SERVICE_CONSOLE_SIZE,
  'nextcloud-managed': SERVICE_CONSOLE_SIZE,
  'gitlab-hosting': { width: 700, height: 620 },
  'cloudflare-zero-trust': SERVICE_CONSOLE_SIZE,
  'cloudflare-core-managers': CLOUDFLARE_CORE_MANAGERS_SIZE,
  nsis: NSIS_SIZE,
  shop: SHOP_SIZE,
  'aws-universe': { width: 320, height: 220 },
  'aws-resource': AWS_RESOURCE_SIZE,
  torrent: TORRENT_SIZE,
  'linux-vm': LINUX_VM_SIZE,
  'open-webui-hosting': OPEN_WEBUI_SIZE,
  'github-work-item': GITHUB_WORK_ITEM_NODE_SIZE,
  'windows-diagnostics': WINDOWS_DIAGNOSTICS_SIZE
}

/** A `Set`, not `type in NODE_KIND_TABLE`: `in` walks the prototype, so `'constructor'` and
 *  `'toString'` would both pass as node kinds. */
const NODE_KINDS = new Set<string>(Object.keys(NODE_KIND_TABLE))

/**
 * The kind a duplicate should carry: the source's own, falling back to `terminal` only for a type
 * that is genuinely not a kind (absent, or a legacy/hand-edited string like the removed `chat`).
 */
function duplicateKind(type: string | undefined): NodeKind {
  return type && NODE_KINDS.has(type) ? (type as NodeKind) : 'terminal'
}

/**
 * Returns a copy of a node with a fresh id, offset position, and top-level placement.
 *
 * A duplicate is a new execution identity, not a second view of the source conversation. Never
 * carry one-shot launch state, an armed launch, or the provider session id: doing so can make the
 * copy resume the source conversation or execute work the source already consumed.
 *
 * `kind` resolves the source's OWN type and is used for BOTH the copy's `type` and its id prefix.
 * It used to enumerate sticky/group (later annotation) and collapse everything else to `terminal`
 * — which never demoted the copy (`type` rides the `...node` spread and was not reassigned), but
 * did mint an editor/diff/video/web/browser/dino/Loop copy a `term-…` id. That is not cosmetic:
 * `SAFE_NODE_ID` (core/project-node-append, twinned in nodeterm-ios) is how the relay decides an
 * id may register as a TERMINAL session, and it matches on exactly that prefix — so a duplicated
 * editor carried a terminal's credentials in its name. `projects.duplicateNode` (the
 * inactive-project path) already keyed its id off `src.kind`, so the live canvas was the odd one
 * out: the same editor duplicated in an inactive project got `editor-…` and in the active one
 * `term-…`. Assigning `type` explicitly keeps the pair honest in the other direction too — a
 * legacy or hand-edited type normalizes to `terminal` alongside its `term-` id instead of keeping
 * a bogus type that the prefix then contradicts.
 *
 * What it does NOT keep is anything that would give the copy an identity or authority of its own:
 * see the cleared fields below. Each of those was live before this — a duplicated frame really did
 * claim the source's worktree, and a duplicated running Loop really was a second scheduler.
 * Content identity — `filePath`, `url`, `cwd`, `diffStaged`, `commitOid`, `text`, `highScore`,
 * `annotationVariant` — is exactly what a duplicate is FOR and is kept. `fileMissing` is kept
 * too: it is a fact about the filesystem, not about the source node, so clearing it would only
 * make the copy claim a deleted file is there and try to read it.
 */
export function duplicateNode(node: CanvasNode, offset = 28): CanvasNode {
  if (node.type === 'shop' || node.data.nonDeletable === true) {
    throw new Error('Shop nodes are permanent and cannot be duplicated.')
  }
  const kind = duplicateKind(node.type)
  // Mirrors the factories exactly: `createTerminalNode` mints `term-…` and every other factory
  // uses its own kind as the prefix (`editor-`, `diff-`, `video-`, `web-`, `browser-`, `sticky-`,
  // `scheduler-`, `dino-`, `group-`, `annotation-`). Do NOT "simplify" this to a bare `kind`: an
  // `editor-` id on a terminal would be refused by the relay's guard, and a `term-` id on an
  // editor would be accepted by it.
  const prefix = kind === 'terminal' ? 'term' : kind
  return {
    ...node,
    // Same source as `prefix`, so type and id can never disagree about what this node is.
    type: kind,
    id: nextId(prefix),
    position: { x: node.position.x + offset, y: node.position.y + offset },
    selected: true,
    parentId: undefined,
    extent: undefined,
    data: {
      ...node.data,
      // A duplicate is a new user creation event, never a second owner of the source event.
      creationEventId: newCreationEventId(),
      initialCommand: undefined,
      agentLaunchIntent: undefined,
      pendingLaunch: undefined,
      pendingLaunchError: undefined,
      pendingLaunchErrorKind: undefined,
      pendingLaunchErrorOwnership: undefined,
      agentSessionId: undefined,
      // One-shot respawn trigger, never serialized: the number means something only as a CHANGE,
      // so a copy born holding the source's counter is stale from birth.
      respawnNonce: undefined,
      // A worktree binding is 1:1 with one checkout on disk, and the destructive Merge/Remove
      // paths are keyed on it (`releaseWorktreeBinding`). A second frame claiming the same
      // binding could remove the directory the ORIGINAL frame is still working in.
      worktree: undefined,
      // Grants an agent control of this tab through the Browser Plugin. An agent propagates its
      // own grant when IT opens a popup; a user duplicating a node must not hand that authority
      // to a tab the agent never opened.
      browserOwnerNodeId: undefined,
      // Loop CONFIG (task/interval/targets) is what a user duplicating a Loop wants copied; the
      // RUN is not. Canvas's scheduler sweep fires every `loopEnabled` node, so a copy of a
      // running Loop would be a second live scheduler pushing the same prompt at the same agents
      // on the same cadence. `loopNextRunAt`/`loopLastRunAt` are that run's bookkeeping, not
      // config, so they go with it.
      loopEnabled: undefined,
      loopNextRunAt: undefined,
      loopLastRunAt: undefined,
      // A duplicate owns a fresh VM identity and must never inherit another VM's ISO or disk.
      virtualMachineLocalPaths: undefined,
      // AWS profiles are machine-local bindings. A duplicate keeps safe portable intent but must
      // require an explicit local profile selection rather than silently sharing one.
      awsIdentityBinding: undefined,
      ...(kind === 'timer' ? {
        running: false, paused: false, elapsedMs: 0, remainingMs: (node.data as TimerNodeData).durationMs,
        lapsMs: [], sequenceIndex: 0, repeatRemaining: 0, occurrenceId: undefined,
        occurrenceState: 'scheduled', missedCount: 0, wallAnchorMs: undefined, monotonicAnchorMs: undefined
      } : {})
    }
  }
}

/**
 * Resizes a group frame to hug its current children (same padding as `groupSelectedNodes`), and
 * re-anchors the frame + rewrites the children's relative positions so nothing moves on canvas.
 * Used after arranging inside a frame: the frame's width came from wherever the children happened
 * to sit when they were grouped, so a tidy inner layout still leaves an oversized box. No-op for a
 * missing/non-group id or a frame with no children. Pure.
 */
export function fitGroupToChildren(nodes: CanvasNode[], groupId: string): CanvasNode[] {
  const group = nodes.find((n) => n.id === groupId)
  if (!group || group.type !== 'group') return nodes
  const children = nodes.filter((n) => n.parentId === groupId)
  if (children.length === 0) return nodes
  // Child positions are group-relative; convert to absolute via the current frame origin.
  const absX = (c: CanvasNode) => group.position.x + c.position.x
  const absY = (c: CanvasNode) => group.position.y + c.position.y
  const minX = Math.min(...children.map(absX))
  const minY = Math.min(...children.map(absY))
  const maxX = Math.max(...children.map((c) => absX(c) + nodeW(c)))
  const maxY = Math.max(...children.map((c) => absY(c) + nodeH(c)))
  const gx = minX - GROUP_PAD
  const gy = minY - GROUP_PAD - GROUP_HEADER
  const width = maxX - minX + GROUP_PAD * 2
  const height = maxY - minY + GROUP_PAD * 2 + GROUP_HEADER
  return nodes.map((n) => {
    if (n.id === groupId) {
      return { ...n, position: { x: gx, y: gy }, width, height, style: { ...n.style, width, height } }
    }
    if (n.parentId === groupId) {
      return { ...n, position: { x: absX(n) - gx, y: absY(n) - gy } }
    }
    return n
  })
}

/**
 * Zone snap (issue #394 v1, ported): place `nodeId` at `rect` — a zone of the visible viewport in
 * ROOT/flow coordinates (`zoneTargetRect`). Plain placement: the node is simply MOVED and resized,
 * exactly as if by hand. Refuses an unknown id, a group frame, or a collapsed node (a collapsed
 * node has no real height to occupy a zone with).
 *
 * `rect` is root-space; a grouped node's position is relative to its frame, so this subtracts the
 * ancestor origins (root position minus own offset = the parent chain's origin) the same way
 * `maximizeNodeToRect`-style placement would, then re-fits the ancestor frame chain — `extent:
 * 'parent'` would otherwise clamp a child bigger than its frame into an inverted range (the trap
 * `groupSelectedNodes` documents).
 */
export function placeNodeInRect(
  nodes: CanvasNode[],
  nodeId: string,
  rect: { x: number; y: number; width: number; height: number }
): CanvasNode[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || node.type === 'group' || node.data.collapsed) return nodes
  const root = rootPosition(node, nodes)
  const originX = root.x - node.position.x
  const originY = root.y - node.position.y
  const next = nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          position: { x: rect.x - originX, y: rect.y - originY },
          width: rect.width,
          height: rect.height,
          style: { ...n.style, width: rect.width, height: rect.height },
          // Drop the stale measurement in the same tick: flowToNodeStates prefers `measured` over
          // `width`/`height`, and a commit racing the re-measure would persist the OLD size.
          measured: undefined,
          data: { ...n.data, expandedHeight: rect.height }
        }
      : n
  )
  return fitAncestorChain(next, node.parentId)
}

/**
 * Removes a group frame, promoting its DIRECT children into the frame's own parent (the top
 * level for an unnested frame) without moving them on canvas. A nested frame's children land in
 * the grandparent, not at the root — sending them to the root would move them by the whole
 * ancestor offset.
 */
export function ungroupNodes(nodes: CanvasNode[], groupId: string): CanvasNode[] {
  const group = nodes.find((n) => n.id === groupId)
  if (!group || group.type !== 'group') return nodes
  const parentId = group.parentId ?? null
  const moved = nodes.map((node) =>
    node.parentId === groupId ? repositionForParent(node, parentId, nodes) : node
  )
  return groupsFirst(moved.filter((node) => node.id !== groupId))
}
/**
 * Returns `node` repositioned for a new parent (`targetParentId`, or null for top level),
 * keeping its on-canvas position fixed via root↔relative conversion across arbitrary nesting
 * (the old math added ONE parent's origin, which is wrong the moment frames nest). Returns the
 * node unchanged if the target group is missing or not a group.
 */
function repositionForParent(
  node: CanvasNode,
  targetParentId: string | null,
  nodes: CanvasNode[]
): CanvasNode {
  const abs = rootPosition(node, nodes)
  if (targetParentId === null) {
    return { ...node, parentId: undefined, extent: undefined, position: abs }
  }
  const group = nodes.find((n) => n.id === targetParentId)
  if (!group || group.type !== 'group') return node
  const groupAbs = rootPosition(group, nodes)
  return {
    ...node,
    parentId: group.id,
    extent: 'parent' as const,
    position: { x: abs.x - groupAbs.x, y: abs.y - groupAbs.y }
  }
}

/**
 * Moves a node — or a whole group subtree — into an existing frame (`groupId` set) or out to the
 * top level (`groupId` null), keeping its root-space position fixed. Returns a new array with
 * frames kept before their descendants (React Flow requires parents first). No-op when the node
 * is missing, it already has the requested parent, the target is not a group, or the move would
 * create a cycle (a frame cannot be parented into itself or into one of its own descendants).
 */
export function reparentNode(
  nodes: CanvasNode[],
  nodeId: string,
  groupId: string | null
): CanvasNode[] {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return nodes
  if (node.type === 'shop' || node.data.nonDeletable === true) return nodes
  if ((node.parentId ?? null) === groupId) return nodes
  if (groupId === nodeId || (groupId && isDescendant(nodes, groupId, nodeId))) return nodes

  const updated = repositionForParent(node, groupId, nodes)
  if (updated === node) return nodes // target group missing / not a group
  return groupsFirst(nodes.map((n) => (n.id === nodeId ? updated : n)))
}

/**
 * Adds the selected objects to an existing frame. Only selected subtree ROOTS move — when a
 * frame and one of its children are both selected, the child travels inside its frame rather
 * than being torn out of it.
 */
export function addSelectionToGroup(
  nodes: CanvasNode[],
  selectedIds: string[],
  groupId: string
): CanvasNode[] {
  if (!nodes.some((node) => node.id === groupId && node.type === 'group')) return nodes
  const selected = new Set(selectedIds)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const roots = nodes.filter((node) => {
    if (node.id === groupId || !selected.has(node.id) || node.type === 'shop' || node.data.nonDeletable === true) return false
    const seen = new Set<string>()
    let parentId = node.parentId
    while (parentId && !seen.has(parentId)) {
      if (selected.has(parentId)) return false
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
    return true
  })
  let next = nodes
  for (const root of roots) next = reparentNode(next, root.id, groupId)
  return next === nodes ? nodes : fitAncestorChain(next, groupId)
}

/**
 * Reorders one group subtree among its siblings without changing its parent or its geometry.
 * `beforeId = null` appends it after the last sibling. Descendants travel with their frame so
 * the persisted parent-before-child order stays coherent.
 */
export function reorderGroupWithinParent<T extends { id: string; parentId?: string }>(
  nodes: T[],
  draggedId: string,
  parentId: string | null,
  beforeId: string | null
): T[] {
  if (draggedId === beforeId) return nodes
  const dragged = nodes.find((node) => node.id === draggedId)
  if (!dragged || (dragged.parentId ?? null) !== parentId || (dragged as { type?: string }).type === 'shop') return nodes
  const before = beforeId ? nodes.find((node) => node.id === beforeId) : undefined
  if (beforeId && (!before || (before.parentId ?? null) !== parentId)) return nodes

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const belongsToDraggedSubtree = (node: T): boolean => {
    if (node.id === draggedId) return true
    const seen = new Set<string>()
    let current = node
    while (current.parentId && !seen.has(current.parentId)) {
      if (current.parentId === draggedId) return true
      seen.add(current.parentId)
      const next = byId.get(current.parentId)
      if (!next) return false
      current = next
    }
    return false
  }
  const subtree = nodes.filter(belongsToDraggedSubtree)
  const without = nodes.filter((node) => !belongsToDraggedSubtree(node))
  const at = beforeId ? without.findIndex((node) => node.id === beforeId) : without.length
  if (at < 0) return nodes
  return [...without.slice(0, at), ...subtree, ...without.slice(at)]
}

/**
 * Moves `draggedId` to sit immediately before `beforeId` in the array (sidebar order follows
 * array order). The dragged node also joins `beforeId`'s container (same reposition math) so a
 * drop both reorders within a group and can move across groups. No-op when either node is
 * missing, they are the same, or the dragged node is a group (frames reorder through
 * `reorderGroupWithinParent`, which keeps their whole subtree together).
 */
export function reorderNodeBefore(
  nodes: CanvasNode[],
  draggedId: string,
  beforeId: string
): CanvasNode[] {
  if (draggedId === beforeId) return nodes
  const dragged = nodes.find((n) => n.id === draggedId)
  const before = nodes.find((n) => n.id === beforeId)
  if (!dragged || !before || dragged.type === 'group' || dragged.type === 'shop' || dragged.data.nonDeletable === true) return nodes

  const targetParent = before.parentId ?? null
  const moved =
    (dragged.parentId ?? null) === targetParent
      ? dragged
      : repositionForParent(dragged, targetParent, nodes)

  const without = nodes.filter((n) => n.id !== draggedId)
  const idx = without.findIndex((n) => n.id === beforeId)
  const result = [...without.slice(0, idx), moved, ...without.slice(idx)]
  return groupsFirst(result)
}

/** Converts persisted node states into live React Flow nodes (parents first). */
/**
 * Synthesizes a one-tab `browserTabs` array from a legacy/fresh browser node's `url`/`title`.
 * Shared by the persisted-load migration below and by `BrowserNode` for a node that has no
 * `data.browserTabs` yet (a freshly created node, or one loaded before this field existed) —
 * one definition so the two paths cannot drift on what "no tabs yet" defaults to.
 */
export function defaultBrowserTabs(nodeId: string, url: string | undefined, title: string): BrowserTab[] {
  return [{ id: `${nodeId}-tab-0`, url: url ?? '', title: title || 'New Tab' }]
}

export function nodeStatesToFlow(states: CanvasNodeState[]): CanvasNode[] {
  // React Flow requires a parent node to appear before its children. With nested frames a flat
  // "groups first" sort is not enough (two frames compare equal), so `groupsFirst` re-emits the
  // frames depth-first from the root at the end of this function.
  const mapped = states.map((raw) => {
    // The SDK chat node was removed (2026-07). A persisted chat node degrades into a sticky that
    // keeps its place and tells the user how to continue the conversation — chat sessions are
    // ordinary Claude sessions, resumable in any terminal. (position/size are normalized
    // defensively so a legacy chat node still lands even if its shape is minimal.)
    let n = raw
    // Legacy read: `chat` is no longer a NodeKind, so a persisted chat node arrives as an
    // unknown-kind blob — detect it by its string kind and read its old `chatSessionId` field.
    if ((n.kind as string) === 'chat') {
      const chatSessionId = (n as { chatSessionId?: string }).chatSessionId
      const resume = chatSessionId
        ? `\n\nContinue it in a terminal:\nclaude --resume ${chatSessionId}`
        : ''
      n = {
        ...n,
        kind: 'sticky',
        position: n.position ?? { x: (n as { x?: number }).x ?? 0, y: (n as { y?: number }).y ?? 0 },
        size: n.size ?? {
          width: (n as { width?: number }).width ?? STICKY_SIZE.width,
          height: (n as { height?: number }).height ?? STICKY_SIZE.height
        },
        text: `This was a chat node — the chat node type was removed.${resume}`
      }
    }
    const collapsed = !!n.collapsed
    const height = collapsed ? COLLAPSED_HEIGHT : n.size.height
    // Legacy migration: nodes saved before `agentId` existed marked Claude via the 'claude'
    // tag. Backfill agentId so saved workspaces keep working.
    let agentId = n.agentId
    if (!agentId && Array.isArray(n.tags) && n.tags.includes('claude')) agentId = 'claude'
    // Legacy migration: a browser node saved before tabs existed carries only `url`/`title`.
    // Synthesize a single tab from them so the tab strip has something to show — this is a
    // read-side migration only (not written back to disk until the user actually edits a tab).
    const browserTabs =
      n.browserTabs && n.browserTabs.length > 0
        ? n.browserTabs
        : (n.kind ?? 'terminal') === 'browser'
          ? defaultBrowserTabs(n.id, n.url, n.title)
          : undefined
    const browserActiveTabId = n.browserActiveTabId ?? browserTabs?.[0]?.id
    return {
      id: n.id,
      // Default to 'terminal' for nodes saved before the kind field existed.
      type: n.kind ?? 'terminal',
      ...((n.kind ?? 'terminal') === 'group' ? { dragHandle: '.group-node__label' } : {}),
      position: n.position,
      width: n.size.width,
      height,
      style: { width: n.size.width, height },
      ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
      data: {
        creationEventId: n.creationEventId,
        title: n.title,
        // Default true for older agent nodes saved before titleAuto existed, so they start
        // tracking the session name; non-agent nodes ignore it.
        titleAuto: n.titleAuto ?? true,
        color: n.color,
        group: n.group,
        tags: n.tags,
        collapsed,
        icon: normalizeNodeIcon(n.icon),
        hideFanout: n.hideFanout,
        expandedHeight: n.size.height,
        loopTask: n.loopTask,
        loopIntervalMs: n.loopIntervalMs,
        loopEnabled: n.loopEnabled,
        loopNextRunAt: n.loopNextRunAt,
        loopLastRunAt: n.loopLastRunAt,
        loopTargetIds: n.loopTargetIds,
        timerMode: n.timerMode ?? n.timerMode,
        timerDurationMs: n.timerDurationMs ?? n.durationMs,
        timerRemainingMs: n.timerRemainingMs ?? n.remainingMs,
        timerElapsedMs: n.timerElapsedMs ?? n.elapsedMs,
        timerRunning: n.timerRunning ?? n.running,
        timerPaused: n.timerPaused ?? n.paused,
        timerRepeatCount: n.timerRepeatCount ?? n.repeatCount,
        timerRepeatRemaining: n.timerRepeatRemaining ?? n.repeatRemaining,
        timerSequence: n.timerSequence ?? n.sequence,
        timerSequenceIndex: n.timerSequenceIndex ?? n.sequenceIndex,
        timerLapsMs: n.timerLapsMs ?? n.lapsMs,
        timerNextOccurrenceAt: n.timerNextOccurrenceAt ?? n.nextOccurrenceAt,
        timerOccurrenceId: n.timerOccurrenceId ?? n.occurrenceId,
        timerOccurrenceState: n.timerOccurrenceState ?? n.occurrenceState,
        timerAlarmEnabled: n.timerAlarmEnabled ?? n.alarmEnabled,
        timerAlarmTone: n.timerAlarmTone ?? n.alarmTone,
        timerMissedCount: n.timerMissedCount ?? n.missedCount,
        alarmSchedule: n.alarmSchedule,
        alarmTimeZone: n.alarmTimeZone,
        alarmEnabled: n.alarmEnabled,
        alarmSnoozeMinutes: n.alarmSnoozeMinutes,
        alarmSoundEnabled: n.alarmSoundEnabled,
        alarmNarratorEnabled: n.alarmNarratorEnabled,
        alarmNextOccurrenceAt: n.alarmNextOccurrenceAt,
        alarmHistory: n.alarmHistory,
        premaxRect: n.premaxRect,
        shell: n.shell,
        terminalProfileId: n.ssh ? undefined : n.terminalProfileId,
        cwd: n.cwd,
        text: n.text,
        serviceLabel: n.serviceLabel,
        openWebUiIntent: n.openWebUiIntent,
        openWebUiLocalBinding: n.openWebUiLocalBinding,
        nextcloudManagedIntent: n.nextcloudManagedIntent,
        nextcloudManagedBinding: n.nextcloudManagedBinding,
        awsIdentityIntent: normalizeAwsIdentityIntent(n.awsIdentityIntent) ?? undefined,
        gitlabHostingConfig: n.gitlabHostingConfig,
        nextcloudAioConfig: n.nextcloudAioConfig,
        homeAssistantIntent: n.homeAssistantIntent,
        cloudflareTunnelIntent: n.cloudflareTunnelIntent,
        universeCanvasId: n.universeCanvasId,
        universeScope: n.universeScope,
        universeDepth: n.universeDepth,
        nonDeletable: n.nonDeletable,
        creationEventId: n.creationEventId,
        shopSelection: (n as CanvasNodeState & { shopSelection?: string }).shopSelection,
        torrentMagnet: n.torrentMagnet,
        awsManagerIntent: n.awsManagerIntent,
        serviceConnection: n.serviceConnection,
        cloudflareZeroTrustIntent: n.cloudflareZeroTrustIntent,
        cloudflareCoreIntent: n.cloudflareCoreIntent,
        cloudflareTunnelIntent: n.cloudflareTunnelIntent,
        nsisSpec: n.nsisSpec,
        nsisLocalPaths: n.nsisLocalPaths,
        virtualMachineConfig: n.virtualMachineConfig,
        virtualMachineLocalPaths: n.virtualMachineLocalPaths,
        githubWorkItem: n.githubWorkItem,
        calendarConfig: n.calendarConfig,
        homeAssistantControlConfig: n.kind === 'homeassistant-control' ? validateHomeAssistantControlConfig(n.homeAssistantControlConfig) : undefined,
        homeAssistantSensorConfig: n.homeAssistantSensorConfig,
        textUpdatedAt: n.textUpdatedAt,
        textUpdatedBy: n.textUpdatedBy,
        filePath: n.filePath,
        mediaAssets: n.mediaAssets?.map(normalizeMediaReference).filter((reference): reference is MediaAssetReference => !!reference),
        mediaActiveAssetId: n.mediaActiveAssetId,
        wildDimSumDish: normalizePublicDimSumSelection(n.wildDimSumDish) ?? undefined,
        fileMissing: n.fileMissing,
        url: n.url,
        browserProfileId: n.browserProfileId,
        browserTabs,
        browserActiveTabId,
        kioskPwaIntent: n.kioskPwaIntent,
        partition: n.partition,
        diffStaged: n.diffStaged,
        commitOid: n.commitOid,
        highScore: n.highScore,
        // The recovery board is project-portable intent, so normalize legacy or hand-edited
        // snapshots at the load boundary instead of letting malformed coordinates reach the UI.
        recoveryGame: n.recoveryGame ? normalizeRecoveryGameSnapshot(n.recoveryGame) : undefined,
        agentId,
        agentModel: n.agentModel,
        accountId: n.accountId,
        // Migrate the old title-only identity into an explicit true/false on the next save.
        accountLogin: n.accountLogin ?? isAccountLoginNode(n),
        agentSessionId: n.agentSessionId,
        codexAccountId: n.codexAccountId,
        pendingLaunch: n.pendingLaunch,
        ssh: n.ssh,
        sshRemoteTmux: n.sshRemoteTmux,
        sshFs: n.sshFs,
        worktree: n.worktree,
        annotationVariant: n.annotationVariant,
        annotationDir: n.annotationDir
      }
    }
  })
  return groupsFirst(mapped)
}

/** Serializes live React Flow nodes back into persisted node states. */
export function flowToNodeStates(nodes: CanvasNode[]): CanvasNodeState[] {
  // One lookup, not a ternary chain. The chain this replaced could not fail for a kind it simply
  // did not mention: it fell through to TERMINAL_SIZE and persisted at 640x440 silently. See
  // NODE_START_SIZE for why that is now a typecheck error instead.
  const sizeFor = (kind: NodeKind) => NODE_START_SIZE[kind] ?? TERMINAL_SIZE
  return nodes
    // Temporary nodes (browser popups) are live canvas objects that were never asked to outlive
    // the session. Dropping them HERE rather than at each call site means every save path -- the
    // debounced autosave, an explicit save, the SSH mirror, the export archive -- agrees, and a
    // popup can never be resurrected by a reload into a node nobody opened.
    .filter((n) => !n.data.temporary)
    .map((n) => {
      const kind: NodeKind = (n.type as NodeKind) ?? 'terminal'
      const collapsed = !!n.data.collapsed
      return {
        id: n.id,
        kind,
        creationEventId: n.data.creationEventId,
        position: n.position,
        size: {
          width: n.measured?.width ?? n.width ?? sizeFor(kind).width,
          // While collapsed, persist the expanded height, not the shrunk one.
          height: collapsed
            ? (n.data.expandedHeight ?? sizeFor(kind).height)
            : (n.measured?.height ?? n.height ?? sizeFor(kind).height)
        },
        title: n.data.title,
        titleAuto: n.data.titleAuto,
        color: n.data.color,
        group: n.data.group,
        tags: n.data.tags,
        collapsed: n.data.collapsed,
        icon: normalizeNodeIcon(n.data.icon),
        loopTask: n.data.loopTask,
        loopIntervalMs: n.data.loopIntervalMs,
        loopEnabled: n.data.loopEnabled,
        loopNextRunAt: n.data.loopNextRunAt,
        loopLastRunAt: n.data.loopLastRunAt,
        loopTargetIds: n.data.loopTargetIds,
        timerMode: n.data.timerMode,
        timerDurationMs: n.data.timerDurationMs ?? (n.data as TimerNodeData).durationMs,
        timerRemainingMs: n.data.timerRemainingMs ?? (n.data as TimerNodeData).remainingMs,
        timerElapsedMs: n.data.timerElapsedMs ?? (n.data as TimerNodeData).elapsedMs,
        timerRunning: n.data.timerRunning ?? (n.data as TimerNodeData).running,
        timerPaused: n.data.timerPaused ?? (n.data as TimerNodeData).paused,
        timerRepeatCount: n.data.timerRepeatCount ?? (n.data as TimerNodeData).repeatCount,
        timerRepeatRemaining: n.data.timerRepeatRemaining ?? (n.data as TimerNodeData).repeatRemaining,
        timerSequence: n.data.timerSequence ?? (n.data as TimerNodeData).sequence,
        timerSequenceIndex: n.data.timerSequenceIndex ?? (n.data as TimerNodeData).sequenceIndex,
        timerLapsMs: n.data.timerLapsMs ?? (n.data as TimerNodeData).lapsMs,
        timerNextOccurrenceAt: n.data.timerNextOccurrenceAt ?? (n.data as TimerNodeData).nextOccurrenceAt,
        timerOccurrenceId: n.data.timerOccurrenceId ?? (n.data as TimerNodeData).occurrenceId,
        timerOccurrenceState: n.data.timerOccurrenceState ?? (n.data as TimerNodeData).occurrenceState,
        timerAlarmEnabled: n.data.timerAlarmEnabled ?? (n.data as TimerNodeData).alarmEnabled,
        timerAlarmTone: n.data.timerAlarmTone ?? (n.data as TimerNodeData).alarmTone,
        timerMissedCount: n.data.timerMissedCount ?? (n.data as TimerNodeData).missedCount,
        alarmSchedule: n.data.alarmSchedule,
        alarmTimeZone: n.data.alarmTimeZone,
        alarmEnabled: n.data.alarmEnabled,
        alarmSnoozeMinutes: n.data.alarmSnoozeMinutes,
        alarmSoundEnabled: n.data.alarmSoundEnabled,
        alarmNarratorEnabled: n.data.alarmNarratorEnabled,
        alarmNextOccurrenceAt: n.data.alarmNextOccurrenceAt,
        alarmHistory: n.data.alarmHistory,
        hideFanout: n.data.hideFanout,
        parentId: n.parentId,
        shell: n.data.shell,
        terminalProfileId: n.data.ssh ? undefined : n.data.terminalProfileId,
        cwd: n.data.cwd,
        text: n.data.text,
        serviceLabel: n.data.serviceLabel,
        openWebUiIntent: n.data.openWebUiIntent,
        openWebUiLocalBinding: n.data.openWebUiLocalBinding,
        nextcloudManagedIntent: n.data.nextcloudManagedIntent,
        nextcloudManagedBinding: n.data.nextcloudManagedBinding,
        awsIdentityIntent: normalizeAwsIdentityIntent(n.data.awsIdentityIntent) ?? undefined,
        gitlabHostingConfig: n.data.gitlabHostingConfig,
        nextcloudAioConfig: n.data.nextcloudAioConfig,
        homeAssistantIntent: n.data.homeAssistantIntent,
        cloudflareTunnelIntent: n.data.cloudflareTunnelIntent,
        universeCanvasId: n.data.universeCanvasId,
        universeScope: n.data.universeScope,
        universeDepth: n.data.universeDepth,
        nonDeletable: n.data.nonDeletable,
        creationEventId: n.data.creationEventId,
        shopSelection: n.data.shopSelection,
        torrentMagnet: n.data.torrentMagnet,
        awsManagerIntent: n.data.awsManagerIntent,
        serviceConnection: n.data.serviceConnection,
        cloudflareZeroTrustIntent: n.data.cloudflareZeroTrustIntent,
        cloudflareCoreIntent: n.data.cloudflareCoreIntent,
        cloudflareTunnelIntent: n.data.cloudflareTunnelIntent,
        nsisSpec: n.data.nsisSpec,
        nsisLocalPaths: n.data.nsisLocalPaths,
        // Media paths remain in the live node long enough for the machine-local index to retain
        // them. The shared-file boundary strips them in `stripSharedNodeExec`, while portable
        // content references continue into the transferable projection.
        filePath: n.data.filePath,
        mediaAssets: n.data.mediaAssets?.map((reference) => ({ ...reference })),
        mediaActiveAssetId: n.data.mediaActiveAssetId,
        wildDimSumDish: normalizePublicDimSumSelection(n.data.wildDimSumDish) ?? undefined,
        virtualMachineConfig: n.data.virtualMachineConfig,
        virtualMachineLocalPaths: n.data.virtualMachineLocalPaths,
        githubWorkItem: n.data.githubWorkItem,
        calendarConfig: n.data.calendarConfig,
        homeAssistantControlConfig: kind === 'homeassistant-control' ? validateHomeAssistantControlConfig(n.data.homeAssistantControlConfig) : undefined,
        homeAssistantSensorConfig: n.data.homeAssistantSensorConfig,
        fileMissing: n.data.fileMissing,
        url: n.data.url,
        browserProfileId: n.data.browserProfileId,
        browserTabs: n.data.browserTabs,
        browserActiveTabId: n.data.browserActiveTabId,
        kioskPwaIntent: n.data.kioskPwaIntent,
        textUpdatedAt: n.data.textUpdatedAt,
        textUpdatedBy: n.data.textUpdatedBy,
        fileMissing: n.data.fileMissing,
        url: n.data.url,
        partition: n.data.partition,
        diffStaged: n.data.diffStaged,
        commitOid: n.data.commitOid,
        highScore: n.data.highScore,
        // Persist only the bounded board snapshot. It contains no path, process, host, or account
        // state, and normalization keeps old project files safe to reopen on another computer.
        recoveryGame: n.data.recoveryGame ? normalizeRecoveryGameSnapshot(n.data.recoveryGame) : undefined,
        agentId: n.data.agentId,
        agentModel: n.data.agentModel,
        accountId: n.data.accountId,
        accountLogin: n.data.accountLogin,
        agentSessionId: n.data.agentSessionId,
        codexAccountId: n.data.codexAccountId,
        pendingLaunch: n.data.pendingLaunch,
        ssh: n.data.ssh,
        sshRemoteTmux: n.data.sshRemoteTmux,
        sshFs: n.data.sshFs,
        worktree: n.data.worktree,
        annotationVariant: n.data.annotationVariant,
        annotationDir: n.data.annotationDir,
        premaxRect: n.data.premaxRect
      }
    })
}

/**
 * Apply ONE peer mutation (canvas sync) to the LIVE React Flow node array — patch/append/remove
 * just that node, and leave every other node object untouched.
 *
 * NOT `nodeStatesToFlow(applyCanvasMutation(flowToNodeStates(nodes), m))`. That whole-canvas round
 * trip was the first cut, and the serializers are lossy BY DESIGN, so it destroyed live state on
 * every peer mutation — 20 times a second while a teammate drags:
 *   - SELECTION. `nodeStatesToFlow` never sets `selected`, so a teammate's drag wiped your
 *     box-select / shift-click / select-then-group the instant it landed.
 *   - LOCAL-ONLY DATA. `initialCommand`, `respawnNonce` never survive a serialize.
 *   - IDENTITY. Every node object was rebuilt → every node component re-rendered, per mutation.
 * Patching in place keeps all four: untouched nodes keep their object identity (React.memo holds),
 * and the touched one keeps `selected` and its local-only data.
 *
 * `measured` is deliberately NOT carried over on the patched node: React Flow's measured size wins
 * over `width`/`height` in flowToNodeStates, so keeping a stale one would make us serialize the OLD
 * size after a peer resized the node — and re-publish it, fighting the peer. Dropping it lets React
 * Flow re-measure from the incoming `style`, which is what the peer sent.
 */
export function applyMutationToFlow(
  nodes: CanvasNode[],
  m: CanvasMutation,
  defaultTerminalProfileId?: string
): CanvasNode[] {
  // An edge mutation addresses neither of these nodes — Canvas routes those to the edge state.
  // Returned by REFERENCE so the caller's `next === prev` short-circuit still fires (same contract
  // as `applyCanvasMutation`), rather than trusting every call site to have pre-filtered.
  if (m.op === 'edge-upsert' || m.op === 'edge-remove') return nodes
  if (m.op === 'remove') {
    if (!nodes.some((n) => n.id === m.id)) return nodes // already gone — keep identity, skip render
    return nodes.filter((n) => n.id !== m.id)
  }
  // A peer's node never brings the exec-enabling fields with it (@shared/node-exec): they are
  // per-machine settings, and letting one into the live array is exactly how it ends up harvested
  // into this machine's "trusted" workspace.json on the next save.
  const idx = nodes.findIndex((n) => n.id === m.node.id)
  // A genuinely new local terminal snapshots the receiving Windows host's current default. The
  // sender's value is stripped inside acceptNewInboundNode; Server/non-Windows callers omit the
  // optional default and retain the existing sanitize-only behavior.
  const accepted = idx === -1
    ? acceptNewInboundNode(m.node, defaultTerminalProfileId)
    : sanitizeInboundNode(m.node)
  const incoming = nodeStatesToFlow([accepted])[0]
  if (idx === -1) {
    // Append, then re-sort: React Flow requires a parent to appear BEFORE its children, and a peer
    // grouping nodes sends the new group frame and its (already present) children in one burst.
    return groupsFirst([...nodes, incoming])
  }
  const prev = nodes[idx]
  const next = nodes.slice()
  next[idx] = {
    ...incoming,
    selected: prev.selected,
    // Local-only data (initialCommand / respawnNonce / remote) is not serialized, so it
    // is not in `incoming` — carry it. Every serialized key IS present on incoming.data (as a value
    // or an explicit undefined), so the spread still applies the peer's clears.
    //
    // The exec fields are the exception: they are PER-MACHINE and simply do not participate in the
    // sync. Theirs were dropped by `sanitizeInboundNode` above; ours are carried across the upsert —
    // otherwise a peer merely DRAGGING our ssh terminal would hand it back with no jump host, and
    // the next save would erase it from our own machine-local index (@shared/node-exec).
    data: {
      ...prev.data,
      ...incoming.data,
      shell: prev.data.shell,
      terminalProfileId: incoming.data.ssh ? undefined : prev.data.terminalProfileId,
      // The peer's pending launch was stripped at ingress. Preserve the already-held local typed
      // intent exactly like the other machine-local exec fields, or a harmless peer drag would
      // silently disarm this station before its dependencies finish.
      pendingLaunch: accepted.kind === 'terminal' ? prev.data.pendingLaunch : undefined,
      ...(incoming.data.ssh && prev.data.ssh?.extraArgs
        ? {
            ssh: {
              ...incoming.data.ssh,
              extraArgs: prev.data.ssh.extraArgs,
              execTrusted: prev.data.ssh.execTrusted
            }
          }
        : {})
    }
  }
  return prev.parentId === incoming.parentId ? next : groupsFirst(next)
}
