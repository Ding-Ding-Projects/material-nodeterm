import { useState } from 'react'
import { AGENT_CONFIG, BUILTIN_AGENT_IDS, type AgentId } from '@shared/agents/config'
import { formatShortcut, isHoldChord } from '@shared/shortcut'
import { hintLabel } from '@shared/platform-utils'
import { AgentIcon } from '../lib/agentIcons'
import { useSettings } from '../state/settings'
import { useProjects } from '../state/projects'
import { accountsForProject, sshAccountsHint } from '../state/workspace'
import type { TerminalProfileChoice } from '../lib/terminal-profile-actions'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

interface DockProps {
  dirty: boolean
  zoomPct: number
  canUndo: boolean
  canRedo: boolean
  onAddTerminal: () => void
  /** Desktop-local Windows capability. Keep false for SSH, relay, and Server Edition sessions. */
  offersTerminalProfiles?: boolean
  terminalProfileChoices?: readonly TerminalProfileChoice[]
  /** Canvas supplies detecting, failed-read, or confirmed-empty copy without collapsing them. */
  terminalProfileEmptyState?: { label: string; hint: string }
  /** Receives only the stable trusted-core profile id selected by the user. */
  onAddTerminalWithProfile?: (profileId: string) => void
  onAddSticky: () => void
  onAddDino: () => void
  onAddAgent: (agentId: AgentId, accountId?: string) => void
  onOpenFile: () => void
  onAddRemote: () => void
  onConnectRemote: () => void
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onFitView: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onDictate: () => void
  dictateActive: boolean
}

/**
 * Bottom-center floating dock. The "+" opens a node-type menu above it.
 * All canvas actions live here so the canvas itself stays clean.
 */
export function Dock({
  dirty,
  zoomPct,
  canUndo,
  canRedo,
  onAddTerminal,
  offersTerminalProfiles = false,
  terminalProfileChoices = [],
  terminalProfileEmptyState,
  onAddTerminalWithProfile,
  onAddSticky,
  onAddDino,
  onAddAgent,
  onOpenFile,
  onAddRemote,
  onConnectRemote,
  onUndo,
  onRedo,
  onSave,
  onFitView,
  onZoomIn,
  onZoomOut,
  onDictate,
  dictateActive
}: DockProps) {
  const profileText = useLocalizedVocabularyText()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const dictationShortcut = useSettings((s) => s.settings.speech.shortcut)
  const customAgents = useSettings((s) => s.settings.customAgents)
  const disabledAgents = useSettings((s) => s.settings.disabledAgents)
  const claudeAccounts = useSettings((s) => s.settings.claudeAccounts)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const activeProject = useProjects((s) => s.projects.find((p) => p.id === activeProjectId))
  // Accounts usable in the active project (local for a local project, this host's for an SSH
  // project). The flat dock menu can't nest, so Claude gets one "New Claude — <label>" entry per
  // account (plus the base "Claude" = project default).
  const localAccounts = accountsForProject(claudeAccounts, activeProject)
  // ✓ marks the project's default account entry (what the base "Claude" resolves to).
  const defaultAccountId = localAccounts.some((a) => a.id === activeProject?.defaultAccountId)
    ? activeProject?.defaultAccountId
    : undefined
  const profileEmptyState = terminalProfileEmptyState ?? {
    label: profileText('terminalProfiles.common.profilesUnavailable', 'Profiles unavailable'),
    hint: profileText(
      'terminalProfiles.create.detectionReturnedNone',
      'Profile detection has not returned any profiles.'
    )
  }

  const closeMenu = () => {
    setMenuOpen(false)
    setProfileMenuOpen(false)
  }

  const pick = (fn: () => void) => () => {
    fn()
    closeMenu()
  }

  const toggleMenu = () => {
    if (menuOpen) closeMenu()
    else {
      setProfileMenuOpen(false)
      setMenuOpen(true)
    }
  }

  return (
    <>
      {menuOpen && <div className="dock-backdrop" onClick={closeMenu} />}

      <div className="dock">
        {menuOpen && (
          <div
            className="dock-menu"
            role="menu"
            aria-label={
              profileMenuOpen
                ? profileText('terminalProfiles.create.chooseProfileAria', 'Choose terminal profile')
                : 'Add node'
            }
          >
            {profileMenuOpen ? (
              <>
                <button role="menuitem" onClick={() => setProfileMenuOpen(false)}>
                  <BackIcon />
                  <span>
                    {profileText('terminalProfiles.create.backToNewNodes', 'Back to new nodes')}
                  </span>
                </button>
                {terminalProfileChoices.length ? (
                  terminalProfileChoices.map((profile, index) => {
                    const disabled = profile.disabled || !onAddTerminalWithProfile
                    const disabledReason = profile.disabled
                      ? profile.hint?.trim() ||
                        profileText(
                          'terminalProfiles.common.unavailableOnMachine',
                          'This profile is unavailable on this machine.'
                        )
                      : !onAddTerminalWithProfile
                        ? profileText(
                            'terminalProfiles.create.unavailableInView',
                            'Terminal profile creation is unavailable in this view.'
                          )
                        : undefined
                    const reasonId = disabled
                      ? `dock-terminal-profile-reason-${index}`
                      : undefined
                    return (
                      <button
                        key={profile.id}
                        role="menuitem"
                        aria-disabled={disabled || undefined}
                        aria-describedby={reasonId}
                        title={disabledReason}
                        onClick={() => {
                          if (disabled || !onAddTerminalWithProfile) return
                          pick(() => onAddTerminalWithProfile(profile.id))()
                        }}
                      >
                        <TerminalIcon />
                        <span className="dock-menu__copy">
                          <span>{profile.label}</span>
                          {disabledReason ? (
                            <span id={reasonId} className="dock-menu__hint">
                              {disabledReason}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <button
                    role="menuitem"
                    aria-disabled="true"
                    aria-describedby="dock-terminal-profile-empty-reason"
                    title={profileEmptyState.hint}
                  >
                    <TerminalIcon />
                    <span className="dock-menu__copy">
                      <span>{profileEmptyState.label}</span>
                      <span
                        id="dock-terminal-profile-empty-reason"
                        className="dock-menu__hint"
                      >
                        {profileEmptyState.hint}
                      </span>
                    </span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button role="menuitem" onClick={pick(onAddTerminal)}>
                  <TerminalIcon />
                  <span>Terminal</span>
                </button>
                {offersTerminalProfiles ? (
                  <button role="menuitem" onClick={() => setProfileMenuOpen(true)}>
                    <TerminalIcon />
                    <span>
                      {profileText(
                        'terminalProfiles.create.menuLabel',
                        'New terminal with profile…'
                      )}
                    </span>
                  </button>
                ) : null}
                <button role="menuitem" onClick={pick(onAddRemote)}>
                  <TerminalIcon />
                  <span>Remote…</span>
                </button>
                {BUILTIN_AGENT_IDS.filter((aid) => !disabledAgents.includes(aid)).flatMap((aid) => {
                  const base = (
                    <button role="menuitem" key={aid} onClick={pick(() => onAddAgent(aid))}>
                      <AgentIcon agentId={aid} size={18} />
                      <span>{AGENT_CONFIG[aid].label}</span>
                    </button>
                  )
                  if (aid !== 'claude') return [base]
                  // SSH project with no accounts on its host: a disabled row saying where this
                  // host's accounts come from (local accounts are correctly invisible here).
                  const acctHint = sshAccountsHint(activeProject, localAccounts)
                  if (acctHint) {
                    return [
                      base,
                      <button role="menuitem" key={`${aid}-acct-hint`} disabled title={acctHint}>
                        <AgentIcon agentId={aid} size={18} />
                        <span>No accounts on this host yet</span>
                      </button>
                    ]
                  }
                  // Claude picks up one flat entry per logged-in local account.
                  if (localAccounts.length === 0) return [base]
                  return [
                    base,
                    ...localAccounts.map((a) => (
                      <button
                        role="menuitem"
                        key={`${aid}-${a.id}`}
                        onClick={pick(() => onAddAgent(aid, a.id))}
                      >
                        <AgentIcon agentId={aid} size={18} />
                        <span>
                          Claude — {a.label}
                          {a.id === defaultAccountId ? ' ✓' : ''}
                        </span>
                      </button>
                    ))
                  ]
                })}
                {customAgents
                  .filter((c) => !disabledAgents.includes(c.id))
                  .map((c) => (
                    <button role="menuitem" key={c.id} onClick={pick(() => onAddAgent(c.id))}>
                      <AgentIcon agentId={c.id} size={18} />
                      <span>{c.label}</span>
                    </button>
                  ))}
                <button role="menuitem" onClick={pick(onAddSticky)}>
                  <NoteIcon />
                  <span>Sticky Note</span>
                </button>
                <button role="menuitem" onClick={pick(onAddDino)}>
                  <DinoIcon />
                  <span>Dino Game</span>
                </button>
                <button role="menuitem" onClick={pick(onOpenFile)}>
                  <EditorIcon />
                  <span>Open file…</span>
                </button>
                <button role="menuitem" onClick={pick(onConnectRemote)}>
                  <RemoteIcon />
                  <span>New Remote Connection</span>
                </button>
              </>
            )}
          </div>
        )}

        <button
          className={`dock-btn dock-add${menuOpen ? ' active' : ''}`}
          title="Add node"
          onClick={toggleMenu}
        >
          <PlusIcon />
        </button>

        <span className="dock-sep" />

        <button className="dock-btn" title={hintLabel('Undo (⌘Z)')} disabled={!canUndo} onClick={onUndo}>
          <UndoIcon />
        </button>
        <button className="dock-btn" title={hintLabel('Redo (⌘⇧Z)')} disabled={!canRedo} onClick={onRedo}>
          <RedoIcon />
        </button>

        <span className="dock-sep" />

        <button className="dock-btn" title="Save" onClick={onSave}>
          <SaveIcon />
          <span className={`dock-dirty${dirty ? ' dirty' : ''}`} />
        </button>
        <button className="dock-btn" title="Fit view" onClick={onFitView}>
          <FrameIcon />
        </button>
        <button
          className={`dock-btn${dictateActive ? ' active' : ''}`}
          title={
            isHoldChord(dictationShortcut)
              ? `Dictate (hold ${formatShortcut(dictationShortcut, isMac)})`
              : `Dictate (${formatShortcut(dictationShortcut, isMac)})`
          }
          onClick={onDictate}
        >
          <MicIcon />
        </button>

        <span className="dock-sep" />

        <button className="dock-btn dock-zoom-btn" title="Zoom out" onClick={onZoomOut}>
          <MinusIcon />
        </button>
        <span className="dock-zoom">{zoomPct}%</span>
        <button className="dock-btn dock-zoom-btn" title="Zoom in" onClick={onZoomIn}>
          <PlusSmallIcon />
        </button>
      </div>
    </>
  )
}

/* ---- inline icons (stroke = currentColor) ---- */
const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function PlusIcon() {
  return (
    <svg {...S} width={20} height={20}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function UndoIcon() {
  return (
    <svg {...S}>
      <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" />
    </svg>
  )
}
function RedoIcon() {
  return (
    <svg {...S}>
      <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2" />
    </svg>
  )
}
function PlusSmallIcon() {
  return (
    <svg {...S} width={15} height={15}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function MinusIcon() {
  return (
    <svg {...S} width={15} height={15}>
      <path d="M5 12h14" />
    </svg>
  )
}
function SaveIcon() {
  return (
    <svg {...S}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  )
}
function FrameIcon() {
  return (
    <svg {...S}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    </svg>
  )
}
function TerminalIcon() {
  return (
    <svg {...S}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </svg>
  )
}
function BackIcon() {
  return (
    <svg {...S}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  )
}
function NoteIcon() {
  return (
    <svg {...S}>
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M20 15h-5v5" />
    </svg>
  )
}
function DinoIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="3" y="11" width="6" height="3" />
      <rect x="8" y="9" width="11" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="21" y="7" width="2" height="2" />
      <rect x="18" y="12" width="2" height="3" />
      <rect x="9" y="16" width="2" height="5" />
      <rect x="14" y="16" width="2" height="5" />
    </svg>
  )
}
function EditorIcon() {
  return (
    <svg {...S}>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  )
}
function MicIcon() {
  return (
    <svg {...S}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
    </svg>
  )
}
function RemoteIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  )
}
