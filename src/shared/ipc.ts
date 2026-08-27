// IPC channel names — single source of truth for both main and preload.

export const IPC = {
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyFlow: 'pty:flow',
  ptyKill: 'pty:kill',
  ptyDestroy: 'pty:destroy',
  /** End a node's persistent session so the SAME node id can respawn in a new cwd ("move into
   *  worktree"). Same tmux kill-session as `ptyDestroy`, but it is NOT a deletion: the node stays
   *  on every canvas, so co-viewers get the restart notice (`ptyRecycled`) instead of the
   *  permanent, un-respawnable `ptyClosed`. */
  ptyRecycle: 'pty:recycle',
  /** Desktop-only awaited recycle path used after an explicit destructive-action confirmation. */
  ptyRecycleConfirmed: 'pty:recycle-confirmed',
  ptyGenerateName: 'pty:generate-name',
  ptyGenerateGroupName: 'pty:generate-group-name',
  ptyCapture: 'pty:capture',
  ptyReadScrollback: 'pty:read-scrollback',
  ptySendText: 'pty:send-text',
  /** Opaque semantic agent launch; the rendered shell command never crosses this channel. */
  ptyExecuteLaunchIntent: 'pty:execute-launch-intent',
  ptyTmuxStatus: 'pty:tmux-status',
  /** The foreground command of a node's tmux pane (`#{pane_current_command}`) — how the in-place
   *  agent restart sees that the CLI has exited and a shell owns the pane again. */
  ptyPaneCommand: 'pty:pane-command',
  /** Correct a node's tmux "lead" pane width after Claude Code's own agent-team backend has
   *  narrowed it (`settings.agentTeamLeadPaneWidthEnabled` — see
   *  shared/agents/team-pane-layout.ts). Counts the node's panes and, when the setting calls for
   *  it, resizes pane 0 — both in one call so a poller pays one round-trip per tick. Resolves
   *  `true` only when it actually resized something; tmux-backed local sessions only. */
  ptyCorrectTeamPaneWidth: 'pty:correct-team-pane-width',
  /** Renderer → core: SIGTERM the non-shell foreground process group in this node's pane.
   *  Model switching uses this instead of typing an exit slash-command into an agent composer. */
  ptyTerminateForeground: 'pty:terminate-foreground',
  ptyReadSessionName: 'pty:read-session-name',
  /** Shell → renderer: this MACHINE's pty-device pressure band changed (core/pty-pressure.ts).
   *  Payload: `PtyPressure` — `{ level, usage, ceiling }`. Sent on band CHANGES only, and re-sent
   *  for a held band at most once every five minutes; `level: 'none'` is what clears the banner.
   *  Desktop only — see the Server Edition note beside the monitor in src/server/index.ts. */
  ptyPressure: 'pty:pressure',
  /** Main → renderer: a trackpad scroll or pinch opened or closed on the main window. The main
   *  ledger emits only edge transitions, not the raw pointer-packet stream. Server Edition keeps
   *  its renderer heuristic because a browser has no equivalent raw input source. */
  canvasTrackpadGesture: 'canvas:trackpad-gesture',
  /** Renderer → main: the user clicked "Fix automatically…" on the pty-pressure banner. Raises
   *  `kern.tty.ptmx_max` now AND installs a LaunchDaemon so it survives reboot, via ONE
   *  administrator-privileges osascript (macOS's own password dialog). Resolves
   *  `PtyLimitFixResult`. NEVER invoked on the app's own initiative — see main/ptmx-limit.ts. */
  ptyRaiseDeviceLimit: 'pty:raise-device-limit',
  terminalProfilesList: 'terminal-profiles:list',
  terminalProfilesRefresh: 'terminal-profiles:refresh',
  virtualMachineTools: 'virtual-machine:tools',
  virtualMachineStatus: 'virtual-machine:status',
  virtualMachineConfigure: 'virtual-machine:configure',
  virtualMachineCreateDisk: 'virtual-machine:create-disk',
  virtualMachineStart: 'virtual-machine:start',
  virtualMachineStop: 'virtual-machine:stop',
  virtualMachineSnapshot: 'virtual-machine:snapshot',
  virtualMachineRestore: 'virtual-machine:restore',
  virtualMachineOpenDisplay: 'virtual-machine:open-display',
  virtualMachineReset: 'virtual-machine:reset',
  virtualMachineEvent: 'virtual-machine:event',
  claudeReadTranscript: 'claude:read-transcript',
  chatReadTranscript: 'chat:read-transcript',
  claudeAccountsAdd: 'claude-accounts:add',
  claudeAccountsWaitLogin: 'claude-accounts:wait-login',
  claudeAccountsCancelWait: 'claude-accounts:cancel-wait',
  claudeAccountsRemove: 'claude-accounts:remove',
  codexAccountsAdd: 'codex-accounts:add',
  codexAccountsWaitLogin: 'codex-accounts:wait-login',
  codexAccountsCancelWait: 'codex-accounts:cancel-wait',
  codexAccountsRemove: 'codex-accounts:remove',
  codexAccountsIdentity: 'codex-accounts:identity',
  codexAccountsSystemIdentity: 'codex-accounts:system-identity',
  codexAccountsSwitchThread: 'codex-accounts:switch-thread',
  codexAccountsTransferThreadToSsh: 'codex-accounts:transfer-thread-to-ssh',
  codexAccountsCommitSwitch: 'codex-accounts:commit-switch',
  codexAccountsFinishSwitch: 'codex-accounts:finish-switch',
  codexAccountsRollbackSwitch: 'codex-accounts:rollback-switch',
  // Machine-scoped managed Codex accounts (S6). Add/device-login/removal, plus the three-phase,
  // owner-authorized account switch (resume the SAME conversation id, never fork) and the
  // source-side leg of moving an idle conversation to an SSH account. See main/codex-accounts.ts.
  codexAccountsAdd: 'codex-accounts:add',
  codexAccountsWaitLogin: 'codex-accounts:wait-login',
  codexAccountsCancelWait: 'codex-accounts:cancel-wait',
  codexAccountsIdentity: 'codex-accounts:identity',
  codexAccountsSystemIdentity: 'codex-accounts:system-identity',
  codexAccountsRemove: 'codex-accounts:remove',
  codexAccountsSwitchThread: 'codex-accounts:switch-thread',
  codexAccountsCommitSwitch: 'codex-accounts:commit-switch',
  codexAccountsFinishSwitch: 'codex-accounts:finish-switch',
  codexAccountsRollbackSwitch: 'codex-accounts:rollback-switch',
  codexAccountsTransferThreadToSsh: 'codex-accounts:transfer-thread-to-ssh',
  claudeCliCaps: 'claude-cli:caps',
  /** Can a node on this machine get a managed Codex identity? See core/codex-identity-caps.ts. */
  codexIdentityCaps: 'codex-identity:caps',
  /** main/server → renderer: a Codex node's identity mode changed ('shared' | 'plain'). The
   *  'plain' events are what make the launcher's fallback visible instead of silent. */
  codexIdentity: 'codex-identity:event',
  /** Renderer → main: a snapshot of the main process's `process.env`, used to expand `${env:VAR}`
   *  tokens in custom-agent launch commands and the Settings preview (the renderer has no
   *  `process.env` of its own). Values are strings; undefined entries are omitted.
   *  DESKTOP-WINDOW-ONLY: registered via raw `ipcMain.handle`, never `platform().handle` — a
   *  peer-dispatchable full-env dump is the credential-leak class PR #195 closed. The
   *  browser/relay bridges answer `{}` locally and expansion degrades to the missing-env
   *  refusal. */
  envSnapshot: 'env:snapshot',
  /** Renderer → core: fetch an OpenAI-compatible model catalogue without browser CORS. */
  agentDiscoverModels: 'agent:discover-models',
  /** Renderer → core secret boundary for a literal model-gateway API key. The value is write-only;
   *  status returns only presence + storage protection. */
  agentGatewayCredentialStatus: 'agent:gateway-credential-status',
  agentGatewayCredentialSave: 'agent:gateway-credential-save',
  agentGatewayCredentialClear: 'agent:gateway-credential-clear',
  transcriptSearch: 'transcript:search',
  appToggleMarkdown: 'app:toggle-markdown',
  appCloseNode: 'app:close-node',
  /** main → renderer: ⌘/Ctrl+0 ("actual size"). Intercepted in `before-input-event` because
   *  Electron's default View menu binds that accelerator to `resetZoom`, which resets the WINDOW's
   *  page zoom rather than the canvas's. */
  appZoomActualSize: 'app:zoom-actual-size',
  /** Renderer → main: the Settings shortcut recorder is armed (`true`) or disarmed (`false`).
   *  While armed the main window's `before-input-event` intercepts above stand down entirely, so
   *  the chord the user is recording — ⌘W and ⌘M among them — reaches the recorder instead of
   *  closing their selected nodes. Fire-and-forget `send`; desktop-only (a browser tab has no
   *  application menu to steal a chord back from, so the Server Edition stubs it). */
  uiShortcutRecording: 'ui:shortcut-recording',
  /** Renderer → main: an xterm does (`true`) / does not (`false`) currently hold keyboard focus.
   *  A MIRROR, not a request: under the `terminal-first` shortcut policy the intercepts above must
   *  stand down while the user is typing in a terminal, and `before-input-event` fires before any
   *  renderer handler could tell main so — the answer has to already be there. Change-deduped by
   *  the sender, fire-and-forget `send`, and read fail-safe: main starts at `false` and every way
   *  the page can stop existing resets it there, so a stale mirror means intercepts ON (the
   *  pre-policy app), never a window whose ⌘W has silently gone back to the application menu.
   *  Desktop-only, for the same reason as the recording bit — the Server Edition stubs it. */
  uiTerminalFocus: 'ui:terminal-focus',
  appCloseWindow: 'app:close-window',
  /** Main → renderer: the native application menu's "Settings…" item (⌘,) was clicked. The
   *  renderer opens the settings page — same path as the in-canvas gear button / Cmd+, keydown. */
  appOpenSettings: 'app:open-settings',
  appFocusWindow: 'app:focus-window',
  /** Canvas widget mode (`main/canvas-widget-window.ts`, `core/canvas-widget.ts`, `renderer/widget/
   *  WidgetApp.tsx`): pop one terminal node's live tmux/session-host session into its own
   *  always-on-top-configurable desktop window — a second co-attached viewer of the SAME session,
   *  never a copy (see `Settings.canvasWidgets`'s doc comment in shared/types.ts). Electron-only:
   *  Server Edition has no OS window to open, so the ws-bridge implementation answers every call
   *  `{ unsupported: true }` rather than registering a handler. All four payloads carry the
   *  target node id first. `widgetStateChanged` is main → every listening renderer (the main
   *  window AND the widget window itself), fired on open/close/always-on-top change and once in
   *  reply to `widgetGetState`, so the "escaped" indicator on the canvas node and the widget's own
   *  toggle never have to poll. */
  widgetOpen: 'widget:open',
  widgetClose: 'widget:close',
  widgetSetAlwaysOnTop: 'widget:set-always-on-top',
  widgetGetState: 'widget:get-state',
  widgetStateChanged: 'widget:state-changed',
  /** Native View menu → renderer: toggle the Snap-to-Grid arrange mode. */
  appToggleAutoAlign: 'app:toggle-auto-align',
  /** Native View menu → renderer: fit the canvas to its nodes. */
  appFitView: 'app:fit-view',
  /** Native View menu → renderer: toggle the kanban / canvas view. */
  appToggleKanban: 'app:toggle-kanban',
  /** Write text to the system clipboard from the MAIN process. Renderer-side `clipboard` access is
   *  deprecated in Electron; resolves true only after MAIN completes the write. */
  clipboardWrite: 'clipboard:write',
  /** Copy local files as file references (not bytes/text) to the macOS system clipboard. */
  clipboardWriteFiles: 'clipboard:write-files',
  appNotify: 'app:notify',
  appOpenNotificationSettings: 'app:open-notification-settings',
  appFocusNode: 'app:focus-node',
  appSetBadge: 'app:set-badge',
  /** Main → renderer: the host (or this process's own RSS) crossed a memory-pressure watermark,
   *  so the renderer should run its reclaim levers now (hidden WebGL contexts, parked terminals).
   *  Payload: `'warning' | 'critical'`. Re-fired at most once a minute — see core/memory-pressure. */
  appMemoryPressure: 'app:memory-pressure',
  agentStatus: 'agent:status',
  /** Renderer → core: display-only last-known status, retained until node deletion. */
  agentStatusSnapshot: 'agent:status-snapshot',
  /** Renderer → main/server: answer a held Claude permission hook (deterministic approvals).
   *  Payload: `{ nodeId, pendingId, decision: 'allow'|'deny' }`; resolves boolean. See
   *  docs/hook-reply-approvals.md. */
  agentAnswerPermission: 'agent:answer-permission',
  /** Renderer → main/server: the user READ a finished (done) session on this surface. Acks the
   *  node's done inbox event(s) + dismisses the paired phone's lingering DONE Live Activity. Arg:
   *  `nodeId: string`. Fire-and-forget. See agent-status-mirror `ackDone`. */
  agentAckDone: 'agent:ack-done',
  /** main/server → renderer: drop the unread flag for a node because the phone READ its finished
   *  session (a `~/.nodeterm/acks/<nodeId>.seen` the host swept). Arg: `nodeId: string`. The
   *  renderer clears unread WITHOUT re-acking (external clear — see agentStatus.clearUnread's
   *  `external` opt). See core/ack-sweep.ts. */
  agentUnreadClear: 'agent:unread-clear',
  agentSubagentActivity: 'agent:subagent-activity',
  /** macOS Notch HUD (docs/notch-hud.md). main → hud: push the current row array. */
  hudRows: 'hud:rows',
  /** hud → main: toggle window click-through on hotspot enter/leave. Arg: `ignore: boolean`. */
  hudSetIgnoreMouse: 'hud:set-ignore-mouse',
  /** hud → main: a HUD row was clicked — focus the node in nodeterm + clear its done latch.
   *  Arg: `nodeId: string`. Reuses the notification-click focus path. */
  hudFocusNode: 'hud:focus-node',
  /** hud → main: the panel expanded/collapsed. Arg: `expanded: boolean`. Marks NOTHING as read —
   *  the handler is deliberately a no-op (notch-hud.ts `onExpanded`). It used to clear every done
   *  latch ("you looked"), which with three finished sessions waiting meant opening the panel and
   *  clicking one silently swallowed the other two. Read is strictly per row: `hudFocusNode` clears
   *  that row, `hudDismiss` hides one by hand. Still wired because the expand state may drive more
   *  main-side behavior later. */
  hudExpanded: 'hud:expanded',
  /** hud → main: dismiss one HUD row by hand (a stuck session). Arg: `nodeId: string`. */
  hudDismiss: 'hud:dismiss',
  agentControl: 'agent:control',
  agentControlResult: 'agent:control-result',
  agentMessageDeliver: 'agent:message-deliver',
  /** Canvas sync: a client casts its local node mutations here; the core reflector
   *  (src/core/canvas-sync.ts) stamps each with the total order (`seq`) and sends it back out on the
   *  SAME channel to EVERY attached client — the sender included, whose copy is its ack (see
   *  src/shared/canvas-order.ts). Args (both directions): [projectId: string, CanvasMutation]. */
  canvasMut: 'canvas:mut',
  contextLinkSetLinks: 'context-link:set-links',
  contextLinkInfo: 'context-link:info',
  /** Board-log (`.nodeterm/board-log.jsonl`): request/response append + read, routed per project
   *  (local cwd / desktop-ssh / unsupported) in core/board-log-handlers.ts. */
  /** Debug log panel (issue #78) — invoke: the whole ring (LogRecord[]) for the initial fill. */
  logSnapshot: 'log:snapshot',
  /** Fire-and-forget ref-counted subscribe/unsubscribe for the batched logBatch pushes. */
  logSubscribe: 'log:subscribe',
  logUnsubscribe: 'log:unsubscribe',
  /** main→renderer push: a LogRecord[] batch. Flows only while ≥1 panel is subscribed AND the
   *  debugLogPanel setting is on; the client dedupes by seq. */
  logBatch: 'log:batch',
  /** Fire-and-forget: empty the ring. */
  logClear: 'log:clear',
  boardLogAppend: 'board-log:append',
  boardLogRead: 'board-log:read',
  /** Fire-and-forget ref-counted subscribe/unsubscribe: the first subscriber for a project starts
   *  the local fs.watch (or the desktop-ssh 5s poll); the last one stops it. */
  boardLogSubscribe: 'board-log:subscribe',
  boardLogUnsubscribe: 'board-log:unsubscribe',
  /** Per-project push fired when a project's board log changes (mirrors the ptyData naming). */
  boardLogChanged: (projectId: string) => `board-log:changed:${projectId}`,
  appUpdateAvailable: 'app:update-available',
  appUpdateDownloaded: 'app:update-downloaded',
  appUpdateProgress: 'app:update-progress',
  appUpdateError: 'app:update-error',
  appUpdateNotAvailable: 'app:update-not-available',
  appCheckForUpdates: 'app:check-for-updates',
  appGetVersion: 'app:get-version',
  appUserDataDir: 'app:user-data-dir',
  appUpdatePolicy: 'app:update-policy',
  licenseActivate: 'license:activate',
  licenseDeactivate: 'license:deactivate',
  licenseStatus: 'license:status',
  licenseChanged: 'license:changed',
  licenseUpgrade: 'license:upgrade',
  licenseDetail: 'license:detail',
  licenseRelease: 'license:release',
  appRestartToUpdate: 'app:restart-to-update',
  announcementsFetch: 'announcements:fetch',
  usageFetch: 'usage:fetch',
  usageRefresh: 'usage:refresh',
  usageUpdate: 'usage:update',
  /** Non-Claude providers (codex, …) as one list; Claude keeps its own account-aware channels. */
  usageProviders: 'usage:providers',
  /** Claude usage for the connected SSH hosts' accounts, read ON those hosts over their
   *  ControlMasters. Empty on a shell without SSH projects. */
  usageRemote: 'usage:remote',
  /** Store/clear a provider's browser cookie (minimax, opencode). Write-only: no channel reads
   *  it back. */
  usageSetProviderCookie: 'usage:set-provider-cookie',
  /** Which cookie providers have one stored — lets the UI show state without handling secrets. */
  usageCookieProviders: 'usage:cookie-providers',
  /** Per-session memory breakdown for the scoped machine. On demand only — never polled: the
   *  local sweep walks the whole process table, and the SSH one is an exec on someone else's
   *  host. */
  sessionMemory: 'session-memory:read',
  /** The scoped machine's RAM (available/total) — the cheap read behind the system-resource
   *  pill. Safe to poll locally; NOT polled for an SSH scope. */
  sessionMemoryHost: 'session-memory:host',
  /** WSL distribution management (docs pending) — src/core/wsl/service.ts. Windows-only in
   *  practice: `wsl.exe` simply is not found elsewhere, and every handler degrades to a real,
   *  honest error rather than a silent no-op. Local-only over relay — see
   *  src/main/relay-rpc-policy.ts's header for why (same reasoning as `authenticator:*`). */
  wslList: 'wsl:list',
  wslCatalogue: 'wsl:catalogue',
  wslCreate: 'wsl:create',
  wslCreateCancel: 'wsl:create-cancel',
  wslCreateProgress: 'wsl:create-progress',
  wslSleep: 'wsl:sleep',
  wslWake: 'wsl:wake',
  wslDelete: 'wsl:delete',
  /** Desktop and Server Edition host snapshot for the read-only Windows diagnostics node. */
  windowsDiagnosticsSnapshot: 'windows-diagnostics:snapshot',
  contextUpdate: 'context:update',
  contextEnsure: 'context:ensure',
  // Team presence (docs/team-presence.md). `presence:hello` is a REQUEST: its response tells the
  // client its own clientId, so it never draws its own cursor. The rest are casts (client→server)
  // and events (server→clients); the server is a dumb reflector and applies no policy.
  presenceHello: 'presence:hello',
  presenceCursor: 'presence:cursor',
  presenceFocus: 'presence:focus',
  presenceChat: 'presence:chat',
  // The authority's live dino game snapshot (a cast, ~20 Hz). Ephemeral, like chat: spectators on
  // the same project render it; the hub sanitizes/clamps it (sanitizeDinoPayload).
  presenceDino: 'presence:dino',
  // Which project (canvas) the client is looking at. Cursors/focus are only meaningful to a
  // viewer on the same project — each project has its own nodes and coordinate space.
  presenceProject: 'presence:project',
  presenceSync: 'presence:sync',
  presencePeer: 'presence:peer',
  // Events broadcast from main to the renderer (sessionId is appended to the channel name).
  ptyData: (sessionId: string) => `pty:data:${sessionId}`,
  ptyExit: (sessionId: string) => `pty:exit:${sessionId}`,
  /** Authoritative size of a co-attached session: min(cols) × min(rows) over all subscribers.
   *  Broadcast to every subscriber whenever the subscriber set or any reported size changes. */
  ptySize: (sessionId: string) => `pty:size:${sessionId}`,
  /** The node was permanently destroyed by another client (payload: { by: ClientId }). The
   *  remaining subscribers show a "closed by <name>" state instead of respawning the session. */
  ptyClosed: (sessionId: string) => `pty:closed:${sessionId}`,
  /** The node's session was RECYCLED by another client (moved into a worktree): this session id is
   *  dead, but a replacement is already live under the same node id — restart the terminal so it
   *  co-attaches to it. Deliberately emitted only AFTER the replacement session exists (see
   *  PtyManager.recycleSession), so a co-viewer's restart can never spawn the node in its own,
   *  stale cwd.
   *  Payload: `{ ready: boolean }`. `ready:true` = the replacement session is registered, restart
   *  onto it. `ready:false` = the escape-hatch timeout fired and NO replacement ever came (the
   *  recycler's app died mid-move): the terminal must NOT respawn — it would spawn `nt-<id>` in
   *  its own stale cwd and silently undo the move — it ends and offers a manual reopen. */
  ptyRecycled: (sessionId: string) => `pty:recycled:${sessionId}`,
  /** Redraw for a client that fell too far behind: the session's CURRENT screen, captured from
   *  tmux. Sent instead of the discarded backlog (payload: the capture text). The terminal clears
   *  and repaints from it — see ServerPlatform's WS_DROP_WATER.
   *  CONTRACT: the payload is guaranteed NON-EMPTY (a failed capture is retried, never sent — an
   *  empty redraw would wipe a live terminal). The renderer must still IGNORE an empty payload
   *  rather than reset on it. */
  ptyResync: (sessionId: string) => `pty:resync:${sessionId}`,
  workspaceLoad: 'workspace:load',
  timerOccurrencesLoad: 'timer:occurrences-load',
  timerOccurrenceSchedule: 'timer:occurrence-schedule',
  timerOccurrenceTransition: 'timer:occurrence-transition',
  timerOccurrenceLap: 'timer:occurrence-lap',
  workspaceSave: 'workspace:save',
  workspaceProbeFolder: 'workspace:probe-folder',
  /** Explicit split/join for a local project's storage encoding (project-parts.ts). See
   *  WorkspaceStore.splitProjectIntoParts/joinProjectParts for the fail-closed contract — these
   *  never fire on their own from a settings toggle. */
  workspaceSplitIntoParts: 'workspace:split-into-parts',
  workspaceJoinParts: 'workspace:join-parts',
  workspaceHasPartsManifest: 'workspace:has-parts-manifest',
  projectArchiveExport: 'project-archive:export',
  projectArchiveImport: 'project-archive:import',
  portableMediaPrepare: 'portable-media:prepare',
  portableMediaDiscard: 'portable-media:discard',
  boardLogAppendWithAttachments: 'board-log:append-with-attachments',
  boardLogReadAttachment: 'board-log:read-attachment',
  portableBindingState: 'portable-binding:state',
  portableBindingApply: 'portable-binding:apply',
  providerCatalog: 'provider-services:catalog',
  providerAccounts: 'provider-services:accounts',
  providerResources: 'provider-services:resources',
  providerBeginOAuth: 'provider-services:begin-oauth',
  providerCompleteOAuth: 'provider-services:complete-oauth',
  providerRemoveAccount: 'provider-services:remove-account',
  cloudflareTunnelInventory: 'cloudflare-tunnels:inventory',
  cloudflareTunnelZones: 'cloudflare-tunnels:zones',
  cloudflareTunnelPlanRoute: 'cloudflare-tunnels:plan-route',
  cloudflareTunnelPlanDnsAdoption: 'cloudflare-tunnels:plan-dns-adoption',
  cloudflareTunnelSaveRoute: 'cloudflare-tunnels:save-route',
  cloudflareTunnelAdoptDnsRecord: 'cloudflare-tunnels:adopt-dns-record',
  cloudflareTunnelCancel: 'cloudflare-tunnels:cancel',
  cloudflareTunnelProgress: 'cloudflare-tunnels:progress',
  cloudflareCatalog: 'cloudflare-zero-trust:catalog',
  cloudflareAccounts: 'cloudflare-zero-trust:accounts',
  cloudflareConfigure: 'cloudflare-zero-trust:configure',
  cloudflareRemoveAccount: 'cloudflare-zero-trust:remove-account',
  cloudflareBinding: 'cloudflare-zero-trust:binding',
  cloudflareSaveBinding: 'cloudflare-zero-trust:save-binding',
  cloudflareResources: 'cloudflare-zero-trust:resources',
  cloudflareExecute: 'cloudflare-zero-trust:execute',
  cloudflareCancel: 'cloudflare-zero-trust:cancel',
  cloudflareProgress: 'cloudflare-zero-trust:progress',
  projectArchiveProgress: 'project-archive:progress',
  projectArchiveCancel: 'project-archive:cancel',
  /** The unlock ladder for a protected project file's password prompt — issue a challenge, and
   *  grade an answer core-side against its one-shot nonce. Never touches the password itself:
   *  clearing a rung ends the WAIT and nothing else (core/archive-unlock-guard.ts). */
  projectArchiveLadderIssue: 'project-archive:ladder-issue',
  projectArchiveLadderVerify: 'project-archive:ladder-verify',
  serverDeploymentStart: 'server-deployment:start',
  serverDeploymentTotp: 'server-deployment:totp',
  serverDeploymentStatus: 'server-deployment:status',
  /** Main → renderer event (not invoke/handle): one `ServerDeploymentStage` per emission, sent
   *  while a `serverDeployment.start()` call is in flight. */
  serverDeploymentProgress: 'server-deployment:progress',
  /** Is a folder's .nodeterm/project.json present / absent / unreadable — the distinction
   *  `probeFolder`'s null collapses. Recovery of an `unavailable` project needs it (issue #385). */
  workspaceProjectFileState: 'workspace:project-file-state',
  projectSettingsRead: 'project-settings:read',
  projectSettingsWriteShared: 'project-settings:write-shared',
  projectSettingsUpdateLocal: 'project-settings:update-local',
  /** Resolved settings + per-family trust verdict for one project (`ProjectLaunchInfo`), the single
   *  read a launcher warms before it may consume a shared-sourced value — answers `null` for an
   *  unknown project id, same as projectSettingsRead. */
  projectSettingsLaunchInfo: 'project-settings:launch-info',
  /** main→renderer broadcast: `{projectId}` after ANY family approval changes for that project (a
   *  consent dialog answered, a trust record revoked). Emitted by
   *  `ProjectSetupService.ensureFamilyTrusted` on an approval — for EVERY project that asked, not
   *  just the one that raised the prompt (two canvas nodes can share one location). */
  projectTrustChanged: 'project-trust:changed',
  /** Run a project's setup/archive script. Args: (projectId, kind, worktreePath?) — NO rootPath/
   *  projectName/ssh: the handler derives those itself from its own workspace index by projectId,
   *  never the caller (project-setup-handlers.ts). Answers a ProjectSetupRunResult — `started` only
   *  means the run was admitted (gated + single-flight), not that it finished; progress arrives on
   *  projectSetupEvent. */
  projectSetupRun: 'project-setup:run',
  projectSetupCancel: 'project-setup:cancel',
  /** Ask for one project's `agents`/`shell` family to be trusted, prompting if it is not. Args:
   *  `(projectId, family)` — nothing path-shaped: the handler derives the location from its own
   *  workspace index, same as projectSetupRun. Answers `true` only when the family is trusted at
   *  that location (nothing shared to gate, an existing grant, or a fresh approval); `false` covers
   *  skip, expiry and every failure. HOST-ONLY (`shared/host-control.ts`): it raises the host's own
   *  dialog. `setup` is deliberately NOT accepted here — that family is gated by the runner. */
  projectSetupRequestTrust: 'project-setup:request-trust',
  /** Renderer's answer to a projectSetupConsentRequest ('approve' | 'skip'). A stale/unknown
   *  requestId is a silent no-op — an expired prompt can never be approved late. */
  projectSetupConsentSubmit: 'project-setup:consent-submit',
  /** main→renderer: raise the trust dialog (payload: ProjectConsentRequest — tagged by family, the
   *  `setup` arm being the script-runner's own request). */
  projectSetupConsentRequest: 'project-setup:consent-request',
  /** main→renderer: close a prompt nobody answered (payload: { requestId }). */
  projectSetupConsentDismiss: 'project-setup:consent-dismiss',
  /** Per-project push carrying a ProjectSetupEvent (mirrors the boardLogChanged naming). */
  projectSetupEvent: (projectId: string) => `project-setup:event:${projectId}`,
  projectSetupSubscribe: 'project-setup:subscribe',
  projectSetupUnsubscribe: 'project-setup:unsubscribe',
  /** Renderer → core: symlink a project's `sharedPaths` from its repo root into a freshly-created
   *  git worktree. Args carry ONLY `(projectId, worktreePath)` — NEVER the path list, which the
   *  handler reads itself by projectId (the list is untrusted from a renderer). The handler
   *  validates `worktreePath` is that project's rootPath or one of its actual git worktrees, and
   *  refuses an SSH project (local-only this PR); an unknown/invalid input answers `[]`. Resolves
   *  `SharedPathResult[]`. See core/worktree-shared-paths-handlers.ts. */
  worktreeMaterializeShared: 'worktree:materialize-shared',
  // main → renderer events
  workspaceMigrated: 'workspace:migrated',
  /** Payload: the `workspace.json.corrupt-<ts>` filename the unreadable index was preserved as. */
  workspaceCorruptRecovered: 'workspace:corrupt-recovered',
  workspaceExternalChange: 'workspace:external-change',
  githubIssuesSubscribe: 'githubIssues:subscribe',
  githubIssuesUnsubscribe: 'githubIssues:unsubscribe',
  githubIssuesQuery: 'githubIssues:query',
  githubIssuesRefresh: 'githubIssues:refresh',
  githubIssuesMove: 'githubIssues:move',
  githubIssuesCreateLabels: 'githubIssues:create-labels',
  githubIssuesClearCache: 'githubIssues:clear-cache',
  githubIssuesChanged: (projectId: string) => `githubIssues:changed:${projectId}`,
  githubProjectAvatar: 'github:projectAvatar',
  githubControlStatus: 'githubControl:status',
  githubCliAccountsList: 'githubCliAccounts:list',
  githubCliAccountsSwitch: 'githubCliAccounts:switch',
  githubCliAccountsSignOut: 'githubCliAccounts:sign-out',
  githubCliAccountsStartLogin: 'githubCliAccounts:start-login',
  githubCliAccountsLoginStatus: 'githubCliAccounts:login-status',
  githubCliAccountsCancelLogin: 'githubCliAccounts:cancel-login',
  githubCliAccountsRefresh: 'githubCliAccounts:refresh',
  githubControlApprove: 'githubControl:approve',
  githubControlRevoke: 'githubControl:revoke',
  githubControlSelectProvider: 'githubControl:select-provider',
  githubControlSaveToken: 'githubControl:save-token',
  githubControlClearToken: 'githubControl:clear-token',
  // Guided GitHub REST and GraphQL capabilities. The request carries an operation id and
  // semantic parameters only. Credentials and endpoint construction remain host-side.
  githubApiCapabilities: 'githubApi:capabilities',
  githubApiExecute: 'githubApi:execute',
  githubApiCancel: 'githubApi:cancel',
  githubApiProgress: 'githubApi:progress',
  dialogSelectFolder: 'dialog:select-folder',
  dialogSelectFile: 'dialog:select-file',
  shellReveal: 'shell:reveal',
  shellOpenPath: 'shell:open-path',
  shellPickProjectIcon: 'shell:pick-project-icon',
  fsList: 'fs:list',
  fsRead: 'fs:read',
  fsReadBinary: 'fs:read-binary',
  fsWrite: 'fs:write',
  fsMkdir: 'fs:mkdir',
  fsExists: 'fs:exists',
  filesQuickOpen: 'files:quick-open',
  /** Mint a one-shot HTTP download ticket (Server Edition only; every other shell answers null). */
  filesDownloadTicket: 'files:download-ticket',
  /** Persist pasted/dropped bytes that have no path here, and answer their absolute path. */
  filesSaveUpload: 'files:save-upload',
  /** Write a canvas image into the project's own `.nodeterm/images/` (see core/canvas-images.ts). */
  filesSaveCanvasImage: 'files:save-canvas-image',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  /** Read the shared School-mode record (`core/school-mode.ts`). Distinct from `settings:load`
   *  on purpose: the record lives in a shared local application-data location outside any one
   *  app's own userData, so several apps on the same machine can read/honor the same switch. */
  kidsModeLoad: 'kids-mode:load',
  kidsModeEnable: 'kids-mode:enable',
  kidsModeDisable: 'kids-mode:disable',
  kidsModeRename: 'kids-mode:rename',
  kidsModeChangePin: 'kids-mode:change-pin',
  kidsModeHasCredential: 'kids-mode:has-credential',
  kidsModeVerifyPin: 'kids-mode:verify-pin',
  kidsModeChanged: 'kids-mode:changed',
  schoolModeLoad: 'school-mode:load',
  /** Turn the mode on. A `pin` is required only the FIRST time (no stored credential yet); it is
   *  ignored on every later call. Never required to enter — this is a focus mode, not a lock. */
  schoolModeEnable: 'school-mode:enable',
  /** Turn the mode off. Requires the correct PIN, verified against the stored hash. */
  schoolModeDisable: 'school-mode:disable',
  /** Rename the mode's user-facing display name. No PIN required. */
  schoolModeRename: 'school-mode:rename',
  /** Change the unlock PIN. Requires the current one. */
  schoolModeChangePin: 'school-mode:change-pin',
  /** Whether an unlock PIN has ever been set on this machine. */
  schoolModeHasCredential: 'school-mode:has-credential',
  /** Shell → renderer (broadcast): the shared record changed — including a change made by
   *  ANOTHER process watching the same shared file (live, no restart). Payload: SchoolModeRecord. */
  schoolModeChanged: 'school-mode:changed',
  // Scheduled settings (docs/scheduled-settings.md): rules that override the app's own appearance
  // settings for a date+time window, gated by a local switch, an HTTPS API, or a Home Assistant
  // boolean entity. All handled in src/core/scheduled-settings-*.ts (shell-agnostic).
  scheduledSettingsLoad: 'scheduled-settings:load',
  scheduledSettingsSave: 'scheduled-settings:save',
  /** Set (token) / clear (null) the Home Assistant access token for one rule. Sealed at rest;
   *  there is deliberately no matching "get" channel — see scheduled-settings-secrets.ts. */
  scheduledSettingsSetHaToken: 'scheduled-settings:set-ha-token',
  /** Which rule ids currently have a Home Assistant token stored, without exposing any token. */
  scheduledSettingsTokenStatus: 'scheduled-settings:token-status',
  /** Ask the service to refresh one rule's external source right now (the Settings UI's "Retry"
   *  action after a failed fetch). */
  scheduledSettingsRefreshRule: 'scheduled-settings:refresh-rule',
  /** One-shot read of the currently-resolved schedule state, for a UI that mounts after the first
   *  push (see scheduledSettingsActiveChange below). */
  scheduledSettingsActiveState: 'scheduled-settings:active-state',
  /** main/server → renderer broadcast: the resolved schedule changed (a new rule became active, an
   *  external source's fetch completed, or none apply anymore). Payload: ScheduledSettingsActiveState. */
  scheduledSettingsActiveChange: 'scheduled-settings:active-change',
  // Planner occurrences remain in the host process while the UI is closed. The service persists
  // schedules and occurrence history locally, then broadcasts only bounded, non-secret event data.
  plannerLoad: 'planner:load',
  plannerSave: 'planner:save',
  plannerHistory: 'planner:history',
  plannerExport: 'planner:export',
  plannerConfigure: 'planner:configure',
  plannerOccurrence: 'planner:occurrence',
  // Alarm Clock nodes keep portable schedule intent in project data and mirror active execution
  // into a bounded, machine-local host snapshot. Due events carry no path or host identity.
  alarmPlannerState: 'alarm:planner-state',
  alarmPlannerUpsert: 'alarm:planner-upsert',
  alarmPlannerRemove: 'alarm:planner-remove',
  alarmPlannerSnooze: 'alarm:planner-snooze',
  alarmPlannerDismiss: 'alarm:planner-dismiss',
  alarmPlannerDue: 'alarm:planner-due',
  sshList: 'ssh:list',
  sshSave: 'ssh:save',
  sshDelete: 'ssh:delete',
  sshImport: 'ssh:import-candidates',
  sshConnectProject: 'ssh:connect-project',
  sshDisconnectProject: 'ssh:disconnect-project',
  sshKillSessions: 'ssh:kill-sessions',
  sshListDir: 'ssh:list-dir',
  sshMkdir: 'ssh:mkdir',
  sshUploadFile: 'ssh:upload-file',
  sshDownloadFile: 'ssh:download-file',
  /** Cache a remote media file locally (scp over the ControlMaster) and allowlist it for
   *  nt-media:// playback — how a VideoNode plays a file that lives on an SSH project's host. */
  sshMediaAllow: 'ssh:media-allow',
  /** Temporary local forward for a loopback OAuth callback emitted by an SSH-hosted CLI. */
  sshOAuthForward: 'ssh-project:oauth-forward',
  /** Cancel the exact temporary OAuth forward, normally after consent or expiry. */
  sshOAuthForwardCancel: 'ssh-project:oauth-forward-cancel',
  /** Server Edition: arm the exact localhost callback port observed in terminal output. */
  remoteOAuthArm: 'remote-oauth:arm',
  /** Server Edition: fetch one armed callback locally, consuming the arm first. */
  remoteOAuthComplete: 'remote-oauth:complete',
  /** Server Edition: cancel the current one-shot callback arm. */
  remoteOAuthCancel: 'remote-oauth:cancel',
  sshFsList: 'sshFs:list',
  sshFsRead: 'sshFs:read',
  sshFsReadBinary: 'sshFs:read-binary',
  sshFsWrite: 'sshFs:write',
  sshFsMkdir: 'sshFs:mkdir',
  sshFsExists: 'sshFs:exists',
  sshFsQuickOpen: 'sshFs:quick-open',
  sshProjectStatus: 'ssh-project:status',
  /** main → renderer: an SSH project's identity file is passphrase-protected and the ssh-agent
   *  does not hold the key (or the last answer was wrong), so show a prompt.
   *  Payload: SshPassphraseRequest. */
  sshPassphraseRequest: 'ssh-project:passphrase-request',
  /** renderer → main: the user's answer to an sshPassphraseRequest. Args: (requestId, value),
   *  value null on cancel. */
  sshPassphraseSubmit: 'ssh-project:passphrase-submit',
  /** main → renderer: a passphrase request expired main-side (abandoned prompt timeout). The
   *  renderer closes the matching dialog so a late answer cannot land in a dead request.
   *  Payload: { requestId }. */
  sshPassphraseDismiss: 'ssh-project:passphrase-dismiss',
  gitStatus: 'git:status',
  gitInit: 'git:init',
  gitClone: 'git:clone',
  gitCloneAbort: 'git:clone-abort',
  gitCloneDefaultParent: 'git:clone-default-parent',
  /** main → renderer event: { phase, percent } while a clone runs. */
  gitCloneProgress: 'git:clone-progress',
  gitCommit: 'git:commit',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitSync: 'git:sync',
  gitPublish: 'git:publish',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitStageAll: 'git:stage-all',
  gitUnstageAll: 'git:unstage-all',
  gitDiff: 'git:diff',
  gitDiscard: 'git:discard',
  gitSwitchBranch: 'git:switch-branch',
  gitCreateBranch: 'git:create-branch',
  gitShowFile: 'git:show-file',
  gitHistory: 'git:history',
  gitCommitFiles: 'git:commit-files',
  gitRemoteCommitUrl: 'git:remote-commit-url',
  gitMerge: 'git:merge',
  gitRebase: 'git:rebase',
  gitDeleteBranch: 'git:delete-branch',
  gitRenameBranch: 'git:rename-branch',
  gitFetch: 'git:fetch',
  gitForcePush: 'git:force-push',
  gitStashPush: 'git:stash-push',
  gitStashPop: 'git:stash-pop',
  gitRevert: 'git:revert',
  gitBranchAt: 'git:branch-at',
  gitCheckoutCommit: 'git:checkout-commit',
  gitRepoRoot: 'git:repo-root',
  gitDiscoverNestedRepos: 'git:discover-nested-repos',
  gitWorktreeList: 'git:worktree-list',
  gitWorktreeAdd: 'git:worktree-add',
  gitWorktreeMerge: 'git:worktree-merge',
  gitWorktreeRemovalProof: 'git:worktree-removal-proof',
  gitWorktreeRemove: 'git:worktree-remove',
  gitSetActiveRemote: 'git:set-active-remote',
  shellOpenExternal: 'shell:open-external',
  commitGenerate: 'commit:generate',
  mediaAllow: 'media:allow',
  mediaWriteHtml: 'media:write-html',
  browserRegister: 'browser:register',
  browserUnregister: 'browser:unregister',
  browserNewWindow: 'browser:new-window',
  browserExtensionsList: 'browser:extensions-list',
  browserExtensionsAdd: 'browser:extensions-add',
  browserExtensionsRemove: 'browser:extensions-remove',
  browserExtensionsPickDir: 'browser:extensions-pick-dir',
  browserProfileReset: 'browser:profile-reset',
  // Browser control indicator + Stop (S8 PR 6). Main pushes the current driven-lease set to the
  // renderer (the chip / rope / kill row); the renderer asks main to revoke — per node, all, or a
  // whole project's — and main detaches the debugger + drops the ledger entry for real.
  browserLeaseChanged: 'browser:lease-changed',
  browserStop: 'browser:stop-control',
  browserStopAll: 'browser:stop-control-all',
  browserStopProject: 'browser:stop-control-project',
  // The `browser` VERB resolve round-trip (S8 PR 7). Main intercepts `browser` and asks the renderer
  // the two things ONLY it knows — which project owns the source node, whether that source is a
  // control-capable agent, and whether the per-project capability is on RIGHT NOW — over the same
  // routing every verb uses. Main makes the security decision (owner + capability + CDP gate) and
  // does the CDP work itself; the renderer never runs a CDP command.
  browserControlResolve: 'browser:control-resolve',
  browserControlResolveResult: 'browser:control-resolve-result',
  remoteHostStart: 'remote:host:start',
  remoteHostStop: 'remote:host:stop',
  // Connection approval gate: main → renderer when a client finishes the handshake (carries the
  // SAS to display); renderer → main to approve/reject. Until approved, the host serves no
  // pty/fs RPCs or input frames, so a leaked offer cannot grant silent access.
  remoteHostPeerPending: 'remote:host:peer-pending',
  remoteHostPeerPendingCleared: 'remote:host:peer-pending-cleared',
  remoteHostApprove: 'remote:host:approve',
  remoteHostReject: 'remote:host:reject',
  // Host canvas mirror: renderer pushes its serialized active-project canvas to main;
  // main pushes a client's mutation back to the host renderer to apply.
  remoteHostCanvasState: 'remote:host:canvas-state',
  remoteHostApplyMutation: 'remote:host:apply-mutation',
  // Standing (phone) relay host: renderer toggles it on/off (settings.phoneAccessEnabled). Main
  // starts/stops the always-on host connection so a paired phone can reach this Mac over the relay.
  remoteStandingHostSet: 'remote:standing-host:set',
  // Revoke a paired PEER (by its stable box public key). Unpinning alone only refuses the NEXT
  // handshake — the open relay socket keeps full shell access — so this ALSO cuts the live session
  // (revocation.ts's whole point; see relay-host.ts's killRelayHostsByPeerKey).
  remoteRevokePeer: 'remote:revoke-peer',
  // List every relay peer pinned by mutual approval (base64 box public keys — public, never
  // credentials), so Settings can show who can reach this machine and offer to revoke them.
  remoteListApprovedPeers: 'remote:list-approved-peers',
  // ── New E2EE relay tunnel (Stage 4) ─────────────────────────────────────────────────────────
  // The successor to the legacy `remote:host:*` dialect above (the `remote:client:*` desktop-client
  // channels were deleted in Task 10; the desktop client is now the `relay:*` tunnel). The phone
  // still speaks `remote:host:*` until the iOS repo migrates (docs/ios-protocol-migration.md), so
  // these deliberately use a distinct `relay:*` namespace. A connected peer is a first-class
  // CorePlatform client: the client casts raw rpc.ts frames (JSON strings) at the host and receives
  // frames back, rather than a bespoke per-verb channel set.
  //
  // HOST side: enter/leave host mode, and the mutual-approval gate. `relayHostPeerPending` fires
  // main → renderer when a client finishes the encrypted handshake and is awaiting approval
  // (payload `{ id, sas, peerKeyB64 }` — the SAS both humans compare, the peer's box key to pin);
  // the host human answers with `relayHostConfirm` (id). `relayHostOpen` / `relayHostClosed` fire
  // main → renderer when a bridged peer becomes a live client / drops (payload `{ id }`).
  relayHostStart: 'relay:host:start',
  relayHostDockerContexts: 'relay:host:docker-contexts',
  dockerHostManagerContexts: 'docker-host-manager:contexts',
  dockerHostManagerSnapshot: 'docker-host-manager:snapshot',
  dockerHostManagerLogs: 'docker-host-manager:logs',
  dockerHostManagerRun: 'docker-host-manager:run',
  dockerHostManagerCancel: 'docker-host-manager:cancel',
  dockerHostManagerProgress: 'docker-host-manager:progress',
  dockerHostManagerGitlabStatus: 'docker-host-manager:gitlab-status',
  dockerHostManagerGitlabBackups: 'docker-host-manager:gitlab-backups',
  dockerHostManagerGitlabCredential: 'docker-host-manager:gitlab-credential',
  dockerHostManagerGitlabRun: 'docker-host-manager:gitlab-run',
  nextcloudAioContexts: 'nextcloud-aio:contexts',
  nextcloudAioSnapshot: 'nextcloud-aio:snapshot',
  nextcloudAioRun: 'nextcloud-aio:run',
  nextcloudAioCancel: 'nextcloud-aio:cancel',
  nextcloudAioProgress: 'nextcloud-aio:progress',
  nextcloudManagedRun: 'docker-host-manager:nextcloud-managed-run',
  nextcloudManagedSnapshots: 'docker-host-manager:nextcloud-managed-snapshots',
  nextcloudManagedCancel: 'docker-host-manager:nextcloud-managed-cancel',
  nextcloudManagedProgress: 'docker-host-manager:nextcloud-managed-progress',
  // Guided Cloudflare account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics managers.
  // Tokens stay in the host credential vault; canvas data carries only safe intent.
  cloudflareCoreRuntime: 'cloudflare-core:runtime',
  cloudflareCoreCredentials: 'cloudflare-core:credentials',
  cloudflareCoreSaveCredential: 'cloudflare-core:save-credential',
  cloudflareCoreRemoveCredential: 'cloudflare-core:remove-credential',
  cloudflareCoreBinding: 'cloudflare-core:binding',
  cloudflareCoreBind: 'cloudflare-core:bind',
  cloudflareCoreUnbind: 'cloudflare-core:unbind',
  cloudflareCorePreview: 'cloudflare-core:preview',
  cloudflareCoreExecute: 'cloudflare-core:execute',
  cloudflareCoreCancel: 'cloudflare-core:cancel',
  cloudflareCoreProgress: 'cloudflare-core:progress',
  cloudflareCoreTunnelState: 'cloudflare-core:tunnel-state',
  cloudflareCoreTunnelProbe: 'cloudflare-core:tunnel-probe',
  cloudflareCoreTunnelCancel: 'cloudflare-core:tunnel-cancel',
  cloudflareCoreTunnelStateChanged: 'cloudflare-core:tunnel-state-changed',
  // Team Access (multi-seat): `relayHostInvite` ADDS a seat (invoke, `{ projectId?, email? }` →
  // `{ offer }`, cap-checked → rejects `E_SEATS_FULL`); `relayHostRevoke` (send, `{ id }`) cuts one
  // bridged peer's live session. `relayHostPeerPending`/`relayHostOpen` now also carry the seat
  // `email` label. Host-side cap/revoke are UX/host enforcement, not a server-guaranteed limit (v2).
  relayHostInvite: 'relay:host:invite',
  relayHostRevoke: 'relay:host:revoke',
  relayHostStop: 'relay:host:stop',
  relayHostPeerPending: 'relay:host:peer-pending',
  relayHostConfirm: 'relay:host:confirm',
  relayHostOpen: 'relay:host:open',
  relayHostClosed: 'relay:host:closed',
  // CLIENT side: connect to a host by its pairing offer (resolves a connectionId), the client half
  // of the same mutual-approval gate, and the raw frame pipe. `relayClientSas` pushes the channel
  // SAS main → renderer so the client human can compare it before the host approves;
  // `relayClientConfirm` (id) is this human's confirmation; `relayClientApproved` fires once the
  // host approves. `relayClientSend` casts an outbound rpc frame (JSON) at the host;
  // `relayClientFrame` delivers an inbound one. `relayClientClosed` fires when the socket drops.
  relayClientConnect: 'relay:client:connect',
  relayClientConfirm: 'relay:client:confirm',
  relayClientSend: 'relay:client:send',
  relayClientDisconnect: 'relay:client:disconnect',
  relayClientSas: (connectionId: string) => `relay:client:sas:${connectionId}`,
  relayClientApproved: (connectionId: string) => `relay:client:approved:${connectionId}`,
  relayClientFrame: (connectionId: string) => `relay:client:frame:${connectionId}`,
  relayClientClosed: (connectionId: string) => `relay:client:closed:${connectionId}`,
  handoffBuild: 'handoff:build',
  // Phone pairing (nodeterm iOS "scan a QR" flow): renderer starts/stops the one-shot LAN
  // listener; main pushes the completion result back over `pairing:done`. The per-device
  // registry (list/revoke) lives in ~/.nodeterm/agent.json.
  pairingStart: 'pairing:start',
  pairingStop: 'pairing:stop',
  pairingDone: 'pairing:done',
  pairingProbeSsh: 'pairing:probe-ssh',
  pairingOpenRemoteLoginSettings: 'pairing:open-remote-login-settings',
  pairingListDevices: 'pairing:listDevices',
  pairingRevokeDevice: 'pairing:revokeDevice',
  // Dictation (desktop/server). speechProgress is a main/server → renderer broadcast of
  // { id, pct } while a whisper model downloads (WhisperModelStore.onProgress).
  speechTranscribe: 'speech:transcribe',
  speechModels: 'speech:models',
  speechModelDownload: 'speech:model-download',
  speechModelDelete: 'speech:model-delete',
  speechProgress: 'speech:progress',
  // Electron-only: registered in src/main/index.ts (systemPreferences.askForMediaAccess) and
  // stubbed `async () => true` in src/server/index.ts (browser mic permission is the browser's
  // own prompt, not ours to gate).
  speechMicConsent: 'speech:mic-consent',
  // Local AWS CDK manager. The desktop shell owns the local CLI process and the explicit trust
  // and diff-review tokens; no project path or generated runtime state enters a portable file.
  cdkStatus: 'cdk:status',
  cdkInspectProject: 'cdk:inspect-project',
  cdkApproveTrust: 'cdk:approve-trust',
  cdkSynth: 'cdk:synth',
  cdkDiff: 'cdk:diff',
  cdkDeploy: 'cdk:deploy',
  cdkCancel: 'cdk:cancel',
  // Universal file converter (docs/file-converter.md). converterItem/converterSummary are pushed
  // by the core engine whenever an item or the queue-wide facts change — the renderer never polls.
  converterCatalog: 'converter:catalog',
  converterDetect: 'converter:detect',
  converterPreflight: 'converter:preflight',
  converterState: 'converter:state',
  converterAddFiles: 'converter:add-files',
  converterAddFolder: 'converter:add-folder',
  converterCancelScan: 'converter:cancel-scan',
  converterResolvePending: 'converter:resolve-pending',
  converterStart: 'converter:start',
  converterPause: 'converter:pause',
  converterCancelItem: 'converter:cancel-item',
  converterCancelAll: 'converter:cancel-all',
  converterRetryItem: 'converter:retry-item',
  converterRemoveItem: 'converter:remove-item',
  converterClearFinished: 'converter:clear-finished',
  converterSetConcurrency: 'converter:set-concurrency',
  converterItem: 'converter:item',
  converterSummary: 'converter:summary',
  // Automatic installation foundation for node-feature dependencies. These calls are handled only
  // by the privileged core host; the renderer receives machine-local paths only as explicit
  // readiness metadata and never writes them into projects.
  nodeDependencyCatalog: 'node-dependency:catalog',
  nodeDependencyStatus: 'node-dependency:status',
  nodeDependencyDetails: 'node-dependency:details',
  nodeDependencyInstall: 'node-dependency:install',
  nodeDependencyCancel: 'node-dependency:cancel',
  nodeDependencyRepair: 'node-dependency:repair',
  nodeDependencyReconcile: 'node-dependency:reconcile',
  nodeDependencyState: 'node-dependency:state',
  nodeDependencyProgress: 'node-dependency:progress',
  awsWizardCatalog: 'aws-wizard:catalog',
  awsWizardCommands: 'aws-wizard:commands',
  awsWizardSource: 'aws-wizard:source',
  awsResourceRuntime: 'aws-resource:runtime',
  awsResourceProfiles: 'aws-resource:profiles',
  awsResourceBinding: 'aws-resource:binding',
  awsResourceBind: 'aws-resource:bind',
  awsResourceUnbind: 'aws-resource:unbind',
  awsResourcePreview: 'aws-resource:preview',
  awsResourceExecute: 'aws-resource:execute',
  awsResourceCancel: 'aws-resource:cancel',
  awsResourceProgress: 'aws-resource:progress',
  /** Electron only: a multi-file picker (dialog:select-file only returns one path). Browser (Server
   *  Edition) uses a plain `<input type="file" multiple>` + files.saveUpload instead — see
   *  FileConverterPanel.tsx. */
  dialogSelectFiles: 'dialog:select-files',
  // Local Ollama suite manager (docs/ollama-manager.md). Talks ONLY to Ollama's own local HTTP API
  // (default http://127.0.0.1:11434) from the privileged shell — never from the renderer directly.
  ollamaStatus: 'ollama:status',
  ollamaModels: 'ollama:models',
  ollamaRunning: 'ollama:running',
  ollamaShow: 'ollama:show',
  ollamaDelete: 'ollama:delete',
  ollamaCopy: 'ollama:copy',
  ollamaHardware: 'ollama:hardware',
  ollamaFit: 'ollama:fit',
  ollamaPopularModels: 'ollama:popular-models',
  ollamaPullState: 'ollama:pull-state',
  ollamaPullEnqueue: 'ollama:pull-enqueue',
  ollamaPullStart: 'ollama:pull-start',
  ollamaPullPause: 'ollama:pull-pause',
  ollamaPullCancelItem: 'ollama:pull-cancel-item',
  ollamaPullRetryItem: 'ollama:pull-retry-item',
  ollamaPullRemoveItem: 'ollama:pull-remove-item',
  ollamaPullSetConcurrency: 'ollama:pull-set-concurrency',
  /** main/server → renderer: a pull item's status/progress changed. */
  ollamaPullItem: 'ollama:pull-item',
  ollamaPullSummary: 'ollama:pull-summary',
  ollamaChatSessions: 'ollama:chat-sessions',
  ollamaChatGet: 'ollama:chat-get',
  ollamaChatCreate: 'ollama:chat-create',
  ollamaChatRename: 'ollama:chat-rename',
  ollamaChatDelete: 'ollama:chat-delete',
  ollamaChatExport: 'ollama:chat-export',
  ollamaChatSend: 'ollama:chat-send',
  ollamaChatStop: 'ollama:chat-stop',
  /** main/server → renderer: a streamed chat token/finish/error for the session named in the
   *  payload. One shared channel (not per-session) — the renderer filters by sessionId. */
  ollamaChatStream: 'ollama:chat-stream',
  // Open WebUI hosting node. The renderer submits a closed operation shape; Docker context,
  // image, volume, archive, and provider secrets are validated and owned by the privileged host.
  openWebUiContexts: 'open-webui:contexts',
  openWebUiState: 'open-webui:state',
  openWebUiRun: 'open-webui:run',
  openWebUiCancel: 'open-webui:cancel',
  openWebUiProgress: 'open-webui:progress',
  // Local Minecraft server create-and-manage (docs/minecraft-server-manager.md). Registered on
  // BOTH shells over the same `platform.handle`/`platform.broadcast` seam as Ollama above, so it
  // manages whichever machine is actually running the shell. NOT carried over the relay (a peer
  // must not provision or run processes on the host it joined) — see relay-rpc-policy.ts, which
  // deliberately has no entries for this namespace.
  minecraftVersions: 'minecraft:versions',
  minecraftStatus: 'minecraft:status',
  minecraftCreate: 'minecraft:create',
  minecraftAcceptEula: 'minecraft:accept-eula',
  minecraftStart: 'minecraft:start',
  minecraftStop: 'minecraft:stop',
  minecraftSendCommand: 'minecraft:send-command',
  minecraftRemove: 'minecraft:remove',
  minecraftRecentConsole: 'minecraft:recent-console',
  minecraftPropertiesRead: 'minecraft:properties-read',
  minecraftPropertiesWrite: 'minecraft:properties-write',
  minecraftPlayerLists: 'minecraft:player-lists',
  minecraftBackupsList: 'minecraft:backups-list',
  minecraftBackupCreate: 'minecraft:backup-create',
  minecraftBackupRestore: 'minecraft:backup-restore',
  minecraftBackupDelete: 'minecraft:backup-delete',
  // Shell → renderer: one multiplexed status/console stream, like ollama:chat-stream above.
  // Payload: MinecraftEvent. A listener filters to the instance id it owns.
  minecraftEvent: 'minecraft:event',

  // Local AWS profile and non-secret identity metadata. Credentials remain in AWS's own local
  // stores and never cross this channel.
  awsIdentityDiscover: 'aws-identity:discover',
  awsIdentityStart: 'aws-identity:start',
  awsIdentityCancel: 'aws-identity:cancel',
  awsIdentityOperation: 'aws-identity:operation',
  // Local WebTorrent downloader. Task state remains machine-local; only explicit task events cross
  // the shell bridge. See shared/torrent.ts and core/torrent/.
  torrentRuntime: 'torrent:runtime',
  torrentList: 'torrent:list',
  torrentInspect: 'torrent:inspect',
  torrentAdd: 'torrent:add',
  torrentChooseFiles: 'torrent:choose-files',
  torrentSetDestination: 'torrent:set-destination',
  torrentPreflight: 'torrent:preflight',
  torrentStart: 'torrent:start',
  torrentPause: 'torrent:pause',
  torrentResume: 'torrent:resume',
  torrentCancel: 'torrent:cancel',
  torrentRetry: 'torrent:retry',
  torrentRemove: 'torrent:remove',
  torrentSetSeedPolicy: 'torrent:set-seed-policy',
  torrentReconcile: 'torrent:reconcile',
  torrentTask: 'torrent:task',
  // Calendar nodes. Secrets never travel through these metadata/event channels; the core owns
  // OAuth callbacks and seals provider tokens in the OS vault.
  calendarStatus: 'calendar:status',
  calendarAccounts: 'calendar:accounts',
  calendarCalendars: 'calendar:calendars',
  calendarEvents: 'calendar:events',
  calendarImportIcs: 'calendar:import-ics',
  calendarRefresh: 'calendar:refresh',
  calendarBeginOAuth: 'calendar:begin-oauth',
  calendarConnectCalDav: 'calendar:connect-caldav',
  calendarDisconnectAccount: 'calendar:disconnect-account',
  calendarCreate: 'calendar:create',
  calendarUpdate: 'calendar:update',
  calendarRemove: 'calendar:remove',
  // Home Assistant multi-instance client. Instance metadata and credentials remain machine-local;
  // only bounded entity metadata and progress events cross the renderer boundary.
  homeAssistantInstances: 'home-assistant:instances',
  homeAssistantSaveInstance: 'home-assistant:save-instance',
  homeAssistantRemoveInstance: 'home-assistant:remove-instance',
  homeAssistantDiscover: 'home-assistant:discover',
  homeAssistantCancel: 'home-assistant:cancel',
  homeAssistantEvent: 'home-assistant:event',
  homeAssistantConnections: 'home-assistant-control:connections',
  homeAssistantConfigure: 'home-assistant-control:configure',
  homeAssistantBind: 'home-assistant-control:bind',
  homeAssistantStatus: 'home-assistant-control:status',
  homeAssistantEntities: 'home-assistant-control:entities',
  homeAssistantServices: 'home-assistant-control:services',
  homeAssistantCall: 'home-assistant-control:call',
  homeAssistantControlCancel: 'home-assistant-control:cancel',
  // Home Assistant sensor nodes. Shared projects carry only entity/presentation intent; these
  // channels operate on a machine-local binding whose credential never crosses back to the UI.
  homeAssistantSensorBinding: 'home-assistant-sensor:binding',
  homeAssistantSensorConfigure: 'home-assistant-sensor:configure',
  homeAssistantSensorLeaveUnbound: 'home-assistant-sensor:leave-unbound',
  homeAssistantSensorDiscover: 'home-assistant-sensor:discover',
  homeAssistantSensorRefresh: 'home-assistant-sensor:refresh',
  // "Open in Visual Studio Code" (src/core/vscode-detect.ts, src/core/vscode-handlers.ts).
  // Registered on BOTH shells via the generic `platform.handle` seam, so it opens VS Code on
  // whichever machine is actually running the shell (this desktop, or the Server Edition host).
  vscodeDetect: 'vscode:detect',
  vscodeOpen: 'vscode:open',
  // Save exported text content to disk. Desktop: a real native Save-As dialog + write, returning
  // the chosen path. Electron-only — see src/main/index.ts; the Server Edition/browser build
  // falls back to a plain Blob download in the renderer (src/renderer/lib/exportSave.ts), which
  // has no path to hand back, so "Open in Visual Studio Code" is disabled there.
  exportSaveText: 'export:save-text',
  // Local, git-backed version history for user-managed records this app owns (settings today —
  // see src/core/local-history.ts, docs/local-history.md). Registered on BOTH shells.
  historyList: 'history:list',
  historyRestore: 'history:restore',
  // Toy locks (docs/toy-locks.md) — a for-fun, opt-in gate on a tab/node/appearance value. Core-
  // bound: registered by BOTH src/main and src/server (core/toylocks/toylock-service.ts), so a
  // Server Edition browser tab reaches the SAME service over the WS bridge that Electron reaches
  // over ipcMain — see src/renderer/bridge/ws-bridge.ts's buildToylockApi.
  toylockList: 'toylock:list',
  toylockCreatePassword: 'toylock:create-password',
  toylockBeginTotp: 'toylock:begin-totp',
  toylockConfirmTotp: 'toylock:confirm-totp',
  toylockCancelTotp: 'toylock:cancel-totp',
  toylockUpdate: 'toylock:update',
  toylockRemove: 'toylock:remove',
  toylockVerify: 'toylock:verify',
  toylockRelock: 'toylock:relock',
  // The unlock ladder for a rate-limited toy lock (docs/unlock-ladder.md). Clearing a rung ends
  // the WAIT and nothing else — it never supplies a credential, never refunds an attempt, and
  // never shortens the next wait.
  toylockLadderIssue: 'toylock:ladder-issue',
  toylockLadderVerify: 'toylock:ladder-verify',
  // The built-in authenticator (docs/authenticator.md). Same core-bound registration pattern.
  authenticatorList: 'authenticator:list',
  authenticatorAddManual: 'authenticator:add-manual',
  authenticatorAddUri: 'authenticator:add-uri',
  authenticatorRename: 'authenticator:rename',
  authenticatorRemove: 'authenticator:remove',
  authenticatorCode: 'authenticator:code',
  authenticatorCodes: 'authenticator:codes',
  authenticatorReveal: 'authenticator:reveal',
  authenticatorExportSecrets: 'authenticator:export-secrets',
  // Real per-project password managers (docs pending) — core-bound, registered by BOTH shells
  // (core/password-manager/password-manager-handlers.ts), same pattern as toylocks/authenticator
  // above. Unlike those, credentials live in a project-scoped file (<cwd>/.nodeterm/vault.json),
  // not machine-local userData — see vault-store.ts's header.
  passwordManagerStatus: 'password-manager:status',
  passwordManagerCreateVault: 'password-manager:create-vault',
  passwordManagerUnlock: 'password-manager:unlock',
  passwordManagerLock: 'password-manager:lock',
  passwordManagerChangePassword: 'password-manager:change-password',
  passwordManagerCreateManager: 'password-manager:create-manager',
  passwordManagerRenameManager: 'password-manager:rename-manager',
  passwordManagerBindManagerGroup: 'password-manager:bind-manager-group',
  passwordManagerReleaseGroupBinding: 'password-manager:release-group-binding',
  passwordManagerDeleteManager: 'password-manager:delete-manager',
  passwordManagerCreateCredential: 'password-manager:create-credential',
  passwordManagerRenameCredential: 'password-manager:rename-credential',
  passwordManagerUpdateCredentialSecret: 'password-manager:update-credential-secret',
  passwordManagerRemoveCredential: 'password-manager:remove-credential',
  passwordManagerRevealCredential: 'password-manager:reveal-credential',
  passwordManagerCredentialCode: 'password-manager:credential-code',
  /** Every credential in one manager as non-secret metadata. Closes the gap that left a
   *  credential from an earlier session visible only as a number. */
  passwordManagerListCredentials: 'password-manager:list-credentials',
  // Multiverse portal-door credentials are host-owned and separate from toy locks. Values are
  // accepted only for an immediate configure or verify request and never returned to the project.
  universeDoorEntryConfigure: 'universe-door-entry:configure',
  universeDoorEntryVerify: 'universe-door-entry:verify',
  universeDoorEntryRemove: 'universe-door-entry:remove'
} as const
