import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjects } from '../state/projects'
import { useViewMode, viewFor } from '../state/viewMode'
import { useAgentStatus } from '../state/agentStatus'
import { useSettings } from '../state/settings'
import { accountsForProject, sshAccountsHint } from '../state/workspace'
import { useSshConn } from '../state/sshConn'
import { sshAutoModeHint } from '../state/permissionMode'
import { useSystemAccount } from '../state/systemAccount'
import { sessionCount, sessionForProject, useProjectSession } from '../session/session'
import { tabClickAction } from '../session/relay-tab'
import { useMenuFlip } from '../ui/useMenuFlip'
import { IconCanvasView, IconKanban } from './icons'
import { appearanceId } from '../lib/appearance/registry'
import { openAppearanceEditor } from '../state/appearanceEditorHost'
import {
  SAVE_PROJECT_ARCHIVE_ACTION,
  OPEN_PROJECT_ARCHIVE_ACTION,
  EDIT_TAB_APPEARANCE_ACTION
} from '../lib/projectMenuActions'
import { AccountIdentityPills } from './AccountIdentityPills'
import { presentAccount } from '../lib/accountPresentation'
import { sshHostKey } from '@shared/ssh'
import {
  ALL_PERMISSION_MODES,
  PERMISSION_MODE_LABELS,
  type AgentPermissionMode
} from '@shared/agents/config'
import { bypassSandboxCaveat, permissionModeAgentsLabel } from '@shared/agents/approval-mode'
import { ColorMenu } from './color/ColorMenu'
import { IconMenu } from './icon/IconMenu'
import { ProjectGlyph } from './ProjectGlyph'
import type { ProjectIcon } from '@shared/project-icon'
import { useToyLocks } from '../state/toylocks'
import { LockWizard } from './toylocks/LockWizard'
import { UnlockPrompt } from './toylocks/UnlockPrompt'
import { ConfirmDialog } from './ConfirmDialog'

interface ProjectSwitcherProps {
  onSwitch: (id: string) => void
  /** Reconnect an offline (dropped) relay tab in place (Stage 4 Task 7). Called when an
   *  "unavailable" tab whose session is a relay/server source is clicked. */
  onReconnect: (id: string) => void
  /** Reorder a project to sit before another (null = to the end). Shared with the sessions
   *  sidebar: both surfaces render the projects array, so one drag updates both. */
  onReorder: (draggedId: string, beforeId: string | null) => void
  /** Open the start screen (New project / Open folder / Clone repo), what "New project" now shows. */
  onOpenWelcome: () => void
  onRename: (id: string, name: string) => void
  onSetFolder: (id: string) => void
  /** Close (hide) the project without destroying it, reopenable from the start screen. */
  onCloseProject: (id: string) => void
  /** Open the Remote access dialog (host/share + connect). Shown for every project. */
  onRemoteAccess: () => void
  /** Set (or clear, with undefined) the project's default Claude account for new nodes. */
  onSetDefaultAccount: (id: string, accountId: string | undefined) => void
  /** Set (or clear, with undefined = use the global setting) the project's default permission mode. */
  onSetDefaultPermissionMode: (id: string, mode: AgentPermissionMode | undefined) => void
  /** Set the project's colour — the switcher dot, the kanban header dot, the sidebar monogram.
   *  Called LIVE while the picker is dragged, so it must be a cheap, coalescing writer. */
  onSetColor: (id: string, color: string) => void
  /** Set (or clear, with undefined) the project's icon — the switcher dot, the sessions
   *  sidebar monogram, the welcome screen's recently-closed list. */
  onSetIcon: (id: string, icon: ProjectIcon | undefined) => void
  /** {@link SAVE_PROJECT_ARCHIVE_ACTION} — pack this project into one archive file. Shared with
   *  the sidebar project-header menu (`Canvas.tsx`'s `onProjectContextMenu`); see
   *  `lib/projectMenuActions.ts`. */
  onSaveArchive: (id: string) => void
  /** {@link OPEN_PROJECT_ARCHIVE_ACTION} — restore a project from a previously saved archive
   *  file. Not scoped to a row (it creates a new project), but lives in the per-row panel because
   *  that is where a user goes looking for "save/open this as a file". */
  onOpenArchive: () => void
  /** Whether an archive save/open is already running elsewhere — disables both archive rows so a
   *  second click doesn't race the first (`Canvas.tsx`'s `projectArchiveBusyRef`, read fresh on
   *  every render since the panel re-renders on its own state anyway). */
  archiveBusy: () => boolean
}

/**
 * The runtime session dimension of a project (which core it lives on). Rendered ONLY when more
 * than one session exists — same rule the old tab strip used.
 */
function ProjectSessionLabel({ projectId }: { projectId: string }) {
  const session = useProjectSession(projectId)
  return (
    <span className="tab__session" title={`Session: ${session.label} (${session.status})`}>
      {session.label}
    </span>
  )
}

/**
 * The Material 3 top-app-bar project switcher: a menu button naming the active project, opening
 * a dropdown that lists every project (click to switch, drag to reorder) plus, per row, an
 * expandable "⋮" actions panel carrying everything the old per-tab caret menu did (rename,
 * appearance, colour, folder, remote access, default Claude account, default permission mode,
 * lock, close).
 *
 * Replaces `TabBar.tsx` — see `design/v2/md3/HANDOFF.md` step 3.
 */
export function ProjectSwitcher({
  onSwitch,
  onReconnect,
  onReorder,
  onOpenWelcome,
  onRename,
  onSetFolder,
  onCloseProject,
  onRemoteAccess,
  onSetDefaultAccount,
  onSetDefaultPermissionMode,
  onSetColor,
  onSetIcon,
  onSaveArchive,
  onOpenArchive,
  archiveBusy
}: ProjectSwitcherProps) {
  // Select the raw array and filter in a memo, a `.filter()` inside the selector returns a fresh
  // array every store snapshot, which would re-render on EVERY projects change.
  const allProjects = useProjects((s) => s.projects)
  // Closed projects are hidden here (reopen them from the start screen's "Recently closed").
  const projects = useMemo(() => allProjects.filter((p) => !p.closed), [allProjects])
  const activeId = useProjects((s) => s.activeProjectId)
  const activeProject = projects.find((p) => p.id === activeId)
  const kanbanActive = useViewMode((s) => !!activeId && viewFor(s, activeId) === 'kanban')
  // Unread dots need only the unread id set — subscribing to the whole status map re-rendered on
  // every working/waiting flip of any agent. Primitive signature → rare updates.
  const unreadIds = useAgentStatus((s) => {
    let ids = ''
    for (const [id, st] of Object.entries(s.byId)) if (st?.unread) ids += `${id}|`
    return ids
  })
  const unreadSet = useMemo(() => new Set(unreadIds.split('|').filter(Boolean)), [unreadIds])
  // Own unread count on the pill vs. the sum across every OTHER project (the "+N elsewhere" chip
  // the switcher's badge alone can't express — a project row still shows its own count).
  const activeUnread = activeProject
    ? activeProject.nodes.filter((n) => unreadSet.has(n.id)).length
    : 0
  const otherUnread = projects
    .filter((p) => p.id !== activeId)
    .reduce((sum, p) => sum + p.nodes.filter((n) => unreadSet.has(n.id)).length, 0)

  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherPos, setSwitcherPos] = useState<{ top: number; left: number; flipBase: number } | null>(
    null
  )
  // Which project's inline "⋮" actions panel is expanded within the open dropdown.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Row drag-reorder: the project id being dragged + the current drop target ('' = end zone).
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  // Whether the actions panel's "Default Claude account" group is expanded (inline, in-place).
  const [acctOpen, setAcctOpen] = useState(false)
  // Whether the actions panel's "Default permission mode" group is expanded (same idiom).
  const [modeOpen, setModeOpen] = useState(false)
  // Whether the actions panel's "Project storage" group is expanded (same idiom). Lazily queries
  // hasPartsManifest for the project on open — see the effect below.
  const [storageOpen, setStorageOpen] = useState(false)
  // Per-project "is this project currently stored as parts?" — undefined = not yet queried/still
  // loading, so the row can show a truthful "Checking…" rather than guessing single-file. 'error'
  // means the check itself failed (never collapsed into a guessed true/false — see
  // queryPartsStatus).
  const [partsStatus, setPartsStatus] = useState<Record<string, boolean | 'error' | undefined>>({})
  const [storageConfirm, setStorageConfirm] = useState<{
    projectId: string
    cwd: string
    action: 'split' | 'join'
  } | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const partSizeValue = useSettings((s) => s.settings.projectPartSizeValue)
  const partSizeUnit = useSettings((s) => s.settings.projectPartSizeUnit)
  /**
   * The open project-colour surface (project id + viewport anchor), or null.
   *
   * `ColorMenu` is the shared portal surface — the same presets, wheel chip and inline full
   * picker the node context menu has. Opening it closes the switcher dropdown (same idiom as
   * "Lock this project…"), so there is never a menu behind a menu.
   */
  const [iconMenu, setIconMenu] = useState<{ projectId: string } | null>(null)
  const [colorMenu, setColorMenu] = useState<{ projectId: string; x: number; y: number } | null>(
    null
  )
  // Per-row DOM refs, so a row's "Edit tab appearance…" action can anchor the (non-modal)
  // appearance editor to the actual row element rather than the trigger that opened the dropdown.
  const rowElRef = useRef<Record<string, HTMLElement | null>>({})
  const switcherBtnRef = useRef<HTMLButtonElement | null>(null)
  const claudeAccounts = useSettings((s) => s.settings.claudeAccounts)
  // The mode a project without an override falls back to, shown in the "Use global (…)" entry.
  const globalMode = useSettings((s) => s.settings.claudePermissionMode)
  const systemLabelSetting = useSettings((s) => s.settings.systemAccountLabel)
  const remoteSystemAccountLabels = useSettings((s) => s.settings.remoteSystemAccountLabels)
  const systemEmail = useSystemAccount((s) => s.email)

  // Session labels appear only once a second session exists (4c: remote tabs). For a solo user
  // this is always false, so the dropdown renders exactly as before. Plain call, not a
  // subscription: sessions are registered at boot (and, in 4c, on connect, which re-renders
  // through its own store), so no store is needed here.
  const multiSession = sessionCount() > 1

  const expandedProject = projects.find((p) => p.id === expandedId)
  // Accounts eligible as the expanded project's default: local accounts for a local project,
  // this host's accounts for an SSH project (pending logins always excluded).
  const expandedAccounts = accountsForProject(claudeAccounts, expandedProject)
  // SSH project with no accounts on its host: say where accounts for this host come from instead
  // of presenting a bare System-only list (which read as "multi-account is broken on SSH").
  const expandedAccountsHint = sshAccountsHint(expandedProject, expandedAccounts)
  const expandedHost = expandedProject?.ssh ? sshHostKey(expandedProject.ssh.server) : undefined
  const systemPresentation = presentAccount({
    label: expandedHost ? remoteSystemAccountLabels[expandedHost] : systemLabelSetting,
    email: expandedHost ? undefined : systemEmail,
    host: expandedHost,
    machineLabel: expandedProject?.ssh?.server.label
  })
  // Live remote-probe view for the Auto rows below: on an SSH project `auto` only applies once the
  // REMOTE claude CLI is confirmed >= 2.1.71, and without a hint that silent fail-open degrade is
  // indistinguishable from a broken dropdown. Subscribed (not getState) so the ⚠︎ clears the
  // moment the probe answers while the panel is open.
  const autoPermByProject = useSshConn((s) => s.autoPermByProject)
  const remoteClaudeVersionByProject = useSshConn((s) => s.remoteClaudeVersionByProject)
  const expandedAutoHint = expandedProject?.ssh
    ? sshAutoModeHint(
        autoPermByProject[expandedProject.id] === undefined
          ? 'unknown'
          : autoPermByProject[expandedProject.id]
            ? 'yes'
            : 'no',
        remoteClaudeVersionByProject[expandedProject.id]
      )
    : null

  // Toy locks (docs/toy-locks.md) — a for-fun, opt-in gate on a project. `useToyLocks` is shared
  // across every lockable surface; this component reads it just to know which projects are
  // locked-and-not-currently-unlocked and to drive its own wizard/unlock popovers.
  const lockRecords = useToyLocks((s) => s.records)
  const unlockedUntil = useToyLocks((s) => s.unlockedUntil)
  useEffect(() => {
    void useToyLocks.getState().refresh()
  }, [])
  const lockForProject = (id: string) =>
    lockRecords.find((r) => r.target.kind === 'tab' && r.target.id === id)
  const isProjectLocked = (id: string): boolean => {
    const lock = lockForProject(id)
    if (!lock) return false
    const until = unlockedUntil[lock.id]
    return !(until !== undefined && Date.now() < until)
  }
  const [lockWizard, setLockWizard] = useState<{ projectId: string; x: number; y: number } | null>(
    null
  )
  const [unlockPrompt, setUnlockPrompt] = useState<{ projectId: string; x: number; y: number } | null>(
    null
  )
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null)
  // The lock could disappear out from under an open prompt (removed from Settings, or in another
  // window over a shared team session) — close it rather than let it keep asking for a credential
  // that no longer guards anything.
  useEffect(() => {
    if (unlockPrompt && !lockForProject(unlockPrompt.projectId)) {
      setUnlockPrompt(null)
      setPendingSwitchId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lockForProject reads lockRecords, listed here
  }, [unlockPrompt, lockRecords])
  // A 'session' duration lock re-locks the moment its project is LEFT (switched away from) — see
  // ToyLockDurationMode's doc comment in shared/toylock.ts. Minutes/until-close locks expire on
  // their own (isUnlocked re-evaluates the timestamp every read), so only 'session' needs this.
  // Kept mounted here (the switcher is always mounted, exactly as the old TabBar was) so a
  // 'session' lock never fails open by losing the component that used to relock it.
  const prevActiveIdRef = useRef<string | undefined>(activeId ?? undefined)
  useEffect(() => {
    const prev = prevActiveIdRef.current
    if (prev && prev !== activeId) {
      const lock = lockForProject(prev)
      if (lock && lock.duration === 'session') useToyLocks.getState().relock(lock.id)
    }
    prevActiveIdRef.current = activeId ?? undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lockForProject reads lockRecords
  }, [activeId, lockRecords])

  const closeMenu = () => {
    setSwitcherOpen(false)
    setSwitcherPos(null)
    setExpandedId(null)
    setAcctOpen(false)
    setModeOpen(false)
    setStorageOpen(false)
  }

  const openSwitcher = () => {
    const anchor = switcherBtnRef.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    setSwitcherOpen(true)
    setSwitcherPos({ top: r.bottom + 6, left: r.left, flipBase: r.top - 6 })
  }

  const toggleActions = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : id))
    setAcctOpen(false)
    setModeOpen(false)
    setStorageOpen(false)
  }

  // Query "is this project currently split into parts?" the moment its storage group opens. Only
  // when we don't already have an answer — a status the user just watched a split/join change is
  // refreshed explicitly by the action itself, never silently re-fetched underneath them.
  const queryPartsStatus = (projectId: string, cwd: string) => {
    if (partsStatus[projectId] !== undefined) return
    void window.nodeTerminal.workspace
      .hasPartsManifest(cwd)
      .then((v) => setPartsStatus((cur) => ({ ...cur, [projectId]: v })))
      .catch(() => setPartsStatus((cur) => ({ ...cur, [projectId]: 'error' })))
  }

  // Viewport-edge flip for the dropdown, same behavior as the right-click ContextMenu. Re-measures
  // on size changes, so expanding a row's account/permission-mode sub-lists near the bottom edge
  // lifts the menu instead of growing it off-screen.
  const menuFlip = useMenuFlip(switcherPos?.top ?? 0, switcherPos?.left ?? 0, switcherPos?.flipBase)

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setDraft(current)
  }

  const commitRename = () => {
    if (editingId) {
      const name = draft.trim()
      if (name) onRename(editingId, name)
    }
    setEditingId(null)
  }

  // The list scrolls the active row into view whenever it opens or the project set changes.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!switcherOpen) return
    listRef.current
      ?.querySelector('.md3-switcher-row.is-active')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [switcherOpen, activeId, projects.length])

  return (
    <>
      {(switcherOpen || editingId) && (
        <div
          className="md3-switcher-backdrop"
          onClick={() => {
            closeMenu()
            commitRename()
          }}
        />
      )}

      <div className="md3-switcher">
        <button
          ref={switcherBtnRef}
          className="md3-switcher__trigger"
          data-appearance-id={appearanceId('tab', activeProject?.id ?? 'none')}
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
          title={
            activeProject
              ? activeProject.ssh
                ? `${activeProject.ssh.server.user}@${activeProject.ssh.server.host}:${activeProject.ssh.remoteCwd}`
                : activeProject.cwd || activeProject.name
              : 'No project open'
          }
          onClick={() => (switcherOpen ? closeMenu() : openSwitcher())}
          onContextMenu={(e) => {
            e.preventDefault()
            if (!activeProject) return
            if (e.shiftKey) {
              openAppearanceEditor(
                appearanceId('tab', activeProject.id),
                activeProject.name,
                'tab',
                e.currentTarget as HTMLElement
              )
              return
            }
            openSwitcher()
            toggleActions(activeProject.id)
          }}
        >
          <ProjectGlyph
            className="md3-switcher__dot"
            variant="dot"
            icon={activeProject?.icon}
            color={activeProject?.color}
            name={activeProject?.name ?? ''}
          />
          <span className="md3-switcher__name">{activeProject?.name ?? 'No project'}</span>
          {activeUnread > 0 && (
            <span className="md3-switcher__badge" title={`${activeUnread} unread`}>
              {activeUnread}
            </span>
          )}
        </button>

        {activeProject && (
          <button
            className="tab__board-toggle"
            title={kanbanActive ? 'Canvas view (⌘⇧B)' : 'Kanban view (⌘⇧B)'}
            onClick={() => useViewMode.getState().toggle(activeProject.id)}
          >
            {kanbanActive ? <IconCanvasView /> : <IconKanban />}
          </button>
        )}

        {otherUnread > 0 && (
          <span
            className="md3-switcher__more-badge"
            title={`${otherUnread} unread in other projects`}
          >
            +{otherUnread}
          </span>
        )}

        {activeProject?.ssh && (
          <span
            className="md3-remote-chip"
            title={`${activeProject.ssh.server.user}@${activeProject.ssh.server.host}`}
          >
            {sshHostKey(activeProject.ssh.server)}
          </span>
        )}

        <button
          className="md3-switcher__caret"
          aria-label="Switch project"
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
          onClick={() => (switcherOpen ? closeMenu() : openSwitcher())}
        >
          <span aria-hidden>▾</span>
        </button>
      </div>

      {switcherOpen &&
        switcherPos &&
        createPortal(
          <div
            ref={menuFlip.ref}
            className="md3-switcher-menu"
            style={{ top: menuFlip.top, left: menuFlip.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="md3-switcher-menu__list"
              ref={listRef}
              // The list body itself is the "drop at the end" zone (per-row handlers stopPropagation).
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                if (dropId !== '') setDropId('')
              }}
              onDrop={(e) => {
                if (!dragId) return
                e.preventDefault()
                onReorder(dragId, null)
                setDragId(null)
                setDropId(null)
              }}
            >
              {projects.map((p) => {
                const active = p.id === activeId
                const unreadCount = p.nodes.filter((n) => unreadSet.has(n.id)).length
                const expanded = expandedId === p.id
                return (
                  <div key={p.id} className="md3-switcher-row-wrap">
                    <div
                      data-appearance-id={appearanceId('tab', p.id)}
                      ref={(el) => {
                        rowElRef.current[p.id] = el
                      }}
                      className={`md3-switcher-row${active ? ' is-active' : ''}${p.unavailable ? ' is-unavailable' : ''}${dropId === p.id ? ' is-drop-before' : ''}`}
                      draggable={editingId !== p.id}
                      // Normal right-click expands this row's actions panel in place; Shift+right-
                      // click opens the appearance editor directly, anchored to this row.
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (editingId) return
                        if (e.shiftKey) {
                          openAppearanceEditor(
                            appearanceId('tab', p.id),
                            p.name,
                            'tab',
                            e.currentTarget as HTMLElement
                          )
                          return
                        }
                        toggleActions(p.id)
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(p.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setDropId(null)
                      }}
                      onDragOver={(e) => {
                        if (!dragId) return
                        // Swallow even over the dragged row itself, so the list's end-zone
                        // highlight doesn't flicker on while passing over it.
                        e.stopPropagation()
                        if (dragId === p.id) return
                        e.preventDefault()
                        if (dropId !== p.id) setDropId(p.id)
                      }}
                      onDragLeave={() => setDropId((d) => (d === p.id ? null : d))}
                      onDrop={(e) => {
                        if (!dragId || dragId === p.id) return
                        e.preventDefault()
                        e.stopPropagation()
                        onReorder(dragId, p.id)
                        setDragId(null)
                        setDropId(null)
                      }}
                      onClick={(e) => {
                        if (editingId) return
                        // An unavailable row distinguishes by its bound session source: a dropped
                        // RELAY project reconnects on click (Stage 4 Task 7), a missing local
                        // folder is inert.
                        const action = tabClickAction(!!p.unavailable, sessionForProject(p.id).source)
                        if (action === 'switch') {
                          // Toy-lock gate: a locked-and-not-currently-unlocked project prompts to
                          // unlock instead of teleporting past the lock. Not on the ACTIVE project,
                          // though — that click just re-selects it.
                          if (!active && isProjectLocked(p.id)) {
                            setPendingSwitchId(p.id)
                            setUnlockPrompt({ projectId: p.id, x: e.clientX, y: e.clientY })
                            return
                          }
                          onSwitch(p.id)
                          closeMenu()
                        } else if (action === 'reconnect') {
                          onReconnect(p.id)
                          closeMenu()
                        }
                      }}
                      title={
                        p.unavailable
                          ? sessionForProject(p.id).source === 'local'
                            ? `${p.cwd ?? 'project'} is unavailable (folder missing or unreachable)`
                            : `${p.name} disconnected, click to reconnect`
                          : p.ssh
                            ? `${p.ssh.server.user}@${p.ssh.server.host}:${p.ssh.remoteCwd}`
                            : p.cwd || undefined
                      }
                    >
                      <ProjectGlyph
                        className="md3-switcher-row__dot"
                        variant="dot"
                        icon={p.icon}
                        color={p.color}
                        name={p.name}
                      />
                      {/* An SSH project looks identical to a local one once it is named, and the
                          difference matters: its terminals, git and file ops all run on another
                          machine. The chip says so at a glance; the row title carries user@host. */}
                      {p.ssh && (
                        <span
                          className="md3-switcher-row__ssh"
                          title={`${p.ssh.server.user}@${p.ssh.server.host}`}
                        >
                          SSH
                        </span>
                      )}
                      {lockForProject(p.id) && (
                        <span
                          className="md3-switcher-row__lock"
                          title="This project is locked. Click to unlock."
                        >
                          🔒
                        </span>
                      )}
                      {editingId === p.id ? (
                        <input
                          className="tab__edit"
                          value={draft}
                          autoFocus
                          spellCheck={false}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          onBlur={commitRename}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="md3-switcher-row__name">{p.name}</span>
                      )}

                      {multiSession && <ProjectSessionLabel projectId={p.id} />}

                      {unreadCount > 0 && (
                        <span className="md3-switcher-row__badge" title={`${unreadCount} unread`}>
                          {unreadCount}
                        </span>
                      )}

                      <button
                        className="md3-switcher-row__more"
                        title="Project options"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleActions(p.id)
                        }}
                      >
                        ⋮
                      </button>
                    </div>

                    {expanded && (
                      <div className="md3-switcher-actions" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => startRename(p.id, p.name)}>Rename</button>
                        <button
                          onClick={() => {
                            closeMenu()
                            setIconMenu({ projectId: p.id })
                          }}
                        >
                          <span className="tab-menu__check" aria-hidden>
                            <ProjectGlyph icon={p.icon} color={p.color} name={p.name} size={12} />
                          </span>
                          Icon…
                        </button>
                        <button
                          onClick={() => {
                            const anchor = rowElRef.current[p.id]
                            closeMenu()
                            if (anchor) {
                              openAppearanceEditor(appearanceId('tab', p.id), p.name, 'tab', anchor)
                            }
                          }}
                        >
                          {EDIT_TAB_APPEARANCE_ACTION.label}
                        </button>
                        <button
                          onClick={() => {
                            const anchor = rowElRef.current[p.id]
                            const r = anchor?.getBoundingClientRect()
                            closeMenu()
                            if (r) setColorMenu({ projectId: p.id, x: r.left, y: r.bottom })
                          }}
                        >
                          {/* Reuses the 16px check slot every other row indents by, so this row lines
                              up; the dot inside carries its own size since the slot has no height. */}
                          <span className="tab-menu__check" aria-hidden>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                alignSelf: 'center',
                                background: p.color
                              }}
                            />
                          </span>
                          Tab colour…
                        </button>
                        <button
                          onClick={() => {
                            onSetFolder(p.id)
                            closeMenu()
                          }}
                        >
                          Set folder…
                        </button>
                        <button
                          disabled={archiveBusy()}
                          onClick={() => {
                            closeMenu()
                            onSaveArchive(p.id)
                          }}
                        >
                          {SAVE_PROJECT_ARCHIVE_ACTION.label}
                        </button>
                        <button
                          disabled={archiveBusy()}
                          onClick={() => {
                            closeMenu()
                            onOpenArchive()
                          }}
                        >
                          {OPEN_PROJECT_ARCHIVE_ACTION.label}
                        </button>
                        <button
                          onClick={() => {
                            onRemoteAccess()
                            closeMenu()
                          }}
                        >
                          Docker host…
                        </button>
                        {expandedAccounts.length > 0 && p.id === expandedId && (
                          <>
                            <button
                              className={`tab-menu__group${acctOpen ? ' open' : ''}`}
                              onClick={() => setAcctOpen((v) => !v)}
                            >
                              Default Claude account
                              <span className="tab-menu__caret">▸</span>
                            </button>
                            {acctOpen && (
                              <div className="tab-menu__sub">
                                <button
                                  onClick={() => {
                                    onSetDefaultAccount(p.id, undefined)
                                    closeMenu()
                                  }}
                                >
                                  <AccountIdentityPills
                                    account={systemPresentation}
                                    selected={!p.defaultAccountId}
                                  />
                                </button>
                                {expandedAccounts.map((a) => (
                                  <button
                                    key={a.id}
                                    onClick={() => {
                                      onSetDefaultAccount(p.id, a.id)
                                      closeMenu()
                                    }}
                                  >
                                    <AccountIdentityPills
                                      account={presentAccount({
                                        label: a.label,
                                        email: a.email,
                                        host: a.host,
                                        machineLabel: p.ssh?.server.label
                                      })}
                                      selected={p.defaultAccountId === a.id}
                                    />
                                  </button>
                                ))}
                                {expandedAccountsHint && (
                                  <button disabled title={expandedAccountsHint}>
                                    <span className="tab-menu__check" />
                                    No accounts on this host yet
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                        <button
                          className={`tab-menu__group${modeOpen ? ' open' : ''}`}
                          onClick={() => setModeOpen((v) => !v)}
                        >
                          Default permission mode
                          <span className="tab-menu__caret">▸</span>
                        </button>
                        {modeOpen && (
                          <div className="tab-menu__sub">
                            <button
                              // On an SSH project the global Auto only applies once the REMOTE CLI
                              // is confirmed — surface why it may currently do nothing.
                              title={
                                globalMode === 'auto' ? (expandedAutoHint ?? undefined) : undefined
                              }
                              onClick={() => {
                                onSetDefaultPermissionMode(p.id, undefined)
                                closeMenu()
                              }}
                            >
                              <span className="tab-menu__check">
                                {p.defaultPermissionMode ? '' : '✓'}
                              </span>
                              Use global ({PERMISSION_MODE_LABELS[globalMode]})
                              {globalMode === 'auto' && expandedAutoHint ? ' ⚠︎' : ''}
                            </button>
                            {ALL_PERMISSION_MODES.map((m) => (
                              <button
                                key={m}
                                // A project override is written to <cwd>/.nodeterm/project.json,
                                // which is git-shared and mirrored to SSH servers — spell out for
                                // "Bypass all" that the choice travels to everyone who clones the
                                // repo. The Auto row instead explains when it will NOT apply on
                                // this SSH project's host, still selectable: the setting is kept
                                // and applies the moment the host's CLI qualifies.
                                title={
                                  m === 'bypassPermissions'
                                    ? `Skips every permission prompt. This override is saved in the project file (.nodeterm/project.json), so if you commit it, everyone who clones the repo runs their ${permissionModeAgentsLabel({ mode: 'bypassPermissions' })} sessions without permission checks too. ${bypassSandboxCaveat()}`.trim()
                                    : m === 'auto'
                                      ? (expandedAutoHint ?? undefined)
                                      : undefined
                                }
                                onClick={() => {
                                  onSetDefaultPermissionMode(p.id, m)
                                  closeMenu()
                                }}
                              >
                                <span className="tab-menu__check">
                                  {p.defaultPermissionMode === m ? '✓' : ''}
                                </span>
                                {m === 'bypassPermissions' || (m === 'auto' && expandedAutoHint)
                                  ? `${PERMISSION_MODE_LABELS[m]} ⚠︎`
                                  : PERMISSION_MODE_LABELS[m]}
                              </button>
                            ))}
                          </div>
                        )}
                        {p.ssh ? (
                          <button disabled title="Splitting a project into parts is local-only — not available for SSH projects yet.">
                            Project storage: not available (SSH)
                          </button>
                        ) : !p.cwd ? (
                          <button disabled title="This canvas has no folder on disk yet, so there is no project.json to split.">
                            Project storage: no folder yet
                          </button>
                        ) : (
                          <>
                            <button
                              className={`tab-menu__group${storageOpen ? ' open' : ''}`}
                              onClick={() => {
                                setStorageOpen((v) => !v)
                                if (!storageOpen) queryPartsStatus(p.id, p.cwd!)
                              }}
                            >
                              Project storage
                              <span className="tab-menu__caret">▸</span>
                            </button>
                            {storageOpen && p.id === expandedId && (
                              <div className="tab-menu__sub">
                                <button disabled>
                                  {partsStatus[p.id] === undefined
                                    ? 'Checking…'
                                    : partsStatus[p.id] === 'error'
                                      ? 'Could not check — see project.json directly'
                                      : partsStatus[p.id]
                                        ? 'Currently stored as parts + a manifest'
                                        : 'Currently a single project.json'}
                                </button>
                                {partsStatus[p.id] === true && (
                                  <button
                                    onClick={() =>
                                      setStorageConfirm({ projectId: p.id, cwd: p.cwd!, action: 'join' })
                                    }
                                  >
                                    Join back into a single file…
                                  </button>
                                )}
                                {partsStatus[p.id] === false && (
                                  <button
                                    onClick={() =>
                                      setStorageConfirm({ projectId: p.id, cwd: p.cwd!, action: 'split' })
                                    }
                                  >
                                    {`Split into ${partSizeValue} ${partSizeUnit} parts…`}
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                        <button
                          onClick={() => {
                            const lock = lockForProject(p.id)
                            const anchor = rowElRef.current[p.id]
                            const r = anchor?.getBoundingClientRect()
                            closeMenu()
                            if (!r) return
                            if (lock) setUnlockPrompt({ projectId: p.id, x: r.left, y: r.bottom })
                            else setLockWizard({ projectId: p.id, x: r.left, y: r.bottom })
                          }}
                        >
                          {lockForProject(p.id) ? 'Manage lock…' : 'Lock this tab…'}
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            onCloseProject(p.id)
                            closeMenu()
                          }}
                        >
                          Close project
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <button className="md3-switcher-menu__add" onClick={onOpenWelcome}>
              <span aria-hidden>+</span> New project
            </button>
          </div>,
          document.body
        )}

      {iconMenu && (
        <IconMenu
          open
          value={projects.find((p) => p.id === iconMenu.projectId)?.icon}
          color={projects.find((p) => p.id === iconMenu.projectId)?.color}
          name={projects.find((p) => p.id === iconMenu.projectId)?.name ?? ''}
          onPick={(icon) => onSetIcon(iconMenu.projectId, icon)}
          onClose={() => setIconMenu(null)}
        />
      )}

      {colorMenu && (
        <ColorMenu
          x={colorMenu.x}
          y={colorMenu.y}
          // Seeded from the project's CURRENT colour, read from the store on every render, so the
          // picker opens on the colour the project is actually wearing.
          value={projects.find((p) => p.id === colorMenu.projectId)?.color}
          // Live: the switcher/row dot, the row name colour and the sidebar monogram repaint as
          // the picker is dragged. Dismissal is the backdrop or Escape — nothing to confirm.
          onPick={(color) => onSetColor(colorMenu.projectId, color)}
          onClose={() => setColorMenu(null)}
        />
      )}

      {lockWizard && (
        <LockWizard
          target={{
            kind: 'tab',
            id: lockWizard.projectId,
            label: projects.find((p) => p.id === lockWizard.projectId)?.name ?? 'this project'
          }}
          anchor={{ x: lockWizard.x, y: lockWizard.y }}
          onClose={() => setLockWizard(null)}
        />
      )}
      {unlockPrompt &&
        lockForProject(unlockPrompt.projectId) &&
        (() => {
          const record = lockForProject(unlockPrompt.projectId)!
          return (
            <UnlockPrompt
              record={record}
              anchor={{ x: unlockPrompt.x, y: unlockPrompt.y }}
              onClose={() => {
                setUnlockPrompt(null)
                setPendingSwitchId(null)
              }}
              onUnlocked={() => {
                setUnlockPrompt(null)
                if (pendingSwitchId) onSwitch(pendingSwitchId)
                setPendingSwitchId(null)
              }}
            />
          )
        })()}
      {storageConfirm && (
        <ConfirmDialog
          message={
            storageConfirm.action === 'split'
              ? `Split "${projects.find((p) => p.id === storageConfirm.projectId)?.name ?? 'this project'}" into ${partSizeValue} ${partSizeUnit} parts?`
              : `Join "${projects.find((p) => p.id === storageConfirm.projectId)?.name ?? 'this project'}" back into a single project.json?`
          }
          body={
            <p>
              {storageConfirm.action === 'split'
                ? 'This rewrites .nodeterm/project.json into a manifest + numbered part files, at that folder\'s own path. It is git-shared: everyone who pulls this repo gets the new file layout too. An older nodeterm build cannot read a split project until it is joined back.'
                : 'This rewrites the parts + manifest back into a single .nodeterm/project.json, at that folder\'s own path. It is git-shared: everyone who pulls this repo gets the new file layout too.'}
              {storageError && <><br /><strong>{storageError}</strong></>}
            </p>
          }
          confirmLabel={storageConfirm.action === 'split' ? 'Split' : 'Join'}
          busy={storageBusy}
          onCancel={() => {
            setStorageConfirm(null)
            setStorageError(null)
          }}
          onConfirm={async () => {
            const { projectId, cwd, action } = storageConfirm
            setStorageBusy(true)
            setStorageError(null)
            try {
              const result =
                action === 'split'
                  ? await window.nodeTerminal.workspace.splitIntoParts(cwd, partSizeValue, partSizeUnit)
                  : await window.nodeTerminal.workspace.joinParts(cwd)
              if (!result.ok) {
                setStorageError(result.reason)
                setStorageBusy(false)
                return
              }
              // Re-read the true state rather than assuming the requested action landed.
              const now = await window.nodeTerminal.workspace.hasPartsManifest(cwd)
              setPartsStatus((cur) => ({ ...cur, [projectId]: now }))
              setStorageConfirm(null)
              setStorageBusy(false)
            } catch (e) {
              setStorageError(e instanceof Error ? e.message : String(e))
              setStorageBusy(false)
            }
          }}
        />
      )}
    </>
  )
}
