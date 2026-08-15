import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  CanvasMutation,
  CanvasState,
  NodeTerminalApi,
  Project,
  PtyCreateOptions,
  PtyPressure,
  RecycledInfo,
  RelayPeerPending,
  RemoteUsageQuery,
  SessionMemoryQuery,
  UpdateInfo,
  UpdateProgress,
  Workspace,
  WorkspaceMigrationKind
} from '../shared/types'
import type { ScheduledSettingsActiveState, ScheduledSettingsFile } from '../shared/scheduled-settings'
import type { HistoryFilters } from '../shared/local-history'
import type { ClientId, PeerDiff, PeerIdentity, PeerState } from '../shared/presence'
import type { ConvertQueueItem, ConverterQueueState } from '../shared/converter'
import type { PullQueueItem, PullQueueState } from '../shared/ollama'

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
const subscribePeerPending = subscribe<[{ sas: string | null; id: string }]>(IPC.remoteHostPeerPending)

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

const subscribeRelayPeerPending = subscribe<[RelayPeerPending]>(IPC.relayHostPeerPending)
const subscribeRelayHostOpen = subscribe<[{ id: string; email?: string }]>(IPC.relayHostOpen)
const subscribeRelayHostClosed = subscribe<[{ id: string }]>(IPC.relayHostClosed)

// Scheduled settings (docs/scheduled-settings.md): the resolved-schedule push can have more than
// one subscriber at once (the Settings → Schedule panel AND the always-mounted apply-controller in
// Canvas.tsx), so it goes through the fan-out helper like the other broadcast channels above.
const subscribeScheduledSettingsActive = subscribe<[ScheduledSettingsActiveState]>(
  IPC.scheduledSettingsActiveChange
)

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
      ipcRenderer.send(IPC.ptyDestroy, persistKey, opts?.everySocket === true),
    recycle: (persistKey) => ipcRenderer.send(IPC.ptyRecycle, persistKey),
    generateName: (persistKey, cwd) => ipcRenderer.invoke(IPC.ptyGenerateName, persistKey, cwd),
    generateGroupName: (memberKeys, cwd) =>
      ipcRenderer.invoke(IPC.ptyGenerateGroupName, memberKeys, cwd),
    capture: (persistKey, full) => ipcRenderer.invoke(IPC.ptyCapture, persistKey, full),
    readScrollback: (persistKey) => ipcRenderer.invoke(IPC.ptyReadScrollback, persistKey),
    sendText: (persistKey, text, opts) =>
      ipcRenderer.invoke(IPC.ptySendText, persistKey, text, opts?.enter),
    tmuxStatus: () => ipcRenderer.invoke(IPC.ptyTmuxStatus),
    paneCommand: (persistKey) => ipcRenderer.invoke(IPC.ptyPaneCommand, persistKey),
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
  workspace: {
    load: () => ipcRenderer.invoke(IPC.workspaceLoad),
    save: (workspace: Workspace) => ipcRenderer.invoke(IPC.workspaceSave, workspace),
    probeFolder: (folder: string) => ipcRenderer.invoke(IPC.workspaceProbeFolder, folder),
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
  dialog: {
    selectFolder: () => ipcRenderer.invoke(IPC.dialogSelectFolder),
    selectFile: () => ipcRenderer.invoke(IPC.dialogSelectFile),
    selectFiles: () => ipcRenderer.invoke(IPC.dialogSelectFiles)
  },
  settings: {
    load: () => ipcRenderer.invoke(IPC.settingsLoad),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings)
  },
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
    transcribe: (pcm: Float32Array, language?: string) => {
      const spansBuffer = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength
      const buffer = spansBuffer ? pcm.buffer : pcm.slice().buffer
      return ipcRenderer.invoke(IPC.speechTranscribe, { pcm: buffer, language })
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
    worktreeRemove: (repoPath, wtPath, deleteBranch, pruneOnly) =>
      ipcRenderer.invoke(IPC.gitWorktreeRemove, repoPath, wtPath, deleteBranch, pruneOnly),
    setActiveRemote: (projectId) => ipcRenderer.invoke(IPC.gitSetActiveRemote, projectId)
  },
  clipboard: {
    // Route to the MAIN process: renderer-side `clipboard` access is deprecated in Electron.
    writeText: (text: string) => ipcRenderer.send(IPC.clipboardWrite, text),
    writeFiles: (paths: string[]) => ipcRenderer.invoke(IPC.clipboardWriteFiles, paths)
  },
  shell: {
    reveal: (path: string) => ipcRenderer.send(IPC.shellReveal, path),
    openPath: (path: string) => ipcRenderer.send(IPC.shellOpenPath, path),
    openExternal: (url: string) => ipcRenderer.send(IPC.shellOpenExternal, url)
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
    register: (webContentsId: number, nodeId: string) =>
      ipcRenderer.send(IPC.browserRegister, webContentsId, nodeId),
    unregister: (webContentsId: number) => ipcRenderer.send(IPC.browserUnregister, webContentsId),
    onBrowserNewWindow: (listener) => {
      const handler = (_e: unknown, ev: { url: string; sourceNodeId: string }) => listener(ev)
      ipcRenderer.on(IPC.browserNewWindow, handler)
      return () => ipcRenderer.removeListener(IPC.browserNewWindow, handler)
    }
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
    verify: (input) => ipcRenderer.invoke(IPC.toylockVerify, input)
  },
  authenticator: {
    list: () => ipcRenderer.invoke(IPC.authenticatorList),
    addManual: (input) => ipcRenderer.invoke(IPC.authenticatorAddManual, input),
    addFromUri: (uri) => ipcRenderer.invoke(IPC.authenticatorAddUri, uri),
    rename: (input) => ipcRenderer.invoke(IPC.authenticatorRename, input),
    remove: (id) => ipcRenderer.invoke(IPC.authenticatorRemove, id),
    code: (id) => ipcRenderer.invoke(IPC.authenticatorCode, id),
    codes: (ids) => ipcRenderer.invoke(IPC.authenticatorCodes, ids),
    reveal: (id) => ipcRenderer.invoke(IPC.authenticatorReveal, id),
    exportSecrets: (input) => ipcRenderer.invoke(IPC.authenticatorExportSecrets, input)
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
  transcripts: {
    search: (query: string) => ipcRenderer.invoke(IPC.transcriptSearch, query)
  },
  remoteHost: {
    start: () => ipcRenderer.invoke(IPC.remoteHostStart),
    stop: () => ipcRenderer.invoke(IPC.remoteHostStop),
    sendCanvasState: (state) => ipcRenderer.send(IPC.remoteHostCanvasState, state),
    onApplyMutation: subscribeMutation,
    onPeerPending: subscribePeerPending,
    approve: (id: string) => ipcRenderer.send(IPC.remoteHostApprove, { id }),
    reject: (id: string) => ipcRenderer.send(IPC.remoteHostReject, { id }),
    setPhoneAccess: (enabled) => ipcRenderer.send(IPC.remoteStandingHostSet, enabled)
  },
  relayHost: {
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
    build: (sessionId, agentId, sourceNodeId, cwd, accountId) =>
      ipcRenderer.invoke(IPC.handoffBuild, sessionId, agentId, sourceNodeId, cwd, accountId)
  },
  pairing: {
    start: () => ipcRenderer.invoke(IPC.pairingStart),
    stop: () => ipcRenderer.invoke(IPC.pairingStop),
    onDone: (cb) => {
      const handler = (_e: unknown, result: { ok: boolean }) => cb(result)
      ipcRenderer.on(IPC.pairingDone, handler)
      return () => ipcRenderer.removeListener(IPC.pairingDone, handler)
    },
    probeSsh: () => ipcRenderer.invoke(IPC.pairingProbeSsh),
    openRemoteLoginSettings: () => ipcRenderer.invoke(IPC.pairingOpenRemoteLoginSettings),
    listDevices: () => ipcRenderer.invoke(IPC.pairingListDevices),
    revokeDevice: (id) => ipcRenderer.invoke(IPC.pairingRevokeDevice, id)
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
  // Per-node subscriptions (each terminal/editor listens) — multiplexed so they don't pile up
  // ipcRenderer listeners and trip the MaxListeners warning.
  onMarkdownToggle: subscribe(IPC.appToggleMarkdown),
  onCloseNode: subscribe(IPC.appCloseNode),
  onZoomActualSize: subscribe(IPC.appZoomActualSize),
  closeWindow: () => ipcRenderer.send(IPC.appCloseWindow),
  focusWindow: () => ipcRenderer.send(IPC.appFocusWindow),
  setBadgeCount: (count) => ipcRenderer.send(IPC.appSetBadge, count),
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
  }
}

contextBridge.exposeInMainWorld('nodeTerminal', api)
