import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import { resolveUiScale } from '../shared/ui-scale'
import type {
  CanvasMutation,
  CanvasState,
  CanvasWidgetLiveState,
  ClipboardWriteOptions,
  NodeTerminalApi,
  PairingDoneResult,
  Project,
  PtyCreateOptions,
  PtyPressure,
  LogRecord,
  RecycledInfo,
  RelayPeerPending,
  RemoteUsageQuery,
  ServerDeploymentStage,
  SessionMemoryQuery,
  UpdateInfo,
  UpdateProgress,
  Workspace,
  WorkspaceMigrationKind
} from '../shared/types'
import type { ScheduledSettingsActiveState, ScheduledSettingsFile } from '../shared/scheduled-settings'
import type { PlannerFile, PlannerLoadState, PlannerOccurrence } from '../shared/planner-occurrences'
import type { HistoryFilters } from '../shared/local-history'
import type { ClientId, PeerDiff, PeerIdentity, PeerState } from '../shared/presence'
import type { ConvertQueueItem, ConverterQueueState } from '../shared/converter'
import type { PullQueueItem, PullQueueState } from '../shared/ollama'
import type { DockerHostAction, DockerHostJobProgress } from '../shared/docker-host-manager'
import type { MinecraftEvent } from '../shared/minecraft'
import type { NodeDependencyAvailability, NodeDependencyProgress, NodeDependencyInstallResult } from '../shared/node-dependencies'
import type { WslCreateProgress } from '../shared/wsl'
import type { TorrentTaskState } from '../shared/torrent'
import type { VirtualMachineEvent } from '../shared/virtual-machine'
import type { CalendarProvider } from '../shared/calendar'
import type { ProjectConsentRequest, ProjectSetupEvent } from '../shared/project-settings'

// Fan a single ipcRenderer listener per channel out to many renderer subscribers. Without
// this, every node that subscribes (e.g. Cmd+M markdown toggle on each terminal/editor) adds
// its own ipcRenderer listener, tripping Node's MaxListeners (>10) warning. Returns unsubscribe.
function subscribe<A extends unknown[] = []>(channel: string) {
  const listeners = new Set<(...args: A) => void>()
  let handler: ((e: unknown, ...args: A) => void) | null = null
  return (listener: (...args: A) => void): (() => void) => {
    if (!handler) {
      handler = (_e, ...args) => listeners.forEach((l) => l(...args))
      ipcRenderer.on(channel, handler)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && handler) {
        ipcRenderer.removeListener(channel, handler)
        handler = null
      }
    }
  }
}

// Fan-out subscriber for the host's inbound apply-mutation events (a single ipcRenderer
// listener shared by all renderer subscribers, like the other event channels).
const subscribeMutation = subscribe<[CanvasMutation]>(IPC.remoteHostApplyMutation)
// Fan-out subscriber for the connection-approval prompt (main → host renderer when a client
// finishes the handshake; carries the SAS to show in the approval dialog).
const subscribePeerPending = subscribe<[{ sas: string | null; id: string; pub?: string | null }]>(
  IPC.remoteHostPeerPending
)
const subscribePeerPendingCleared = subscribe<[{ id: string | null; pub?: string | null }]>(
  IPC.remoteHostPeerPendingCleared
)

// New relay tunnel (Stage 4). Non-per-id host events reuse the fan-out helper; per-connection
// client events (sas/approved/frame/closed) attach directly per connectionId.
const subscribeConverterItem = subscribe<[ConvertQueueItem]>(IPC.converterItem)
const subscribeConverterSummary = subscribe<
  [Pick<ConverterQueueState, 'running' | 'scanning' | 'concurrency' | 'total'>]
>(IPC.converterSummary)
const subscribeOllamaPullItem = subscribe<[PullQueueItem]>(IPC.ollamaPullItem)
const subscribeOllamaPullSummary = subscribe<[Pick<PullQueueState, 'running' | 'concurrency'>]>(
  IPC.ollamaPullSummary
)
const subscribeOllamaChatStream = subscribe<
  [{ sessionId: string; kind: 'token' | 'done' | 'error' | 'stopped'; delta?: string; error?: string }]
>(IPC.ollamaChatStream)
const subscribeMinecraftEvent = subscribe<[MinecraftEvent]>(IPC.minecraftEvent)
const subscribeNodeDependencyState = subscribe<[NodeDependencyAvailability]>(IPC.nodeDependencyState)
const subscribeNodeDependencyProgress = subscribe<[NodeDependencyProgress]>(IPC.nodeDependencyProgress)
const subscribeTorrentTask = subscribe<[TorrentTaskState]>(IPC.torrentTask)
const subscribeVirtualMachineEvent = subscribe<[VirtualMachineEvent]>(IPC.virtualMachineEvent)
const subscribeWidgetState = subscribe<[CanvasWidgetLiveState]>(IPC.widgetStateChanged)

const subscribeRelayPeerPending = subscribe<[RelayPeerPending]>(IPC.relayHostPeerPending)
const subscribeRelayHostOpen = subscribe<[{ id: string; email?: string }]>(IPC.relayHostOpen)
const subscribeRelayHostClosed = subscribe<[{ id: string }]>(IPC.relayHostClosed)

// Scheduled settings (docs/scheduled-settings.md): the resolved-schedule push can have more than
// one subscriber at once (the Settings → Schedule panel AND the always-mounted apply-controller in
// Canvas.tsx), so it goes through the fan-out helper like the other broadcast channels above.
const subscribeScheduledSettingsActive = subscribe<[ScheduledSettingsActiveState]>(
  IPC.scheduledSettingsActiveChange
)
const subscribePlannerOccurrence = subscribe<[PlannerOccurrence]>(IPC.plannerOccurrence)
// Project setup/archive (SDD: 2026-08-19-project-settings-trust): global (not per-project) main →
// renderer prompts, fanned out the same way as the relay events above.
const subscribeProjectSetupConsentRequest = subscribe<[ProjectConsentRequest]>(
  IPC.projectSetupConsentRequest
)
const subscribeProjectSetupConsentDismiss = subscribe<[{ requestId: string }]>(
  IPC.projectSetupConsentDismiss
)
// Not per-project like githubIssuesChanged: `project-trust:changed` is one global channel whose
// payload carries the projectId, fanned out the same way — nobody broadcasts it yet (Task 2), but
// the renderer cache subscribes ahead of the emitter.
const subscribeProjectTrustChanged = subscribe<[{ projectId: string }]>(IPC.projectTrustChanged)

const api: NodeTerminalApi = {
  pty: {
    create: (options: PtyCreateOptions) => ipcRenderer.invoke(IPC.ptyCreate, options),
    write: (sessionId, data) => ipcRenderer.send(IPC.ptyWrite, sessionId, data),
    resize: (sessionId, cols, rows, viewerId) =>
      ipcRenderer.send(IPC.ptyResize, sessionId, cols, rows, viewerId),
    setFlow: (sessionId, resume, viewerId) =>
      ipcRenderer.send(IPC.ptyFlow, sessionId, resume, viewerId),
    kill: (sessionId, viewerId) => ipcRenderer.send(IPC.ptyKill, sessionId, viewerId),
    destroy: (persistKey, opts) =>
      ipcRenderer.invoke(IPC.ptyDestroy, persistKey, opts?.everySocket === true),
    recycle: (persistKey) => ipcRenderer.invoke(IPC.ptyRecycle, persistKey),
    recycleConfirmed: (persistKey, target) =>
      target === undefined
        ? ipcRenderer.invoke(IPC.ptyRecycleConfirmed, persistKey)
        : ipcRenderer.invoke(IPC.ptyRecycleConfirmed, persistKey, target),
    generateName: (persistKey, cwd) => ipcRenderer.invoke(IPC.ptyGenerateName, persistKey, cwd),
    generateGroupName: (memberKeys, cwd) =>
      ipcRenderer.invoke(IPC.ptyGenerateGroupName, memberKeys, cwd),
    capture: (persistKey, full) => ipcRenderer.invoke(IPC.ptyCapture, persistKey, full),
    readScrollback: (persistKey) => ipcRenderer.invoke(IPC.ptyReadScrollback, persistKey),
    sendText: (persistKey, text, opts) =>
      ipcRenderer.invoke(IPC.ptySendText, persistKey, text, opts?.enter),
    // `executeLaunchIntent` is deliberately NOT exposed yet.
    //
    // The renderer decides whether to use the structured launch path by asking whether this
    // function exists on the bridge (`supportsStructuredLaunch`). Exposing it here made that
    // answer yes on every Windows install — while `registerLaunchIntentIpc` is never called from
    // the main process and `PtyManager` has no `executeLaunchIntent` method at all. So the whole
    // feature is absent, and every agent launch that took this route rejected with Electron's
    // "No handler registered for 'pty:execute-launch-intent'".
    //
    // A bridge member is a capability CLAIM, and a claim main cannot answer is worse than a
    // missing one: the renderer has no way to tell the difference until the call fails. Restore
    // this line in the same change that implements the manager method and registers the handler
    // — not before.
    tmuxStatus: () => ipcRenderer.invoke(IPC.ptyTmuxStatus),
    paneCommand: (persistKey) => ipcRenderer.invoke(IPC.ptyPaneCommand, persistKey),
    correctTeamLeadPaneWidth: (persistKey) =>
      ipcRenderer.invoke(IPC.ptyCorrectTeamPaneWidth, persistKey),
    terminateForeground: (persistKey, expectedAgentId) =>
      ipcRenderer.invoke(IPC.ptyTerminateForeground, persistKey, expectedAgentId),
    readSessionName: (sessionId, accountId, agentId) =>
      ipcRenderer.invoke(IPC.ptyReadSessionName, sessionId, accountId, agentId),
    onData: (sessionId, listener) => {
      const channel = IPC.ptyData(sessionId)
      const handler = (_e: unknown, data: string) => listener(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onExit: (sessionId, listener) => {
      const channel = IPC.ptyExit(sessionId)
      const handler = (_e: unknown, code: number) => listener(code)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onSize: (sessionId, listener) => {
      const channel = IPC.ptySize(sessionId)
      const handler = (_e: unknown, size: { cols: number; rows: number }) => listener(size)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onClosed: (sessionId, listener) => {
      const channel = IPC.ptyClosed(sessionId)
      const handler = (_e: unknown, info: { by: ClientId | null }) => listener(info)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onRecycled: (sessionId, listener) => {
      const channel = IPC.ptyRecycled(sessionId)
      const handler = (_e: unknown, info: RecycledInfo): void => listener(info)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onResync: (sessionId, listener) => {
      const channel = IPC.ptyResync(sessionId)
      const handler = (_e: unknown, screen: string) => listener(screen)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  providerServices: {
    catalog: () => ipcRenderer.invoke(IPC.providerCatalog),
    accounts: (providerId?: string) => ipcRenderer.invoke(IPC.providerAccounts, providerId),
    resources: (accountId: string, capability?: string) => ipcRenderer.invoke(IPC.providerResources, accountId, capability),
    beginOAuth: (providerId: string) => ipcRenderer.invoke(IPC.providerBeginOAuth, providerId),
    completeOAuth: (callbackUrl: string) => ipcRenderer.invoke(IPC.providerCompleteOAuth, callbackUrl),
    removeAccount: (accountId: string) => ipcRenderer.invoke(IPC.providerRemoveAccount, accountId)
  },
  awsManagers: {
    catalog: () => ipcRenderer.invoke(IPC.awsManagerCatalog),
    availability: (manager) => ipcRenderer.invoke(IPC.awsManagerAvailability, manager),
    list: (request) => ipcRenderer.invoke(IPC.awsManagerList, request),
    run: (request) => ipcRenderer.invoke(IPC.awsManagerRun, request),
    progress: (jobId) => ipcRenderer.invoke(IPC.awsManagerProgress, jobId),
    cancel: (jobId) => ipcRenderer.invoke(IPC.awsManagerCancel, jobId),
    retry: (jobId) => ipcRenderer.invoke(IPC.awsManagerRetry, jobId)
  },
  workspace: {
    load: () => ipcRenderer.invoke(IPC.workspaceLoad),
    save: (workspace: Workspace) => ipcRenderer.invoke(IPC.workspaceSave, workspace),
    probeFolder: (folder: string) => ipcRenderer.invoke(IPC.workspaceProbeFolder, folder),
    hasPartsManifest: (cwd: string) => ipcRenderer.invoke(IPC.workspaceHasPartsManifest, cwd),
    splitIntoParts: (cwd: string, sizeValue: number, sizeUnit: 'KB' | 'MB' | 'GB') =>
      ipcRenderer.invoke(IPC.workspaceSplitIntoParts, cwd, sizeValue, sizeUnit),
    joinParts: (cwd: string) => ipcRenderer.invoke(IPC.workspaceJoinParts, cwd),
    exportProject: (project: Project, password?: string) =>
      ipcRenderer.invoke(IPC.projectArchiveExport, project, password),
    importProject: (opts?: { path?: string; password?: string }) =>
      ipcRenderer.invoke(IPC.projectArchiveImport, opts),
    portableBindings: {
      state: (input: { nodeId: string; featureId: string; displayLabel: string; hasMissingAssets?: boolean }) =>
        ipcRenderer.invoke(IPC.portableBindingState, input),
      apply: (input: { nodeId: string; action: import('../shared/types').PortableBindingAction; featureId?: string; providerAccountId?: string; resourceId?: string }) =>
        ipcRenderer.invoke(IPC.portableBindingApply, input)
    },
    onArchiveProgress: (cb: (event: import('../shared/types').ProjectArchiveProgress) => void) => {
      const handler = (_event: unknown, progress: import('../shared/types').ProjectArchiveProgress) => cb(progress)
      ipcRenderer.on(IPC.projectArchiveProgress, handler)
      return () => ipcRenderer.removeListener(IPC.projectArchiveProgress, handler)
    },
    cancelArchiveImport: () => ipcRenderer.invoke(IPC.projectArchiveCancel),
    archiveLadderIssue: (filePath: string) =>
      ipcRenderer.invoke(IPC.projectArchiveLadderIssue, filePath),
    archiveLadderVerify: (input: unknown) =>
      ipcRenderer.invoke(IPC.projectArchiveLadderVerify, input),
    projectFileState: (folder: string) => ipcRenderer.invoke(IPC.workspaceProjectFileState, folder),
    onMigrated: (cb: (kind: WorkspaceMigrationKind) => void) => {
      // Older mains broadcast no payload; that was the v2→v3 migration.
      const h = (_e: unknown, kind?: WorkspaceMigrationKind) => cb(kind ?? 'v2')
      ipcRenderer.on(IPC.workspaceMigrated, h)
      return () => ipcRenderer.removeListener(IPC.workspaceMigrated, h)
    },
    onCorruptRecovered: (cb: (backupFile: string) => void) => {
      const h = (_e: unknown, backupFile: string) => cb(backupFile)
      ipcRenderer.on(IPC.workspaceCorruptRecovered, h)
      return () => ipcRenderer.removeListener(IPC.workspaceCorruptRecovered, h)
    },
    onExternalChange: (cb: (project: Project) => void) => {
      const h = (_e: unknown, p: Project) => cb(p)
      ipcRenderer.on(IPC.workspaceExternalChange, h)
      return () => ipcRenderer.removeListener(IPC.workspaceExternalChange, h)
    }
  },
  timer: {
    occurrences: () => ipcRenderer.invoke(IPC.timerOccurrencesLoad),
    schedule: (timerId: string, scheduledAt: number) => ipcRenderer.invoke(IPC.timerOccurrenceSchedule, timerId, scheduledAt),
    transition: (id: string, state: string) => ipcRenderer.invoke(IPC.timerOccurrenceTransition, id, state),
    lap: (id: string, elapsedMs: number) => ipcRenderer.invoke(IPC.timerOccurrenceLap, id, elapsedMs)
  },
  serverDeployment: {
    start: () => ipcRenderer.invoke(IPC.serverDeploymentStart),
    currentTotp: () => ipcRenderer.invoke(IPC.serverDeploymentTotp),
    status: () => ipcRenderer.invoke(IPC.serverDeploymentStatus),
    onProgress: (cb: (stage: ServerDeploymentStage) => void) => {
      const h = (_e: unknown, stage: ServerDeploymentStage) => cb(stage)
      ipcRenderer.on(IPC.serverDeploymentProgress, h)
      return () => ipcRenderer.removeListener(IPC.serverDeploymentProgress, h)
    }
  },
  projectSettings: {
    read: (projectId: string) => ipcRenderer.invoke(IPC.projectSettingsRead, projectId),
    writeShared: (projectId: string, doc) =>
      ipcRenderer.invoke(IPC.projectSettingsWriteShared, projectId, doc),
    updateLocal: (projectId: string, local) =>
      ipcRenderer.invoke(IPC.projectSettingsUpdateLocal, projectId, local),
    launchInfo: (projectId: string) => ipcRenderer.invoke(IPC.projectSettingsLaunchInfo, projectId),
    onTrustChanged: subscribeProjectTrustChanged
  },
  projectSetup: {
    // Wire carries exactly `(projectId, kind, worktreePath?)` — no rootPath/projectName/ssh: main
    // derives those itself from its own workspace index by projectId and never trusts what crosses
    // this wire (project-setup-handlers.ts's `registerProjectSetupHandlers`, Task 1 review finding).
    run: (projectId, kind, worktreePath) =>
      ipcRenderer.invoke(IPC.projectSetupRun, projectId, kind, worktreePath),
    cancel: (runKey: string) => ipcRenderer.invoke(IPC.projectSetupCancel, runKey),
    consent: async (requestId, answer) => {
      ipcRenderer.send(IPC.projectSetupConsentSubmit, requestId, answer)
    },
    requestTrust: (projectId, family) =>
      ipcRenderer.invoke(IPC.projectSetupRequestTrust, projectId, family),
    onConsentRequest: subscribeProjectSetupConsentRequest,
    onConsentDismiss: subscribeProjectSetupConsentDismiss,
    onEvent: (projectId, cb) => {
      const ch = IPC.projectSetupEvent(projectId)
      const handler = (_e: unknown, ev: ProjectSetupEvent): void => cb(ev)
      ipcRenderer.on(ch, handler)
      ipcRenderer.send(IPC.projectSetupSubscribe, projectId)
      return () => {
        ipcRenderer.removeListener(ch, handler)
        ipcRenderer.send(IPC.projectSetupUnsubscribe, projectId)
      }
    }
  },
  worktree: {
    // Wire carries exactly `(projectId, worktreePath)` — never the sharedPaths list: main reads it
    // itself by projectId and validates the path against the project's own git worktrees
    // (worktree-shared-paths-handlers.ts).
    materializeShared: (projectId: string, worktreePath: string) =>
      ipcRenderer.invoke(IPC.worktreeMaterializeShared, projectId, worktreePath)
  },
  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC.dialogSelectFolder),
    selectFile: () => ipcRenderer.invoke(IPC.dialogSelectFile),
    selectFiles: () => ipcRenderer.invoke(IPC.dialogSelectFiles)
  },
  settings: {
    load: () => ipcRenderer.invoke(IPC.settingsLoad),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings)
  },
  ...(process.platform === 'win32'
    ? {
        terminalProfiles: {
          list: () => ipcRenderer.invoke(IPC.terminalProfilesList),
          refresh: (customExecutable?: string) =>
            ipcRenderer.invoke(IPC.terminalProfilesRefresh, customExecutable)
        }
      }
    : {}),
  schoolMode: {
    load: () => ipcRenderer.invoke(IPC.schoolModeLoad),
    enable: (pin) => ipcRenderer.invoke(IPC.schoolModeEnable, pin),
    disable: (pin) => ipcRenderer.invoke(IPC.schoolModeDisable, pin),
    rename: (name) => ipcRenderer.invoke(IPC.schoolModeRename, name),
    changePin: (currentPin, nextPin) => ipcRenderer.invoke(IPC.schoolModeChangePin, currentPin, nextPin),
    hasCredential: () => ipcRenderer.invoke(IPC.schoolModeHasCredential),
    onChanged: subscribe(IPC.schoolModeChanged)
  },
  kidsMode: {
    load: () => ipcRenderer.invoke(IPC.kidsModeLoad),
    enable: (pin) => ipcRenderer.invoke(IPC.kidsModeEnable, pin),
    disable: (pin) => ipcRenderer.invoke(IPC.kidsModeDisable, pin),
    rename: (name) => ipcRenderer.invoke(IPC.kidsModeRename, name),
    changePin: (currentPin, nextPin) => ipcRenderer.invoke(IPC.kidsModeChangePin, currentPin, nextPin),
    hasCredential: () => ipcRenderer.invoke(IPC.kidsModeHasCredential),
    // Read-only PIN check for the grown-up screen's parent gate — never leaves kids mode, unlike
    // `disable`. Always goes over IPC: the renderer never holds or compares a PIN itself.
    verifyPin: (pin) => ipcRenderer.invoke(IPC.kidsModeVerifyPin, pin),
    onChanged: subscribe(IPC.kidsModeChanged)
  },
  scheduledSettings: {
    load: () => ipcRenderer.invoke(IPC.scheduledSettingsLoad),
    save: (file: ScheduledSettingsFile) => ipcRenderer.invoke(IPC.scheduledSettingsSave, file),
    setHomeAssistantToken: (ruleId: string, token: string | null) =>
      ipcRenderer.invoke(IPC.scheduledSettingsSetHaToken, ruleId, token),
    tokenStatus: () => ipcRenderer.invoke(IPC.scheduledSettingsTokenStatus),
    refreshRule: (ruleId: string) => ipcRenderer.invoke(IPC.scheduledSettingsRefreshRule, ruleId),
    activeState: () => ipcRenderer.invoke(IPC.scheduledSettingsActiveState),
    onActiveChange: subscribeScheduledSettingsActive
  },
  planner: {
    load: () => ipcRenderer.invoke(IPC.plannerLoad) as Promise<PlannerLoadState>,
    save: (file: PlannerFile) => ipcRenderer.invoke(IPC.plannerSave, file),
    history: () => ipcRenderer.invoke(IPC.plannerHistory),
    export: (format: 'json' | 'csv') => ipcRenderer.invoke(IPC.plannerExport, format),
    onOccurrence: subscribePlannerOccurrence
  },
  githubIssues: {
    subscribe: (projectId) => ipcRenderer.invoke(IPC.githubIssuesSubscribe, { projectId }),
    unsubscribe: async (projectId) => {
      ipcRenderer.send(IPC.githubIssuesUnsubscribe, projectId)
    },
    query: (request) => ipcRenderer.invoke(IPC.githubIssuesQuery, request),
    refresh: (projectId, full) => ipcRenderer.invoke(IPC.githubIssuesRefresh, projectId, full),
    moveIssue: (request) => ipcRenderer.invoke(IPC.githubIssuesMove, request),
    createMissingLabels: (projectId) => ipcRenderer.invoke(IPC.githubIssuesCreateLabels, projectId),
    clearCache: (projectId) => ipcRenderer.invoke(IPC.githubIssuesClearCache, projectId),
    projectAvatar: (projectId) => ipcRenderer.invoke(IPC.githubProjectAvatar, projectId),
    onChanged: (projectId, listener) => {
      const channel = IPC.githubIssuesChanged(projectId)
      const handler = (_event: unknown, changed: number[]) => listener(changed)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
  },
  githubControl: {
    status: (projectId) => ipcRenderer.invoke(IPC.githubControlStatus, projectId),
    approve: (input) => ipcRenderer.invoke(IPC.githubControlApprove, input),
    revoke: (input) => ipcRenderer.invoke(IPC.githubControlRevoke, input),
    selectProvider: (input) => ipcRenderer.invoke(IPC.githubControlSelectProvider, input),
    saveToken: (token) => ipcRenderer.invoke(IPC.githubControlSaveToken, token),
    clearToken: () => ipcRenderer.invoke(IPC.githubControlClearToken)
  },
  speech: {
    // IPC carries the raw Float32 samples as an ArrayBuffer (structured clone; decodePcmPayload's
    // ArrayBuffer branch reads it directly, no re-encoding). A Float32Array view doesn't always
    // span its whole underlying buffer (e.g. a slice of a pooled/recycled buffer upstream), so a
    // non-spanning view is copied first — sending pcm.buffer as-is would leak neighboring bytes
    // (or the wrong region) into the transcription.
    transcribe: (pcm: Float32Array, language?: string, model?: string) => {
      const spansBuffer = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength
      const buffer = spansBuffer ? pcm.buffer : pcm.slice().buffer
      return ipcRenderer.invoke(IPC.speechTranscribe, { pcm: buffer, language, model })
    },
    models: () => ipcRenderer.invoke(IPC.speechModels),
    downloadModel: (id: string) => ipcRenderer.invoke(IPC.speechModelDownload, { id }),
    deleteModel: (id: string) => ipcRenderer.invoke(IPC.speechModelDelete, { id }),
    onProgress: (cb) => {
      const handler = (_e: unknown, p: { id: string; pct: number }) => cb(p)
      ipcRenderer.on(IPC.speechProgress, handler)
      return () => ipcRenderer.removeListener(IPC.speechProgress, handler)
    },
    micConsent: () => ipcRenderer.invoke(IPC.speechMicConsent)
  },
  ssh: {
    list: () => ipcRenderer.invoke(IPC.sshList),
    save: (server) => ipcRenderer.invoke(IPC.sshSave, server),
    remove: (id) => ipcRenderer.invoke(IPC.sshDelete, id),
    importCandidates: () => ipcRenderer.invoke(IPC.sshImport)
  },
  sshProject: {
    connect: (projectId, conn, remoteCwd) =>
      ipcRenderer.invoke(IPC.sshConnectProject, projectId, conn, remoteCwd),
    disconnect: (projectId) => ipcRenderer.invoke(IPC.sshDisconnectProject, projectId),
    killSessions: (projectId, nodeIds, opts) =>
      ipcRenderer.invoke(IPC.sshKillSessions, projectId, nodeIds, opts),
    listDir: (projectId, dir) => ipcRenderer.invoke(IPC.sshListDir, projectId, dir),
    mkdir: (projectId, dir) => ipcRenderer.invoke(IPC.sshMkdir, projectId, dir),
    uploadFile: (projectId, localPath, fileName) =>
      ipcRenderer.invoke(IPC.sshUploadFile, projectId, localPath, fileName),
    downloadFile: (projectId, remotePath, destDir) =>
      ipcRenderer.invoke(IPC.sshDownloadFile, projectId, remotePath, destDir),
    onStatus: (cb) => {
      const h = (_e: unknown, e: unknown) => cb(e as never)
      ipcRenderer.on(IPC.sshProjectStatus, h)
      return () => ipcRenderer.removeListener(IPC.sshProjectStatus, h)
    },
    submitPassphrase: (requestId, value) =>
      ipcRenderer.invoke(IPC.sshPassphraseSubmit, requestId, value),
    onPassphraseRequest: (cb) => {
      const h = (_e: unknown, e: unknown) => cb(e as never)
      ipcRenderer.on(IPC.sshPassphraseRequest, h)
      return () => ipcRenderer.removeListener(IPC.sshPassphraseRequest, h)
    },
    onPassphraseDismiss: (cb) => {
      const h = (_e: unknown, e: unknown) => cb(e as never)
      ipcRenderer.on(IPC.sshPassphraseDismiss, h)
      return () => ipcRenderer.removeListener(IPC.sshPassphraseDismiss, h)
    }
  },
  sshFs: {
    list: (projectId: string, path: string) => ipcRenderer.invoke(IPC.sshFsList, projectId, path),
    read: (projectId: string, path: string) => ipcRenderer.invoke(IPC.sshFsRead, projectId, path),
    readBinary: (projectId: string, path: string) =>
      ipcRenderer.invoke(IPC.sshFsReadBinary, projectId, path),
    write: (projectId: string, path: string, content: string) =>
      ipcRenderer.invoke(IPC.sshFsWrite, projectId, path, content),
    mkdir: (projectId: string, p: string) => ipcRenderer.invoke(IPC.sshFsMkdir, projectId, p),
    exists: (projectId: string, p: string) => ipcRenderer.invoke(IPC.sshFsExists, projectId, p),
    quickOpen: (projectId: string, cwd: string) =>
      ipcRenderer.invoke(IPC.sshFsQuickOpen, projectId, cwd)
  },
  git: {
    status: (cwd) => ipcRenderer.invoke(IPC.gitStatus, cwd),
    init: (cwd) => ipcRenderer.invoke(IPC.gitInit, cwd),
    clone: (parentDir, url) => ipcRenderer.invoke(IPC.gitClone, parentDir, url),
    cloneAbort: () => ipcRenderer.invoke(IPC.gitCloneAbort),
    cloneDefaultParent: () => ipcRenderer.invoke(IPC.gitCloneDefaultParent),
    onCloneProgress: (listener) => {
      const handler = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
      ipcRenderer.on(IPC.gitCloneProgress, handler)
      return () => ipcRenderer.removeListener(IPC.gitCloneProgress, handler)
    },
    commit: (cwd, message) => ipcRenderer.invoke(IPC.gitCommit, cwd, message),
    push: (cwd) => ipcRenderer.invoke(IPC.gitPush, cwd),
    pull: (cwd) => ipcRenderer.invoke(IPC.gitPull, cwd),
    sync: (cwd) => ipcRenderer.invoke(IPC.gitSync, cwd),
    publish: (cwd, name, isPrivate) => ipcRenderer.invoke(IPC.gitPublish, cwd, name, isPrivate),
    stage: (cwd, paths) => ipcRenderer.invoke(IPC.gitStage, cwd, paths),
    unstage: (cwd, paths) => ipcRenderer.invoke(IPC.gitUnstage, cwd, paths),
    stageAll: (cwd) => ipcRenderer.invoke(IPC.gitStageAll, cwd),
    unstageAll: (cwd) => ipcRenderer.invoke(IPC.gitUnstageAll, cwd),
    diff: (cwd, path, staged, untracked) =>
      ipcRenderer.invoke(IPC.gitDiff, cwd, path, staged, untracked),
    discard: (cwd, path, untracked) => ipcRenderer.invoke(IPC.gitDiscard, cwd, path, untracked),
    switchBranch: (cwd, name) => ipcRenderer.invoke(IPC.gitSwitchBranch, cwd, name),
    createBranch: (cwd, name) => ipcRenderer.invoke(IPC.gitCreateBranch, cwd, name),
    showFile: (cwd, ref, path) => ipcRenderer.invoke(IPC.gitShowFile, cwd, ref, path),
    generateMessage: (cwd) => ipcRenderer.invoke(IPC.commitGenerate, cwd),
    history: (cwd, options) => ipcRenderer.invoke(IPC.gitHistory, cwd, options),
    commitFiles: (cwd, oid) => ipcRenderer.invoke(IPC.gitCommitFiles, cwd, oid),
    remoteCommitUrl: (cwd, sha) => ipcRenderer.invoke(IPC.gitRemoteCommitUrl, cwd, sha),
    merge: (cwd, ref) => ipcRenderer.invoke(IPC.gitMerge, cwd, ref),
    rebase: (cwd, onto) => ipcRenderer.invoke(IPC.gitRebase, cwd, onto),
    deleteBranch: (cwd, name, force) => ipcRenderer.invoke(IPC.gitDeleteBranch, cwd, name, force),
    renameBranch: (cwd, newName) => ipcRenderer.invoke(IPC.gitRenameBranch, cwd, newName),
    fetch: (cwd) => ipcRenderer.invoke(IPC.gitFetch, cwd),
    forcePush: (cwd) => ipcRenderer.invoke(IPC.gitForcePush, cwd),
    stashPush: (cwd) => ipcRenderer.invoke(IPC.gitStashPush, cwd),
    stashPop: (cwd) => ipcRenderer.invoke(IPC.gitStashPop, cwd),
    revert: (cwd, oid) => ipcRenderer.invoke(IPC.gitRevert, cwd, oid),
    branchAt: (cwd, name, oid) => ipcRenderer.invoke(IPC.gitBranchAt, cwd, name, oid),
    checkoutCommit: (cwd, oid) => ipcRenderer.invoke(IPC.gitCheckoutCommit, cwd, oid),
    repoRoot: (cwd) => ipcRenderer.invoke(IPC.gitRepoRoot, cwd),
    worktreeList: (repoPath) => ipcRenderer.invoke(IPC.gitWorktreeList, repoPath),
    worktreeAdd: (repoPath, wtPath, branch, baseRef, isNew) =>
      ipcRenderer.invoke(IPC.gitWorktreeAdd, repoPath, wtPath, branch, baseRef, isNew),
    worktreeMerge: (repoPath, branch, baseRef, push) =>
      ipcRenderer.invoke(IPC.gitWorktreeMerge, repoPath, branch, baseRef, push),
    worktreeRemovalProof: (repoPath, wtPath) =>
      ipcRenderer.invoke(IPC.gitWorktreeRemovalProof, repoPath, wtPath),
    worktreeRemove: (repoPath, wtPath, request) =>
      ipcRenderer.invoke(IPC.gitWorktreeRemove, repoPath, wtPath, request),
    setActiveRemote: (projectId) => ipcRenderer.invoke(IPC.gitSetActiveRemote, projectId)
  },
  clipboard: {
    // Route to the MAIN process: renderer-side `clipboard` access is deprecated in Electron.
    // `reportFailure` is a browser-host presentation hint; desktop reports the outcome instead.
    writeText: async (text: string, _options?: ClipboardWriteOptions) => {
      try {
        return (await ipcRenderer.invoke(IPC.clipboardWrite, text)) === true
      } catch {
        // Legacy callers treated this operation as fire-and-forget. Never leak an unhandled IPC
        // rejection from those call sites; false remains an honest acknowledgement for awaiters.
        return false
      }
    },
    writeFiles: (paths: string[]) => ipcRenderer.invoke(IPC.clipboardWriteFiles, paths)
  },
  shell: {
    reveal: (path: string) => ipcRenderer.send(IPC.shellReveal, path),
    openPath: (path: string) => ipcRenderer.send(IPC.shellOpenPath, path),
    openExternal: (url: string) => ipcRenderer.send(IPC.shellOpenExternal, url),
    pickProjectIcon: () => ipcRenderer.invoke(IPC.shellPickProjectIcon)
  },
  canvasWidget: {
    open: (nodeId: string) => ipcRenderer.invoke(IPC.widgetOpen, nodeId),
    close: (nodeId: string) => ipcRenderer.invoke(IPC.widgetClose, nodeId),
    setAlwaysOnTop: (nodeId: string, alwaysOnTop: boolean) =>
      ipcRenderer.invoke(IPC.widgetSetAlwaysOnTop, nodeId, alwaysOnTop),
    getState: (nodeId: string) => ipcRenderer.invoke(IPC.widgetGetState, nodeId),
    onStateChanged: subscribeWidgetState
  },
  fs: {
    list: (dirPath: string) => ipcRenderer.invoke(IPC.fsList, dirPath),
    read: (filePath: string) => ipcRenderer.invoke(IPC.fsRead, filePath),
    readBinary: (filePath: string) => ipcRenderer.invoke(IPC.fsReadBinary, filePath),
    write: (filePath: string, content: string) => ipcRenderer.invoke(IPC.fsWrite, filePath, content),
    mkdir: (dirPath: string) => ipcRenderer.invoke(IPC.fsMkdir, dirPath),
    exists: (p: string) => ipcRenderer.invoke(IPC.fsExists, p)
  },
  media: {
    allow: (absPath: string) => ipcRenderer.invoke(IPC.mediaAllow, absPath),
    allowSsh: (projectId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sshMediaAllow, projectId, remotePath),
    writeHtml: (html: string) => ipcRenderer.invoke(IPC.mediaWriteHtml, html)
  },
  browser: {
    register: (webContentsId: number, nodeId: string, ownerNodeId?: string) =>
      ipcRenderer.send(IPC.browserRegister, webContentsId, nodeId, ownerNodeId),
    unregister: (webContentsId: number) => ipcRenderer.send(IPC.browserUnregister, webContentsId),
    onBrowserNewWindow: (listener) => {
      const handler = (_e: unknown, ev: { url: string; sourceNodeId: string }) => listener(ev)
      ipcRenderer.on(IPC.browserNewWindow, handler)
      return () => ipcRenderer.removeListener(IPC.browserNewWindow, handler)
    },
    extensions: {
      list: (partition) => ipcRenderer.invoke(IPC.browserExtensionsList, partition),
      pickDir: () => ipcRenderer.invoke(IPC.browserExtensionsPickDir),
      add: (partition, dirPath) => ipcRenderer.invoke(IPC.browserExtensionsAdd, partition, dirPath),
      remove: (partition, dirPath) => ipcRenderer.invoke(IPC.browserExtensionsRemove, partition, dirPath)
    }
    onLeaseChanged: (listener) => {
      const handler = (_e: unknown, push: Parameters<typeof listener>[0]) => listener(push)
      ipcRenderer.on(IPC.browserLeaseChanged, handler)
      return () => ipcRenderer.removeListener(IPC.browserLeaseChanged, handler)
    },
    stop: (nodeId: string) => ipcRenderer.send(IPC.browserStop, nodeId),
    stopAll: () => ipcRenderer.send(IPC.browserStopAll),
    stopProject: (projectId: string) => ipcRenderer.send(IPC.browserStopProject, projectId)
  },
  files: {
    quickOpen: (cwd: string) => ipcRenderer.invoke(IPC.filesQuickOpen, cwd),
    // Desktop has no HTTP surface to redeem a ticket on — the core handler answers null here, and
    // the Explorer reads that as "this shell downloads over scp instead" (SSH) or "the file is
    // already on this machine" (local project).
    downloadTicket: (p: string) => ipcRenderer.invoke(IPC.filesDownloadTicket, p),
    saveUpload: (name: string, dataBase64: string) =>
      ipcRenderer.invoke(IPC.filesSaveUpload, name, dataBase64),
    saveCanvasImage: (projectId: string, name: string, dataBase64: string) =>
      ipcRenderer.invoke(IPC.filesSaveCanvasImage, projectId, name, dataBase64)
  },
  updates: {
    onAvailable: (listener) => {
      const handler = (_e: unknown, info: UpdateInfo) => listener(info)
      ipcRenderer.on(IPC.appUpdateAvailable, handler)
      return () => ipcRenderer.removeListener(IPC.appUpdateAvailable, handler)
    },
    onDownloaded: (listener) => {
      const handler = (_e: unknown, info: UpdateInfo) => listener(info)
      ipcRenderer.on(IPC.appUpdateDownloaded, handler)
      return () => ipcRenderer.removeListener(IPC.appUpdateDownloaded, handler)
    },
    onProgress: (listener) => {
      const handler = (_e: unknown, p: UpdateProgress) => listener(p)
      ipcRenderer.on(IPC.appUpdateProgress, handler)
      return () => ipcRenderer.removeListener(IPC.appUpdateProgress, handler)
    },
    onError: (listener) => {
      const handler = (_e: unknown, message: string) => listener(message)
      ipcRenderer.on(IPC.appUpdateError, handler)
      return () => ipcRenderer.removeListener(IPC.appUpdateError, handler)
    },
    onNotAvailable: (listener) => {
      const handler = () => listener()
      ipcRenderer.on(IPC.appUpdateNotAvailable, handler)
      return () => ipcRenderer.removeListener(IPC.appUpdateNotAvailable, handler)
    },
    check: () => ipcRenderer.send(IPC.appCheckForUpdates),
    getVersion: () => ipcRenderer.invoke(IPC.appGetVersion),
    getPolicy: () => ipcRenderer.invoke(IPC.appUpdatePolicy),
    restart: () => ipcRenderer.send(IPC.appRestartToUpdate)
  },
  license: {
    upgrade: (target?: 'pro' | 'seats') => ipcRenderer.invoke(IPC.licenseUpgrade, target),
    activate: (key: string) => ipcRenderer.invoke(IPC.licenseActivate, key),
    deactivate: () => ipcRenderer.invoke(IPC.licenseDeactivate),
    getStatus: () => ipcRenderer.invoke(IPC.licenseStatus),
    detail: () => ipcRenderer.invoke(IPC.licenseDetail),
    releaseOthers: () => ipcRenderer.invoke(IPC.licenseRelease),
    onChange: (listener) => {
      const handler = (_e: unknown, s: Parameters<typeof listener>[0]) => listener(s)
      ipcRenderer.on(IPC.licenseChanged, handler)
      return () => ipcRenderer.removeListener(IPC.licenseChanged, handler)
    }
  },
  announcements: {
    fetch: () => ipcRenderer.invoke(IPC.announcementsFetch)
  },
  usage: {
    fetch: (accountId?: string) => ipcRenderer.invoke(IPC.usageFetch, accountId),
    refresh: (accountId?: string) => ipcRenderer.invoke(IPC.usageRefresh, accountId),
    providers: (force?: boolean) => ipcRenderer.invoke(IPC.usageProviders, force),
    remote: (query?: RemoteUsageQuery) => ipcRenderer.invoke(IPC.usageRemote, query),
    setProviderCookie: (provider: string, cookie: string) =>
      ipcRenderer.invoke(IPC.usageSetProviderCookie, provider, cookie),
    cookieProviders: () => ipcRenderer.invoke(IPC.usageCookieProviders),
    onUpdate: (listener) => {
      const handler = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
      ipcRenderer.on(IPC.usageUpdate, handler)
      return () => ipcRenderer.removeListener(IPC.usageUpdate, handler)
    }
  },
  // The query is forwarded VERBATIM: `remote` is the renderer's own "this scope is an SSH host"
  // claim, which the core service ORs with its own `isRemoteProject`. Normalizing it here (say,
  // dropping a `false`, or defaulting the object) would silently re-open the misattribution this
  // surface exists to prevent — one machine's sessions published under another's name.
  sessionMemory: {
    read: (q?: SessionMemoryQuery) => ipcRenderer.invoke(IPC.sessionMemory, q),
    host: (q?: SessionMemoryQuery) => ipcRenderer.invoke(IPC.sessionMemoryHost, q)
  },
  // WSL distribution management — Windows-only in practice (wsl.exe simply is not found
  // elsewhere); every call rejects honestly rather than resolving to a fabricated empty result.
  wsl: {
    list: () => ipcRenderer.invoke(IPC.wslList),
    catalogue: () => ipcRenderer.invoke(IPC.wslCatalogue),
    create: (input: { operationId: string; catalogueId: string; name: string }) => ipcRenderer.invoke(IPC.wslCreate, input),
    cancelCreate: (operationId: string) => ipcRenderer.invoke(IPC.wslCreateCancel, operationId),
    onCreateProgress: (listener: (progress: WslCreateProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: WslCreateProgress) => listener(progress)
      ipcRenderer.on(IPC.wslCreateProgress, handler)
      return () => ipcRenderer.removeListener(IPC.wslCreateProgress, handler)
    },
    sleep: (name: string) => ipcRenderer.invoke(IPC.wslSleep, name),
    wake: (name: string) => ipcRenderer.invoke(IPC.wslWake, name),
    delete: (name: string) => ipcRenderer.invoke(IPC.wslDelete, name)
  },
  vscode: {
    detect: () => ipcRenderer.invoke(IPC.vscodeDetect),
    open: (path: string) => ipcRenderer.invoke(IPC.vscodeOpen, path)
  },
  // Desktop's real "export.saveText": a native Save-As dialog + write, returning the chosen
  // path so the caller can offer "Open in Visual Studio Code" on it. `mimeType` travels for
  // parity with the Server Edition's Blob-download fallback (stubs.ts); the native path does not
  // need it (the OS's Save dialog is filename-driven, not MIME-driven).
  export: {
    saveText: (filename: string, content: string, mimeType: string) =>
      ipcRenderer.invoke(IPC.exportSaveText, filename, content, mimeType)
  },
  history: {
    list: (domain: string, filters?: HistoryFilters) =>
      ipcRenderer.invoke(IPC.historyList, domain, filters),
    restore: (domain: string, sha: string) => ipcRenderer.invoke(IPC.historyRestore, domain, sha)
  },
  toylock: {
    list: () => ipcRenderer.invoke(IPC.toylockList),
    createPassword: (input) => ipcRenderer.invoke(IPC.toylockCreatePassword, input),
    beginTotp: (input) => ipcRenderer.invoke(IPC.toylockBeginTotp, input),
    confirmTotp: (input) => ipcRenderer.invoke(IPC.toylockConfirmTotp, input),
    cancelTotp: (lockId) => ipcRenderer.invoke(IPC.toylockCancelTotp, lockId),
    update: (input) => ipcRenderer.invoke(IPC.toylockUpdate, input),
    remove: (id) => ipcRenderer.invoke(IPC.toylockRemove, id),
    verify: (input) => ipcRenderer.invoke(IPC.toylockVerify, input),
    relock: (lockId) => ipcRenderer.invoke(IPC.toylockRelock, lockId),
    ladderIssue: (lockId) => ipcRenderer.invoke(IPC.toylockLadderIssue, lockId),
    ladderVerify: (input) => ipcRenderer.invoke(IPC.toylockLadderVerify, input)
  },
  authenticator: {
    list: () => ipcRenderer.invoke(IPC.authenticatorList),
    addManual: (input) => ipcRenderer.invoke(IPC.authenticatorAddManual, input),
    addFromUri: (uri) => ipcRenderer.invoke(IPC.authenticatorAddUri, uri),
    rename: (input) => ipcRenderer.invoke(IPC.authenticatorRename, input),
    remove: (input) => ipcRenderer.invoke(IPC.authenticatorRemove, input),
    code: (id) => ipcRenderer.invoke(IPC.authenticatorCode, id),
    codes: (ids) => ipcRenderer.invoke(IPC.authenticatorCodes, ids),
    reveal: (id) => ipcRenderer.invoke(IPC.authenticatorReveal, id),
    exportSecrets: (input) => ipcRenderer.invoke(IPC.authenticatorExportSecrets, input)
  },
  // Per-project password manager (shared/password-manager.ts). LOCAL-ONLY, same reasoning as
  // toylock/authenticator above — see PasswordManagerApi's doc comment in shared/types.ts and
  // main/relay-rpc-policy.ts: a relay peer must never reach credential reveal/code on this
  // desktop's vault, however trusted it is for the joined project's files/terminals.
  passwordManager: {
    status: (projectId) => ipcRenderer.invoke(IPC.passwordManagerStatus, projectId),
    createVault: (projectId, password) => ipcRenderer.invoke(IPC.passwordManagerCreateVault, projectId, password),
    unlock: (projectId, password) => ipcRenderer.invoke(IPC.passwordManagerUnlock, projectId, password),
    lock: (projectId) => ipcRenderer.invoke(IPC.passwordManagerLock, projectId),
    changePassword: (projectId, input) => ipcRenderer.invoke(IPC.passwordManagerChangePassword, projectId, input),
    createManager: (projectId, input) => ipcRenderer.invoke(IPC.passwordManagerCreateManager, projectId, input),
    renameManager: (projectId, input) => ipcRenderer.invoke(IPC.passwordManagerRenameManager, projectId, input),
    bindManagerGroup: (projectId, input) =>
      ipcRenderer.invoke(IPC.passwordManagerBindManagerGroup, projectId, input),
    releaseGroupBinding: (projectId, groupId) =>
      ipcRenderer.invoke(IPC.passwordManagerReleaseGroupBinding, projectId, groupId),
    deleteManager: (projectId, id) => ipcRenderer.invoke(IPC.passwordManagerDeleteManager, projectId, id),
    createCredential: (projectId, input) =>
      ipcRenderer.invoke(IPC.passwordManagerCreateCredential, projectId, input),
    renameCredential: (projectId, input) =>
      ipcRenderer.invoke(IPC.passwordManagerRenameCredential, projectId, input),
    updateCredentialSecret: (projectId, input) =>
      ipcRenderer.invoke(IPC.passwordManagerUpdateCredentialSecret, projectId, input),
    removeCredential: (projectId, input) =>
      ipcRenderer.invoke(IPC.passwordManagerRemoveCredential, projectId, input),
    revealCredential: (projectId, managerId, credentialId) =>
      ipcRenderer.invoke(IPC.passwordManagerRevealCredential, projectId, managerId, credentialId),
    credentialCode: (projectId, managerId, credentialId) =>
      ipcRenderer.invoke(IPC.passwordManagerCredentialCode, projectId, managerId, credentialId),
    listCredentials: (projectId, managerId) =>
      ipcRenderer.invoke(IPC.passwordManagerListCredentials, projectId, managerId)
  },
  context: {
    onUpdate: (listener) => {
      const handler = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
      ipcRenderer.on(IPC.contextUpdate, handler)
      return () => ipcRenderer.removeListener(IPC.contextUpdate, handler)
    },
    ensure: (sessionId, cwd, accountId) =>
      ipcRenderer.send(IPC.contextEnsure, sessionId, cwd, accountId)
  },
  // Canvas sync: one channel in both directions. The cast goes to the reflector (src/core/canvas-sync),
  // which stamps it with the total order (`seq`) and fans it to every attached client — INCLUDING us.
  // Our own mutation coming back is the ACK that tells us where it landed in that order; the renderer
  // recognizes it by `src` and does not re-apply it (src/shared/canvas-order.ts).
  canvas: {
    mutate: (projectId, mutation) => ipcRenderer.send(IPC.canvasMut, projectId, mutation),
    onMutation: (listener) => {
      const handler = (
        _e: unknown,
        projectId: string,
        mutation: Parameters<typeof listener>[1]
      ): void => listener(projectId, mutation)
      ipcRenderer.on(IPC.canvasMut, handler)
      return () => ipcRenderer.removeListener(IPC.canvasMut, handler)
    }
  },
  codex: {
    identityCaps: () => ipcRenderer.invoke(IPC.codexIdentityCaps),
    onIdentity: (listener) => {
      const handler = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
      ipcRenderer.on(IPC.codexIdentity, handler)
      return () => ipcRenderer.removeListener(IPC.codexIdentity, handler)
    }
  },
  claude: {
    cliCaps: () => ipcRenderer.invoke(IPC.claudeCliCaps),
    readTranscript: (sessionId, cwd, accountId, nodeId) =>
      ipcRenderer.invoke(IPC.claudeReadTranscript, sessionId, cwd, accountId, nodeId)
  },
  agent: {
    envSnapshot: () => ipcRenderer.invoke(IPC.envSnapshot),
    discoverModels: (settings) => ipcRenderer.invoke(IPC.agentDiscoverModels, settings),
    gatewayCredentialStatus: () => ipcRenderer.invoke(IPC.agentGatewayCredentialStatus),
    saveGatewayCredential: (apiKey) =>
      ipcRenderer.invoke(IPC.agentGatewayCredentialSave, apiKey),
    clearGatewayCredential: () => ipcRenderer.invoke(IPC.agentGatewayCredentialClear)
  },
  chat: {
    readTranscript: (sessionId, cwd, accountId, nodeId) =>
      ipcRenderer.invoke(IPC.chatReadTranscript, sessionId, cwd, accountId, nodeId)
  },
  claudeAccounts: {
    add: (ctx) => ipcRenderer.invoke(IPC.claudeAccountsAdd, ctx),
    waitLogin: (id, ctx) => ipcRenderer.invoke(IPC.claudeAccountsWaitLogin, id, ctx),
    cancelWaitLogin: (id) => ipcRenderer.invoke(IPC.claudeAccountsCancelWait, id),
    remove: (id, ctx) => ipcRenderer.invoke(IPC.claudeAccountsRemove, id, ctx)
  },
  codexAccounts: {
    add: (ctx) => ipcRenderer.invoke(IPC.codexAccountsAdd, ctx),
    waitLogin: (id, ctx) => ipcRenderer.invoke(IPC.codexAccountsWaitLogin, id, ctx),
    cancelWaitLogin: (id) => ipcRenderer.invoke(IPC.codexAccountsCancelWait, id),
    remove: (id, ctx) => ipcRenderer.invoke(IPC.codexAccountsRemove, id, ctx),
    identity: (id, ctx) => ipcRenderer.invoke(IPC.codexAccountsIdentity, id, ctx),
    systemIdentity: (ctx) => ipcRenderer.invoke(IPC.codexAccountsSystemIdentity, ctx),
    add: () => ipcRenderer.invoke(IPC.codexAccountsAdd),
    waitLogin: (id) => ipcRenderer.invoke(IPC.codexAccountsWaitLogin, id),
    cancelWaitLogin: (id) => ipcRenderer.invoke(IPC.codexAccountsCancelWait, id),
    identity: (id) => ipcRenderer.invoke(IPC.codexAccountsIdentity, id),
    systemIdentity: (ctx) => ipcRenderer.invoke(IPC.codexAccountsSystemIdentity, ctx),
    remove: (id) => ipcRenderer.invoke(IPC.codexAccountsRemove, id),
    switchThread: (threadId, cwd, sourceAccountId, targetAccountId) =>
      ipcRenderer.invoke(
        IPC.codexAccountsSwitchThread,
        threadId,
        cwd,
        sourceAccountId,
        targetAccountId
      ),
    transferThreadToSsh: (threadId, sourceAccountId, targetAccountId, ctx) =>
      ipcRenderer.invoke(
        IPC.codexAccountsTransferThreadToSsh,
        threadId,
        sourceAccountId,
        targetAccountId,
        ctx
      ),
    commitSwitch: (rollbackToken) =>
      ipcRenderer.invoke(IPC.codexAccountsCommitSwitch, rollbackToken),
    finishSwitch: (rollbackToken) =>
      ipcRenderer.invoke(IPC.codexAccountsFinishSwitch, rollbackToken),
    rollbackSwitch: (rollbackToken) =>
      ipcRenderer.invoke(IPC.codexAccountsRollbackSwitch, rollbackToken)
    commitSwitch: (token) => ipcRenderer.invoke(IPC.codexAccountsCommitSwitch, token),
    finishSwitch: (token) => ipcRenderer.invoke(IPC.codexAccountsFinishSwitch, token),
    rollbackSwitch: (token) => ipcRenderer.invoke(IPC.codexAccountsRollbackSwitch, token),
    transferThreadToSsh: (threadId, cwd, projectId, targetAccountId, sourceAccountId) =>
      ipcRenderer.invoke(
        IPC.codexAccountsTransferThreadToSsh,
        threadId,
        cwd,
        projectId,
        targetAccountId,
        sourceAccountId
      )
  },
  transcripts: {
    search: (query: string) => ipcRenderer.invoke(IPC.transcriptSearch, query)
  },
  remoteHost: {
    start: () => ipcRenderer.invoke(IPC.remoteHostStart),
    stop: () => ipcRenderer.invoke(IPC.remoteHostStop),
    sendCanvasState: (state) => ipcRenderer.send(IPC.remoteHostCanvasState, state),
    onApplyMutation: subscribeMutation,
    onPeerPending: subscribePeerPending,
    onPeerPendingCleared: subscribePeerPendingCleared,
    approve: (id: string, pub?: string) => ipcRenderer.send(IPC.remoteHostApprove, { id, pub }),
    reject: (id: string, pub?: string) => ipcRenderer.send(IPC.remoteHostReject, { id, pub }),
    setPhoneAccess: (enabled) => ipcRenderer.send(IPC.remoteStandingHostSet, enabled)
  },
  relayHost: {
    dockerContexts: () => ipcRenderer.invoke(IPC.relayHostDockerContexts),
    manager: {
      contexts: () => ipcRenderer.invoke(IPC.dockerHostManagerContexts),
      snapshot: (context: string) => ipcRenderer.invoke(IPC.dockerHostManagerSnapshot, context),
      logs: (context: string, containerId: string) => ipcRenderer.invoke(IPC.dockerHostManagerLogs, context, containerId),
      run: (action: DockerHostAction) => ipcRenderer.invoke(IPC.dockerHostManagerRun, action),
      cancel: (jobId: string) => ipcRenderer.send(IPC.dockerHostManagerCancel, jobId),
      onProgress: (listener: (progress: DockerHostJobProgress) => void) => {
        const handler = (_event: unknown, progress: DockerHostJobProgress) => listener(progress)
        ipcRenderer.on(IPC.dockerHostManagerProgress, handler)
        return () => ipcRenderer.removeListener(IPC.dockerHostManagerProgress, handler)
      }
    },
    start: (projectId?: string) => ipcRenderer.invoke(IPC.relayHostStart, projectId),
    invite: (opts?: { projectId?: string; email?: string }) =>
      ipcRenderer.invoke(IPC.relayHostInvite, opts ?? {}),
    stop: () => ipcRenderer.invoke(IPC.relayHostStop),
    revoke: (id: string) => ipcRenderer.send(IPC.relayHostRevoke, { id }),
    onPeerPending: subscribeRelayPeerPending,
    confirm: (id: string) => ipcRenderer.send(IPC.relayHostConfirm, { id }),
    onOpen: subscribeRelayHostOpen,
    onClosed: subscribeRelayHostClosed
  },
  relayClient: {
    connect: (offer) => ipcRenderer.invoke(IPC.relayClientConnect, offer),
    onSas: (connectionId, listener) => {
      const channel = IPC.relayClientSas(connectionId)
      const handler = (_e: unknown, sas: string | null) => listener(sas)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    confirm: (connectionId) => ipcRenderer.send(IPC.relayClientConfirm, { id: connectionId }),
    onApproved: (connectionId, listener) => {
      const channel = IPC.relayClientApproved(connectionId)
      const handler = () => listener()
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    send: (connectionId, frame) => ipcRenderer.send(IPC.relayClientSend, connectionId, frame),
    onFrame: (connectionId, listener) => {
      const channel = IPC.relayClientFrame(connectionId)
      const handler = (_e: unknown, frame: string) => listener(frame)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    onClosed: (connectionId, listener) => {
      const channel = IPC.relayClientClosed(connectionId)
      const handler = () => listener()
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    disconnect: (connectionId) => ipcRenderer.send(IPC.relayClientDisconnect, connectionId)
  },
  handoff: {
    supported: true,
    build: (sessionId, agentId, sourceNodeId, cwd, accountId) =>
      ipcRenderer.invoke(IPC.handoffBuild, sessionId, agentId, sourceNodeId, cwd, accountId)
  },
  pairing: {
    supported: true,
    start: (attemptId) => ipcRenderer.invoke(IPC.pairingStart, attemptId),
    stop: (attemptId) => ipcRenderer.invoke(IPC.pairingStop, attemptId),
    onDone: (cb) => {
      const handler = (_e: unknown, result: PairingDoneResult) => cb(result)
      ipcRenderer.on(IPC.pairingDone, handler)
      return () => ipcRenderer.removeListener(IPC.pairingDone, handler)
    },
    probeSsh: () => ipcRenderer.invoke(IPC.pairingProbeSsh),
    openRemoteLoginSettings: () => ipcRenderer.invoke(IPC.pairingOpenRemoteLoginSettings),
    listDevices: () => ipcRenderer.invoke(IPC.pairingListDevices),
    revokeDevice: (id) => ipcRenderer.invoke(IPC.pairingRevokeDevice, id)
  },
  // Mutually-approved relay peers (a phone, or another desktop) that can reach this machine's
  // terminals. Both channels are raw-ipcMain, host-security control plane — never reachable by a
  // relay peer itself (see RELAY_LOCAL_ONLY_METHODS in platform-electron.ts).
  relayPeers: {
    supported: true,
    list: () => ipcRenderer.invoke(IPC.remoteListApprovedPeers),
    revoke: (peerKeyB64) => ipcRenderer.invoke(IPC.remoteRevokePeer, peerKeyB64)
  },
  // Team presence. `hello` is the only request (its response is how this client learns its OWN
  // ClientId, without which it would draw its own cursor as a peer's); the publishers are
  // fire-and-forget sends, and the two event channels are subscriptions. Nothing is persisted.
  presence: {
    hello: (identity: PeerIdentity) => ipcRenderer.invoke(IPC.presenceHello, identity),
    cursor: (cursor) => ipcRenderer.send(IPC.presenceCursor, cursor),
    focus: (nodeId) => ipcRenderer.send(IPC.presenceFocus, nodeId),
    chat: (text) => ipcRenderer.send(IPC.presenceChat, text),
    dino: (payload) => ipcRenderer.send(IPC.presenceDino, payload),
    project: (projectId) => ipcRenderer.send(IPC.presenceProject, projectId),
    onSync: (listener) => {
      const handler = (_e: unknown, peers: PeerState[]) => listener(peers)
      ipcRenderer.on(IPC.presenceSync, handler)
      return () => ipcRenderer.removeListener(IPC.presenceSync, handler)
    },
    onPeer: (listener) => {
      const handler = (_e: unknown, diff: PeerDiff) => listener(diff)
      ipcRenderer.on(IPC.presencePeer, handler)
      return () => ipcRenderer.removeListener(IPC.presencePeer, handler)
    }
  },
  contextLink: {
    setLinks: (map) => ipcRenderer.invoke(IPC.contextLinkSetLinks, map),
    info: () => ipcRenderer.invoke(IPC.contextLinkInfo)
  },
  boardLog: {
    append: (projectId, entry) => ipcRenderer.invoke(IPC.boardLogAppend, projectId, entry),
    read: (projectId, opts) => ipcRenderer.invoke(IPC.boardLogRead, projectId, opts),
    onChanged: (projectId, cb) => {
      const ch = IPC.boardLogChanged(projectId)
      const handler = (): void => cb()
      ipcRenderer.on(ch, handler)
      ipcRenderer.send(IPC.boardLogSubscribe, projectId)
      return () => {
        ipcRenderer.removeListener(ch, handler)
        ipcRenderer.send(IPC.boardLogUnsubscribe, projectId)
      }
    }
  },
  logs: {
    snapshot: () => ipcRenderer.invoke(IPC.logSnapshot),
    clear: () => ipcRenderer.send(IPC.logClear),
    onBatch: (cb) => {
      const handler = (_e: unknown, batch: LogRecord[]): void => cb(batch)
      ipcRenderer.on(IPC.logBatch, handler)
      ipcRenderer.send(IPC.logSubscribe)
      return () => {
        ipcRenderer.removeListener(IPC.logBatch, handler)
        ipcRenderer.send(IPC.logUnsubscribe)
      }
    }
  },
  // Per-node subscriptions (each terminal/editor listens) — multiplexed so they don't pile up
  // ipcRenderer listeners and trip the MaxListeners warning.
  shortcuts: {
    // Fire-and-forget: nothing waits on the answer. Main clears the bit itself on the three ways
    // this page can stop existing — window closed, renderer died, main-frame navigation (⌘R) —
    // but those are a backstop for a page that VANISHED, not a general safety net: an ordinary
    // disarm that never sends leaves the shortcuts suppressed until one of them happens.
    setRecording: (active: boolean) => ipcRenderer.send(IPC.uiShortcutRecording, active),
    // The terminal-focus mirror, same fire-and-forget shape and the same fail-safe reading on the
    // far side: main starts at "not focused" and the three page-death resets return it there, so a
    // report that never arrives costs the terminal-first policy, not the app's shortcuts.
    setTerminalFocused: (focused: boolean) => ipcRenderer.send(IPC.uiTerminalFocus, focused)
  },
  onMarkdownToggle: subscribe(IPC.appToggleMarkdown),
  onCloseNode: subscribe(IPC.appCloseNode),
  onZoomActualSize: subscribe(IPC.appZoomActualSize),
  // Native View menu → renderer.
  onToggleAutoAlign: subscribe(IPC.appToggleAutoAlign),
  onFitView: subscribe(IPC.appFitView),
  onToggleKanban: subscribe(IPC.appToggleKanban),
  onOpenSettings: subscribe(IPC.appOpenSettings),
  closeWindow: () => ipcRenderer.send(IPC.appCloseWindow),
  focusWindow: () => ipcRenderer.send(IPC.appFocusWindow),
  setBadgeCount: (count) => ipcRenderer.send(IPC.appSetBadge, count),
  // Page zoom for the UI-scale setting (issue #299). Re-clamped here because the value originates
  // in hand-editable settings.json and this is the boundary; no IPC — webFrame acts on this window.
  setUiZoomFactor: (factor) => webFrame.setZoomFactor(resolveUiScale(factor)),
  // Absolute path of a dropped/picked File (File.path was removed in Electron 30+).
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  userDataDir: () => ipcRenderer.invoke(IPC.appUserDataDir),
  notify: (payload) => ipcRenderer.invoke(IPC.appNotify, payload),
  openNotificationSettings: () => ipcRenderer.invoke(IPC.appOpenNotificationSettings),
  onFocusNode: (listener) => {
    const handler = (_e: unknown, nodeId: string) => listener(nodeId)
    ipcRenderer.on(IPC.appFocusNode, handler)
    return () => ipcRenderer.removeListener(IPC.appFocusNode, handler)
  },
  onMemoryPressure: (listener) => {
    const handler = (_e: unknown, severity: 'warning' | 'critical') => listener(severity)
    ipcRenderer.on(IPC.appMemoryPressure, handler)
    return () => ipcRenderer.removeListener(IPC.appMemoryPressure, handler)
  },
  onPtyPressure: (listener) => {
    const handler = (_e: unknown, reading: PtyPressure) => listener(reading)
    ipcRenderer.on(IPC.ptyPressure, handler)
    return () => ipcRenderer.removeListener(IPC.ptyPressure, handler)
  },
  raisePtyDeviceLimit: () => ipcRenderer.invoke(IPC.ptyRaiseDeviceLimit),
  answerPermission: (payload) => ipcRenderer.invoke(IPC.agentAnswerPermission, payload),
  ackDone: (nodeId) => {
    void ipcRenderer.invoke(IPC.agentAckDone, nodeId)
  },
  onUnreadClear: (listener) => {
    const handler = (_e: unknown, nodeId: string) => listener(nodeId)
    ipcRenderer.on(IPC.agentUnreadClear, handler)
    return () => ipcRenderer.removeListener(IPC.agentUnreadClear, handler)
  },
  onAgentStatus: (listener) => {
    const handler = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on(IPC.agentStatus, handler)
    return () => ipcRenderer.removeListener(IPC.agentStatus, handler)
  },
  onSubagentActivity: (listener) => {
    const handler = (_e: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on(IPC.agentSubagentActivity, handler)
    return () => ipcRenderer.removeListener(IPC.agentSubagentActivity, handler)
  },
  onAgentControl: (listener) => {
    const handler = (_e: unknown, cmd: unknown) => listener(cmd as never)
    ipcRenderer.on(IPC.agentControl, handler)
    return () => ipcRenderer.removeListener(IPC.agentControl, handler)
  },
  sendAgentControlResult: (payload) => ipcRenderer.send(IPC.agentControlResult, payload),
  converter: {
    catalog: () => ipcRenderer.invoke(IPC.converterCatalog),
    detect: (path) => ipcRenderer.invoke(IPC.converterDetect, path),
    preflight: (destDir) => ipcRenderer.invoke(IPC.converterPreflight, destDir),
    state: (offset, limit) => ipcRenderer.invoke(IPC.converterState, offset, limit),
    addFiles: (paths, destDir, adapterId, lossyAcknowledged) =>
      ipcRenderer.invoke(IPC.converterAddFiles, paths, destDir, adapterId, lossyAcknowledged),
    addFolder: (root, destDir, adapterId, opts) =>
      ipcRenderer.invoke(IPC.converterAddFolder, root, destDir, adapterId, opts),
    cancelScan: () => ipcRenderer.invoke(IPC.converterCancelScan),
    resolvePending: (ids, opts) => ipcRenderer.invoke(IPC.converterResolvePending, ids, opts),
    start: () => ipcRenderer.invoke(IPC.converterStart),
    pause: () => ipcRenderer.invoke(IPC.converterPause),
    cancelItem: (id) => ipcRenderer.invoke(IPC.converterCancelItem, id),
    cancelAll: () => ipcRenderer.invoke(IPC.converterCancelAll),
    retryItem: (id) => ipcRenderer.invoke(IPC.converterRetryItem, id),
    removeItem: (id) => ipcRenderer.invoke(IPC.converterRemoveItem, id),
    clearFinished: () => ipcRenderer.invoke(IPC.converterClearFinished),
    setConcurrency: (n) => ipcRenderer.invoke(IPC.converterSetConcurrency, n),
    onItem: (listener) => subscribeConverterItem(listener),
    onSummary: (listener) => subscribeConverterSummary(listener)
  },
  nodeDependencies: {
    catalog: () => ipcRenderer.invoke(IPC.nodeDependencyCatalog),
    status: (id) => ipcRenderer.invoke(IPC.nodeDependencyStatus, id),
    install: (id) => ipcRenderer.invoke(IPC.nodeDependencyInstall, id) as Promise<NodeDependencyInstallResult>,
    cancel: (operationId) => ipcRenderer.invoke(IPC.nodeDependencyCancel, operationId),
    repair: (id) => ipcRenderer.invoke(IPC.nodeDependencyRepair, id) as Promise<NodeDependencyInstallResult>,
    reconcile: () => ipcRenderer.invoke(IPC.nodeDependencyReconcile),
    onState: (listener) => subscribeNodeDependencyState(listener),
    onProgress: (listener) => subscribeNodeDependencyProgress(listener)
  },
  ollama: {
    status: () => ipcRenderer.invoke(IPC.ollamaStatus),
    models: () => ipcRenderer.invoke(IPC.ollamaModels),
    running: () => ipcRenderer.invoke(IPC.ollamaRunning),
    show: (model) => ipcRenderer.invoke(IPC.ollamaShow, model),
    deleteModel: (model) => ipcRenderer.invoke(IPC.ollamaDelete, model),
    copyModel: (source, destination) => ipcRenderer.invoke(IPC.ollamaCopy, source, destination),
    hardware: () => ipcRenderer.invoke(IPC.ollamaHardware),
    fit: (refs) => ipcRenderer.invoke(IPC.ollamaFit, refs),
    popularModels: () => ipcRenderer.invoke(IPC.ollamaPopularModels),
    pullState: () => ipcRenderer.invoke(IPC.ollamaPullState),
    pullEnqueue: (refs) => ipcRenderer.invoke(IPC.ollamaPullEnqueue, refs),
    pullStart: () => ipcRenderer.invoke(IPC.ollamaPullStart),
    pullPause: () => ipcRenderer.invoke(IPC.ollamaPullPause),
    pullCancelItem: (id) => ipcRenderer.invoke(IPC.ollamaPullCancelItem, id),
    pullRetryItem: (id) => ipcRenderer.invoke(IPC.ollamaPullRetryItem, id),
    pullRemoveItem: (id) => ipcRenderer.invoke(IPC.ollamaPullRemoveItem, id),
    pullSetConcurrency: (n) => ipcRenderer.invoke(IPC.ollamaPullSetConcurrency, n),
    onPullItem: (listener) => subscribeOllamaPullItem(listener),
    onPullSummary: (listener) => subscribeOllamaPullSummary(listener),
    chatSessions: () => ipcRenderer.invoke(IPC.ollamaChatSessions),
    chatGet: (id) => ipcRenderer.invoke(IPC.ollamaChatGet, id),
    chatCreate: (model, systemPrompt) => ipcRenderer.invoke(IPC.ollamaChatCreate, model, systemPrompt),
    chatRename: (id, title) => ipcRenderer.invoke(IPC.ollamaChatRename, id, title),
    chatDelete: (id) => ipcRenderer.invoke(IPC.ollamaChatDelete, id),
    chatExport: (id, format) => ipcRenderer.invoke(IPC.ollamaChatExport, id, format),
    chatSend: (id, text) => ipcRenderer.invoke(IPC.ollamaChatSend, id, text),
    chatStop: (id) => ipcRenderer.invoke(IPC.ollamaChatStop, id),
    onChatStream: (listener) => subscribeOllamaChatStream(listener)
  },
  minecraft: {
    versions: () => ipcRenderer.invoke(IPC.minecraftVersions),
    status: (id) => ipcRenderer.invoke(IPC.minecraftStatus, id),
    create: (input) => ipcRenderer.invoke(IPC.minecraftCreate, input),
    acceptEula: (id) => ipcRenderer.invoke(IPC.minecraftAcceptEula, id),
    start: (id) => ipcRenderer.invoke(IPC.minecraftStart, id),
    stop: (id) => ipcRenderer.invoke(IPC.minecraftStop, id),
    sendCommand: (id, command) => ipcRenderer.invoke(IPC.minecraftSendCommand, id, command),
    remove: (id, deleteFiles) => ipcRenderer.invoke(IPC.minecraftRemove, id, deleteFiles),
    recentConsole: (id) => ipcRenderer.invoke(IPC.minecraftRecentConsole, id),
    readProperties: (id) => ipcRenderer.invoke(IPC.minecraftPropertiesRead, id),
    writeProperties: (id, updates) => ipcRenderer.invoke(IPC.minecraftPropertiesWrite, id, updates),
    readPlayerLists: (id) => ipcRenderer.invoke(IPC.minecraftPlayerLists, id),
    listBackups: (id) => ipcRenderer.invoke(IPC.minecraftBackupsList, id),
    createBackup: (id) => ipcRenderer.invoke(IPC.minecraftBackupCreate, id),
    restoreBackup: (id, backupId) => ipcRenderer.invoke(IPC.minecraftBackupRestore, id, backupId),
    deleteBackup: (id, backupId) => ipcRenderer.invoke(IPC.minecraftBackupDelete, id, backupId),
    onEvent: (listener) => subscribeMinecraftEvent(listener)
  },
  torrent: {
    runtime: () => ipcRenderer.invoke(IPC.torrentRuntime),
    list: (nodeId) => ipcRenderer.invoke(IPC.torrentList, nodeId),
    inspect: (input) => ipcRenderer.invoke(IPC.torrentInspect, input),
    add: (input) => ipcRenderer.invoke(IPC.torrentAdd, input),
    chooseFiles: (id, paths) => ipcRenderer.invoke(IPC.torrentChooseFiles, id, paths),
    setDestination: (id, destination) => ipcRenderer.invoke(IPC.torrentSetDestination, id, destination),
    preflight: (id) => ipcRenderer.invoke(IPC.torrentPreflight, id),
    start: (id) => ipcRenderer.invoke(IPC.torrentStart, id),
    pause: (id) => ipcRenderer.invoke(IPC.torrentPause, id),
    resume: (id) => ipcRenderer.invoke(IPC.torrentResume, id),
    cancel: (id) => ipcRenderer.invoke(IPC.torrentCancel, id),
    retry: (id) => ipcRenderer.invoke(IPC.torrentRetry, id),
    remove: (id) => ipcRenderer.invoke(IPC.torrentRemove, id),
    setSeedPolicy: (id, policy) => ipcRenderer.invoke(IPC.torrentSetSeedPolicy, id, policy),
    reconcile: () => ipcRenderer.invoke(IPC.torrentReconcile),
    onTask: (listener) => subscribeTorrentTask(listener)
  virtualMachine: {
    tools: () => ipcRenderer.invoke(IPC.virtualMachineTools),
    status: (id) => ipcRenderer.invoke(IPC.virtualMachineStatus, id),
    configure: (id, config, local) => ipcRenderer.invoke(IPC.virtualMachineConfigure, id, config, local),
    createDisk: (id, folder) => ipcRenderer.invoke(IPC.virtualMachineCreateDisk, id, folder),
    start: (id) => ipcRenderer.invoke(IPC.virtualMachineStart, id),
    stop: (id) => ipcRenderer.invoke(IPC.virtualMachineStop, id),
    snapshot: (id, name) => ipcRenderer.invoke(IPC.virtualMachineSnapshot, id, name),
    restore: (id, name) => ipcRenderer.invoke(IPC.virtualMachineRestore, id, name),
    openDisplay: (id) => ipcRenderer.invoke(IPC.virtualMachineOpenDisplay, id),
    reset: (id) => ipcRenderer.invoke(IPC.virtualMachineReset, id),
    onEvent: (listener) => subscribeVirtualMachineEvent(listener)
  calendar: {
    status: (id, config) => ipcRenderer.invoke(IPC.calendarStatus, id, config),
    accounts: () => ipcRenderer.invoke(IPC.calendarAccounts),
    calendars: (accountId, provider) => ipcRenderer.invoke(IPC.calendarCalendars, accountId, provider),
    events: (id, config) => ipcRenderer.invoke(IPC.calendarEvents, id, config),
    importIcs: (id, text, name) => ipcRenderer.invoke(IPC.calendarImportIcs, id, text, name),
    refresh: (id, config) => ipcRenderer.invoke(IPC.calendarRefresh, id, config),
    beginOAuth: (provider: Exclude<CalendarProvider, 'local' | 'ics'>) => ipcRenderer.invoke(IPC.calendarBeginOAuth, provider),
    create: (input) => ipcRenderer.invoke(IPC.calendarCreate, input),
    update: (input) => ipcRenderer.invoke(IPC.calendarUpdate, input),
    remove: (id, eventId) => ipcRenderer.invoke(IPC.calendarRemove, id, eventId)
  // The `browser` verb resolve round-trip (S8 PR 7): main asks the renderer which project owns the
  // source, whether it is control-capable, and whether the capability is on right now — the renderer
  // NEVER runs a CDP command.
  onBrowserControlResolve: (listener) => {
    const handler = (_e: unknown, req: unknown) => listener(req as never)
    ipcRenderer.on(IPC.browserControlResolve, handler)
    return () => ipcRenderer.removeListener(IPC.browserControlResolve, handler)
  },
  sendBrowserControlResolveResult: (payload) => ipcRenderer.send(IPC.browserControlResolveResult, payload),
  agentMessage: {
    deliver: (req) => ipcRenderer.invoke(IPC.agentMessageDeliver, req)
  }
}

contextBridge.exposeInMainWorld('nodeTerminal', api)
