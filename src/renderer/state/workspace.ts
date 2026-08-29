import type { Node } from '@xyflow/react'
import type { AgentLaunchIntent, BrowserTab, CanvasMutation, CanvasNodeState, ClaudeAccount, NodeKind, PendingLaunch, Project, ServiceNodeKind } from '@shared/types'
import type { SessionIcon } from '@shared/session-icon'
import type { ServiceConnection } from '@shared/node-exec'
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
import { codexSharedIdentity } from './codexIdentity'
import { sshHostKey } from '@shared/ssh'
import { useSettings } from './settings'
import type { SessionSource } from '../session/session'
import { supportsWindowsTerminalProfiles } from './terminal-profiles'
import type { AnnotationRect, AnnotationVariant } from '../lib/annotation'

// Re-exported so Canvas (and anything else in the renderer) keeps importing it from here, while the
// single implementation lives in src/shared and is shared with the relay host + the canvas-sync
// reflector.
export { applyCanvasMutation } from '@shared/canvas-mutations'
import { acceptNewInboundNode, sanitizeInboundNode } from '@shared/node-exec'

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
const VIDEO_SIZE = { width: 640, height: 420 }
const WEB_SIZE = { width: 720, height: 520 }
const BROWSER_SIZE = { width: 800, height: 560 }
const NATIVE_LOOP_SIZE = { width: 340, height: 280 }
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
  sessionIcon?: SessionIcon
  group: string | null
  tags?: string[]
  collapsed?: boolean
  /** Native persisted Loop node fields (type='scheduler'). */
  loopTask?: string
  loopIntervalMs?: number
  loopEnabled?: boolean
  loopNextRunAt?: number
  loopLastRunAt?: number
  loopTargetIds?: string[]
  /** Expanded height to restore when un-collapsing (kept out of the persisted size). */
  expandedHeight?: number
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
  filePath?: string
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
  diffStaged?: boolean
  commitOid?: string
  /** dino-only: best score reached in the T-Rex Runner game. */
  highScore?: number
  /** service-kinds only: the display name the user gave this manager. See `CanvasNodeState`. */
  serviceLabel?: string
  /** service-kinds only, MACHINE-LOCAL: where this node reaches its service. Stripped from the
   *  shared document and from inbound peers; see shared/node-exec.ts. */
  serviceConnection?: ServiceConnection
  /** nsis-only, GIT-SHARED: the installer's description. See `NsisSpec`. */
  nsisSpec?: NsisSpec
  /** nsis-only, MACHINE-LOCAL: absolute source/license/icon paths on this machine. Stripped
   *  from the shared document and from inbound peers; see shared/node-exec.ts. */
  nsisLocalPaths?: NsisLocalPaths
  /** Which agent runs in this terminal node (claude/codex/gemini/custom). */
  agentId?: AgentId
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

/** Single-quote a string for safe use as one shell argument (POSIX). */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

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

/** Account for a NEW Claude node: explicit pick, else the project default, else system. */
export function resolveNewNodeAccount(
  explicit: string | undefined,
  project: { defaultAccountId?: string } | undefined,
  accounts: ClaudeAccount[]
): string | undefined {
  const id = explicit ?? project?.defaultAccountId
  // A stale default (account since removed) must not stamp dead ids onto new nodes.
  return id && accounts.some((a) => a.id === id) ? id : undefined
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
  const { label, color, launchCmd } = resolveAgent(agentId)
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
      ...(accountId && agentId === 'claude' ? { accountId } : {}),
      // Persisted alongside the node (unlike initialCommand, which is consumed on first open), so
      // a cold restore months later still knows which conversation this node owns.
      ...(mintedSessionId ? { agentSessionId: mintedSessionId } : {}),
      ...(accountId && agentId === 'codex' ? { codexAccountId: accountId } : {}),
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

/** Creates a navigable browser node (Electron <webview>) starting at `url` ('' = blank). */
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
      ...(temporary ? { temporary: true } : {})
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
  freepbx: 'FreePBX'
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
      serviceLabel: ''
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
  sticky: true,
  group: true,
  editor: true,
  diff: true,
  video: true,
  web: true,
  browser: true,
  subagent: true,
  loop: true,
  scheduler: true,
  dino: true,
  annotation: true,
  minecraft: true,
  dockerhost: true,
  proxmox: true,
  gitlab: true,
  homeassistant: true,
  freepbx: true,
  nsis: true
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
  sticky: STICKY_SIZE,
  group: GROUP_SIZE,
  editor: EDITOR_SIZE,
  diff: DIFF_SIZE,
  video: VIDEO_SIZE,
  web: WEB_SIZE,
  browser: BROWSER_SIZE,
  // Ephemeral kinds are never persisted (they are derived from live hook events), so these are
  // defensive floors rather than values a project.json will ever carry.
  subagent: TERMINAL_SIZE,
  loop: NATIVE_LOOP_SIZE,
  scheduler: NATIVE_LOOP_SIZE,
  dino: DINO_SIZE,
  annotation: ANNOTATION_SIZE,
  minecraft: SERVICE_CONSOLE_SIZE,
  dockerhost: SERVICE_CONSOLE_SIZE,
  proxmox: SERVICE_CONSOLE_SIZE,
  gitlab: SERVICE_SUMMARY_SIZE,
  homeassistant: SERVICE_SUMMARY_SIZE,
  freepbx: SERVICE_SUMMARY_SIZE,
  nsis: NSIS_SIZE
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
      initialCommand: undefined,
      agentLaunchIntent: undefined,
      pendingLaunch: undefined,
      pendingLaunchError: undefined,
      pendingLaunchErrorKind: undefined,
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
      loopLastRunAt: undefined
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
    if (node.id === groupId || !selected.has(node.id)) return false
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
  if (!dragged || (dragged.parentId ?? null) !== parentId) return nodes
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
  if (!dragged || !before || dragged.type === 'group') return nodes

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
        title: n.title,
        // Default true for older agent nodes saved before titleAuto existed, so they start
        // tracking the session name; non-agent nodes ignore it.
        titleAuto: n.titleAuto ?? true,
        color: n.color,
        sessionIcon: n.sessionIcon,
        group: n.group,
        tags: n.tags,
        collapsed,
        expandedHeight: n.size.height,
        loopTask: n.loopTask,
        loopIntervalMs: n.loopIntervalMs,
        loopEnabled: n.loopEnabled,
        loopNextRunAt: n.loopNextRunAt,
        loopLastRunAt: n.loopLastRunAt,
        loopTargetIds: n.loopTargetIds,
        shell: n.shell,
        terminalProfileId: n.ssh ? undefined : n.terminalProfileId,
        cwd: n.cwd,
        text: n.text,
        serviceLabel: n.serviceLabel,
        serviceConnection: n.serviceConnection,
        nsisSpec: n.nsisSpec,
        nsisLocalPaths: n.nsisLocalPaths,
        filePath: n.filePath,
        fileMissing: n.fileMissing,
        url: n.url,
        browserProfileId: n.browserProfileId,
        browserTabs,
        browserActiveTabId,
        diffStaged: n.diffStaged,
        commitOid: n.commitOid,
        highScore: n.highScore,
        agentId,
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
        sessionIcon: n.data.sessionIcon,
        group: n.data.group,
        tags: n.data.tags,
        collapsed: n.data.collapsed,
        loopTask: n.data.loopTask,
        loopIntervalMs: n.data.loopIntervalMs,
        loopEnabled: n.data.loopEnabled,
        loopNextRunAt: n.data.loopNextRunAt,
        loopLastRunAt: n.data.loopLastRunAt,
        loopTargetIds: n.data.loopTargetIds,
        parentId: n.parentId,
        shell: n.data.shell,
        terminalProfileId: n.data.ssh ? undefined : n.data.terminalProfileId,
        cwd: n.data.cwd,
        text: n.data.text,
        serviceLabel: n.data.serviceLabel,
        serviceConnection: n.data.serviceConnection,
        nsisSpec: n.data.nsisSpec,
        nsisLocalPaths: n.data.nsisLocalPaths,
        filePath: n.data.filePath,
        fileMissing: n.data.fileMissing,
        url: n.data.url,
        browserProfileId: n.data.browserProfileId,
        browserTabs: n.data.browserTabs,
        browserActiveTabId: n.data.browserActiveTabId,
        diffStaged: n.data.diffStaged,
        commitOid: n.data.commitOid,
        highScore: n.data.highScore,
        agentId: n.data.agentId,
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
        annotationDir: n.data.annotationDir
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
