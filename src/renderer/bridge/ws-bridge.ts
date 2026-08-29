// WebSocket bridge that reconstructs `window.nodeTerminal` in the browser (Server Edition).
//
// Under Electron the preload already defines `window.nodeTerminal`; this module only runs when
// it is absent (see main.tsx's bootstrap switch). It opens ONE WebSocket to `/ws`, speaks the
// Task-1 RPC protocol (`parseRpcMessage` / `decodePtyData`), and rebuilds the three real
// namespaces (`pty`, `workspace`, `settings`) over that socket. Every other namespace comes from
// `buildStubApi()` (Task 7) so the renderer boots without a full Electron preload.

import {
  parseRpcMessage,
  encodeArgs,
  decodePtyData,
  E_DISCONNECTED,
  type RpcMessage
} from '../../shared/rpc'
import { IPC } from '../../shared/ipc'
import { mapLocalVocabularyText } from '../lib/personalVocabulary/hostMessage'
import type { GitHubApiApi, GitHubApiProgress, GitHubApiRequest } from '../../shared/github-api'
import type { GitHubCliAccountsApi, GitHubControlApi, GitHubIssuesApi } from '../../shared/github-issues'
import type { ConverterApi } from '../../shared/converter'
import type { OllamaApi } from '../../shared/ollama'
import type { RepositoryGraphApi } from '../../shared/repository-graph'
import {
  parseUniGetUiPackageList,
  parseUniGetUiSetting,
  type UniGetUiApi
} from '../../shared/unigetui'
import type { MinecraftApi } from '../../shared/minecraft'
import type { DockerHostApi } from '../../shared/docker-host'
import type { NodeDependenciesApi } from '../../shared/node-dependencies'
import type { AwsWizardModelsApi } from '../../shared/aws-wizard'
import type { AwsIdentityApi } from '../../shared/aws-identity'
import type { AwsResourceManagerApi } from '../../shared/aws-resource-managers'
import type { TorrentApi, TorrentTaskState } from '../../shared/torrent'
import type { VirtualMachineApi } from '../../shared/virtual-machine'
import type { CalendarApi, CalendarProvider } from '../../shared/calendar'
import type { CloudflareCoreManagersApi } from '../../shared/cloudflare-core-managers'
import type { HomeAssistantApi } from '../../shared/home-assistant'
import type { HomeAssistantControlApi } from '../../shared/home-assistant-control'
import type { HomeAssistantSensorApi } from '../../shared/home-assistant-sensor'
import type { CloudflareTunnelApi } from '../../shared/cloudflare-tunnels'
import type { CloudflareApi, CloudflareExecutionProgress } from '../../shared/cloudflare-zero-trust'
import {
  UNKNOWN_CLAUDE_CLI_CAPS,
  type BoardLogApi,
  type TimerApi,
  type LogApi,
  type LogRecord,
  type BoardLogReadResult,
  type ChatTranscriptResult,
  type ClaudeApi,
  type ClaudeCliCaps,
  type CodexApi,
  type CodexIdentityCaps,
  UNKNOWN_CODEX_IDENTITY_CAPS,
  type ContextApi,
  type DownloadTicket,
  type FilesApi,
  type FsApi,
  type GitApi,
  type MemInfo,
  type NodeTerminalApi,
  type PresenceApi,
  type PtyApi,
  type PtyCreateOptions,
  type ScheduledSettingsApi,
  type PlannerApi,
  type SettingsApi,
  type KidsModeApi,
  type KidsModeSnapshot,
  type SchoolModeApi,
  type SchoolModeRecord,
  type ClaudeUsage,
  type ProviderUsage,
  type RemoteAccountUsage,
  type RemoteUsageQuery,
  type SessionMemoryQuery,
  type SessionMemoryReport,
  type Settings,
  type SpeechApi,
  type SpeechModelInfo,
  type TmuxStatus,
  type TranscriptLine,
  type Workspace,
  type WorkspaceApi,
  type ToylockApi,
  type AuthenticatorApi,
  type PasswordManagerApi
} from '../../shared/types'
import type {
  OAuthCompleteInput,
  OAuthStartInput,
  ProviderAccountsApi,
  ProviderAccountsSnapshot,
  ProviderBindingInput,
  ProviderCredentialInput,
  ProviderProfileInput,
  ProviderProfile
} from '../../shared/provider-accounts'
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
} from '../../shared/toylock'
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
} from '../../shared/authenticator'
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
} from '../../shared/password-manager'
import type { PeerIdentity } from '../../shared/presence'
import type {
  ScheduledSettingsActiveState,
  ScheduledSettingsFile,
  ScheduledSettingsLoadState
} from '../../shared/scheduled-settings'
import type { PlannerFile, PlannerLoadState, PlannerOccurrence } from '../../shared/planner-occurrences'
import type { VsCodeInstall, VsCodeOpenResult } from '../../shared/vscode'
import type { HistoryFilters, HistoryListResult, HistoryRestoreResult } from '../../shared/local-history'
import type { RemoteOAuthApi } from '../../shared/remote-oauth'
import { buildStubApi } from './stubs'
import { mountPickerRoot, openDirectoryPicker } from './dialog-picker'
import { encodePcmForWire } from './speech-encode'
import { type FrameTransport, WebSocketFrameTransport } from './frame-transport'
import {
  UPLOAD_HTTP_PATH,
  UPLOAD_MAX_BASE64_CHARS,
  UPLOAD_MAX_BYTES,
  UPLOAD_TOO_LARGE_MESSAGE,
  type UploadHttpError,
  type UploadHttpSuccess
} from '../../shared/uploads'

type Listener = (...args: unknown[]) => void

async function postUploadOverHttp(
  name: string,
  body: Blob | Uint8Array<ArrayBuffer>,
  fetchImpl: typeof fetch
): Promise<string | null> {
  const response = await fetchImpl(`${UPLOAD_HTTP_PATH}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
    credentials: 'same-origin'
  })
  const result = (await response.json().catch(() => null)) as UploadHttpSuccess | UploadHttpError | null
  if (!response.ok) {
    const message = result && 'message' in result
      ? result.message
      : mapLocalVocabularyText('The server refused the upload.')
    throw new Error(message)
  }
  return result && 'path' in result && typeof result.path === 'string' ? result.path : null
}

/**
 * Compatibility carrier for browser-held bytes that already exist as base64 (for example a
 * clipboard image). Refuse by encoded length before `atob`: otherwise an over-limit value needs a
 * second, equally large binary-string allocation merely to discover that it cannot be accepted.
 */
export async function saveUploadOverHttp(
  name: string,
  dataBase64: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) return null
  if (dataBase64.length > UPLOAD_MAX_BASE64_CHARS) {
    throw new Error(mapLocalVocabularyText(UPLOAD_TOO_LARGE_MESSAGE))
  }

  let binary: string
  try {
    binary = atob(dataBase64)
  } catch {
    throw new Error(mapLocalVocabularyText('The selected file could not be decoded for upload.'))
  }
  if (binary.length === 0) return null
  if (binary.length > UPLOAD_MAX_BYTES) {
    throw new Error(mapLocalVocabularyText(UPLOAD_TOO_LARGE_MESSAGE))
  }

  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return postUploadOverHttp(name, bytes, fetchImpl)
}

/**
 * Server Edition fast path for a File/Blob the browser already owns. Passing the Blob itself as
 * the fetch body lets the browser stream its backing store; converting through ArrayBuffer,
 * base64, `atob`, and another Uint8Array temporarily multiplies a 64 MiB selection several times.
 */
export async function saveUploadBlobOverHttp(
  name: string,
  data: Blob,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  // Blob.size is cheap browser metadata. The authenticated receiver still counts untrusted bytes
  // again, because this renderer-side guard is an allocation optimization, not a trust boundary.
  if (data.size === 0) return null
  if (data.size > UPLOAD_MAX_BYTES) throw new Error(mapLocalVocabularyText(UPLOAD_TOO_LARGE_MESSAGE))
  return postUploadOverHttp(name, data, fetchImpl)
}

/**
 * A `FrameTransport`, a pending-request map keyed by an incrementing id, and a channel-listener
 * fan-out map. Exported for the unit tests (`ws-bridge.test.ts` / `frame-transport.test.ts`). Kept
 * free of any DOM/overlay concerns so the tests stay clean — reconnect UI lives in `installWsBridge`.
 *
 * `RpcClient` speaks the rpc.ts protocol but is carrier-agnostic: it depends only on a
 * `FrameTransport` (the WebSocket to the Server Edition server, or the relay tunnel to a remote
 * desktop). For back-compat a plain URL string is accepted and wrapped in a `WebSocketFrameTransport`
 * (so the WebSocket path — and its tests — are byte-identical to before the transport was extracted).
 */
export class RpcClient {
  private transport: FrameTransport
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private channels = new Map<string, Set<Listener>>()
  // Events that arrived before any subscriber existed for their channel. The server can push an
  // event in the same macrotask as `open`, so a subscriber registered one microtask later (via
  // `await ready()`) would otherwise miss it. Buffered here (capped) and flushed on subscribe.
  private early: Array<{ channel: string; args: unknown[] }> = []
  private closeCbs = new Set<() => void>()

  constructor(transport: FrameTransport | string) {
    this.transport =
      typeof transport === 'string' ? new WebSocketFrameTransport(transport) : transport
    this.transport.onMessage((data) => this.onMessage(data))
    this.transport.onClose(() => {
      // Fail the in-flight requests BEFORE the overlay hooks: a response can only arrive over the
      // carrier that carried the request, so once it is gone they are unanswerable.
      this.failPending()
      this.closeCbs.forEach((cb) => cb())
    })
  }

  /**
   * Reject every in-flight request, because the socket that could have answered them is gone.
   *
   * A promise that never settles is the worst of the three outcomes. The caller's cleanup —
   * `setBusy(false)`, a `finally`, an error banner — is all downstream of the `await`, so it simply
   * never runs: a dialog sits on "Creating…" with its own Cancel button disabled by `busy`, showing
   * no error and offering no way out but Escape; a Merge or Remove looks like a silent no-op. Every
   * caller that handles a rejection at all handles this correctly the moment we actually reject, so
   * failing closed here protects features that have not been written yet, not just this one.
   */
  private failPending(): void {
    if (this.pending.size === 0) return
    const waiting = [...this.pending.values()]
    this.pending.clear() // clear first: a reject handler that fires another request must not see stale ids
    const err = Object.assign(new Error('The connection to the server was lost.'), {
      code: E_DISCONNECTED
    })
    for (const p of waiting) p.reject(err)
  }

  /** Resolves once the carrier is open; rejects if it fails to open. */
  ready(): Promise<void> {
    return this.transport.ready()
  }

  /** Register a connection-loss hook (used by the reconnect overlay). */
  onClose(cb: () => void): void {
    this.closeCbs.add(cb)
  }

  private onMessage(data: string | Uint8Array): void {
    if (typeof data === 'string') {
      const m = parseRpcMessage(data)
      if (!m) return
      this.handleJson(m)
      return
    }
    // Binary pty frame. The transport has already normalized the carrier's native binary shape
    // (ArrayBuffer in the browser, Buffer under the `ws` package in tests) to a Uint8Array.
    const decoded = decodePtyData(data)
    if (!decoded) return
    this.fanOut(IPC.ptyData(decoded.sessionId), [decoded.data])
  }

  private handleJson(m: RpcMessage): void {
    if (m.t === 'res') {
      const entry = this.pending.get(m.id)
      if (!entry) return
      this.pending.delete(m.id)
      if (m.ok) entry.resolve(m.result)
      else entry.reject(Object.assign(new Error(m.error.message), { code: m.error.code }))
    } else if (m.t === 'ev') {
      this.fanOut(m.channel, m.args)
    }
  }

  private fanOut(channel: string, args: unknown[]): void {
    const set = this.channels.get(channel)
    if (!set || set.size === 0) {
      // No subscriber yet — buffer for replay on the first subscribe (capped, drop oldest).
      this.early.push({ channel, args })
      if (this.early.length > 4096) this.early.shift()
      return
    }
    for (const fn of set) fn(...args)
  }

  /** Send a request and resolve with its result (or reject with the coded error). */
  request(method: string, ...args: unknown[]): Promise<unknown> {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // encodeArgs: an OMITTED optional argument must reach the handler as `undefined` (so its
      // default fires) while a MEANINGFUL `null` (pty.resize park, presence clears) stays `null`.
      this.transport.send(JSON.stringify({ t: 'req', id, method, ...encodeArgs(args) }))
    })
  }

  /** Send a fire-and-forget cast (no response expected). */
  cast(method: string, ...args: unknown[]): void {
    this.transport.send(JSON.stringify({ t: 'cast', method, ...encodeArgs(args) }))
  }

  /** Subscribe to a channel; returns an unsubscribe function. */
  subscribe(channel: string, fn: Listener): () => void {
    let set = this.channels.get(channel)
    if (!set) {
      set = new Set()
      this.channels.set(channel, set)
    }
    set.add(fn)
    // Flush any events that arrived for this channel before it had a subscriber.
    if (this.early.length > 0) {
      const pending = this.early.filter((e) => e.channel === channel)
      if (pending.length > 0) {
        this.early = this.early.filter((e) => e.channel !== channel)
        for (const e of pending) fn(...e.args)
      }
    }
    return () => {
      set!.delete(fn)
      if (set!.size === 0) this.channels.delete(channel)
    }
  }
}

function requestParsed<T>(
  client: RpcClient,
  method: string,
  parse: (value: unknown) => T,
  ...args: unknown[]
): Promise<T> {
  return client.request(method, ...args).then(parse)
}

const AI_NAMING_UNAVAILABLE = {
  ok: false as const,
  message: 'AI naming is not available in the server edition yet'
}

/** Build the real `pty` / `workspace` / `settings` / `schoolMode` / `scheduledSettings`
 *  namespaces (plus the top-level `userDataDir`) over an RpcClient, mirroring the preload's
/** Build the real `pty` / `workspace` / `projectSettings` / `settings` namespaces (plus the
 *  top-level `userDataDir`) over an RpcClient, mirroring the preload's
 *  invoke(→request)/send(→cast) split exactly. */
export function buildRealApi(
  client: RpcClient
): Pick<
  NodeTerminalApi,
  'pty' | 'workspace' | 'timer' | 'trigger' | 'serverDeployment' | 'settings' | 'schoolMode' | 'kidsMode' | 'scheduledSettings' | 'planner' | 'userDataDir'
  | 'projectSettings'
  | 'projectSetup'
  | 'worktree'
  | 'settings'
  | 'agent'
  | 'userDataDir'
> {
  const pty: PtyApi = {
    create: (options: PtyCreateOptions) =>
      client.request(IPC.ptyCreate, options) as ReturnType<PtyApi['create']>,
    write: (sessionId, data) => client.cast(IPC.ptyWrite, sessionId, data),
    resize: (sessionId, cols, rows, viewerId) =>
      client.cast(IPC.ptyResize, sessionId, cols, rows, viewerId),
    setFlow: (sessionId, resume, viewerId) => client.cast(IPC.ptyFlow, sessionId, resume, viewerId),
    kill: (sessionId, viewerId) => client.cast(IPC.ptyKill, sessionId, viewerId),
    // The trailing flag rides as a plain boolean; the core handler re-checks `=== true`.
    destroy: (persistKey, opts) =>
      client.request(IPC.ptyDestroy, persistKey, opts?.everySocket === true) as Promise<void>,
    recycle: (persistKey) => client.request(IPC.ptyRecycle, persistKey) as Promise<void>,
    // No server handler — degrade gracefully (never reject the boot path).
    generateName: () => Promise.resolve({ ...AI_NAMING_UNAVAILABLE, message: mapLocalVocabularyText(AI_NAMING_UNAVAILABLE.message) }),
    generateGroupName: () => Promise.resolve({ ...AI_NAMING_UNAVAILABLE, message: mapLocalVocabularyText(AI_NAMING_UNAVAILABLE.message) }),
    capture: (persistKey, full) =>
      client.request(IPC.ptyCapture, persistKey, full).catch(() => '') as Promise<string>,
    readScrollback: (persistKey) =>
      client.request(IPC.ptyReadScrollback, persistKey) as Promise<string>,
    sendText: (persistKey, text, opts) =>
      client.request(IPC.ptySendText, persistKey, text, opts?.enter) as Promise<boolean>,
    // Fail-open: an errored status must not raise the banner in the browser.
    tmuxStatus: () =>
      client
        .request(IPC.ptyTmuxStatus)
        .catch(() => ({ available: true, installCommand: null, installLabel: null, platform: null })) as Promise<TmuxStatus>,
    // Unknown on failure (null), never a rejection: the restart poller reads null as "not a
    // shell yet" and gives up on its own deadline.
    paneCommand: (persistKey) =>
      client.request(IPC.ptyPaneCommand, persistKey).catch(() => null) as Promise<string | null>,
    // REAL: PtyManager (core) registers this handler in both the Electron main process and the
    // Server Edition, so the server genuinely serves it — not a stub. Failure reads as "nothing
    // acted" (false), never a rejection: a poller must never treat a dropped connection as a
    // reason to stop polling.
    correctTeamLeadPaneWidth: (persistKey) =>
      client.request(IPC.ptyCorrectTeamPaneWidth, persistKey).catch(() => false) as Promise<boolean>,
    terminateForeground: (persistKey, expectedAgentId) =>
      client.request(IPC.ptyTerminateForeground, persistKey, expectedAgentId).catch(() => false) as Promise<boolean>,
    // No server handler — the session-name poll degrades to no adopted name. A PRE-EXISTING gap,
    // and not any one agent's: `IPC.ptyReadSessionName` has never been registered server-side, so
    // claude's, grok's and gemini's read legs are equally stubbed here (the write leg works on both
    // surfaces — it goes through pty.sendText). The routing itself is already in core
    // (`core/agent-session-name.ts`) and the server already threads gemini's path association into
    // its session-name SWEEP, which is what keeps the phone's names correct; only this per-node poll
    // is missing. Fixing it means registering the channel from both shells, exactly as
    // `core/transcript-ipc.ts` did for the ⌘M transcript channels.
    readSessionName: () => Promise.resolve(''),
    onData: (sessionId, listener) =>
      client.subscribe(IPC.ptyData(sessionId), listener as Listener),
    onExit: (sessionId, listener) =>
      client.subscribe(IPC.ptyExit(sessionId), listener as Listener),
    // Co-attach channels: ordinary JSON `ev` frames (only pty:data is binary), so the frame
    // decoder is unchanged — they just fan out through the generic channel subscription.
    onSize: (sessionId, listener) => client.subscribe(IPC.ptySize(sessionId), listener as Listener),
    onClosed: (sessionId, listener) =>
      client.subscribe(IPC.ptyClosed(sessionId), listener as Listener),
    onRecycled: (sessionId, listener) =>
      client.subscribe(IPC.ptyRecycled(sessionId), listener as Listener),
    onResync: (sessionId, listener) =>
      client.subscribe(IPC.ptyResync(sessionId), listener as Listener)
  }

  const workspace: WorkspaceApi = {
    load: () => client.request(IPC.workspaceLoad) as Promise<Workspace>,
    save: (ws: Workspace) => client.request(IPC.workspaceSave, ws) as Promise<void>,
    // REAL: WorkspaceStore (core) registers IPC.workspaceProbeFolder, so the server serves it.
    // Stubbing it to `null` meant "Open folder…" on a repo that already carries a committed
    // .nodeterm/project.json concluded there was no project there, created an EMPTY one, and the
    // next writeDisk() overwrote the team's shared canvas. Data loss, not a degrade.
    probeFolder: (folder: string) =>
      client.request(IPC.workspaceProbeFolder, folder) as ReturnType<WorkspaceApi['probeFolder']>,
    // REAL on Server Edition too: it's the same local core (this filesystem, this host), no
    // different from probeFolder above. An SSH-project cwd is refused by core itself since
    // splitProjectIntoParts reads a purely local path; nothing here has to special-case it.
    hasPartsManifest: (cwd: string) =>
      client.request(IPC.workspaceHasPartsManifest, cwd) as Promise<boolean>,
    splitIntoParts: (cwd: string, sizeValue: number, sizeUnit: 'KB' | 'MB' | 'GB') =>
      client.request(
        IPC.workspaceSplitIntoParts,
        cwd,
        sizeValue,
        sizeUnit
      ) as ReturnType<WorkspaceApi['splitIntoParts']>,
    joinParts: (cwd: string) =>
      client.request(IPC.workspaceJoinParts, cwd) as ReturnType<WorkspaceApi['joinParts']>,
    exportProject: async () => ({
      ok: false,
      error: mapLocalVocabularyText('Project archive export is available in the Windows desktop app.')
    }),
    importProject: async () => ({
      ok: false,
      error: mapLocalVocabularyText('Project archive import is available in the Windows desktop app.')
    }),
    portableMedia: {
      prepare: async () => ({
        ok: false,
        error: mapLocalVocabularyText('Portable media preparation is available in the Windows desktop app.')
      }),
      discard: async () => false
    },
    portableBindings: {
      state: (input) => client.request(IPC.portableBindingState, input) as ReturnType<WorkspaceApi['portableBindings']['state']>,
      apply: (input) => client.request(IPC.portableBindingApply, input) as ReturnType<WorkspaceApi['portableBindings']['apply']>
    },
    onArchiveProgress: () => () => {},
    cancelArchiveImport: async () => false,
    // Archive save/open are desktop-only here, so their password prompt — and therefore its
    // ladder — cannot be reached in the browser at all. No wait exists to end.
    archiveLadderIssue: async () => ({ challenge: null, budgetLeft: 0, waitMs: 0 }),
    archiveLadderVerify: async () => ({
      cleared: false,
      next: null,
      budgetLeft: 0,
      waitMs: 0,
      challenge: null,
      message: mapLocalVocabularyText('Project archives are available in the Windows desktop app.')
    }),
    // REAL for the same reason: core registers IPC.workspaceProjectFileState, and a stub would
    // have to answer 'unreadable' — which is the side that never recovers a deleted project file.
    projectFileState: (folder: string) =>
      client.request(IPC.workspaceProjectFileState, folder) as ReturnType<
        WorkspaceApi['projectFileState']
      >,
    // REAL: core broadcasts IPC.workspaceMigrated after a v2→v3 migration (workspace-store.ts).
    onMigrated: (cb) => client.subscribe(IPC.workspaceMigrated, cb as Listener),
    // REAL: core broadcasts IPC.workspaceCorruptRecovered from the load path (workspace-store.ts).
    onCorruptRecovered: (cb) => client.subscribe(IPC.workspaceCorruptRecovered, cb as Listener),
    // Deliberate degrade: the external-change WATCHER (core/workspace-watcher.ts) is only started
    // by the desktop shell (src/main/index.ts), so the server never broadcasts
    // IPC.workspaceExternalChange and there is nothing to subscribe to. Effect in the browser:
    // an outside edit (git pull / a teammate's push) is not picked up until reload — no silent
    // data loss (the store's own rev reconciliation still guards writes). Booting the watcher in
    // src/server is the follow-up.
    onExternalChange: () => () => {}
  }

  const timer: TimerApi = {
    occurrences: () => client.request(IPC.timerOccurrencesLoad) as Promise<import('../../shared/timer').TimerOccurrence[]>,
    schedule: (timerId, scheduledAt) => client.request(IPC.timerOccurrenceSchedule, timerId, scheduledAt) as Promise<import('../../shared/timer').TimerOccurrence | null>,
    transition: (id, state) => client.request(IPC.timerOccurrenceTransition, id, state) as Promise<import('../../shared/timer').TimerOccurrence | null>,
    lap: (id, elapsedMs) => client.request(IPC.timerOccurrenceLap, id, elapsedMs) as Promise<number[] | null>
  }
  const trigger: NonNullable<NodeTerminalApi['trigger']> = {
    status: (projectId, nodeId) => client.request(IPC.triggerStatus, projectId, nodeId) as ReturnType<NonNullable<NodeTerminalApi['trigger']>['status']>,
    arm: (projectId, nodeId, spec) => client.request(IPC.triggerArm, projectId, nodeId, spec) as ReturnType<NonNullable<NodeTerminalApi['trigger']>['arm']>,
    disarm: (projectId, nodeId) => client.request(IPC.triggerDisarm, projectId, nodeId) as ReturnType<NonNullable<NodeTerminalApi['trigger']>['disarm']>,
    runNow: (projectId, nodeId) => client.request(IPC.triggerRunNow, projectId, nodeId) as ReturnType<NonNullable<NodeTerminalApi['trigger']>['runNow']>,
    history: (projectId, nodeId) => client.request(IPC.triggerHistory, projectId, nodeId) as ReturnType<NonNullable<NodeTerminalApi['trigger']>['history']>,
    onChanged: (listener) => client.subscribe(IPC.triggerChanged, listener as Listener)
  }
  // REAL: WorkspaceStore (core) registers the project-settings:* channels too — same
  // registerIpc() call as workspace above — so the server serves this on both shells.
  const projectSettings: NodeTerminalApi['projectSettings'] = {
    read: (projectId) =>
      client.request(IPC.projectSettingsRead, projectId) as ReturnType<
        NodeTerminalApi['projectSettings']['read']
      >,
    writeShared: (projectId, doc) =>
      client.request(IPC.projectSettingsWriteShared, projectId, doc) as Promise<boolean>,
    updateLocal: (projectId, local) =>
      client.request(IPC.projectSettingsUpdateLocal, projectId, local) as Promise<boolean>,
    launchInfo: (projectId) =>
      client.request(IPC.projectSettingsLaunchInfo, projectId) as ReturnType<
        NodeTerminalApi['projectSettings']['launchInfo']
      >,
    // REAL: `ProjectSetupService.ensureFamilyTrusted` broadcasts IPC.projectTrustChanged on every
    // approval, for each project id that asked.
    onTrustChanged: (cb) => client.subscribe(IPC.projectTrustChanged, cb as Listener)
  }

  // REAL: registerProjectSetupHandlers (core) is wired on the same construction-order point as
  // src/main/index.ts. Wire carries exactly `(projectId, kind, worktreePath?)` — no rootPath/
  // projectName/ssh; the server derives those itself from its own workspace index, same as main.
  const projectSetup: NodeTerminalApi['projectSetup'] = {
    run: (projectId, kind, worktreePath) =>
      client.request(IPC.projectSetupRun, projectId, kind, worktreePath) as ReturnType<
        NodeTerminalApi['projectSetup']['run']
      >,
    cancel: (runKey) => client.request(IPC.projectSetupCancel, runKey) as Promise<boolean>,
    consent: async (requestId, answer) => {
      client.cast(IPC.projectSetupConsentSubmit, requestId, answer)
    },
    // Fails CLOSED on a rejection rather than throwing at the caller: over the relay this method is
    // host-only, so a guest's call comes back E_FORBIDDEN — and "not trusted" is exactly the right
    // answer for a client that may not raise the host's dialog.
    requestTrust: (projectId, family) =>
      client.request(IPC.projectSetupRequestTrust, projectId, family).then(
        (v) => v === true,
        () => false
      ),
    onConsentRequest: (cb) => client.subscribe(IPC.projectSetupConsentRequest, cb as Listener),
    onConsentDismiss: (cb) => client.subscribe(IPC.projectSetupConsentDismiss, cb as Listener),
    onEvent: (projectId, cb) => {
      const unsub = client.subscribe(IPC.projectSetupEvent(projectId), cb as Listener)
      client.cast(IPC.projectSetupSubscribe, projectId)
      return () => {
        unsub()
        client.cast(IPC.projectSetupUnsubscribe, projectId)
      }
    }
  }

  // REAL: registerWorktreeSharedPathsHandlers (core), same construction point as main/server. Wire
  // carries exactly `(projectId, worktreePath)`; the server reads the sharedPaths list itself.
  const worktree: NodeTerminalApi['worktree'] = {
    materializeShared: (projectId, worktreePath) =>
      client.request(IPC.worktreeMaterializeShared, projectId, worktreePath) as ReturnType<
        NodeTerminalApi['worktree']['materializeShared']
      >
  }

  const settings: SettingsApi = {
    load: () => client.request(IPC.settingsLoad) as Promise<Settings>,
    save: (s: Settings) => client.request(IPC.settingsSave, s) as Promise<void>
  }

  // School mode is APP-GLOBAL like `settings` (it describes THIS machine, shared across whatever
  // local apps read `~/.nodeterm/shared/`), so the Server Edition serves the same real handlers
  // core/school-mode.ts registers on every shell.
  const schoolMode: SchoolModeApi = {
    load: () => client.request(IPC.schoolModeLoad) as Promise<SchoolModeRecord>,
    enable: (pin?: string) => client.request(IPC.schoolModeEnable, pin) as Promise<SchoolModeRecord>,
    disable: (pin: string) =>
      client.request(IPC.schoolModeDisable, pin) as ReturnType<SchoolModeApi['disable']>,
    rename: (name: string) => client.request(IPC.schoolModeRename, name) as Promise<SchoolModeRecord>,
    changePin: (currentPin: string, nextPin: string) =>
      client.request(IPC.schoolModeChangePin, currentPin, nextPin) as Promise<boolean>,
    hasCredential: () => client.request(IPC.schoolModeHasCredential) as Promise<boolean>,
    onChanged: (cb) => client.subscribe(IPC.schoolModeChanged, cb as Listener)
  }

  const kidsMode: KidsModeApi = {
    load: () => client.request(IPC.kidsModeLoad) as Promise<KidsModeSnapshot>,
    enable: (pin?: string) => client.request(IPC.kidsModeEnable, pin) as Promise<KidsModeSnapshot>,
    disable: (pin: string) =>
      client.request(IPC.kidsModeDisable, pin) as ReturnType<KidsModeApi['disable']>,
    rename: (name: string) => client.request(IPC.kidsModeRename, name) as Promise<KidsModeSnapshot>,
    changePin: (currentPin: string, nextPin: string) =>
      client.request(IPC.kidsModeChangePin, currentPin, nextPin) as Promise<boolean>,
    hasCredential: () => client.request(IPC.kidsModeHasCredential) as Promise<boolean>,
    onChanged: (cb) => client.subscribe(IPC.kidsModeChanged, cb as Listener)
  }

  const scheduledSettings: ScheduledSettingsApi = {
    load: () => client.request(IPC.scheduledSettingsLoad) as Promise<ScheduledSettingsLoadState>,
    save: (file: ScheduledSettingsFile) =>
      client.request(IPC.scheduledSettingsSave, file) as ReturnType<ScheduledSettingsApi['save']>,
    setHomeAssistantToken: (ruleId: string, token: string | null) =>
      client.request(IPC.scheduledSettingsSetHaToken, ruleId, token) as Promise<void>,
    tokenStatus: () => client.request(IPC.scheduledSettingsTokenStatus) as Promise<Record<string, boolean>>,
    refreshRule: (ruleId: string) => client.request(IPC.scheduledSettingsRefreshRule, ruleId) as Promise<void>,
    activeState: () =>
      client.request(IPC.scheduledSettingsActiveState) as Promise<ScheduledSettingsActiveState>,
    onActiveChange: (cb) => client.subscribe(IPC.scheduledSettingsActiveChange, cb as Listener)
  }
  const planner: PlannerApi = {
    load: () => client.request(IPC.plannerLoad) as Promise<PlannerLoadState>,
    save: (file: PlannerFile) => client.request(IPC.plannerSave, file) as ReturnType<PlannerApi['save']>,
    history: () => client.request(IPC.plannerHistory) as Promise<PlannerOccurrence[]>,
    export: (format) => client.request(IPC.plannerExport, format) as ReturnType<PlannerApi['export']>,
    configure: (schedules) => client.request(IPC.plannerConfigure, schedules) as ReturnType<PlannerApi['configure']>,
    onOccurrence: (cb) => client.subscribe(IPC.plannerOccurrence, cb as Listener)
  }
  const agent: NodeTerminalApi['agent'] = {
    // Deliberately NOT a request: the server registers no env-snapshot handler (a full host-env
    // dump answerable by any authenticated WS client is the PR #195 leak class at the RPC layer).
    // An empty snapshot makes `${env:VAR}` expansion surface every referenced var as missing, and
    // the launch paths refuse rather than type a mangled line.
    envSnapshot: () => Promise.resolve({}),
    discoverModels: (gateway) =>
      client.request(IPC.agentDiscoverModels, gateway) as ReturnType<
        NodeTerminalApi['agent']['discoverModels']
      >,
    gatewayCredentialStatus: () =>
      client.request(IPC.agentGatewayCredentialStatus) as ReturnType<
        NodeTerminalApi['agent']['gatewayCredentialStatus']
      >,
    saveGatewayCredential: (apiKey) =>
      client.request(IPC.agentGatewayCredentialSave, apiKey) as ReturnType<
        NodeTerminalApi['agent']['saveGatewayCredential']
      >,
    clearGatewayCredential: () =>
      client.request(IPC.agentGatewayCredentialClear) as ReturnType<
        NodeTerminalApi['agent']['clearGatewayCredential']
      >
  }

  // The server's data dir, over the SAME channel the desktop preload uses. It is the writable base
  // the worktree dialog derives its default path from — a stub returning '' would suggest
  // `/worktrees/…` at the filesystem root (the server usually runs as root, and git would create it).
  const userDataDir = (): Promise<string> => client.request(IPC.appUserDataDir) as Promise<string>

  const serverDeployment = {
    start: async () => ({
      ok: false,
      state: 'failed' as const,
      error: mapLocalVocabularyText('Deployment is controlled by the Windows desktop app.')
    }),
    currentTotp: async () => '',
    status: async () => ({ running: false }),
    onProgress: () => () => {}
  }
  return {
    pty, workspace, timer, trigger, serverDeployment, settings, schoolMode, kidsMode,
    scheduledSettings, planner, projectSettings, projectSetup, worktree, agent, userDataDir
  }
}

export function buildGitHubApi(
  client: RpcClient
): Pick<NodeTerminalApi, 'githubIssues' | 'githubControl' | 'githubApi' | 'githubCliAccounts'> {
  const githubIssues: GitHubIssuesApi = {
    subscribe: (projectId) =>
      client.request(IPC.githubIssuesSubscribe, { projectId }) as ReturnType<
        GitHubIssuesApi['subscribe']
      >,
    unsubscribe: async (projectId) => {
      client.cast(IPC.githubIssuesUnsubscribe, projectId)
    },
    query: (request) =>
      client.request(IPC.githubIssuesQuery, request) as ReturnType<GitHubIssuesApi['query']>,
    refresh: (projectId, full) =>
      client.request(IPC.githubIssuesRefresh, projectId, full) as Promise<void>,
    moveIssue: (request) =>
      client.request(IPC.githubIssuesMove, request) as ReturnType<GitHubIssuesApi['moveIssue']>,
    createMissingLabels: (projectId) =>
      client.request(IPC.githubIssuesCreateLabels, projectId) as ReturnType<
        GitHubIssuesApi['createMissingLabels']
      >,
    clearCache: (projectId) =>
      client.request(IPC.githubIssuesClearCache, projectId) as Promise<void>,
    projectAvatar: (projectId) =>
      client.request(IPC.githubProjectAvatar, projectId) as ReturnType<
        GitHubIssuesApi['projectAvatar']
      >,
    onChanged: (projectId, listener) =>
      client.subscribe(IPC.githubIssuesChanged(projectId), listener as Listener)
  }

  const githubControl: GitHubControlApi = {
    status: (projectId) =>
      client.request(IPC.githubControlStatus, projectId) as ReturnType<GitHubControlApi['status']>,
    approve: (input) =>
      client.request(IPC.githubControlApprove, input) as ReturnType<GitHubControlApi['approve']>,
    revoke: (input) =>
      client.request(IPC.githubControlRevoke, input) as ReturnType<GitHubControlApi['revoke']>,
    selectProvider: (input) =>
      client.request(IPC.githubControlSelectProvider, input) as ReturnType<
        GitHubControlApi['selectProvider']
      >,
    saveToken: (token) =>
      client.request(IPC.githubControlSaveToken, token) as ReturnType<GitHubControlApi['saveToken']>,
    clearToken: () =>
      client.request(IPC.githubControlClearToken) as ReturnType<GitHubControlApi['clearToken']>
  }

  const githubApi: GitHubApiApi = {
    capabilities: () => client.request(IPC.githubApiCapabilities) as ReturnType<GitHubApiApi['capabilities']>,
    execute: (request: GitHubApiRequest) =>
      client.request(IPC.githubApiExecute, request) as ReturnType<GitHubApiApi['execute']>,
    cancel: (operationId: string) =>
      client.request(IPC.githubApiCancel, operationId) as ReturnType<GitHubApiApi['cancel']>,
    onProgress: (listener: (progress: GitHubApiProgress) => void) =>
      client.subscribe(IPC.githubApiProgress, listener as Listener)
  }

  const githubCliAccounts: GitHubCliAccountsApi = {
    list: () => client.request(IPC.githubCliAccountsList) as ReturnType<GitHubCliAccountsApi['list']>,
    switchActive: (host, login) => client.request(IPC.githubCliAccountsSwitch, host, login) as ReturnType<GitHubCliAccountsApi['switchActive']>,
    signOut: (host, login) => client.request(IPC.githubCliAccountsSignOut, host, login) as ReturnType<GitHubCliAccountsApi['signOut']>,
    startLogin: () => client.request(IPC.githubCliAccountsStartLogin) as ReturnType<GitHubCliAccountsApi['startLogin']>,
    loginStatus: (id) => client.request(IPC.githubCliAccountsLoginStatus, id) as ReturnType<GitHubCliAccountsApi['loginStatus']>,
    cancelLogin: (id) => client.request(IPC.githubCliAccountsCancelLogin, id) as ReturnType<GitHubCliAccountsApi['cancelLogin']>,
    refreshAuthorization: (input) => client.request(IPC.githubCliAccountsRefresh, input) as ReturnType<GitHubCliAccountsApi['refreshAuthorization']>
  }

  return { githubIssues, githubControl, githubApi, githubCliAccounts }
}

export function buildProviderServicesApi(
  client: RpcClient
): Pick<NodeTerminalApi, 'providerServices'> {
  return {
    providerServices: {
      catalog: () => client.request(IPC.providerCatalog) as ReturnType<NodeTerminalApi['providerServices']['catalog']>,
      accounts: (providerId) => client.request(IPC.providerAccounts, providerId) as ReturnType<NodeTerminalApi['providerServices']['accounts']>,
      resources: (accountId, capability) => client.request(IPC.providerResources, accountId, capability) as ReturnType<NodeTerminalApi['providerServices']['resources']>,
      beginOAuth: (providerId) => client.request(IPC.providerBeginOAuth, providerId) as ReturnType<NodeTerminalApi['providerServices']['beginOAuth']>,
      completeOAuth: (callbackUrl) => client.request(IPC.providerCompleteOAuth, callbackUrl) as ReturnType<NodeTerminalApi['providerServices']['completeOAuth']>,
      removeAccount: (accountId) => client.request(IPC.providerRemoveAccount, accountId) as ReturnType<NodeTerminalApi['providerServices']['removeAccount']>
    }
  }
}

/** Cloudflare Tunnel inventory uses the same host-owned core seam in Desktop and Server Edition. */
export function buildCloudflareTunnelApi(client: RpcClient): Pick<NodeTerminalApi, 'cloudflareTunnels'> {
  const cloudflareTunnels: CloudflareTunnelApi = {
    zones: (accountId) => client.request(IPC.cloudflareTunnelZones, accountId) as ReturnType<CloudflareTunnelApi['zones']>,
    inventory: (accountId, zoneId) => client.request(IPC.cloudflareTunnelInventory, accountId, zoneId) as ReturnType<CloudflareTunnelApi['inventory']>,
    planRoute: (input) => client.request(IPC.cloudflareTunnelPlanRoute, input) as ReturnType<CloudflareTunnelApi['planRoute']>,
    planDnsAdoption: (input) => client.request(IPC.cloudflareTunnelPlanDnsAdoption, input) as ReturnType<CloudflareTunnelApi['planDnsAdoption']>,
    saveRoute: (input) => client.request(IPC.cloudflareTunnelSaveRoute, input) as ReturnType<CloudflareTunnelApi['saveRoute']>,
    adoptDnsRecord: (input) => client.request(IPC.cloudflareTunnelAdoptDnsRecord, input) as ReturnType<CloudflareTunnelApi['adoptDnsRecord']>,
    cancel: (operationId) => client.cast(IPC.cloudflareTunnelCancel, operationId),
    onProgress: (listener) => client.subscribe(IPC.cloudflareTunnelProgress, listener as Listener)
  }
  return { cloudflareTunnels }
}
/** Server Edition callback completion stays host-local and is scoped to this authenticated WS UI. */
export function buildRemoteOAuthApi(client: RpcClient): Pick<NodeTerminalApi, 'remoteOAuth'> {
  const remoteOAuth: RemoteOAuthApi = {
    arm: (input) => client.request(IPC.remoteOAuthArm, input) as ReturnType<RemoteOAuthApi['arm']>,
    complete: (callbackUrl) => client.request(IPC.remoteOAuthComplete, callbackUrl) as ReturnType<RemoteOAuthApi['complete']>,
    cancel: () => client.request(IPC.remoteOAuthCancel) as ReturnType<RemoteOAuthApi['cancel']>
  }
  return { remoteOAuth }
}

/**
 * Build the real `fs` / `git` / `files` / `context` namespaces over an RpcClient, mirroring the
 * preload's invoke(→request) / send(→cast) / on*(→subscribe) split member-for-member. Every
 * `fs.*`, `git.*`, `files.quickOpen` and `git.generateMessage` member is an `invoke` in the
 * preload → `client.request`; `context.ensure` is a `send` → `client.cast`; the event-shaped
 * `git.onCloneProgress` / `context.onUpdate` are `.on` → `client.subscribe`. `git.generateMessage`
 * routes over `IPC.commitGenerate` (not a git:* channel) exactly as the preload does. Each namespace
 * is declared against its `NodeTerminalApi` slice so `satisfies` makes the compiler the completeness
 * gate: a missing or misnamed member fails typecheck.
 */
export function buildFilesApi(
  client: RpcClient
): Pick<NodeTerminalApi, 'fs' | 'git' | 'files' | 'context' | 'boardLog' | 'logs'> {
  const fs: FsApi = {
    list: (dirPath) => client.request(IPC.fsList, dirPath) as ReturnType<FsApi['list']>,
    read: (filePath) => client.request(IPC.fsRead, filePath) as Promise<string>,
    readBinary: (filePath) => client.request(IPC.fsReadBinary, filePath) as Promise<string>,
    write: (filePath, content) => client.request(IPC.fsWrite, filePath, content) as Promise<boolean>,
    mkdir: (dirPath) => client.request(IPC.fsMkdir, dirPath) as Promise<boolean>,
    exists: (p) => client.request(IPC.fsExists, p) as Promise<boolean>
  }

  const git: GitApi = {
    status: (cwd) => client.request(IPC.gitStatus, cwd) as ReturnType<GitApi['status']>,
    init: (cwd) => client.request(IPC.gitInit, cwd) as ReturnType<GitApi['init']>,
    clone: (parentDir, url) =>
      client.request(IPC.gitClone, parentDir, url) as ReturnType<GitApi['clone']>,
    cloneAbort: () => client.request(IPC.gitCloneAbort) as Promise<void>,
    cloneDefaultParent: () => client.request(IPC.gitCloneDefaultParent) as Promise<string>,
    onCloneProgress: (listener) => client.subscribe(IPC.gitCloneProgress, listener as Listener),
    commit: (cwd, message) =>
      client.request(IPC.gitCommit, cwd, message) as ReturnType<GitApi['commit']>,
    push: (cwd) => client.request(IPC.gitPush, cwd) as ReturnType<GitApi['push']>,
    pull: (cwd) => client.request(IPC.gitPull, cwd) as ReturnType<GitApi['pull']>,
    sync: (cwd) => client.request(IPC.gitSync, cwd) as ReturnType<GitApi['sync']>,
    publish: (cwd, name, isPrivate) =>
      client.request(IPC.gitPublish, cwd, name, isPrivate) as ReturnType<GitApi['publish']>,
    stage: (cwd, paths) => client.request(IPC.gitStage, cwd, paths) as ReturnType<GitApi['stage']>,
    unstage: (cwd, paths) =>
      client.request(IPC.gitUnstage, cwd, paths) as ReturnType<GitApi['unstage']>,
    stageAll: (cwd) => client.request(IPC.gitStageAll, cwd) as ReturnType<GitApi['stageAll']>,
    unstageAll: (cwd) => client.request(IPC.gitUnstageAll, cwd) as ReturnType<GitApi['unstageAll']>,
    diff: (cwd, path, staged, untracked) =>
      client.request(IPC.gitDiff, cwd, path, staged, untracked) as Promise<string>,
    discard: (cwd, path, untracked) =>
      client.request(IPC.gitDiscard, cwd, path, untracked) as ReturnType<GitApi['discard']>,
    switchBranch: (cwd, name) =>
      client.request(IPC.gitSwitchBranch, cwd, name) as ReturnType<GitApi['switchBranch']>,
    createBranch: (cwd, name) =>
      client.request(IPC.gitCreateBranch, cwd, name) as ReturnType<GitApi['createBranch']>,
    showFile: (cwd, ref, path) =>
      client.request(IPC.gitShowFile, cwd, ref, path) as Promise<string>,
    generateMessage: (cwd) =>
      client.request(IPC.commitGenerate, cwd) as ReturnType<GitApi['generateMessage']>,
    history: (cwd, options) =>
      client.request(IPC.gitHistory, cwd, options) as ReturnType<GitApi['history']>,
    commitFiles: (cwd, oid) =>
      client.request(IPC.gitCommitFiles, cwd, oid) as ReturnType<GitApi['commitFiles']>,
    remoteCommitUrl: (cwd, sha) =>
      client.request(IPC.gitRemoteCommitUrl, cwd, sha) as Promise<string | null>,
    merge: (cwd, ref) => client.request(IPC.gitMerge, cwd, ref) as ReturnType<GitApi['merge']>,
    rebase: (cwd, onto) => client.request(IPC.gitRebase, cwd, onto) as ReturnType<GitApi['rebase']>,
    deleteBranch: (cwd, name, force) =>
      client.request(IPC.gitDeleteBranch, cwd, name, force) as ReturnType<GitApi['deleteBranch']>,
    renameBranch: (cwd, newName) =>
      client.request(IPC.gitRenameBranch, cwd, newName) as ReturnType<GitApi['renameBranch']>,
    fetch: (cwd) => client.request(IPC.gitFetch, cwd) as ReturnType<GitApi['fetch']>,
    forcePush: (cwd) => client.request(IPC.gitForcePush, cwd) as ReturnType<GitApi['forcePush']>,
    stashPush: (cwd) => client.request(IPC.gitStashPush, cwd) as ReturnType<GitApi['stashPush']>,
    stashPop: (cwd) => client.request(IPC.gitStashPop, cwd) as ReturnType<GitApi['stashPop']>,
    revert: (cwd, oid) => client.request(IPC.gitRevert, cwd, oid) as ReturnType<GitApi['revert']>,
    branchAt: (cwd, name, oid) =>
      client.request(IPC.gitBranchAt, cwd, name, oid) as ReturnType<GitApi['branchAt']>,
    checkoutCommit: (cwd, oid) =>
      client.request(IPC.gitCheckoutCommit, cwd, oid) as ReturnType<GitApi['checkoutCommit']>,
    repoRoot: (cwd) => client.request(IPC.gitRepoRoot, cwd) as Promise<string | null>,
    discoverNestedRepos: (cwd) =>
      client.request(IPC.gitDiscoverNestedRepos, cwd) as ReturnType<GitApi['discoverNestedRepos']>,
    worktreeList: (repoPath) =>
      client.request(IPC.gitWorktreeList, repoPath) as ReturnType<GitApi['worktreeList']>,
    worktreeAdd: (repoPath, wtPath, branch, baseRef, isNew) =>
      client.request(
        IPC.gitWorktreeAdd,
        repoPath,
        wtPath,
        branch,
        baseRef,
        isNew
      ) as ReturnType<GitApi['worktreeAdd']>,
    worktreeMerge: (repoPath, branch, baseRef, push) =>
      client.request(
        IPC.gitWorktreeMerge,
        repoPath,
        branch,
        baseRef,
        push
      ) as ReturnType<GitApi['worktreeMerge']>,
    worktreeRemovalProof: (repoPath, wtPath) =>
      client.request(
        IPC.gitWorktreeRemovalProof,
        repoPath,
        wtPath
      ) as ReturnType<GitApi['worktreeRemovalProof']>,
    worktreeRemove: (repoPath, wtPath, request) =>
      client.request(
        IPC.gitWorktreeRemove,
        repoPath,
        wtPath,
        request
      ) as ReturnType<GitApi['worktreeRemove']>,
    setBranchParent: (repoPath, child, parent) =>
      client.request(IPC.gitSetBranchParent, repoPath, child, parent) as ReturnType<GitApi['setBranchParent']>,
    unsetBranchParent: (repoPath, child) =>
      client.request(IPC.gitUnsetBranchParent, repoPath, child) as ReturnType<GitApi['unsetBranchParent']>,
    syncBranch: (cwd, child) =>
      client.request(IPC.gitSyncBranch, cwd, child) as ReturnType<GitApi['syncBranch']>,
    proposeBranch: (cwd, child) =>
      client.request(IPC.gitProposeBranch, cwd, child) as ReturnType<GitApi['proposeBranch']>,
    shipBranch: (cwd, child, parent) =>
      client.request(IPC.gitShipBranch, cwd, child, parent) as ReturnType<GitApi['shipBranch']>,
    dependencyOperation: (request) =>
      client.request(IPC.gitDependencyOperation, request) as ReturnType<GitApi['dependencyOperation']>,
    cancelDependencyOperation: (operationId) =>
      client.request(IPC.gitDependencyCancel, operationId) as ReturnType<GitApi['cancelDependencyOperation']>,
    onDependencyOperationProgress: (listener) =>
      client.subscribe(IPC.gitDependencyProgress, listener as Listener),
    setActiveRemote: (projectId) =>
      client.request(IPC.gitSetActiveRemote, projectId) as Promise<void>
  }

  const files: FilesApi = {
    quickOpen: (cwd) => client.request(IPC.filesQuickOpen, cwd) as Promise<string[]>,
    // A REAL implementation, not a stub: this is the browser's only way to get a file off the
    // server, and it deliberately does not stream through this socket — it mints a ticket the
    // browser redeems with a plain GET (src/server/download.ts).
    downloadTicket: (p) => client.request(IPC.filesDownloadTicket, p) as Promise<DownloadTicket | null>,
    // This default MUST remain RPC: buildRelayApi shares this builder, and same-origin HTTP there
    // would write to the viewer's machine instead of the relay host.
    saveUpload: (name, dataBase64) =>
      client.request(IPC.filesSaveUpload, name, dataBase64) as Promise<string | null>,
    // Real too, and for the same reason: the browser holds the bytes and the project folder is on
    // the server, so only the server can put a canvas image where the canvas will find it again.
    saveCanvasImage: (projectId, name, dataBase64) =>
      client.request(IPC.filesSaveCanvasImage, projectId, name, dataBase64) as Promise<
        string | null
      >
  }

  const context: ContextApi = {
    onUpdate: (listener) => client.subscribe(IPC.contextUpdate, listener as Listener),
    ensure: (sessionId, cwd, accountId, agentId) =>
      client.cast(IPC.contextEnsure, sessionId, cwd, accountId, agentId)
  }

  // Board-log: REAL over the bridge for local projects (the server routes local; SSH projects on the
  // server answer `unsupported`). `onChanged` is `.on` → subscribe, plus the ref-counted cast pair the
  // preload sends so the server starts/stops watching this project's log.
  const boardLog: BoardLogApi = {
    append: (projectId, entry) =>
      client.request(IPC.boardLogAppend, projectId, entry) as Promise<boolean>,
    appendWithAttachments: (projectId, entry, attachments) =>
      client.request(IPC.boardLogAppendWithAttachments, projectId, entry, attachments) as Promise<import('@shared/comment-attachments').BoardLogAppendResult>,
    readAttachment: (projectId, attachment) =>
      client.request(IPC.boardLogReadAttachment, projectId, attachment) as Promise<import('@shared/comment-attachments').BoardAttachmentReadResult>,
    read: (projectId, opts) =>
      client.request(IPC.boardLogRead, projectId, opts) as Promise<BoardLogReadResult>,
    onChanged: (projectId, cb) => {
      const unsub = client.subscribe(IPC.boardLogChanged(projectId), cb as Listener)
      client.cast(IPC.boardLogSubscribe, projectId)
      return () => {
        unsub()
        client.cast(IPC.boardLogUnsubscribe, projectId)
      }
    }
  }

  // Same core on the server, so the log ring is real over the bridge — the panel debugs the
  // Server Edition process, which is exactly where a packaged-app console is least visible.
  const logs: LogApi = {
    snapshot: () => client.request(IPC.logSnapshot) as Promise<LogRecord[]>,
    clear: () => client.cast(IPC.logClear),
    onBatch: (cb) => {
      const unsub = client.subscribe(IPC.logBatch, cb as Listener)
      client.cast(IPC.logSubscribe)
      return () => {
        unsub()
        client.cast(IPC.logUnsubscribe)
      }
    }
  }

  return { fs, git, files, context, boardLog, logs }
}

/** Server Edition specialization: raw HTTP for upload bytes, RPC for the other file operations. */
export function buildServerFilesApi(
  client: RpcClient
): Pick<NodeTerminalApi, 'fs' | 'git' | 'files' | 'context' | 'boardLog' | 'logs'> {
  const api = buildFilesApi(client)
  return {
    ...api,
    files: {
      ...api.files,
      // Only a browser served by this machine may use same-origin HTTP. Relays keep the RPC
      // implementation above so an upload can never escape to the viewing machine.
      saveUpload: saveUploadOverHttp,
      saveUploadBlob: saveUploadBlobOverHttp
    }
  }
}

/**
 * Build the top-level agent-event subscriptions (`onAgentStatus` / `onSubagentActivity`) over an
 * RpcClient. These mirror the preload's `.on(channel, …)` → `client.subscribe(channel, …)` split:
 * each takes a listener and returns an unsubscribe. Declared against its `NodeTerminalApi` slice so
 * `satisfies` keeps the compiler as the completeness gate.
 */
export function buildAgentApi(
  client: RpcClient
): Pick<
  NodeTerminalApi,
  | 'onAgentStatus'
  | 'agentStatusSnapshot'
  | 'onSubagentActivity'
  | 'onUnreadClear'
  | 'answerPermission'
  | 'ackDone'
> {
  return {
    onAgentStatus: (listener) => client.subscribe(IPC.agentStatus, listener as Listener),
    agentStatusSnapshot: () =>
      client.request(IPC.agentStatusSnapshot) as ReturnType<NodeTerminalApi['agentStatusSnapshot']>,
    // Host swept a phone read-ack → drop this browser canvas's unread flag (external clear, no re-ack).
    onUnreadClear: (listener) => client.subscribe(IPC.agentUnreadClear, listener as Listener),
    onSubagentActivity: (listener) =>
      client.subscribe(IPC.agentSubagentActivity, listener as Listener),
    // Deterministic hook-reply approvals: a real request over the bridge — the Server Edition runs
    // ON the host, so a local project's answer file is written right there (SSH-from-server is v1
    // unsupported and the handler returns false). See docs/hook-reply-approvals.md.
    answerPermission: (payload) =>
      client.request(IPC.agentAnswerPermission, payload) as Promise<boolean>,
    // Read-a-finished-session ack: a real fire-and-forget request over the bridge — the browser
    // canvas runs ON the host, so the server's mirror acks the done event + re-sends the 'end'
    // live-update to the paired phone, same as desktop. See agent-status-mirror `ackDone`.
    ackDone: (nodeId) => {
      void client.request(IPC.agentAckDone, nodeId)
    }
  }
}

/**
 * Build the `canvas` namespace over an RpcClient: a cast out (`canvas:mut`) and a subscription in on
 * the same channel. The server stamps each mutation with the total order (`seq`) and reflects it to
 * every client, us included — our own frame coming back is the ACK that carries our place in that
 * order (the renderer recognizes it by `src`; see src/shared/canvas-order.ts). This is a REAL
 * implementation, not a stub:
 * the Server Edition (two browsers on one workspace) is the surface that needs canvas sync most.
 */
export function buildCanvasApi(client: RpcClient): Pick<NodeTerminalApi, 'canvas'> {
  return {
    canvas: {
      mutate: (projectId, mutation) => client.cast(IPC.canvasMut, projectId, mutation),
      onMutation: (listener) => client.subscribe(IPC.canvasMut, listener as Listener)
    }
  }
}

/**
 * Build the `presence` namespace over an RpcClient, mirroring the preload's invoke(→request) /
 * send(→cast) / on(→subscribe) split member-for-member: `hello` is the only request (its response
 * is how a client learns its OWN clientId), cursor/focus/chat/project are casts, and the two event
 * channels are subscriptions. Declared against its `NodeTerminalApi` slice so `satisfies` keeps
 * the compiler as the completeness gate.
 */
export function buildPresenceApi(client: RpcClient): Pick<NodeTerminalApi, 'presence'> {
  const presence: PresenceApi = {
    hello: (identity: PeerIdentity) =>
      client.request(IPC.presenceHello, identity) as ReturnType<PresenceApi['hello']>,
    cursor: (cursor) => client.cast(IPC.presenceCursor, cursor),
    focus: (nodeId) => client.cast(IPC.presenceFocus, nodeId),
    chat: (text) => client.cast(IPC.presenceChat, text),
    dino: (payload) => client.cast(IPC.presenceDino, payload),
    project: (projectId) => client.cast(IPC.presenceProject, projectId),
    onSync: (listener) => client.subscribe(IPC.presenceSync, listener as Listener),
    onPeer: (listener) => client.subscribe(IPC.presencePeer, listener as Listener)
  }
  return { presence }
}

/**
 * Build the `speech` namespace over an RpcClient — a REAL implementation (the server registers
 * `registerSpeechIpc` too; see `src/core/speech/register-ipc.ts`), not a stub. The one wire
 * difference from Electron IPC: `decodePcmPayload` (src/core/speech/pcm.ts) accepts EITHER a raw
 * Float32 ArrayBuffer (what the preload sends over structured-clone IPC) OR a base64 string of
 * little-endian Int16 samples (half the bytes over JSON) — this is the string branch, encoded by
 * the pure `encodePcmForWire` helper. `micConsent` resolves `true` locally: the browser's own
 * `getUserMedia` prompt IS the consent gate, so there is nothing for the server to answer (the
 * server-side handler for this channel is stubbed the same way — see src/server/index.ts).
 */
export function buildSpeechApi(client: RpcClient): Pick<NodeTerminalApi, 'speech'> {
  const speech: SpeechApi = {
    transcribe: (pcm, language, model) =>
      client.request(IPC.speechTranscribe, { pcm: encodePcmForWire(pcm), language, model }) as Promise<{
        text: string
      }>,
    models: () => client.request(IPC.speechModels) as Promise<SpeechModelInfo[]>,
    downloadModel: (id) => client.request(IPC.speechModelDownload, { id }) as Promise<void>,
    deleteModel: (id) => client.request(IPC.speechModelDelete, { id }) as Promise<void>,
    onProgress: (cb) => client.subscribe(IPC.speechProgress, cb as Listener),
    micConsent: () => Promise.resolve(true)
  }
  return { speech }
}

/** Universal file converter (docs/file-converter.md) — the SAME core engine as desktop, over the
 *  SAME converter:* channels; only the transport differs. */
export function buildConverterApi(client: RpcClient): Pick<NodeTerminalApi, 'converter'> {
  const converter: ConverterApi = {
    catalog: () => client.request(IPC.converterCatalog) as ReturnType<ConverterApi['catalog']>,
    detect: (path) => client.request(IPC.converterDetect, path) as ReturnType<ConverterApi['detect']>,
    preflight: (destDir) =>
      client.request(IPC.converterPreflight, destDir) as ReturnType<ConverterApi['preflight']>,
    state: (offset, limit) =>
      client.request(IPC.converterState, offset, limit) as ReturnType<ConverterApi['state']>,
    addFiles: (paths, destDir, adapterId, lossyAcknowledged) =>
      client.request(
        IPC.converterAddFiles,
        paths,
        destDir,
        adapterId,
        lossyAcknowledged
      ) as ReturnType<ConverterApi['addFiles']>,
    addFolder: (root, destDir, adapterId, opts) =>
      client.request(IPC.converterAddFolder, root, destDir, adapterId, opts) as Promise<void>,
    cancelScan: () => client.request(IPC.converterCancelScan) as Promise<void>,
    resolvePending: (ids, opts) => client.request(IPC.converterResolvePending, ids, opts) as Promise<void>,
    start: () => client.request(IPC.converterStart) as Promise<void>,
    pause: () => client.request(IPC.converterPause) as Promise<void>,
    cancelItem: (id) => client.request(IPC.converterCancelItem, id) as Promise<void>,
    cancelAll: () => client.request(IPC.converterCancelAll) as Promise<void>,
    retryItem: (id) => client.request(IPC.converterRetryItem, id) as Promise<void>,
    removeItem: (id) => client.request(IPC.converterRemoveItem, id) as Promise<void>,
    clearFinished: () => client.request(IPC.converterClearFinished) as Promise<void>,
    setConcurrency: (n) => client.request(IPC.converterSetConcurrency, n) as Promise<number>,
    onItem: (listener) => client.subscribe(IPC.converterItem, listener as Listener),
    onSummary: (listener) => client.subscribe(IPC.converterSummary, listener as Listener),
    advanced: {
      catalog: () => client.request(IPC.converterAdvancedCatalog) as ReturnType<NonNullable<ConverterApi['advanced']>['catalog']>,
      state: () => client.request(IPC.converterAdvancedState) as ReturnType<NonNullable<ConverterApi['advanced']>['state']>,
      add: (request) => client.request(IPC.converterAdvancedAdd, request) as ReturnType<NonNullable<ConverterApi['advanced']>['add']>,
      start: () => client.request(IPC.converterAdvancedStart) as Promise<void>,
      pause: () => client.request(IPC.converterAdvancedPause) as Promise<void>,
      cancel: (id) => client.request(IPC.converterAdvancedCancel, id) as Promise<void>,
      retry: (id) => client.request(IPC.converterAdvancedRetry, id) as Promise<void>,
      setConcurrency: (value) => client.request(IPC.converterAdvancedSetConcurrency, value) as Promise<number>,
      onItem: (listener) => client.subscribe(IPC.converterAdvancedItem, listener as Listener),
      onSummary: (listener) => client.subscribe(IPC.converterAdvancedSummary, listener as Listener)
    }
  }
  return { converter }
}

/** Local Ollama suite manager (docs/ollama-manager.md) — the SAME core engine as desktop; the
 *  server process is the one making the loopback calls to Ollama, exactly as main does. */
export function buildOllamaApi(client: RpcClient): Pick<NodeTerminalApi, 'ollama'> {
  const ollama: OllamaApi = {
    status: () => client.request(IPC.ollamaStatus) as ReturnType<OllamaApi['status']>,
    models: () => client.request(IPC.ollamaModels) as ReturnType<OllamaApi['models']>,
    running: () => client.request(IPC.ollamaRunning) as ReturnType<OllamaApi['running']>,
    show: (model) => client.request(IPC.ollamaShow, model) as ReturnType<OllamaApi['show']>,
    deleteModel: (model) => client.request(IPC.ollamaDelete, model) as Promise<void>,
    copyModel: (source, destination) => client.request(IPC.ollamaCopy, source, destination) as Promise<void>,
    hardware: () => client.request(IPC.ollamaHardware) as ReturnType<OllamaApi['hardware']>,
    fit: (refs) => client.request(IPC.ollamaFit, refs) as ReturnType<OllamaApi['fit']>,
    popularModels: () => client.request(IPC.ollamaPopularModels) as ReturnType<OllamaApi['popularModels']>,
    pullState: () => client.request(IPC.ollamaPullState) as ReturnType<OllamaApi['pullState']>,
    pullEnqueue: (refs) => client.request(IPC.ollamaPullEnqueue, refs) as ReturnType<OllamaApi['pullEnqueue']>,
    pullStart: () => client.request(IPC.ollamaPullStart) as Promise<void>,
    pullPause: () => client.request(IPC.ollamaPullPause) as Promise<void>,
    pullCancelItem: (id) => client.request(IPC.ollamaPullCancelItem, id) as Promise<void>,
    pullRetryItem: (id) => client.request(IPC.ollamaPullRetryItem, id) as Promise<void>,
    pullRemoveItem: (id) => client.request(IPC.ollamaPullRemoveItem, id) as Promise<void>,
    pullSetConcurrency: (n) => client.request(IPC.ollamaPullSetConcurrency, n) as Promise<number>,
    onPullItem: (listener) => client.subscribe(IPC.ollamaPullItem, listener as Listener),
    onPullSummary: (listener) => client.subscribe(IPC.ollamaPullSummary, listener as Listener),
    chatSessions: () => client.request(IPC.ollamaChatSessions) as ReturnType<OllamaApi['chatSessions']>,
    chatGet: (id) => client.request(IPC.ollamaChatGet, id) as ReturnType<OllamaApi['chatGet']>,
    chatCreate: (model, systemPrompt) =>
      client.request(IPC.ollamaChatCreate, model, systemPrompt) as ReturnType<OllamaApi['chatCreate']>,
    chatRename: (id, title) => client.request(IPC.ollamaChatRename, id, title) as Promise<boolean>,
    chatDelete: (id) => client.request(IPC.ollamaChatDelete, id) as Promise<void>,
    chatExport: (id, format) => client.request(IPC.ollamaChatExport, id, format) as Promise<string | null>,
    chatSend: (id, text) => client.request(IPC.ollamaChatSend, id, text) as Promise<void>,
    chatStop: (id) => client.request(IPC.ollamaChatStop, id) as Promise<void>,
    onChatStream: (listener) => client.subscribe(IPC.ollamaChatStream, listener as Listener)
  }
  return { ollama }
}

/** Host-owned repository graph API. The Server Edition indexes the server's own project root,
 * never the browser's filesystem, while relay sessions intentionally use the explicit stub. */
export function buildRepositoryGraphApi(client: RpcClient): Pick<NodeTerminalApi, 'repositoryGraph'> {
  const repositoryGraph: RepositoryGraphApi = {
    inspect: (projectId, mode) => client.request(IPC.repositoryGraphInspect, projectId, mode) as ReturnType<RepositoryGraphApi['inspect']>,
    refresh: (input) => client.request(IPC.repositoryGraphRefresh, input) as ReturnType<RepositoryGraphApi['refresh']>,
    cancel: (operationId) => client.request(IPC.repositoryGraphCancel, operationId) as ReturnType<RepositoryGraphApi['cancel']>,
    export: (input) => client.request(IPC.repositoryGraphExport, input) as ReturnType<RepositoryGraphApi['export']>,
    onProgress: (listener) => client.subscribe(IPC.repositoryGraphProgress, listener as Listener)
  }
  return { repositoryGraph }
}

/** Machine-owned UniGetUI Global Universe. It is host-scoped, so no project id is accepted. */
export function buildUniGetUiApi(client: RpcClient): Pick<NodeTerminalApi, 'unigetui'> {
  const unigetui: UniGetUiApi = {
    status: () => client.request(IPC.unigetuiStatus) as ReturnType<UniGetUiApi['status']>,
    universeState: () => client.request(IPC.unigetuiUniverseState) as ReturnType<UniGetUiApi['universeState']>,
    saveUniverseState: (state) => client.request(IPC.unigetuiSaveUniverseState, state) as ReturnType<UniGetUiApi['saveUniverseState']>,
    appStatus: () => client.request(IPC.unigetuiAppStatus),
    navigate: (page) => client.request(IPC.unigetuiNavigate, page),
    operations: () => client.request(IPC.unigetuiOperations) as ReturnType<UniGetUiApi['operations']>,
    operation: (id) => client.request(IPC.unigetuiOperation, id) as ReturnType<UniGetUiApi['operation']>,
    operationOutput: (id, tail) => client.request(IPC.unigetuiOperationOutput, id, tail) as ReturnType<UniGetUiApi['operationOutput']>,
    operationWait: (id, timeout) => client.request(IPC.unigetuiOperationWait, id, timeout) as ReturnType<UniGetUiApi['operationWait']>,
    operationCancel: (id) => client.request(IPC.unigetuiOperationCancel, id),
    operationRetry: (id, mode) => client.request(IPC.unigetuiOperationRetry, id, mode),
    operationReorder: (id, action) => client.request(IPC.unigetuiOperationReorder, id, action),
    operationForget: (id) => client.request(IPC.unigetuiOperationForget, id),
    managers: () => client.request(IPC.unigetuiManagers) as ReturnType<UniGetUiApi['managers']>,
    managerAction: (manager, action, input) => client.request(IPC.unigetuiManagerAction, manager, action, input),
    sources: (manager) => client.request(IPC.unigetuiSources, manager) as ReturnType<UniGetUiApi['sources']>,
    sourceAdd: (manager, name, url) => client.request(IPC.unigetuiSourceAdd, manager, name, url),
    sourceRemove: (manager, name, url) => client.request(IPC.unigetuiSourceRemove, manager, name, url),
    settings: () => client.request(IPC.unigetuiSettings) as ReturnType<UniGetUiApi['settings']>,
    settingGet: (key) => requestParsed(client, IPC.unigetuiSettingGet, parseUniGetUiSetting, key),
    settingSet: (key, input) => client.request(IPC.unigetuiSettingSet, key, input),
    settingClear: (key) => client.request(IPC.unigetuiSettingClear, key),
    settingsReset: () => client.request(IPC.unigetuiSettingsReset),
    shortcuts: () => client.request(IPC.unigetuiShortcuts),
    shortcutSet: (path, status) => client.request(IPC.unigetuiShortcutSet, path, status),
    shortcutReset: (path) => client.request(IPC.unigetuiShortcutReset, path),
    shortcutResetAll: () => client.request(IPC.unigetuiShortcutResetAll),
    logs: (kind, manager, level) => client.request(IPC.unigetuiLogs, kind, manager, level) as ReturnType<UniGetUiApi['logs']>,
    backups: () => client.request(IPC.unigetuiBackups),
    backupLocalCreate: () => client.request(IPC.unigetuiBackupLocalCreate),
    backupCloudList: () => client.request(IPC.unigetuiBackupCloudList),
    backupCloudCreate: () => client.request(IPC.unigetuiBackupCloudCreate),
    backupCloudDownload: (key) => client.request(IPC.unigetuiBackupCloudDownload, key),
    backupCloudRestore: (key, append) => client.request(IPC.unigetuiBackupCloudRestore, key, append),
    backupLoginStart: (launchBrowser) => client.request(IPC.unigetuiBackupLoginStart, launchBrowser),
    backupLoginComplete: () => client.request(IPC.unigetuiBackupLoginComplete),
    backupLogout: () => client.request(IPC.unigetuiBackupLogout),
    bundle: () => client.request(IPC.unigetuiBundle),
    bundleReset: () => client.request(IPC.unigetuiBundleReset),
    bundleImport: (input) => client.request(IPC.unigetuiBundleImport, input),
    bundleExport: (path) => client.request(IPC.unigetuiBundleExport, path),
    bundleAdd: (input) => client.request(IPC.unigetuiBundleAdd, input),
    bundleRemove: (input) => client.request(IPC.unigetuiBundleRemove, input),
    bundleInstall: (input) => client.request(IPC.unigetuiBundleInstall, input),
    packageSearch: (query, manager, maxResults) => requestParsed(client, IPC.unigetuiPackageSearch, parseUniGetUiPackageList, query, manager, maxResults),
    packageDetails: (id, manager, source) => client.request(IPC.unigetuiPackageDetails, id, manager, source),
    packageVersions: (id, manager, source) => client.request(IPC.unigetuiPackageVersions, id, manager, source),
    packageInstalled: (manager) => requestParsed(client, IPC.unigetuiPackageInstalled, parseUniGetUiPackageList, manager),
    packageUpdates: (manager) => requestParsed(client, IPC.unigetuiPackageUpdates, parseUniGetUiPackageList, manager),
    packageInstall: (id, options) => client.request(IPC.unigetuiPackageInstall, id, options),
    packageDownload: (id, options) => client.request(IPC.unigetuiPackageDownload, id, options),
    packageUpdate: (id, options) => client.request(IPC.unigetuiPackageUpdate, id, options),
    packageUninstall: (id, manager, options) => client.request(IPC.unigetuiPackageUninstall, id, manager, options),
    packageRepair: (id, manager, options) => client.request(IPC.unigetuiPackageRepair, id, manager, options),
    packageReinstall: (id, options) => client.request(IPC.unigetuiPackageReinstall, id, options),
    ignoredUpdates: () => requestParsed(client, IPC.unigetuiIgnoredUpdates, parseUniGetUiPackageList),
    ignoredUpdateAdd: (id, options) => client.request(IPC.unigetuiIgnoredUpdateAdd, id, options),
    ignoredUpdateRemove: (id, options) => client.request(IPC.unigetuiIgnoredUpdateRemove, id, options),
    packageUpdateAll: (options) => client.request(IPC.unigetuiPackageUpdateAll, options),
    packageUpdateManager: (manager, options) => client.request(IPC.unigetuiPackageUpdateManager, manager, options)
  }
  return { unigetui }
}

/** Guided AWS manager families over the authenticated WS bridge. */
export function buildAwsResourceManagersApi(client: RpcClient): Pick<NodeTerminalApi, 'awsManagers'> {
  const awsManagers: AwsResourceManagerApi = {
    catalog: () => client.request(IPC.awsManagerCatalog) as ReturnType<AwsResourceManagerApi['catalog']>,
    availability: (manager) => client.request(IPC.awsManagerAvailability, manager) as ReturnType<AwsResourceManagerApi['availability']>,
    list: (request) => client.request(IPC.awsManagerList, request) as ReturnType<AwsResourceManagerApi['list']>,
    run: (request) => client.request(IPC.awsManagerRun, request) as ReturnType<AwsResourceManagerApi['run']>,
    progress: (jobId) => client.request(IPC.awsManagerProgress, jobId) as ReturnType<AwsResourceManagerApi['progress']>,
    cancel: (jobId) => client.request(IPC.awsManagerCancel, jobId) as ReturnType<AwsResourceManagerApi['cancel']>,
    retry: (jobId) => client.request(IPC.awsManagerRetry, jobId) as ReturnType<AwsResourceManagerApi['retry']>
  }
  return { awsManagers }
}

/** Guided Cloudflare managers over the authenticated WS bridge. */
export function buildCloudflareCoreManagersApi(client: RpcClient): Pick<NodeTerminalApi, 'cloudflareCoreManagers'> {
  const cloudflareCoreManagers: CloudflareCoreManagersApi = {
    runtime: () => client.request(IPC.cloudflareCoreRuntime) as ReturnType<CloudflareCoreManagersApi['runtime']>,
    credentials: () => client.request(IPC.cloudflareCoreCredentials) as ReturnType<CloudflareCoreManagersApi['credentials']>,
    saveCredential: (input) => client.request(IPC.cloudflareCoreSaveCredential, input) as ReturnType<CloudflareCoreManagersApi['saveCredential']>,
    removeCredential: (credentialId) => client.request(IPC.cloudflareCoreRemoveCredential, credentialId) as ReturnType<CloudflareCoreManagersApi['removeCredential']>,
    binding: (nodeId) => client.request(IPC.cloudflareCoreBinding, nodeId) as ReturnType<CloudflareCoreManagersApi['binding']>,
    bind: (input) => client.request(IPC.cloudflareCoreBind, input) as ReturnType<CloudflareCoreManagersApi['bind']>,
    unbind: (nodeId) => client.request(IPC.cloudflareCoreUnbind, nodeId) as ReturnType<CloudflareCoreManagersApi['unbind']>,
    preview: (nodeId, request) => client.request(IPC.cloudflareCorePreview, nodeId, request) as ReturnType<CloudflareCoreManagersApi['preview']>,
    execute: (nodeId, request) => client.request(IPC.cloudflareCoreExecute, nodeId, request) as ReturnType<CloudflareCoreManagersApi['execute']>,
    cancel: (operationId) => client.request(IPC.cloudflareCoreCancel, operationId) as ReturnType<CloudflareCoreManagersApi['cancel']>,
    onProgress: (listener) => client.subscribe(IPC.cloudflareCoreProgress, listener as Listener),
    tunnelState: (nodeId) => client.request(IPC.cloudflareCoreTunnelState, nodeId) as ReturnType<CloudflareCoreManagersApi['tunnelState']>,
    probeTunnelFacet: (nodeId, facet) => client.request(IPC.cloudflareCoreTunnelProbe, nodeId, facet) as ReturnType<CloudflareCoreManagersApi['probeTunnelFacet']>,
    cancelTunnelProbe: (nodeId) => client.request(IPC.cloudflareCoreTunnelCancel, nodeId) as ReturnType<CloudflareCoreManagersApi['cancelTunnelProbe']>,
    onTunnelState: (listener) => client.subscribe(IPC.cloudflareCoreTunnelStateChanged, listener as Listener)
  }
  return { cloudflareCoreManagers }
}

/** Automatic node-feature dependency lifecycle over the authenticated server RPC. Downloads and
 * installation remain on the server host, so the browser never uses its own PATH as proof. */
export function buildNodeDependenciesApi(client: RpcClient): Pick<NodeTerminalApi, 'nodeDependencies'> {
  const nodeDependencies: NodeDependenciesApi = {
    catalog: () => client.request(IPC.nodeDependencyCatalog) as ReturnType<NodeDependenciesApi['catalog']>,
    status: (id) => client.request(IPC.nodeDependencyStatus, id) as ReturnType<NodeDependenciesApi['status']>,
    details: (id) => client.request(IPC.nodeDependencyDetails, id) as ReturnType<NodeDependenciesApi['details']>,
    install: (id) => client.request(IPC.nodeDependencyInstall, id) as ReturnType<NodeDependenciesApi['install']>,
    cancel: (operationId) => client.request(IPC.nodeDependencyCancel, operationId) as ReturnType<NodeDependenciesApi['cancel']>,
    repair: (id) => client.request(IPC.nodeDependencyRepair, id) as ReturnType<NodeDependenciesApi['repair']>,
    reconcile: () => client.request(IPC.nodeDependencyReconcile) as ReturnType<NodeDependenciesApi['reconcile']>,
    onState: (listener) => client.subscribe(IPC.nodeDependencyState, listener as Listener),
    onProgress: (listener) => client.subscribe(IPC.nodeDependencyProgress, listener as Listener)
  }
  return { nodeDependencies }
}

/** Current AWS model inventory and selected operation source over the authenticated server RPC. */
export function buildAwsWizardModelsApi(client: RpcClient): Pick<NodeTerminalApi, 'awsWizardModels'> {
  const awsWizardModels: AwsWizardModelsApi = {
    catalog: () => client.request(IPC.awsWizardCatalog) as ReturnType<AwsWizardModelsApi['catalog']>,
    commands: (serviceId) => client.request(IPC.awsWizardCommands, serviceId) as ReturnType<AwsWizardModelsApi['commands']>,
    source: (serviceId, commandName) => client.request(IPC.awsWizardSource, serviceId, commandName) as ReturnType<AwsWizardModelsApi['source']>
  }
  return { awsWizardModels }
}

/** Host-owned AWS identity discovery and bounded fixed-action runner. */
export function buildAwsIdentityApi(client: RpcClient): Pick<NodeTerminalApi, 'awsIdentity'> {
  const awsIdentity: AwsIdentityApi = {
    discover: () => client.request(IPC.awsIdentityDiscover) as ReturnType<AwsIdentityApi['discover']>,
    start: (action, profileName, binding) => client.request(IPC.awsIdentityStart, action, profileName, binding) as ReturnType<AwsIdentityApi['start']>,
    cancel: (operationId) => client.request(IPC.awsIdentityCancel, operationId) as ReturnType<AwsIdentityApi['cancel']>,
    onOperation: (listener) => client.subscribe(IPC.awsIdentityOperation, listener as Listener)
  }
  return { awsIdentity }
}

/** Local Minecraft server create-and-manage (docs/minecraft-server-manager.md) — same core engine
 *  as desktop; the server process is the one downloading, spawning and owning `java`, exactly as
 *  main does. */
export function buildMinecraftApi(client: RpcClient): Pick<NodeTerminalApi, 'minecraft'> {
  const minecraft: MinecraftApi = {
    versions: () => client.request(IPC.minecraftVersions) as ReturnType<MinecraftApi['versions']>,
    status: (id) => client.request(IPC.minecraftStatus, id) as ReturnType<MinecraftApi['status']>,
    create: (input) => client.request(IPC.minecraftCreate, input) as ReturnType<MinecraftApi['create']>,
    acceptEula: (id) => client.request(IPC.minecraftAcceptEula, id) as ReturnType<MinecraftApi['acceptEula']>,
    start: (id) => client.request(IPC.minecraftStart, id) as ReturnType<MinecraftApi['start']>,
    stop: (id) => client.request(IPC.minecraftStop, id) as ReturnType<MinecraftApi['stop']>,
    sendCommand: (id, command) => client.request(IPC.minecraftSendCommand, id, command) as Promise<boolean>,
    remove: (id, deleteFiles) => client.request(IPC.minecraftRemove, id, deleteFiles) as Promise<void>,
    recentConsole: (id) =>
      client.request(IPC.minecraftRecentConsole, id) as ReturnType<MinecraftApi['recentConsole']>,
    readProperties: (id) =>
      client.request(IPC.minecraftPropertiesRead, id) as ReturnType<MinecraftApi['readProperties']>,
    writeProperties: (id, updates) =>
      client.request(IPC.minecraftPropertiesWrite, id, updates) as ReturnType<MinecraftApi['writeProperties']>,
    readPlayerLists: (id) =>
      client.request(IPC.minecraftPlayerLists, id) as ReturnType<MinecraftApi['readPlayerLists']>,
    listBackups: (id) =>
      client.request(IPC.minecraftBackupsList, id) as ReturnType<MinecraftApi['listBackups']>,
    createBackup: (id) =>
      client.request(IPC.minecraftBackupCreate, id) as ReturnType<MinecraftApi['createBackup']>,
    restoreBackup: (id, backupId) =>
      client.request(IPC.minecraftBackupRestore, id, backupId) as ReturnType<MinecraftApi['restoreBackup']>,
    deleteBackup: (id, backupId) =>
      client.request(IPC.minecraftBackupDelete, id, backupId) as Promise<void>,
    onEvent: (listener) => client.subscribe(IPC.minecraftEvent, listener as Listener)
  }
  return { minecraft }
}

/** Typed Docker host manager. Server Edition executes the same argv-only manager on its host. */
export function buildDockerHostApi(client: RpcClient): Pick<NodeTerminalApi, 'dockerHost'> {
  const dockerHost: DockerHostApi = {
    listHosts: () => client.request(IPC.dockerHostList) as ReturnType<DockerHostApi['listHosts']>,
    saveHost: (input) => client.request(IPC.dockerHostSave, input) as ReturnType<DockerHostApi['saveHost']>,
    removeHost: (id, confirmed) => client.request(IPC.dockerHostRemove, id, confirmed) as Promise<void>,
    verify: (id) => client.request(IPC.dockerHostVerify, id) as ReturnType<DockerHostApi['verify']>,
    listContexts: (id) => client.request(IPC.dockerHostContexts, id) as ReturnType<DockerHostApi['listContexts']>,
    inventory: (id) => client.request(IPC.dockerHostInventory, id) as ReturnType<DockerHostApi['inventory']>,
    listContainers: (id) => client.request(IPC.dockerHostContainers, id) as ReturnType<DockerHostApi['listContainers']>,
    listImages: (id) => client.request(IPC.dockerHostImages, id) as ReturnType<DockerHostApi['listImages']>,
    listVolumes: (id) => client.request(IPC.dockerHostVolumes, id) as ReturnType<DockerHostApi['listVolumes']>,
    listNetworks: (id) => client.request(IPC.dockerHostNetworks, id) as ReturnType<DockerHostApi['listNetworks']>,
    listCompose: (id, profile) => client.request(IPC.dockerHostComposeList, id, profile) as ReturnType<DockerHostApi['listCompose']>,
    startContainer: (id, containerId) => client.request(IPC.dockerHostContainerStart, id, containerId) as Promise<void>,
    stopContainer: (id, containerId, timeout) => client.request(IPC.dockerHostContainerStop, id, containerId, timeout) as Promise<void>,
    restartContainer: (id, containerId, timeout) => client.request(IPC.dockerHostContainerRestart, id, containerId, timeout) as Promise<void>,
    pauseContainer: (id, containerId) => client.request(IPC.dockerHostContainerPause, id, containerId) as Promise<void>,
    unpauseContainer: (id, containerId) => client.request(IPC.dockerHostContainerUnpause, id, containerId) as Promise<void>,
    stats: (id, ids) => client.request(IPC.dockerHostStats, id, ids) as ReturnType<DockerHostApi['stats']>,
    logs: (id, options) => client.request(IPC.dockerHostLogs, id, options) as ReturnType<DockerHostApi['logs']>,
    exec: (id, request) => client.request(IPC.dockerHostExec, id, request) as ReturnType<DockerHostApi['exec']>,
    previewDestructive: (input) => client.request(IPC.dockerHostPreviewDestructive, input) as ReturnType<DockerHostApi['previewDestructive']>,
    removeContainers: (id, ids, confirmed) => client.request(IPC.dockerHostRemoveContainers, id, ids, confirmed) as Promise<void>,
    removeImages: (id, ids, confirmed) => client.request(IPC.dockerHostRemoveImages, id, ids, confirmed) as Promise<void>,
    removeVolumes: (id, ids, confirmed) => client.request(IPC.dockerHostRemoveVolumes, id, ids, confirmed) as Promise<void>,
    removeNetworks: (id, ids, confirmed) => client.request(IPC.dockerHostRemoveNetworks, id, ids, confirmed) as Promise<void>,
    composeUp: (id, profile, services) => client.request(IPC.dockerHostComposeUp, id, profile, services) as Promise<void>,
    composeDown: (id, profile, confirmed) => client.request(IPC.dockerHostComposeDown, id, profile, confirmed) as Promise<void>
  }
  return { dockerHost }
}

/** Local WebTorrent downloader, routed to the machine that owns this session. */
export function buildTorrentApi(client: RpcClient): Pick<NodeTerminalApi, 'torrent'> {
  const torrent: TorrentApi = {
    runtime: () => client.request(IPC.torrentRuntime) as ReturnType<TorrentApi['runtime']>,
    list: (nodeId) => client.request(IPC.torrentList, nodeId) as ReturnType<TorrentApi['list']>,
    inspect: (input) => client.request(IPC.torrentInspect, input) as ReturnType<TorrentApi['inspect']>,
    add: (input) => client.request(IPC.torrentAdd, input) as ReturnType<TorrentApi['add']>,
    chooseFiles: (id, paths) => client.request(IPC.torrentChooseFiles, id, paths) as ReturnType<TorrentApi['chooseFiles']>,
    setDestination: (id, destination) => client.request(IPC.torrentSetDestination, id, destination) as ReturnType<TorrentApi['setDestination']>,
    preflight: (id) => client.request(IPC.torrentPreflight, id) as ReturnType<TorrentApi['preflight']>,
    start: (id) => client.request(IPC.torrentStart, id) as ReturnType<TorrentApi['start']>,
    pause: (id) => client.request(IPC.torrentPause, id) as ReturnType<TorrentApi['pause']>,
    resume: (id) => client.request(IPC.torrentResume, id) as ReturnType<TorrentApi['resume']>,
    cancel: (id) => client.request(IPC.torrentCancel, id) as ReturnType<TorrentApi['cancel']>,
    retry: (id) => client.request(IPC.torrentRetry, id) as ReturnType<TorrentApi['retry']>,
    remove: (id) => client.request(IPC.torrentRemove, id) as ReturnType<TorrentApi['remove']>,
    setSeedPolicy: (id, policy) => client.request(IPC.torrentSetSeedPolicy, id, policy) as ReturnType<TorrentApi['setSeedPolicy']>,
    reconcile: () => client.request(IPC.torrentReconcile) as ReturnType<TorrentApi['reconcile']>,
    onTask: (listener) => client.subscribe(IPC.torrentTask, listener as unknown as Listener)
  }
  return { torrent }
}
/** Linux ISO VM manager. The server process owns QEMU and exposes only the bounded lifecycle API. */
export function buildVirtualMachineApi(client: RpcClient): Pick<NodeTerminalApi, 'virtualMachine'> {
  const virtualMachine: VirtualMachineApi = {
    tools: () => client.request(IPC.virtualMachineTools) as ReturnType<VirtualMachineApi['tools']>,
    status: (id) => client.request(IPC.virtualMachineStatus, id) as ReturnType<VirtualMachineApi['status']>,
    configure: (id, config, local) => client.request(IPC.virtualMachineConfigure, id, config, local) as ReturnType<VirtualMachineApi['configure']>,
    createDisk: (id, folder) => client.request(IPC.virtualMachineCreateDisk, id, folder) as ReturnType<VirtualMachineApi['createDisk']>,
    start: (id) => client.request(IPC.virtualMachineStart, id) as ReturnType<VirtualMachineApi['start']>,
    stop: (id) => client.request(IPC.virtualMachineStop, id) as ReturnType<VirtualMachineApi['stop']>,
    snapshot: (id, name) => client.request(IPC.virtualMachineSnapshot, id, name) as ReturnType<VirtualMachineApi['snapshot']>,
    restore: (id, name) => client.request(IPC.virtualMachineRestore, id, name) as ReturnType<VirtualMachineApi['restore']>,
    openDisplay: (id) => client.request(IPC.virtualMachineOpenDisplay, id) as ReturnType<VirtualMachineApi['openDisplay']>,
    reset: (id) => client.request(IPC.virtualMachineReset, id) as ReturnType<VirtualMachineApi['reset']>,
    onEvent: (listener) => client.subscribe(IPC.virtualMachineEvent, listener as Listener)
  }
  return { virtualMachine }
}
/** Calendar nodes use the same host-owned CorePlatform in the desktop and Server Edition. */
export function buildCalendarApi(client: RpcClient): Pick<NodeTerminalApi, 'calendar'> {
  const calendar: CalendarApi = {
    status: (id, config) => client.request(IPC.calendarStatus, id, config) as ReturnType<CalendarApi['status']>,
    accounts: () => client.request(IPC.calendarAccounts) as ReturnType<CalendarApi['accounts']>,
    calendars: (accountId, provider) => client.request(IPC.calendarCalendars, accountId, provider) as ReturnType<CalendarApi['calendars']>,
    events: (id, config) => client.request(IPC.calendarEvents, id, config) as ReturnType<CalendarApi['events']>,
    importIcs: (id, text, name) => client.request(IPC.calendarImportIcs, id, text, name) as ReturnType<CalendarApi['importIcs']>,
    refresh: (id, config) => client.request(IPC.calendarRefresh, id, config) as ReturnType<CalendarApi['refresh']>,
    beginOAuth: (provider: Exclude<CalendarProvider, 'local' | 'ics'>) => client.request(IPC.calendarBeginOAuth, provider) as ReturnType<CalendarApi['beginOAuth']>,
    connectCalDav: (input) => client.request(IPC.calendarConnectCalDav, input) as ReturnType<CalendarApi['connectCalDav']>,
    disconnectAccount: (accountId) => client.request(IPC.calendarDisconnectAccount, accountId) as ReturnType<CalendarApi['disconnectAccount']>,
    create: (input) => client.request(IPC.calendarCreate, input) as ReturnType<CalendarApi['create']>,
    update: (input) => client.request(IPC.calendarUpdate, input) as ReturnType<CalendarApi['update']>,
    remove: (id, eventId) => client.request(IPC.calendarRemove, id, eventId) as ReturnType<CalendarApi['remove']>
  }
  return { calendar }
}

/** Home Assistant uses the same host-owned core service in both shells. */
export function buildHomeAssistantApi(client: RpcClient): Pick<NodeTerminalApi, 'homeAssistant'> {
  const homeAssistant: HomeAssistantApi = {
    instances: () => client.request(IPC.homeAssistantInstances) as ReturnType<HomeAssistantApi['instances']>,
    saveInstance: (input) => client.request(IPC.homeAssistantSaveInstance, input) as ReturnType<HomeAssistantApi['saveInstance']>,
    removeInstance: (id) => client.request(IPC.homeAssistantRemoveInstance, id) as ReturnType<HomeAssistantApi['removeInstance']>,
    discover: (request) => client.request(IPC.homeAssistantDiscover, request) as ReturnType<HomeAssistantApi['discover']>,
    cancel: (operationId) => client.request(IPC.homeAssistantCancel, operationId) as ReturnType<HomeAssistantApi['cancel']>,
    onEvent: (listener) => client.subscribe(IPC.homeAssistantEvent, listener as Listener)
  }
  return { homeAssistant }
}

export function buildHomeAssistantControlApi(client: RpcClient): Pick<NodeTerminalApi, 'homeAssistantControl'> {
  const homeAssistantControl: HomeAssistantControlApi = {
    connections: () => client.request(IPC.homeAssistantConnections) as ReturnType<HomeAssistantControlApi['connections']>,
    configure: (input) => client.request(IPC.homeAssistantConfigure, input) as ReturnType<HomeAssistantControlApi['configure']>,
    bind: (nodeId, connectionId) => client.request(IPC.homeAssistantBind, nodeId, connectionId) as ReturnType<HomeAssistantControlApi['bind']>,
    status: (nodeId) => client.request(IPC.homeAssistantStatus, nodeId) as ReturnType<HomeAssistantControlApi['status']>,
    entities: (nodeId) => client.request(IPC.homeAssistantEntities, nodeId) as ReturnType<HomeAssistantControlApi['entities']>,
    services: (nodeId) => client.request(IPC.homeAssistantServices, nodeId) as ReturnType<HomeAssistantControlApi['services']>,
    call: (input) => client.request(IPC.homeAssistantCall, input) as ReturnType<HomeAssistantControlApi['call']>,
    cancel: (nodeId) => client.request(IPC.homeAssistantControlCancel, nodeId) as ReturnType<HomeAssistantControlApi['cancel']>
  }
  return { homeAssistantControl }
}

/** Home Assistant sensor requests run on the host-owned core in both desktop and Server Edition. */
export function buildHomeAssistantSensorApi(client: RpcClient): Pick<NodeTerminalApi, 'homeAssistantSensor'> {
  const homeAssistantSensor: HomeAssistantSensorApi = {
    binding: (nodeId) => client.request(IPC.homeAssistantSensorBinding, nodeId) as ReturnType<HomeAssistantSensorApi['binding']>,
    configure: (input) => client.request(IPC.homeAssistantSensorConfigure, input) as ReturnType<HomeAssistantSensorApi['configure']>,
    leaveUnbound: (nodeId) => client.request(IPC.homeAssistantSensorLeaveUnbound, nodeId) as ReturnType<HomeAssistantSensorApi['leaveUnbound']>,
    discover: (nodeId) => client.request(IPC.homeAssistantSensorDiscover, nodeId) as ReturnType<HomeAssistantSensorApi['discover']>,
    refresh: (nodeId, config) => client.request(IPC.homeAssistantSensorRefresh, nodeId, config) as ReturnType<HomeAssistantSensorApi['refresh']>
  }
  return { homeAssistantSensor }
}

export function buildCloudflareZeroTrustApi(client: RpcClient): Pick<NodeTerminalApi, 'cloudflareZeroTrust'> {
  const cloudflareZeroTrust: CloudflareApi = {
    catalog: () => client.request(IPC.cloudflareCatalog) as ReturnType<CloudflareApi['catalog']>,
    accounts: () => client.request(IPC.cloudflareAccounts) as ReturnType<CloudflareApi['accounts']>,
    configure: (input) => client.request(IPC.cloudflareConfigure, input) as ReturnType<CloudflareApi['configure']>,
    removeAccount: (id) => client.request(IPC.cloudflareRemoveAccount, id) as ReturnType<CloudflareApi['removeAccount']>,
    binding: (nodeId) => client.request(IPC.cloudflareBinding, nodeId) as ReturnType<CloudflareApi['binding']>,
    saveBinding: (nodeId, binding) => client.request(IPC.cloudflareSaveBinding, nodeId, binding) as ReturnType<CloudflareApi['saveBinding']>,
    resources: (nodeId, manager) => client.request(IPC.cloudflareResources, nodeId, manager) as ReturnType<CloudflareApi['resources']>,
    execute: (nodeId, request, onProgress) => {
      const unsubscribe = client.subscribe(IPC.cloudflareProgress, (value) => { const progress = value as CloudflareExecutionProgress & { nodeId?: string }; if (progress.nodeId === nodeId) onProgress(progress) })
      return (client.request(IPC.cloudflareExecute, nodeId, request) as ReturnType<CloudflareApi['execute']>).finally(unsubscribe)
    },
    cancel: (nodeId) => client.request(IPC.cloudflareCancel, nodeId) as ReturnType<CloudflareApi['cancel']>,
    onProgress: (listener) => client.subscribe(IPC.cloudflareProgress, listener as Listener)
  }
  return { cloudflareZeroTrust }
}

/**
 * Build the `usage` namespace over an RpcClient. The server shell runs the same core usage
 * service the desktop does, so this is real end to end — including `onUpdate`, which subscribes
 * to the poll's broadcast rather than the stub's no-op.
 *
 * `fetch` deliberately does NOT catch: `UsageApi.fetch` is typed as `Promise<ClaudeUsage>`, so
 * swallowing a transport failure would mean inventing a snapshot. The one consumer
 * (UsageIndicator) leaves `usage` null until a real one arrives and renders nothing meanwhile,
 * which is the correct outcome for "we don't know".
 */
function buildUsageApi(client: RpcClient): Pick<NodeTerminalApi, 'usage'> {
  return {
    usage: {
      fetch: (accountId?: string) =>
        client.request(IPC.usageFetch, accountId) as Promise<ClaudeUsage>,
      refresh: (accountId?: string) =>
        client.request(IPC.usageRefresh, accountId) as Promise<ClaudeUsage>,
      providers: (force?: boolean) =>
        client.request(IPC.usageProviders, force) as Promise<ProviderUsage[]>,
      // Real, but structurally empty on the server: `usage:remote` is registered by the same core
      // service, and the server shell injects no SSH deps (it has no SSH projects), so it answers
      // `[]` rather than rejecting.
      remote: (query?: RemoteUsageQuery) =>
        client.request(IPC.usageRemote, query) as Promise<RemoteAccountUsage[]>,
      setProviderCookie: (provider: string, cookie: string) =>
        client.request(IPC.usageSetProviderCookie, provider, cookie) as Promise<boolean>,
      cookieProviders: () =>
        client.request(IPC.usageCookieProviders) as Promise<Record<string, boolean>>,
      onUpdate: (listener) => client.subscribe(IPC.usageUpdate, listener as Listener)
    }
  }
}

/**
 * Real, not a stub: the same core service (`startSessionMemoryService`) registers these channels in
 * the server shell, so the browser gets a genuine per-session breakdown of the machine it is served
 * from — the one it is actually looking at.
 *
 * The query is forwarded VERBATIM. `remote` is the renderer's own "this scope is an SSH host"
 * claim and is one of TWO independent sources the service ORs to decide which machine answers;
 * `projectId` is the only thing naming that machine. A layer that drops or rewrites either turns a
 * remote query into a local sweep, and this machine's sessions get published under the host's name.
 *
 * Neither member catches: a transport failure must not be laundered into `{ok:false}` / `null`,
 * which are the service's own words for "the sweep could not run" and "RAM unreadable". The panel
 * shows a failed request as a failed request.
 */
export function buildSessionMemoryApi(client: RpcClient): Pick<NodeTerminalApi, 'sessionMemory'> {
  return {
    sessionMemory: {
      read: (q?: SessionMemoryQuery) =>
        client.request(IPC.sessionMemory, q) as Promise<SessionMemoryReport>,
      host: (q?: SessionMemoryQuery) =>
        client.request(IPC.sessionMemoryHost, q) as Promise<MemInfo | null>
    }
  }
}

/** Real, not a stub: `registerVsCodeHandlers` runs in the server shell too (server/handlers/
 *  index.ts), so `detect`/`open` act on the machine actually running the Server Edition — the
 *  same machine the browser is talking to. */
/**
 * Real, not a stub: `startWslService` registers these channels in the server shell too (the same
 * core service Desktop uses), so the browser gets genuine WSL management for the machine it is
 * served from. `wsl.exe` simply is not found on a non-Windows host, so `list()`/`catalogue()`
 * reject with a real, honest error there -- never a silently fabricated empty array.
 *
 * `client.request` already rejects on a handler-thrown error (see RpcClient.request), which is
 * exactly the "reject on failure, never resolve to []" contract `state/wsl.ts`'s `refresh()`
 * depends on -- nothing extra to do here to preserve it.
 */
export function buildWslApi(client: RpcClient): Pick<NodeTerminalApi, 'wsl'> {
  return {
    wsl: {
      list: () => client.request(IPC.wslList) as ReturnType<import('@shared/wsl').WslApi['list']>,
      catalogue: () =>
        client.request(IPC.wslCatalogue) as ReturnType<import('@shared/wsl').WslApi['catalogue']>,
      create: (input) =>
        client.request(IPC.wslCreate, input) as ReturnType<import('@shared/wsl').WslApi['create']>,
      cancelCreate: (operationId) =>
        client.request(IPC.wslCreateCancel, operationId) as ReturnType<import('@shared/wsl').WslApi['cancelCreate']>,
      onCreateProgress: (listener) =>
        client.subscribe(IPC.wslCreateProgress, listener as Listener),
      sleep: (name) =>
        client.request(IPC.wslSleep, name) as ReturnType<import('@shared/wsl').WslApi['sleep']>,
      wake: (name) =>
        client.request(IPC.wslWake, name) as ReturnType<import('@shared/wsl').WslApi['wake']>,
      delete: (name) =>
        client.request(IPC.wslDelete, name) as ReturnType<import('@shared/wsl').WslApi['delete']>
    }
  }
}

export function buildWindowsDiagnosticsApi(client: RpcClient): Pick<NodeTerminalApi, 'windowsDiagnostics'> {
  return {
    windowsDiagnostics: {
      snapshot: () => client.request(IPC.windowsDiagnosticsSnapshot) as ReturnType<NodeTerminalApi['windowsDiagnostics']['snapshot']>
    }
  }
}

export function buildVsCodeApi(client: RpcClient): Pick<NodeTerminalApi, 'vscode'> {
  return {
    vscode: {
      detect: () => client.request(IPC.vscodeDetect) as Promise<VsCodeInstall[]>,
      open: (path: string) => client.request(IPC.vscodeOpen, path) as Promise<VsCodeOpenResult>
    }
  }
}

/** Real, not a stub: `registerLocalHistoryHandlers` runs in the server shell too, over the same
 *  git-backed store the desktop shell writes to (its own userDataDir, on the server machine). */
export function buildLocalHistoryApi(client: RpcClient): Pick<NodeTerminalApi, 'history'> {
  return {
    history: {
      list: (domain: string, filters?: HistoryFilters) =>
        client.request(IPC.historyList, domain, filters) as Promise<HistoryListResult>,
      restore: (domain: string, sha: string) =>
        client.request(IPC.historyRestore, domain, sha) as Promise<HistoryRestoreResult>
    }
  }
}

/** Build the `toylock` namespace over an RpcClient — core-bound: the server's own userDataDir is
 *  where the lock records live (raw 0600 bytes there; no OS keychain on a headless box — see
 *  core/secure-store.ts), so this reaches the SAME service Electron reaches over ipcMain. */
export function buildToylockApi(client: RpcClient): Pick<NodeTerminalApi, 'toylock'> {
  const toylock: ToylockApi = {
    list: () => client.request(IPC.toylockList) as Promise<ToyLockRecord[]>,
    createPassword: (input: ToyLockCreatePasswordInput) =>
      client.request(IPC.toylockCreatePassword, input) as Promise<ToyLockCreateResult>,
    beginTotp: (input: ToyLockBeginTotpInput) =>
      client.request(IPC.toylockBeginTotp, input) as Promise<ToyLockBeginTotpResult>,
    confirmTotp: (input: ToyLockConfirmTotpInput) =>
      client.request(IPC.toylockConfirmTotp, input) as Promise<ToyLockConfirmTotpResult>,
    cancelTotp: (lockId: string) => client.request(IPC.toylockCancelTotp, lockId) as Promise<void>,
    update: (input: ToyLockUpdateInput) =>
      client.request(IPC.toylockUpdate, input) as Promise<ToyLockRecord | null>,
    remove: (id: string) => client.request(IPC.toylockRemove, id) as Promise<void>,
    verify: (input: ToyLockVerifyInput) =>
      client.request(IPC.toylockVerify, input) as Promise<ToyLockVerifyResult>,
    relock: (lockId: string) => client.request(IPC.toylockRelock, lockId) as Promise<void>,
    ladderIssue: (lockId: string) =>
      client.request(IPC.toylockLadderIssue, lockId) as Promise<ToyLockLadderState>,
    ladderVerify: (input: ToyLockLadderVerifyInput) =>
      client.request(IPC.toylockLadderVerify, input) as Promise<ToyLockLadderVerifyResult>
  }
  return { toylock }
}

/** Build the `authenticator` namespace over an RpcClient. Same core-bound reasoning as
 *  `buildToylockApi` — see docs/authenticator.md. */
export function buildAuthenticatorApi(client: RpcClient): Pick<NodeTerminalApi, 'authenticator'> {
  const authenticator: AuthenticatorApi = {
    list: () => client.request(IPC.authenticatorList) as Promise<AuthenticatorEntry[]>,
    addManual: (input: AuthenticatorAddManualInput) =>
      client.request(IPC.authenticatorAddManual, input) as Promise<AuthenticatorAddResult>,
    addFromUri: (uri: string) =>
      client.request(IPC.authenticatorAddUri, uri) as Promise<AuthenticatorAddResult>,
    rename: (input: AuthenticatorRenameInput) =>
      client.request(IPC.authenticatorRename, input) as Promise<AuthenticatorEntry | null>,
    remove: (input: AuthenticatorRemoveInput) =>
      client.request(IPC.authenticatorRemove, input) as Promise<AuthenticatorRemoveResult>,
    code: (id: string) => client.request(IPC.authenticatorCode, id) as Promise<AuthenticatorCode | null>,
    codes: (ids: string[]) =>
      client.request(IPC.authenticatorCodes, ids) as Promise<Record<string, AuthenticatorCode>>,
    reveal: (id: string) => client.request(IPC.authenticatorReveal, id) as Promise<AuthenticatorRevealResult>,
    exportSecrets: (input: AuthenticatorExportInput) =>
      client.request(IPC.authenticatorExportSecrets, input) as Promise<AuthenticatorExportResult>
  }
  return { authenticator }
}

/** Build the `passwordManager` namespace over an RpcClient. Server Edition genuinely registers
 *  `registerPasswordManagerHandlers` (src/server/index.ts), so — unlike the relay peer surface in
 *  relay-api.ts, which deliberately excludes this namespace — this is a REAL implementation, not
 *  a stub: a browser talking to its own Server Edition instance is the machine owner, exactly as
 *  the Electron preload's `passwordManager` is. See PasswordManagerApi's doc comment in
 *  shared/types.ts for why the namespace stays out of the relay allowlist. */
export function buildPasswordManagerApi(client: RpcClient): Pick<NodeTerminalApi, 'passwordManager'> {
  const passwordManager: PasswordManagerApi = {
    status: (projectId: string) => client.request(IPC.passwordManagerStatus, projectId) as Promise<VaultStatus>,
    createVault: (projectId: string, password: string) =>
      client.request(IPC.passwordManagerCreateVault, projectId, password) as Promise<VaultCreateResult>,
    unlock: (projectId: string, password: string) =>
      client.request(IPC.passwordManagerUnlock, projectId, password) as Promise<VaultUnlockResult>,
    lock: (projectId: string) => client.request(IPC.passwordManagerLock, projectId) as Promise<void>,
    changePassword: (projectId: string, input: ChangeVaultPasswordInput) =>
      client.request(IPC.passwordManagerChangePassword, projectId, input) as Promise<ChangeVaultPasswordResult>,
    createManager: (projectId: string, input: CreateManagerInput) =>
      client.request(IPC.passwordManagerCreateManager, projectId, input) as Promise<CreateManagerResult>,
    renameManager: (projectId: string, input: RenameManagerInput) =>
      client.request(IPC.passwordManagerRenameManager, projectId, input) as Promise<ManagerMutationResult>,
    bindManagerGroup: (projectId: string, input: BindManagerGroupInput) =>
      client.request(IPC.passwordManagerBindManagerGroup, projectId, input) as Promise<ManagerMutationResult>,
    releaseGroupBinding: (projectId: string, groupId: string) =>
      client.request(IPC.passwordManagerReleaseGroupBinding, projectId, groupId) as Promise<ReleaseGroupBindingResult>,
    deleteManager: (projectId: string, id: string) =>
      client.request(IPC.passwordManagerDeleteManager, projectId, id) as Promise<ManagerMutationResult>,
    createCredential: (projectId: string, input: CreateCredentialInput) =>
      client.request(IPC.passwordManagerCreateCredential, projectId, input) as Promise<CreateCredentialResult>,
    renameCredential: (projectId: string, input: RenameCredentialInput) =>
      client.request(IPC.passwordManagerRenameCredential, projectId, input) as Promise<ManagerMutationResult>,
    updateCredentialSecret: (projectId: string, input: UpdateCredentialSecretInput) =>
      client.request(IPC.passwordManagerUpdateCredentialSecret, projectId, input) as Promise<UpdateCredentialResult>,
    removeCredential: (projectId: string, input: RemoveCredentialInput) =>
      client.request(IPC.passwordManagerRemoveCredential, projectId, input) as Promise<RemoveCredentialResult>,
    revealCredential: (projectId: string, managerId: string, credentialId: string) =>
      client.request(
        IPC.passwordManagerRevealCredential,
        projectId,
        managerId,
        credentialId
      ) as Promise<RevealCredentialResult>,
    credentialCode: (projectId: string, managerId: string, credentialId: string) =>
      client.request(
        IPC.passwordManagerCredentialCode,
        projectId,
        managerId,
        credentialId
      ) as Promise<CredentialCodeResult>,
    // REAL: registerPasswordManagerHandlers runs in the Server Edition too, so the browser gets
    // the same list rather than a stub that would leave a manager showing a count and no rows.
    listCredentials: (projectId: string, managerId: string) =>
      client.request(
        IPC.passwordManagerListCredentials,
        projectId,
        managerId
      ) as Promise<ListCredentialsResult>
  }
  return { passwordManager }
}

/** Provider profiles and local bindings over the same core RPC seam as Electron preload. */
export function buildProviderAccountsApi(client: RpcClient): Pick<NodeTerminalApi, 'providerAccounts'> {
  const providerAccounts: ProviderAccountsApi = {
    snapshot: () => client.request(IPC.providerAccountsSnapshot) as Promise<ProviderAccountsSnapshot>,
    createProfile: (input: ProviderProfileInput) => client.request(IPC.providerAccountsCreateProfile, input) as Promise<ProviderProfile>,
    updateProfile: (id: string, input: Partial<ProviderProfileInput>) =>
      client.request(IPC.providerAccountsUpdateProfile, id, input) as Promise<ProviderProfile | null>,
    removeProfile: (id: string) => client.request(IPC.providerAccountsRemoveProfile, id) as Promise<boolean>,
    setCredential: (input: ProviderCredentialInput) =>
      client.request(IPC.providerAccountsSetCredential, input) as Promise<ProviderProfile | null>,
    clearCredential: (id: string) => client.request(IPC.providerAccountsClearCredential, id) as Promise<boolean>,
    selectProfile: (id: string | null) =>
      client.request(IPC.providerAccountsSelectProfile, id) as Promise<ProviderAccountsSnapshot>,
    bind: (input: ProviderBindingInput) => client.request(IPC.providerAccountsBind, input) as Promise<import('../../shared/provider-accounts').ProviderBinding>,
    unbind: (id: string) => client.request(IPC.providerAccountsUnbind, id) as Promise<boolean>,
    startOAuth: (input: OAuthStartInput) => client.request(IPC.providerAccountsOAuthStart, input) as ReturnType<ProviderAccountsApi['startOAuth']>,
    completeOAuth: (input: OAuthCompleteInput) => client.request(IPC.providerAccountsOAuthComplete, input) as Promise<ProviderProfile | null>,
    cancelOAuth: (id: string) => client.request(IPC.providerAccountsOAuthCancel, id) as Promise<boolean>,
    onChanged: (listener) => client.subscribe(IPC.providerAccountsChanged, listener as Listener)
  }
  return { providerAccounts }
}

/** Build the host-owned Multiverse door-entry vault API. Credential values are sent only for the
 * immediate configure or verify request and the server returns no stored value. */
export function buildUniverseDoorEntryApi(client: RpcClient): Pick<NodeTerminalApi, 'universeDoorEntry'> {
  return {
    universeDoorEntry: {
      configure: (input) => client.request(IPC.universeDoorEntryConfigure, input) as ReturnType<NodeTerminalApi['universeDoorEntry']['configure']>,
      verify: (input) => client.request(IPC.universeDoorEntryVerify, input) as ReturnType<NodeTerminalApi['universeDoorEntry']['verify']>,
      remove: (doorId) => client.request(IPC.universeDoorEntryRemove, doorId) as ReturnType<NodeTerminalApi['universeDoorEntry']['remove']>
    }
  }
}

/**
 * Build the `claude` namespace over an RpcClient. `cliCaps` is a REAL handler on the server
 * (`registerClaudeCliIpc` runs in the server shell too), so the browser resolves the very same
 * `--permission-mode auto` version gate as desktop instead of silently no-opping into "auto
 * unsupported" — which would strip the flag from every Claude launch in the Server Edition.
 * A failed request degrades to the fail-open caps (bare command), never a rejection: the launch
 * path awaits this.
 *
 * `readTranscript` stays STUBBED here on purpose. This builder is shared with the relay
 * (`relay-api.ts`), where the transcripts that matter live on the HOST while this namespace's
 * only real member is a capability probe — the Server Edition gets the real reader from
 * `buildTranscriptApi` below instead, which the relay does not use.
 */
/**
 * The `codex` namespace over an RpcClient — a REAL implementation, not a stub, because the answer
 * has to come from the machine the pty runs on. Today the Server Edition's handler deliberately
 * answers `{ shared: false }` (see server/handlers/index.ts); wiring that side later needs nothing
 * here. A failed request degrades to the same conservative answer: the launch path reads it.
 */
export function buildCodexApi(client: RpcClient): CodexApi {
  return {
    identityCaps: () =>
      (client.request(IPC.codexIdentityCaps) as Promise<CodexIdentityCaps>).catch(
        () => UNKNOWN_CODEX_IDENTITY_CAPS
      ),
    onIdentity: (listener) => client.subscribe(IPC.codexIdentity, listener as Listener)
  }
}

export function buildClaudeApi(client: RpcClient, stub: ClaudeApi): ClaudeApi {
  return {
    ...stub,
    cliCaps: () =>
      (client.request(IPC.claudeCliCaps) as Promise<ClaudeCliCaps>).catch(
        () => UNKNOWN_CLAUDE_CLI_CAPS
      )
  }
}

/**
 * The transcript search and two READ channels, now that `registerTranscriptIpc` serves all three
 * in the server shell too. Before this the browser search stayed on the stub while the read stubs
 * rejected, so command-palette search returned nothing and every session looked empty.
 *
 * Server Edition ONLY (see buildClaudeApi's note): the server runs on the machine whose
 * transcripts these are, so no `nodeId` remote leg is needed — the argument still rides along
 * because the channel is shared with desktop.
 */
export function buildTranscriptApi(
  client: RpcClient
): Pick<NodeTerminalApi, 'chat' | 'transcripts'> & { claudeReadTranscript: ClaudeApi['readTranscript'] } {
  return {
    transcripts: {
      search: (query) =>
        client.request(IPC.transcriptSearch, query) as ReturnType<NodeTerminalApi['transcripts']['search']>
    },
    chat: {
      readTranscript: (sessionId, cwd, accountId, nodeId) =>
        client.request(
          IPC.chatReadTranscript,
          sessionId,
          cwd,
          accountId,
          nodeId
        ) as Promise<ChatTranscriptResult>
    },
    claudeReadTranscript: (sessionId, cwd, accountId, nodeId) =>
      client.request(
        IPC.claudeReadTranscript,
        sessionId,
        cwd,
        accountId,
        nodeId
      ) as Promise<TranscriptLine[]>
  }
}

/**
 * Managed CLAUDE accounts over the WS bridge (issue #313). REAL, not a stub: the lifecycle moved
 * into `src/core/claude-accounts-service.ts`, so the server registers the same four channels the
 * desktop does and the browser can create, log into and remove accounts. Deliberately NOT added to
 * `relay-api.ts` — a relay tab drives someone else's machine, and minting an account there would
 * create it on the HOST while this renderer's settings.json records it as one of its own.
 *
 * `waitLogin` is a straight passthrough of a poll that runs up to 5 minutes. That is safe because
 * RpcClient has no request timeout: a pending request rejects only when the socket drops, which is
 * exactly the outcome the caller wants (the login row stays pending and offers Retry).
 *
 * The `codexAccounts` namespace stays STUBBED (E_UNSUPPORTED). Its switch verbs authorize the
 * owning window by Electron WebContents id, which has no meaning over a WS connection — porting it
 * needs a connection-identity design, not a builder.
 */
export function buildClaudeAccountsApi(client: RpcClient): Pick<NodeTerminalApi, 'claudeAccounts'> {
  return {
    claudeAccounts: {
      add: (ctx) =>
        client.request(IPC.claudeAccountsAdd, ctx) as Promise<{
          id: string
          configDir: string
          versionSupported: boolean
        }>,
      waitLogin: (id, ctx) =>
        client.request(IPC.claudeAccountsWaitLogin, id, ctx) as Promise<{ email: string } | null>,
      cancelWaitLogin: (id) =>
        client.request(IPC.claudeAccountsCancelWait, id) as Promise<void>,
      remove: (id, ctx) => client.request(IPC.claudeAccountsRemove, id, ctx) as Promise<void>
    }
  }
}

/** WS URL for the current page: same host, `/ws`, ws→http / wss→https. */
function wsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/ws`
}

// ── Reconnect overlay (kept out of RpcClient's unit-tested core) ────────────────────────────
const OVERLAY_ID = 'nt-reconnect-overlay'

/** Is the reconnect overlay currently mounted? Exported for the unit test. */
export function isOverlayMounted(): boolean {
  return typeof document !== 'undefined' && document.getElementById(OVERLAY_ID) !== null
}

/** Mount the full-screen "reconnecting" overlay (idempotent). Exported so both the initial-connect
 *  failure path and the later onClose path — and the unit test — mount the identical UI. */
export function showReconnectOverlay(): void {
  if (typeof document === 'undefined' || document.getElementById(OVERLAY_ID)) return
  const el = document.createElement('div')
  el.id = OVERLAY_ID
  el.setAttribute('data-nt-reconnect', '')
  // M3 tokens with literal fallbacks: this can mount before the app's own stylesheet has
  // painted (an initial-connect failure races React's first render), so the fallback is what
  // actually renders in that split second and the var() takes over once styles.css is live —
  // which is also what keeps this overlay in step with the app's own light/dark switch instead
  // of a fixed dark-only wash.
  el.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:var(--md-scrim,rgba(0,0,0,0.6));color:var(--md-on-surface,#E6E0E9);' +
    'font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;padding:24px'
  el.textContent = mapLocalVocabularyText('Connection lost — reconnecting…')
  document.body.appendChild(el)
}

/** Retry the WS with backoff (1s→2s→4s→…→10s cap). On the first successful reopen, reload the
 *  page (the reloaded app re-runs `pty.create` per node with the same persistKey → tmux warm
 *  reattach). After 3 consecutive failed retries, bounce to `/login` (assume auth expired). */
function startReconnect(): void {
  showReconnectOverlay()
  let attempt = 0
  let failures = 0

  const tryOnce = (): void => {
    let probe: WebSocket
    try {
      probe = new WebSocket(wsUrl())
    } catch {
      scheduleRetry()
      return
    }
    probe.binaryType = 'arraybuffer'
    const cleanup = (): void => {
      probe.onopen = null
      probe.onerror = null
      probe.onclose = null
    }
    probe.onopen = () => {
      cleanup()
      try {
        probe.close()
      } catch {
        /* ignore */
      }
      location.reload()
    }
    probe.onerror = () => {
      // Let onclose drive the retry/failure counting (fires after error).
    }
    probe.onclose = () => {
      cleanup()
      failures++
      if (failures >= 3) {
        location.href = '/login'
        return
      }
      scheduleRetry()
    }
  }

  const scheduleRetry = (): void => {
    const delay = Math.min(1000 * 2 ** attempt, 10000)
    attempt++
    setTimeout(tryOnce, delay)
  }

  scheduleRetry()
}

/**
 * Connect the WS bridge and install `window.nodeTerminal`. Awaited by main.tsx's bootstrap
 * before the app boots, so the real namespaces are present on first render. Resolves `true` once
 * the socket is open and `window.nodeTerminal` is assigned; resolves `false` on the initial-connect
 * failure path (overlay shown, reconnect loop running) so bootstrap can skip loading the app.
 */
export async function installWsBridge(): Promise<boolean> {
  const client = new RpcClient(new WebSocketFrameTransport(wsUrl()))
  try {
    await client.ready()
  } catch {
    // First connection failed (server down at page load, or the socket errored before opening).
    // Show the SAME reconnect overlay + backoff loop as a later drop instead of rejecting — a
    // rejection here would bubble out of bootstrap() and leave a blank screen. `startReconnect`
    // reloads the page on the first successful reopen, which re-runs installWsBridge cleanly.
    // Return false so bootstrap skips `import('./boot')` — booting the app with an undefined
    // `window.nodeTerminal` throws under the (opaque) overlay.
    startReconnect()
    return false
  }
  client.onClose(() => startReconnect())
  const stubApi = buildStubApi()
  const api: NodeTerminalApi = {
    ...stubApi,
    ...buildRealApi(client),
    ...buildServerFilesApi(client),
    ...buildAgentApi(client),
    ...buildCanvasApi(client),
    ...buildPresenceApi(client),
    ...buildSpeechApi(client),
    ...buildConverterApi(client),
    ...buildNodeDependenciesApi(client),
    ...buildAwsWizardModelsApi(client),
    ...buildAwsIdentityApi(client),
    ...buildOllamaApi(client),
    ...buildRepositoryGraphApi(client),
    ...buildUniGetUiApi(client),
    ...buildCloudflareCoreManagersApi(client),
    ...buildMinecraftApi(client),
    ...buildDockerHostApi(client),
    ...buildTorrentApi(client),
    ...buildVirtualMachineApi(client),
    ...buildCalendarApi(client),
    ...buildProviderServicesApi(client),
    ...buildCloudflareTunnelApi(client),
    ...buildRemoteOAuthApi(client),
    ...buildHomeAssistantApi(client),
    ...buildHomeAssistantControlApi(client),
    ...buildHomeAssistantSensorApi(client),
    ...buildCloudflareZeroTrustApi(client),
    ...buildUsageApi(client),
    ...buildSessionMemoryApi(client),
    ...buildVsCodeApi(client),
    ...buildWslApi(client),
    ...buildWindowsDiagnosticsApi(client),
    ...buildLocalHistoryApi(client),
    ...buildToylockApi(client),
    ...buildAuthenticatorApi(client),
    ...buildPasswordManagerApi(client),
    ...buildProviderAccountsApi(client),
    ...buildUniverseDoorEntryApi(client),
    ...buildGitHubApi(client),
    ...buildAwsResourceManagersApi(client),
    ...buildClaudeAccountsApi(client),
    codex: buildCodexApi(client),
    // `claude` is assembled from two builders: `cliCaps` from the relay-shared one, and the
    // transcript reader from the Server-Edition-only one (which also supplies `chat`).
    ...(() => {
      const t = buildTranscriptApi(client)
      return {
        transcripts: t.transcripts,
        chat: t.chat,
        claude: { ...buildClaudeApi(client, stubApi.claude), readTranscript: t.claudeReadTranscript }
      }
    })(),
    // Web replacement for the Electron native dialog: an in-app server-directory browser over
    // fs.list (the stub's E_UNSUPPORTED reject is dropped in favor of this real picker).
    dialog: (() => {
      mountPickerRoot()
      const startDir = '/' // navigable up/down from root; the picker remembers nothing across calls in v1
      return {
        selectFolder: () => openDirectoryPicker({ mode: 'folder', startDir, list: api.fs.list }),
        selectFile: () => openDirectoryPicker({ mode: 'file', startDir, list: api.fs.list }),
        // No native multi-file dialog in the browser. FileConverterPanel checks isBrowserRuntime()
        // and uses a plain <input type="file" multiple> + files.saveUploadBlob instead of calling
        // this (falling back to saveUpload for API compatibility).
        selectFiles: () => Promise.resolve(null)
      }
    })()
  }
  ;(window as unknown as { nodeTerminal: NodeTerminalApi }).nodeTerminal = api
  return true
}
