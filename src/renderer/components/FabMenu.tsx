import { useState } from 'react'
import type { AgentId } from '@shared/agents/config'
import type { TerminalProfileChoice } from '../lib/terminal-profile-actions'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

export interface FabMenuProps {
  /** Opens the single typed registry used by every creation surface. */
  onOpenCatalog: () => void
  onAddTerminal: () => void
  /** Desktop-local Windows capability. Keep false for SSH, relay, and Server Edition sessions. */
  offersTerminalProfiles?: boolean
  terminalProfileChoices?: readonly TerminalProfileChoice[]
  /** Canvas supplies detecting, failed-read, or confirmed-empty copy without collapsing them. */
  terminalProfileEmptyState?: { label: string; hint: string }
  /** Receives only the stable trusted-core profile id selected by the user. */
  onAddTerminalWithProfile?: (profileId: string) => void
  onAddSticky: () => void
  onAddLoop: () => void
  /** Create a TOTP code displayer. The row is also DRAGGABLE onto the canvas, which is what
   *  lets it land where the pointer is rather than at the default placement. */
  onAddAuthenticator: () => void
  onAddDino: () => void
  onAddAgent: (agentId: AgentId, accountId?: string) => void
  onOpenFile: () => void
  onAddRemote: () => void
  onConnectRemote: () => void
}

/**
 * The nav rail's FAB and its "add a node" menu (formerly the bottom dock's `+`, moved here
 * verbatim per the Material 3 handoff — the rail's FAB owns node creation now, same choices,
 * same `⌘T`/`⌘⇧C` shortcuts, same profile drill-in).
 *
 * A standalone component (rather than folded into `NavRail`) so the terminal-profile-creation
 * behavior test can drive exactly this surface, the same way it drove the old `Dock`.
 */
export function FabMenu({
  onOpenCatalog,
  onAddTerminal,
  offersTerminalProfiles = false,
  terminalProfileChoices = [],
  terminalProfileEmptyState,
  onAddTerminalWithProfile,
  onAddSticky,
  onAddLoop,
  onAddAuthenticator,
  onAddDino,
  onAddAgent,
  onOpenFile,
  onAddRemote,
  onConnectRemote
}: FabMenuProps) {
  const profileText = useLocalizedVocabularyText()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
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
      {menuOpen && <div className="md3-fab-backdrop" onClick={closeMenu} />}

      <div className="md3-fab-wrap">
        {menuOpen && (
          <div
            className="md3-fab-menu"
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
                      ? `fab-terminal-profile-reason-${index}`
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
                        <span className="md3-fab-menu__copy">
                          <span>{profile.label}</span>
                          {disabledReason ? (
                            <span id={reasonId} className="md3-fab-menu__hint">
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
                    aria-describedby="fab-terminal-profile-empty-reason"
                    title={profileEmptyState.hint}
                  >
                    <TerminalIcon />
                    <span className="md3-fab-menu__copy">
                      <span>{profileEmptyState.label}</span>
                      <span
                        id="fab-terminal-profile-empty-reason"
                        className="md3-fab-menu__hint"
                      >
                        {profileEmptyState.hint}
                      </span>
                    </span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button role="menuitem" onClick={pick(onOpenCatalog)}>
                  <CatalogIcon />
                  <span>Browse node catalog…</span>
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
          className={`md3-fab${menuOpen ? ' is-open' : ''}`}
          title="Add node"
          onClick={toggleMenu}
        >
          <PlusIcon />
        </button>
      </div>
    </>
  )
}

/* ---- inline icons (stroke = currentColor) ---- */
const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function PlusIcon() {
  return (
    <svg {...S} width={26} height={26}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function CatalogIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.2 3.3 5 3.3 8.5s-.9 6.3-3.3 8.5c-2.4-2.2-3.3-5-3.3-8.5S9.6 5.7 12 3.5Z" />
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
function LoopIcon() {
  return (
    <svg {...S}>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.8-2L20 12M4 12l2.1 5a7 7 0 0 0 11.8-2" />
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
function RemoteIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  )
}
