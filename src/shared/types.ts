import { DEFAULT_WORD_SEPARATORS } from './word-separators'
import type { ServiceConnection } from './node-exec'
import type { DockerHostManagerApi } from './docker-host-manager'
import type { NextcloudAioManagerApi } from './nextcloud-aio'
import type { NsisSpec, NsisLocalPaths } from './nsis-form-types'
// Types shared across the main, preload, and renderer processes.

import { DEFAULT_WORKTREE_PATH_TEMPLATE } from './worktree'
import type { CloneProgress } from './clone-url'
import type { KeybindingOverrides, TerminalShortcutPolicy } from './keybindings'
import type { NormalizedAgentEvent } from './agents/normalize'
import type { AgentStatusSnapshot } from './agents/status-snapshot'
import type { AgentId, AgentPermissionMode, BuiltinAgentId, PromptInjectionMode } from './agents/config'
import type { AgentMessageDeliverRequest, AgentMessageReply } from './agents/agent-messaging'
import type { AgentContinuationApi } from './agent-continuation'
import type { BrowserLeasePush } from './browser-indicator'
import type { DebugBrowserIntent, DebugBrowserProfile } from './browser-debug-sessions'
import type { GroupWorktree } from './worktree'
import type { ClientId, DinoSnapshot, PeerDiff, PeerIdentity, PeerState } from './presence'
import type { WhisperModelInfo } from './speech'
import type { ProjectKanbanGitHub } from './github-issues'
import type { ProjectIcon } from './project-icon'
import type { PortalDoorConstruction } from './portal-door'
import type { ShortcutMap } from './shortcuts'
import type { NativeCopyProjection, NativeCopyReplaceResponse } from './native-copy-projection'
import { DEFAULT_SHORTCUTS } from './shortcuts'
import { DEFAULT_FUNNY_LEVEL, type FunnyLevel, type LanguageMode } from './i18n/types'
import type { PortableDoorConstructionV3 } from './door-construction'
import type { VsCodeInstall, VsCodeOpenResult } from './vscode'
import type { HistoryFilters, HistoryListResult, HistoryRestoreResult } from './local-history'
import type { ClaudeSkillsApi } from './claude-skills'
import type { CalendarApi, CalendarNodeConfig } from './calendar'
import type { HomeAssistantApi } from './home-assistant'
import type { HomeAssistantControlApi, HomeAssistantControlConfig } from './home-assistant-control'
import type { HomeAssistantSensorApi, HomeAssistantSensorConfig } from './home-assistant-sensor'
import type {
  ToyLockBeginTotpInput,
  ToyLockBeginTotpResult,
  ToyLockConfirmTotpInput,
  ToyLockConfirmTotpResult,
  ToyLockCreatePasswordInput,
  ToyLockCreateResult,
  ToyLockRecord,
  ToyLockUpdateInput,
  ToyLockVerifyInput,
  ToyLockVerifyResult,
  ToyLockLadderState,
  ToyLockLadderVerifyInput,
  ToyLockLadderVerifyResult
} from './toylock'
import type {
  AuthenticatorAddManualInput,
  AuthenticatorAddResult,
  AuthenticatorCode,
  AuthenticatorEntry,
  AuthenticatorExportInput,
  AuthenticatorExportResult,
  AuthenticatorRenameInput,
  AuthenticatorRemoveInput,
  AuthenticatorRemoveResult,
  AuthenticatorRevealResult
} from './authenticator'
import type {
  BindManagerGroupInput,
  ChangeVaultPasswordInput,
  ChangeVaultPasswordResult,
  CreateCredentialInput,
  CreateCredentialResult,
  CreateManagerInput,
  CreateManagerResult,
  CredentialCodeResult,
  ListCredentialsResult,
  ManagerMutationResult,
  ReleaseGroupBindingResult,
  RemoveCredentialInput,
  RemoveCredentialResult,
  RenameCredentialInput,
  RenameManagerInput,
  RevealCredentialResult,
  UpdateCredentialResult,
  UpdateCredentialSecretInput,
  VaultCreateResult,
  VaultStatus,
  VaultUnlockResult
} from './password-manager'
import type { AlarmOccurrence, AlarmRecurrence } from './alarm-clock'
import type { PortableKioskPwaIntent } from './kiosk-pwa'
import type { ProjectIconPickResult } from './project-icon'
import type {
  ModelDiscoveryResult,
  ModelGatewayCredentialStatus,
  ModelGatewaySettings
} from './agents/model-gateway'

/** Profile-switch replacement intent. The trusted core validates and re-resolves it before teardown. */
export interface PtyRecycleTarget {
  profileId: string
  cwd: string
}

/**
 * A shell-independent request to start or resume an agent.
 *
 * The renderer deliberately does not turn this into a command line: the trusted core validates
 * the semantic fields, resolves the current machine-local agent configuration, and encodes the
 * launch for the concrete shell that owns the live session. In particular, `auto` is not a shell
 * dialect until immediately before a Windows profile is spawned.
 */
export type AgentLaunchIntent =
  | {
      kind: 'agent'
      action: 'start'
      agentId: AgentId
      /** Initial prompt for a new conversation. The core rejects control-bearing values. */
      prompt?: string
      /** Already version/policy-gated starting mode. The core re-validates it at execution. */
      permissionMode?: AgentPermissionMode
      /** Optional provider id minted for this first launch; never reused as a resume id. */
      newSessionId?: string
    }
  | {
      kind: 'agent'
      action: 'resume'
      agentId: AgentId
      /** Existing provider id. Required for resume and runtime-validated by the trusted core. */
      sessionId: string
      /** Starting mode for the reconstructed CLI, where the selected agent supports it. */
      permissionMode?: AgentPermissionMode
    }

/**
 * One locally-authorized launch held behind canvas dependencies.
 *
 * `shell-command` is the explicit `open-terminal --cmd` compatibility path. It is opaque shell
 * source, not something the app can safely parse back into argv. The whole PendingLaunch is
 * machine-local and must be stripped from shared project files, exports, and inbound mutations.
 */
export type TerminalLaunchIntent =
  | AgentLaunchIntent
  | { kind: 'shell-command'; command: string }

export type LaunchIntentFailureReason =
  | 'invalid-intent'
  | 'agent-unavailable'
  | 'unsupported-shell'
  | 'session-unavailable'
  | 'delivery-failed'

/** Opaque execution outcome. It must never contain a rendered command, executable, or argv. */
export type LaunchIntentExecutionResult =
  | { ok: true }
  | { ok: false; reason: LaunchIntentFailureReason; message: string }

export interface PtyCreateOptions {
  /** Stable Windows terminal profile id. The trusted core resolves its executable and argv. */
  profileId?: string
  /**
   * Shell-independent agent launch for a newly created Windows-profile session. The trusted core
   * executes it only for the fresh-create winner; warm attaches and co-attaches execute nothing.
   */
  agentLaunchIntent?: AgentLaunchIntent
  shell?: string
  /** Arguments for `shell` when it is run as the session program (e.g. ssh args). */
  shellArgs?: string[]
  cwd?: string
  cols: number
  rows: number
  /**
   * Stable key (the node id) used to derive a persistent tmux session name so the
   * terminal reattaches to the same session across remounts and app restarts.
   */
  persistKey?: string
  /**
   * The machine-local id (`IndexEntryV3.id`) of the project this node belongs to, as the renderer
   * knows it at the create call. Recorded in the runtime pane-ownership ledger on a GENUINE FRESH
   * spawn (`agents/pane-ownership.ts`) so agent messaging can prove which project actually spawned
   * a pane rather than trusting the git-shared, forgeable `project.json`. Optional: absent ⇒ the
   * pane is left unproven and messaging to it fails closed (never derived from the file id).
   */
  ownerProjectId?: string
  /**
   * Which agent runs in this session (claude/codex/gemini/custom). Drives the hook env
   * injected at spawn. Defaults to 'claude' for backward compat; the renderer passes a
   * real value in a later phase.
   */
  agentId?: AgentId
  /** Persisted builtin harness for the node's current agent association. */
  agentBaseId?: BuiltinAgentId
  /** Per-node model override. Applied through the node's base harness on launch/cold restore. */
  agentModel?: string
  /** One-shot vanilla launch: strip gateway and inherited provider environment variables. */
  clearEnv?: boolean
  /** Managed Claude account: inject CLAUDE_CONFIG_DIR for this account into the session env. */
  accountId?: string
  /** Managed Codex account: run this node against that account's shared CODEX_HOME app-server. */
  codexAccountId?: string
  /**
   * Which VIEW of the session this is, WITHIN one connection. A second view in the same renderer
   * (the kanban card modal) passes its own id so it co-attaches as an independently-detachable
   * subscriber rather than a no-op join; absent ⇒ the PRIMARY view (the canvas node) and bit-for-bit
   * the pre-viewer behavior. Invisible to peers — viewers collapse to the ClientId everywhere a
   * subscriber maps to a person.
   */
  viewerId?: string
  /** When set, this PTY runs on a remote host over the project's ssh ControlMaster, in remote tmux.
   * `remoteHome` is the connection's resolved `$HOME`, used to build an ABSOLUTE remote
   * `CLAUDE_CONFIG_DIR` for a managed remote account (tmux `-e` values are not shell-expanded). */
  sshRemote?: {
    controlPath: string
    conn: import('./ssh').SshConnection
    remoteCwd: string
    hookEndpointPath?: string
    tmuxConfPath?: string
    remoteHome?: string
    /** Host-installed NodeTerm Codex runtime. Present only after remote capability preflight. */
    codexLauncherPath?: string
    codexRelayScriptPath?: string
    codexRelayRuntimePath?: string
  }
  /**
   * This node BELONGS to a remote host: never spawn it locally.
   *
   * `sshRemote` says "here is the master to run over"; this says "and if there isn't one, spawn
   * NOTHING". Without it, a create with no `sshRemote` falls straight through to the local
   * tmux/plain-shell branches — which is how an SSH project's terminal, opened while the
   * ControlMaster was down (no network, laptop asleep, host unreachable), quietly became a LOCAL
   * shell in the local `$HOME`: same node id, same `SSH user@host` header chip, the remote
   * session's own scrollback snapshot replayed into it, and — for an agent node — a cold-restore
   * `claude --resume <remote session id>` running on the WRONG MACHINE, under the local account.
   * The refusal (`PtyCreateResult.unavailable`) is the honest answer: the node shows a
   * "not connected" overlay and re-spawns when the master is back.
   */
  requireRemote?: boolean
  /** Join an already-live session only. Foreign canvas projections are viewers, never owners, so
   * a missing target session is returned as `unavailable: 'no-session'` instead of spawning it. */
  requireExisting?: boolean
}

/** A tmux pane's cursor, as tmux reports it: 0-based column/row within the pane, plus whether the
 *  application currently wants it shown (`#{cursor_flag}`). */
export interface PaneCursor {
  x: number
  y: number
  visible: boolean
}

/**
 * Result of creating a PTY session. `fresh` distinguishes a tmux session that had to be
 * created anew (cold start — e.g. after a machine reboot killed the tmux server) from a
 * reattach to a still-running session (warm — e.g. an app restart). The renderer uses it to
 * replay the persisted scrollback and re-launch a resumable agent only on a cold start.
 */
export interface PtyCreateResult {
  sessionId: string
  fresh: boolean
  /**
   * Outcome of a fresh create's opaque agent launch, when one was requested. No rendered command
   * or private profile launch material may cross this result boundary.
   */
  agentLaunch?: LaunchIntentExecutionResult
  /** Set when the node's `accountId` had no config dir at spawn, so the session fell back to the
   *  system account. The renderer flags the account chip (folder-missing warning) when true. */
  accountFallback?: boolean
  /**
   * The CURRENT SCREEN of a session this create JOINED (co-attach), captured from tmux — write it
   * into the fresh xterm before the live stream starts.
   *
   * Only a co-attaching client ever gets it, and only when the join left the pty's grid unchanged.
   * A joiner is `fresh:false`, so it skips the cold-restore scrollback replay; the only other thing
   * that could paint its empty terminal is a tmux redraw, and tmux only redraws on SIGWINCH — i.e.
   * when the joiner is strictly SMALLER and actually resizes the pty. Equal (the expected case: the
   * node's persisted geometry and the font settings are the same on both clients) or larger resizes
   * nothing, so without this the second viewer would sit on a blank-but-live terminal until the next
   * byte of output. When the join DOES resize, this is deliberately absent: tmux paints it, and
   * painting twice would splice two points in time.
   *
   * Guaranteed non-empty when present (an empty/failed capture is omitted, exactly like `pty:resync`
   * — a plain-shell session has no tmux to capture and simply gets nothing).
   *
   * Also populated on a PLAIN (non-join) `fresh:false` create for a session-host-backed session
   * (docs/windows-session-host.md — the Windows/tmux-absent persistence backend): that backend is
   * not a "painter" the way a real tmux client is, so a warm attach gets no free redraw and must
   * carry its own seed here. The renderer needs no special case for this — `seedPaint` already
   * treats any non-empty `screen` on a `warm-attach` replay as paintable, regardless of whether it
   * arrived via a co-attach join or a plain reattach.
   */
  screen?: string
  /**
   * Where the CURSOR sits in the session that `screen` was captured from, in 0-based pane
   * coordinates, with tmux's cursor-visibility flag.
   *
   * The THIRD thing `capture-pane` does not carry, after the mouse modes below. Its output is the
   * pane's TEXT, so painting it leaves the emulator's cursor wherever the last character landed —
   * the end of the last non-blank row. That was visible as: refresh a terminal running an agent
   * CLI, and the block cursor sits at the end of the status line instead of in the input prompt,
   * until the first keystroke makes the app repaint and place it (reported 2026-08-05).
   *
   * Absent when tmux could not be asked, which the renderer treats as "leave the cursor alone" —
   * the pre-fix behaviour, and better than guessing a position.
   *
   * The coordinates are absolute in the pane, and the paint preserves that frame: the capture
   * starts at pane row 0, the renderer writes it into a terminal that is at least as tall (a
   * SMALLER joiner resizes the pty, and a resizing join gets no `screen` at all), and tmux trims
   * trailing blank rows — so nothing scrolls and pane row N is emulator row N.
   */
  cursor?: PaneCursor
  /**
   * This create JOINED a live TMUX-backed session (co-attach), so the fresh xterm must be told
   * tmux's mouse-tracking is on. tmux emits the mouse-enable DECSET sequences (`?1000h ?1002h
   * ?1006h`) to a client ONLY at its own attach — a mid-stream subscriber (the kanban card modal,
   * a second window) never sees them, and neither `screen` (`capture-pane` carries no private
   * modes) nor a SIGWINCH redraw re-emits them. Without them xterm treats the wheel as local
   * scrollback (empty on the alternate screen), so the joiner cannot scroll tmux's history until a
   * keystroke makes the app re-request mouse. The renderer writes `CO_ATTACH_MOUSE_SEQ` when this
   * is set. Since our tmux is always `mouse on` (local and remote), enabling these unconditionally
   * on a tmux-backed join matches tmux's own invariant client state; the enable is idempotent.
   * Set on BOTH join branches (screen-painted and resized) — the resize does not deliver them.
   * Absent for a plain-shell join (no tmux ⇒ no tmux mouse) and for the solo spawn path.
   */
  coAttachMouse?: boolean
  /**
   * This session is TMUX-BACKED (local or remote) — it survives losing this client, so killing our
   * pty client only detaches us and everything running in the session keeps going.
   *
   * False = the plain-shell fallback (no tmux installed, tmux switched off, or a node with no
   * persistKey): the pty IS the shell, and killing it kills the shell and every process under it —
   * an agent CLI mid-task included. The renderer needs the difference because several of its
   * levers dispose a terminal purely as a CACHE (the park window, the park LRU cap, the
   * memory-pressure drop), a call that is only cheap when tmux is underneath. See
   * `renderer/terminal/park-budget.ts` (`canDisposePark`) and issue #126.
   *
   * Absent = unknown (a core older than this field, over the relay): the renderer must then assume
   * the historical behavior (persistent), never protect on a guess.
   */
  persistent?: boolean
  /**
   * Set when the persistent backend could not even be PROBED at create time (the Windows session
   * host did not come up) and core spawned a plain, non-persistent shell instead of refusing the
   * terminal outright. Always paired with `persistent:false`. The renderer shows it as a chip
   * with a retry: the next create re-probes and warm-attaches if the host recovered.
   */
  persistenceUnavailable?: string
  /**
   * REFUSED: this node's session was permanently destroyed by ANOTHER client, so nothing was
   * spawned (`sessionId` is empty) — the terminal shows the "closed by <name>" state instead.
   *
   * This is the tombstone (PtyManager): `pty:closed` only reaches a session's SUBSCRIBERS, and a
   * co-viewer whose project is inactive or closed is not one. Without this, the create it issues
   * when it later opens that project would happily spawn a brand-new `nt-<id>` and resurrect a
   * terminal its owner deliberately deleted. The client that DID the destroy is exempt (its ⌘Z
   * must still restore the node), so the single-user delete→undo path is unchanged.
   */
  closed?: { by: number | null }
  /**
   * REFUSED: `requireRemote` was set and no remote spawn was possible (no live ControlMaster, or
   * no `ssh` executable), so nothing was spawned (`sessionId` is empty) — see
   * `PtyCreateOptions.requireRemote` for what used to happen instead. The renderer shows the
   * "not connected" overlay and re-spawns the node once the project's master is back.
   *
   * Only ever set for a create that would have SPAWNED: a co-attach to a live session for this
   * node id still joins (the session is already running wherever it runs), so a second view of a
   * healthy remote terminal is unaffected.
   *
   * `'codex-account'` is the S6 fail-closed twin: a LOCAL Codex node that explicitly selected a
   * managed account whose home is missing refuses rather than spawning against the system login
   * (§5 property 4). Same contract — nothing spawned, the renderer shows the node's refusal.
   */
  /** Refusal for a foreign projection that had no live session to join. */
  unavailable?: 'ssh' | 'codex-account' | 'no-session'
}

/** Payload of `pty:recycled` — see IPC.ptyRecycled and `recycleAction` in the renderer. */
export interface RecycledInfo {
  /** A replacement session is registered for the node: restart onto it. False = the escape-hatch
   *  timeout fired with no replacement (the recycler died mid-move) → do NOT respawn. */
  ready: boolean
}

// 'subagent' and 'loop' are render-only (ephemeral hook-driven viz) and never persisted.
// 'scheduler' is the user-created, persisted NodeTerm Loop; the internal name avoids colliding
// with the existing derived agent card.
// 'annotation' is pure decoration — a free-standing line/arrow drawn on the canvas (issue #145).
// It is a NODE, never an Edge: unlike a bridge (context link), a rope (spawn lineage) or a
// dependency edge, it carries no `source`/`target` referencing another node and cannot be
// connected to anything, which is what keeps it structurally impossible to mistake for a link
// that changes what an agent can read. See src/renderer/lib/annotation.ts and AnnotationNode.tsx.
export type NodeKind =
  | 'terminal'
  | 'sticky'
  | 'group'
  | 'editor'
  | 'diff'
  | 'photo'
  | 'gallery'
  | 'wild-dim-sum'
  | 'video'
  | 'photo'
  | 'audio'
  | 'gallery'
  | 'web'
  | 'browser'
  /** A persisted canvas node showing one directory listing. */
  | 'files'
  | 'subagent'
  | 'loop'
  | 'scheduler'
  | 'dino'
  | 'recovery-game'
  | 'annotation'
  // A permanent catalog surface owned by each Multiverse or AWS Universe child canvas. Shop is
  // intentionally a distinct kind so the canvas can refuse deletion, duplication, grouping, and
  // cross-universe movement at every mutation boundary.
  | 'shop'
  // AWS Universe portal. The portal is a safe project intent and never carries provider state.
  | 'aws-universe'
  // Guided Resource Explorer and Cloud Control manager. Only safe operation intent is portable.
  | 'aws-resource'
  // Portal into the machine-owned UniGetUI Global Universe. It carries no package-manager state.
  | 'unigetui'
  // A GUI for authoring a Windows NSIS installer script for ANOTHER project (not this app's
  // own installer, which stays Squirrel.Windows — see CLAUDE.md's Packaging section). See
  // `NsisSpec`/`NsisLocalPaths` in `./nsis-form-types` for the shared-vs-machine-local split.
  | 'nsis'
  // The built-in authenticator, as a node. A VIEW of this machine's own TOTP generators: it
  // persists a title and a colour and nothing else, because an entry id names a credential in
  // this machine's OS vault while project.json is git-shared. See AuthenticatorNode.tsx.
  | 'authenticator'
  | 'converter'
  // A portable calendar view. Provider credentials and event cache stay in the core vault/local
  // data, while this node carries only safe selection intent.
  | 'calendar'
  | 'homeassistant-control'
  | 'timer'
  // Alarm Clock nodes persist wall-clock intent and occurrence history. Runtime timers and
  // notification handles stay machine-local; a shared project never claims powered-off wake.
  | 'alarm'
  /** Persisted schedule definition whose execution still requires machine-local consent. */
  | 'trigger'
  // The SERVICE family: one node per external thing this canvas can manage. They are ordinary
  // nodes — dragged, resized, coloured, grouped, persisted and deleted exactly like a terminal —
  // because a managed service is a thing you arrange on a canvas beside the terminals working on
  // it, not a modal you visit.
  //
  // Every one of them is a MANAGER, and for `proxmox` that is not a limitation but the only
  // coherent reading: Proxmox VE is a bare-metal hypervisor distribution, so there is nothing to
  // install from a right-click and the node drives an instance that already exists.
  //
  // What they deliberately do NOT persist is how to reach anything. A node's `data` is written into
  // `.nodeterm/project.json`, which is git-shared and travels to every machine that clones the
  // repository, so a host, a username, a container id or an executable path in there would be one
  // person's machine leaking into everybody else's checkout. Only `serviceLabel` — a display name
  // the user chose — is persisted here. The connection record is machine-local and belongs beside
  // `localExec` on the index entry; see `IndexEntryV3` and `projectToFile`.
  | 'minecraft'
  | 'dockerhost'
  | 'proxmox'
  | 'gitlab'
  | 'gitlab-hosting'
  | 'homeassistant'
  | 'homeassistant-sensor'
  | 'freepbx'
  | 'open-webui-hosting'
  | 'cloudflare-tunnel'
  | 'awsidentity'
  | 'nextcloud-aio'
  /** Managed Nextcloud profile with PostgreSQL, Redis, and no container-runtime socket. */
  | 'nextcloud-managed'
  | 'cloudflare-zero-trust'
  /** Guided Cloudflare account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics manager. */
  | 'cloudflare-core-managers'
  | 'torrent'
  /** One-shot Linux ISO virtual machine, distinct from the WSL terminal profile. */
  | 'linux-vm'
  | 'github-work-item'
  /** Read-only Windows host diagnostics, with no mutation controls. */
  | 'windows-diagnostics'
  /** Desktop-only manager for existing file-hosted VeraCrypt containers. */
  | 'veracrypt'
  /** Project-scoped source and dependency graph, with host-local derived state. */
  | 'repository-graph'

/**
 * The service kinds, as a runtime list. Exported because both the renderer (menu rows, one shared
 * component) and any future core service need to agree on the membership, and two copies of a list
 * like this drift — the failure this repository has recorded more than once.
 */
export const SERVICE_NODE_KINDS = [
  'minecraft',
  'dockerhost',
  'proxmox',
  'gitlab',
  'homeassistant',
  'freepbx',
  'cloudflare-tunnel',
  'awsidentity',
  'cloudflare-zero-trust',
  'nextcloud-aio',
  'nextcloud-managed',
  'cloudflare-core-managers'
] as const

/** The portable canvas scopes that may be nested below a project root. */
export type CanvasScope = 'root' | 'multiverse' | 'aws-universe'

/** A door's direction is part of the persisted contract, not inferred from its label. */
export type PortalDoorDirection = 'entry' | 'return'

/**
 * Safe, portable identity of one portal door. The pair id is deliberately shared by the two
 * physical doors, while each door names the canvas it opens. No host, credential, process, or
 * browser state belongs here.
 */
export interface PortalDoor {
  doorPairId: string
  direction: PortalDoorDirection
  targetCanvasId: string
}

/** A child canvas carried by a project file and by schema 3 portable projection. */
export interface ProjectCanvas {
  id: string
  scope: CanvasScope
  parentCanvasId: string
  title: string
  order: number
  viewport?: Viewport
  entryDoorPairId?: string
  returnDoorPairId?: string
}

/** The local navigation snapshot. It is safe to persist in a portable projection, but the live
 * controller always returns to root on application relaunch rather than reopening a child behind a
 * missing door interaction. */
export interface PortalNavigationSnapshot {
  currentCanvasId: string
  parentCanvasId?: string
  entryDoorNodeId?: string
  returnDoorNodeId?: string
  parentViewport?: Viewport
  parentFocusNodeId?: string
  /** Parent frames, oldest first, so nested special canvases unwind door-by-door. */
  trail?: PortalNavigationFrame[]
}

export interface PortalNavigationFrame {
  canvasId: string
  entryDoorNodeId?: string
  returnDoorNodeId?: string
  viewport?: Viewport
  focusNodeId?: string
}

export type ServiceNodeKind = (typeof SERVICE_NODE_KINDS)[number]

/** True when `kind` is one of the service family. A `Set` rather than `in`, for the same reason
 *  `NODE_KINDS` is: `in` walks the prototype chain and would accept `'constructor'`. */
const SERVICE_NODE_KIND_SET: ReadonlySet<string> = new Set(SERVICE_NODE_KINDS)
export function isServiceNodeKind(kind: string | undefined): kind is ServiceNodeKind {
  return typeof kind === 'string' && SERVICE_NODE_KIND_SET.has(kind)
}

/** Persisted state of a single canvas node (terminal, sticky note, group frame, or editor). */
/**
 * A launch a terminal node OWES once every station in `after` has gone idle — what the
 * canvas-control `--after` flag arms instead of running the command on open. This is the
 * difference between a fan-out and a graph: a downstream station starts when the upstream
 * ones have produced something for it to read, without an orchestrator sitting in a poll loop.
 *
 * Persisted only in the trusted machine-local execution overlay, because the wait can outlive an
 * app restart. It is stripped from the shared project document and every peer boundary. Agent
 * state is rebuilt from live hook events, so after a restart an armed node may not learn that its
 * deps already finished; the manual "run now" escape keeps that station recoverable.
 */
export interface PendingLaunch {
  /**
   * Node ids to wait for. Only nodes running a hook-reporting agent may appear here — a plain
   * terminal never reports `done`, so waiting on one would stall forever (refused at creation).
   * A dep that no longer exists counts as satisfied: a deleted node can never report.
   */
  after: string[]
  /**
   * Machine-local idempotency key. The core deduplicates it within one live PTY generation so an
   * IPC retry or duplicate renderer effect cannot submit the launch twice.
   */
  launchId: string
  /** Executed once the wait is over. This whole record is machine-local execution state. */
  launch: TerminalLaunchIntent
  /** Delivered to the node's shell once the wait is over (agent CLI + prompt, or a plain command). */
  command?: string
  /**
   * Also wait for this worktree GROUP's project setup script to finish (`waitForSetup`). Set when
   * the node is opened into a frame whose checkout is still being prepared — running a command in a
   * half-installed worktree is the failure this gate exists to prevent. It names a group id, never
   * a command: nothing here is ever executed, it only selects a run to ask about.
   *
   * A group with no run on record counts as done (`launchesToFire`), so a persisted arming that
   * outlives the run's event stream — an app restart — releases rather than strands the node.
   */
  awaitSetupGroup?: string
}

/** Portable media metadata attached to a canvas node. Source is an opaque reference, never a path. */
export interface MediaAssetReference {
  assetId: string
  kind: 'image' | 'audio' | 'video'
  displayName: string
  extension?: string
  sha256?: string
  bytes?: number
  source?: 'archive' | 'local' | 'ssh'
  resolution?: 'unresolved' | 'available' | 'missing' | 'invalid'
}

export interface CanvasNodeState {
  id: string
  kind: NodeKind
  /** Immutable idempotency key for the user or automation event that created this node. */
  /** Immutable creation event key used to deduplicate retries and peer insertion. */
  creationEventId?: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  title: string
  /**
   * Agent nodes only: while true (the default), the node title auto-tracks the agent's own
   * session name. Set false once the user renames the node by hand, so we stop overwriting it
   * and instead push the user's name back to the agent via `/rename`. Persisted.
   */
  titleAuto?: boolean
  color: string
  /** Optional bounded local identity mark for this session. */
  sessionIcon?: SessionIcon
  group: string | null
  /** Universe ownership for special-universe nodes. Safe display intent only, never credentials. */
  universeCanvasId?: string
  /** Scope of the owning universe canvas. The root canvas is never a Shop scope. */
  universeScope?: 'multiverse' | 'aws-universe'
  /** Safe portal intent for the machine-owned UniGetUI Global Universe. */
  unigetuiGlobal?: boolean
  /** Real persisted depth of the owning universe canvas, with its root at depth 0. */
  universeDepth?: number
  /** True for the deterministic Shop node. Persisted as an invariant marker, not a security claim. */
  nonDeletable?: boolean
  /** Last safe catalog selection shown by a Shop, never a provider or execution binding. */
  shopSelection?: string
  /** Labels for organizing/filtering terminals. */
  tags?: string[]
  /** When true the node body is hidden (header-only). */
  collapsed?: boolean
  /** User-chosen session mark, validated at both project-file serializer seams. */
  icon?: import('./node-icon').NodeIcon
  /** scheduler-only: prompt delivered through the persistent inter-agent mailbox. */
  loopTask?: string
  /** scheduler-only: fixed cadence in milliseconds. */
  loopIntervalMs?: number
  /** scheduler-only: paused=false/running=true. */
  loopEnabled?: boolean
  /** scheduler-only: absolute local wall-clock instants. */
  loopNextRunAt?: number
  loopLastRunAt?: number
  /** scheduler-only: exact agent node ids receiving each fire. */
  loopTargetIds?: string[]
  /** timer-only persisted state, validated and bounded by shared/timer.ts. */
  timerMode?: import('./timer').TimerMode
  timerDurationMs?: number
  timerRemainingMs?: number
  timerElapsedMs?: number
  timerRunning?: boolean
  timerPaused?: boolean
  timerRepeatCount?: number
  timerRepeatRemaining?: number
  timerSequence?: import('./timer').TimerSequenceStep[]
  timerSequenceIndex?: number
  timerLapsMs?: number[]
  timerNextOccurrenceAt?: number
  timerOccurrenceId?: string
  timerOccurrenceState?: import('./timer').TimerOccurrenceState
  timerAlarmEnabled?: boolean
  timerAlarmTone?: import('./timer').TimerNodeData['alarmTone']
  timerMissedCount?: number
  /** Legacy-compatible timer payload keys retained for renderer node data round-trips. */
  durationMs?: number
  remainingMs?: number
  elapsedMs?: number
  running?: boolean
  paused?: boolean
  repeatCount?: number
  repeatRemaining?: number
  sequence?: import('./timer').TimerSequenceStep[]
  sequenceIndex?: number
  lapsMs?: number[]
  nextOccurrenceAt?: number
  occurrenceId?: string
  occurrenceState?: import('./timer').TimerOccurrenceState
  alarmEnabled?: boolean
  alarmTone?: import('./timer').TimerNodeData['alarmTone']
  missedCount?: number
  /** alarm-only: local wall-clock schedule, timezone, and durable occurrence history. */
  alarmSchedule?: { recurrence: AlarmRecurrence; date?: string; time: string; weekdays?: number[]; monthDay?: number }
  alarmTimeZone?: string
  alarmSnoozeMinutes?: number
  alarmSoundEnabled?: boolean
  alarmNarratorEnabled?: boolean
  alarmNextOccurrenceAt?: number
  alarmHistory?: AlarmOccurrence[]
  /** trigger-only: shared schedule and payload definition. Machine-local arm consent is separate. */
  trigger?: import('./trigger').TriggerSpec
  /** Agent nodes only: when true, this node's subagent/loop fan-out cards are hidden. */
  hideFanout?: boolean
  /** Parent group node id, if this node belongs to a group frame. */
  parentId?: string
  /** Safe display intent for a group that drills into another open project. */
  projectRef?: { projectId: string }
  // terminal-only
  /** Machine-local Windows terminal profile selection; never execution arguments. */
  terminalProfileId?: string
  /** Machine-local named profile selection; its path and command never enter project files. */
  namedTerminalProfileId?: string
  shell?: string
  cwd?: string
  /** Which agent runs in this terminal node (claude/codex/gemini/custom). */
  agentId?: AgentId
  /** Persisted builtin harness for a custom agent, retained if its registry record is removed. */
  agentBaseId?: BuiltinAgentId
  /** Model selected for this agent node through the shared model gateway. */
  agentModel?: string
  /** One-shot flag for the next fresh spawn to use the agent's default provider environment. */
  clearEnv?: boolean
  /** Set while this node is armed but not yet launched — see PendingLaunch. */
  pendingLaunch?: PendingLaunch
  /**
   * Claude-only: managed account this node runs on (CLAUDE_CONFIG_DIR injection).
   * Resolved once at node creation (explicit pick → project default → system default)
   * and immutable for the node's lifetime. Undefined = system default (~/.claude).
   */
  accountId?: string
  /**
   * True only for a managed-account login terminal; false for a known ordinary terminal.
   * Persisted because titles are user-editable and `initialCommand` is one-shot, so neither is a
   * safe lifetime identity for deciding which session must close with a removed account.
   * Undefined is accepted only for legacy workspaces and is migrated on load.
   */
  accountLogin?: boolean
  /**
   * Agents in `SESSION_ID_CAPABLE` (claude): the session id nodeterm minted and launched this
   * node's CLI with (`--session-id`). Persisted so a cold restore can resume even when no hook
   * ever delivered an id — the SSH reverse tunnel is the only path that carries one, and a node
   * whose tunnel was down came back as a blank conversation with its transcript intact on disk.
   * The hook-fed id still wins when known: `/clear` and `--fork-session` mint a new one in-CLI.
   */
  agentSessionId?: string
  /** Codex-only managed account. Undefined uses the system ~/.codex account. */
  codexAccountId?: string
  /** When set, the terminal runs `ssh` to this host on the local PTY; persisted (auto-reconnects). */
  ssh?: import('./ssh').SshConnection
  /** When true (SSH-project terminals), the node runs in REMOTE tmux on `ssh` rather than `ssh`-on-local-PTY. */
  sshRemoteTmux?: boolean
  /** editor-only: when true (SSH-project editors), reads/writes go to the project's remote fs via `sshFs`. */
  sshFs?: boolean
  // sticky-only
  text?: string
  /**
   * sticky-only: last canvas-control `sticky` write — when, and the title of the agent node that
   * wrote it. The stamp means "an agent synced this", not "last touched": a hand edit clears both,
   * so a stale stamp can never vouch for text the user has since rewritten.
   */
  textUpdatedAt?: number
  textUpdatedBy?: string
  // dino-only: best score reached in the T-Rex Runner game.
  highScore?: number
  /** recovery-game-only: bounded portable progress with no process, account, or host state. */
  recoveryGame?: import('./recovery-game').RecoveryGameSnapshot
  /**
   * service-kinds only: the display name the user gave this manager ("Home lab Proxmox", "Survival
   * server"). This is the ONLY thing a service node persists, and the restraint is deliberate — the
   * record travels in `.nodeterm/project.json` to every machine that clones the repository, so a
   * host, a username, a container id or a token here would be one person's environment appearing in
   * everybody else's checkout. The connection itself is machine-local and belongs beside
   * `localExec` on the index entry, exactly where the shell and Windows profile already live.
   */
  serviceLabel?: string
  /** Open WebUI provider and port intent safe to share in schema 3 project files. */
  openWebUiIntent?: import('./open-webui-hosting').OpenWebUiIntent
  /** Open WebUI container and provider binding kept only in the machine-local index. */
  openWebUiLocalBinding?: import('./open-webui-hosting').OpenWebUiLocalBinding
  /** AWS-only portable requirements. Profile/account/role/endpoints remain machine-local. */
  awsIdentityIntent?: import('./aws-identity').AwsIdentityIntent
  /** AWS-only machine binding, stripped into IndexEntryV3.localExec by shared/node-exec.ts. */
  awsIdentityBinding?: import('./aws-identity').AwsIdentityBinding
  /** Nextcloud AIO safe deployment intent. Context, container state, backups, and socket bindings remain local. */
  nextcloudAioConfig?: import('./nextcloud-aio').NextcloudAioConfig
  /** Managed Nextcloud safe project intent; its destination binding and secret keys stay local. */
  nextcloudManagedIntent?: import('./nextcloud-managed').NextcloudManagedIntent
  /** Machine-local destination and vault-key bindings for the managed Nextcloud profile. */
  nextcloudManagedBinding?: import('./nextcloud-managed').NextcloudManagedBinding
  /** Cloudflare manager selection intent. Account ids, credentials and resource ids stay local. */
  cloudflareZeroTrustIntent?: import('./cloudflare-zero-trust').CloudflarePortableIntent
  /** Cloudflare manager safe intent. Credentials and local bindings stay in the host overlay. */
  cloudflareCoreIntent?: import('./cloudflare-core-managers').CloudflarePortableIntent
  /** Cloudflare Tunnel route intent. Local observations and provider bindings stay outside project data. */
  cloudflareTunnelIntent?: import('./tunnel-state').TunnelPortableIntent | import('./cloudflare-tunnel-handoff').CloudflareTunnelIntent
  /** Home Assistant node presentation intent safe for schema 3. Hosts, instance ids, credentials,
   *  sessions, and entity caches stay in the machine-local service and binding overlay. */
  homeAssistantIntent?: import('./home-assistant').HomeAssistantNodeIntent
  /** GitLab hosting intent. Docker context, container, volumes, credentials, and process state stay local. */
  gitlabHostingConfig?: import('./gitlab-hosting').GitLabHostingConfig
  /** torrent-only: safe display intent shared with the canvas; task state and paths stay local. */
  torrentMagnet?: string
  /** AWS manager safe operation intent. Profiles, endpoints, results, and credentials stay local. */
  awsManagerIntent?: import('./aws-resource').AwsManagerPortableIntent
  /** Guided AWS manager operation intent, separate from the older Resource Explorer intent. */
  awsResourceManagerIntent?: import('./aws-resource-managers').AwsResourceManagerIntent
  /** Linux ISO VM settings stored in the shared project projection. */
  virtualMachineConfig?: import('./virtual-machine').VirtualMachineConfig
  /** Linux ISO/disk selections stored only in the machine-local execution overlay. */
  virtualMachineLocalPaths?: import('./virtual-machine').VirtualMachineLocalPaths
  githubWorkItem?: import('./github-work-items').GitHubWorkItem
  /** Compact issue and pull-request attachments owned by this node. */
  githubWorkItems?: import('./github-work-items').GitHubWorkItem[]
  /**
   * service-kinds only, and MACHINE-LOCAL: where this node reaches its service. Stripped from
   * every project file we write and from every node arriving over the wire, then restored from the
   * machine-local index — the same round trip `shell` and `ssh.extraArgs` take, for the same
   * reasons. It never carries a secret; see `ServiceConnection` in shared/node-exec.ts.
   */
  serviceConnection?: ServiceConnection
  /** cloudflared-only machine-local runtime choice; the connector token remains in a protected file. */
  cloudflaredSettings?: import('./cloudflared').CloudflaredRuntimeSettings
  /**
   * nsis-only, GIT-SHARED: the installer's description (app name, version, publisher, output
   * filename, install root, shortcut/uninstaller/compression choices). Nothing here names a
   * location on the local disk — see `NsisSpec`'s own doc comment for the shared/local split.
   */
  nsisSpec?: NsisSpec
  /**
   * nsis-only, MACHINE-LOCAL: absolute source/license/icon paths on THIS machine. Stripped from
   * every project file we write and from every node arriving over the wire, then restored from
   * the machine-local index — the identical round trip `serviceConnection` takes, for the
   * identical reason (an absolute path is one person's disk layout). See `@shared/node-exec`.
   */
  nsisLocalPaths?: NsisLocalPaths
  /** calendar-only, GIT-SHARED safe intent. Tokens, provider sessions, paths and event cache stay
   * in the machine-local calendar service. */
  calendarConfig?: CalendarNodeConfig
  /** Home Assistant control-only portable selection intent. Local connection identity, URL,
   * bearer, discovery cache and request state never enter project data. */
  homeAssistantControlConfig?: HomeAssistantControlConfig
  /** Home Assistant sensor-only, project-portable selection and presentation intent. Instance
   * URLs, credentials, observed values, and history remain machine-local. */
  homeAssistantSensorConfig?: HomeAssistantSensorConfig
  // editor / diff
  filePath?: string
  /** Photo/video/gallery media is represented by a portable content reference, never an absolute path. */
  mediaAssets?: import('./media-catalog').MediaAssetReference[]
  /** Gallery selection is an ordered list of asset ids. */
  mediaActiveAssetId?: string
  /** Wild dim sum only: portable public-catalog identity and display copy, never image bytes or cache state. */
  wildDimSumDish?: import('./public-dim-sum').PublicDimSumSelection
  /**
   * editor/diff-only: true once `filePath` was confirmed gone (e.g. its worktree was removed —
   * see `displacedByWorktree` in `./worktree.ts`). There is nothing to re-point the node at, so
   * it shows a persistent notice instead of silently opening blank / failing a `git show`.
   */
  fileMissing?: boolean
  /** web-only: when set, the web node loads this live URL (else it loads `filePath` as local html). */
  url?: string
  /**
   * browser-only: which of the project's `browserProfiles` (see `Project.browserProfiles`) this
   * node's webview session uses. Undefined = the app's default (unpartitioned) session — the
   * pre-feature behavior, and the default for every new browser node until the user picks one.
   * References `BrowserProfile.id`; a dangling reference (profile since removed) still derives a
   * stable partition — see `browserPartitionFor` — so the node keeps its own isolated cookie jar
   * rather than silently falling back to the default session's. User-changeable at any time from
   * the node's profile picker (unlike `accountId`, which is immutable) — the webview remounts
   * onto the new partition when it changes.
   */
  browserProfileId?: string
  /**
   * browser-only: the node's open tabs. Project content (git-shared) — a tab's URL/title are not
   * secrets; cookies/localStorage stay in the Electron partition (`browserProfileId`) and are
   * never mirrored here. Absent/empty on a legacy node = migrate the single `url`/`title` pair
   * into a one-tab array (done once by `nodeStatesToFlow`, never persisted back until the user
   * actually edits a tab).
   */
  browserTabs?: BrowserTab[]
  /** browser-only: which `browserTabs[].id` is currently shown. Absent = the first tab. */
  browserActiveTabId?: string
  /** Kiosk/PWA sessions carry only safe launch intent; profile and runtime state stay local. */
  kioskPwaIntent?: PortableKioskPwaIntent
  /** Debugging-browser intent only. Certificates, credentials, executable paths and process state stay local. */
  debugBrowser?: DebugBrowserIntent
  /** browser-only: the Electron session partition for an AGENT-opened browser node
   * (`persist:nt-agent-browser-<projectId>`), set once at creation and never mutated. Absent for a
   * USER-opened node (default session, no migration). Persisted so the jar survives reopen; carried
   * through untouched on Server Edition / mobile, where a browser node renders with no <webview>.
   */
  partition?: string
  /** diff-only: true = staged diff (HEAD vs index), false = unstaged (index vs working). */
  diffStaged?: boolean
  /** diff-only: when set, the diff shows parent (<oid>^) vs commit (<oid>) for a file from history. */
  commitOid?: string
  /** group-only: when bound, the git worktree this group works in. */
  worktree?: GroupWorktree
  /** annotation-only: 'line' has no arrowhead, 'arrow' has one at its end point. Pure decoration —
   *  carries no relationship to any other node (see the NodeKind doc comment above). */
  annotationVariant?: 'line' | 'arrow'
  /** annotation-only: which corner-to-corner diagonal of the node's box the line/arrow follows —
   *  'tl-br' runs top-left→bottom-right, 'tr-bl' runs top-right→bottom-left. Recomputed by
   *  `annotationRectFromPoints` (src/renderer/lib/annotation.ts) from the draw gesture; unaffected
   *  by a later resize, which just stretches the same diagonal to the new box. */
  annotationDir?: 'tl-br' | 'tr-bl'
  /** annotation-only: optional user-authored label rendered beside the stroke. */
  annotationLabel?: string
  /** annotation-only: bounded SVG stroke width in the node's local px space. */
  annotationThickness?: number
  /**
   * Set while the node is maximized to fill the viewport (issue #399): the rect to give back on
   * the toggle's second click — the node's ROOT-space (absolute canvas) position plus its size.
   * Absent = not maximized. Persisted so the restore survives a reload. Root-space on purpose:
   * maximizing a grouped node re-fits (and thereby moves) its frame, so a parent-relative rect
   * would restore a few px off — and root-space also survives the frame being ungrouped meanwhile.
   */
  premaxRect?: { x: number; y: number; width: number; height: number }
}

/**
 * A snapshot of one canvas's nodes in the form sent over the remote mirror wire.
 * Reuses the persisted node shape (`CanvasNodeState`) so host and client agree on layout.
 */
export interface CanvasState {
  nodes: CanvasNodeState[]
}

/**
 * A minimal change to a canvas node list: replace-or-append a node by id, or drop one by id.
 * Used for the client's optimistic edits and host-side diffing (see `applyMutation`/`diffToMutations`).
 *
 * `src` and `seq` exist ONLY on the team canvas-sync path (`canvas:mut`), and they are what makes
 * two people editing one node CONVERGE instead of splitting brain (see src/shared/canvas-order.ts):
 *  - `src` is stamped by the sending client's publisher — a random per-Canvas tag, so a client can
 *    recognize its OWN mutation coming back (the reflector echoes to everyone, sender included:
 *    that echo is the ACK that tells the sender where its edit landed in the total order).
 *  - `seq` is stamped by the reflector (src/core/canvas-sync.ts) and is the TOTAL ORDER. It is
 *    server-authoritative: a client-supplied `seq` is overwritten at ingest, never trusted.
 *  - `seen` is the sender's CAUSAL stamp: the highest `seq` it had applied at the moment it cast.
 *    It answers the one question `seq` alone cannot — "did this client already know about the
 *    delete?" — which is what lets a delete beat a concurrent drag frame instead of being
 *    resurrected by it (canvas-order's rule 4). Client-supplied, so the reflector BOUNDS it
 *    (it can never legitimately reach the order it is being given); a mutation without it is
 *    judged exactly as before, so an unstamped peer degrades rather than breaks.
 * The relay's host↔client mirror (src/main/remote) uses the same vocabulary and simply omits them.
 */
export type CanvasMutation =
  | { op: 'upsert'; node: CanvasNodeState; src?: string; seq?: number; seen?: number }
  | { op: 'remove'; id: string; src?: string; seq?: number; seen?: number }
  | {
      op: 'edge-upsert'
      kind: CanvasEdgeKind
      edge: BridgeLink
      src?: string
      seq?: number
      seen?: number
    }
  | { op: 'edge-remove'; kind: CanvasEdgeKind; id: string; src?: string; seq?: number; seen?: number }

/**
 * Which persisted edge list a mutation addresses — `bridges` (context links, which an agent can
 * actually READ through) or `ropes` (display-only "spawned by" lineage). They are two arrays on
 * the project with two different meanings, so the kind travels with the mutation; the ORDER,
 * however, is keyed on the edge id alone (canvas-order's `e:<id>`), because one id is one edge and
 * two clients must never end up holding it as both a bridge and a rope.
 */
export type CanvasEdgeKind = 'bridge' | 'rope'

/** Canvas pan/zoom state. */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** A persistent "bridge" link between two Claude nodes (lets their sessions message each other). */
export interface BridgeLink {
  id: string
  source: string
  target: string
}

/**
 * One endpoint of a typed Link. The ref discriminator keeps endpoint handling exhaustive and
 * avoids inferring meaning from legacy id prefixes.
 *
 * A node endpoint names a node in the project that owns the link. An xnode endpoint names a node
 * in another project without copying that node. A branch endpoint names a git branch for links
 * that model branch relationships.
 */
export type Endpoint =
  | { ref: 'node'; nodeId: string }
  | { ref: 'xnode'; projectId: string; nodeId: string }
  | { ref: 'branch'; repoPath: string; branch: string }

/** The persisted kind discriminator for the unified link model. */
export type LinkKind = 'context' | 'lineage' | 'dependency'

/** A typed link between two endpoints. */
export interface Link {
  id: string
  kind: LinkKind
  source: Endpoint
  target: Endpoint
  /** Optional kind-specific metadata, such as display-only or note information. */
  meta?: Record<string, unknown>
}

/**
 * A named browser profile for one project. Browser nodes assigned to the same profile id share
 * that profile's cookies/localStorage/session state (an isolated Electron session partition
 * derived from `projectId + profileId` — see `shared/browser-profiles.ts`); nodes on different
 * profiles are isolated from each other. The profile's NAME is shareable (it rides
 * `Project.browserProfiles` into the git-shared project file, like `KanbanColumn.title`); the
 * cookie jar itself is not — it lives only in this machine's Electron partition storage and is
 * never persisted or exported here.
 */
export interface BrowserProfile {
  id: string
  name: string
  color: string
}

/**
 * One tab in a browser node's tab strip. Project content (git-shared, see `BrowserProfile`'s doc
 * comment above) — the URL and title are not secrets. What is NOT here on purpose: cookies,
 * localStorage, session state — those stay in the node's Electron partition
 * (`CanvasNodeState.browserProfileId`) and are never duplicated into the project file.
 */
export interface BrowserTab {
  id: string
  url: string
  title: string
}

/** Named debugging-browser profiles. Only safe proxy and certificate intent is shared. */
export type { DebugBrowserIntent, DebugBrowserProfile } from './browser-debug-sessions'

/** One kanban board column. Column order = array order in ProjectKanban.columns. */
export interface KanbanColumn {
  id: string
  title: string
  color: string
}

/** Assignment of one session node to a board column. A session with no assignment sits
 *  in the virtual Ungrouped column (never persisted). Order within a column = relative
 *  order in ProjectKanban.assignments. */
export interface KanbanAssignment {
  nodeId: string
  columnId: string
}

/** Per-project kanban board (docs/superpowers/specs/2026-07-18-kanban-view-design.md).
 *  Absent = never edited: the renderer shows a default 3-column board and writes
 *  nothing until the first change. Cards are the project's session nodes — the board
 *  stores only their column assignments. */
/** Trello-style per-card metadata. Lives beside the assignments (not on the node) so it rides
 *  the same git/mirror machinery; absent entries mean "no metadata". Assignee identity is the
 *  presence identity — the same {name, color} the board log attributes comments to. */
export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface KanbanCardMeta {
  nodeId: string
  assignees?: BoardLogAuthor[]
  /** Due timestamp (ms). Absent = no due date. */
  dueAt?: number
  /** Absent = no priority. */
  priority?: KanbanPriority
  /** Ids of the board labels applied to this card (see ProjectKanban.labels). Absent/empty = none;
   *  ids that no longer resolve to a label are dropped by readers (dangling-safe). */
  labels?: string[]
}

/** The Notion label palette. A closed set so the chip colors and the picker can't desync; an
 *  unknown value read from a hand-edited file falls back to 'default'. */
export type KanbanLabelColor =
  'default' | 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'

/** A board-level label (Notion-style): defined once per board, applied to any number of cards by
 *  id (KanbanCardMeta.labels). Order in ProjectKanban.labels is the palette's display order. */
export interface KanbanLabel {
  id: string
  name: string
  color: KanbanLabelColor
}

export interface ProjectKanban {
  columns: KanbanColumn[]
  assignments: KanbanAssignment[]
  /** Optional card metadata; tolerated as absent/malformed by every reader (lib normalizes). */
  meta?: KanbanCardMeta[]
  /** Board-level label palette (Notion-style). Cards reference these by id in `meta[].labels`;
   *  tolerated as absent/malformed by every reader. */
  labels?: KanbanLabel[]
  /** Shared, non-secret GitHub issue label mapping. Local approval and credentials live elsewhere. */
  github?: ProjectKanbanGitHub
}

/** Who produced a board-log entry (a teammate on a shared board, or this user). */
export interface BoardLogAuthor {
  name: string
  color: string
}

/** A structural board change worth recording. `type` is closed; the optional fields carry
 *  the human-readable names resolved at event time (the virtual column is named 'Ungrouped'). */
export interface BoardLogEvent {
  type:
    | 'card-created'
    | 'card-moved'
    | 'column-added'
    | 'column-renamed'
    | 'column-deleted'
    | 'member-assigned'
    | 'member-unassigned'
    | 'due-set'
    | 'due-cleared'
    | 'priority-set'
    | 'priority-cleared'
    /** An agent-to-agent message delivery. `from`/`to` are NODE IDS (not column names) and `title`
     *  is the delivery's outcome kind — a trace that cannot answer "did it land?" answers the only
     *  question anyone asks it with silence. Written by `agent-message-trace.recordDelivery`. */
    | 'agent-message'
    /** An agent read a site's cookies through `browser --cookies` — a data-exfiltration surface the
     *  owner allowed but that MUST be loudly traced (PR 9 Task 9.2/9.3). `from` = the owner agent
     *  node's title, `to` = the domain read, `title` = the browser node's title; `nodeId` = the owner
     *  agent node so it files under that agent's card. Written BEFORE the read (fail-closed): a cookie
     *  read that happened but was not recorded is the one outcome this trace exists to prevent. */
    | 'agent-read-cookies'
  from?: string
  to?: string
  /** Column title for column-added/deleted; card title for card-created; outcome for agent-message. */
  title?: string
}

/** One line of the append-only board history (`.nodeterm/board-log.jsonl`). A `comment`
 *  carries `text`; an `event` carries `event`. Serialized one-per-line as JSON. */
export interface BoardLogEntry {
  id: string
  ts: number
  author: BoardLogAuthor
  nodeId?: string
  kind: 'comment' | 'event'
  text?: string
  event?: BoardLogEvent
  attachments?: import('./board-log-attachments').BoardLogAttachment[]
  attachmentSessionId?: string
  /** Non-sensitive integrity summary when one member of an imported attachment list was invalid. */
  attachmentIssues?: string
}

/** Max chars kept for a comment's `text`. On an SSH project the whole JSON line becomes one
 *  shell arg (`printf '%s\n' '<line>'` over the ControlMaster); an unbounded paste blows past
 *  ARG_MAX → the append fails → the optimistic entry silently vanishes on reload. Locally it
 *  just bloats the append-only file. Shared so core (disk) and the renderer (optimistic UI)
 *  clamp identically. */
export const BOARD_LOG_TEXT_MAX = 16_384

/** Read options for the board log: cap the newest N entries (default 500 in the store) or `all`. */
export interface BoardLogReadOpts {
  cap?: number
  all?: boolean
}

/** Result of a board-log read. `unsupported` is set (with `entries: []`) when the project has no
 *  reachable log — an inline/no-cwd canvas, a disconnected SSH project, or an SSH project on the
 *  Server Edition (v1 has no remote board log there). */
export interface BoardLogReadResult {
  entries: BoardLogEntry[]
  unsupported?: boolean
  /** True when the log could not be read. It is distinct from a valid empty log. */
  readFailed?: boolean
}
export type BoardLogReadState = 'absent' | 'empty' | 'ok' | 'unreadable' | 'malformed'

/** The board-log surface on `window.nodeTerminal`. Project-routed: the main/server side resolves
 *  the project to a local cwd, a desktop SSH connection, or unsupported. `append` is
 *  fire-and-forget-safe (resolves `false` on any failure, never throws). */
/** One recorded "deliberate landing" on a node -- the breadcrumb trail's unit. Frozen at record
 *  time (nodeId only, no live pointer): a deleted node is filtered at render, a renamed one shows
 *  its current title (read live), but the `note` stays a snapshot of what was happening then. */
export interface NavStop {
  nodeId: string
  at: number
  note: string
}
/** One captured debug-log line (issue #78). `seq` is monotonic across the process lifetime so
 *  subscribers can dedupe batches against the snapshot they filled from. */
export interface LogRecord {
  seq: number
  /** Epoch ms. */
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  /** The `[subsystem]` prefix convention the codebase logs with; '' when absent. */
  tag: string
  msg: string
}

/** A portable child canvas inside one project. Root canvas content remains on Project itself. */
export interface ProjectMultiverseCanvas {
  id: string
  title: string
  parentCanvasId: string
  /** Persisted depth from the project root. Multiverse canvases are limited to 1 through 8. */
  depth: number
  order: number
  viewport: Viewport
  nodes: CanvasNodeState[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}

export interface LogApi {
  /** The whole ring, oldest-first — the panel's initial fill. */
  snapshot(): Promise<LogRecord[]>
  /** Empty the ring (the panel's Clear button). */
  clear(): void
  /** Subscribe to batched pushes; returns an unsubscribe. Batches may overlap the snapshot
   *  around the subscribe edge — dedupe by `seq`. */
  onBatch(cb: (batch: LogRecord[]) => void): () => void
}

export interface BoardLogApi {
  /** Append one entry. Resolves `false` on any failure (unsupported project, fs/exec error). */
  append(projectId: string, entry: BoardLogEntry): Promise<boolean>
  /** Store bounded bytes in the project's portable attachment directory and return metadata. */
  saveAttachment(projectId: string, upload: import('./board-log-attachments').BoardLogAttachmentUpload): Promise<import('./board-log-attachments').BoardLogAttachment | null>
  createAttachmentSession(projectId: string): Promise<import('./board-log-attachments').BoardLogAttachmentSession | null>
  /** Remove only unreferenced attachment ids from one upload session after a failed append. */
  removeAttachments(projectId: string, sessionId: string, ids: string[]): Promise<boolean>
  /** Read and re-check one attachment, returning bytes only after length and SHA-256 validation. */
  readAttachment(projectId: string, attachment: import('./board-log-attachments').BoardLogAttachment): Promise<{ ok: true; dataBase64: string } | { ok: false; error: string }>
  /** Read the log newest-first (see BoardLogReadResult). */
  read(projectId: string, opts?: BoardLogReadOpts): Promise<BoardLogReadResult>
  /** Subscribe to change pushes for one project; returns an unsubscribe. */
  onChanged(projectId: string, cb: () => void): () => void
  readAttachment?(projectId: string, attachment: import('./board-log-attachments').BoardLogAttachment): Promise<{ ok: true; dataBase64: string } | { ok: false; error: string }>
  readRaw?(projectId: string): Promise<{ state: BoardLogReadState; dataBase64?: string; error?: string }>
}

/** One recorded "deliberate landing" on a node — the breadcrumb trail's unit. Frozen at record
 *  time (nodeId only, no live pointer): a deleted node is filtered at render, a renamed one shows
 *  its current title (read live), but the `note` stays a snapshot of what was happening then. */
export interface NavStop {
  nodeId: string
  at: number
  note: string
}

/** A portable child canvas carried by a project after a Multiverse import. The node list is
 * content, not a live process or destination binding, so it remains safe to move between hosts. */
export interface ProjectChildCanvas {
  id: string
  scope: 'multiverse' | 'aws-universe'
  parentCanvasId: string
  depth: number
  title: string
  order: number
  viewport?: Viewport
  nodes: CanvasNodeState[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}

/** Narrow AWS Universe view over the shared child-canvas projection. */
export type ProjectAwsUniverseCanvas = ProjectChildCanvas & {
  scope: 'aws-universe'
  parentCanvasId: 'root'
  depth: 1
  viewport: Viewport
}

/** Safe portal intent shared by the runtime project and schema 3 projection. */
export interface ProjectPortalState {
  id: string
  parentCanvasId: string
  childCanvasId: string
  entryDoorId: string
  returnDoorId: string
  title: string
  depth: number
  status: 'open' | 'closed'
  /** Safe construction intent for each side. Credentials and runtime bindings are never stored. */
  entryConstruction?: PortableDoorConstructionV3
  returnConstruction?: PortableDoorConstructionV3
}

/** A named, portable snapshot of one canvas arrangement. Runtime sessions and machine paths are
 * intentionally absent: only node identity, geometry, grouping, and the camera travel with it. */
export interface SavedCanvasLayout {
  id: string
  name: string
  /** Root or child canvas identity. Legacy layouts migrate to `root`. */
  canvasId: string
  createdAt: number
  updatedAt: number
  viewport: Viewport
  nodes: Array<{
    id: string
    position: { x: number; y: number }
    size: { width: number; height: number }
    parentId?: string
    collapsed?: boolean
  }>
}

/** A project is one canvas/page: its own nodes, viewport, and default working dir. */
export interface Project {
  id: string
  name: string
  color: string
  /** Optional icon shown beside `name` (project switcher, sessions sidebar, welcome screen).
   *  Git-shared like `name`/`color` — see `sanitizeProjectIcon` (@shared/project-icon) for the
   *  hostile-input rules a stored value must pass on load. */
  /** Optional icon shown beside `name` (tab, start screen). Git-shared like `name`/`color` — see
   *  `sanitizeProjectIcon` (@shared/project-icon) for the hostile-input rules a stored value must
   *  pass on load. */
  icon?: ProjectIcon
  /** Default working directory for new terminals created in this project. */
  cwd?: string
  /** When set, this is an SSH project: its terminals run on `server` in `remoteCwd` (remote tmux). */
  ssh?: { server: import('./ssh').SshConnection; remoteCwd: string }
  viewport: Viewport
  nodes: CanvasNodeState[]
  /** Named portable arrangements for this project's active canvas. */
  savedLayouts?: SavedCanvasLayout[]
  /** Portable provider intent, with credentials excluded from the shared project file. */
  providerBlueprints?: import('./provider-accounts').ProviderBlueprint[]
  /** Machine-local provider links retained in the workspace index, never the shared project file. */
  providerBindings?: import('./provider-accounts').ProviderBinding[]
  /** Safe, git-shared child canvases. Credentials, paths and runtime bindings stay on nodes' local overlays. */
  multiverseCanvases?: ProjectMultiverseCanvas[]
  /** Runtime-only selection. The shared project file stores hierarchy, never one person's current view. */
  activeCanvasId?: string
  /** Child universe canvases imported from schema 3. Their node content remains addressable even
   * when the containing portal is removed, so deleting a portal cannot delete child work. */
  childCanvases?: ProjectChildCanvas[]
  /** Door-only Multiverse portal intent. Credentials and runtime bindings never fit this shape. */
  portals?: ProjectPortalState[]
  /** Default managed Claude account for new Claude/chat nodes in this project. */
  defaultAccountId?: string
  /** Permission mode for new Claude TERMINAL (CLI) sessions in this project. SDK chat nodes are
   *  not covered — the chat driver still runs in `default`. Unset = use the global setting. */
  defaultPermissionMode?: AgentPermissionMode
  /** Machine-local app-wide setting overrides for this project. The complete Settings surface
   * edits this sparse overlay; absent keys inherit the global default. It is deliberately kept
   * out of the git-shared project file because Settings contains credentials, executable paths,
   * host labels, and other values a cloned repository must never inject. */
  settingsOverrides?: Partial<Settings>
  /**
   * Per-project capability switch: agents may drive browser nodes THEY opened in this project.
   * GIT-SHARED (rides .nodeterm/project.json) and therefore hostile input — the raw bit is read
   * ONLY through `projectCapabilityFlagInFile` (@shared/project-capabilities, strict `=== true`,
   * own-property), and it is NEVER a grant by itself: grants go through
   * `projectCapabilityGrantedFor` (@shared/project-capability-consent), which also requires this
   * machine's recorded 'kept' answer below.
   */
  agentBrowserControl?: boolean
  /** Per-project capability switch: agents may message other agent nodes in this project. Same
   *  rules as `agentBrowserControl` above — git-shared hostile input, strict `=== true` read,
   *  never a grant without this machine's recorded 'kept' (`projectCapabilityGrantedFor`). */
  agentMessaging?: boolean
  /**
   * MACHINE-LOCAL record of what this machine's user ANSWERED for each capability switch —
   * 'kept' or 'declined', not a bare bit, because a declined switch whose hostile `true`
   * re-arrives via git must be refused and re-noticed, never silently granted (PR #213 C1).
   * Persisted on `IndexEntryV3.capabilityAck`, NEVER written into the shared project file
   * (workspace-files.test.ts / capability-notice tests pin that the file bytes are unchanged).
   */
  capabilityAck?: import('./project-capability-consent').CapabilityAckMap
  /** Best dino-game score in this project — new dino nodes seed from it, so the record survives closing the node. */
  dinoHighScore?: number
  /** Kanban task board — shared via .nodeterm/project.json like nodes. */
  kanban?: ProjectKanban
  /**
   * Named browser profiles for this project — shared via .nodeterm/project.json like nodes/kanban.
   * See `BrowserProfile`. Absent = no profiles defined yet; browser nodes with no `browserProfileId`
   * use the app's default (unpartitioned) Electron session, which is bit-for-bit the pre-feature
   * behavior.
   */
  browserProfiles?: BrowserProfile[]
  /** Unified typed links whose source belongs to this project. */
  links?: Link[]
  /** Portable debugging-browser profiles. Local credentials, certificates and runtime state are omitted. */
  debugBrowserProfiles?: DebugBrowserProfile[]
  /** Bridge links between Claude nodes (optional; absent in pre-bridge files). */
  bridges?: BridgeLink[]
  /**
   * Visual "spawned by" ropes (control-capable agent → node it opened via the `nodeterm` CLI,
   * or browser popup → its opener). Display-only — never context links — but persisted so the
   * lineage survives restarts; deletable like any selected edge.
   */
  ropes?: BridgeLink[]
  /** Camera navigation history -- deliberate node landings, newest last. MACHINE-LOCAL: rides
  /** Camera navigation history — deliberate node landings, newest last. MACHINE-LOCAL: rides
   *  `IndexEntryV3.breadcrumbs`, never emitted into the shared project file (a repo must not carry
   *  one person's wandering camera history). */
  breadcrumbs?: NavStop[]
  /**
   * Closed projects are hidden from the tab bar but kept on disk with all their nodes (and their
   * tmux sessions left running) so they can be reopened from the start screen's "Recently closed"
   * list. Absent/false = an open tab. A closed project never becomes `activeProjectId`.
   */
  closed?: boolean
  /**
   * Set at load time when the project's .nodeterm/project.json could not be read
   * (folder missing, server unreachable, corrupt file). Runtime-only — never persisted.
   * Unavailable projects show a greyed tab and cannot be activated.
   */
  unavailable?: boolean
  /**
   * This tab is a LIVE relay connection to another machine's project — not a workspace on
   * THIS disk. Runtime-only, never persisted: set by `openRelayTab` (see relay-tab.ts) and
   * excluded from both `toWorkspace()` and the on-disk index (see the `splitWorkspace` skip in
   * core/workspace-files.ts). A relay tab is a connection bookmark, never a workspace on the
   * peer's disk, so it must never land in this client's workspace.json.
   */
  remote?: boolean
}

/** The full workspace written to / read from disk. */
export interface Workspace {
  version: 2
  activeProjectId: string
  projects: Project[]
}

/** Old single-canvas format (v1), kept only for migration on load. */
export interface WorkspaceV1 {
  version: 1
  viewport: Viewport
  nodes: CanvasNodeState[]
}

export const DEFAULT_PROJECT_ID = 'project-1'

// No projects on a fresh start → the renderer shows the welcome / start screen.
export const EMPTY_WORKSPACE: Workspace = {
  version: 2,
  activeProjectId: '',
  projects: []
}

// ---- Contract for the API exposed to the renderer via preload ----

/** Wire shape of pty:tmux-status — behind the "tmux not found" banner. */
export interface TmuxStatus {
  available: boolean
  /** One-shot install command for a terminal node; null = no known installer (text-only banner). */
  installCommand: string | null
  /** Button caption for installCommand (e.g. "Install Homebrew + tmux" when brew must come first). */
  installLabel: string | null
  /** `process.platform` of the core that owns the sessions/filesystem. `null` means the read
   *  failed; callers must not substitute the browser's platform for a server or relay core. */
  platform: string | null
}

/**
 * How close THIS MACHINE is to `kern.tty.ptmx_max`, the system-wide pty-device ceiling that took
 * the whole app down in the 2026-08-11 field report (every spawn failing with a bare
 * `posix_spawnp failed.`). See core/pty-pressure.ts for the bands.
 */
export type PtyPressureLevel = 'none' | 'elevated' | 'critical'

/** A pty-pressure reading, as broadcast on `IPC.ptyPressure`. `null` = could not be measured. */
export interface PtyPressure {
  level: PtyPressureLevel
  /** `/dev/ttys*` entries in existence right now. */
  usage: number | null
  /** `kern.tty.ptmx_max`. */
  ceiling: number | null
}

/** Outcome of the banner's "Fix automatically…" button (macOS only) — see main/ptmx-limit.ts. */
export type PtyLimitFixResult =
  | { ok: true; ceiling: number }
  /** `canceled` = the user dismissed macOS's own admin-password dialog. Not an error to retry.
   *  `busy` = a password dialog from another window/reload is already up. Both are SILENT for the
   *  renderer: nothing failed, so neither may raise an error toast. */
  | { ok: false; error: string; canceled?: boolean; busy?: boolean }

/** Public profile category. Executable paths and launch arguments stay private to the core. */
export type WindowsTerminalProfileKind =
  | 'auto'
  | 'pwsh'
  | 'windows-powershell'
  | 'cmd'
  | 'git-bash'
  | 'wsl'
  | 'custom'
  | 'named'

/** Renderer-safe description of a Windows terminal profile. */
export interface WindowsTerminalProfile {
  id: string
  label: string
  kind: WindowsTerminalProfileKind
  available: boolean
  unavailableReason?: string
}

/** A user-owned local profile for repeatable terminal and agent creation. */
export interface NamedTerminalProfile {
  /** Stable local id. This id is safe to persist in machine-local node state. */
  id: string
  /** User-facing label shown in Settings and node-creation pickers. */
  name: string
  /** Initial directory. It never crosses the portable project-file boundary. */
  cwd: string
  /** Optional command sent once after the shell is ready. */
  startupCommand: string
}

/** Optional desktop capability for detecting the Windows terminal profiles on this machine. */
export interface TerminalProfilesApi {
  list(): Promise<WindowsTerminalProfile[]>
  refresh(customExecutable?: string): Promise<WindowsTerminalProfile[]>
}

export interface PtyApi {
  /** Starts a new PTY session; returns its sessionId and whether the session was freshly
   *  created (cold start) vs reattached to a still-running tmux session (warm). */
  create(options: PtyCreateOptions): Promise<PtyCreateResult>
  /**
   * Validate and execute an agent intent against the live session's concrete shell dialect.
   * The rendered command remains private to the core; failure copy is sanitized there.
   */
  executeLaunchIntent?(
    sessionId: string,
    launchId: string,
    intent: TerminalLaunchIntent
  ): Promise<LaunchIntentExecutionResult>
  /** Sends user input to the PTY. */
  write(sessionId: string, data: string): void
  /** Updates the PTY when the terminal is resized. The pty runs at the SMALLEST subscriber's grid,
   *  so this is a REPORT, not a command — the effective size comes back over `onSize`.
   *  `cols`/`rows` null means "subscribed, but not viewing" (a parked terminal): the client leaves
   *  the size set entirely, so a parked small window can't shrink everyone else's terminal.
   *  `viewerId` (optional, trailing) scopes the size vote to one VIEW within the connection (the
   *  kanban card modal); absent ⇒ the PRIMARY view. */
  resize(sessionId: string, cols: number | null, rows: number | null, viewerId?: string): void
  /** Flow control: pause (false) or resume (true) reading the PTY when xterm is backed up.
   *  `viewerId` (optional, trailing) scopes the pause to one VIEW (a client's second xterm is
   *  edge-latched independently); absent ⇒ the PRIMARY view. */
  setFlow(sessionId: string, resume: boolean, viewerId?: string): void
  /** Detaches/terminates ONE view of the PTY (the underlying tmux session survives). `viewerId`
   *  (optional, trailing) names the view to detach — closing the kanban modal leaves the canvas
   *  node attached; absent ⇒ the PRIMARY view. */
  kill(sessionId: string, viewerId?: string): void
  /** Permanently ends the persistent session for a node (kills its tmux session) because the node
   *  is being DELETED. Co-viewers get `onClosed` and must not respawn it.
   *
   *  `everySocket` (optional, trailing) widens a kill for a session we hold NOTHING for to every
   *  local tmux socket the name could be on. Opt-in for one caller — the session-memory panel's
   *  speculative kill of a row it swept off either socket. An ordinary node-× must not set it: it
   *  takes the same unheld branch after an app restart, and `nodeterm-rmt` holds sessions another
   *  machine's nodeterm SSHed in to spawn. */
  /** Resolves after core end processing; on the session-host backend this includes its kill
   * acknowledgement. A rejection means the outcome is unknown and the caller must keep the node. */
  destroy(persistKey: string, opts?: { everySocket?: boolean }): Promise<void>
  /** Ends a node's persistent session so the SAME node id respawns in a new cwd ("move into
   *  worktree"). Same tmux kill as `destroy`, opposite intent: the node stays on the canvas, so
   *  co-viewers get `onRecycled` (restart + re-attach), never the permanent closed state. */
  /** Resolves after core recycle processing; on the session-host backend this includes its kill
   * acknowledgement. A rejection means the node must keep its cwd/generation for retry. */
  recycle(persistKey: string): Promise<void>
  /** Desktop-only awaited recycle after the user confirms a destructive profile switch. */
  recycleConfirmed?(persistKey: string, target?: PtyRecycleTarget): Promise<void>
  /** Suggest a terminal title from its recent output via the configured AI agent. */
  generateName(persistKey: string, cwd: string): Promise<GitResult>
  /** Suggest a group title from its member terminals' recent output via the configured AI agent. */
  generateGroupName(memberKeys: string[], cwd: string): Promise<GitResult>
  /** Capture a terminal session's output as text. `full` grabs the entire scrollback. */
  capture(persistKey: string, full?: boolean): Promise<string>
  /** Read the persisted scrollback snapshot for a node (for cold-restart replay). '' if none. */
  readScrollback(persistKey: string): Promise<string>
  /** Send literal text into a session, by default followed by Enter (e.g. a slash command).
   *  `opts.enter: false` writes the text without submitting it (dictation's Insert). Returns
   *  false if unavailable. */
  sendText(persistKey: string, text: string, opts?: { enter?: boolean }): Promise<boolean>
  /** Is tmux available on this host (else the silent plain-shell fallback), plus a suggested
   *  install command for the "tmux not found" banner. */
  tmuxStatus(): Promise<TmuxStatus>
  /** The command currently in the foreground of a node's tmux pane (e.g. 'claude', 'zsh'), by
   *  node persistKey. null when it is unknown — no session, no tmux, or the query failed — which
   *  callers must read as "not observed", never as evidence of a particular command. */
  paneCommand(persistKey: string): Promise<string | null>
  /** Correct a node's tmux "lead" pane width after Claude Code's agent-team backend has narrowed
   *  it (`settings.agentTeamLeadPaneWidthEnabled` — see shared/agents/team-pane-layout.ts). Counts
   *  the node's panes and, when the setting calls for it, resizes pane 0; resolves `true` only
   *  when it actually resized something, `false` for every other outcome (feature off, no team
   *  panes yet, no live/local tmux session, a failed tmux call). Never rejects. Tmux-backed local
   *  sessions only — a no-op on the Windows session-host fallback and on an SSH-project node. */
  correctTeamLeadPaneWidth(persistKey: string): Promise<boolean>
  /** Terminate the foreground process group in a node's pane. Returns false when the pane/process
   *  cannot be safely identified; it never kills the pane's login shell. When `expectedAgentId` is
   *  given, the kill happens only if that harness actually owns the foreground group (argv-verified)
   *  — so a stale menu can never SIGTERM vim or a build the user started in the pane. */
  terminateForeground(persistKey: string, expectedAgentId?: string): Promise<boolean>
  /** The agent session's display name (`/rename` name, else auto name) read from the agent's own
   *  session store, resolved strictly by sessionId; null if unknown. Keeps a node title in sync with
   *  the `/resume` name (e.g. after resume) without cross-contaminating same-folder sessions.
   *  `accountId` scopes the lookup to a managed Claude account's transcript root (default `~/.claude`).
   *  `agentId` picks the reader — grok's name lives in its session metadata, not a claude transcript;
   *  omitted (every pre-grok caller) means the claude transcript reader. */
  readSessionName(sessionId: string, accountId?: string, agentId?: string): Promise<string | null>
  /** Listens for PTY output. Returns an unsubscribe function. */
  onData(sessionId: string, listener: (data: string) => void): () => void
  /** Fires when the PTY process exits. Returns an unsubscribe function. */
  onExit(sessionId: string, listener: (exitCode: number) => void): () => void
  /** The authoritative size of a co-attached session: min(cols) × min(rows) over all subscribers
   *  ("smallest subscriber wins"). Broadcast whenever the subscriber set or any reported size
   *  changes; the terminal renders at this size instead of its own fit. Returns an unsubscribe. */
  onSize(sessionId: string, listener: (size: { cols: number; rows: number }) => void): () => void
  /** Another client permanently destroyed this node while we were co-viewing it: the session is
   *  gone for good (do not respawn — show a "closed by <peer>" state). `by` is the destroying
   *  client's ClientId, or null when the destroy was not attributed to a client (a local desktop
   *  destroy); resolve it to a name via the presence store. Returns an unsubscribe. */
  onClosed(sessionId: string, listener: (info: { by: ClientId | null }) => void): () => void
  /** Another client RECYCLED this node (moved it into a worktree): this session id is dead. With
   *  `ready:true` a replacement is already live under the same node id — restart the terminal (the
   *  re-create co-attaches to it) instead of showing the closed state: nothing was deleted. With
   *  `ready:false` no replacement ever came (the recycler died mid-move): do NOT respawn — the
   *  terminal ends and offers a manual reopen. Returns an unsubscribe. */
  onRecycled(sessionId: string, listener: (info: RecycledInfo) => void): () => void
  /** We fell too far behind and the server dropped our queued output; this is the session's
   *  CURRENT screen captured from tmux. Reset the emulator and repaint from it.
   *  CONTRACT: the payload is guaranteed NON-EMPTY (a failed capture is retried, never sent). The
   *  listener must STILL ignore an empty/falsy payload — never reset on one: a wrongly cleared
   *  screen is unrecoverable, a skipped repaint is not. Returns an unsubscribe. */
  onResync(sessionId: string, listener: (screen: string) => void): () => void
}

export type WorkspaceMigrationKind = 'v2' | 'exec'

/**
 * Why one path inside the project folder was left OUT of a `.nodeterm-project` save file.
 * NOTHING is dropped silently: every exclusion appears here (gitignored trees are grouped per
 * ignored root — `path` ends with '/' and `files`/`bytes` sum what the group holds).
 */
export interface ProjectArchiveExclusion {
  /** Project-folder-relative path, '/'-separated. A grouped directory ends with '/'. */
  path: string
  reason: 'gitignored' | 'nested-repository' | 'symlink' | 'special' | 'missing' | 'unreadable' | 'machine-local' | 'credential' | 'unsupported' | 'user-choice' | 'validation-failed'
  /** Human-readable reason for portable schema omissions; absent on legacy file exclusions. */
  detail?: string
  /** File count under a grouped directory exclusion. Absent for a single file. */
  files?: number
  bytes?: number
  /** True when an enormous ignored tree hit the bounded scan cap — `files`/`bytes` are then
   *  honest lower bounds, not totals. */
  atLeast?: boolean
}

/**
 * What a `.nodeterm-project` save file actually carries (or carried, on import) — shown to the
 * user so the inclusion rule is stated rather than guessed at.
 */
export interface ProjectArchiveContents {
  /**
   * How the project's own repository travelled:
   * - 'git-bundle'       — full history as a `git bundle --all` inside the file.
   * - 'files-only'       — working files but no bundle (repo has no commits yet, or the folder
   *                        sits inside a larger repository that was not dragged along).
   * - 'no-repository'    — folder has no git repo; every regular file was included instead.
   * - 'remote-project'   — SSH project: the folder lives on the remote host; canvas+history only.
   * - 'no-folder'        — inline (cwd-less) project; canvas+history only.
   * - 'folder-missing'   — the project's folder no longer exists on disk; canvas+history only.
   * - 'not-in-archive'   — a V1 archive: the format carried no repository or working files.
   * - 'portable-projection' — schema 3 safe intent only; local bindings and machine state stay
   *   on the source machine and are configured explicitly after import.
   */
  repository:
    | 'git-bundle'
    | 'files-only'
    | 'no-repository'
    | 'remote-project'
    | 'no-folder'
    | 'folder-missing'
    | 'not-in-archive'
    | 'portable-projection'
  /** Plain-words caveat when `repository` is not 'git-bundle' (why, and what that means). */
  repositoryNote?: string
  /** Working files included under `files/` (count and raw bytes before compression). */
  workingFiles: number
  workingBytes: number
  /** Every excluded path, each with its reason. Empty when nothing was excluded. */
  excluded: ProjectArchiveExclusion[]
  /** Sums over `excluded` (lower bounds when any entry is `atLeast`). */
  excludedFiles: number
  excludedBytes: number
}

/** The explicit destination route shown after schema 3 import. Values are ids, not UI copy. */
export type PortableBindingAction = 'configure' | 'rebind' | 'adopt' | 'deploy' | 'locate-asset' | 'leave-unbound'

export interface PortableBindingState {
  nodeId: string
  featureId: string
  displayLabel: string
  action: PortableBindingAction
  enabled: boolean
  reason?: string
  bound: boolean
}

export interface PortableBindingApi {
  state(input: { nodeId: string; featureId: string; displayLabel: string; hasMissingAssets?: boolean }): Promise<PortableBindingState[]>
  apply(input: {
    nodeId: string
    action: PortableBindingAction
    featureId?: string
    providerAccountId?: string
    resourceId?: string
  }): Promise<{ ok: true; state: 'bound' | 'unbound' } | { ok: false; error: string }>
}

export interface ProjectArchiveProgress {
  phase: 'reading' | 'validating' | 'migrating' | 'staging' | 'publishing' | 'completed' | 'cancelled'
  progress: number
  message: string
}

export interface WorkspaceApi {
  load(): Promise<Workspace>
  save(workspace: Workspace): Promise<void>
  /** Path-free preparation and cancellation for portable project media. */
  portableMedia: import('./portable-media').PortableMediaApi
  /** Local destination binding controls. Import never invokes these controls implicitly. */
  portableBindings: PortableBindingApi
  /** Progress and cancellation for the schema 3 import operation. */
  onArchiveProgress(cb: (event: ProjectArchiveProgress) => void): () => void
  cancelArchiveImport(): Promise<boolean>
  /** Reads <folder>/.nodeterm/project.json and returns the assembled Project (cwd resolved), or null. */
  probeFolder(folder: string): Promise<Project | null>
  /** True when `cwd`'s project is currently stored as sized parts + a manifest, rather than a
   *  single `project.json` (project-parts.ts). Local-only: see splitIntoParts's own doc comment. */
  hasPartsManifest(cwd: string): Promise<boolean>
  /** Explicitly convert (or re-split at a new size) a LOCAL project's `.nodeterm/project.json`
   *  into sized parts + a manifest. LOCAL-ONLY: never call on an SSH project's cwd, and never
   *  reachable over a relay session (see relay-rpc-policy.ts / relay-api.ts). A global settings
   *  toggle for the default size must never call this on its own — only an explicit user action
   *  may change a project's storage encoding. */
  splitIntoParts(
    cwd: string,
    sizeValue: number,
    sizeUnit: 'KB' | 'MB' | 'GB'
  ): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Reverse a split back to a single `project.json`. Refuses with a reason if the project is not
   *  currently split, or if the parts fail verification (a broken parts set is never silently
   *  joined from partial data). LOCAL-ONLY, same as splitIntoParts. */
  joinParts(cwd: string): Promise<{ ok: true } | { ok: false; reason: string }>
  /** Save safe project intent and app-owned local history as ONE schema 3 file in a ZIP container.
   *  Machine-local bindings, credentials, repository working files, process state, and caches
   *  stay on the source machine; `contents` states every omission. */
  exportProject(
    project: Project,
    /** When given, the finished archive is wrapped whole in AES-256-GCM under a key derived from
     *  this password (core/project-archive-encryption.ts) and the file leaks nothing about the
     *  project — not its name, not its file list. Omitted ⇒ the historical plain container. */
    password?: string,
    media?: import('./portable-media').PortableMediaExportPlan
  ): Promise<{
    ok: boolean
    path?: string
    canceled?: boolean
    error?: string
    encrypted?: boolean
    contents?: ProjectArchiveContents
  }>
  /** Open and validate a one-file project archive. Schema 3 stages safe intent atomically and
   *  leaves destination bindings unbound; legacy V1/V2 archives retain their compatibility path. */
  importProject(opts?: {
    /** Skip the file picker and open exactly this file — the second leg of the password prompt:
     *  the first call found the file protected and returned its path, and this one supplies the
     *  password for that same file rather than making the user pick it again. */
    path?: string
    password?: string
  }): Promise<{
    ok: boolean
    project?: Project
    canceled?: boolean
    error?: string
    /** The file is password-protected: `path` names it, and nothing was opened. Not an error —
     *  it is the prompt. */
    needsPassword?: boolean
    /** The supplied password did not open the file. Indistinguishable from a tampered file by
     *  design (see core/project-archive-encryption.ts), and the copy says so. */
    wrongPassword?: boolean
    /** Too many wrong passwords for this file: no password may be tried for this many more
     *  milliseconds. Set alongside `wrongPassword` when that failure started the wait, and alone
     *  when the wait was already running. */
    lockedMs?: number
    /** The unlock ladder may be offered to end that wait — see core/archive-unlock-guard.ts. It
     *  ends the WAITING and never the password. */
    ladderAvailable?: boolean
    path?: string
    archiveVersion?: 1 | 2 | 3
    contents?: ProjectArchiveContents
    /** Safe planner definitions from schema 3, not yet applied to this machine. */
    plannerDefinitions?: {
      schemaVersion: 1
      featureId: 'planner'
      displayLabel: string
      schedules: import('./planner-occurrences').PlannerSchedule[]
    }
    restoredTo?: string
    /** Non-fatal portal metadata repairs applied while preserving child content. */
    repairs?: Array<{ portalId?: string; canvasId?: string; action: string; detail: string; preservedNodeIds: string[] }>
  }>
  /** Hand out the next unlock-ladder question for a rate-limited protected project file. `null`
   *  means no ladder is on offer (no wait to end, this climb already failed to the bottom, or the
   *  shared rolling budget is spent). */
  archiveLadderIssue(filePath: string): Promise<{
    challenge: import('./unlock-ladder-types').LadderChallenge | null
    budgetLeft: number
    waitMs: number
  }>
  /** Grade an answer core-side against its one-shot nonce. A clear ends the WAIT and nothing
   *  else — it never supplies, weakens, or checks the file's password. */
  archiveLadderVerify(input: {
    path: string
    answer: import('./unlock-ladder-types').LadderAnswer
  }): Promise<
    import('./unlock-ladder-types').LadderVerdict & {
      waitMs: number
      budgetLeft: number
      /** The next rung's question, minted with the verdict so one round-trip advances the climb. */
      challenge: import('./unlock-ladder-types').LadderChallenge | null
    }
  >
  /** Whether <folder>/.nodeterm/project.json is `present`, definitely `absent`, or `unreadable`
   *  (any non-ENOENT error). Never guesses absence from a failed read — see issue #385. */
  projectFileState(folder: string): Promise<'present' | 'absent' | 'unreadable'>
  /** Fired once after an on-disk migration: `v2` = a v2→v3 migration wrote .nodeterm/ dirs into the
   *  project folders; `exec` = the custom shell / advanced ssh args of already-open projects moved
   *  out of the shared project file into this machine's own workspace index (@shared/node-exec). */
  onMigrated(cb: (kind: WorkspaceMigrationKind) => void): () => void
  /** Fired once per run when a load found the workspace index unreadable and preserved it as
   *  `workspace.json.corrupt-<ts>` (the payload). The projects themselves are untouched — their
   *  canvases live in each <cwd>/.nodeterm/project.json — so the note tells the user to re-add them. */
  onCorruptRecovered(cb: (backupFile: string) => void): () => void
  /** Fired when a project file changed on disk outside the app (git pull, sync, teammate). */
  onExternalChange(cb: (project: Project) => void): () => void
}

/** One step of an in-flight `serverDeployment.start()` call, in the order they can occur. Not
 *  every deployment passes through every stage (an already-installed Docker skips
 *  `installing-docker`; an already-running daemon skips `starting-docker-daemon`) — a listener
 *  must not assume a fixed sequence, only that stages move forward and end in either `ready` or
 *  the promise rejecting/resolving with `ok:false`. */
export type ServerDeploymentStage =
  | 'preparing-secrets'
  | 'checking-docker'
  | 'installing-docker'
  | 'starting-docker-daemon'
  | 'building-and-starting'
  | 'ready'

export interface ServerDeploymentApi {
  start(): Promise<{
    ok: boolean
    state: 'ready' | 'docker-restart-required' | 'failed'
    url?: string
    totpCode?: string
    error?: string
  }>
  currentTotp(): Promise<string>
  /** Cheap, in-memory status: whether THIS app process has a deployment it believes is up, and if
   *  so its connect URL. It does not re-probe Docker — it reflects the last successful `start()`
   *  in this run, which is what the always-visible canvas indicator needs (it must never do a
   *  multi-second Docker round trip just to decide whether to render). */
  status(): Promise<{ running: boolean; url?: string }>
  /** Subscribes to progress stages for whichever `start()` call is currently in flight (there is
   *  at most one — `start()` dedupes concurrent callers onto a single run). Returns an
   *  unsubscribe function. */
  onProgress(cb: (stage: ServerDeploymentStage) => void): () => void
}
export interface ProjectSettingsApi {
  /** `{shared, local, conflict?}` for a known project id, or null for an unknown one. */
  read(projectId: string): Promise<import('./project-settings').ProjectSettingsSnapshot | null>
  /** Whole-document write of the git-shared `.nodeterm/settings.json`. See
   *  `WorkspaceStore.writeProjectSettings` for the false-vs-true contract. */
  writeShared(projectId: string, doc: import('./project-settings').ProjectSettingsDoc): Promise<boolean>
  /** This machine's own overlay; `local: undefined` clears it. */
  updateLocal(
    projectId: string,
    local: import('./project-settings').ProjectLocalSettings | undefined
  ): Promise<boolean>
  /** Resolved settings + per-family trust verdict for one project — `null` for an unknown id. The
   *  renderer cache (`renderer/state/projectLaunchInfo.ts`) warms this on activate and never awaits
   *  it inline; a caller wanting the raw handshake calls this directly instead. */
  launchInfo(projectId: string): Promise<import('./project-settings').ProjectLaunchInfo | null>
  /** main → renderer: a family's trust verdict changed for `projectId` (a consent dialog answered,
   *  an approval revoked). Nobody broadcasts this yet — Task 2 records approvals and emits it. */
  onTrustChanged(cb: (p: { projectId: string }) => void): () => void
}

export interface ProjectSetupApi {
  /** Launch a project's setup/archive script behind the trust gate (`project-setup-service.ts`).
   *  `worktreePath`, when given, is the ONLY path-shaped hint this call carries — main derives
   *  `rootPath`/`ssh` from its own workspace index by `projectId` and independently validates
   *  `worktreePath` against that project's actual git worktrees; nothing path-shaped sent here is
   *  trusted as-is (Task 1 review finding). */
  run(
    projectId: string,
    kind: import('./project-settings').ProjectSetupKind,
    worktreePath?: string
  ): Promise<import('./project-settings').ProjectSetupRunResult>
  /** Aborts a live run, or one still waiting at its consent dialog. `false` = nothing by that
   *  runKey exists (already finished, or never did). */
  cancel(runKey: string): Promise<boolean>
  /** Renderer's answer to a `onConsentRequest` prompt. A stale/unknown requestId is a silent no-op. */
  consent(requestId: string, answer: import('./project-settings').ProjectSetupConsentAnswer): Promise<void>
  /**
   * Ask for this project's `agents`/`shell` family to be trusted, prompting the human if it is not
   * yet — the call a launcher makes before consuming a shared-sourced `launchCmd`/`env`/`shell`.
   * `true` only when the family is trusted at that project's location (nothing shared to gate, an
   * existing grant, or a fresh approval); skip, expiry, an unknown project and a refused (relay
   * guest) call are all `false`. Concurrent asks for one location share ONE dialog. On approval,
   * `projectSettings.onTrustChanged` fires for the project, so a cached launch-info verdict is
   * re-read rather than trusted from before the answer.
   */
  requestTrust(projectId: string, family: 'agents' | 'shell'): Promise<boolean>
  /** main → renderer: raise the trust dialog before a shared-sourced script runs, or before a
   *  shared-sourced launch setting is consumed — tagged by family (`ProjectConsentRequest`). */
  onConsentRequest(cb: (req: import('./project-settings').ProjectConsentRequest) => void): () => void
  /** main → renderer: close a prompt nobody answered before the renderer did. */
  onConsentDismiss(cb: (p: { requestId: string }) => void): () => void
  /** Per-project run progress (`ProjectSetupEvent`), mirroring `boardLog.onChanged`'s ref-counted
   *  subscribe/unsubscribe shape. */
  onEvent(projectId: string, cb: (ev: import('./project-settings').ProjectSetupEvent) => void): () => void
}

export interface WorktreeApi {
  /**
   * Symlink a project's configured `sharedPaths` (git-ignored dirs like `node_modules`) from its
   * repo root into a freshly-created git worktree, so a setup `npm install` there sees the links.
   *
   * The renderer passes ONLY `(projectId, worktreePath)` — never the path list: main reads the list
   * itself out of the project's settings by `projectId`, derives the repo root from its own
   * workspace index, and validates `worktreePath` is that project's rootPath or one of its actual
   * git worktrees. An unknown project, an unvalidated path, or an SSH project (local-only this PR)
   * all resolve `[]`. Never rejects — a per-entry `SharedPathResult[]` reports what happened.
   */
  materializeShared(
    projectId: string,
    worktreePath: string
  ): Promise<import('./worktree').SharedPathResult[]>
}

/**
 * Labelling for a native picker.
 *
 * Every picker used to open as the OS's bare default — window title "Open", button "Open", no
 * filters — whatever the flow that opened it was called. A picker raised BY A SAVE therefore
 * announced itself as an Open dialog, which is exactly how "Save project as one file with media…"
 * read as the wrong dialog (issue: "trying to save as one file and opens instead"). A caller whose
 * surrounding action is not literally "open a file" passes its own title and button label so the
 * dialog says what it is for.
 *
 * Every field is optional and every one is validated in main before it reaches Electron: this
 * crosses the preload bridge, so a renderer cannot hand the OS an arbitrary object.
 */
export interface NativePickerOptions {
  /** Window title, e.g. "Choose media files to pack into the project file". */
  title?: string
  /** Confirm-button label, e.g. "Pack these" — never left as the default "Open" for a save flow. */
  buttonLabel?: string
  /** Extension filters. Ignored by the folder picker, which has nothing to filter. */
  filters?: readonly { name: string; extensions: readonly string[] }[]
}

export interface DialogApi {
  /** Opens a native folder picker; returns the chosen path or null if cancelled. */
  selectFolder(options?: NativePickerOptions): Promise<string | null>
  /** Opens a native file picker; returns the chosen path or null if cancelled. */
  selectFile(options?: NativePickerOptions): Promise<string | null>
  /** Opens a native MULTI-file picker (for the converter's "Add files…"); returns the chosen paths,
   *  null if cancelled. Electron only — the Server Edition has no native dialog and returns null;
   *  its FileConverterPanel uses a plain `<input type="file" multiple>` instead. */
  selectFiles(options?: NativePickerOptions): Promise<string[] | null>
}

export interface ClipboardWriteOptions {
  /** Let a host surface its own failure UI. Callers with a fallback can disable that UI. */
  reportFailure?: boolean
}

export interface ClipboardApi {
  /** Resolves true only after the host reports that the system clipboard write completed. */
  writeText(text: string, options?: ClipboardWriteOptions): Promise<boolean>
  /** Copy local files so Finder and other file-aware macOS apps can paste them. */
  writeFiles(paths: string[]): Promise<boolean>
}

export interface ShellApi {
  /** Reveal a path in the OS file manager (Finder). */
  reveal(path: string): void
  /** Open a path with the OS default application. */
  openPath(path: string): void
  /** Open an http(s) URL in the OS default browser. */
  openExternal(url: string): void
  /** Open a file dialog for a project-icon image; main re-encodes the pick to a bounded PNG data
   *  URL (or an error), or returns null when cancelled. See `pickProjectIcon` (main). */
  pickProjectIcon(): Promise<ProjectIconPickResult>
}

/** One node's canvas-widget state, as reported over IPC (see `CanvasWidgetState` for what is
 *  actually persisted — this adds the live `open` flag, which is main-process runtime state, not
 *  something settings.json remembers across restarts). */
export interface CanvasWidgetLiveState {
  nodeId: string
  /** Is a widget window for this node currently open? */
  open: boolean
  alwaysOnTop: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

/**
 * Pop a terminal node's live session into its own always-on-top-configurable desktop window —
 * see `CanvasWidgetState`'s doc comment above for the full design and `main/canvas-widget-window.ts`
 * for the Electron-side implementation this calls into. Electron-only: every method rejects with
 * `E_UNSUPPORTED` in the Server Edition (no OS window to open), and `onStateChanged` still returns
 * a real no-op unsubscribe there so a mounting component never has to branch on which shell it is
 * running under.
 */
export interface CanvasWidgetApi {
  /** Open (or focus, if already open) the widget window for this node. Resolves once the window
   *  has been created/focused; rejects `E_UNSUPPORTED` in the Server Edition. */
  open(nodeId: string): Promise<void>
  /** Close the widget window for this node. A no-op if it isn't open. Never touches the
   *  underlying pty/session — the session keeps running exactly as it does when a canvas node is
   *  merely unmounted (see the module doc in `main/canvas-widget-window.ts`). */
  close(nodeId: string): Promise<void>
  /** User-configurable always-on-top, both at open time and while the widget is open. Persists
   *  per node; applies live if the widget window is currently open. */
  setAlwaysOnTop(nodeId: string, alwaysOnTop: boolean): Promise<void>
  /** Current live + persisted state for one node. */
  getState(nodeId: string): Promise<CanvasWidgetLiveState>
  /** Fires whenever any node's widget state changes (opened, closed, always-on-top toggled, or
   *  bounds persisted) — main window and widget window alike listen on this. Returns unsubscribe. */
  onStateChanged(listener: (state: CanvasWidgetLiveState) => void): () => void
}

export interface DirEntry {
  name: string
  dir: boolean
  /** True when the entry is matched by .gitignore (shown dimmed). */
  ignored?: boolean
}

export interface FsApi {
  /** List a directory (folders first, then files; alphabetical). */
  list(dirPath: string): Promise<DirEntry[]>
  /** Read a file's text contents (empty string on error). */
  read(filePath: string): Promise<string>
  /** Read a file as base64 (for images and other binary previews; '' on error). */
  readBinary(filePath: string): Promise<string>
  /** Write text to a file; resolves true on success. */
  write(filePath: string, content: string): Promise<boolean>
  /** Create a directory (recursive). Resolves true on success. */
  mkdir(dirPath: string): Promise<boolean>
  /** True when the path exists (file or directory). */
  exists(path: string): Promise<boolean>
}

export interface FilesApi {
  /** Fuzzy-open file index for a project root: root-relative `/`-paths ([] on failure). */
  quickOpen(cwd: string): Promise<string[]>
  /**
   * Mint a one-shot, short-TTL ticket for downloading `path` over HTTP, and resolve the URL to
   * navigate to. Resolves **null** where the shell has no HTTP surface to redeem it on (Electron
   * desktop, relay) — callers treat null as "downloading is not offered here" and hide the
   * affordance rather than erroring.
   */
  downloadTicket(path: string): Promise<DownloadTicket | null>
  /**
   * Persist raw bytes (base64) as a file on the machine the terminals run on, and resolve its
   * ABSOLUTE path — what a clipboard paste of an image has instead of a path, and what a browser
   * client's dropped file has instead of a usable one. Resolves null when it could not be written
   * (too large, unwritable); callers drop that file the way a failed drop does.
   */
  saveUpload(name: string, dataBase64: string): Promise<string | null>
  /**
   * Server Edition only: persist a browser-owned Blob without first materializing and base64
   * encoding it in the renderer. This capability is intentionally absent from the desktop and
   * relay APIs; callers must fall back to `saveUpload` when it is not present.
   */
  saveUploadBlob?(name: string, data: Blob): Promise<string | null>
  /**
   * Persist raw bytes (base64) as a CANVAS image and resolve its ABSOLUTE path. Unlike
   * `saveUpload` the file is durable: a canvas image node is persisted in `project.json`, so its
   * file cannot live in a staging area that is swept after a week. The directory is derived from
   * `projectId` on the receiving side — the caller never names a path — and is the project's own
   * git-shared `.nodeterm/images/` when it has a local cwd, else a durable app-local folder.
   * Resolves null when it could not be written; callers drop that file like a failed drop.
   */
  saveCanvasImage(projectId: string, name: string, dataBase64: string): Promise<string | null>
}

export interface MediaApi {
  /** Allow an absolute local path to be served, and return its nt-media:// URL. */
  allow(absPath: string): Promise<string>
  /**
   * Allow a file that lives on an SSH project's HOST: main pulls it into a local cache over the
   * project's ControlMaster (skipped when the cached copy's size still matches the remote), then
   * allowlists the cached copy. Resolves the playable nt-media:// URL, or a reason it couldn't
   * (not connected, transfer failed). Desktop only — the browser bridge rejects it.
   */
  allowSsh(projectId: string, remotePath: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  /** Persist raw HTML to <userData>/agent-web/<id>.html, allowlist it, return its absolute path. */
  writeHtml(html: string): Promise<string>
}

/** One extension Electron actually has loaded into a partition's session, as reported live by
 *  `session.extensions.getAllExtensions()` — id/name/version come from the extension's own
 *  manifest, never invented by this app. See `BrowserExtensionsApi`. */
export interface BrowserExtensionInfo {
  id: string
  name: string
  version: string
  /** Absolute directory path this extension was loaded from (unpacked only — Electron does not
   *  support installing packed .crx extensions; see `BrowserExtensionsApi` doc). */
  path: string
}

/**
 * Unpacked Chrome-extension loading for a browser profile's Electron session.
 *
 * Desktop (Electron) only. Electron's extension support (Manifest V2/V3 subset, see
 * https://electronjs.org/docs/api/extensions-api) has two real limits worth stating plainly
 * rather than pretending this is full Chrome Web Store parity:
 *   - Unpacked directories only — no packed `.crx` install flow, no Web Store browsing.
 *   - "Electron does not support the full range of Chrome extensions APIs" (Electron's own
 *     docs) — an extension that leans on an unimplemented `chrome.*` API may partly or fully not
 *     work; this app cannot detect that in advance, only whether `loadExtension` itself accepted
 *     the directory.
 * The Server Edition and relay tabs run in a real browser tab, not Electron, and reject every
 * method with `E_UNSUPPORTED` — there is no Chromium extension host to load into there at all.
 */
export interface BrowserExtensionsApi {
  /** Extensions currently loaded into this profile's session (`partition` — see
   *  `browserPartitionFor`; `undefined` = the app's default/unpartitioned session). Read live
   *  from Electron, so a load that failed at boot never appears here. */
  list(partition: string | undefined): Promise<BrowserExtensionInfo[]>
  /** Open a native folder picker for an unpacked extension directory (must contain
   *  `manifest.json`); `null` if the user cancelled. Desktop-only, mirroring `dialog:select-folder`. */
  pickDir(): Promise<string | null>
  /** Load an unpacked extension directory into `partition`'s session and persist it so it reloads
   *  on the next app launch (Electron itself forgets loaded extensions across restarts). */
  add(
    partition: string | undefined,
    dirPath: string
  ): Promise<{ ok: true; extension: BrowserExtensionInfo } | { ok: false; error: string }>
  /** Unload an extension (identified by the directory path it was added with) from `partition`'s
   *  session and stop reloading it at boot. */
  remove(partition: string | undefined, dirPath: string): Promise<void>
}

/** Machine-local reset for one browser session. Project tabs and profile names remain portable. */
export interface BrowserProfileApi {
  /** Clear cookies, local storage, cache and loaded unpacked extensions for this partition. */
  reset(partition: string | undefined): Promise<{ ok: true } | { ok: false; error: string }>
}

export interface BrowserApi {
  /** Map a browser node's <webview> guest to its node id (for new-window capture). */
  register(webContentsId: number, nodeId: string, ownerNodeId?: string, surface?: 'canvas' | 'modal'): void
  unregister(webContentsId: number): void
  /** Fires when a browser guest requested a new window; the renderer opens another browser node. */
  onBrowserNewWindow(listener: (e: { url: string; sourceNodeId: string }) => void): () => void
  extensions: BrowserExtensionsApi
  profile: BrowserProfileApi
  onLeaseChanged(listener: (push: BrowserLeasePush) => void): () => void
  stop(nodeId: string): void
  stopAll(): void
  stopProject(projectId: string): void
}

/** Browser control operations for the agent-driven browser node surface. */
export interface BrowserControlApi {
  /** Push: the current set of browser nodes an agent is driving (chip / rope / kill row). `stopped`
   *  ids drop from the chip immediately, skipping the anti-flicker linger. */
  onLeaseChanged(listener: (push: BrowserLeasePush) => void): () => void
  /** Stop agent control of ONE browser node — the chip button and the node context menu. Detaches
   *  the debugger + drops the lease in main; a later drive from that owner is refused by name. */
  stop(nodeId: string): void
  /** Stop agent control of EVERY driven node — the Settings kill row's Stop-all. */
  stopAll(): void
  /** Stop agent control of every node in a project — the project's browser-control switch going off. */
  stopProject(projectId: string): void
}

/** A user-defined agent (BYO CLI). With no `baseAgent` it is in no capability list, so it gets
 * only spawn + terminal-title + process status (no hooks/branch/loop/bridge). With a `baseAgent`
 * it inherits that builtin harness's capabilities (hooks, resume, permission modes, canvas
 * control) and prompt convention — the use case being a harness-compatible CLI pointed at your
 * own inference proxy, where you want to KEEP nodeterm's integration while redirecting the calls. */
export interface CustomAgent {
  /** Stable id of the form 'custom:<uuid>'. Used as the node's agentId. */
  id: string
  label: string
  /** Base launch command. Blank when `baseAgent` is set means "use the base harness's command"
   * (so a claude-compatible proxy needs zero launch config). */
  launchCmd: string
  /** Prompt convention. Optional: inherited from `baseAgent` when set, else defaults to 'argv'. */
  promptInjectionMode?: PromptInjectionMode
  /** Optional builtin harness to inherit capabilities + prompt convention from. */
  baseAgent?: BuiltinAgentId
  /** Env vars injected at spawn, merged LAST so they win over hook/account env (required for the
   *  proxy case — your ANTHROPIC_AUTH_TOKEN must beat any account env). Values support
   *  `${env:VAR}` / `${env:VAR:fallback}` expansion at spawn time against the live OS env. */
  env?: Record<string, string>
  /** Extra argv inserted after `launchCmd`, before the prompt/flags. Free-text, shell-split.
   *  Supports `${env:…}` expansion. Blank = none. */
  args?: string
  /** Node color. Falls back to `baseAgent`'s color (or the default grey). */
  color?: string
}

/**
 * A managed Claude account. Its credentials/config live in a private config dir
 * ({userData}/claude-accounts/<id>, or `~/.nodeterm/claude-accounts/<id>` on `host` for
 * remote accounts) injected as CLAUDE_CONFIG_DIR at spawn. The claude CLI owns login,
 * credential storage, and token refresh inside that dir — we never write credentials.
 */
export interface ClaudeAccount {
  id: string
  /** Display label; defaults to the captured email. */
  label: string
  email?: string
  /** Set only for remote (SSH) accounts: the ssh host this account's config dir lives on. */
  host?: string
  /** True until `claude /login` completes in the account dir and the email is captured. */
  pending?: boolean
  /** Optional default node color for nodes opened under this account. */
  color?: string
  createdAt: number
}

/**
 * Automatic account selection for NEW Claude nodes. The policy never changes an existing node or
 * a live CLI process. `hysteresisPercent` keeps a high account from being selected again until it
 * has recovered below the lower boundary, while `cooldownMinutes` prevents rapid launch churn.
 */
export interface ClaudeAccountRotationSettings {
  enabled: boolean
  /** Rotate when the selected account's most urgent usage limit reaches this percentage. */
  thresholdPercent: number
  /** Re-arm a source after it falls this many points below the threshold. */
  hysteresisPercent: number
  /** Minimum time between rotations from the same source account. */
  cooldownMinutes: number
}

/** A managed Codex/ChatGPT login with its own CODEX_HOME and one shared app-server. */
export interface CodexAccount {
  id: string
  label: string
  email?: string
  /** Set only for remote accounts; credentials and daemon live on this SSH host. */
  host?: string
  /** Default working directory for this account's nodes on its SSH host. */
  remoteCwd?: string
  /** True until the official `codex login --device-auth` flow completes. */
  pending?: boolean
  createdAt: number
}

export interface SpeechSettings {
  engine: 'whisper' | 'cloud'
  /** WhisperModelInfo id — meaningful while engine === 'whisper'. */
  model: string
  /** BCP-47-ish hint or 'auto'. */
  language: string
  /** Press-to-talk / hold-to-talk shortcut, canonical form e.g. "Cmd+Alt+D" (keyed = toggle) or
   *  "Cmd+Alt" (v3, modifier-only = hold-to-talk — the new DEFAULT); see `shared/shortcut.ts`
   *  (`isHoldChord` derives the mode from the string, not a separate setting). "Cmd" is
   *  platform-abstracted: metaKey on mac, ctrlKey elsewhere. Drives the Canvas listener, the
   *  Dock mic tooltip, and the ShortcutsPanel row. */
  shortcut: string
}

/** A user-selected alert sound kept as bounded base64 data so Desktop and Server Edition can
 * replay the same bytes without relying on a path from the wrong machine. */
export interface CustomAlertSound {
  name: string
  mime: string
  dataBase64: string
}

export type AlertSoundKind = 'done' | 'needsYou'

/** xterm cursor shapes, mirrored here so `Settings` doesn't depend on the xterm typings (which
 *  are renderer-only — `src/shared` is imported by main and the server shell too). */
export type TerminalCursorStyle = 'block' | 'bar' | 'underline'
export type TerminalCursorInactiveStyle = TerminalCursorStyle | 'outline' | 'none'

/** Which language(s) the spoken narrator speaks (docs/narrator.md). 'both' speaks English then
 *  Cantonese, strictly serialized — never overlapping. */
export type NarratorLanguage = 'en' | 'yue' | 'both'
/* -----------------------------------------------------------------------------------------------
 * Per-element appearance customization (docs/appearance.md).
 *
 * One style bag shape (`AppearanceTextStyle`) covers every themeable UI-chrome element (tabs, node
 * headers, panels, menus, notifications, the editor's own dialog). It is applied by
 * `renderer/lib/appearance/apply.ts` through a single generated stylesheet keyed by
 * `[data-appearance-id]`, so a new themeable element only has to carry that attribute — no new
 * plumbing per element. Every property is OPTIONAL: unset means "inherit the platform default",
 * never "off" — clearing a property in the editor removes the key entirely rather than writing a
 * value that forces it back to a baseline, which is what lets "reset per property" mean anything.
 */
export type AppearanceUnderlineStyle = 'none' | 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy'
export type AppearanceStrikethrough = 'none' | 'single' | 'double'
export type AppearanceCapitalization = 'none' | 'uppercase' | 'lowercase' | 'capitalize' | 'small-caps'
export type AppearanceVerticalAlign = 'baseline' | 'super' | 'sub'
export type AppearanceTextAlign = 'left' | 'center' | 'right' | 'justify'
export type AppearanceDirection = 'ltr' | 'rtl'

/** Variable-font axis values (`font-variation-settings`). Not every installed font defines every
 *  axis — an axis a font doesn't have is simply ignored by the text renderer, per CSS spec, so
 *  the value is kept and reapplied rather than dropped even when it currently has no effect. */
export interface AppearanceFontAxes {
  wght?: number
  wdth?: number
  slnt?: number
  ital?: number
  opsz?: number
}

/** The CSS blend modes worth exposing: every one is a real `mix-blend-mode` value. */
export const APPEARANCE_BLEND_MODES = [
  'normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn',
  'hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'
] as const
export type AppearanceBlendMode = (typeof APPEARANCE_BLEND_MODES)[number]

export interface AppearanceTextStyle {
  fontFamily?: string
  fontSizePx?: number
  fontWeight?: number
  fontAxes?: AppearanceFontAxes
  italic?: boolean
  underline?: AppearanceUnderlineStyle
  underlineColor?: string
  strikethrough?: AppearanceStrikethrough
  overline?: boolean
  capitalization?: AppearanceCapitalization
  verticalAlign?: AppearanceVerticalAlign
  baselineShiftPx?: number
  color?: string
  highlightColor?: string
  outlineColor?: string
  outlineWidthPx?: number
  shadowColor?: string
  shadowBlurPx?: number
  shadowOffsetXPx?: number
  shadowOffsetYPx?: number
  glowColor?: string
  glowBlurPx?: number
  letterSpacingPx?: number
  wordSpacingPx?: number
  lineHeight?: number
  direction?: AppearanceDirection
  textAlign?: AppearanceTextAlign
  backgroundColor?: string
  borderColor?: string
  borderRadiusPx?: number
  /** --- Compositing and effects. Non-destructive: every one of these is an unset-by-default
   *  override that composes with, rather than replaces, whatever the element already renders. */
  opacity?: number
  blendMode?: AppearanceBlendMode
  filterBrightness?: number
  filterContrast?: number
  filterSaturate?: number
  filterHueRotateDeg?: number
  filterBlurPx?: number
  filterGrayscale?: number
  filterInvert?: number
  filterSepia?: number
  backdropBlurPx?: number
  /** --- Transform. Composed in a fixed order (translate, rotate, scale, skew) so two editors
   *  cannot disagree about what a saved entry means. */
  translateXPx?: number
  translateYPx?: number
  rotateDeg?: number
  scaleX?: number
  scaleY?: number
  skewXDeg?: number
  skewYDeg?: number
  transformOrigin?: string
}

/** A themed element as persisted in `Settings.elementAppearance`, keyed by a stable id
 *  (`renderer/lib/appearance/registry.ts` → `appearanceId(kind, key)`). */
export interface ElementAppearanceEntry {
  /** Human label captured at first edit (e.g. the tab's name at the time) — shown in the
   *  management list even after the element itself is renamed or deleted. */
  label: string
  /** Element kind ('tab' | 'node' | 'app', …) — informational, drives the management list's
   *  grouping and the editor's title. */
  kind: string
  style: AppearanceTextStyle
  /** Another element's id to inherit UNSET properties from (explicit inheritance). Resolved at
   *  apply time; a cycle is treated as "no inheritance" defensively. */
  inheritFrom?: string
  updatedAt: number
}

/** A named, user-saved style that can be applied to any element and exported/imported as a
 *  standalone JSON file (see docs/appearance.md § Presets). */
export interface AppearancePreset {
  id: string
  name: string
  style: AppearanceTextStyle
  createdAt: number
}

/** Normalized crop rectangle, 0..1 relative to the SOURCE image's natural dimensions — resolution
 *  independent, so re-processing at a different output size never has to rescale it. */
export interface AppLogoCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface AppLogoCustomImage {
  /** Processed (cropped/composited) PNG, local data URL — never uploaded, never a remote asset. */
  dataUrl: string
  mime: string
  /** Output pixel dimensions of `dataUrl` (post-processing, not the source file's). */
  width: number
  height: number
  /** Original filename, kept only for the "Replace" UI's own label — never sent anywhere. */
  sourceName: string
  fit: 'contain' | 'cover' | 'fill'
  /** Flattened backdrop for `contain`/transparent-unsupported previews (a hex or rgba() string). */
  backgroundColor: string
  crop: AppLogoCrop
}

export interface AppLogoSettings {
  /** 'shipped' = the built-in mark; a preset id from `APP_LOGO_PRESETS`; or 'custom'. */
  selection: string
  customImage?: AppLogoCustomImage
}

export interface DockerHostSettings {
  /** Docker CLI context name. Empty means Docker's current context. */
  context: string
  /** Allowlisted image reference selected by the guided host surface. */
  image: string
  containerPrefix: string
  mountMode: 'readonly' | 'writable'
  cpus: number
  memoryMb: number
  pidsLimit: number
  network: 'none' | 'bridge'
  workdir: '/workspace'
}

/**
 * ADHD modes — five independent interface accommodations, all off by default.
 *
 * Independent on purpose: someone may want a quieter interface without time nudges, or want the
 * nudges precisely because they are hyperfocusing. One master switch means most people turn the
 * whole thing off to escape the single part that does not suit them.
 *
 * Named for what each one DOES, not for who it is for, so a person can use one without disclosing
 * anything to a colleague reading over their shoulder. These are interface accommodations, never
 * medical: no diagnosis, no assessment, no advice, no claim of clinical benefit.
 *
 * Logic lives in `renderer/lib/adhdModes.ts`; every field here is re-validated on read because
 * settings.json is hand-editable and these values reach CSS properties and timer comparisons.
 */
export interface AdhdModes {
  /** Spotlight the focused node and fade the rest. Dims — never hides. */
  focus: boolean
  /** Less motion, quieter colour, and only notifications that genuinely need a person. */
  lowStimulation: boolean
  /** Show elapsed time where the work is, because time blindness is not helped by a clock in a menu. */
  timeAwareness: boolean
  /** One visible, user-chosen next action that survives a context switch. */
  oneThing: boolean
  /** A dismissible, factual note when something has sat untouched. Never a verdict. */
  momentum: boolean
  /** How much to fade unfocused nodes, 0.1–0.8. Capped so an unfocused node stays visible. */
  focusDim: number
  /** Minutes untouched before the momentum note appears, 5–240. */
  momentumMinutes: number
  /** The person's own next action, in their words. Bounded to 200 characters. */
  oneThingText: string
  /** "Not now", respected until this timestamp rather than until the next render. */
  snoozeUntilMs: number | null
}

/**
 * One terminal node "escaped" from the canvas into its own always-on-top-configurable desktop
 * widget window (see `main/canvas-widget-window.ts`, `renderer/widget/WidgetApp.tsx`). The widget
 * is a SECOND live view of the SAME tmux/session-host session the canvas node owns — the exact
 * viewer-identity co-attach mechanism the kanban card modal already uses (`ModalTerminal.tsx`) —
 * never a copy, and closing it never destroys the underlying session (see the widget-open/close
 * IPC handlers in `main/canvas-widget-window.ts`, which call no pty destroy/kill on window close).
 */
export interface CanvasWidgetState {
  /** Stay above other windows while the widget is open. User-configurable, both when opening the
   *  widget and while it is open; persists per node. */
  alwaysOnTop: boolean
  /** Window bounds in OS screen coordinates, persisted per node so re-opening the SAME node's
   *  widget reuses its last position/size. Absent until the widget has been moved/resized once. */
  bounds?: { x: number; y: number; width: number; height: number }
}

/** User-configurable application settings (settings.json). */
export interface Settings {
  /** Versioned settings shape. Version 2 expands funny levels to 1–10 while preserving every
   * valid persisted value from the five-level shape. */
  settingsSchemaVersion: typeof SETTINGS_SCHEMA_VERSION
  /** ADHD modes — five independent accommodations, all off by default. See `AdhdModes`. */
  adhdModes: AdhdModes
  dockerHost: DockerHostSettings
  /** Provider-neutral hosted tunnel observations. Secrets, provider sessions, process state,
   *  machine paths, and host-specific identifiers are intentionally excluded. */
  tunnelState: TunnelStateSnapshot
  fontSize: number
  fontFamily: string
  /** Characters that end a word during xterm double-click selection. */
  terminalWordSeparator: string
  cursorBlink: boolean
  /** Appearance of the APP chrome (tab bar, panels, node headers, menus). `auto` (the default)
   *  takes it from the terminal colour theme, so picking a light terminal theme doesn't leave a
   *  black window framing it; `dark`/`light` pin it. See renderer/lib/appTheme.ts. */
  appTheme: 'auto' | 'dark' | 'light'
  /** Scale factor for the whole application UI (1 = 100%; issue #299, 4K readability). Applied as
   *  PAGE ZOOM (`webFrame.setZoomFactor`) on desktop, so menus, node headers, dialogs — and
   *  terminal glyphs — all scale together: the terminal font-size setting stays in CSS px, so its
   *  effective size is fontSize × uiScale (the Settings row says so). Hand-editable; every reader
   *  resolves it through `resolveUiScale` (shared/ui-scale.ts), which clamps to [0.5, 2] and maps
   *  garbage to 1. Server Edition: intentionally inert — the browser owns page zoom (Cmd/Ctrl+±). */
  uiScale: number
  /** Reflect the active session in the NATIVE window title ("<node> — <project> — node-terminal"),
   *  so window-title-based time trackers (ActivityWatch et al.) can tell sessions apart — the same
   *  thing iTerm2 / Windows Terminal do per tab (issue #414). Opt-in and OFF by default: the title
   *  is OS-visible surface area (window switchers, screen sharing), so an update must not start
   *  broadcasting session names for users who never asked. Renderer-only (`document.title` —
   *  Electron mirrors page-title changes onto the BrowserWindow, and the Server Edition gets the
   *  browser tab title through the identical write), so there is no bridge member to stub. */
  windowTitleActiveSession: boolean
  /** Terminal colour scheme — an id from `renderer/terminal/themes.ts`. Resolution is tolerant
   *  (settings.json is hand-editable): an unknown id falls back to the default theme, whose
   *  colours reproduce the pre-feature hardcoded `#1e1e1e`/`#e6e6e6` exactly. */
  terminalTheme: string
  /** Weight for normal text. xterm's own default is `normal` (400). */
  fontWeight: number
  /** Weight for BOLD text. xterm's own default is `bold` (700). Lowering it is how you keep bold
   *  legible in a thin font that renders 700 as a smear. */
  fontWeightBold: number
  /** Render bold text in the palette's BRIGHT colours (xterm's default, and the historical
   *  terminal convention). Off keeps bold purely a weight, so colour still means what the program
   *  said it meant. */
  drawBoldTextInBrightColors: boolean
  /** Minimum foreground/background contrast ratio, 1–21. 1 (xterm's default) disables the
   *  adjustment entirely; 4.5 is WCAG AA, 7 is AAA, 21 forces black or white. Costs per-cell work
   *  in the renderer, so it stays off unless asked for. */
  terminalMinContrast: number
  /** Cursor shape. */
  cursorStyle: TerminalCursorStyle
  /** Cursor shape while the terminal does NOT have focus. `outline` (xterm's own default) is what
   *  tells you at a glance which of a canvas full of terminals is taking your keystrokes. */
  cursorInactiveStyle: TerminalCursorInactiveStyle
  /** Line height as a multiple of the font size (1 = xterm's default, i.e. no extra leading). */
  terminalLineHeight: number
  /** Extra horizontal space between cells, in CSS pixels (0 = xterm's default). */
  terminalLetterSpacing: number
  /** Stable profile used for newly created local Windows terminals. */
  defaultTerminalProfileId: string
  /** Compatibility field for the custom profile executable. Empty string = no custom executable. */
  defaultShell: string
  /** User-owned local profiles used when creating terminals or agent nodes. */
  namedTerminalProfiles: NamedTerminalProfile[]
  /** Profile selected for one-click local terminal and agent creation, or null for none. */
  defaultNamedTerminalProfileId: string | null
  gridSize: number
  /** Drag-time snap: while ON, dragging a node rounds its position to the grid. A live editor in
   *  BehaviorSection; the canvas reads it for the React Flow `snapToGrid` prop. Distinct from
   *  `autoAlignGrid` (a one-shot arrange-all), which is a mode, not a drag constraint. */
  snapToGrid: boolean
  /** Snap-to-grid MODE (like a desktop "Auto arrange"): while ON, every node is snapped to the
   *  grid at the moment the mode is turned on (the existing one-shot `alignToGrid` run over all
   *  node ids). Toggled from the native View menu (with a checkmark) and Settings → Behavior.
   *  Distinct from `snapToGrid` (drag-time snap) — turning this on arranges once; it does not
   *  constrain future drags. v1: arrange-all-on-enable only. */
  autoAlignGrid: boolean
  /** Default size (px) for NEW terminal/agent nodes on the canvas. Existing nodes keep
   *  whatever size they were saved with; other node kinds keep their own defaults. */
  defaultNodeWidth: number
  defaultNodeHeight: number
  /** Sessions sidebar: the DEFAULT for a project row the user never toggled — on (historical)
   *  keeps the active project expanded and collapses the others, off leaves everything expanded.
   *  Explicit toggles live in `sidebarCollapsedItems` and always win. */
  sidebarAutoCollapse: boolean
  /** Persisted disclosure choices for the sessions tree, keyed `project:<id>` and
   *  `project:<id>:group:<groupId>` (true = collapsed). Pruned on every write against the live
   *  tree, so a deleted frame or project cannot grow settings.json forever. */
  sidebarCollapsedItems: Record<string, boolean>
  /** Sessions sidebar top-level grouping. 'project' (the default, the historical behavior) groups
   *  sessions under their project; 'status' flattens across projects and regroups by live agent
   *  status so sessions needing attention float to the top. Remote/relay sessions have no live
   *  status in the sidebar and show as idle in either mode. */
  sidebarGrouping: 'project' | 'status'
  /** Fallback view for projects the user hasn't explicitly toggled (canvas or the kanban board).
   *  Personal machine-local preference; per-project explicit choices override it. */
  defaultProjectView: 'canvas' | 'kanban'
  /**
   * Persisted state for a terminal node "escaped" from the canvas into its own desktop widget
   * window (Windows/Linux/macOS — see `main/canvas-widget-window.ts`). Keyed by node id.
   * Machine-local UI chrome, exactly like `sidebarCollapsedItems` above: never written into the
   * git-shared `project.json` (see `core/workspace-files.ts`'s `ProjectFileV1`/`projectToFile`),
   * because a widget's screen position on THIS machine means nothing on somebody else's. Pruned
   * against live node ids on every write (`pruneCanvasWidgets` in `core/canvas-widget.ts`) so a
   * deleted node's widget state doesn't grow settings.json forever.
   */
  canvasWidgets: Record<string, CanvasWidgetState>
  /** New-worktree path template, resolved relative to the repository root. Supports `$repoName`
   *  (`$reponame` and `$defaultFolderName` aliases) plus `$branch`; both `$x` and `${x}` forms.
   *  A missing branch token is appended automatically. */
  worktreePathTemplate: string
  /** ms to dwell over a terminal before it takes pointer focus (pan-across guard). */
  panHoverDelay: number
  /**
   * Rainbow node-colour speed, 1 (slow drift) to 5 (fast). Stored as a level rather than a
   * duration because seconds are a unit nobody has an intuition for, and because a control where a
   * bigger number means slower is a control people fight. The level-to-seconds mapping lives in
   * renderer/lib/nodeColor.ts so the setting and the stylesheet cannot disagree about what 3 means.
   */
  rainbowSpeed: number
  doubleClickFocus: boolean
  /** Open Markdown files in rendered preview instead of the editor. The node Preview/Edit
   *  toggle and markdown shortcut still work either way. Existing files are migrated once. */
  openMarkdownPreview: boolean
  /** One-shot marker for the default-on Markdown preview migration. */
  openMarkdownPreviewMigrated: boolean
  /**
   * Let a MIDDLE CLICK inside a terminal paste (Linux in practice — macOS and Windows have no
   * PRIMARY selection and no tmux middle-click habit, so the guard changes nothing visible there).
   *
   * OFF by default, and OFF means the middle button is fully INERT inside a terminal — tmux's own
   * middle-click paste included. That is a consequence of the real mechanism (issue #84, measured
   * on the reporting machine): the paste never happens in the browser. xterm forwards a mouse
   * report for the middle button and something DOWNSTREAM of the pty consumes it — tmux's root
   * `MouseDown2Pane` binding pastes tmux's buffer at a shell prompt, and an agent TUI reads the X
   * PRIMARY selection itself. There is no browser default action to cancel, so the guard swallows
   * the event before xterm can forward it (`guardMiddleClickPaste`), and tmux's paste necessarily
   * goes with it. The default stays off because the paste fires hardest inside agent TUIs: a stray
   * click drops whatever was last selected anywhere on the machine into a live agent prompt.
   */
  terminalMiddleClickPaste: boolean
  /** Plain mouse wheel zooms the canvas (no Cmd/Ctrl needed). On macOS a two-finger trackpad
   *  scroll keeps panning independently (see canvas/wheel-gesture.ts), so mouse and trackpad
   *  coexist; elsewhere this still trades away scroll-to-pan, so it stays opt-in. */
  wheelZoom: boolean
  /** Multiplier for plain-wheel zoom exponent, bounded to 0.2–2 at point of use. The historical
   *  feel is preserved at 1; modifier zoom and trackpad pinch always use the fixed multiplier. */
  wheelZoomSpeed: number
  /** macOS only: a two-finger trackpad scroll pans the canvas, independently of `wheelZoom`
   *  (see canvas/wheel-gesture.ts). Off restores the pre-router behavior — `wheelZoom` alone
   *  decides — which is also the recourse for a precise-pixel MOUSE that reads as a trackpad. */
  trackpadPan: boolean
  /** What a left-drag on EMPTY canvas does. 'select' (default) rubber-band selects, like
   *  Figma's move tool — pan stays on middle-drag / two-finger scroll. 'pan' drags the map
   *  directly (grab cursor), for mouse users who pan constantly; box-select then moves to
   *  Shift+drag (React Flow's selectionKeyCode). */
  canvasDragMode: 'select' | 'pan'
  /**
   * Browser memory saver: release a browser/web node's page after it has been hidden for
   * `BROWSER_DISCARD_MS` (5 min), reloading it from its URL when it is shown again. Each
   * `<webview>` is a whole Chromium renderer process and the canvas caps nothing, so an
   * afternoon of opened pages is otherwise permanently resident. On by default — the cost is a
   * reload (and the lost back/forward stack, which a webview cannot serialize), not lost work.
   */
  browserMemorySaver: boolean
  accent: string
  tmuxEnabled: boolean
  /**
   * Reach a released tmux session with a control-mode (`tmux -C`) client instead of respawning its
   * terminal — the shadow clients in pty-manager.ts (`shadowAttach`) and the shared background-write
   * client behind `backgroundWrite`. A control client holds ZERO pty devices, which is the whole
   * point: the machine-wide `kern.tty.ptmx_max` ceiling is what a canvas of idle terminals runs into
   * first (see pty-devices.ts).
   *
   * ON by default, and read at those two entry points only: switching it off means this process
   * spawns no `tmux -C` child at all, and a released session is simply unreachable again — exactly
   * the behavior of the release before it. It is a kill switch for one soak release, not a feature
   * toggle: nothing user-visible depends on it (the mechanism has no production caller yet), so it
   * has no settings row and is flipped in settings.json.
   */
  ptyShadowClients: boolean
  /** GPU (WebGL) terminal rendering. 'off' routes every terminal to xterm's DOM renderer.
   *  'auto' (default) = one WebGL context PER TERMINAL everywhere except macOS, where it is
   *  'shared'. Repeated macOS field reports (whole-window flicker; terminals compositing black
   *  after renderer swaps, with zero JS-visible errors) point at the OS compositor mishandling
   *  many live WebGL canvases — which is why per-terminal WebGL stays a deliberate opt-in ('on')
   *  there, and why the ONE-context renderer is what macOS defaults to instead. Legacy boolean
   *  values are migrated on load: `false` (an explicit escape-hatch choice) → 'off'; `true`
   *  (indistinguishable from the old merged-in default) → 'auto'.
   *
   *  'shared' is the glyphgrid renderer: instead of one WebGL context per terminal (which is what
   *  the ~16-context cap and the whole budget coordinator exist to ration), every terminal on the
   *  canvas paints into ONE canvas-wide context. Promoted out of experimental on 2026-08-05 after
   *  the device checklist + soak; any failure still drops the session back to xterm's DOM
   *  renderer. See `resolveTerminalRenderer` (shared/webgl.ts) for the full history. */
  terminalGpuRendering: 'auto' | 'on' | 'off' | 'shared'
  tmuxScrollback: number
  /** Characters that END a word on double-click. See src/shared/word-separators.ts — this one
   *  setting reaches THREE writers (xterm, local tmux, remote tmux), because tmux owns the mouse
   *  and an xterm-only change would be a no-op for the common case. */
  terminalWordSeparators: string
  /** OPT-IN lead-pane width for Claude Code agent teams (issue #119). 0 = off (default): the
   *  generated tmux confs stay byte-identical to their pre-feature output — no `set-hook` at all.
   *  40–90 = emit guarded after-resize-pane / after-split-window hooks (shared/tmux-lead-pane.ts)
   *  that keep the lead pane at this % of the node width when CC's team backend re-applies its
   *  hardcoded 70/30 split. Hand-editable; re-validated at the conf-generation site
   *  (`sanitizeLeadPaneWidth`). Honest side effect while on: a manual 50/50 split in a plain
   *  terminal node is nudged to the target too. */
  tmuxLeadPaneWidth: number
  /** Minutes a terminal may sit fully offscreen before its xterm+PTY client is torn down in
   *  place (tmux keeps the session; re-approach reattaches and redraws). 0 = never. */
  offscreenTerminalMinutes: number
  /** When true, a LOCAL project's `.nodeterm/project.json` is saved as sized parts + a manifest
   *  (see src/core/project-parts.ts) instead of one growing file. This governs future saves only:
   *  an already-split project keeps saving as parts even if this is later turned off, and an
   *  already-single-file project stays single-file until explicitly split. Turning this on does
   *  not retroactively split an existing project — see WorkspaceStore's split/join operations. */
  projectPartsEnabled: boolean
  /** User-chosen part size, paired with `projectPartSizeUnit`. Clamped to a sane floor/ceiling by
   *  `partSizeBytesFromSetting` wherever it is consumed — this field itself may hold anything a
   *  hand-edited settings.json contains. */
  projectPartSizeValue: number
  projectPartSizeUnit: 'KB' | 'MB' | 'GB'
  /** AI commit message agent: a local coding-agent CLI run read-only. */
  commitAgent: 'claude' | 'codex' | 'custom'
  /** For commitAgent='custom': command template; {prompt} placeholder optional (else stdin). */
  commitAgentCommand: string
  /** Extra instructions appended to the commit prompt (e.g. Conventional Commits). */
  commitExtraPrompt: string
  /** Whether the shortcuts overlay has been shown on first launch. */
  seenShortcuts: boolean
  /** Whether the first-run setup tour (onboarding) has been completed or skipped. Existing
   *  installs (seenShortcuts already true) are migrated to true silently — the tour is for
   *  fresh installs; rerunnable via the ⌘K "Setup tour" command. */
  seenOnboarding: boolean
  /** Notify (OS notification) when a Claude Code turn finishes while the app is in the background. */
  notifyOnClaudeDone: boolean
  /** Allow an authenticated, context-linked agent to send a fixed inbox-check notification. */
  agentInboxNotifications: boolean
  /** Periodically `git fetch` while the Source Control panel is open, so ahead/behind stays
   *  accurate (remote/SSH projects fetch on the remote). */
  gitAutoFetch: boolean
  /** Whether the one-time notification consent prompt has been shown. */
  notifyConsentAsked: boolean
  /** Play a retro sound effect when a turn finishes / a session needs you (renderer/lib/sfx.ts).
   *  Unlike OS notifications this fires whether or not the window is focused — the point is to
   *  catch a finish while you're looking at ANOTHER node. Throttled per node. */
  soundEffects: boolean
  /** Sound-effect volume, 0..1. */
  soundVolume: number
  /** Optional per-event sound files. Empty entries use the synthesized built-in sound. */
  customAlertSounds: Partial<Record<AlertSoundKind, CustomAlertSound>>
  /** User-defined agents (BYO CLI) appended to the Add menus. */
  customAgents: CustomAgent[]
  /** Per-builtin-agent launch command overrides (Settings → Agents → Launch commands). The value
   *  replaces the bare CLI name everywhere a launch line is built — new sessions, cold-restore
   *  relaunches, in-place restarts, hibernation wakes and the transcript-search resume — with the
   *  usual flags (`--resume`, `--permission-mode`, the prompt) appended after it, so a wrapper
   *  script that picks an account or sets env vars runs wherever the agent would. Empty/absent =
   *  the builtin default, byte-identical to before this setting existed. Keyed by builtin id only
   *  — custom agents already own their `launchCmd`. Local only: never present in the git-shared
   *  `.nodeterm/project.json` (see `src/shared/node-exec.ts`). */
  /** One gateway root + non-secret credential reference used by model-switch-capable harnesses. */
  modelGateway: ModelGatewaySettings
  /** Per-builtin-agent launch command overrides (Settings → Agents → Launch commands). The value
   *  replaces the bare CLI name everywhere a launch line is built — new sessions, cold-restore
   *  relaunches and in-place restarts, with the usual flags (`--resume`, `--permission-mode`, the
   *  prompt) appended after it — so a wrapper script that picks an account or sets env vars runs
   *  wherever the agent would. Empty/absent = the builtin default, byte-identical to before this
   *  setting existed. Keyed by builtin id only: custom agents already own their `launchCmd`. */
  agentLaunchCommands: Partial<Record<BuiltinAgentId, string>>
  /** Managed Claude accounts (config-dir isolated). See ClaudeAccount. */
  claudeAccounts: ClaudeAccount[]
  /** Managed Codex accounts (CODEX_HOME isolated, machine-scoped by `host`). See CodexAccount.
   *  Renderer-owned in settings.json exactly like `claudeAccounts`; main owns only fs lifecycle. */
  codexAccounts: CodexAccount[]
  /** Custom display label for the SYSTEM Claude account (~/.claude) in pickers/settings.
   *  Empty = unset → fall back to the detected login email, else "System account". */
  systemAccountLabel: string
  /** Display label for the system Codex account (~/.codex). */
  systemCodexAccountLabel: string
  /** Per-SSH-host display labels for each host's default ~/.claude login. */
  remoteSystemAccountLabels: Record<string, string>
  /** Per-SSH-host display labels for each host's default ~/.codex login. */
  remoteSystemCodexAccountLabels: Record<string, string>
  /** Agent ids hidden from the Add menus. */
  disabledAgents: AgentId[]
  /** Usage providers hidden from the pill + popover (Settings → Usage toggles). Hiding is a
   *  DISPLAY choice — credentials and fetchers are untouched, so re-enabling is instant. */
  hiddenUsageProviders: string[]
  /** Ids of node right-click menu rows the user has hidden; empty = everything visible. Only ids
   *  in HIDEABLE_MENU_ITEMS (renderer/lib/ui-visibility.ts) can hide — Delete and the other
   *  recovery actions stay put whatever this array says. */
  hiddenNodeMenuItems: string[]
  /** Ids of terminal node header buttons the user has hidden; empty = everything visible. Gated by
   *  HIDEABLE_HEADER_BUTTONS the same way. */
  hiddenHeaderButtons: string[]
  /** Whether project activation offers the "Resume where you left off" card (breadcrumb trail's
   *  once-per-app-run popup). OFF by default — it interrupts every project switch, so it is
   *  opt-in. Cmd+[ / Cmd+] and the Dock buttons walk the trail regardless of this. */
  showResumeCard: boolean
  /** Whether usage percentages render as consumed ("32% used"), remaining ("68% left"), or raw
   *  token counts ("48k/200k tokens" — context-window surfaces only; provider quota surfaces
   *  have no token counts and fall back to 'used' display). 'remaining' is the historical
   *  default; users coming from other tools expect 'used'. */
  usagePercentMode: 'used' | 'remaining' | 'tokens'
  /** Rotate new default Claude nodes when the selected account reaches this usage threshold. */
  claudeUsageRotationEnabled: boolean
  /** Percentage threshold for default-account rotation, bounded to 1..100 at use time. */
  claudeUsageRotationThreshold: number
  /** Which agent the ⌘⇧C shortcut / quick-add launches. Always a launchable builtin. */
  defaultAgent: AgentId
  /** The permission mode Claude TERMINAL (CLI) sessions START in — passed as `--permission-mode`
   *  at launch; Shift+Tab still cycles modes at runtime. SDK chat nodes are NOT covered (the chat
   *  driver runs in `default`). Overridable per project via Project.defaultPermissionMode.
   *  `auto` is version-gated: CLIs below 2.1.71 reject the value, so it degrades to no flag. */
  claudePermissionMode: AgentPermissionMode
  /** When enabled, every fresh eligible agent launch strips gateway/provider overrides. */
  vanillaLaunchDefault: boolean
  /** "Eco": exit the agent CLI of a session that has been idle AND offscreen for
   *  `agentHibernationIdleMinutes`, reclaiming its RAM; the conversation is resumed automatically
   *  when the node is viewed again. Default OFF — opt-in, because it stops a real process.
   *  Scheduled/loop agents and sessions with live subagents are never touched
   *  (renderer/terminal/hibernation-policy.ts explains why). */
  agentHibernationEnabled: boolean
  /** How long a session must be idle + offscreen before "Eco" hibernates it (minutes). */
  agentHibernationIdleMinutes: number
  /** Opt-in (default OFF — nothing changes unless this is turned on). Claude Code's own tmux
   *  backend for agent teams hardcodes the geometry of the pane the user actually types into: it
   *  runs `split-window -h -l 70%` for the first teammate, then `select-layout main-vertical` +
   *  `resize-pane -t <leadPane> -x 30%` for every later one — so with several teammates the pane
   *  you type in is squeezed down to 30% while narrower and narrower teammate panes take the rest.
   *  There is no Claude Code setting for this; nodeterm never calls `split-window`,
   *  `select-layout` or `resize-pane` itself, so any pane split in a session's tmux window came
   *  from Claude's own team backend (or, rarely, the user's own manual `tmux split-window`).
   *  When on, nodeterm widens that lead pane (tmux pane index 0 — see
   *  `shared/agents/team-pane-layout.ts`) back to `agentTeamLeadPaneWidthPercent`.
   *  Claude re-applies its own 30% split on EVERY later teammate spawn, so the correction is
   *  re-applied the same way — every time a new teammate pane is observed, not once — rather than
   *  being undone by the next one. Tmux-backed local sessions only: the Windows session-host
   *  fallback has no split-window/resize-pane primitive, so a node running on it is unaffected. */
  agentTeamLeadPaneWidthEnabled: boolean
  /** Percentage width to give the lead pane when `agentTeamLeadPaneWidthEnabled` is on. */
  agentTeamLeadPaneWidthPercent: number
  /** Send anonymous usage data (version/OS) to the telemetry backend. Opt-OUT (default on):
   *  version/OS only, nothing personal, client IP never stored. Turn it off in Settings → Privacy
   *  (or hard-disable with DO_NOT_TRACK / NODETERM_TELEMETRY_DISABLED). Note: a lighter anonymous
   *  install count also rides the /v1/check call and is NOT gated on this toggle — see core/check.ts. */
  telemetryEnabled: boolean
  /** Unlock every capability. Default ON and free — nobody ever pays a penny to use this app, so
   *  there is no purchase, licence, subscription, lapsing trial, or paywalled feature behind it.
   *
   *  The lock exists for ONE reason: speed. A locked app runs fewer features and does less
   *  background work, so it lags less on an older or busy machine and uses less battery. It is a
   *  performance choice the user makes, never a payment one — locking takes nothing away
   *  permanently and unlocking never costs anything. Settings → Features. */
  proFeaturesEnabled: boolean
  /** Sub-gate under `proFeaturesEnabled` (same pattern as `mobilePushEnabled`'s sub-gates below).
   *  Default ON. Covers remote-access hosting (a standing connection to the relay while it waits
   *  for a peer) AND the larger local dictation models — Base/Small/Large v3 Turbo, several
   *  hundred MB of memory once loaded — because both currently ride the app's one legacy
   *  `isPremium` signal (see renderer/state/entitlement.ts). Turning the MASTER switch off forces
   *  this off too, without touching the value stored here — turning the master back on restores
   *  exactly what this was set to. Settings → Features. */
  proFeatureRemoteAccessEnabled: boolean
  /** Sub-gate under `proFeaturesEnabled` AND `proFeatureRemoteAccessEnabled` — a seat is a feature
   *  OF remote access, so it can never be effectively on while remote access itself is off. Caps
   *  `useEntitlement().seats` at 0 when off, so extra teammates can't join the standing connection
   *  above even while remote access itself stays on. Default ON. Settings → Features. */
  proFeatureTeamSeatsEnabled: boolean
  /** Debug log panel (issue #78): captures the app's own console into an in-memory, redacted
   *  ring and unlocks the log viewer. Default off — a debugging tool, not a daily surface.
   *  Toggle in Settings → Application → Debug. */
  debugLogPanel: boolean
  /** Keep a standing relay host connection so a paired phone can reach this Mac from anywhere
   *  (end-to-end encrypted). Default on — the host only admits SAS-approved, pinned devices, so
   *  an un-paired install just keeps an idle listener. Toggle in Settings → Phone. */
  phoneAccessEnabled: boolean
  /** Send APNs push notifications to relay-paired phones when an agent needs approval, asks a
   *  question, or finishes a turn (spec: apns-push). Default on — it only fires for users who
   *  have paired a phone. Toggle in Settings → Notifications. */
  mobilePushEnabled: boolean
  /** Push when an agent needs you: approval requests + questions. Default on. Sub-gate under
   *  `mobilePushEnabled` (the master switch). Toggle in Settings → Notifications. */
  mobilePushNeedsYou: boolean
  /** Push when an agent finishes a turn (the `done` kind). Default on. Sub-gate under
   *  `mobilePushEnabled` (the master switch). Toggle in Settings → Notifications. */
  mobilePushDone: boolean
  /** Stream Live Activity updates (Lock Screen / Dynamic Island) to paired phones as a session's
   *  state + activity + context% change (spec: interactive-push-live-activities). Default on.
   *  Sub-gate under `mobilePushEnabled` (the master switch). Toggle in Settings → Notifications. */
  mobileLiveActivities: boolean
  /** Hold phone ALERTS while you're actively at this computer, releasing them when you go idle or
   *  lock the screen (spec: presence-aware-push). Default on. Desktop-only (the Server Edition is
   *  headless, so it always sends); the live-update stream is never held. Sub-gate under
   *  `mobilePushEnabled`. Off ⇒ alerts always send immediately (legacy). Toggle in Settings →
   *  Notifications. */
  mobilePushPresenceAware: boolean
  /** Deterministic hook-reply approvals (spec: docs/hook-reply-approvals.md). When on (default),
   *  Claude terminal sessions launch with `NODETERM_PERM_WAIT_SECS` set: the managed permission
   *  hook holds briefly for a phone/canvas Approve/Deny before falling through to the normal
   *  interactive prompt. Off ⇒ the env var is absent ⇒ exact legacy behavior. Claude-only. */
  hookReplyApprovals: boolean
  /** Seamless agent messaging (opt-in, default off): agent-to-agent send/reply requests deliver
   *  without the per-message confirmation dialog. The project capability and main-side delivery
   *  checks still apply, and close always confirms. */
  agentSeamlessWrites: boolean
  /** Hold an idle-sleep power assertion while a LOCAL agent node is working, so long runs
   *  survive an unattended laptop. Released when the last one stops (or goes stale). Cannot
   *  hold through a closed lid. Asked in the setup tour; Settings → Behavior. */
  keepAwakeWhileAgentsWork: boolean
  /** Ask before the app actually quits (⌘/Ctrl+Q, menu Quit, or the Windows/Linux title-bar ×).
   *  The auto-update "Restart to update" flow never asks — that decision was already made.
   *  Settings → Behavior. */
  confirmBeforeQuit: boolean
  /** macOS Notch HUD (docs/notch-hud.md): a transparent always-on-top strip by the notch showing
   *  walking agent mascots while agents work, expanding into a mini session panel. Default on;
   *  macOS + desktop only (ignored on other platforms / Server Edition). */
  notchHud: boolean
  /** Assumed physical notch width in px. macOS exposes no API for it (Electron has no
   *  `auxiliaryTopLeftArea`), so the capsule has to assume one — this is the knob that makes it sit
   *  flush on YOUR Mac. Bigger = the capsule sits further left. */
  notchWidth: number
  /** Expand the notch panel on hover (after a short dwell). Off = click the capsule to expand. */
  notchHoverExpand: boolean
  /** Dictation (desktop/server). Written as a whole object by the renderer. */
  speech: SpeechSettings
  /** Language nodeterm speaks to the user in: English, playful Hong Kong-style Cantonese, or
   *  bilingual (English prominent, Cantonese compact secondary). See src/shared/i18n and
   *  docs/language-modes.md. Applies live — no restart. */
  languageMode: LanguageMode
  /** Funny-level slider for ENGLISH copy, 1 (fully professional) to 10 (maximum playfulness).
   *  Independent of `funnyLevelYue` — a user may want plain English with playful Cantonese, or
   *  the reverse. Applies to every message category, errors and warnings included; only the
   *  VOICE changes, never the facts (see src/shared/i18n/catalog.ts). */
  funnyLevelEn: FunnyLevel
  /** Funny-level slider for CANTONESE copy. See `funnyLevelEn`. */
  funnyLevelYue: FunnyLevel
  /** Decorate dialogs and message boxes with a relevant, non-semantic emoji. Emojis never appear
   *  in buttons, field labels, or other control/accessible-name text — decoration only. Off by
   *  default: the user opts in. */
  showEmojiInDialogs: boolean
  /** Spoken TTS narrator for app events (docs/narrator.md). OFF by default — narration is an
   *  opt-in the user must turn on; the feature itself always ships. */
  narratorEnabled: boolean
  /** Which language(s) the narrator speaks. 'both' speaks English then Cantonese, strictly
   *  serialized (never overlapping) — see renderer/lib/narrator.ts. */
  narratorLanguage: NarratorLanguage
  /** English voice, by its STABLE `voiceURI` (never the display name — names aren't unique and
   *  are localized by the platform). `null` = automatic: the narrator picks the best English
   *  voice available at speak time, re-resolved every time the voice list changes. */
  narratorVoiceEn: string | null
  /** Cantonese voice, by `voiceURI`. `null` = automatic (prefers a `zh-HK` voice; see
   *  `pickAutomaticVoice` in renderer/lib/narrator.ts). */
  narratorVoiceYue: string | null
  /** Speech rate, 0.1–10 (SpeechSynthesisUtterance's own documented range). 1 = the voice's
   *  normal delivery. */
  narratorRate: number
  /** Speech pitch, 0–2 (SpeechSynthesisUtterance's own documented range). 1 = the voice's
   *  normal pitch. */
  narratorPitch: number
  /** Keyboard-shortcut overrides by command id (see shared/keybindings.ts). Absent id = the
   *  command's default bindings; `[]` = disabled. Hand-editable; invalid or conflicting
   *  entries are dropped with a console warning at read time (sanitizeKeybindingOverrides).
   *  Optional and deliberately not in DEFAULT_SETTINGS: absent simply means "no overrides". */
  keybindings?: KeybindingOverrides
  /** Who wins while a terminal has keyboard focus: 'app-first' (default) lets allowInTerminal
   *  app commands fire over an xterm; 'terminal-first' reserves every chord but the terminal's
   *  own (find, copy) for the shell/TUI — including ⌘W/⌘M and the zoom/project-jump gestures. */
  terminalShortcutPolicy: TerminalShortcutPolicy
  /** Command ids whose "this chord was captured from your terminal" notice has been shown
   *  (app-first only, once per command). Optional and absent from DEFAULT_SETTINGS: absent
   *  means none seen. Lives in settings, not localStorage, so Server Edition shares it. */
  seenShortcutCaptureNotices?: string[]
  /** Per-node hook identity enforcement (src/core/agents/node-identity-policy.ts).
   *
   *  One of the three optional keys in this interface, and deliberately so: it is a TRI-state, and the two
   *  non-default states are opposite escape hatches. Absent (the default — it is not in
   *  DEFAULT_SETTINGS) follows `NODE_IDENTITY_STRICT_AFTER`, so the rollout has one schedule for
   *  everybody. `true` opts in to strict enforcement before that date. `false` keeps the warning
   *  window open past it and releases the trust-on-first-proof latch, so a user whose upgrade
   *  strands a live session gets their canvas back without downgrading the app. Neither value ever
   *  admits a forged token. */
  hookIdentityStrict?: boolean
  /** Per-element style overrides (Settings → Appearance → "Appearance editor"), keyed by
   *  `appearanceId(kind, key)`. See the doc block above `AppearanceTextStyle`. */
  elementAppearance: Record<string, ElementAppearanceEntry>
  /** Named, user-saved styles — importable/exportable as a file, applicable to any element. */
  appearancePresets: AppearancePreset[]
  /** User-chosen display name for the app (title bar, brand mark, notifications, About). Empty =
   *  the shipped name. NEVER read for anything that must identify the real product — see
   *  docs/app-rename.md and `shared/appIdentity.ts`. */
  appDisplayName: string
  /** App-logo customization (Settings → Appearance → "App logo"). Presentation only — see
   *  docs/app-logo.md for exactly what this can and cannot change. */
  appLogo: AppLogoSettings
  /** User-configurable keyboard shortcuts, keyed by action id. Seeded from DEFAULT_SHORTCUTS;
   *  merged over defaults on load so a new action simply appears with its shipped combo. */
  shortcuts: ShortcutMap
}

/** The M3-baseline seed colour (design/v2/md3/tokens.css) — `--md-primary`'s literal value in
 *  `styles.css`'s light block. `DEFAULT_SETTINGS.accent` reads it, and `accentTokens.ts`'s
 *  `applyAccentTokens()` compares an incoming accent against it (lowercase, matching what
 *  `toHex()` always produces) to decide whether to skip inline overrides and leave the two
 *  authored dark/light `--md-primary` defaults in charge. Replaces the pre-M3 default,
 *  `#0a84ff` (systemBlue) — see `mergeSettings`'s migration in `core/settings-store.ts` for the
 *  one-time upgrade of an existing install's saved `#0a84ff`. */
export const DEFAULT_ACCENT = '#6750a4'
export const SETTINGS_SCHEMA_VERSION = 2 as const

export const DEFAULT_SETTINGS: Settings = {
  settingsSchemaVersion: 2,
  adhdModes: {
    focus: false,
    lowStimulation: false,
    timeAwareness: false,
    oneThing: false,
    momentum: false,
    focusDim: 0.55,
    momentumMinutes: 20,
    oneThingText: '',
    snoozeUntilMs: null
  },
  dockerHost: {
    context: '',
    image: 'node:24-bookworm-slim',
    containerPrefix: 'nodeterm-host',
    mountMode: 'readonly',
    cpus: 1,
    memoryMb: 1024,
    pidsLimit: 256,
    network: 'none',
    workdir: '/workspace'
  },
  tunnelState: {
    schemaVersion: 1,
    tunnelId: '',
    displayName: '',
    hostname: '',
    originUrl: '',
    generation: 0,
    lifecycle: 'idle',
    stale: false,
    partial: false,
    observedAt: null,
    updatedAt: 0,
    phases: {
      'api-created': { state: 'unknown', checkedAt: null },
      'token-sealed': { state: 'unknown', checkedAt: null },
      'process-running': { state: 'unknown', checkedAt: null },
      'connector-healthy': { state: 'unknown', checkedAt: null },
      'dns-routed': { state: 'unknown', checkedAt: null },
      'access-protected': { state: 'unknown', checkedAt: null },
      'origin-reachable': { state: 'unknown', checkedAt: null },
      'external-reachable': { state: 'unknown', checkedAt: null }
    },
    errors: [],
    history: []
  },
  fontSize: 13,
  fontFamily: 'Menlo, Monaco, Consolas, "Cascadia Mono", "Courier New", monospace',
  // Keep hyphens, underscores, slashes and dots inside words so identifiers and paths select whole.
  terminalWordSeparator: " ()[]{}',\"",
  cursorBlink: true,
  // Every appearance default below reproduces the pre-feature look bit-for-bit: the default theme
  // carries the old hardcoded background/foreground, and block/outline/1/0 are xterm's own
  // defaults. Picking a theme is opt-in — an update must not repaint anybody's terminals.
  // Follows the terminal theme, whose own default is dark — so an install that never touches
  // either setting keeps the dark chrome it has always had.
  appTheme: 'auto',
  uiScale: 1,
  windowTitleActiveSession: false,
  terminalTheme: 'nodeterm-dark',
  fontWeight: 400,
  fontWeightBold: 700,
  drawBoldTextInBrightColors: true,
  terminalMinContrast: 1,
  cursorStyle: 'block',
  cursorInactiveStyle: 'outline',
  terminalLineHeight: 1,
  terminalLetterSpacing: 0,
  defaultTerminalProfileId: 'auto',
  defaultShell: '',
  namedTerminalProfiles: [],
  defaultNamedTerminalProfileId: null,
  gridSize: 24,
  snapToGrid: false,
  autoAlignGrid: false,
  defaultNodeWidth: 640,
  defaultNodeHeight: 440,
  sidebarAutoCollapse: true,
  sidebarCollapsedItems: {},
  sidebarGrouping: 'project',
  defaultProjectView: 'canvas',
  canvasWidgets: {},
  worktreePathTemplate: DEFAULT_WORKTREE_PATH_TEMPLATE,
  panHoverDelay: 600,
  rainbowSpeed: 3,
  doubleClickFocus: true,
  openMarkdownPreview: true,
  openMarkdownPreviewMigrated: true,
  terminalMiddleClickPaste: false,
  wheelZoom: true,
  wheelZoomSpeed: 1,
  trackpadPan: true,
  canvasDragMode: 'pan',
  browserMemorySaver: true,
  accent: DEFAULT_ACCENT,
  tmuxEnabled: true,
  ptyShadowClients: true,
  terminalGpuRendering: 'auto',
  tmuxScrollback: 50000,
  terminalWordSeparators: DEFAULT_WORD_SEPARATORS,
  tmuxLeadPaneWidth: 0,
  offscreenTerminalMinutes: 10,
  projectPartsEnabled: false,
  projectPartSizeValue: 256,
  projectPartSizeUnit: 'KB',
  commitAgent: 'claude',
  commitAgentCommand: '',
  commitExtraPrompt: '',
  // 'app-first' reproduces today's dispatch bit-for-bit: allowInTerminal app commands keep
  // firing over a focused xterm. Opting into 'terminal-first' is the user's call, never ours.
  terminalShortcutPolicy: 'app-first',
  seenShortcuts: false,
  seenOnboarding: false,
  notifyOnClaudeDone: true,
  agentInboxNotifications: false,
  proFeaturesEnabled: true,
  proFeatureRemoteAccessEnabled: true,
  proFeatureTeamSeatsEnabled: true,
  gitAutoFetch: true,
  notifyConsentAsked: false,
  soundEffects: true,
  soundVolume: 0.5,
  customAlertSounds: {},
  customAgents: [],
  modelGateway: { baseUrl: '', apiKey: '' },
  agentLaunchCommands: {},
  claudeAccounts: [],
  claudeAccountRotation: {
    enabled: false,
    thresholdPercent: 90,
    hysteresisPercent: 5,
    cooldownMinutes: 30
  },
  codexAccounts: [],
  systemAccountLabel: '',
  systemCodexAccountLabel: '',
  remoteSystemAccountLabels: {},
  remoteSystemCodexAccountLabels: {},
  // All three builtin agents (Claude/Codex/Gemini) show in the Add menus out of the box.
  // Existing users keep whatever they've saved (their persisted disabledAgents overrides this).
  disabledAgents: [],
  hiddenUsageProviders: [],
  // Nothing hidden out of the box, so existing users see the menu and header they already know.
  hiddenNodeMenuItems: [],
  hiddenHeaderButtons: [],
  // Opt-in: the resume card pops over the canvas on every qualifying project activation, which
  // reads as noise to users who navigate by the trail chords/Dock buttons instead.
  showResumeCard: false,
  usagePercentMode: 'remaining',
  claudeUsageRotationEnabled: false,
  claudeUsageRotationThreshold: 90,
  defaultAgent: 'claude',
  // Sessions start in auto mode out of the box. Existing users pick this up on hydrate
  // (settings hydrate merges over DEFAULT_SETTINGS) — a deliberate behavior change.
  claudePermissionMode: 'auto',
  // Opt-in: fresh eligible launches use the agent's own provider instead of gateway overrides.
  vanillaLaunchDefault: false,
  // Opt-in: hibernation exits a live CLI, so nobody gets it without asking. The 30-minute floor
  // is deliberately long — shorter windows exit sessions the user is between turns on.
  agentHibernationEnabled: false,
  agentHibernationIdleMinutes: 30,
  // Opt-in: nobody's terminal geometry changes unless they ask for it. 60% keeps the lead pane a
  // clear majority of the window without crowding out a single teammate pane entirely.
  agentTeamLeadPaneWidthEnabled: false,
  agentTeamLeadPaneWidthPercent: 60,
  // Opt-out (default on). Existing users pick this up on hydrate ONLY if their settings.json has
  // no telemetryEnabled key yet; anyone who already saved settings keeps their stored value.
  telemetryEnabled: true,
  debugLogPanel: false,
  phoneAccessEnabled: true,
  mobilePushEnabled: true,
  mobilePushNeedsYou: true,
  mobilePushDone: true,
  mobileLiveActivities: true,
  mobilePushPresenceAware: true,
  // Deterministic hook-reply approvals default ON (existing users pick it up on hydrate). Only
  // affects Claude terminal sessions; off reproduces the pre-feature launch bit-for-bit.
  hookReplyApprovals: true,
  // Seamless agent messaging is an explicit trust choice, never the default posture.
  agentSeamlessWrites: false,
  // Keep-awake-while-agents-work default ON (existing users pick it up on hydrate — deliberate,
  // same note style as hookReplyApprovals). Held only while a local agent is actually working.
  keepAwakeWhileAgentsWork: true,
  // Confirm-before-quit default ON: sessions survive a quit anyway, but an accidental ⌘Q
  // tears down every window at once; the toggle is one switch away for who finds it noisy.
  confirmBeforeQuit: true,
  // macOS Notch HUD default ON (guarded to darwin at runtime; a no-op elsewhere).
  notchHud: true,
  notchWidth: 168,
  notchHoverExpand: true,
  languageMode: 'en',
  // New installations start at the maximum deliberate voice level. Existing saved values are
  // preserved by the versioned settings migration in core/settings-store.ts.
  funnyLevelEn: DEFAULT_FUNNY_LEVEL,
  funnyLevelYue: DEFAULT_FUNNY_LEVEL,
  showEmojiInDialogs: false,
  // Narrator: opt-in and silent out of the box. Voices default to automatic — never a named
  // voice, since we can't know what's installed until we ask the platform.
  narratorEnabled: false,
  narratorLanguage: 'en',
  narratorVoiceEn: null,
  narratorVoiceYue: null,
  narratorRate: 1,
  narratorPitch: 1,
  elementAppearance: {},
  appearancePresets: [],
  appDisplayName: '',
  appLogo: { selection: 'shipped' },
  shortcuts: DEFAULT_SHORTCUTS,
  // model: '' = the explicit "no dictation" state (SPEECH_MODEL_NONE, issue #143). Dictation is
  // opt-in: nothing is selected — and so nothing downloads and no shortcut records — until the
  // user picks a model in onboarding or Settings → Speech. Existing installs keep whatever their
  // settings.json already says (the merge only fills ABSENT keys), so nobody's working dictation
  // is switched off by an upgrade.
  speech: { engine: 'whisper', model: '', language: 'auto', shortcut: 'Cmd+Alt' },
}

export interface SettingsApi {
  load(): Promise<Settings>
  save(settings: Settings): Promise<void>
}

/**
 * The shared "School mode" record — a self-imposed, non-security, user-experience switch that
 * lives OUTSIDE any single app's own settings.json (see core/school-mode.ts). It is deliberately
 * separate from `Settings`: several apps on the same machine can read/honor one shared switch,
 * and it survives a per-app data reset.
 */
export interface SchoolModeRecord {
  version: 1
  enabled: boolean
  /** User-chosen display name, shown everywhere instead of the shipped "School mode" name once
   *  renamed. Defaults to the shipped name until the user changes it. */
  name: string
}

/** The `window.nodeTerminal.schoolMode` surface. Every method resolves/rejects — a caller never
 *  needs to distinguish "not yet loaded" from "off": `load()` always answers a real record. */
/**
 * Kids mode — a friendlier, safer surface for a child, and the NEAR-OPPOSITE of School mode.
 *
 * School mode strips playfulness out so a screen looks serious in a classroom. Kids mode KEEPS
 * all of it (dim sum, funny levels, Cantonese) and adds safety restrictions instead: agent
 * permission modes that act without asking are refused, and every destructive action goes through
 * the two-key confirmation. They share a record-plus-PIN shape and nothing else, which is why
 * they are separate records with separate credentials rather than two profiles of one thing.
 *
 * It is honest about its limit. See KIDS_DISCLOSURE in core/kids-mode-policy.ts: this cannot
 * sandbox the terminal, because the terminal is the product.
 */
export interface KidsModeRecord {
  version: 1
  enabled: boolean
  /** User-chosen display name, like School mode's. Defaults to the shipped name. */
  name: string
}

/**
 * One observation published by the core store. `generation` is monotonic for that store lifetime,
 * so a delayed load/mutation response cannot overwrite a newer live event in the renderer.
 * `authoritative` requires both a strict canonical read and an acknowledged live-watch epoch.
 */
export interface KidsModeSnapshot extends KidsModeRecord {
  authoritative: boolean
  generation: number
}

/** Whether the shared Kids-mode PIN can be used for an authorization decision. */
export type KidsCredentialState = 'present' | 'absent' | 'unavailable'

export type KidsCredentialResetResult =
  | { ok: true; record: KidsModeSnapshot }
  | { ok: false; error: string }

export interface KidsModeApi {
  load(): Promise<KidsModeSnapshot>
  /** Turn it ON. A new PIN is chosen on first enrollment; an existing PIN must be verified. */
  enable(pin?: string): Promise<KidsModeSnapshot>
  /** Turn it OFF. Requires the grown-up PIN. */
  disable(pin: string): Promise<{ ok: true; record: KidsModeSnapshot } | { ok: false; error: string }>
  rename(name: string): Promise<KidsModeSnapshot>
  changePin(currentPin: string, nextPin: string): Promise<boolean>
  /** Read the PIN state without returning or characterizing credential material. */
  credentialState(): Promise<KidsCredentialState>
  /** Remove only the Kids PIN and turn Kids mode off after explicit local confirmation. */
  resetCredential(): Promise<KidsCredentialResetResult>
  /**
   * Verify the grown-up PIN WITHOUT changing state, for the grown-up screen. This is required on
   * every bridge so the Server Edition cannot silently omit the check.
   */
  verifyPin(pin: string): Promise<boolean>
  onChanged(cb: (r: KidsModeSnapshot) => void): () => void
}

export interface SchoolModeApi {
  /** Current record. */
  load(): Promise<SchoolModeRecord>
  /** Turn the mode ON. `pin` is REQUIRED only the first time ever (no stored credential exists
   *  yet) and establishes the unlock PIN; every later call ignores it. There is deliberately no
   *  PIN check to ENTER the mode — only to leave it, per the "self-imposed speed bump" contract. */
  enable(pin?: string): Promise<SchoolModeRecord>
  /** Turn the mode OFF. Requires the correct PIN, verified against a stored hash (never a stored
   *  plaintext PIN). `ok:false` names the reason without leaking anything about the credential. */
  disable(pin: string): Promise<{ ok: true; record: SchoolModeRecord } | { ok: false; error: string }>
  /** Rename the mode's display name. No PIN required — renaming carries no security meaning. */
  rename(name: string): Promise<SchoolModeRecord>
  /** Change the unlock PIN. Requires the current one; resolves `false` on a wrong current PIN or
   *  an invalid new one (never throws for that — only for genuine I/O failure). */
  changePin(currentPin: string, nextPin: string): Promise<boolean>
  /** Whether an unlock PIN has ever been set on this machine (so the UI knows whether the next
   *  `enable()` call needs one, and can label the very-first-enable flow accordingly). */
  hasCredential(): Promise<boolean>
  /** Fires whenever the shared record changes, INCLUDING a change written by another process
   *  watching the same shared file (another app, a second window) — this is what makes the mode
   *  apply live with no restart. Returns unsubscribe. */
  onChanged(cb: (record: SchoolModeRecord) => void): () => void
}

/** Scheduled settings (docs/scheduled-settings.md): schedule an appearance override for a
 *  date+time window, gated by a local switch, an HTTPS API, or a Home Assistant boolean entity.
 *  All network access and the periodic evaluator live in the main process (or the Server
 *  Edition's equivalent boundary) — the renderer only ever reads the resolved result. */
export type ScheduledSettingsSaveResult =
  | { ok: true; error?: never; persisted?: true; warning?: never }
  | { ok: false; error: string; persisted?: never; warning?: never }
  | {
      ok: false
      error: string
      persisted: true
      warning: 'credential-cleanup-incomplete'
    }

export interface ScheduledSettingsApi {
  /** A successful file or a safe disabled fallback plus the exact recovery fact. A failed read is
   * never represented as an ordinary empty schedule. */
  load(): Promise<import('./scheduled-settings').ScheduledSettingsLoadState>
  /** A failed publication has only `{ok:false,error}`. If the schedule was published but related
   * credential cleanup failed, `persisted` and `warning` distinguish that truthful warning from a
   * write failure without parsing presentation copy. */
  save(
    file: import('./scheduled-settings').ScheduledSettingsFile
  ): Promise<ScheduledSettingsSaveResult>
  /** Store (`token`) or clear (`null`) the Home Assistant access token for one rule. The token is
   *  never read back over IPC — see `tokenStatus`. */
  setHomeAssistantToken(ruleId: string, token: string | null): Promise<void>
  /** Which rule ids currently have a Home Assistant token stored (a status dot, never the token). */
  tokenStatus(): Promise<Record<string, boolean>>
  /** Force-refresh one rule's external source right now (the Settings UI's "Retry" action). */
  refreshRule(ruleId: string): Promise<void>
  /** One-shot read of the current resolution — for a UI that mounts after the first push. */
  activeState(): Promise<import('./scheduled-settings').ScheduledSettingsActiveState>
  /** Fires whenever the resolved schedule changes. Returns unsubscribe. */
  onActiveChange(
    cb: (state: import('./scheduled-settings').ScheduledSettingsActiveState) => void
  ): () => void
}

/** Machine-local planner occurrence service. The host keeps its timer alive after the UI closes,
 * while the schedule and bounded occurrence history remain durable in application data. */
export interface PlannerApi {
  load(): Promise<import('./planner-occurrences').PlannerLoadState>
  save(file: import('./planner-occurrences').PlannerFile): Promise<{ ok: true } | { ok: false; error: string }>
  history(): Promise<import('./planner-occurrences').PlannerOccurrence[]>
  export(format: 'json' | 'csv'): Promise<{ filename: string; content: string }>
  /** Apply imported schedule intent only after the user explicitly chooses Configure. */
  configure(schedules: import('./planner-occurrences').PlannerSchedule[]): Promise<{ ok: true } | { ok: false; error: string }>
  onOccurrence(listener: (occurrence: import('./planner-occurrences').PlannerOccurrence) => void): () => void
}

/** Machine-local Alarm Clock execution. Project data remains the portable source of safe intent;
 * this mirror keeps due evaluation alive when the renderer closes. */
export interface AlarmApi {
  state(): Promise<import('./alarm-clock').AlarmPlannerSnapshot>
  upsert(
    alarm: Omit<import('./alarm-clock').AlarmDefinition, 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<import('./alarm-clock').AlarmPlannerSnapshot>
  remove(alarmId: string): Promise<boolean>
  snooze(occurrenceId: string, minutes: number): Promise<import('./alarm-clock').AlarmPlannerSnapshot>
  dismiss(occurrenceId: string): Promise<import('./alarm-clock').AlarmPlannerSnapshot>
  onDue(listener: (event: import('./alarm-clock').AlarmDueEvent) => void): () => void
}

/** A downloadable whisper model plus its on-disk status, as returned by `speech.models()`. */
export interface SpeechModelInfo extends WhisperModelInfo {
  downloaded: boolean
  /** Actual on-disk size in MB, present only when `downloaded`. */
  sizeMB?: number
}

export interface SpeechApi {
  /** Transcribe a chunk of mono PCM audio (16kHz Float32 samples) to text.
   *  `language` is a BCP-47-ish hint or 'auto'; defaults to the user's speech settings. */
  /** `model` carries the PROJECT-RESOLVED choice. Without it the core reads the global
   *  settings store, so a per-project speech model would be settable in the UI and then
   *  silently ignored at transcription time. */
  transcribe(pcm: Float32Array, language?: string, model?: string): Promise<{ text: string }>
  /** List the known whisper models with their download/pro status. */
  models(): Promise<SpeechModelInfo[]>
  /** Download a whisper model to disk (progress via `onProgress`). */
  downloadModel(id: string): Promise<void>
  /** Delete a downloaded whisper model. */
  deleteModel(id: string): Promise<void>
  /** Subscribe to model-download progress (`pct` 0-100). Returns unsubscribe. */
  onProgress(cb: (p: { id: string; pct: number }) => void): () => void
  /** Ask for microphone permission. Electron: OS-level (macOS TCC prompt); browser: always
   *  resolves true — the browser's own getUserMedia prompt is not ours to gate. */
  micConsent(): Promise<boolean>
}

export interface SshApi {
  list(): Promise<import('./ssh').SshServer[]>
  save(server: import('./ssh').SshServer): Promise<import('./ssh').SshServer[]>
  remove(id: string): Promise<import('./ssh').SshServer[]>
  /** Parse `~/.ssh/config` into importable hosts (empty if none). */
  importCandidates(): Promise<import('./ssh').ParsedSshHost[]>
}

export type SshProjectStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error'

/**
 * A live SSH project's status, pushed from main. `claudeAutoPermissionMode` rides a `connected`
 * event: the remote `claude --version` probe runs AFTER connect (its login shell is slow and must
 * not delay the project's terminals), so the answer arrives on its own event once it lands.
 * Absent = not probed / nothing new ⇒ the renderer keeps omitting the `auto` flag (fail-open).
 */
export interface SshProjectStatusEvent {
  projectId: string
  status: SshProjectStatus
  error?: string
  claudeAutoPermissionMode?: boolean
  /** The remote `claude --version` output the probe read, riding the same `connected` event as
   *  `claudeAutoPermissionMode`. `null` = the probe ran but found no claude (distinguishable from
   *  "old CLI" in the tab-menu hint); absent = nothing new. */
  remoteClaudeVersion?: string | null
}

/** main → renderer: this SSH identity file needs its passphrase (the ssh-agent doesn't hold the
 *  key, or the last answer was wrong). `retry` distinguishes "that passphrase didn't work" from
 *  a first ask. */
export interface SshPassphraseRequest {
  requestId: string
  identityFile: string
  retry: boolean
  /** `user@host` the unlock is for, when main could attribute the prompt to a connection. One key
   *  can serve several servers, and the prompt can fire from the watchdog long after any connect
   *  dialog closed. Absent when the asking master could not be identified (adopted orphan). */
  target?: string
}

export interface SshProjectApi {
  /** Open (or reuse) the ControlMaster for an SSH project; resolves once connected. */
  connect(
    projectId: string,
    server: import('./ssh').SshConnection,
    remoteCwd?: string
  ): Promise<{
    controlPath: string
    hookEndpointPath?: string
    tmuxConfPath?: string
    remoteHome?: string
    codexLauncherPath?: string
    codexRelayScriptPath?: string
    codexRelayRuntimePath?: string
    /** Whether the REMOTE host's claude CLI accepts `--permission-mode auto` (probed on connect). */
    claudeAutoPermissionMode?: boolean
    /** The probed remote `claude --version` output (`null` = probe failed; only on reused conns). */
    remoteClaudeVersion?: string | null
  }>
  /** Tear down the master (remote tmux is unaffected). */
  disconnect(projectId: string): Promise<void>
  /**
   * End the given terminal nodes' REMOTE tmux sessions over the project's live master.
   * Authoritative teardown on project delete: works regardless of whether the nodes are
   * mounted, and must be awaited BEFORE disconnect (which kills the master). `nodeIds` are
   * raw node ids; main maps them to `nt-<id>` session names.
   *
   * `everySocket` widens the kill to every tmux socket on the host rather than the `nodeterm-rmt`
   * one an SSH project spawns on. Opt-in for ONE caller — the session-memory panel, whose rows are
   * swept off both sockets. Project deletion stays narrow: `node-terminal` on that host belongs to
   * a nodeterm running ON it, not to us.
   */
  killSessions(
    projectId: string,
    nodeIds: string[],
    opts?: { everySocket?: boolean }
  ): Promise<void>
  /** Forward one loopback OAuth callback port from this machine to the connected SSH host. */
  forwardOAuthCallback(
    projectId: string,
    port: number
  ): Promise<{ ok: true; port: number; expiresAt: number } | { ok: false; error: string }>
  /** Cancel a temporary OAuth callback forward, if one is active for this project. */
  cancelOAuthCallback(projectId: string, port?: number): Promise<boolean>
  /** List remote sub-directories of `path` (default ~). */
  listDir(projectId: string, path: string): Promise<{ path: string; dirs: string[] }>
  /** Create a remote directory (mkdir -p). Resolves false when not connected or the mkdir fails. */
  mkdir(projectId: string, path: string): Promise<boolean>
  /**
   * Upload a local file to the remote over the project's ControlMaster, into
   * `<remoteHome>/.nodeterm/uploads/<token>/<fileName>`. Resolves the ABSOLUTE remote path on
   * success, or null on any failure (not connected, unresolved remote home, mkdir/scp failure).
   */
  uploadFile(projectId: string, localPath: string, fileName: string): Promise<string | null>
  /**
   * Pull a remote file (or, with a directory, the whole tree) down to this machine over the
   * project's ControlMaster, into the OS Downloads folder unless `destDir` names another one.
   * The DESTINATION is built in main (`app.getPath('downloads')` + the remote basename, collision-
   * resolved) — the renderer only ever names the remote side, so no renderer string reaches the
   * local write path. Never throws: a failure resolves `{ ok: false, error }`.
   */
  downloadFile(projectId: string, remotePath: string, destDir?: string): Promise<DownloadResult>
  onStatus(cb: (e: SshProjectStatusEvent) => void): () => void
  /** The user's answer to a passphrase prompt (null on cancel). */
  submitPassphrase(requestId: string, value: string | null): Promise<void>
  onPassphraseRequest(cb: (e: SshPassphraseRequest) => void): () => void
  /** Main expired a pending passphrase request; close its dialog if it is still showing. */
  onPassphraseDismiss(cb: (e: { requestId: string }) => void): () => void
}

/** Outcome of a file download (SSH pull). `localPath` is the absolute path actually written —
 *  collision resolution may have renamed it (`notes.md` → `notes (2).md`). */
export type DownloadResult =
  { ok: true; localPath: string; dir: boolean } | { ok: false; error: string }

/** A one-shot HTTP download ticket (Server Edition). `url` is same-origin and carries the token;
 *  the browser does the transfer natively, so nothing streams through the WS bridge. */
export interface DownloadTicket {
  url: string
  /** Filename the download will land under (a directory becomes `<name>.tar.gz`). */
  name: string
}

/**
 * SSH-project Explorer/Editor filesystem API: the same `FsApi` contract scoped to a project,
 * proxied over the project's ControlMaster (renderer → `sshFs:*` IPC → main `SshFs`). The renderer
 * `sshFs(projectId)` helper closes over `projectId` to expose a plain `FsApi`. Fails open
 * ([]/''/false) when the project is not connected.
 */
export interface SshFsApi {
  list(projectId: string, path: string): Promise<DirEntry[]>
  read(projectId: string, path: string): Promise<string>
  readBinary(projectId: string, path: string): Promise<string>
  write(projectId: string, path: string, content: string): Promise<boolean>
  mkdir(projectId: string, path: string): Promise<boolean>
  exists(projectId: string, path: string): Promise<boolean>
  /** ⌘K Quick Open index of the project's remoteCwd: root-relative `/`-paths ([] on failure). */
  quickOpen(projectId: string, cwd: string): Promise<string[]>
}

export interface GitFileChange {
  path: string
  /** Single-letter status: M (modified), A (added), D (deleted), R (renamed), U (untracked). */
  status: string
  added: number
  deleted: number
}

/**
 * Core-measured exact checkout generation/content proof used only for forced worktree removal.
 *
 * NAMED APART FROM `GitWorktreeRemovalProof` DELIBERATELY. Two independent subsystems arrived at
 * the same name from different branches — this one, produced by `git-removal-proof.ts` beside the
 * status read, and the one-shot removal authorization produced by `worktree-removal-proof.ts`.
 * A bulk merge kept both declarations, and because TypeScript MERGES same-named interfaces rather
 * than rejecting them, the effective type silently became the union of the two. Every producer of
 * either shape then failed to satisfy it, in three files at once, with errors that pointed at the
 * producers rather than at the duplicate that caused them.
 *
 * They are different facts: this is a measurement, that is an authorization. They must not share
 * a name again.
 */
export interface GitWorktreeRemovalMeasurement {
  /** HEAD object id at measurement time. */
  headOid: string
  /** Filesystem generation of the checkout root and its per-worktree git administrative dir. */
  generation: string
  /** Hash of HEAD, index, tracked diffs, untracked bytes, and exact porcelain state. */
  fingerprint: string
}

export interface GitStatus {
  hasRepo: boolean
  /** True only when every command/read needed for a destructive content proof succeeded. */
  authoritative?: boolean
  /** Present only with `authoritative:true`; compare inside core immediately before forced removal. */
  removalProof?: GitWorktreeRemovalMeasurement
  /** "owner/repo" from the origin remote, else the folder name. */
  repoName: string
  branch: string
  /** Local branch names (for the branch switcher). */
  branches: string[]
  /** Remote-tracking branch names as `<remote>/<branch>` (HEAD pointers excluded), so the
   *  switcher can offer branches that exist only on a remote — a plain `git switch <branch>`
   *  then DWIMs a local tracking branch. Absent in stale caches: read with `?? []`. */
  remoteBranches?: string[]
  ahead: number
  behind: number
  /** The repo has at least one remote — which may well not be named `origin` (a fork can have only
   *  `upstream`). Never read this to decide whether a `git push origin …` can work: use `hasOrigin`. */
  hasRemote: boolean
  /** A remote literally named `origin` exists — i.e. a hardcoded `push origin <ref>` has a target. */
  hasOrigin: boolean
  /** The current branch has an upstream tracking ref (i.e. it has been published). */
  hasUpstream: boolean
  ghAvailable: boolean
  ghAuthed: boolean
  staged: GitFileChange[]
  changes: GitFileChange[]
}

/** A verified Git repository found below a project's configured folder. */
export interface GitNestedRepository {
  /** Absolute path used as the cwd for scoped Git operations. */
  path: string
  /** Project-root-relative display path, always using `/` separators. */
  relativePath: string
  /** Folder name used as the compact scope label. */
  name: string
}

/** Bounded page request for child-repository discovery. Cursor values are opaque to the renderer. */
export interface GitNestedRepositoryDiscoveryOptions {
  cursor?: string
  limit?: number
}

/** Result of the bounded nested-repository scan. A failed scan is never an empty success. */
export interface GitNestedRepositoryDiscovery {
  ok: boolean
  repositories: GitNestedRepository[]
  /** Number of directories examined before this page was produced. */
  scannedDirectories: number
  /** True when the safety cap stopped traversal before every directory could be examined. */
  limited: boolean
  /** Opaque cursor for another page, or null when this is the final page. */
  nextCursor?: string | null
  message?: string
}

/** Core-owned provenance for one exact physical worktree generation. */
export interface GitWorktreeOwnership {
  /** Opaque machine-local ownership record id. Canvas JSON cannot mint or replace it. */
  ownershipId?: string
  /** The app created this directory, independently of whether the branch already existed. */
  directoryCreatedByApp: boolean
  /** The app created this branch (`git worktree add -b`), not merely its checkout directory. */
  branchCreatedByApp: boolean
}

/** Complete inventory disclosed before a forced worktree-directory removal. */
export interface GitWorktreeRemovalSummary {
  trackedFiles: number
  untrackedFiles: number
  ignoredFiles: number
  otherFiles: number
  symlinks: number
  directories: number
  bytes: number
}

/**
 * Opaque, one-shot authorization input produced by `worktreeRemovalProof`.
 *
 * The descriptive fields let the renderer disclose the exact target, but none of them grants
 * authority by itself. Core consumes `token`, reloads its private snapshot, and remeasures every
 * field before mutation. A hand-written or replayed object therefore performs no removal.
 */
export interface GitWorktreeRemovalProof {
  version: 1
  token: string
  fingerprint: string
  repoPath: string
  worktreePath: string
  commonDir: string
  adminDir: string
  branchRef: string
  branchTip: string
  summary: GitWorktreeRemovalSummary
  ownership: GitWorktreeOwnership
}

export interface GitWorktreeRemovalProofResult {
  ok: boolean
  message: string
  proof?: GitWorktreeRemovalProof
}

/** Pruning registration and deleting a live directory are deliberately different operations. */
export type GitWorktreeRemovalRequest =
  | { mode: 'prune' }
  | { mode: 'remove'; proof: GitWorktreeRemovalProof; deleteBranch: boolean }

export interface GitResult {
  ok: boolean
  message: string
  /** worktreeRemove() only: the worktree is no longer on disk (registration pruned, or never
   *  registered), so the caller must clear its binding even when `ok` is false. */
  worktreeGone?: boolean
  /** Set by publish() when no usable GitHub credential was found, so the UI can
   *  fall back to an interactive `gh auth login` instead of just showing an error. */
  needsAuth?: boolean
  /** `worktreeAdd()` only: core-verified provenance for the physical generation just created. */
  worktreeOwnership?: GitWorktreeOwnership
}

export interface GitApi {
  status(cwd: string): Promise<GitStatus>
  init(cwd: string): Promise<GitResult>
  /** Clone a repo into parentDir; returns the cloned folder path in message on success. */
  clone(parentDir: string, url: string): Promise<GitResult>
  /** Abort the in-flight clone, if any (its clone() promise resolves message:'aborted'). */
  cloneAbort(): Promise<void>
  /** Suggested parent dir for clones: ~/projects if it exists, else the home dir. */
  cloneDefaultParent(): Promise<string>
  /** Subscribe to live clone progress; returns unsubscribe. */
  onCloneProgress(listener: (p: CloneProgress) => void): () => void
  /** Commits the staged changes (no implicit add). */
  commit(cwd: string, message: string): Promise<GitResult>
  push(cwd: string): Promise<GitResult>
  pull(cwd: string): Promise<GitResult>
  /** Pull then push. */
  sync(cwd: string): Promise<GitResult>
  publish(cwd: string, name: string, isPrivate: boolean): Promise<GitResult>
  stage(cwd: string, paths: string[]): Promise<GitResult>
  unstage(cwd: string, paths: string[]): Promise<GitResult>
  stageAll(cwd: string): Promise<GitResult>
  unstageAll(cwd: string): Promise<GitResult>
  /** Unified diff for a file. `staged` selects index vs worktree; untracked shows full file. */
  diff(cwd: string, path: string, staged: boolean, untracked: boolean): Promise<string>
  /** Discard a file's changes (or delete it if untracked). */
  discard(cwd: string, path: string, untracked: boolean): Promise<GitResult>
  switchBranch(cwd: string, name: string): Promise<GitResult>
  createBranch(cwd: string, name: string): Promise<GitResult>
  /** File contents at a git ref ('HEAD', or '' for the index/staged blob). */
  showFile(cwd: string, ref: string, path: string): Promise<string>
  /** Generate a commit message from the staged diff via a local AI agent CLI. */
  generateMessage(cwd: string): Promise<GitResult>
  /** Commit history graph for the repo. */
  history(
    cwd: string,
    options?: { limit?: number; baseRef?: string | null }
  ): Promise<import('./git-history').GitHistoryResult>
  /** File-level changes introduced by a commit (oid). */
  commitFiles(cwd: string, oid: string): Promise<GitFileChange[]>
  /** Remote web URL for a commit sha, or null if it can't be derived. */
  remoteCommitUrl(cwd: string, sha: string): Promise<string | null>
  /** Merge a branch into the current branch. */
  merge(cwd: string, ref: string): Promise<GitResult>
  /** Rebase the current branch onto another. */
  rebase(cwd: string, onto: string): Promise<GitResult>
  /** Delete a branch (force = -D, for unmerged). */
  deleteBranch(cwd: string, name: string, force: boolean): Promise<GitResult>
  /** Rename the current branch. */
  renameBranch(cwd: string, newName: string): Promise<GitResult>
  /** Fetch all remotes and prune. */
  fetch(cwd: string): Promise<GitResult>
  /** Push with --force-with-lease. */
  forcePush(cwd: string): Promise<GitResult>
  /** Stash uncommitted changes (incl. untracked). */
  stashPush(cwd: string): Promise<GitResult>
  /** Pop the latest stash. */
  stashPop(cwd: string): Promise<GitResult>
  /** Revert a commit (--no-edit). */
  revert(cwd: string, oid: string): Promise<GitResult>
  /** Create + switch to a new branch at a commit. */
  branchAt(cwd: string, name: string, oid: string): Promise<GitResult>
  /** Checkout a commit (detached HEAD). */
  checkoutCommit(cwd: string, oid: string): Promise<GitResult>
  repoRoot(cwd: string): Promise<string | null>
  /** Find verified child repositories below a project folder without mutating the filesystem. */
  discoverNestedRepos(
    cwd: string,
    options?: GitNestedRepositoryDiscoveryOptions
  ): Promise<GitNestedRepositoryDiscovery>
  /** `{ ok: false, entries: [] }` when git itself could not be read — which is NOT the same fact as
   *  "this repo has no worktrees", and no caller may treat it as one (see worktree-ops). */
  worktreeList(repoPath: string): Promise<import('./worktree').WorktreeListResult>
  worktreeAdd(repoPath: string, wtPath: string, branch: string, baseRef: string, isNew: boolean): Promise<GitResult>
  /** `push`: also publish `baseRef` to origin after a successful merge (only if a remote exists).
   *  Opt-in — a merge must never publish to a shared remote the user was not told about. */
  worktreeMerge(repoPath: string, branch: string, baseRef: string, push?: boolean): Promise<GitResult>
  /** Measure a complete, stable physical checkout snapshot for a later one-shot removal. */
  worktreeRemovalProof(repoPath: string, wtPath: string): Promise<GitWorktreeRemovalProofResult>
  /** Registration-only pruning or proof-bound live-directory removal. */
  worktreeRemove(repoPath: string, wtPath: string, request: GitWorktreeRemovalRequest): Promise<GitResult>
  /** Store the parent branch for a dependency link in the shared git config. */
  setBranchParent(repoPath: string, child: string, parent: string): Promise<GitResult>
  /** Remove the parent branch projection for a dependency link. */
  unsetBranchParent(repoPath: string, child: string): Promise<GitResult>
  /** Rebase one dependency child branch onto its configured parent. */
  syncBranch(cwd: string, child: string): Promise<GitResult>
  /** Open a pull request for one dependency child branch against its configured parent. */
  proposeBranch(cwd: string, child: string): Promise<GitResult>
  /** Fast-forward a dependency parent branch to its child when the parent is current. */
  shipBranch(cwd: string, child: string, parent: string): Promise<GitResult>
  /** Execute one owned dependency link operation through the bounded typed operation plan. */
  dependencyOperation(
    request: import('./dependency-operations').DependencyOperationRequest
  ): Promise<import('./dependency-operations').DependencyOperationResult>
  /** Cancel an operation that has not started executing. */
  cancelDependencyOperation(operationId: string): Promise<boolean>
  /** Subscribe to dependency operation progress and terminal states. */
  onDependencyOperationProgress(
    listener: (progress: import('./dependency-operations').DependencyOperationProgress) => void
  ): () => void
  /** Scope remote git routing to the active project: pass its id to route git over that SSH
   *  project's master, or null for a local project so all git ops run locally. */
  setActiveRemote(projectId: string | null): Promise<void>
}

export interface UpdateInfo {
  /** Squirrel.Windows does not reveal the target version until download completion (and some
   *  releases expose only an opaque release name), so absence must render as "a newer version". */
  version?: string
  notes?: string
  /**
   * Electron's built-in Squirrel.Windows updater does not expose byte progress. When true, the
   * renderer shows an indeterminate download bar instead of inventing a permanent `0%` reading.
   */
  indeterminateProgress?: boolean
  /**
   * The update cannot self-install and must be downloaded manually (Linux .deb/.rpm: no
   * APPIMAGE env, so electron-updater's quitAndInstall would throw). The card shows a
   * download link instead of the download-progress/restart flow. Absent/false = self-installs.
   */
  manual?: boolean
}

export interface UpdatePolicy {
  /** Minimum supported version for the device's channel (or null when no policy). */
  minSupported: string | null
  /** True when the running version is below the minimum supported version. */
  mandatory: boolean
}

export interface UpdateProgress {
  /** 0–100. */
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateApi {
  /** A newer version was found and is downloading. Returns unsubscribe. */
  onAvailable(listener: (info: UpdateInfo) => void): () => void
  /** The update finished downloading and is ready to install. Returns unsubscribe. */
  onDownloaded(listener: (info: UpdateInfo) => void): () => void
  /** Download progress ticks while an update downloads. Returns unsubscribe. */
  onProgress(listener: (p: UpdateProgress) => void): () => void
  /** An updater error occurred (drives the card's error state). Returns unsubscribe. */
  onError(listener: (message: string) => void): () => void
  /** No newer version is available (also the dev no-op reply to check()). Returns unsubscribe. */
  onNotAvailable(listener: () => void): () => void
  /** Trigger a manual update check. */
  check(): void
  /** The running app version. */
  getVersion(): Promise<string>
  /** The channel's mandatory-update policy for the running version (from /v1/check). */
  getPolicy(): Promise<UpdatePolicy>
  /** Quit and install the staged update. */
  restart(): void
}

/** A single news/announcement item, fetched from the remote announcements feed. */
export interface Announcement {
  /** Stable unique id; used to remember which items the user has dismissed. */
  id: string
  title: string
  body?: string
  /** Optional "Learn more" link (opened in the system browser). */
  url?: string
  /** Visual emphasis; defaults to 'info'. */
  level?: 'info' | 'success' | 'warning'
}

export interface AnnouncementsApi {
  /** Fetch the announcements feed from the website (returns [] on any failure). */
  fetch(): Promise<Announcement[]>
}

export interface NotifyPayload {
  title: string
  body: string
  /** Title ownership, used by renderer-side vocabulary mapping before native delivery. */
  titleKind?: 'authored' | 'fact'
  /** Whether the body is app-authored copy or an exact host/provider fact. Native composition
   *  never rewrites either kind. Omitted remains a fact for backwards compatibility. */
  bodyKind?: 'authored' | 'fact'
  /** Node to focus/center when the notification is clicked. */
  nodeId: string
  /** Show even when the window is focused (used to trigger the macOS permission prompt). */
  force?: boolean
}

/** A chunk of a subagent's live transcript, streamed while it works. */
export interface SubagentActivity {
  toolUseId: string
  chunk: string
}

/** One linked node, as the context-link CLI sees it. */
export interface ContextLinkInfo {
  id: string
  title: string
  /** The linked node's working dir — lets the CLI resolve a transcript when the path isn't known yet. */
  cwd?: string
  /** Set when the linked node is a sticky note: its current text. Note entries have no transcript/terminal. */
  note?: string
  /** The linked node's agent CLI ('claude' | 'codex' | 'gemini') — selects the CLI transcript parser. */
  agentId?: string
  /** Latest known provider session id — lets main resolve the transcript via the per-agent locators. */
  sessionId?: string
  /** Managed Claude account of the linked node — scopes the claude locator fallback. */
  accountId?: string
}

/** Map of node id → the nodes it is context-linked to. Sent to main so it can write link files. */
export type ContextLinkMap = Record<string, ContextLinkInfo[]>

export interface ContextLinkApi {
  /** Push the current link map to main; main rewrites the per-node link files. */
  setLinks(map: ContextLinkMap): Promise<void>
  /** Static facts the renderer needs to compose link messages: the CLI shim's absolute path. */
  info(): Promise<{ shimPath: string }>
}

/** One usage window (5h session or 7d weekly) as shown in the indicator. */
export interface ClaudeUsageWindow {
  /** 0–100; remaining quota. Drives the bar fill (shows "remaining"). */
  leftPercent: number
  /** Unix ms when this window resets, or null if unknown. */
  resetsAt: number | null
}

/**
 * One usage window, normalized across providers. Claude's endpoint hands these over directly
 * as its open-ended `limits[]` array — a per-model quota (Fable's weekly cap, say) is an
 * ordinary entry whose model name rides in `scopeLabel`, so a new model needs no new field.
 * Other providers (Codex's primary/secondary windows, …) are mapped into the same shape.
 *
 * Percentages are portions USED, which is the providers' own convention; the UI inverts for
 * display where it shows "left".
 */
export interface UsageLimit {
  /** Provider-assigned kind: 'session' | 'weekly_all' | 'weekly_scoped' | future values. */
  kind: string
  /** Coarse grouping ('session' | 'weekly'), or null when the provider omits it. */
  group: string | null
  /** 0–100, portion consumed. */
  usedPercent: number
  /**
   * The provider's own severity call ('normal' | 'warning' | 'critical' | …), or **null when
   * the provider does not report one** — which is the common case (only Claude does today).
   * Null means "derive from the percentage locally"; it must NOT be defaulted to 'normal',
   * or every provider without severity would paint a permanently green bar.
   */
  severity: string | null
  resetsAt: number | null
  /**
   * The bucket's real duration in minutes, when the provider reports it (Codex sends
   * `limit_window_seconds`), else null. Providers can and do vary this per plan, so labelling
   * a window "5h" from its `kind` alone can be a lie.
   */
  windowMinutes: number | null
  /** Model display name for a scoped limit (e.g. 'Fable'), else null. */
  scopeLabel: string | null
  /** The provider says this window is the one currently gating the account. */
  isActive: boolean
}

/**
 * One provider's usage snapshot. `ClaudeUsage` below is the Claude-shaped superset kept for the
 * existing pill; new providers use this leaner shape (they have no per-account story yet).
 */
export interface ProviderUsage {
  /** Agent id the limits belong to: 'claude' | 'codex' | … */
  provider: string
  limits: UsageLimit[]
  /** Signed-in identity, when the provider exposes one cheaply (email / account label). */
  account: string | null
  /** Managed provider account id; null/undefined means that provider's system account. */
  accountId?: string | null
  /**
   * The managed account this row's numbers belong to, when the provider is account-scoped (Codex
   * manages N homes on one machine). `undefined` is the un-owned system row — an account that
   * cannot be proven un-owned is never labelled un-owned. Rows are keyed by this so one account's
   * usage can never collapse into or be attributed to another (S6 §4.3, no mixing / fail-closed).
   */
  updatedAt: number
  /**
   * 'unavailable' = not signed in / no subscription to report → hide this provider entirely.
   * 'fetching' = request in flight. 'ok' = limits present. 'error' = the fetch failed.
   */
  status: 'unavailable' | 'fetching' | 'ok' | 'error'
}

/** Host memory snapshot in MB. `null` from any reader means "could not read" — never "zero".
 *  Shared because it crosses the wire for the system-resource pill; core reads it, the renderer
 *  renders it. */
export interface MemInfo {
  availableMb: number
  totalMb: number
  /**
   * Swap, and the kernel's own stall accounting. **Optional on purpose, and their absence is the
   * darwin contract.**
   *
   * `availableMb` alone cannot see a host that has already spent its overflow reserve: a machine
   * with 10.5 GB "available" and 84% of its swap consumed reads as healthy under a 10%-of-RAM
   * watermark, which is exactly the state the 2026-08-03 swap-thrash lockup was in. These fields
   * carry the two host-wide facts that DO see it.
   *
   * Only the Linux reader populates them (`/proc/meminfo` for swap, `/proc/pressure/memory` for
   * PSI — both world-readable, measured on a `hidepid=invisible` host where a non-root uid can read
   * neither another user's processes nor their tmux socket). `parseVmStat` leaves every one of them
   * undefined, so no macOS reading can ever satisfy a swap or PSI term: darwin cannot start firing
   * on a signal that was never measured there.
   *
   * A consumer must treat `undefined` as NO SIGNAL, never as zero — a zero here reads as
   * "swap totally exhausted" / "no stall", and both are claims the reader has not earned.
   */
  /** Total swap in MB; `0` legitimately means "this host has no swap configured". */
  swapTotalMb?: number
  /** Free swap in MB. */
  swapFreeMb?: number
  /** `/proc/pressure/memory` `some avg60` — % of the last minute at least one task stalled on memory. */
  psiSomeAvg60?: number
  /** `/proc/pressure/memory` `full avg60` — % of the last minute EVERY task was stalled. Thrash. */
  psiFullAvg60?: number
}

/** One nt- session's memory, as the panel renders it. */
export interface SessionMemoryRow {
  /** tmux session name, `nt-<nodeId>`. */
  session: string
  /** The canvas node id — the session name minus the `nt-` prefix. */
  nodeId: string
  panePid: number
  /** The pane's own process. */
  selfMb: number
  /** Everything below it (MCP servers, headless browsers, …). */
  childrenMb: number
  childCount: number
  totalMb: number
  /** `#{pane_current_command}` — the agent/shell label. */
  command: string
}

/**
 * `ok: false` means the sweep could not run (no tmux binary, unreadable process table). It is NOT
 * the same as an empty `rows` with `ok: true`, which means "we looked and there are no sessions".
 * Collapsing the two would make the panel report "nothing is using memory" at exactly the moment
 * it failed to measure.
 */
export interface SessionMemoryReport {
  ok: boolean
  rows: SessionMemoryRow[]
  mem: MemInfo | null
}

/**
 * What the renderer asks for: the machine a project runs ON, never "this machine" implicitly.
 * `remote: true` is the renderer saying it already knows (from `usageScope`) that the active
 * project is an SSH one; the shell's own `isRemoteProject` is a second, independent confirmation,
 * so a project the shell has not (yet) registered as connected still cannot be answered with the
 * local machine's sessions.
 */
export interface SessionMemoryQuery {
  projectId?: string
  remote?: boolean
}

/**
 * Per-session memory for the machine the ACTIVE PROJECT runs on — the same scoping rule the usage
 * indicator follows (`usageScope`), for the same reason: a number is meaningless without the
 * machine it describes.
 *
 * Both members are on-demand only, never polled: a remote answer costs an ssh exec plus a `ps` of
 * somebody else's whole process table. Pass the query through verbatim — `remote` is one of the two
 * independent sources the service uses to decide which host answers.
 */
export interface SessionMemoryApi {
  /** Per-session breakdown for the scoped machine. `ok:false` = the sweep could not run, which is
   *  NOT an empty `rows` with `ok:true` ("we looked, there are none"). */
  read(q?: SessionMemoryQuery): Promise<SessionMemoryReport>
  /** The scoped machine's RAM. `null` = could not read (never "zero"). */
  host(q?: SessionMemoryQuery): Promise<MemInfo | null>
}

/** "Open in Visual Studio Code" — src/core/vscode-detect.ts. Registered on BOTH shells via the
 *  generic platform.handle seam (src/core/vscode-handlers.ts), so it always opens on the machine
 *  actually running the shell that answers the call. */
export interface VsCodeApi {
  /** Every verified VS Code install found on this machine (empty array = none found). */
  detect(): Promise<VsCodeInstall[]>
  /** Open a file or folder. A folder opens as the WORKSPACE ROOT (VS Code's own behaviour for a
   *  directory argument) so the file tree is usable, not a single loose editor tab. */
  open(path: string): Promise<VsCodeOpenResult>
}

/** Save exported TEXT content to disk, and report whether the result has a real filesystem path
 *  ("Open in Visual Studio Code" is only offered when it does). See docs/exports.md. */
export interface ExportApi {
  /** Desktop: a native Save-As dialog + write, resolving the chosen absolute path. Server
   *  Edition/browser: a plain Blob download — the browser chooses the destination, so `path` is
   *  omitted (there is nothing on this process's filesystem to open in VS Code). */
  saveText(
    filename: string,
    content: string,
    mimeType: string
  ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
}

/** Local, git-backed version history for a user-managed record this app owns — settings today
 *  (src/core/local-history.ts, docs/local-history.md). Registered on BOTH shells. */
export interface LocalHistoryApi {
  list(domain: string, filters?: HistoryFilters): Promise<HistoryListResult>
  /** Apply an old revision as a NEW save (append-only — see local-history.ts's header). */
  restore(domain: string, sha: string): Promise<HistoryRestoreResult>
}

/** Claude Code subscription usage snapshot for the bottom-left indicator. */
export interface ClaudeUsage {
  /**
   * Every limit the plan exposes, including per-model scoped ones. Prefer this over the
   * `session`/`weekly` fields below, which are kept only so older callers keep compiling.
   */
  limits: UsageLimit[]
  session: ClaudeUsageWindow | null
  weekly: ClaudeUsageWindow | null
  /** Signed-in account email, read-only and best-effort (null if unknown). */
  email: string | null
  /** Unix ms when this snapshot was produced. */
  updatedAt: number
  /**
   * 'unavailable' = no OAuth subscription token (API-key billing / logged out) → hide pill.
   * 'fetching' = request in flight. 'ok' = windows present. 'error' = fetch failed.
   */
  status: 'unavailable' | 'fetching' | 'ok' | 'error'
}

/**
 * One REMOTE (SSH host) Claude identity's usage, read on that host over the project's
 * ControlMaster. Separate from the local per-account rows because the identity is only
 * meaningful together with the host it lives on — the same email can be logged in on two
 * machines with two different quotas in flight.
 */
export interface RemoteAccountUsage {
  /** `user@host` of the connection the numbers came from. */
  hostKey: string
  /** Managed remote account id, or null for that host's system `~/.claude`. */
  accountId: string | null
  /** Display label: the managed account's label, else the host key. */
  label: string
  usage: ClaudeUsage
}

/** What the usage indicator wants from the remote hosts right now. */
export interface RemoteUsageQuery {
  /** Read only this `user@host` — the machine the active project runs on. Omitted = every
   *  connected host, which no scoped UI asks for but keeps the channel general. */
  hostKey?: string
  /** Bypass the cache debounce (the ⟳ button). */
  force?: boolean
}

export interface UsageApi {
  /** Returns the latest snapshot (cached if fresh, else a fresh fetch). Optional account id
   *  targets a managed account; omitted = the system account (also the pushed one). */
  fetch(accountId?: string): Promise<ClaudeUsage>
  /** Forces a fresh fetch, bypassing the focus debounce. Optional account id as `fetch`. */
  refresh(accountId?: string): Promise<ClaudeUsage>
  /** Snapshots for every non-Claude provider (codex, …). Fetched on demand, not polled — pass
   *  `force` to bypass the cache debounce. Providers that aren't signed in come back
   *  'unavailable' rather than being omitted, so the caller can tell "off" from "broken". */
  providers(force?: boolean): Promise<ProviderUsage[]>
  /** Usage for the Claude identities on connected SSH hosts, read on those hosts (the credential
   *  never crosses back). On-demand like `providers`, not polled — each row costs an ssh
   *  round-trip, which is also why the caller should name the ONE host it is showing. Empty when
   *  nothing is connected, or on a shell with no SSH projects (Server Edition), so callers need
   *  no capability check. */
  remote(query?: RemoteUsageQuery): Promise<RemoteAccountUsage[]>
  /** Store (or, with an empty string, clear) a provider's browser cookie. Resolves to whether one
   *  is now stored. Write-only by design — nothing reads the value back across this boundary. */
  setProviderCookie(provider: string, cookie: string): Promise<boolean>
  /** Which cookie-based providers have one stored, so the UI shows state without the secret. */
  cookieProviders(): Promise<Record<string, boolean>>
  /** Fires whenever main pushes a new snapshot (poll/refresh). Returns unsubscribe. */
  onUpdate(listener: (usage: ClaudeUsage) => void): () => void
}

export type ContextWindowStatus = 'known' | 'unknown' | 'not-reported' | 'stale' | 'unavailable'

/** A session's context-window telemetry, pushed per sessionId from a provider tailer. */
export interface ContextWindowUsage {
  sessionId: string
  /** Provider id that produced this snapshot, for example claude, codex, or gemini. */
  provider: string
  /** Stable machine scope, never a portable-project identifier. */
  sourceKey: string
  /** input-side tokens of the latest request, when the provider reports them. */
  usedTokens: number | null
  /** Provider-reported or otherwise verified model context window. */
  windowTokens: number | null
  /** 0–100 fullness, only when both token values are finite and verified. */
  usedPercent: number | null
  /** Explicit state keeps unknown, stale, and unavailable distinct. */
  status: ContextWindowStatus
  /** Model id from the transcript, or null if not seen yet. */
  model: string | null
  /** Monotonic generation within one source epoch. Never persist this field. */
  generation: number
  /** Source epoch changes on process restart, so generation 1 is always fresh. */
  sourceEpoch: string
  /** Unix ms when this snapshot was produced, or null when no telemetry arrived. */
  updatedAt: number | null
  /** Producer lifecycle epoch. Generations are comparable only within this epoch. */
  epoch: string
  /** Stable producer identity for lifecycle ordering, independent of wall-clock time. */
  producerId: string
  /** Monotonic lifecycle sequence within producerId. */
  lifecycle: number
  /** Monotonic producer incarnation ordering epochs within a provider/source process. */
  incarnation: number
  /** Provider identity that produced this reading, when the producer knows it. */
  agentId: string
  /** Local or host source identity, used to prevent cross-host cache reuse. */
  source: string
  /** Previously retired producer epochs for this session, bounded for delayed-read rejection. */
  epochHistory: string[]
  /** Previously observed producer identities, retained so old producers cannot replay forever. */
  producerHistory: string[]
}

export interface ContextApi {
  /** Fires whenever a session's context fill changes. Returns unsubscribe. */
  onUpdate(listener: (usage: ContextWindowUsage) => void): () => void
  /**
   * Ask main to start (or refresh) tracking a session's transcript so the meter populates
   * without waiting for a live hook event — e.g. on node mount after an app restart, when
   * the continuing session is idle. `cwd` is a transcript-path fallback only.
   * `accountId` scopes resolution to a managed Claude account's transcript root (default `~/.claude`).
   */
  ensure(sessionId: string, cwd?: string, accountId?: string, agentId?: string, nodeId?: string): void
}

/**
 * Canvas sync: node mutations travel between the attached clients (an Electron renderer, a
 * Server-Edition browser tab) so they converge on one node set — instead of each holding its own
 * canvas until someone's whole-file `workspace.save` overwrites the other's edits.
 */
export interface CanvasApi {
  /**
   * Publish one local node mutation for `projectId` (a project IS a canvas — a mutation is only
   * ever applied to the canvas it was made on). Fire-and-forget; the reflector fans it out to every
   * OTHER attached client and never echoes it back to the sender.
   */
  mutate(projectId: string, mutation: CanvasMutation): void
  /** Fires with each PEER's mutation (project id + mutation). Returns unsubscribe. */
  onMutation(listener: (projectId: string, mutation: CanvasMutation) => void): () => void
}

/** One searchable line extracted from a Claude session transcript. */
export interface TranscriptLine {
  role: 'user' | 'assistant' | 'tool'
  text: string
}

/** One ordered piece of a chat message: prose, or a tool call with an optional result.
 *  `summary` (present only on live-turn tools folded into history) carries the diff-preview
 *  metadata so committed tool cards keep the same summary/diff-click treatment as live ones. */
export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool'
      name: string
      arg: string
      result?: string
      summary?: ChatToolSummary
    }

/** A structured chat message reconstructed from a Claude session transcript. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  parts: ChatPart[]
}

/** Edit/Write tool summary for diff-preview cards. */
export interface ChatToolSummary {
  filePath?: string
  added?: number
  removed?: number
}

/**
 * Result of a chat transcript read. `found` is the whole point of the wrapper: an empty
 * `messages` means two very different things — the session exists and nobody has said anything
 * yet (`found: true`), or no transcript could be resolved at all (`found: false`, e.g. Claude's
 * 30-day cleanup removed it, or the id belongs to another machine). The ⌘M panel rendered both
 * as "No conversation yet.", which is what made a resolution failure look like an empty session.
 */
export interface ChatTranscriptResult {
  messages: ChatMessage[]
  found: boolean
}

export interface ChatApi {
  /**
   * Reads a Claude session transcript as structured chat messages.
   * Resolves the transcript like `ClaudeApi.readTranscript` (sessionId → cwd), then
   * reconstructs ordered bubbles + tool calls. `nodeId` lets an SSH-project node be resolved
   * on its HOST even when no hook event has registered its transcript in this app run.
   */
  readTranscript(
    sessionId: string | undefined,
    cwd: string | undefined,
    accountId?: string,
    nodeId?: string
  ): Promise<ChatTranscriptResult>
}

/** Optional SSH context for account ops. When `projectId` names a connected SSH project, the
 *  account lives on that host (config dir + login + removal happen over ssh). Omit it for local. */
export interface AccountSshCtx {
  projectId?: string
}
export interface ClaudeAccountsApi {
  /** Mint a new managed account: create its config dir, install the hook, check the CLI version.
   *  With an SSH `ctx` the dir + hook are created on the remote host instead of locally. */
  add(ctx?: AccountSshCtx): Promise<{ id: string; configDir: string; versionSupported: boolean }>
  /** Poll the account's `.claude.json` for a completed login; null on timeout/cancel. With an SSH
   *  `ctx` the poll reads the remote host's copy over ssh. */
  waitLogin(id: string, ctx?: AccountSshCtx): Promise<{ email: string } | null>
  /** Cancel an in-flight `waitLogin` for this account. */
  cancelWaitLogin(id: string): Promise<void>
  /** Delete a managed account's config dir (recursive). With an SSH `ctx`, `rm -rf` on the host. */
  remove(id: string, ctx?: AccountSshCtx): Promise<void>
}

export interface CodexAccountsApi {
  /** Create an isolated CODEX_HOME locally or on the selected SSH project host. */
  add(ctx?: AccountSshCtx): Promise<{ id: string; home: string }>
  /** Wait for official login completion and return app-server-confirmed identity metadata. */
  waitLogin(id: string, ctx?: AccountSshCtx): Promise<{ email: string | null } | null>
  cancelWaitLogin(id: string): Promise<void>
  /** Stop that account's shared daemon and remove its profile after explicit UI confirmation. */
  remove(id: string, ctx?: AccountSshCtx): Promise<void>
  /** Return identity only when this managed home already contains a completed file login. */
  identity(id: string, ctx?: AccountSshCtx): Promise<{ email: string | null } | null>
  /** Identity of the system ~/.codex account, read through account/read. */
  systemIdentity(ctx?: AccountSshCtx): Promise<{ email: string | null } | null>
  /** Rebind an idle conversation to another login without changing its thread identity. */
  switchThread(
    threadId: string,
    cwd: string,
    sourceAccountId?: string,
    targetAccountId?: string
  ): Promise<{ threadId: string; rollbackToken?: string }>
  /** Copy a local rollout into an SSH-host account without deleting or rewriting the source. */
  transferThreadToSsh(
    threadId: string,
    sourceAccountId: string | undefined,
    targetAccountId: string | undefined,
    ctx: AccountSshCtx
  ): Promise<{ threadId: string }>
  commitSwitch(rollbackToken: string): Promise<void>
  finishSwitch(rollbackToken: string): Promise<void>
  rollbackSwitch(rollbackToken: string): Promise<void>
}

/** One ranked search hit across all on-disk Claude session transcripts. */
export interface TranscriptHit {
  sessionId: string
  title: string
  snippet: string
  cwd: string
  projectLabel: string
  mtime: number
}

export interface TranscriptsApi {
  /** Search all on-disk Claude session transcripts by content. */
  search(query: string): Promise<TranscriptHit[]>
}

/** What the Claude CLI on THIS machine can do. Fed by the `claude --version` probe in
 *  core/claude-cli.ts; every field fails open to the conservative answer when the version
 *  is unknown (missing CLI, timeout, unreadable output). */
export interface ClaudeCliCaps {
  version: string | null
  /** `--permission-mode auto` is only accepted by Claude Code >= 2.1.71. */
  autoPermissionMode: boolean
  /** `"tui": "fullscreen"` in settings.json is only understood by Claude Code >= 2.1.89. Gates
   *  whether nodeterm writes that key (write-if-absent) so sessions render fullscreen in tmux. */
  fullscreenTui: boolean
  /**
   * Whether this CLI accepts `--session-id <uuid>`, which lets nodeterm MINT a node's session id
   * instead of waiting to learn it from a hook. Detected by reading `claude --help`, not by
   * comparing versions: the version this flag first shipped in is not documented anywhere we can
   * check, and a guessed floor is the one mistake that would be fatal here — an unknown flag makes
   * the CLI exit, so a wrong guess kills every claude launch rather than degrading.
   */
  sessionIdFlag: boolean
}

/** The answer whenever the CLI version can't be determined: no `auto` flag → bare command, and no
 *  fullscreen-tui write (an unknown settings key can warn on old CLIs — silence is safer). */
export const UNKNOWN_CLAUDE_CLI_CAPS: ClaudeCliCaps = {
  version: null,
  autoPermissionMode: false,
  fullscreenTui: false,
  sessionIdFlag: false
}

/** Whether a Codex node launched on this machine right now would get a managed shared identity.
 *  Fed by core/codex-identity-caps.ts; the unknown answer is `false`, i.e. plain `codex`. */
export interface CodexIdentityCaps {
  shared: boolean
  /** Absolute path of the installed launcher, or null when it could not be written. */
  launcherPath: string | null
  /** Does the installed `codex` accept `--remote`? Feature-detected from its own `--help`. The one
   *  precondition that cannot be recovered from at runtime: the launcher execs, and a CLI without
   *  the flag dies on a usage error where no fallback is left. Unknown ⇒ false ⇒ plain codex, and
   *  "not probed" counts as unknown: when `appServer` is false the help spawns are skipped, so this
   *  reads false whatever the CLI's help page would have said. */
  remoteFlag: boolean
  /** Can this INSTALL run a shared app-server at all? `codex app-server daemon start` needs the
   *  standalone runtime the Codex installer manages; an npm (or snap) install has the `--remote`
   *  flag in its help and no such runtime, so it can never serve a shared identity. Unknown ⇒
   *  false ⇒ plain codex. */
  appServer: boolean
}

/** The answer before the probe has run, and the one the Server Edition gives on purpose. */
export const UNKNOWN_CODEX_IDENTITY_CAPS: CodexIdentityCaps = {
  shared: false,
  launcherPath: null,
  remoteFlag: false,
  appServer: false
}

/** A Codex node's identity mode, as reported by the node's own launcher at spawn time.
 *  `plain` carries the machine-readable reason the managed identity was unavailable. */
export interface CodexIdentityEvent {
  nodeId: string
  mode: 'shared' | 'plain'
  reason?: string
}

/** The Codex-specific surface. Small on purpose: everything else a Codex node needs already goes
 *  through the shared agent/pty APIs. */
export interface CodexApi {
  /** Would a Codex node launched right now get a managed shared identity on this machine?
   *  Never rejects — the unknown answer is `{ shared: false }`, i.e. plain `codex`. */
  identityCaps(): Promise<CodexIdentityCaps>
  /** Fires when a Codex node's launcher reports its identity mode. `plain` is the fallback, and
   *  this event is what stops that fallback being silent. Returns unsubscribe. */
  onIdentity(listener: (e: CodexIdentityEvent) => void): () => void
}

export interface ClaudeApi {
  /** Capabilities of the local Claude CLI (memoized in the shell; safe to call repeatedly).
   *  Never rejects — an unknown version resolves to the fail-open caps. */
  cliCaps(): Promise<ClaudeCliCaps>
  /** Read-only metadata catalogue of local and connected Claude skill scopes. */
  skills: ClaudeSkillsApi
  /**
   * Reads a Claude session's full transcript as flat searchable lines ([] if unavailable).
   * Resolves by `sessionId` when known (exact); otherwise falls back to `cwd` (durable —
   * the newest transcript under that project dir, no live hook event required).
   * `accountId` scopes resolution to a managed Claude account's transcript root (default `~/.claude`).
   * `nodeId` (optional) lets an SSH-project node's transcript be located on its HOST when no hook
   * event has registered it in this app run — without it the search silently reads nothing there.
   */
  readTranscript(
    sessionId: string | undefined,
    cwd: string | undefined,
    accountId?: string,
    nodeId?: string
  ): Promise<TranscriptLine[]>
}

export type HandoffResult = { filePath: string } | { error: string }

/** Agent launch/gateway IPC. The renderer has no `process.env`; `${env:VAR}` expansion runs
 *  renderer-side against the `envSnapshot()` cache (src/renderer/lib/agentEnv.ts), so the
 *  Settings preview and the typed launch command share one assembler AND one environment — they
 *  cannot drift by construction. */
export interface AgentApi {
  /** A string-only snapshot of the main process environment (undefined entries omitted), for
   *  expanding `${env:VAR}` tokens in launch commands and the Settings preview. Desktop-window
   *  only: the browser/relay bridges resolve `{}` (a host env dump must never cross to a peer —
   *  the PR #195 leak class), and expansion there degrades to the missing-env refusal. */
  envSnapshot(): Promise<Record<string, string>>
  /** Query the configured gateway's OpenAI-compatible `/v1/models` endpoint. Never rejects. */
  discoverModels(settings: ModelGatewaySettings): Promise<ModelDiscoveryResult>
  /** Literal gateway credentials are write-only in the renderer. */
  gatewayCredentialStatus(): Promise<ModelGatewayCredentialStatus>
  saveGatewayCredential(apiKey: string): Promise<ModelGatewayCredentialStatus>
  clearGatewayCredential(): Promise<ModelGatewayCredentialStatus>
}

export interface HandoffApi {
  /** False on Server Edition: `handoff:build` is registered only in `src/main`, so the browser
   *  bridge has nothing to call and its stub rejects. UI must hide the transfer affordance rather
   *  than offer a menu item whose rejection escapes the resolved-result contract below. */
  readonly supported: boolean
  /**
   * Render the source agent's full conversation transcript (located by `sessionId`)
   * to a portable Markdown file under `<cwd>/.nodeterm/` and return its absolute path.
   * No summarization — the entire transcript including tool calls and outputs.
   */
  build(
    sessionId: string,
    agentId: string,
    sourceNodeId: string,
    cwd: string | undefined,
    accountId?: string
  ): Promise<HandoffResult>
}

export interface LicenseStatus {
  /** 'pro' when entitled, else null. */
  tier: string | null
  active: boolean
  /** Unix seconds when the entitlement expires, or null. */
  expiresAt: number | null
  /** Seat cap for the relay host (Team Access): premium → the token's seats (absent → 1), free/inactive → 0. */
  seats: number
  /** Last activation/refresh error reason code, or null. */
  error: string | null
}

/**
 * Where the entitlement behind this install came from. A verified entitlement's licenseId is NOT
 * always a keygen license id: an App Store purchase on a paired phone bridges Pro to the desktop
 * and mints `apple:<txn>`, and `free:` exists too. For those the server makes zero keygen calls
 * and answers `key: null, used: 0, seats: 0` — genuinely "device counting does not apply here",
 * which is a different fact from a failed read and from a keygen license with no devices yet.
 */
export type LicenseSource = 'keygen' | 'apple' | 'free'

/** What Settings → License shows: the key to copy and how much of the device cap is in use.
 *  A failed read is an ERROR, never "0 devices" — the two are different facts. */
export interface LicenseDetail {
  /** The license key to copy. `null` on a 200 is legitimate (a keygen policy that hides keys, a
   *  license predating the column, a non-keygen source) — it is NOT an error. */
  key: string | null
  /** Devices currently activated. May EXCEED `seats` if a cap was lowered after activation. */
  used: number
  seats: number
  /** The source the server stated, or null when it stated none — every error reply, and the
   *  release route's 200, which answers with counts only. Never inferred locally. */
  source: LicenseSource | null
  /** Null on success; a stable reason code otherwise ('unauthorized' | 'inactive' | 'offline' |
   *  'disabled' | 'too_soon' | 'not_applicable' | 'network'). A failed read is an error, never
   *  "0 devices". */
  error: string | null
  /** Days until another release is allowed — only set with error === 'too_soon'. */
  retryAfterDays?: number
}

export interface LicenseApi {
  /** Open Stripe checkout bound to this device and poll for the entitlement (no key paste).
   * `target` picks the link: 'seats' = the add-seats (quantity) link, else base Pro (default).
   * Returns the current status immediately; the active status arrives via onChange. */
  upgrade(target?: 'pro' | 'seats'): Promise<LicenseStatus>
  /** Activate a license key on this device. Returns the resulting status. */
  activate(key: string): Promise<LicenseStatus>
  /** Release this device's seat and clear the local license. */
  deactivate(): Promise<LicenseStatus>
  /** Current cached status (verifies the stored token offline). */
  getStatus(): Promise<LicenseStatus>
  /** Fires when the license status changes. Returns unsubscribe. */
  onChange(listener: (s: LicenseStatus) => void): () => void
  /** The license key + device usage for this machine's license. Authorized by the stored
   *  entitlement token — never by deviceId. */
  detail(): Promise<LicenseDetail>
  /** Deactivate every device on this license except this one. Throttled server-side to once
   *  per 30 days (error 'too_soon' + retryAfterDays). Answers with COUNTS only: no key and no
   *  source ride a successful release, so callers must merge rather than replace. */
  releaseOthers(): Promise<LicenseDetail>
}

export interface RemoteHostApi {
  /**
   * Enter host mode: mint a pairing token, connect to the relay as the host, and return the
   * pairing offer string (`nodeterm://pair?code=…`) to hand to a client. Rejects if the device
   * is not entitled to Pro (or in a dev build without NODETERM_RELAY_URL).
   */
  start(): Promise<{ offer: string }>
  /** Leave host mode: close the relay connection (ends served PTYs, drops client access). */
  stop(): Promise<void>
  /**
   * Push the host's current active-project canvas snapshot to main. Main keeps the latest
   * and (re)broadcasts it to a connected client (debounced). Safe to call when not hosting.
   */
  sendCanvasState(state: CanvasState): void
  /**
   * Listen for a client's mutation command that the host renderer must apply to its React
   * Flow (the single writer). Returns an unsubscribe function.
   */
  onApplyMutation(listener: (mutation: CanvasMutation) => void): () => void
  /**
   * Fires when a client finishes the E2EE handshake and is awaiting approval. The host must call
   * `approve()` before any of the client's pty/fs RPCs are served; `sas` is the channel
   * verification code to display. Returns an unsubscribe function.
   */
  onPeerPending(
    listener: (info: { sas: string | null; id: string; pub?: string | null }) => void
  ): () => void
  /** The pending prompt expired host-side (120 s) — the dialog must drop or re-arm, else its
   *  Approve is a silent no-op against a dead id (issue #372). */
  onPeerPendingCleared(
    listener: (info: { id: string | null; pub?: string | null }) => void
  ): () => void
  /** Approve the pending client → the host begins serving its pty/fs RPCs. `pub` (the peer's
   *  stable box key) survives the phone's reconnect churn where the per-attach `id` does not —
   *  pass both when known. */
  approve(id: string, pub?: string): void
  /** Reject the pending client → the connection is dropped. Same id/pub matching as approve. */
  reject(id: string, pub?: string): void
  /**
   * Start/stop the standing (phone) relay host so a paired phone can reach this Mac from anywhere.
   * Mirrors `settings.phoneAccessEnabled`.
   */
  setPhoneAccess(enabled: boolean): void
}

/**
 * Payload of `relayHost.onPeerPending`: a client has finished the E2EE handshake over the new
 * relay tunnel and is awaiting the host human's approval. `id` addresses this pending peer for
 * `confirm(id)`; `sas` is the channel verification code both humans compare (null before the key is
 * derived); `peerKeyB64` is the peer's stable box public key to pin on approval.
 */
export interface RelayPeerPending {
  id: string
  sas: string | null
  peerKeyB64: string
  /** Team Access: the invitee email this seat was invited with, if any. DISPLAY label only (never
   *  trust/identity — the SAS is the gate); used to tag the row in the connected-devices list. */
  email?: string
}

/**
 * HOST side of the new E2EE relay tunnel (Stage 4) — the successor to `RemoteHostApi`. A connected
 * peer becomes a first-class CorePlatform client (it exchanges raw rpc frames), so this surface is
 * only the mutual-approval gate plus enter/leave, not a per-verb API. Desktop-only (Electron);
 * the Server Edition browser build degrades every member to `E_UNSUPPORTED`/no-op.
 */
export interface RelayHostApi {
  dockerContexts(): Promise<Array<{ name: string; current: boolean; endpoint: string }>>
  /** Guided local/SSH Docker management. Desktop owns the CLI; Server Edition refuses it. */
  manager: DockerHostManagerApi
  /** Guided Nextcloud AIO lifecycle manager. Desktop-only; the browser shell reports unsupported. */
  nextcloudAio: NextcloudAioManagerApi
  /** Guided managed Nextcloud profile without a container-runtime socket. */
  nextcloudManaged: import('./nextcloud-managed').NextcloudManagedApi
  /**
   * Enter host mode over the relay: connect and return a pairing offer string to hand to a client.
   * Rejects when Docker or the configured relay is unavailable. `projectId` is the
   * single project this hosting session shares with the peer; omit for the legacy whole-workspace view.
   */
  start(projectId?: string): Promise<{ offer: string; id: string }>
  /**
   * Team Access: ADD a seat — mint a fresh pairing offer for one more device (no supersede), tagged
   * with the optional invitee `email` (display label only). Rejects `E_SEATS_FULL` when the licensed
   * seat cap is reached, and with the Pro / dev-build errors `start` uses. `projectId` scopes the
   * shared project as in `start`. Resolves with the offer AND the seat's `id` — the settings UI uses
   * it to show the pending row immediately and to `revoke` a seat whose peer never connects.
   */
  invite(opts?: { projectId?: string; email?: string }): Promise<{ offer: string; id: string }>
  /** Leave host mode: close every bridged peer in the pool. */
  stop(): Promise<void>
  /**
   * Team Access: per-peer revoke — cut ONE bridged peer's live session immediately (by its id) and
   * free its seat. Distinct from `stop()` (which drops all).
   */
  revoke(id: string): void
  /**
   * Fires when a client finishes the handshake and is awaiting approval. The host must `confirm()`
   * before the peer is admitted as a client. Returns an unsubscribe function.
   */
  onPeerPending(listener: (info: RelayPeerPending) => void): () => void
  /** Approve the pending peer (by its pending id) after comparing the SAS → it joins as a client. */
  confirm(id: string): void
  /** Fires when a bridged peer becomes a live client (both humans confirmed). Returns unsubscribe.
   *  `email` is the seat's invite label, if any (Team Access). */
  onOpen(listener: (info: { id: string; email?: string }) => void): () => void
  /** Fires when a bridged peer's connection drops. Returns an unsubscribe function. */
  onClosed(listener: (info: { id: string }) => void): () => void
}

/**
 * CLIENT side of the new E2EE relay tunnel (Stage 4) — the successor to the deleted legacy relay
 * client dialect. The client exchanges raw rpc.ts frames (JSON strings) with the host over the encrypted tunnel rather
 * than a per-verb channel set. Desktop-only (Electron); the Server Edition browser build degrades
 * every member to `E_UNSUPPORTED`/no-op.
 */
export interface RelayClientApi {
  /**
   * Connect to a host by its pairing offer string. Gates on entitlement (rejects otherwise, and in
   * dev builds without the relay URL). Resolves with a `connectionId` to address the methods below.
   */
  connect(offer: string): Promise<string>
  /**
   * Listen for the channel SAS once the handshake completes, so the client human can compare it
   * with the code shown on the host before approving. Returns an unsubscribe function.
   */
  onSas(connectionId: string, listener: (sas: string | null) => void): () => void
  /** Confirm the SAS on this side (the client half of the mutual-approval gate). */
  confirm(connectionId: string): void
  /** Fires once the host approves this connection → the client may begin exchanging frames. */
  onApproved(connectionId: string, listener: () => void): () => void
  /** Cast an outbound rpc frame (a JSON string) at the host over the tunnel. */
  send(connectionId: string, frame: string): void
  /** Listen for an inbound rpc frame (a JSON string) from the host. Returns an unsubscribe. */
  onFrame(connectionId: string, listener: (frame: string) => void): () => void
  /** Fires when the connection's relay socket drops (host/relay gone). Returns unsubscribe. */
  onClosed(connectionId: string, listener: () => void): () => void
  /** Close a connection: end the relay socket and drop access to the host. */
  disconnect(connectionId: string): void
}

/** A paired device as exposed to the renderer — the bearer token is never included. */
export interface PairedDevice {
  id: string
  name: string
  /** epoch-ms the device was paired. */
  pairedAt: number
  /** epoch-ms the host agent last saw this device (0 = never). */
  lastSeenAt: number
  /**
   * The phone's OWN device id — what the relay backend keys its device row on, as opposed to
   * `id`, which is ours. Absent for devices paired before this field existed; that is NOT "there
   * is no server row we can name", because a revoke then falls back to `id`, which is the value
   * the mint sent as the row's key whenever the phone supplied no id of its own (see
   * `revokeDevice` in main/pairing-service.ts, including the residual case it cannot name). An id,
   * not a secret, which is why it may cross to the renderer.
   */
  relayDeviceId?: string
}

/**
 * The server leg of a device revoke — three states, because two cannot tell the truth apart.
 * 'ok' = the backend confirmed; 'failed' = we asked and were refused or could not reach it;
 * 'skipped' = we did not ask and that is fine (no entitlement to sign with — a free-tier desktop
 * has no Pro of ours on that phone to reclaim — or no such device to name). Only 'failed' is a
 * warning: reporting 'skipped' as a failure would tell a free user their phone's Pro is stuck.
 *
 * 'ok' is the backend's 204, which is idempotent and reveals nothing about WHICH row it applied
 * to — see the residual-leak note on `revokeDevice` in main/pairing-service.ts before treating it
 * as proof that a particular phone lost Pro.
 */
export type DeviceRevokeServerOutcome = 'ok' | 'failed' | 'skipped'

/**
 * Both legs of a device revoke, reported independently so a half-finished removal can never render
 * as a clean one (the same discipline as remote/revocation.ts's persisted/killed).
 */
export interface DeviceRevokeResult {
  /** The agent.json entry + authorized_keys line were removed from this machine. */
  local: boolean
  /** Whether the phone's Pro entitlement was taken back on the relay backend. */
  server: DeviceRevokeServerOutcome
}

/** One-shot pairing completion delivered from the desktop host to every renderer surface. */
export type PairingDoneResult = {
  /** Correlates this event with the renderer start that owns it. */
  attemptId: string
  ok: boolean
  /** Present on ok=false so persistence/security failures are never mislabeled as timeouts. */
  reason?: 'timeout' | 'attempts' | 'failed'
  /** Present on ok=true: whether the phone also received a usable relay leg. */
  relay?: 'ok' | 'off' | 'failed' | 'dev'
}

/** Phone-pairing (nodeterm iOS "scan a QR" flow) bridge. */
/** Result of the Remote Login help action. `opened:'none'` is an honest answer, not a failure: it
 *  means this platform has no settings surface worth opening and `command` is what to run. */
export interface RemoteLoginHelp {
  opened: 'settings' | 'none'
  /** Which settings surface, when knowing matters for the copy (Windows: the OpenSSH feature). */
  note?: 'openssh-server'
  /** Present only when `opened` is 'none' — the exact command the user should run. */
  command?: string
}

/** Result of revoking one mutually-approved relay peer (revocation.ts's RevokeResult, mirrored so
 *  the renderer never imports main-process code). Both booleans are reported independently: a
 *  peer that stays pinned on disk (`persisted:false`) is a different, worse failure than a peer
 *  whose live session could not be cut (`killed:false`), and the UI must never collapse the two
 *  into a bare success. */
export interface RelayPeerRevokeResult {
  /** `true` iff the unpin decision is durable on disk. `false` means the peer may still be
   *  pinned and could reconnect with no approval prompt — never report this as "Removed". */
  persisted: boolean
  /** `true` iff the peer's live relay session (if any) was cut. `false` means it may still hold
   *  an open, shell-equivalent connection. */
  killed: boolean
}

/** Every relay peer pinned by mutual approval, and the ability to revoke one. Public keys only —
 *  never a credential — mirroring `main/remote/approved-devices.ts`'s on-disk store. This is a
 *  host-security control surface: it is registered on raw ipcMain (see `RELAY_LOCAL_ONLY_METHODS`
 *  in `platform-electron.ts`) and a relay peer can never reach either method over the tunnel. */
export interface RelayPeersApi {
  /** False on Server Edition, which has no desktop relay host and no pinned-peer store. */
  readonly supported: boolean
  /** Base64 NaCl box public keys of every peer approved at least once. There is no label or
   *  last-seen timestamp on disk today — the UI shows the key itself, truncated for readability. */
  list(): Promise<string[]>
  /** Unpin a peer AND cut its live relay session(s) — unpinning alone only refuses the NEXT
   *  handshake while an already-open socket keeps full shell access. */
  revoke(peerKeyB64: string): Promise<RelayPeerRevokeResult>
}

export interface PairingApi {
  /** False on Server Edition, where the browser is already attached to its host and no desktop
   *  LAN listener / OS SSH-key store exists. UI must show a deliberate degrade, not call stubs. */
  readonly supported: boolean
  /** Start the one-shot LAN listener; resolves with the QR payload + an SSH-reachable hint. */
  start(attemptId: string): Promise<{
    /** Echo of the cryptographic UUID supplied by the renderer. */
    attemptId: string
    payload: string
    sshOpen: boolean
    relayPlan?: 'ok' | 'dev' | 'off'
    /** Compatibility credential accepted only inside the hostKey-authenticated envelope. The UI
     *  does not advertise it as a plaintext browser fallback. Attempt-capped because six digits
     *  is a small number. */
    shortCode?: string
    /** The LAN listener address (diagnostic/compatibility metadata). */
    manualHost?: string
  }>
  /** Cancel only the named pairing attempt. A stale surface must not stop its replacement. */
  stop(attemptId: string): Promise<void>
  /** Fires once when pairing finishes. Failure reasons keep a commit error distinct from timeout. */
  onDone(cb: (result: PairingDoneResult) => void): () => void
  /** Live re-probe of 127.0.0.1:22, so the Remote Login warning can clear the moment the user
   *  flips the toggle in System Settings (polled by the UI only while the warning is showing). */
  probeSsh(): Promise<boolean>
  /** Open System Settings → General → Sharing (Remote Login). The deep link is a main-side
   *  constant — x-apple.* schemes never pass shellOpenExternal's http(s) allowlist. macOS-only;
   *  a no-op elsewhere. */
  /** What the help action actually did, so the renderer can say so rather than guess.
   *  macOS/Windows open a real settings surface; Linux has no settings URL that is right
   *  across desktops, so it returns the command to run instead of misfiring a button. */
  openRemoteLoginSettings(): Promise<RemoteLoginHelp>
  /** List paired devices from ~/.nodeterm/agent.json (never includes the token). */
  listDevices(): Promise<PairedDevice[]>
  /**
   * Revoke a device: remove its registry entry, delete its authorized_keys line, and take its Pro
   * entitlement back on the relay backend. Never rejects for a leg that failed — read the result.
   */
  revokeDevice(id: string): Promise<DeviceRevokeResult>
}

/** Team presence (docs/team-presence.md). All of it is transient — nothing here is persisted. */
export interface PresenceApi {
  /** Announce {name, color}. Resolves with THIS client's own id (so it never draws its own
   *  cursor) plus the current peer table. */
  hello(identity: PeerIdentity): Promise<{ clientId: ClientId; peers: PeerState[] }>
  /** Publish the local cursor in FLOW coordinates (null when it leaves the canvas). */
  cursor(cursor: { x: number; y: number } | null): void
  /** Publish the node the local user is working in (null = none). */
  focus(nodeId: string | null): void
  /** Publish live cursor-chat text (null closes the bubble). */
  chat(text: string | null): void
  /** Publish the live dino game we are the authority for (null = stopped/idle). Spectators read
   *  the matching peer's `dino` and render `snap` instead of running their own sim. */
  dino(payload: { nodeId: string; snap: DinoSnapshot } | null): void
  /** Publish the project (canvas) we are looking at — peers on other projects are never drawn
   *  on our canvas, and we are never drawn on theirs (null = no project open). */
  project(projectId: string | null): void
  /** Full peer-table snapshot (on join). Returns unsubscribe.
   *  Exactly one subscriber (the presence store, src/renderer/state/presence.ts): the browser
   *  bridge drains its early-event buffer into the FIRST subscriber, so a second one gets nothing.
   *  Components read the store; they never subscribe here. */
  onSync(listener: (peers: PeerState[]) => void): () => void
  /** Single-peer diff (join / update / leave). Returns unsubscribe.
   *  Exactly one subscriber (the presence store) — same reason as onSync. */
  onPeer(listener: (diff: PeerDiff) => void): () => void
}

/** Toy locks (docs/toy-locks.md) — see src/shared/toylock.ts for why "toy" is load-bearing: this
 *  is a for-fun UX speed bump, never security. Every method is core-bound (same machine's data
 *  dir the workspace/settings live in — Desktop's own userData, or the Server Edition's host). */
export interface ToylockApi {
  list(): Promise<ToyLockRecord[]>
  createPassword(input: ToyLockCreatePasswordInput): Promise<ToyLockCreateResult>
  beginTotp(input: ToyLockBeginTotpInput): Promise<ToyLockBeginTotpResult>
  confirmTotp(input: ToyLockConfirmTotpInput): Promise<ToyLockConfirmTotpResult>
  cancelTotp(lockId: string): Promise<void>
  update(input: ToyLockUpdateInput): Promise<ToyLockRecord | null>
  remove(id: string): Promise<void>
  verify(input: ToyLockVerifyInput): Promise<ToyLockVerifyResult>
  /** Renderer-driven relock (a session-mode surface was left, a manual relock). Core marks the
   *  unlock itself on a successful verify, but only the renderer can see the surface being LEFT —
   *  without this call core would keep authorizing name-addressed writes (dictation) after the
   *  lock visibly re-engaged. Fire-and-forget. */
  relock(lockId: string): Promise<void>
  /** The unlock ladder for a lock whose wrong attempts have earned a wait (docs/unlock-ladder.md):
   *  dim sum → ten easy sums → whack-a-mole. `challenge: null` means no ladder is on offer — no
   *  wait in effect, the rolling budget is spent, or this climb has already been failed to the
   *  bottom. Clearing a rung ends the WAIT only. */
  ladderIssue(lockId: string): Promise<ToyLockLadderState>
  ladderVerify(input: ToyLockLadderVerifyInput): Promise<ToyLockLadderVerifyResult>
}

/** The built-in authenticator (docs/authenticator.md) — arbitrary TOTP secrets kept locally,
 *  never synced, never phoning anywhere. Core-bound, same machine as ToylockApi. */
export interface AuthenticatorApi {
  list(): Promise<AuthenticatorEntry[]>
  addManual(input: AuthenticatorAddManualInput): Promise<AuthenticatorAddResult>
  addFromUri(uri: string): Promise<AuthenticatorAddResult>
  rename(input: AuthenticatorRenameInput): Promise<AuthenticatorEntry | null>
  remove(input: AuthenticatorRemoveInput): Promise<AuthenticatorRemoveResult>
  code(id: string): Promise<AuthenticatorCode | null>
  codes(ids: string[]): Promise<Record<string, AuthenticatorCode>>
  reveal(id: string): Promise<AuthenticatorRevealResult>
  exportSecrets(input: AuthenticatorExportInput): Promise<AuthenticatorExportResult>
}

/** Per-project password manager (shared/password-manager.ts, docs pending). Every method is
 *  scoped by `projectId` because the vault lives at that project's `<cwd>/.nodeterm/vault.json`
 *  (core/password-manager/vault-store.ts) — there is no machine-global vault. LOCAL-ONLY: this
 *  namespace is deliberately absent from the relay peer allowlist (main/relay-rpc-policy.ts),
 *  exactly like ToylockApi/AuthenticatorApi — a mutually-approved relay peer gets shell-equivalent
 *  access to the joined project, but must never be able to unlock or read this desktop's stored
 *  credentials. See main/relay-rpc-policy.ts's header comment for why the allowlist is exact
 *  rather than a blocklist. */
export interface PasswordManagerApi {
  status(projectId: string): Promise<VaultStatus>
  createVault(projectId: string, password: string): Promise<VaultCreateResult>
  unlock(projectId: string, password: string): Promise<VaultUnlockResult>
  lock(projectId: string): Promise<void>
  changePassword(projectId: string, input: ChangeVaultPasswordInput): Promise<ChangeVaultPasswordResult>
  createManager(projectId: string, input: CreateManagerInput): Promise<CreateManagerResult>
  renameManager(projectId: string, input: RenameManagerInput): Promise<ManagerMutationResult>
  bindManagerGroup(projectId: string, input: BindManagerGroupInput): Promise<ManagerMutationResult>
  releaseGroupBinding(projectId: string, groupId: string): Promise<ReleaseGroupBindingResult>
  deleteManager(projectId: string, id: string): Promise<ManagerMutationResult>
  createCredential(projectId: string, input: CreateCredentialInput): Promise<CreateCredentialResult>
  renameCredential(projectId: string, input: RenameCredentialInput): Promise<ManagerMutationResult>
  updateCredentialSecret(projectId: string, input: UpdateCredentialSecretInput): Promise<UpdateCredentialResult>
  removeCredential(projectId: string, input: RemoveCredentialInput): Promise<RemoveCredentialResult>
  revealCredential(projectId: string, managerId: string, credentialId: string): Promise<RevealCredentialResult>
  credentialCode(projectId: string, managerId: string, credentialId: string): Promise<CredentialCodeResult>
  /** Every credential in one manager, as non-secret metadata. No key required, exactly as
   *  `status` needs none for manager names and counts. */
  listCredentials(projectId: string, managerId: string): Promise<ListCredentialsResult>
}

/** Portal-door entry uses a separate host-owned local vault, never toy-lock state. Values cross
 * the protected renderer boundary only for the immediate configure or verify call and are never
 * returned, projected, logged, or exported. */
export interface UniverseDoorEntryApi {
  configure(input: {
    doorId: string
    method: 'numeric-code' | 'passphrase'
    value: string
    numericCodeDigits?: number
    passphraseMinLength?: number
  }): Promise<{ ok: true; credentialKey: string } | { ok: false; error: string }>
  verify(input: {
    doorId: string
    method: 'numeric-code' | 'passphrase'
    value: string
  }): Promise<{ verified: true } | { verified: false; reason: string }>
  remove(doorId: string): Promise<void>
}

export interface TimerApi {
  occurrences(): Promise<import('./timer').TimerOccurrence[]>
  schedule(timerId: string, scheduledAt: number): Promise<import('./timer').TimerOccurrence | null>
  transition(id: string, state: import('./timer').TimerOccurrenceState): Promise<import('./timer').TimerOccurrence | null>
  lap(id: string, elapsedMs: number): Promise<number[] | null>
}

export interface TriggerApi {
  status(projectId: string, nodeId: string): Promise<import('./trigger').TriggerStatus>
  arm(projectId: string, nodeId: string, spec: import('./trigger').TriggerSpec): Promise<boolean>
  disarm(projectId: string, nodeId: string): Promise<void>
  runNow(projectId: string, nodeId: string): Promise<import('./trigger').TriggerRunReceipt>
  history(projectId: string, nodeId?: string): Promise<import('./trigger').TriggerRunReceipt[]>
  onChanged(listener: (receipt: import('./trigger').TriggerRunReceipt) => void): () => void
}
/** Keyboard-shortcut plumbing the RENDERER cannot do for itself. */
export interface ShortcutsApi {
  /** Tell the shell that a shortcut recorder is armed (`true`) or released (`false`), so the
   *  desktop's `before-input-event` intercepts stand down and the chord being recorded — ⌘W and
   *  ⌘M among them — reaches the recorder instead of closing the user's selected nodes. A claimed
   *  chord never reaches the page, so the recorder's own preventDefault cannot substitute for
   *  this. Fire-and-forget. **The `false` leg is not optional**: the bit is global, so a recorder
   *  that arms and never releases leaves those chords dead app-wide. Server Edition: a documented
   *  no-op (a browser tab has no application menu to steal a chord back from, so nothing
   *  intercepts). */
  setRecording(active: boolean): void
  /** Mirror whether an xterm currently holds keyboard focus, so the desktop's intercepts can stand
   *  down under the `terminal-first` shortcut policy — `before-input-event` fires before any
   *  renderer handler could answer, so main needs the answer in advance. Sent on CHANGE only.
   *  Fire-and-forget, and **not optional**: the mirror is the only thing that makes the policy
   *  reach the three main-intercepted chords. Read fail-safe on the far side (a missing or stale
   *  mirror = not focused = intercepts on), so the failure mode of never sending is the app
   *  behaving as it did before the policy existed. Server Edition: a documented no-op, like
   *  `setRecording` — a browser tab has no application menu to steal a chord back from. */
  setTerminalFocused(focused: boolean): void
}

/** Electron-only projection for stable host-owned copy. Server Edition omits this namespace. */
export interface NativeCopyApi {
  getEpoch(): Promise<number>
  replace(projection: NativeCopyProjection): Promise<NativeCopyReplaceResponse>
  reset(): void
}

export interface NodeTerminalApi {
  pty: PtyApi
  /** Desktop-only Windows profile detection; absent on Server Edition and mobile bridges. */
  terminalProfiles?: TerminalProfilesApi
  workspace: WorkspaceApi
  /** Shared provider-account, credential-vault, OAuth-callback, and resource-picker services. */
  providerServices: import('./provider-services').ProviderServicesApi
  /** Named provider profiles and project bindings, with credential values kept in the host vault. */
  providerAccounts: import('./provider-accounts').ProviderAccountsApi
  /** Host-owned Cloudflare tunnel inventory, route preservation, and reviewed DNS adoption. */
  cloudflareTunnels: import('./cloudflare-tunnels').CloudflareTunnelApi
  /** Server Edition callback completer; absent on the desktop, which uses sshProject forwarding. */
  remoteOAuth?: import('./remote-oauth').RemoteOAuthApi
  /** Typed Cloudflare Access, Zero Trust, Workers, Pages, R2, D1 and Queues managers. */
  cloudflareZeroTrust: import('./cloudflare-zero-trust').CloudflareApi
  timer: TimerApi
  /** Trigger controls are available on shells that register the scheduler. */
  trigger?: TriggerApi
  serverDeployment: ServerDeploymentApi
  projectSettings: ProjectSettingsApi
  projectSetup: ProjectSetupApi
  worktree: WorktreeApi
  dialog: DialogApi
  settings: SettingsApi
  schoolMode: SchoolModeApi
  kidsMode: KidsModeApi
  scheduledSettings: ScheduledSettingsApi
  planner: PlannerApi
  /** Desktop exposes the host Alarm Clock mirror. Other shells may omit it and retain the
   * renderer-local fallback until their bridge supplies the same namespace. */
  alarm?: AlarmApi
  speech: SpeechApi
  /** Universal file converter — docs/file-converter.md. */
  converter: import('./converter').ConverterApi
  /** Local AWS CDK manager. The browser bridge exposes an explicit unsupported response. */
  cdk: import('./cdk').CdkApi
  /** Shared automatic dependency lifecycle for node-feature installers. */
  nodeDependencies: import('./node-dependencies').NodeDependenciesApi
  /** Current installed AWS CLI model source for the AWS Shop operation wizard. */
  awsWizardModels: import('./aws-wizard').AwsWizardModelsApi
  /** Local Ollama suite manager — docs/ollama-manager.md. */
  ollama: import('./ollama').OllamaApi
  /** Project-scoped semantic code and dependency graph with host-owned cache. */
  repositoryGraph: import('./repository-graph').RepositoryGraphApi
  /** Machine-owned UniGetUI Global Universe. It is deliberately independent of activeProjectId. */
  unigetui: import('./unigetui').UniGetUiApi
  /** Guided local Open WebUI hosting with persistent volume and explicit provider setup. */
  openWebUi: import('./open-webui-hosting').OpenWebUiApi
  /** Guided Cloudflare managers — docs/features/integrations/cloudflare-core-managers.md. */
  cloudflareCoreManagers?: import('./cloudflare-core-managers').CloudflareCoreManagersApi
  /** Local WebTorrent downloader — docs/torrent-downloader.md. */
  torrent: import('./torrent').TorrentApi
  /** Local Minecraft server create-and-manage — docs/minecraft-server-manager.md. */
  minecraft: import('./minecraft').MinecraftApi
  dockerHost: import('./docker-host').DockerHostApi
  /** Desktop-local AWS profile discovery. Credentials and provider sessions never cross IPC. */
  awsIdentity: import('./aws-identity').AwsIdentityApi
  /** Desktop AWS Resource Explorer and Cloud Control managers. */
  awsResource?: import('./aws-resource').AwsResourceApi
  /** Guided AWS manager families with catalog, availability, resource listing, and bounded jobs. */
  awsManagers: import('./aws-resource-managers').AwsResourceManagerApi
  /** Local Linux ISO VM lifecycle — docs/linux-iso-vm.md. */
  virtualMachine: import('./virtual-machine').VirtualMachineApi
  /** Machine-local Home Assistant instances with bounded REST and WebSocket discovery. */
  homeAssistant: HomeAssistantApi
  /** Schema-driven Home Assistant controls through host-owned local connection bindings. */
  homeAssistantControl: HomeAssistantControlApi
  /** Machine-local Home Assistant sensor discovery and bounded observations. */
  homeAssistantSensor: HomeAssistantSensorApi
  calendar: import('./calendar').CalendarApi
  ssh: SshApi
  sshProject: SshProjectApi
  sshFs: SshFsApi
  git: GitApi
  clipboard: ClipboardApi
  shell: ShellApi
  fs: FsApi
  media: MediaApi
  browser: BrowserApi
  /** Desktop-only isolated debugging browser sessions; browser/relay surfaces omit it. */
  debugBrowser?: DebugBrowserApi
  files: FilesApi
  updates: UpdateApi
  announcements: AnnouncementsApi
  license: LicenseApi
  contextLink: ContextLinkApi
  boardLog: BoardLogApi
  logs: LogApi
  githubIssues: import('./github-issues').GitHubIssuesApi
  githubControl: import('./github-issues').GitHubControlApi
  /** Typed, allowlisted REST and GraphQL capability catalog for contextual GitHub actions. */
  githubApi: import('./github-api').GitHubApiApi
  /** Host-owned GitHub CLI account discovery and selection. Credential material never crosses this boundary. */
  githubCliAccounts: import('./github-issues').GitHubCliAccountsApi
  usage: UsageApi
  sessionMemory: SessionMemoryApi
  /** Encrypted, bounded Codex continuation packets for explicit cold-relaunch review. */
  agentContinuation?: AgentContinuationApi
  vscode: VsCodeApi
  /** Windows-only WSL distribution management (docs pending) — src/core/wsl/service.ts.
   *  Optional: a Linux Server Edition host and every non-Windows/mobile bridge simply omit
   *  it, exactly like `terminalProfiles` above. Where it IS present, every method still
   *  degrades honestly rather than silently: `wsl.exe` missing/unreachable rejects with a
   *  real error, never a fabricated empty list. */
  wsl?: import('./wsl').WslApi
  /** Read-only host facts for the Windows diagnostics node. No mutation methods are exposed. */
  windowsDiagnostics: import('./windows-diagnostics').WindowsDiagnosticsApi
  /** Existing file-hosted VeraCrypt containers. Server, relay, and mobile bridges return unsupported. */
  veracrypt: import('./veracrypt').VeraCryptApi
  export: ExportApi
  history: LocalHistoryApi
  context: ContextApi
  canvas: CanvasApi
  codex: CodexApi
  claude: ClaudeApi
  /** Custom-agent launch/preview (env-var expansion + command assembly). */
  agent: AgentApi
  chat: ChatApi
  claudeAccounts: ClaudeAccountsApi
  codexAccounts: CodexAccountsApi
  transcripts: TranscriptsApi
  remoteHost: RemoteHostApi
  relayHost: RelayHostApi
  relayClient: RelayClientApi
  handoff: HandoffApi
  pairing: PairingApi
  relayPeers: RelayPeersApi
  presence: PresenceApi
  toylock: ToylockApi
  authenticator: AuthenticatorApi
  passwordManager: PasswordManagerApi
  /** Host-owned portal-door entry vault. This is deliberately separate from toy locks. */
  universeDoorEntry: UniverseDoorEntryApi
  /** "Escape to widget" — one node's session in its own always-on-top-configurable window. */
  canvasWidget: CanvasWidgetApi
  shortcuts: ShortcutsApi
  /** Optional because browser and relay renderers have no native application menu. */
  nativeCopy?: NativeCopyApi
  /** Fires when the user presses Cmd/Ctrl+M (toggle markdown view). Returns unsubscribe. */
  onMarkdownToggle(listener: () => void): () => void
  /** Fires when the user presses Cmd/Ctrl+W (close selected node). Returns unsubscribe. */
  onCloseNode(listener: () => void): () => void
  /** Fires when the user presses Cmd/Ctrl+0 (zoom the canvas back to 100%). Desktop only: the
   *  key is intercepted in main because Electron's default View menu owns the accelerator. In the
   *  Server Edition the renderer's own keydown handler sees the key and this is a no-op stub. */
  onZoomActualSize(listener: () => void): () => void
  /** Native View menu → Snap to Grid toggle. Returns unsubscribe. */
  onToggleAutoAlign(listener: () => void): () => void
  /** Native View menu → Fit View. Returns unsubscribe. */
  onFitView(listener: () => void): () => void
  /** Native View menu → Toggle Kanban / Canvas view. Returns unsubscribe. */
  onToggleKanban(listener: () => void): () => void
  /** Fires when the native app menu's "Settings…" item (⌘,) is clicked. Returns unsubscribe. */
  onOpenSettings(listener: () => void): () => void
  /** Close the application window (Cmd/Ctrl+W fallback when no node is selected). */
  closeWindow(): void
  /** Bring the app window to the foreground (show + OS focus). Called after a file is DROPPED
   *  into a terminal: on macOS a drag-drop from another app (Finder/browser) does not activate
   *  the destination app, so the drag-source keeps keyboard focus and the user's next keystrokes
   *  land in the WRONG application — `term.focus()` (DOM-only) can't fix that. Desktop raises the
   *  BrowserWindow; the browser bridge does a best-effort `window.focus()`. */
  focusWindow(): void
  /** Set the macOS Dock badge to the unread-message count (0 clears it). */
  setBadgeCount(count: number): void
  /** Apply the UI-scale setting as page zoom for THIS window (desktop: `webFrame.setZoomFactor`).
   *  The preload re-clamps through `resolveUiScale` — the value originates in hand-editable
   *  settings.json, and the boundary must not trust the caller to have done it. Server Edition:
   *  documented no-op — a browser page cannot set its own page zoom, and the browser already owns
   *  the identical mechanism (Cmd/Ctrl+±). */
  setUiZoomFactor(factor: number): void
  /** Absolute filesystem path for a dropped/picked File (for drag-into-terminal). */
  getPathForFile(file: File): string
  /** Absolute writable base dir (Electron userData) for app-managed files like default worktrees. */
  userDataDir(): Promise<string>
  /** Show an OS notification (main suppresses it if the window is focused). 'failed' =
   *  the OS rejected it (e.g. macOS permission denied) — surface it, don't ignore it. */
  notify(payload: NotifyPayload): Promise<'shown' | 'failed' | 'skipped'>
  /** Open the OS notification settings pane (macOS; no-op elsewhere) to re-grant permission. */
  openNotificationSettings(): Promise<void>
  /** Fires when a notification is clicked, asking the renderer to focus a node. Returns unsubscribe. */
  onFocusNode(listener: (nodeId: string) => void): () => void
  /** Fires when the shell's memory-pressure monitor (core/memory-pressure.ts) sees the host — or
   *  this process's own RSS — cross a watermark: the renderer answers by running its reclaim
   *  levers (hidden WebGL contexts, parked terminals). At most one fire a minute, so the levers
   *  need only be idempotent, not cheap. Returns unsubscribe. Server Edition: never fires (the
   *  pressure levers run host-side there; a browser tab's memory belongs to the browser). */
  onMemoryPressure(listener: (severity: 'warning' | 'critical') => void): () => void
  /** Fires when THIS MACHINE's pty-device pressure band changes (core/pty-pressure.ts): the
   *  renderer raises/lowers the banner that warns before `kern.tty.ptmx_max` stops every new
   *  terminal from opening. Band changes only, re-sent for a held band at most once every five
   *  minutes; `level: 'none'` means the banner should come down. Returns unsubscribe.
   *  Server Edition: never fires — the reaper leg runs host-side only (see src/server/index.ts). */
  onPtyPressure(listener: (reading: PtyPressure) => void): () => void
  /** Fires when the desktop main process observes a trackpad scroll or pinch edge. The payload is
   *  the depth-safe active state, and only edge transitions are sent. Server Edition never fires:
   *  its browser tab has no raw input stream and keeps the wheel router's heuristic path. */
  onCanvasTrackpadGesture(listener: (active: boolean) => void): () => void
  /** Raise this Mac's pty-device ceiling (`kern.tty.ptmx_max`) now AND across reboots, behind
   *  macOS's own administrator-password dialog. Called ONLY from the banner's explicit
   *  "Fix automatically…" click — never on the app's initiative. macOS only; a dismissed password
   *  dialog resolves `{ ok: false, canceled: true }`, which is not an error to report or retry. */
  raisePtyDeviceLimit(): Promise<PtyLimitFixResult>
  /** Answer a Claude permission request via the deterministic hook-reply channel (spec:
   *  docs/hook-reply-approvals.md). Writes the one-line answer file the held hook is polling
   *  (`~/.nodeterm/pending/<pendingId>.answer`) on the host the agent runs on — the LOCAL fs for a
   *  local project, or the remote host over the project's ControlMaster for an SSH project. Resolves
   *  `true` when the file was written, `false` on any failure (invalid pendingId, unknown node,
   *  unsupported project, fs/exec error). */
  answerPermission(payload: {
    nodeId: string
    pendingId: string
    decision: 'allow' | 'deny'
  }): Promise<boolean>
  /** Notify the core that the user READ a finished (done) session on this surface (the unread-clear
   *  funnel calls it when the node's latest state is `done`). The core marks the node's done inbox
   *  event(s) resolved (phone Inbox archives the card) and re-sends an 'end' live-update so the
   *  paired phone dismisses its lingering DONE Live Activity. Fire-and-forget; no-op if the node has
   *  no unresolved done event. */
  ackDone(nodeId: string): void
  /** Fires when the host swept a phone read-ack (`~/.nodeterm/acks/<nodeId>.seen`) for a finished
   *  session: the renderer should drop the node's unread flag WITHOUT re-acking (call
   *  `clearUnread(id, { external: true })`, so it does not loop back into `ackDone`). Arg is the
   *  node id. Returns unsubscribe. See core/ack-sweep.ts. */
  onUnreadClear(listener: (nodeId: string) => void): () => void
  /** Fires on each normalized agent hook event (working/done/waiting/subagent/…). Returns unsubscribe. */
  onAgentStatus(listener: (e: NormalizedAgentEvent) => void): () => void
  /**
   * Last-known workflow state retained by the core across restarts. Display-only: entries are not
   * live evidence and must not drive notifications, authorization, or process control.
   */
  agentStatusSnapshot(): Promise<AgentStatusSnapshot>
  /** Fires with live subagent transcript chunks while a subagent runs. Returns unsubscribe. */
  onSubagentActivity(listener: (e: SubagentActivity) => void): () => void
  /** Fires when an agent's `nodeterm` CLI requests a canvas action. Returns unsubscribe. */
  onAgentControl(
    listener: (cmd: {
      requestId: string
      sourceNodeId: string
      verb: string
      args: Record<string, string>
    }) => void
  ): () => void
  /** Reply to an agent control request (resolves the awaiting CLI call in main). */
  sendAgentControlResult(payload: {
    requestId: string
    ok: boolean
    message?: string
    result?: unknown
    error?: string
  }): void
  /** The `browser` verb resolve round-trip (S8 PR 7): main asks the renderer to resolve a source
   *  node's owning project, control-capability and the LIVE per-project capability value. The
   *  renderer answers over `sendBrowserControlResolveResult` and NEVER runs a CDP command. */
  onBrowserControlResolve(
    listener: (req: { requestId: string; sourceNodeId: string; browserNodeId?: string }) => void
  ): () => void
  /** Answer a browser-control resolve. `ok:false` carries a named refusal; `ok:true` carries the
   *  facts main turns into its own (owner + capability + CDP-gate) decision. `sourceTitle`/
   *  `browserTitle` are for the cookie-read trace only (PR 9) — never a security input. */
  sendBrowserControlResolveResult(payload: {
    requestId: string
    ok: boolean
    refusal?: string
    projectId?: string
    projectCwd?: string
    sourceControlCapable?: boolean
    capabilityOn?: boolean
    sourceTitle?: string
    browserTitle?: string
  }): void
  /** Agent messaging (the `send`/`reply` control verbs): run one delivery in main, where the
   *  scope check, the per-project switch, flow control and the pane probes all live. The reply is
   *  already rendered as a control reply — Canvas forwards it verbatim. */
  agentMessage: {
    deliver(req: AgentMessageDeliverRequest): Promise<AgentMessageReply>
  }
}
