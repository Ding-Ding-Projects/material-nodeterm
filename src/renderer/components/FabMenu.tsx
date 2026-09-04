import { useEffect, useRef, useState } from 'react'
import { SearchField } from '@renderer/ui/md3'
import { AGENT_CONFIG, BUILTIN_AGENT_IDS, type AgentId } from '@shared/agents/config'
import { AgentIcon } from '../lib/agentIcons'
import { useSettings } from '../state/settings'
import { useProjects } from '../state/projects'
import { accountsForProject, sshAccountsHint } from '../state/workspace'
import type { TerminalProfileChoice } from '../lib/terminal-profile-actions'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapBuiltinAgentLabel } from '../lib/personalVocabulary/agentLabel'
import { IconLock } from './icons'
import { writeAuthenticatorDrag } from '../lib/explorerNodeDrag'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { Fab, ListRow } from '../ui/md3'

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
  onAddTimer?: () => void
  onAddAlarmClock?: () => void
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
  onAddTimer = () => {},
  onAddAlarmClock = () => {},
  onAddAuthenticator,
  onAddDino,
  onAddAgent,
  onOpenFile,
  onAddRemote,
  onConnectRemote
}: FabMenuProps) {
  const customAgents = useSettings((s) => s.settings.customAgents)
  const disabledAgents = useSettings((s) => s.settings.disabledAgents)
  const claudeAccounts = useSettings((s) => s.settings.claudeAccounts)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const activeProject = useProjects((s) => s.projects.find((p) => p.id === activeProjectId))
  const localAccounts = accountsForProject(claudeAccounts, activeProject)
  const defaultAccountId = localAccounts.some((a) => a.id === activeProject?.defaultAccountId)
    ? activeProject?.defaultAccountId
    : undefined
  const profileText = useLocalizedVocabularyText()
  const vocab = useVocabularyMapper()
  const menuSearch = useRegexSearchField()
  const menuInputRef = useRef<HTMLInputElement>(null)
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

  useEffect(() => {
    if (activeProjectId) return
    setMenuOpen(false)
    setProfileMenuOpen(false)
  }, [activeProjectId])

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
                : vocab('Add node')
            }
          >
            <div className="menu-filter" onMouseDown={(e) => e.stopPropagation()}>
              <SearchField
                ref={menuInputRef}
                dense
                className="menu-filter__row"
                vocabularyMode="factual"
                value={menuSearch.value}
                placeholder={menuSearch.mode === 'regex' ? vocab('Filter new nodes… (regex)') : vocab('Filter new nodes…')}
                aria-label={vocab('Filter new nodes')}
                onChange={(e) => menuSearch.setValue(e.target.value)}
                trailingSlot={
                  <AnchoredRegexBuilder search={menuSearch} fieldRef={menuInputRef} label={vocab('Regex — new nodes')} zIndex={90} />
                }
              />
              {menuSearch.error && <div className="menu-filter__error">{menuSearch.error}</div>}
            </div>
            {profileMenuOpen ? (
              <>
                <ListRow role="menuitem" vocabularyMode="factual" icon={<BackIcon />} label={profileText('terminalProfiles.create.backToNewNodes', 'Back to new nodes')} onClick={() => setProfileMenuOpen(false)} />
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
                      <ListRow
                        key={profile.id}
                        role="menuitem"
                        vocabularyMode="factual"
                        aria-disabled={disabled || undefined}
                        aria-describedby={reasonId}
                        title={disabledReason}
                        icon={<TerminalIcon />}
                        label={profile.label}
                        sub={disabledReason ? <span id={reasonId} className="md3-fab-menu__hint">{disabledReason}</span> : undefined}
                        onClick={() => {
                          if (disabled || !onAddTerminalWithProfile) return
                          pick(() => onAddTerminalWithProfile(profile.id))()
                        }}
                      />
                    )
                  })
                ) : (
                  <ListRow
                    role="menuitem"
                    vocabularyMode="factual"
                    aria-disabled="true"
                    aria-describedby="fab-terminal-profile-empty-reason"
                    title={profileEmptyState.hint}
                    icon={<TerminalIcon />}
                    label={profileEmptyState.label}
                    sub={<span id="fab-terminal-profile-empty-reason" className="md3-fab-menu__hint">{profileEmptyState.hint}</span>}
                  />
                )}
              </>
            ) : (
              <>
                <ListRow role="menuitem" onClick={pick(onAddTerminal)} vocabularyMode="factual" icon={<TerminalIcon />} label={<>{vocab('Terminal')}</>} />
                {offersTerminalProfiles ? (
                  <ListRow role="menuitem" vocabularyMode="factual" icon={<TerminalIcon />} label={profileText('terminalProfiles.create.menuLabel', 'New terminal with profile…')} onClick={() => setProfileMenuOpen(true)} />
                ) : null}
                <ListRow role="menuitem" onClick={pick(onAddRemote)} vocabularyMode="factual" icon={<TerminalIcon />} label={<>{vocab('Remote…')}</>} />
                {BUILTIN_AGENT_IDS.filter((aid) => !disabledAgents.includes(aid)).flatMap((aid) => {
                  const displayLabel = mapBuiltinAgentLabel(vocab, aid, AGENT_CONFIG[aid].label)
                  const base = (
                    <ListRow role="menuitem" key={aid} vocabularyMode="factual" icon={<AgentIcon agentId={aid} size={18} />} label={displayLabel} onClick={pick(() => onAddAgent(aid))} />
                  )
                  if (aid !== 'claude') return [base]
                  // SSH project with no accounts on its host: a disabled row saying where this
                  // host's accounts come from (local accounts are correctly invisible here).
                  const acctHint = sshAccountsHint(activeProject, localAccounts)
                  if (acctHint) {
                    return [
                      base,
                      <ListRow role="menuitem" key={`${aid}-acct-hint`} disabled title={acctHint} vocabularyMode="factual" icon={<AgentIcon agentId={aid} size={18} />} label={<>No accounts on this host yet</>} />
                    ]
                  }
                  // Claude picks up one flat entry per logged-in local account.
                  if (localAccounts.length === 0) return [base]
                  return [
                    base,
                    ...localAccounts.map((a) => (
                      <ListRow role="menuitem" key={`${aid}-${a.id}`} onClick={pick(() => onAddAgent(aid, a.id))} vocabularyMode="factual" icon={<AgentIcon agentId={aid} size={18} />} label={<>{displayLabel} — {a.label}
                          {a.id === defaultAccountId ? ' ✓' : ''}</>} />
                    ))
                  ]
                })}
                {customAgents
                  .filter((c) => !disabledAgents.includes(c.id))
                  .map((c) => (
                    <ListRow role="menuitem" key={c.id} vocabularyMode="factual" icon={<AgentIcon agentId={c.id} size={18} />} label={c.label} onClick={pick(() => onAddAgent(c.id))} />
                  ))}
                <ListRow role="menuitem" onClick={pick(onAddSticky)} vocabularyMode="factual" icon={<NoteIcon />} label={<>Sticky Note</>} />
                <ListRow role="menuitem" onClick={pick(onAddLoop)} vocabularyMode="factual" icon={<LoopIcon />} label={<>Loop</>} />
                <ListRow role="menuitem" vocabularyMode="factual" icon={<span aria-hidden="true">◷</span>} label="Timer" onClick={pick(onAddTimer)} />
                <ListRow role="menuitem" onClick={pick(onAddAlarmClock)} vocabularyMode="factual" icon={<AlarmIcon />} label={<>Alarm Clock</>} />
                <ListRow
                  role="menuitem"
                  draggable
                  onDragStart={(e) => {
                    if (e.dataTransfer) writeAuthenticatorDrag(e.dataTransfer)
                  }}
                  onClick={pick(onAddAuthenticator)}
                  title="Click to add, or drag onto the canvas to place it"
                
                  vocabularyMode="factual"
                  icon={<IconLock />}
                  label="Authenticator"
                />
                <ListRow role="menuitem" onClick={pick(onOpenCatalog)} vocabularyMode="factual" icon={<CatalogIcon />} label={<>Browse node catalog…</>} />
                <ListRow role="menuitem" onClick={pick(onOpenFile)} vocabularyMode="factual" icon={<EditorIcon />} label={<>Open file…</>} />
                <ListRow role="menuitem" onClick={pick(onConnectRemote)} vocabularyMode="factual" icon={<RemoteIcon />} label={<>New Remote Connection</>} />
              </>
            )}
          </div>
        )}

        <Fab
          open={menuOpen}
          vocabularyMode="factual"
          title={activeProjectId ? 'Add node' : 'Open or create a project before adding nodes.'}
          aria-label={activeProjectId ? 'Add node' : 'Add node unavailable. Open or create a project first.'}
          disabled={!activeProjectId}
          onClick={toggleMenu}
        >
          <PlusIcon />
        </Fab>
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
function AlarmIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l3 2M5 5 3.5 3.5M19 5l1.5-1.5M12 3v2M4 13H2M22 13h-2" />
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
