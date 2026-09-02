import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@renderer/ui/md3'
import type { KanbanLabel, ProjectKanban } from '@shared/types'
import type { NodeIcon } from '@shared/node-icon'
import { AGENT_CONFIG, BUILTIN_AGENT_IDS, type AgentId } from '@shared/agents/config'
import { useViewMode } from '../../state/viewMode'
import { useProjects } from '../../state/projects'
import { useSettings } from '../../state/settings'
import { terminalProfileDisplayError, useTerminalProfiles } from '../../state/terminal-profiles'
import {
  canOfferTerminalProfiles,
  terminalProfileChoices
} from '../../lib/terminal-profile-actions'
import { isRemoteSessionNode } from '@shared/worktree'
import {
  addColumn,
  assignNode,
  assignedTo,
  boardLabels,
  cardMatchesLabelFilter,
  cardMeta,
  columnForNode,
  deleteColumn,
  labelsForCard,
  moveColumn,
  nextColumnColor,
  pruneAssignments,
  recolorColumn,
  renameColumn,
  unassigned
} from '../../lib/kanban'
import { labelSwatch } from '../../lib/kanbanLabelColors'
import { CardModal } from './CardModal'
import { KanbanColumn } from './KanbanColumn'
import type { ModalSpawn } from './ModalTerminal'
import { type MenuItem } from '../ContextMenu'
import { VocabularyContextMenu } from '../menu/VocabularyContextMenu'
import {
  IconAgent,
  IconExternal,
  IconNote,
  IconSwitch,
  IconTerminal,
  IconTrash,
  IconWeb
} from '../icons'
import type { GitHubIssueCardView } from '@shared/github-issues'
import { useGitHubIssues } from '../../state/githubIssues'
import { useAgentStatus } from '../../state/agentStatus'
import { useSession } from '../../session/session'
import { KanbanSourceFilter, type KanbanSource } from './KanbanSourceFilter'
import { GitHubIssueSummaryModal } from './GitHubIssueSummaryModal'
import { ConfirmDialog } from '../ConfirmDialog'
import {
  githubMoveConfirmation,
  githubMoveIntent,
  type GitHubMoveConfirmation
} from '../../lib/githubIssueMove'
import {
  kanbanTerminalProfileCreateOptions,
  kanbanRestartProfileMenuItem,
  selectedKanbanTerminalProfile,
  type KanbanRestartProfileAssessor,
  type KanbanRestartProfileHandler,
  type KanbanTerminalProfilePresentation
} from './terminal-profile-ui'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'

/** One session node shown as a board card — derived LIVE from the canvas nodes; the board
 *  itself stores only column assignments. */
export interface KanbanSession {
  id: string
  title: string
  color: string
  kind: 'terminal' | 'sticky' | 'browser'
  agentId?: string
  /** Sticky note body — shown in the expanded detail row. */
  text?: string
  /** Sticky-only: last canvas-control `sticky` write (cleared on hand edits) — the modal's stamp. */
  textUpdatedAt?: number
  textUpdatedBy?: string
  /** Browser node URL (kind 'browser' only) — shown on the card, opened in the modal webview. */
  url?: string
  /** Browser node profile id (kind 'browser' only) — the modal's live webview must use the same
   *  isolated session (cookies/storage) the canvas node uses, or navigating in one view would not
   *  be the same login as the other. See `shared/browser-profiles.ts`. */
  browserProfileId?: string
  /** Browser node session partition (kind 'browser' only) — threaded to the modal webview so it
   *  shares the canvas node's jar (`browser-partition-parity.test.tsx`). Absent = default session. */
  partition?: string
  /** User-chosen terminal-session mark, shared with the canvas and sidebar. */
  icon?: NodeIcon
  /** The subset of the node's `data` the card modal's co-attach terminal needs to spawn/join the
   *  same session (kind 'terminal' only; sticky passes `{}`). */
  spawn: ModalSpawn
}

/** What the per-column "+ New" menu can create. */
export type KanbanCreateChoice =
  | { kind: 'terminal'; profileId?: string }
  | { kind: 'sticky' }
  | { kind: 'browser' }
  | { kind: 'agent'; agentId: AgentId }

/** One actionable "+ New" menu entry. Unavailable profiles remain focusable and explain why. */
export interface KanbanCreateLeafOption {
  type?: 'item'
  key: string
  label: string
  choice: KanbanCreateChoice
  icon: JSX.Element
  disabled?: boolean
  hint?: string
}

/** A drill-in submenu avoids clipping profile lists against the board's horizontal scroller. */
export interface KanbanCreateSubmenuOption {
  type: 'submenu'
  key: string
  label: string
  icon: JSX.Element
  children: KanbanCreateLeafOption[]
}

export type KanbanCreateOption = KanbanCreateLeafOption | KanbanCreateSubmenuOption

export interface KanbanViewProps {
  board: ProjectKanban
  sessions: KanbanSession[]
  onChange: (next: ProjectKanban) => void
  /** Open a session from its card: switch back to canvas view and focus the node. */
  onOpenNode: (nodeId: string) => void
  /** Create a node from a column's "+ New" menu (columnId null = Ungrouped: no assignment). */
  onCreateNode: (choice: KanbanCreateChoice, columnId: string | null) => void
  /** Rename a node (same funnel as the sessions sidebar). */
  onRenameNode: (nodeId: string, title: string) => void
  /** Write-through a sticky node's body text (only fired for kind 'sticky'). */
  onEditSticky: (nodeId: string, text: string) => void
  /** Permanently delete a node (ends its session) — routed through the canvas confirm. */
  onDeleteNode: (nodeId: string) => void
  /** Reports which node's card modal is open (null = none) so the canvas can target it — e.g.
   *  the dictation shortcut dictates into the open card's session, not a canvas selection. */
  onModalNodeChange: (nodeId: string | null) => void
  /** Persist a browser card's navigation (url/title) from the modal webview to the node. */
  onBrowserNav: (nodeId: string, patch: { url?: string; title?: string }) => void
  /** Set or clear a terminal session icon. */
  onSetIcon: (nodeId: string, icon: NodeIcon | undefined) => void
  /**
   * Begin the destructive profile-switch gate for a local terminal or agent card. The card menu's
   * exact screen anchor travels with the request so Canvas never reuses a stale menu position.
   */
  onRestartNodeWithProfile?: KanbanRestartProfileHandler
  /** Node-specific agent continuity guard supplied by Canvas's live node/state view. */
  assessRestartNodeWithProfile?: KanbanRestartProfileAssessor
  /** Node ids currently inside the awaited destructive profile-recycle transaction. */
  terminalProfileRestartPending?: ReadonlySet<string>
}

type Drag =
  { kind: 'card' | 'column'; id: string } | { kind: 'github'; issue: GitHubIssueCardView } | null

/** Shared empty results — stable identities so memoized cards/columns see "no change". */
const NO_LABELS: KanbanLabel[] = []
const NO_CARDS: KanbanSession[] = []

/** Full-page session board OVER the canvas. The canvas stays mounted underneath (its
 *  agent-status listeners must keep running, and display:none would 0×0-resize every
 *  terminal into a tmux SIGWINCH) — this is an opaque overlay, nothing more.
 *  memo: Canvas re-renders on plenty the board doesn't care about (agent signatures, camera
 *  banners…); with every prop stable (Canvas useCallbacks + memoized board/sessions) those
 *  renders stop at this boundary. */
export const KanbanView = memo(function KanbanView({
  board,
  sessions,
  onChange,
  onOpenNode,
  onCreateNode,
  onRenameNode,
  onEditSticky,
  onDeleteNode,
  onModalNodeChange,
  onBrowserNav,
  onSetIcon,
  onRestartNodeWithProfile,
  assessRestartNodeWithProfile,
  terminalProfileRestartPending
}: KanbanViewProps) {
  const { api, source: sessionSource } = useSession()
  const profileText = useLocalizedVocabularyText()
  const dragRef = useRef<Drag>(null)
  // One card modal at a time; a deleted node closes it via the byId.has render guard.
  const [modalNodeId, setModalNodeId] = useState<string | null>(null)
  // Right-click card menu (open on canvas / move / delete).
  const [cardMenu, setCardMenu] = useState<{
    x: number
    y: number
    nodeId: string
  } | null>(null)
  // Board label filter — transient (per board session; resets when you leave the board). Empty =
  // show everything; otherwise a card must carry at least one selected label (cardMatchesLabelFilter).
  const [labelFilter, setLabelFilter] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [source, setSource] = useState<KanbanSource>('all')
  const [modalIssue, setModalIssue] = useState<GitHubIssueCardView | null>(null)
  const [githubRetry, setGitHubRetry] = useState(0)
  // A move that would close or reopen the issue on GitHub waits here for an explicit confirmation.
  const [pendingGitHubMove, setPendingGitHubMove] = useState<{
    issue: GitHubIssueCardView
    columnId: string | null
    confirmation: GitHubMoveConfirmation
  } | null>(null)
  // Primitive selectors (not one object) — an object selector would re-render on every store set.
  const projectId = useProjects((s) => s.activeProjectId)
  const projectName = useProjects((s) => s.projects.find((p) => p.id === s.activeProjectId)?.name)
  const projectColor = useProjects((s) => s.projects.find((p) => p.id === s.activeProjectId)?.color)
  const isSshProject = useProjects((s) => !!s.projects.find((p) => p.id === s.activeProjectId)?.ssh)
  const isRelayProject = useProjects(
    (s) => !!s.projects.find((p) => p.id === s.activeProjectId)?.remote
  )
  const terminalProfiles = useTerminalProfiles((state) => state.profiles)
  const terminalProfilesError = useTerminalProfiles((state) => state.error)
  const terminalProfilesLoading = useTerminalProfiles((state) => state.loading)
  const terminalProfilesInitialized = useTerminalProfiles((state) => state.initialized)
  const terminalProfilesDisplayError = terminalProfileDisplayError(
    terminalProfilesError,
    profileText('terminalProfiles.common.detectionFailed', 'Terminal profile detection failed.')
  )
  useEffect(() => {
    if (sessionSource === 'local') void useTerminalProfiles.getState().ensureLoaded()
  }, [sessionSource])
  const github = useGitHubIssues((state) => state.projects[projectId])
  const githubReadOnly = Object.values(github?.pages ?? {}).some((page) => page.readOnly)
  const connectGitHub = useGitHubIssues((state) => state.connect)
  const moveGitHubState = useGitHubIssues((state) => state.move)
  const loadMoreGitHub = useGitHubIssues((state) => state.loadMore)
  // Drop ids no longer in the palette so a deleted label can't keep the board filtered to nothing.
  const paletteLabels = useMemo(() => boardLabels(board), [board])
  const githubLabels = useMemo(() => {
    const labels = new Map<string, { name: string; color: string }>()
    for (const page of Object.values(github?.pages ?? {})) {
      for (const issue of page.items) {
        for (const label of issue.labels) {
          const key = label.name.normalize('NFKC').toLocaleLowerCase('en-US')
          if (!labels.has(key)) labels.set(key, { name: label.name, color: label.color })
        }
      }
    }
    return [...labels.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [github?.pages])
  const localFilterKeys = useMemo(
    () => new Set(paletteLabels.map((label) => `local:${label.id}`)),
    [paletteLabels]
  )
  const activeFilter = useMemo(
    () => labelFilter.filter((id) => localFilterKeys.has(id) || id.startsWith('github:')),
    [labelFilter, localFilterKeys]
  )
  const activeLocalFilter = useMemo(
    () => activeFilter.filter((key) => key.startsWith('local:')).map((key) => key.slice(6)),
    [activeFilter]
  )
  const activeGitHubFilter = useMemo(
    () => activeFilter.filter((key) => key.startsWith('github:')),
    [activeFilter]
  )
  const toggleFilter = (id: string): void =>
    setLabelFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
  // Report the open node to the canvas (dictation shortcut targeting) and mark its completion read.
  // This clears notification affordances only; the live `done` state remains waiting for a prompt.
  useEffect(() => {
    onModalNodeChange(modalNodeId)
    if (modalNodeId) useAgentStatus.getState().clearUnread(modalNodeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalNodeId])
  // Someone asked for a card while the board is up (notch Go, a notification, ⌘K…). Open it here
  // instead of framing the node on the canvas nobody can see under this overlay.
  const requestedCardNodeId = useViewMode((s) => s.requestedCardNodeId)
  useEffect(() => {
    if (!requestedCardNodeId) return
    setModalNodeId(requestedCardNodeId)
    useViewMode.getState().clearCardRequest()
  }, [requestedCardNodeId])
  const githubConfigKey = JSON.stringify(board.github ?? null)
  const columnIdsKey = board.columns.map((column) => column.id).join('\0')
  const githubFilterKey = activeGitHubFilter.join('\0')
  useEffect(() => {
    if (!board.github || !projectId) return
    let disposed = false
    let disconnect: (() => void) | undefined
    void connectGitHub(
      api.githubIssues,
      projectId,
      board.columns.map((column) => column.id),
      activeGitHubFilter
    ).then((teardown) => {
      if (disposed) teardown()
      else disconnect = teardown
    })
    return () => {
      disposed = true
      disconnect?.()
    }
    // The serialised config is the epoch visible to the renderer. Reconnect when mappings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId, githubConfigKey, columnIdsKey, githubFilterKey, connectGitHub, githubRetry])
  useEffect(() => {
    setSource('all')
    setModalIssue(null)
  }, [projectId])
  useEffect(() => {
    if (!modalIssue || !github) return
    const latest = Object.values(github.pages)
      .flatMap((page) => page.items)
      .find((issue) => issue.number === modalIssue.number)
    if (latest && latest.updatedAt !== modalIssue.updatedAt) setModalIssue(latest)
  }, [github, modalIssue])
  const customAgents = useSettings((s) => s.settings.customAgents)
  const defaultTerminalProfileId = useSettings((s) => s.settings.defaultTerminalProfileId)
  const offersTerminalProfiles = canOfferTerminalProfiles(
    !!api.terminalProfiles,
    sessionSource,
    isSshProject || isRelayProject
  )
  const profileCopy = useMemo(
    () => ({
      checkingAvailability: profileText(
        'terminalProfiles.header.checkingAvailability',
        'Checking whether this terminal profile is available on this machine.'
      ),
      noLongerDetected: profileText(
        'terminalProfiles.header.noLongerDetected',
        'This selected profile is no longer detected on this machine.'
      ),
      hostCannotConfirm: profileText(
        'terminalProfiles.restart.hostCannotConfirm',
        'This host cannot confirm that the old persistent session ended.'
      ),
      detectingProfiles: profileText(
        'terminalProfiles.common.detectingProfiles',
        'Detecting profiles…'
      ),
      profilesUnavailable: profileText(
        'terminalProfiles.common.profilesUnavailable',
        'Profiles unavailable'
      ),
      noProfilesDetected: profileText(
        'terminalProfiles.common.noProfilesDetected',
        'No Windows terminal profiles were detected.'
      ),
      detectionPending: profileText(
        'terminalProfiles.common.detectionPending',
        'Profile detection has not finished yet.'
      ),
      restartMenuLabel: profileText('terminalProfiles.restart.menuLabel', 'Restart with profile…'),
      restartBusy: profileText(
        'terminalProfiles.restart.busy',
        'This terminal is already restarting. Wait for that restart to finish.'
      ),
      restartProgress: profileText('terminalProfiles.restart.progress', 'Restarting with profile…'),
      defaultProfileLabel: profileText('terminalProfiles.label.default', 'Default profile'),
      automaticLabel: profileText('terminalProfiles.label.automatic', 'Automatic'),
      customLabel: profileText('terminalProfiles.label.custom', 'Custom executable'),
      unavailableLabel: profileText(
        'terminalProfiles.label.unavailable',
        'Unavailable terminal profile'
      ),
      unavailableOnMachine: profileText(
        'terminalProfiles.common.unavailableOnMachine',
        'This profile is unavailable on this machine.'
      )
    }),
    [profileText]
  )
  const profileChoices = useMemo(
    () =>
      terminalProfileChoices(
        terminalProfiles,
        profileText(
          'terminalProfiles.common.unavailableOnMachine',
          'This profile is unavailable on this machine.'
        )
      ),
    [terminalProfiles, profileText]
  )
  // "+ New" menu entries: the builtin agents, the user's custom agents, then terminal + sticky
  // (same universe as the dock's add menu, minus canvas-only kinds). Memoized — a fresh array
  // (with fresh icon elements) per render would re-render every memoized column.
  const createOptions: KanbanCreateOption[] = useMemo(
    () => [
      ...BUILTIN_AGENT_IDS.map((id) => ({
        key: id,
        label: AGENT_CONFIG[id].label,
        choice: { kind: 'agent', agentId: id } as KanbanCreateChoice,
        icon: <IconAgent />
      })),
      ...customAgents.map((a) => ({
        key: a.id,
        label: a.label,
        choice: { kind: 'agent', agentId: a.id } as KanbanCreateChoice,
        icon: <IconAgent />
      })),
      {
        key: 'terminal',
        label: 'Terminal',
        choice: { kind: 'terminal' },
        icon: <IconTerminal />
      },
      ...(offersTerminalProfiles
        ? [
            {
              type: 'submenu' as const,
              key: 'terminal-profile',
              label: profileText('terminalProfiles.create.menuLabel', 'New terminal with profile…'),
              icon: <IconTerminal />,
              children: profileChoices.length
                ? kanbanTerminalProfileCreateOptions(profileChoices).map((profile) => ({
                    ...profile,
                    choice: profile.choice as KanbanCreateChoice,
                    icon: <IconTerminal />,
                  }))
                : [
                    {
                      key: 'terminal-profile:unavailable',
                      label: terminalProfilesLoading
                        ? profileText(
                            'terminalProfiles.common.detectingProfiles',
                            'Detecting profiles…'
                          )
                        : profileText(
                            'terminalProfiles.common.profilesUnavailable',
                            'Profiles unavailable'
                          ),
                      choice: { kind: 'terminal' } as KanbanCreateChoice,
                      icon: <IconTerminal />,
                      disabled: true,
                      hint:
                        terminalProfilesDisplayError ??
                        (terminalProfilesInitialized
                          ? profileText(
                              'terminalProfiles.common.noProfilesDetected',
                              'No Windows terminal profiles were detected.'
                            )
                          : profileText(
                              'terminalProfiles.common.detectionPending',
                              'Profile detection has not finished yet.'
                            ))
                    }
                  ]
            }
          ]
        : []),
      {
        key: 'browser',
        label: 'Browser',
        choice: { kind: 'browser' },
        icon: <IconWeb />
      },
      {
        key: 'sticky',
        label: 'Sticky note',
        choice: { kind: 'sticky' },
        icon: <IconNote />
      }
    ],
    [
      customAgents,
      offersTerminalProfiles,
      profileChoices,
      terminalProfilesLoading,
      terminalProfilesDisplayError,
      terminalProfilesInitialized,
      profileText
    ]
  )
  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions])
  // Resolve once per profile/session epoch, then hand every memoized column the same lookup. This
  // avoids allocating a fresh presentation object for each card on unrelated board renders.
  const terminalProfileByNode = useMemo(() => {
    const resolved = new Map<string, KanbanTerminalProfilePresentation>()
    if (!offersTerminalProfiles) return resolved
    for (const session of sessions) {
      if (session.kind !== 'terminal' || isRemoteSessionNode(session.spawn)) continue
      const presentation = selectedKanbanTerminalProfile(
        session.spawn.terminalProfileId ?? defaultTerminalProfileId,
        terminalProfiles,
        {
          loading: terminalProfilesLoading,
          initialized: terminalProfilesInitialized,
          error: terminalProfilesDisplayError
        },
        profileCopy
      )
      if (presentation) resolved.set(session.id, presentation)
    }
    return resolved
  }, [
    defaultTerminalProfileId,
    offersTerminalProfiles,
    profileCopy,
    sessions,
    terminalProfiles,
    terminalProfilesDisplayError,
    terminalProfilesInitialized,
    terminalProfilesLoading
  ])
  const terminalProfileOf = useCallback(
    (nodeId: string) => terminalProfileByNode.get(nodeId),
    [terminalProfileByNode]
  )

  // Stable per-card label arrays: labelsForCard allocates a fresh array per call, and that
  // identity churn alone would defeat SessionCard's memo. Recomputed only on a board change.
  const labelsByCard = useMemo(() => {
    const m = new Map<string, KanbanLabel[]>()
    if (Array.isArray(board.meta)) {
      for (const entry of board.meta) {
        if (!entry?.nodeId) continue
        const l = labelsForCard(board, entry.nodeId)
        if (l.length) m.set(entry.nodeId, l)
      }
    }
    return m
  }, [board])
  const labelsOf = useCallback((id: string) => labelsByCard.get(id) ?? NO_LABELS, [labelsByCard])
  const metaOf = useCallback((id: string) => cardMeta(board, id), [board])

  // Prune dead nodes' assignments on every persisted change, so they never accumulate
  // in the shared file.
  const commit = useCallback(
    (next: ProjectKanban) => onChange(pruneAssignments(next, sessionIds)),
    [onChange, sessionIds]
  )

  const takeDrag = (): Drag => {
    const d = dragRef.current
    dragRef.current = null
    return d
  }

  // The ONE path every GitHub card move takes — drag drop, the card's Move selector, and the
  // summary modal — so none of them can skip the confirmation the others ask for.
  const requestGitHubMove = useCallback(
    (issue: GitHubIssueCardView, columnId: string | null) => {
      if (githubReadOnly) return
      const completion = board.github?.completionColumnId
      const intent = githubMoveIntent(issue, columnId, completion)
      // Dropping a card back where it already sits is not a write: sending it would spend an API
      // call and let GitHub rewrite state_reason for no reason the user asked for.
      if (intent.kind === 'noop') return
      const confirmation = githubMoveConfirmation(issue, columnId, completion)
      if (confirmation) {
        setPendingGitHubMove({ issue, columnId, confirmation })
        return
      }
      void moveGitHubState(api.githubIssues, projectId, issue.number, columnId, issue.updatedAt)
    },
    [api.githubIssues, board.github?.completionColumnId, githubReadOnly, moveGitHubState, projectId]
  )

  // columnId null = the virtual Ungrouped column.
  const dropOnColumn = useCallback(
    (columnId: string | null) => {
      const drag = takeDrag()
      if (!drag) return
      if (drag.kind === 'github') {
        requestGitHubMove(drag.issue, columnId)
      } else if (drag.kind === 'card') commit(assignNode(board, drag.id, columnId, null))
      else if (columnId !== null) commit(moveColumn(board, drag.id, columnId))
      // a column dropped on Ungrouped is a no-op — Ungrouped is always first
    },
    [board, commit, requestGitHubMove]
  )

  const dropAtCard = useCallback(
    (columnId: string | null, targetNodeId: string, side: 'before' | 'after') => {
      const drag = takeDrag()
      if (!drag) return
      if (drag.kind === 'github') {
        requestGitHubMove(drag.issue, columnId)
        return
      }
      if (drag.kind === 'column') {
        if (columnId !== null) commit(moveColumn(board, drag.id, columnId))
        return
      }
      // "after this card" = "before the NEXT card in the column" (null = end of column).
      const ids = columnId === null ? unassigned(board, sessionIds) : assignedTo(board, columnId)
      let beforeId: string | null = targetNodeId
      if (side === 'after') {
        const i = ids.indexOf(targetNodeId)
        beforeId = i >= 0 && i + 1 < ids.length ? ids[i + 1] : null
      }
      commit(assignNode(board, drag.id, columnId, beforeId))
    },
    [board, commit, requestGitHubMove, sessionIds]
  )

  // Per-column card lists in one pass, so a board render doesn't re-derive (and re-allocate)
  // them per column — and their identities hold across renders that change neither the board,
  // the sessions, nor the filter, which is what lets the memoized columns skip.
  const columnCards = useMemo(() => {
    const vis = (ids: string[]): string[] =>
      activeLocalFilter.length
        ? ids.filter((id) => cardMatchesLabelFilter(board, id, activeLocalFilter))
        : ids
    const toCards = (ids: string[]): KanbanSession[] => {
      const cards = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      return cards.length ? cards : NO_CARDS
    }
    return {
      ungrouped: toCards(vis(unassigned(board, sessionIds))),
      byColumn: new Map(board.columns.map((c) => [c.id, toCards(vis(assignedTo(board, c.id)))]))
    }
  }, [board, byId, sessionIds, activeLocalFilter])

  // Stable column/card plumbing — every handler the memoized columns receive is identity-stable
  // across renders (the column binds its own id; cards bind theirs).
  const handleCardDragStart = useCallback((id: string) => {
    dragRef.current = { kind: 'card', id }
  }, [])
  const handleGitHubDragStart = useCallback((issue: GitHubIssueCardView) => {
    dragRef.current = { kind: 'github', issue }
  }, [])
  const handleColumnDragStart = useCallback((columnId: string) => {
    dragRef.current = { kind: 'column', id: columnId }
  }, [])
  const handleDragEnd = useCallback(() => {
    dragRef.current = null
  }, [])
  const handleCardContext = useCallback(
    (id: string, x: number, y: number) => setCardMenu({ nodeId: id, x, y }),
    []
  )
  const handleRenameColumn = useCallback(
    (columnId: string, t: string) => commit(renameColumn(board, columnId, t)),
    [board, commit]
  )
  const handleRecolorColumn = useCallback(
    (columnId: string, c: string) => commit(recolorColumn(board, columnId, c)),
    [board, commit]
  )
  const handleDeleteColumn = useCallback(
    (columnId: string) => commit(deleteColumn(board, columnId)),
    [board, commit]
  )
  const handleMoveGitHub = requestGitHubMove
  const githubPage = useCallback(
    (columnId: string | null) => github?.pages[columnId ?? 'ungrouped'],
    [github]
  )
  const sessionVisible = source !== 'github'
  const githubVisible = source !== 'sessions' && !!board.github

  // Right-click menu for a card: open on canvas, move, profile-restart, or delete.
  const cardMenuItems = (menu: { x: number; y: number; nodeId: string }): MenuItem[] => {
    const { nodeId, x, y } = menu
    const curColId = columnForNode(board, nodeId)?.id ?? null
    const session = byId.get(nodeId)
    const moveTargets: MenuItem[] = [
      ...(curColId !== null
        ? [
            {
              label: 'Ungrouped',
              onClick: () => commit(assignNode(board, nodeId, null, null))
            }
          ]
        : []),
      ...board.columns
        .filter((c) => c.id !== curColId)
        .map((c) => ({
          label: c.title,
          onClick: () => commit(assignNode(board, nodeId, c.id, null))
        }))
    ]
    return [
      {
        label: 'Open card',
        icon: <IconExternal />,
        onClick: () => setModalNodeId(nodeId)
      },
      {
        label: 'Open on canvas',
        icon: <IconExternal />,
        onClick: () => onOpenNode(nodeId)
      },
      ...(moveTargets.length
        ? ([
            {
              type: 'submenu',
              label: 'Move to',
              icon: <IconSwitch />,
              children: moveTargets
            }
          ] as MenuItem[])
        : []),
      ...(offersTerminalProfiles &&
      onRestartNodeWithProfile &&
      assessRestartNodeWithProfile &&
      // Agent cards are terminal sessions with `agentId`; this deliberately covers both kinds.
      session?.kind === 'terminal' &&
      !isRemoteSessionNode(session.spawn)
        ? [
            kanbanRestartProfileMenuItem({
              nodeId,
              anchor: { x, y },
              profiles: profileChoices,
              detection: {
                loading: terminalProfilesLoading,
                initialized: terminalProfilesInitialized,
                error: terminalProfilesDisplayError
              },
              canRecyclePersistentSession: !!api.pty.recycleConfirmed,
              restartPending: terminalProfileRestartPending?.has(nodeId) ?? false,
              icon: <IconSwitch />,
              assessProfile: assessRestartNodeWithProfile,
              onSelect: onRestartNodeWithProfile,
              copy: profileCopy
            })
          ]
        : []),
      { type: 'separator' },
      {
        label: 'Delete',
        icon: <IconTrash />,
        danger: true,
        onClick: () => onDeleteNode(nodeId)
      }
    ]
  }

  const modalTerminalProfile = modalNodeId
    ? terminalProfileByNode.get(modalNodeId)
    : undefined

  return (
    <div className="kanban-overlay">
      {/* Title strip: names the board's project AND pushes the columns below the top-right
          controls cluster, so column headers never sit under its icons. */}
      <div className="kanban-header">
        <span className="kanban-header__dot" style={{ background: projectColor }} />
        <span className="kanban-header__name">{projectName}</span>
        {board.github && <KanbanSourceFilter value={source} onChange={setSource} />}
        {board.github && github?.loading && (
          <span className="kanban-github-status">Loading GitHub issues…</span>
        )}
        {board.github && github?.error && (
          <Button variant="text" size="small" vocabularyMode="factual"
            className="kanban-github-status kanban-github-status--error kanban-github-retry"
            onClick={() => setGitHubRetry((value) => value + 1)}
          >
            GitHub issues unavailable · Retry
          </Button>
        )}
        {board.github && githubReadOnly && (
          <span className="kanban-github-status kanban-github-status--error">
            GitHub issues are read only until configuration and refresh are complete.
          </span>
        )}
        {(paletteLabels.length > 0 || githubLabels.length > 0 || activeFilter.length > 0) && (
          <div className="kanban-header__filter">
            <Button variant="tonal" size="small" vocabularyMode="factual"
              className={`kanban-filter-btn${activeFilter.length ? ' kanban-filter-btn--on' : ''}`}
              title="Filter by label"
              onClick={() => setFilterOpen((v) => !v)}
            >
              Filter{activeFilter.length ? ` · ${activeFilter.length}` : ''}
            </Button>
            {filterOpen && (
              <>
                <div className="label-picker__scrim" onMouseDown={() => setFilterOpen(false)} />
                <div className="kanban-filter-menu">
                  {paletteLabels.length > 0 && <div className="kanban-filter-group">Sessions</div>}
                  {paletteLabels.map((l) => {
                    const s = labelSwatch(l.color)
                    const key = `local:${l.id}`
                    const on = activeFilter.includes(key)
                    return (
                      <Button variant="outlined" size="small" vocabularyMode="factual"
                        key={key}
                        className="kanban-filter-row"
                        onClick={() => toggleFilter(key)}
                      >
                        <span
                          className="kanban-label-chip"
                          style={{ background: s.bg, color: s.fg }}
                        >
                          {l.name || 'Label'}
                        </span>
                        {on && <span className="label-picker__rowcheck">✓</span>}
                      </Button>
                    )
                  })}
                  {githubLabels.length > 0 && <div className="kanban-filter-group">GitHub</div>}
                  {githubLabels.map((label) => {
                    const key = `github:${label.name.normalize('NFKC').toLocaleLowerCase('en-US')}`
                    const on = activeFilter.includes(key)
                    return (
                      <Button variant="outlined" size="small" vocabularyMode="factual"
                        key={key}
                        className="kanban-filter-row"
                        onClick={() => toggleFilter(key)}
                      >
                        <span
                          className="github-issue-label"
                          style={{
                            borderColor: `#${label.color}`,
                            color: `#${label.color}`
                          }}
                        >
                          {label.name}
                        </span>
                        {on && <span className="label-picker__rowcheck">✓</span>}
                      </Button>
                    )
                  })}
                  {activeFilter.length > 0 && (
                    <Button variant="text" size="small" className="kanban-filter-clear" onClick={() => setLabelFilter([])}>
                      Clear filter
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="kanban-board">
        <div className="kanban-board__columns">
          <KanbanColumn
            column={null}
            cards={sessionVisible ? columnCards.ungrouped : NO_CARDS}
            githubCards={githubVisible ? (githubPage(null)?.items ?? []) : []}
            githubColumns={board.columns}
            githubMoving={github?.moving}
            githubReadOnly={githubReadOnly}
            githubStatus={github?.issueStatus}
            displayCount={
              (sessionVisible ? columnCards.ungrouped.length : 0) +
              (githubVisible ? (githubPage(null)?.counts.ungrouped ?? 0) : 0)
            }
            metaOf={metaOf}
            labelsOf={labelsOf}
            terminalProfileOf={terminalProfileOf}
            onOpenCard={setModalNodeId}
            createOptions={createOptions}
            onCreate={onCreateNode}
            onCardDragStart={handleCardDragStart}
            onDragEnd={handleDragEnd}
            onDropOnColumn={dropOnColumn}
            onDropAtCard={dropAtCard}
            onCardContext={handleCardContext}
            onOpenGitHub={setModalIssue}
            onMoveGitHub={handleMoveGitHub}
            onGitHubDragStart={handleGitHubDragStart}
            hasMoreGitHub={githubVisible && !!githubPage(null)?.nextCursor}
            onLoadMoreGitHub={() => void loadMoreGitHub(api.githubIssues, projectId, null)}
          />
          {board.columns.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              cards={sessionVisible ? (columnCards.byColumn.get(col.id) ?? NO_CARDS) : NO_CARDS}
              githubCards={githubVisible ? (githubPage(col.id)?.items ?? []) : []}
              githubColumns={board.columns}
              githubMoving={github?.moving}
              githubReadOnly={githubReadOnly}
              githubStatus={github?.issueStatus}
              displayCount={
                (sessionVisible ? (columnCards.byColumn.get(col.id)?.length ?? 0) : 0) +
                (githubVisible ? (githubPage(col.id)?.counts[col.id] ?? 0) : 0)
              }
              metaOf={metaOf}
              labelsOf={labelsOf}
              terminalProfileOf={terminalProfileOf}
              onRename={handleRenameColumn}
              onRecolor={handleRecolorColumn}
              onDelete={handleDeleteColumn}
              onOpenCard={setModalNodeId}
              createOptions={createOptions}
              onCreate={onCreateNode}
              onCardDragStart={handleCardDragStart}
              onColumnDragStart={handleColumnDragStart}
              onDragEnd={handleDragEnd}
              onDropOnColumn={dropOnColumn}
              onDropAtCard={dropAtCard}
              onCardContext={handleCardContext}
              onOpenGitHub={setModalIssue}
              onMoveGitHub={handleMoveGitHub}
              onGitHubDragStart={handleGitHubDragStart}
              hasMoreGitHub={githubVisible && !!githubPage(col.id)?.nextCursor}
              onLoadMoreGitHub={() => void loadMoreGitHub(api.githubIssues, projectId, col.id)}
            />
          ))}
          <Button variant="outlined" size="small"
            className="kanban-add-col"
            onClick={() => commit(addColumn(board, 'New column', nextColumnColor(board)))}
          >
            + Add column
          </Button>
        </div>
      </div>
      {cardMenu && byId.has(cardMenu.nodeId) && (
        // Personal-vocabulary boundary: every row here is prose the user reads — the card actions
        // and, under "Move to", the board's own column titles. Nothing in this tree is executed or
        // persisted from its label, so the substitution is display-only.
        <VocabularyContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          zIndex={60}
          items={cardMenuItems(cardMenu)}
          onClose={() => setCardMenu(null)}
        />
      )}
      {modalNodeId && byId.has(modalNodeId) && (
        <CardModal
          session={byId.get(modalNodeId)!}
          projectId={projectId}
          columnTitle={columnForNode(board, modalNodeId)?.title ?? null}
          board={board}
          onChangeBoard={commit}
          onClose={() => setModalNodeId(null)}
          onOpenCanvas={() => {
            setModalNodeId(null)
            onOpenNode(modalNodeId)
          }}
          onRename={(t) => onRenameNode(modalNodeId, t)}
          onEditSticky={(t) => onEditSticky(modalNodeId, t)}
          onBrowserNav={(patch) => onBrowserNav(modalNodeId, patch)}
          onSetIcon={(icon) => onSetIcon(modalNodeId, icon)}
          terminalProfile={modalTerminalProfile}
        />
      )}
      {modalIssue && (
        <GitHubIssueSummaryModal
          issue={modalIssue}
          columns={board.columns}
          moving={!!github?.moving[modalIssue.number]}
          readOnly={githubReadOnly}
          status={github?.issueStatus[modalIssue.number]}
          onMove={(columnId) => handleMoveGitHub(modalIssue, columnId)}
          onClose={() => setModalIssue(null)}
        />
      )}
      {pendingGitHubMove && (
        <ConfirmDialog
          message={pendingGitHubMove.confirmation.message}
          confirmLabel={pendingGitHubMove.confirmation.confirmLabel}
          danger={pendingGitHubMove.confirmation.danger}
          onCancel={() => setPendingGitHubMove(null)}
          onConfirm={() => {
            const { issue, columnId } = pendingGitHubMove
            setPendingGitHubMove(null)
            void moveGitHubState(
              api.githubIssues,
              projectId,
              issue.number,
              columnId,
              issue.updatedAt
            )
          }}
        />
      )}
    </div>
  )
})
