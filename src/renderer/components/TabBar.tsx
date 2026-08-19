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
import { resolveAppDisplayName } from '@shared/appIdentity'
import { resolveLogoPreset } from './appearance/BrandMark'
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
import { useToyLocks } from '../state/toylocks'
import { LockWizard } from './toylocks/LockWizard'
import { UnlockPrompt } from './toylocks/UnlockPrompt'

interface TabBarProps {
  onSwitch: (id: string) => void
  /** Reconnect an offline (dropped) relay tab in place (Stage 4 Task 7). Called when an
   *  "unavailable" tab whose session is a relay/server source is clicked. */
  onReconnect: (id: string) => void
  /** Reorder a project to sit before another (null = to the end). Shared with the sessions
   *  sidebar: both surfaces render the projects array, so one drag updates both. */
  onReorder: (draggedId: string, beforeId: string | null) => void
  /** Open the start screen (New project / Open folder / Clone repo), what "+" now shows. */
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
  /** Set the project's colour — the tab text/dot, the kanban header dot, the sidebar monogram.
   *  Called LIVE while the picker is dragged, so it must be a cheap, coalescing writer. */
  onSetColor: (id: string, color: string) => void
}

/**
 * The runtime session dimension of a tab (which core the project lives on). Rendered ONLY when
 * more than one session exists, `sessionCount()` is 1 for a solo user today, so this never
 * mounts and the solo tab bar is pixel-identical. Its own component because
 * `useProjectSession` is a hook and the tabs render in a `.map()`. Nothing here is persisted:
 * the project → session binding is resolved at runtime by `sessionForProject`.
 */
function TabSessionLabel({ projectId }: { projectId: string }) {
  const session = useProjectSession(projectId)
  return (
    <span className="tab__session" title={`Session: ${session.label} (${session.status})`}>
      {session.label}
    </span>
  )
}

/**
 * Top tab bar, one tab per project. Click to switch, "+" to add. The active tab
 * exposes a caret menu (Rename / Set folder / Delete). The menu is rendered in a body
 * portal with fixed positioning so it is never clipped by the tab strip's overflow nor
 * hidden behind the canvas.
 */
export function TabBar({
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
  onSetColor
}: TabBarProps) {
  // Select the raw array and filter in a memo, a `.filter()` inside the selector returns a
  // fresh array every store snapshot, which re-rendered the TabBar on EVERY projects change.
  const allProjects = useProjects((s) => s.projects)
  // Closed projects are hidden here (reopen them from the start screen's "Recently closed").
  const projects = useMemo(() => allProjects.filter((p) => !p.closed), [allProjects])
  const activeId = useProjects((s) => s.activeProjectId)
  const kanbanActive = useViewMode((s) => !!activeId && viewFor(s, activeId) === 'kanban')
  // Unread dots need only the unread id set — subscribing to the whole status map re-rendered
  // the TabBar on every working/waiting flip of any agent. Primitive signature → rare updates.
  const unreadIds = useAgentStatus((s) => {
    let ids = ''
    for (const [id, st] of Object.entries(s.byId)) if (st?.unread) ids += `${id}|`
    return ids
  })
  const unreadSet = useMemo(() => new Set(unreadIds.split('|').filter(Boolean)), [unreadIds])
  const [menuId, setMenuId] = useState<string | null>(null)
  // `flipBase` is the ANCHOR's top edge: when the menu would overflow the bottom of the window,
  // it opens upward from the caret button instead (see useMenuFlip below).
  const [menuPos, setMenuPos] = useState<{
    top: number
    left: number
    flipBase: number
  } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Tab drag-reorder: the project id being dragged + the current drop target ('' = end zone).
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  // Whether the caret menu's "Default Claude account" group is expanded (inline, in-place).
  const [acctOpen, setAcctOpen] = useState(false)
  // Whether the caret menu's "Default permission mode" group is expanded (same idiom as acctOpen).
  const [modeOpen, setModeOpen] = useState(false)
  /**
   * The open tab-colour surface (project id + viewport anchor), or null.
   *
   * It is NOT an inline group like the two above, and not a swatch strip: `.tab-menu button` is a
   * full-width padded row, so a ColorPicker rendered inside this menu would have every one of its
   * format tabs, swatches and its Copy button stretched into menu rows. `ColorMenu` is the shared
   * portal surface — the same presets, wheel chip and inline full picker the node context menu
   * has, at no cost in new CSS. Opening it CLOSES the caret menu (same idiom as "Lock this tab…"),
   * so there is never a menu behind a menu.
   */
  const [colorMenu, setColorMenu] = useState<{
    projectId: string
    x: number
    y: number
  } | null>(null)
  // Per-tab DOM refs, so the caret menu's "Edit tab appearance…" row can anchor the (non-modal)
  // appearance editor to the actual tab element rather than the caret button that opened the menu.
  const tabElRef = useRef<Record<string, HTMLElement | null>>({})
  // The user's chosen display name (docs/app-rename.md), or the shipped name if unset — the brand
  // mark is the one piece of chrome that always introduces the app.
  const displayName = useSettings((s) => resolveAppDisplayName(s.settings.appDisplayName))
  const appLogo = useSettings((s) => s.settings.appLogo)
  const claudeAccounts = useSettings((s) => s.settings.claudeAccounts)
  // The mode a project without an override falls back to, shown in the "Use global (…)" entry.
  const globalMode = useSettings((s) => s.settings.claudePermissionMode)
  const systemLabelSetting = useSettings((s) => s.settings.systemAccountLabel)
  const remoteSystemAccountLabels = useSettings((s) => s.settings.remoteSystemAccountLabels)
  const systemEmail = useSystemAccount((s) => s.email)

  // Session labels appear only once a second session exists (4c: remote tabs). For a solo user
  // this is always false, so the tab strip renders exactly as before. Plain call, not a
  // subscription: sessions are registered at boot (and, in 4c, on connect, which re-renders
  // through its own state), so no store is needed here.
  const multiSession = sessionCount() > 1

  const menuProject = projects.find((p) => p.id === menuId)
  // Accounts eligible as the caret-menu project's default: local accounts for a local project, this
  // host's accounts for an SSH project (pending logins always excluded).
  const menuAccounts = accountsForProject(claudeAccounts, menuProject)
  // SSH project with no accounts on its host: say where accounts for this host come from instead
  // of presenting a bare System-only list (which read as "multi-account is broken on SSH").
  const menuAccountsHint = sshAccountsHint(menuProject, menuAccounts)
  const menuHost = menuProject?.ssh ? sshHostKey(menuProject.ssh.server) : undefined
  const systemPresentation = presentAccount({
    label: menuHost ? remoteSystemAccountLabels[menuHost] : systemLabelSetting,
    email: menuHost ? undefined : systemEmail,
    host: menuHost,
    machineLabel: menuProject?.ssh?.server.label
  })
  // Live remote-probe view for the Auto rows below: on an SSH project `auto` only applies once the
  // REMOTE claude CLI is confirmed >= 2.1.71, and without a hint that silent fail-open degrade is
  // indistinguishable from a broken dropdown. Subscribed (not getState) so the ⚠︎ clears the
  // moment the probe answers while the menu is open.
  const autoPermByProject = useSshConn((s) => s.autoPermByProject)
  const remoteClaudeVersionByProject = useSshConn((s) => s.remoteClaudeVersionByProject)
  const menuAutoHint = menuProject?.ssh
    ? sshAutoModeHint(
        autoPermByProject[menuProject.id] === undefined
          ? 'unknown'
          : autoPermByProject[menuProject.id]
            ? 'yes'
            : 'no',
        remoteClaudeVersionByProject[menuProject.id]
      )
    : null

  // Toy locks (docs/toy-locks.md) — a for-fun, opt-in gate on a project tab. `useToyLocks` is
  // shared across every lockable surface; this component reads it just to know which tabs are
  // locked-and-not-currently-unlocked and to drive its own wizard/unlock popovers.
  const lockRecords = useToyLocks((s) => s.records)
  const unlockedUntil = useToyLocks((s) => s.unlockedUntil)
  useEffect(() => {
    void useToyLocks.getState().refresh()
  }, [])
  const lockForProject = (id: string) => lockRecords.find((r) => r.target.kind === 'tab' && r.target.id === id)
  const isTabLocked = (id: string): boolean => {
    const lock = lockForProject(id)
    if (!lock) return false
    const until = unlockedUntil[lock.id]
    return !(until !== undefined && Date.now() < until)
  }
  const [lockWizard, setLockWizard] = useState<{ projectId: string; x: number; y: number } | null>(null)
  const [unlockPrompt, setUnlockPrompt] = useState<{ projectId: string; x: number; y: number } | null>(null)
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
  // The 'session'-duration re-lock-on-tab-leave behaviour that used to live here moved to
  // `useSessionRelock` (state/useSessionRelock.ts), mounted once from Canvas.tsx — it is a
  // session-lifecycle rule, not tab-bar UI, and this component's own lockForProject/lockRecords
  // above already cover everything this file still needs from the lock store.

  const closeMenu = () => {
    setMenuId(null)
    setMenuPos(null)
    setAcctOpen(false)
    setModeOpen(false)
  }

  const openMenu = (id: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect()
    setMenuId(id)
    setMenuPos({ top: r.bottom + 4, left: r.left, flipBase: r.top - 4 })
  }

  // Viewport-edge flip for the caret menu, same behavior as the right-click ContextMenu. The
  // hook runs unconditionally (menuPos may be null while closed; the ref is simply unattached
  // then) and re-measures on size changes, so EXPANDING the account/permission sub-lists near
  // the bottom edge lifts the menu instead of growing it off-screen.
  const menuFlip = useMenuFlip(menuPos?.top ?? 0, menuPos?.left ?? 0, menuPos?.flipBase)

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setDraft(current)
    closeMenu()
  }

  const commitRename = () => {
    if (editingId) {
      const name = draft.trim()
      if (name) onRename(editingId, name)
    }
    setEditingId(null)
  }

  // The strip scrolls without a visible scrollbar (see .tabbar__tabs), so keep it navigable:
  // a plain mouse wheel scrolls it horizontally, and the active tab is brought into view.
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    tabsRef.current
      ?.querySelector('.tab.active')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [activeId, projects.length])

  return (
    <>
      {(menuId || editingId) && (
        <div
          className="tab-backdrop"
          onClick={() => {
            closeMenu()
            commitRename()
          }}
        />
      )}

      <div className="tabbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            {appLogo.selection === 'custom' && appLogo.customImage ? (
              <img
                src={appLogo.customImage.dataUrl}
                width={26}
                height={26}
                alt=""
                style={{ borderRadius: 6, objectFit: 'contain' }}
              />
            ) : (
              resolveLogoPreset(appLogo.selection).render(26)
            )}
          </span>
          <span className="brand__name" data-appearance-id="app:tabbar-brand">
            {displayName}
          </span>
        </div>

        <div
          className="tabbar__tabs"
          ref={tabsRef}
          onWheel={(e) => {
            // Translate a vertical mouse wheel into horizontal strip scrolling (trackpads
            // already produce deltaX). Nothing above the canvas scrolls vertically anyway.
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
          }}
          // The strip itself is the "drop at the end" zone (per-tab handlers stopPropagation).
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
            return (
              <div
                key={p.id}
                data-appearance-id={appearanceId('tab', p.id)}
                ref={(el) => {
                  tabElRef.current[p.id] = el
                }}
                className={`tab${active ? ' active' : ''}${p.unavailable ? ' unavailable' : ''}${dropId === p.id ? ' is-drop-before' : ''}`}
                style={active ? { color: p.color } : undefined}
                draggable={editingId !== p.id}
                // Normal right-click keeps tab management (the same caret menu, now with "Edit tab
                // appearance…" added to it); Shift+right-click opens the appearance editor
                // directly, anchored to this tab.
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
                  openMenu(p.id, e.currentTarget as HTMLElement)
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
                  // Swallow even over the dragged tab itself, so the strip's end-zone
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
                  // An unavailable tab distinguishes by its bound session source: a dropped RELAY
                  // tab reconnects on click (Stage 4 Task 7), a missing local folder is inert.
                  const action = tabClickAction(!!p.unavailable, sessionForProject(p.id).source)
                  if (action === 'switch') {
                    // Toy-lock gate: a locked-and-not-currently-unlocked tab prompts to unlock
                    // instead of teleporting past the lock. Not on the ACTIVE tab, though — that
                    // click just re-selects it, and prompting again for a tab you're already
                    // looking at would be the "assumed unlocked forever" trap in reverse.
                    if (!active && isTabLocked(p.id)) {
                      setPendingSwitchId(p.id)
                      setUnlockPrompt({ projectId: p.id, x: e.clientX, y: e.clientY })
                      return
                    }
                    onSwitch(p.id)
                  } else if (action === 'reconnect') onReconnect(p.id)
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
                <span
                  className="tab__dot"
                  style={active ? { background: p.color } : undefined}
                />
                {/* An SSH project looks identical to a local one once it is named, and the
                    difference matters: its terminals, git and file ops all run on another
                    machine. The chip says so at a glance; the tab title carries user@host. */}
                {p.ssh && (
                  <span className="tab__ssh" title={`${p.ssh.server.user}@${p.ssh.server.host}`}>
                    SSH
                  </span>
                )}
                {lockForProject(p.id) && (
                  <span className="tab__lock" title="This tab is locked — just for fun, not security">
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
                  <span className="tab__name">{p.name}</span>
                )}

                {multiSession && <TabSessionLabel projectId={p.id} />}

                {unreadCount > 0 && (
                  <span className="tab__badge" title={`${unreadCount} unread`}>
                    {unreadCount}
                  </span>
                )}

                {active && editingId !== p.id && (
                  <button
                    className="tab__board-toggle"
                    title={kanbanActive ? 'Canvas view (⌘⇧B)' : 'Kanban view (⌘⇧B)'}
                    onClick={(e) => {
                      e.stopPropagation() // a tab click switches projects, this only flips the view
                      useViewMode.getState().toggle(p.id)
                    }}
                  >
                    {kanbanActive ? <IconCanvasView /> : <IconKanban />}
                  </button>
                )}
                {active && editingId !== p.id && (
                  <button
                    className="tab__caret"
                    title="Project options"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (menuId === p.id) closeMenu()
                      else openMenu(p.id, e.currentTarget)
                    }}
                  >
                    ⌄
                  </button>
                )}
              </div>
            )
          })}

          <button className="tab__add" title="New project" onClick={onOpenWelcome}>
            +
          </button>
        </div>
      </div>

      {menuId &&
        menuPos &&
        menuProject &&
        createPortal(
          <div
            ref={menuFlip.ref}
            className="tab-menu"
            style={{ top: menuFlip.top, left: menuFlip.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => startRename(menuProject.id, menuProject.name)}>Rename</button>
            <button
              onClick={() => {
                const anchor = tabElRef.current[menuProject.id]
                closeMenu()
                if (anchor) {
                  openAppearanceEditor(
                    appearanceId('tab', menuProject.id),
                    menuProject.name,
                    'tab',
                    anchor
                  )
                }
              }}
            >
              Edit tab appearance…
            </button>
            <button
              onClick={() => {
                const pos = menuPos
                const id = menuProject.id
                closeMenu()
                if (pos) setColorMenu({ projectId: id, x: pos.left, y: pos.top })
              }}
            >
              {/* Reuses the 16px check slot every other row indents by, so this row lines up;
                  the dot inside carries its own size because the slot itself has no height. */}
              <span className="tab-menu__check" aria-hidden>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    alignSelf: 'center',
                    background: menuProject.color
                  }}
                />
              </span>
              Tab colour…
            </button>
            <button
              onClick={() => {
                onSetFolder(menuProject.id)
                closeMenu()
              }}
            >
              Set folder…
            </button>
            <button
              onClick={() => {
                onRemoteAccess()
                closeMenu()
              }}
            >
              Remote access…
            </button>
            {menuAccounts.length > 0 && (
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
                        onSetDefaultAccount(menuProject.id, undefined)
                        closeMenu()
                      }}
                    >
                      <AccountIdentityPills
                        account={systemPresentation}
                        selected={!menuProject.defaultAccountId}
                      />
                    </button>
                    {menuAccounts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          onSetDefaultAccount(menuProject.id, a.id)
                          closeMenu()
                        }}
                      >
                        <AccountIdentityPills
                          account={presentAccount({
                            label: a.label,
                            email: a.email,
                            host: a.host,
                            machineLabel: menuProject.ssh?.server.label
                          })}
                          selected={menuProject.defaultAccountId === a.id}
                        />
                      </button>
                    ))}
                    {menuAccountsHint && (
                      <button disabled title={menuAccountsHint}>
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
                  // On an SSH project the global Auto only applies once the REMOTE CLI is
                  // confirmed, surface why it may currently do nothing (see menuAutoHint).
                  title={globalMode === 'auto' ? (menuAutoHint ?? undefined) : undefined}
                  onClick={() => {
                    onSetDefaultPermissionMode(menuProject.id, undefined)
                    closeMenu()
                  }}
                >
                  <span className="tab-menu__check">
                    {menuProject.defaultPermissionMode ? '' : '✓'}
                  </span>
                  Use global ({PERMISSION_MODE_LABELS[globalMode]})
                  {globalMode === 'auto' && menuAutoHint ? ' ⚠︎' : ''}
                </button>
                {ALL_PERMISSION_MODES.map((m) => (
                  <button
                    key={m}
                    // A project override is written to <cwd>/.nodeterm/project.json, which is
                    // git-shared and mirrored to SSH servers, spell out for "Bypass all" that
                    // the choice travels to everyone who clones the repo. The Auto row instead
                    // explains when it will NOT apply on this SSH project's host (remote CLI too
                    // old / not found / not probed yet), still selectable: the setting is kept
                    // and applies the moment the host's CLI qualifies.
                    title={
                      m === 'bypassPermissions'
                        ? // Both the agent list and the sandbox caveat are derived from the mapping
                          // (approval-mode.ts): the list names exactly the agents "Bypass all"
                          // actually reaches, so it cannot warn about an agent the mode never applies
                          // to — or fall silent about one it newly does. The caveat is owed because
                          // for codex the mode skips APPROVALS only: `--ask-for-approval never` does
                          // not touch `--sandbox`, which we deliberately leave alone, so "no
                          // permission checks" must not be read as "no sandbox either".
                          `Skips every permission prompt. This override is saved in the project file (.nodeterm/project.json), so if you commit it, everyone who clones the repo runs their ${permissionModeAgentsLabel({ mode: 'bypassPermissions' })} sessions without permission checks too. ${bypassSandboxCaveat()}`.trim()
                        : m === 'auto'
                          ? (menuAutoHint ?? undefined)
                          : undefined
                    }
                    onClick={() => {
                      onSetDefaultPermissionMode(menuProject.id, m)
                      closeMenu()
                    }}
                  >
                    <span className="tab-menu__check">
                      {menuProject.defaultPermissionMode === m ? '✓' : ''}
                    </span>
                    {m === 'bypassPermissions' || (m === 'auto' && menuAutoHint)
                      ? `${PERMISSION_MODE_LABELS[m]} ⚠︎`
                      : PERMISSION_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                const lock = lockForProject(menuProject.id)
                const pos = menuPos
                closeMenu()
                if (!pos) return
                if (lock) {
                  setUnlockPrompt({ projectId: menuProject.id, x: pos.left, y: pos.top })
                } else {
                  setLockWizard({ projectId: menuProject.id, x: pos.left, y: pos.top })
                }
              }}
            >
              {lockForProject(menuProject.id) ? 'Manage lock…' : 'Lock this tab…'}
            </button>
            <button
              onClick={() => {
                onCloseProject(menuProject.id)
                closeMenu()
              }}
            >
              Close project
            </button>
          </div>,
          document.body
        )}

      {colorMenu && (
        <ColorMenu
          x={colorMenu.x}
          y={colorMenu.y}
          // Seeded from the tab's CURRENT colour, read from the store on every render, so the
          // picker opens on the colour the tab is actually wearing.
          value={projects.find((p) => p.id === colorMenu.projectId)?.color}
          // Live: the tab text, its dot and the sidebar monogram repaint as the picker is dragged.
          // Dismissal is the backdrop or Escape — there is nothing to confirm.
          onPick={(color) => onSetColor(colorMenu.projectId, color)}
          onClose={() => setColorMenu(null)}
        />
      )}

      {lockWizard && (
        <LockWizard
          target={{
            kind: 'tab',
            id: lockWizard.projectId,
            label: projects.find((p) => p.id === lockWizard.projectId)?.name ?? 'this tab'
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
    </>
  )
}
