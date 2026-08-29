// buildRelayApi — assemble a full `NodeTerminalApi` for a remote-desktop (relay) project tab.
//
// A relay tab is a client of ANOTHER desktop's core, exactly as the browser is a client of the
// Server Edition's core (docs/remote-sessions.md, Stage 4). So it reuses the SAME ws-bridge builders
// the browser uses (`buildRealApi`/`buildFilesApi`/`buildAgentApi`/`buildCanvasApi`/`buildPresenceApi`/
// `buildClaudeApi`) — but over the E2EE relay tunnel (`RelayFrameTransport`) instead of a WebSocket.
// This is the 4a "swap the API object" payoff: a remote tab's `useSession().api` is this object, and
// `createSession('relay', api, label)` (Task 6) wires it into the session registry.
//
// ── The API split (binding, from docs/remote-sessions.md line 70–76) ──────────────────────────────
// • CORE-BOUND namespaces (`pty`, workspace read/probe, `fs`, reviewed `git`, `files`, `context`,
//   `canvas`, `presence`, the `onAgentStatus`/`onSubagentActivity` streams, `claude.cliCaps`,
//   `userDataDir`) route over the relay RpcClient → they hit the REMOTE core. This is what makes
//   the tab actually remote: its terminals, repos, files, canvas and presence all live on the
//   host's machine.
// • APP-GLOBAL namespaces (`updates`, `license`, `clipboard`, `shell`, `dialog`, `media`,
//   `settings`, `pairing`, `announcements`, `usage`, `remote*`, `relay*`, notifications, menu events)
//   stay LOCAL (`window.nodeTerminal.*`). Your update banner shows YOUR version, a file picker
//   browses YOUR disk, your UI settings/theme are yours, and the relay-tunnel machinery itself is
//   your local main process. Routing one of these to the remote core would be a latent bug. SSH
//   project control/filesystem operations have no relay carrier yet and refuse rather than touching
//   the viewer's SSH masters; viewer-held file bytes use the host-routed `files` namespace below.
//
// ── Two gotchas that make or break the tab ───────────────────────────────────────────────────────
// 1. `pty.onData` is the ONE core-bound member that does NOT go through the RpcClient. Relay pty
//    output is decoded in the main process and re-emitted on the LOCAL per-session `pty:data`
//    channel (`src/main/index.ts` `onPtyData` → `IPC.ptyData(sessionId)` → preload), NOT over the
//    RpcClient frame stream (`RelayFrameTransport.onMessage` only carries JSON frames). So it
//    delegates to the LOCAL preload's `pty.onData` — the exact same channel a local pty uses. Wire
//    it to the RpcClient instead and the remote terminal is blank.
// 2. `RelayFrameTransport.ready()` resolves on `onApproved`, which fires exactly ONCE. The transport
//    must be constructed (registering that listener) BEFORE the humans confirm the SAS — i.e. Task 6
//    calls `buildRelayApi` while the approval dialog is still open, THEN awaits `ready()`. Building
//    it after approval already fired leaves `ready()` pending forever and the api never comes up.

import type { NodeTerminalApi } from '../../shared/types'
import { E_UNSUPPORTED } from '../../shared/rpc'
import { type FrameTransport, RelayFrameTransport } from './frame-transport'
import {
  RpcClient,
  buildRealApi,
  buildFilesApi,
  buildAgentApi,
  buildCanvasApi,
  buildPresenceApi,
  buildClaudeApi,
  buildGitHubApi
} from './ws-bridge'
import { buildStubApi } from './stubs'
import { mountPickerRoot, openDirectoryPicker } from './dialog-picker'

const relayUnsupported = (name: string): Promise<never> =>
  Promise.reject(
    Object.assign(new Error(`${name} is not supported over a relay session`), {
      code: E_UNSUPPORTED
    })
  )

/** What Task 6 consumes: the bridged api for `createSession`, an approval gate to await, and a
 *  teardown hook to run on disconnect/revoke. */
export interface RelayApiHandle {
  /** The bridged `NodeTerminalApi` for `createSession('relay', api, label)`. */
  api: NodeTerminalApi
  /** Resolves once BOTH humans confirmed the SAS (the relay frame pipe is live). Delegates to the
   *  transport's `ready()`; see gotcha 2 about construction order. */
  ready(): Promise<void>
  /** Tear the connection down: close the relay socket for this connectionId. */
  close(): void
}

/**
 * Build the bridged api for a relay connection. `transport` is a test seam — production passes
 * nothing and a `RelayFrameTransport(connectionId)` is constructed here (which is what registers the
 * one-shot `onApproved` listener; see gotcha 2).
 */
export function buildRelayApi(connectionId: string, transport?: FrameTransport): RelayApiHandle {
  // The LOCAL preload — this is a desktop-only path (relay hosting/joining is Electron), so
  // `window.nodeTerminal` is the full real preload, not the browser stub surface.
  const local = (window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal
  const client = new RpcClient(transport ?? new RelayFrameTransport(connectionId))

  const real = buildRealApi(client) // { pty, workspace, settings, userDataDir }
  const files = buildFilesApi(client) // { fs, git, files, context }
  const github = buildGitHubApi(client)
  const stub = buildStubApi()

  const api: NodeTerminalApi = {
    // ── Base: every APP-GLOBAL namespace stays LOCAL. Spreading the whole preload gives the real
    //    desktop implementations (updates/license/clipboard/shell/dialog/media/settings/pairing/
    //    announcements/usage/ssh*/remote*/relay*/notifications/menu events). The core-bound spreads
    //    below override the handful that must hit the remote core.
    ...local,

    // ── CORE-BOUND: route to the REMOTE core over the relay RpcClient. ──
    workspace: {
      ...real.workspace,
      // A raw whole-workspace save can remove unrelated host projects. Relay tabs converge their
      // shared project through canvas mutations; there is no safe project-scoped save contract.
      save: () => relayUnsupported('workspace.save'),
      // Rewrites the host's local .nodeterm/project.json storage encoding with no host-scoped
      // project check (see relay-rpc-policy.ts's matching omission). Refused locally with a clear
      // reason rather than round-tripping to the host only to be denied there.
      hasPartsManifest: () => relayUnsupported('workspace.hasPartsManifest'),
      splitIntoParts: () => relayUnsupported('workspace.splitIntoParts'),
      joinParts: () => relayUnsupported('workspace.joinParts')
    },
    userDataDir: real.userDataDir, // the host's writable base — worktree default paths live there
    fs: files.fs,
    git: {
      ...files.git,
      // Desktop owns this selection in raw ipcMain rather than CorePlatform, so pretending it is
      // remote-capable only yields E_NO_HANDLER. Refuse explicitly until it has scoped semantics.
      setActiveRemote: () => relayUnsupported('git.setActiveRemote')
    },
    files: files.files,
    context: files.context,
    githubIssues: github.githubIssues,
    githubControl: local.githubControl,
    ...buildAgentApi(client), // onAgentStatus / onSubagentActivity — the host's agent hooks
    ...buildCanvasApi(client), // canvas sync against the host's reflector
    ...buildPresenceApi(client), // the host's presence hub
    // `cliCaps` is REAL over the relay so the --permission-mode auto version gate probes the HOST's
    // claude CLI (a remote node launches on the host); `readTranscript` stays LOCAL (v1 degrade —
    // transcripts aren't relayed, so it reads this machine's; the only consumer reads the global api).
    claude: buildClaudeApi(client, local.claude),

    // A File selected/dropped on THIS desktop can carry a perfectly valid absolute path — on THIS
    // desktop. The remote session cannot read it. Force the shared file-drop resolver down its byte
    // upload path, whose `files.saveUpload` / `saveCanvasImage` calls above land on the host.
    getPathForFile: stub.getPathForFile,

    // There is no host-routed SSH-project control API in relay v1. Refuse cleanly instead of letting
    // a session-scoped caller operate this viewer's local ControlMaster and paste that third
    // machine's path into the host shell. A plain relay file drop is fully supported through
    // `files`; a drop into an SSH-project terminal inside a relay tab degrades to no inserted path.
    sshProject: stub.sshProject,
    // An SSH project's paths live on a third machine behind the HOST's ControlMaster. Until relay
    // has a scoped carrier for that master, even reads must not fall through to this viewer's
    // unrelated SSH connection (quick-open is the easy wrong-machine example).
    sshFs: stub.sshFs,

    // pty is core-bound EXCEPT `onData` (gotcha 1): its output arrives on the LOCAL per-session
    // channel, so subscribe on the local preload, same shape as a local pty.
    pty: {
      ...real.pty,
      onData: (sessionId, listener) => local.pty.onData(sessionId, listener)
    },

    // boardLog is CORE-BOUND: a relay guest reads and writes the HOST project's board comments/activity
    // (with its OWN presence identity in each entry), routed to the host's registry-jailed board-log
    // handlers (and scope-jailed to the shared project host-side in connectRelayHost). Version-skew
    // degrade: an OLDER host with no board-log rpc answers E_NO_HANDLER, which we map to today's
    // behavior — read → `{ entries: [], unsupported: true }`, append → `false` — instead of a rejection.
    // `onChanged` casts subscribe/unsubscribe (fire-and-forget, no reject) and rides the host push.
    boardLog: {
      append: (projectId, entry) => files.boardLog.append(projectId, entry).catch(() => false),
      read: (projectId, opts) =>
        files.boardLog.read(projectId, opts).catch(() => ({ entries: [], unsupported: true })),
      onChanged: (projectId, cb) => files.boardLog.onChanged(projectId, cb)
    },

    // `settings` (and `scheduledSettings` alongside it) stays LOCAL (font/cursor/theme render in
    // YOUR window, on YOUR schedule). It came in via `...local`; `real.settings` is deliberately
    // left unused so a remote tab never adopts the host's prefs or the host's schedule.

    // `dialog` REFINES Task 5's coarse "dialog → local". `selectFolder`/`selectFile` are the only
    // members `DialogApi` exposes, and in a remote tab BOTH are host-path pickers, not local ones:
    // the chosen path is fed to the SESSION core (a clone destination for `api.git.clone`, an
    // "open folder/file" target on the host fs), so a native LOCAL picker would land the op on the
    // wrong machine (obligation d). Route both to the SAME in-app directory browser the Server
    // Edition uses, over the HOST's `fs.list` (`files.fs`, already core-bound). There is no other,
    // genuinely-local `dialog.*` method that would want to stay on `...local`. Desktop-only path, so
    // `document` exists for `mountPickerRoot`.
    dialog: (() => {
      mountPickerRoot()
      const startDir = '/' // navigable up/down from the host root; no cross-call memory in v1
      return {
        selectFolder: () => openDirectoryPicker({ mode: 'folder', startDir, list: files.fs.list }),
        selectFile: () => openDirectoryPicker({ mode: 'file', startDir, list: files.fs.list }),
        // No host-side multi-file picker over the relay in v1 (the in-app browser above is
        // single-path only) — never fall back to a LOCAL multi-picker, which would pick paths on
        // the wrong machine. FileConverterPanel treats a null resolution as "not available here".
        selectFiles: () => Promise.resolve(null)
      }
    })(),

    // ── Deferred over the relay in v1 — documented degrades (a clean refusal, not a wrong-machine
    //    silent no-op): ──
    // `chat` is now just readTranscript (the SDK chat node was removed). It has no relay builder:
    // reading a transcript over the relay would read THIS machine's transcript, not the host's, so
    // refuse with E_UNSUPPORTED instead. contextLink / transcripts / handoff stay LOCAL by way of
    // `...local` (a v1 degrade: they read/write on this machine, not the host). `sshProject` is
    // explicitly stubbed above because a wrong-machine mutation is worse than a visible refusal.
    // boardLog is now bridged to the host (see above) — it no longer rides `...local`.
    chat: stub.chat,
    // Agent canvas-control (`agent:control`) is not wired over the relay (matches the Server
    // Edition); inert no-ops rather than a local subscription that never carries the host's events.
    onAgentControl: stub.onAgentControl,
    sendAgentControlResult: stub.sendAgentControlResult,
    // The universal file converter and the local Ollama manager both operate on ONE machine's
    // filesystem/Ollama install. `...local` would silently run them against THIS machine while the
    // rest of the tab is the HOST's session — the wrong-machine failure this file's obligations
    // exist to prevent — and there is no remote-routed core call for either yet. Refuse cleanly
    // (E_UNSUPPORTED) rather than either wrong-machine option; a future pass can route these to the
    // host the same way `fs`/`git` are routed above.
    converter: stub.converter,
    ollama: stub.ollama,
    // Same reasoning as converter/ollama immediately above: creating and running a Minecraft
    // server is ONE machine's filesystem/java/process table, and there is no remote-routed core
    // call for it yet. Refuse cleanly rather than silently provisioning/spawning on the WRONG
    // machine (`...local` would run java on the VIEWER, not the host it joined).
    minecraft: stub.minecraft,
    dockerHost: stub.dockerHost
  } satisfies NodeTerminalApi

  return {
    api,
    ready: () => client.ready(),
    close: () => local.relayClient.disconnect(connectionId)
  }
}
