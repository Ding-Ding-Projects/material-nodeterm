import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEntitlement } from '../../state/entitlement'
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
import { AgentsSection } from './sections/AgentsSection'
import { UsageSection } from './sections/UsageSection'
import { AccountsSection } from './sections/AccountsSection'
import { CustomAgentsSection } from './sections/CustomAgentsSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { NarratorSection } from './sections/NarratorSection'
import { CommitSection } from './sections/CommitSection'
import { TmuxSection } from './sections/TmuxSection'
import { LicenseSection } from './sections/LicenseSection'
import { PresenceIdentitySection } from './sections/PresenceIdentitySection'
import { RemoteSection } from './sections/RemoteSection'
import { TeamAccessSection } from './sections/TeamAccessSection'
import { SshSection } from './sections/SshSection'
import { UpdatesSection } from './sections/UpdatesSection'
import { PrivacySection } from './sections/PrivacySection'
import { GitHubIssuesSection } from './sections/GitHubIssuesSection'
import { LanguageSection } from './sections/LanguageSection'
import { SchoolModeSection } from './sections/SchoolModeSection'
import { PersonalVocabularySection } from './sections/PersonalVocabularySection'
import { LocalHistorySection } from './sections/LocalHistorySection'

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
  const hydrate = useEntitlement((s) => s.hydrate)
  const [active, setActive] = useState<SettingsSectionId>(initialSection ?? FIRST_SECTION_ID)
  // Seeded, not a separate state: the palette's "Open in Settings" teleport pre-fills the same
  // field the user then types in, so the regex field owns the value and there is no second
  // source of truth to drift. `initial` is read once on mount, which is right — this component
  // is only mounted while settings are open, so every fresh open gets a fresh seed.
  const search = useRegexSearchField({ query: initialQuery })
  const searchState = useMemo(
    () => ({ mode: search.mode, query: search.query, pattern: search.pattern, flags: search.flags }),
    [search.mode, search.query, search.pattern, search.flags]
  )

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Re-target when a caller opens settings to a specific section.
  useEffect(() => {
    if (initialSection) setActive(initialSection)
  }, [initialSection])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="nt-settings fixed inset-0 z-[55] flex bg-bg text-text"
      data-appearance-id="app:settings-dialog"
    >
      <SettingsSidebar activeSectionId={active} search={search} onSelect={setActive} onClose={onClose} />
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
            <SpeechSection isActive={active === 'speech'} onNavigate={setActive} />
            <LanguageSection isActive={active === 'language'} />
            <ScheduleSection isActive={active === 'schedule'} />
            <AgentsSection isActive={active === 'agents'} />
            <UsageSection isActive={active === 'usage'} />
            <AccountsSection isActive={active === 'accounts'} />
            <CustomAgentsSection isActive={active === 'custom-agents'} />
            <NotificationsSection isActive={active === 'notifications'} />
            <NarratorSection isActive={active === 'narrator'} />
            <CommitSection isActive={active === 'commit'} />
            <TmuxSection isActive={active === 'tmux'} />
            <GitHubIssuesSection isActive={active === 'github-issues'} />
            <LicenseSection isActive={active === 'license'} />
            <PresenceIdentitySection isActive={active === 'presence'} />
            <RemoteSection isActive={active === 'remote'} onClose={onClose} />
            <TeamAccessSection isActive={active === 'team-access'} onClose={onClose} />
            <SshSection isActive={active === 'ssh'} />
            <UpdatesSection isActive={active === 'updates'} />
            <PrivacySection isActive={active === 'privacy'} />
            <SchoolModeSection isActive={active === 'school-mode'} />
            <PersonalVocabularySection isActive={active === 'vocabulary'} />
            <LocalHistorySection isActive={active === 'history'} />
          </div>
        </main>
      </SettingsSearchContext.Provider>
    </div>,
    document.body
  )
}
