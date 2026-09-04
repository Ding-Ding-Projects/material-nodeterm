import { IPC } from '../shared/ipc'

/**
 * A relay peer is intentionally powerful inside the project/session it joined, but it is not the
 * host renderer. `platform.handle()` is also used by machine-global services whose bridge surface
 * deliberately stays local (settings, licensing, credentials, toy locks, and the authenticator).
 *
 * Keep this an exact allowlist, not a namespace-prefix blocklist. A newly registered handler must
 * remain unreachable until its relay semantics and scope have been reviewed and it is added here.
 * That default-deny property is what prevents a future credential service from becoming remotely
 * callable merely because it used the shared CorePlatform registration seam.
 *
 * The entries mirror the reviewed core-bound pieces assembled by renderer/bridge/relay-api.ts;
 * members without project-safe semantics (whole-workspace save, desktop-only git selection) are
 * deliberately absent. Destructive fs/git/pty methods are deliberate: mutual approval grants the
 * peer shell-equivalent project access. Machine-global methods are not — the relay API keeps those
 * on the peer's own machine.
 */
const RELAY_REQUEST_METHODS = new Set<string>([
  // Terminal/session operations on the joined host.
  IPC.ptyCreate,
  IPC.ptyDestroy,
  IPC.ptyRecycle,
  IPC.ptyCapture,
  IPC.ptyReadScrollback,
  IPC.ptySendText,
  IPC.ptyTmuxStatus,
  IPC.ptyPaneCommand,
  // Corrects the lead pane's width on the HOST's own tmux (settings.agentTeamLeadPaneWidthEnabled
  // is a viewer-local setting; the session it acts on lives on the host, same as paneCommand
  // above). No destructive effect beyond a cosmetic resize-pane.
  IPC.ptyCorrectTeamPaneWidth,

  // The shared canvas/project and its filesystem.
  IPC.workspaceLoad,
  IPC.workspaceProbeFolder,
  // workspaceSplitIntoParts/workspaceJoinParts/workspaceHasPartsManifest are DELIBERATELY
  // absent: they read/write raw bytes at a local filesystem path with no host-scoped project
  // check (see WorkspaceStore.splitProjectIntoParts's own doc comment) and rewrite a git-shared
  // file's on-disk encoding. A relay peer must not trigger that from across the tunnel; the
  // relay API refuses these with E_UNSUPPORTED instead (see relay-api.ts).
  IPC.fsList,
  IPC.fsRead,
  IPC.fsReadBinary,
  IPC.fsWrite,
  IPC.fsMkdir,
  IPC.fsExists,
  IPC.filesQuickOpen,
  IPC.filesDownloadTicket,
  IPC.filesSaveUpload,
  IPC.filesSaveCanvasImage,

  // Source control for the joined project. These are shell-equivalent by design.
  IPC.gitStatus,
  IPC.gitDiscoverNestedRepos,
  IPC.gitInit,
  IPC.gitClone,
  IPC.gitCloneAbort,
  IPC.gitCloneDefaultParent,
  IPC.gitCommit,
  IPC.gitPush,
  IPC.gitPull,
  IPC.gitSync,
  IPC.gitPublish,
  IPC.gitStage,
  IPC.gitUnstage,
  IPC.gitStageAll,
  IPC.gitUnstageAll,
  IPC.gitDiff,
  IPC.gitDiscard,
  IPC.gitSwitchBranch,
  IPC.gitCreateBranch,
  IPC.gitShowFile,
  IPC.gitHistory,
  IPC.gitCommitFiles,
  IPC.gitRemoteCommitUrl,
  IPC.gitMerge,
  IPC.gitRebase,
  IPC.gitDeleteBranch,
  IPC.gitRenameBranch,
  IPC.gitFetch,
  IPC.gitForcePush,
  IPC.gitStashPush,
  IPC.gitStashPop,
  IPC.gitRevert,
  IPC.gitBranchAt,
  IPC.gitCheckoutCommit,
  IPC.gitRepoRoot,
  IPC.gitWorktreeList,
  IPC.gitWorktreeAdd,
  IPC.gitWorktreeMerge,
  IPC.gitWorktreeRemovalProof,
  IPC.gitWorktreeRemove,
  IPC.commitGenerate,

  // Project-scoped collaboration. relay-host.ts applies the shared-project jail first.
  IPC.githubIssuesSubscribe,
  IPC.githubIssuesQuery,
  IPC.githubIssuesRefresh,
  IPC.githubIssuesMove,
  IPC.githubIssuesCreateLabels,
  IPC.githubIssuesClearCache,
  IPC.boardLogAppend,
  IPC.boardLogSaveAttachment,
  IPC.boardLogCreateAttachmentSession,
  IPC.boardLogRemoveAttachments,
  IPC.boardLogReadAttachment,
  IPC.boardLogRead,
  IPC.presenceHello,

  // Agent state belongs to the joined session. Permission answers are equivalent to typing in its
  // terminal and are intentionally available to a mutually approved peer.
  IPC.agentAnswerPermission,
  IPC.agentAckDone,
  IPC.claudeCliCaps,

  // Needed only to derive host-side worktree defaults; explicitly remote in relay-api.ts.
  IPC.appUserDataDir,
  IPC.durableOccurrencesLoad,
  IPC.durableOccurrencesSave,
  IPC.durableOccurrencesReconcile,
  IPC.durableOccurrencesClaim,
  IPC.durableOccurrencesSnooze,
  IPC.durableOccurrencesDismiss,
  IPC.durableOccurrencesExport,
  IPC.durableOccurrencesImport,
  IPC.durableOccurrencesTimerTransition,
  IPC.durableOccurrencesTimerLap,
  IPC.durableOccurrencesTimerTick,
  IPC.durableOccurrencesUpsertAlarm,
  IPC.durableOccurrencesUpsertTimer,
  IPC.durableOccurrencesRemoveSource,
  IPC.durableOccurrencesAcknowledge
])

const RELAY_CAST_METHODS = new Set<string>([
  IPC.ptyWrite,
  IPC.ptyResize,
  IPC.ptyFlow,
  IPC.ptyKill,
  IPC.ptyDestroy,
  IPC.ptyRecycle,
  IPC.contextEnsure,
  IPC.githubIssuesUnsubscribe,
  IPC.boardLogSubscribe,
  IPC.boardLogUnsubscribe,
  IPC.canvasMut,
  IPC.presenceCursor,
  IPC.presenceFocus,
  IPC.presenceChat,
  IPC.presenceDino,
  IPC.presenceProject,
  IPC.projectSetupSubscribe,
  IPC.projectSetupUnsubscribe
])

/** Events consumed by the core-bound namespaces assembled in relay-api.ts. Machine-global core
 * services also broadcast through CorePlatform, so outbound traffic needs the same fail-closed
 * split as requests: otherwise usage email, license/mode state, converter paths, and local model
 * streams leak to every approved peer even though their request namespaces are local-only. */
const RELAY_EVENT_CHANNELS = new Set<string>([
  IPC.gitCloneProgress,
  IPC.canvasMut,
  IPC.presenceSync,
  IPC.presencePeer,
  // Peers need external project refreshes, but platform-electron scrubs the machine-local
  // execution overlay from the peer copy before this reviewed event leaves the host.
  IPC.workspaceExternalChange,
  IPC.durableOccurrencesChanged
])

/** Session/project ids are suffixes in these subscription channels. Use the canonical builders to
 * derive the prefixes, and require a non-empty suffix so a lookalike base channel is not accepted. */
const RELAY_EVENT_PREFIXES = [
  IPC.ptyData(''),
  IPC.ptyExit(''),
  IPC.ptySize(''),
  IPC.ptyClosed(''),
  IPC.ptyRecycled(''),
  IPC.ptyResync(''),
  IPC.githubIssuesChanged(''),
  IPC.boardLogChanged('')
]

export function relayRequestAllowed(method: string): boolean {
  return RELAY_REQUEST_METHODS.has(method)
}

export function relayCastAllowed(method: string): boolean {
  return RELAY_CAST_METHODS.has(method)
}

export function relayEventAllowed(channel: string): boolean {
  return (
    RELAY_EVENT_CHANNELS.has(channel) ||
    RELAY_EVENT_PREFIXES.some(
      (prefix) => channel.startsWith(prefix) && channel.length > prefix.length
    )
  )
}
