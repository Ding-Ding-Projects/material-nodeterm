import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { SettingsSearchContext } from './context'
import { SettingsSidebar } from './SettingsSidebar'
import { FIRST_SECTION_ID, type SettingsSectionId } from './nav'
import { TerminalSection } from './sections/TerminalSection'
import { ShellSection } from './sections/ShellSection'
import { BehaviorSection } from './sections/BehaviorSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { AppearanceEditorSection } from './sections/AppearanceEditorSection'
import { AppIdentitySection } from './sections/AppIdentitySection'
import { NotchSection } from './sections/NotchSection'
import { PhoneSection } from './sections/PhoneSection'
import { SpeechSection } from './sections/SpeechSection'
import { ScheduleSection } from './sections/ScheduleSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { AgentsSection } from './sections/AgentsSection'
import { UsageSection } from './sections/UsageSection'
import { AccountsSection } from './sections/AccountsSection'
import { CustomAgentsSection } from './sections/CustomAgentsSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { NarratorSection } from './sections/NarratorSection'
import { CommitSection } from './sections/CommitSection'
import { TmuxSection } from './sections/TmuxSection'
import { PresenceIdentitySection } from './sections/PresenceIdentitySection'
import { RemoteSection } from './sections/RemoteSection'
import { SshSection } from './sections/SshSection'
import { UpdatesSection } from './sections/UpdatesSection'
import { PrivacySection } from './sections/PrivacySection'
import { GitHubIssuesSection } from './sections/GitHubIssuesSection'
import { LanguageSection } from './sections/LanguageSection'
import { SchoolModeSection } from './sections/SchoolModeSection'
import { KidsModeSection } from './sections/KidsModeSection'
import { PersonalVocabularySection } from './sections/PersonalVocabularySection'
import { LocalHistorySection } from './sections/LocalHistorySection'
import { ToyLocksSection } from './sections/ToyLocksSection'
import { AuthenticatorSection } from './sections/AuthenticatorSection'
import { SupportTicketsSection } from './sections/SupportTicketsSection'
import { useSchoolMode } from '../../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../../lib/schoolModePolicy'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

export function SettingsPage({
  onClose,
  initialSection,
  initialQuery
}: {
  onClose: () => void
  /** Section to open on; lets callers deep-link (e.g. "Add SSH server…" → the SSH section). */
  initialSection?: SettingsSectionId
  /**
   * Pre-fills the sidebar search so the matching row(s) are the only ones left visible — the
   * command palette's "Open in Settings" teleport for a specific setting uses this (see
   * docs/command-palette.md). Read once on mount; this component is only ever mounted while
   * open, so a fresh open always gets a fresh seed.
   */
  initialQuery?: string
}): React.JSX.Element {
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const languageFeaturesAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  const safeSection = (section: SettingsSectionId | undefined): SettingsSectionId =>
    section === 'language' && !languageFeaturesAllowed ? 'school-mode' : section ?? FIRST_SECTION_ID
  const [active, setActive] = useState<SettingsSectionId>(() => safeSection(initialSection))
  // Seeded, not a separate state: the palette's "Open in Settings" teleport pre-fills the same
  // field the user then types in, so the regex field owns the value and there is no second
  // source of truth to drift. `initial` is read once on mount, which is right — this component
  // is only mounted while settings are open, so every fresh open gets a fresh seed.
  const search = useRegexSearchField({ query: initialQuery })
  const searchState = useMemo(
    () => ({ mode: search.mode, query: search.query, pattern: search.pattern, flags: search.flags }),
    [search.mode, search.query, search.pattern, search.flags]
  )


  // Re-target when a caller opens settings to a specific section.
  useEffect(() => {
    if (initialSection) setActive(safeSection(initialSection))
  }, [initialSection, languageFeaturesAllowed])

  // A shared record can turn on in another app while this window is looking at Language. Remove
  // the controls immediately and land on the mode that explains why they disappeared.
  useEffect(() => {
    if (!languageFeaturesAllowed && active === 'language') setActive('school-mode')
  }, [active, languageFeaturesAllowed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="nt-settings md3-settings-shell fixed inset-0 z-[55] flex"
      data-appearance-id="app:settings-dialog"
    >
      <SettingsSidebar
        activeSectionId={active}
        search={search}
        onSelect={(section) => setActive(safeSection(section))}
        onClose={onClose}
      />
      <SettingsSearchContext.Provider value={searchState}>
        <main className="min-w-0 flex-1 overflow-y-auto px-12 py-10">
          <div className="mx-auto max-w-[860px] space-y-10">
            <TerminalSection isActive={active === 'terminal'} />
            <ShellSection isActive={active === 'shell'} />
            <BehaviorSection isActive={active === 'behavior'} />
            <AppearanceSection isActive={active === 'appearance'} />
            <AppearanceEditorSection isActive={active === 'appearance-editor'} />
            <AppIdentitySection isActive={active === 'app-identity'} />
            {isMac && <NotchSection isActive={active === 'notch'} />}
            <PhoneSection isActive={active === 'phone'} />
            <SpeechSection isActive={active === 'speech'} />
            {languageFeaturesAllowed && <LanguageSection isActive={active === 'language'} />}
            <ScheduleSection isActive={active === 'schedule'} />
            <ShortcutsSection isActive={active === 'shortcuts'} />
            <AgentsSection isActive={active === 'agents'} />
            <UsageSection isActive={active === 'usage'} />
            <AccountsSection isActive={active === 'accounts'} />
            <CustomAgentsSection isActive={active === 'custom-agents'} />
            <NotificationsSection isActive={active === 'notifications'} />
            <NarratorSection isActive={active === 'narrator'} />
            <CommitSection isActive={active === 'commit'} />
            <TmuxSection isActive={active === 'tmux'} />
            <GitHubIssuesSection isActive={active === 'github-issues'} />
            <PresenceIdentitySection isActive={active === 'presence'} />
            <RemoteSection isActive={active === 'remote'} onClose={onClose} />
            <SshSection isActive={active === 'ssh'} onNavigate={setActive} />
            <UpdatesSection isActive={active === 'updates'} />
            <PrivacySection isActive={active === 'privacy'} />
            <SchoolModeSection isActive={active === 'school-mode'} />
            <KidsModeSection isActive={active === 'kids-mode'} />
            <PersonalVocabularySection isActive={active === 'vocabulary'} />
            <LocalHistorySection isActive={active === 'history'} />
            <ToyLocksSection isActive={active === 'toylocks'} />
            <AuthenticatorSection isActive={active === 'authenticator'} />
            <SupportTicketsSection isActive={active === 'support'} />
          </div>
        </main>
      </SettingsSearchContext.Provider>
    </div>,
    document.body
  )
}
