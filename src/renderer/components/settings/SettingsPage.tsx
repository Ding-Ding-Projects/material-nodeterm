import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEntitlement } from '../../state/entitlement'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { SettingsSearchContext } from './context'
import { SettingsSidebar } from './SettingsSidebar'
import { FIRST_SECTION_ID, SETTINGS_SECTION_REGISTRY, type SettingsSectionId } from './nav'
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
import { PlannerSection } from './sections/PlannerSection'
import { AdhdModesSection } from './sections/AdhdModesSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { AgentsSection } from './sections/AgentsSection'
import { UsageSection } from './sections/UsageSection'
import { AccountsSection } from './sections/AccountsSection'
import { CustomAgentsSection } from './sections/CustomAgentsSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { NarratorSection } from './sections/NarratorSection'
import { CommitSection } from './sections/CommitSection'
import { TmuxSection } from './sections/TmuxSection'
import { WorkspaceStorageSection } from './sections/WorkspaceStorageSection'
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
import { KidsModeSection } from './sections/KidsModeSection'
import { PersonalVocabularySection } from './sections/PersonalVocabularySection'
import { LocalHistorySection } from './sections/LocalHistorySection'
import { ToyLocksSection } from './sections/ToyLocksSection'
import { AuthenticatorSection } from './sections/AuthenticatorSection'
import { SupportTicketsSection } from './sections/SupportTicketsSection'
import { useSchoolMode } from '../../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../../lib/schoolModePolicy'
import { useSettings } from '../../state/settings'
import { useProjects } from '../../state/projects'
import { Button } from '@renderer/ui/Button'
import { SegmentedButton } from '@renderer/ui/md3'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'

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
  const scope = useSettings((s) => s.scope)
  const setScope = useSettings((s) => s.setScope)
  const setProjectContext = useSettings((s) => s.setProjectContext)
  const resetProjectAll = useSettings((s) => s.resetProjectAll)
  const projectOverrides = useSettings((s) => s.projectOverrides)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const activeProject = useProjects((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const languageFeaturesAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  const profileText = useLocalizedVocabularyText()
  const safeSection = (section: SettingsSectionId | undefined): SettingsSectionId =>
    section === 'language' && !languageFeaturesAllowed
      ? 'school-mode'
      : section && SETTINGS_SECTION_REGISTRY.some((entry) => entry.id === section)
        ? section
        : FIRST_SECTION_ID
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

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    setProjectContext(activeProjectId, activeProject?.settingsOverrides)
  }, [activeProjectId, activeProject?.settingsOverrides, setProjectContext])

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
            <section className="rounded-[20px] border border-outline/30 bg-surface-container p-4" aria-label={profileText('settings.scope.ariaLabel', 'Settings scope')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{profileText('settings.scope.title', 'Settings mode')}</h2>
                  <p className="mt-1 text-sm text-text-muted">
                    {profileText(
                      'settings.scope.description',
                      'Global mode stores durable app-wide defaults. Project mode edits a complete sparse overlay for {project}; every unset value inherits Global mode.',
                      { project: activeProject?.name ?? profileText('settings.scope.activeProject', 'the active project') }
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {/* A segmented button, not two plain buttons: this is one choice between two
                      mutually exclusive modes, which is exactly the MD3 control for it. The old
                      pair carried `aria-pressed` with no visual for it, so neither button looked
                      selected and the panel could not tell you which mode you were editing. */}
                  <SegmentedButton
                    value={scope}
                    vocabularyMode="factual"
                    ariaLabel={profileText('settings.scope.chooseMode', 'Choose settings mode')}
                    onChange={(next) => setScope(next)}
                    options={[
                      { value: 'global', label: profileText('settings.scope.global', 'Global mode') },
                      { value: 'project', label: profileText('settings.scope.project', 'Project mode'), disabled: !activeProjectId }
                    ]}
                  />
                  {scope === 'project' ? (
                    <Button
                      variant="ghost"
                      vocabularyMode="factual"
                      disabled={Object.keys(projectOverrides).length === 0}
                      onClick={resetProjectAll}
                    >
                      {profileText('settings.scope.reset', 'Reset all to Global')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 text-xs text-text-muted" role="status">
                {scope === 'global'
                  ? profileText('settings.scope.globalStatus', 'Editing Global defaults. Projects with overrides keep them.')
                  : profileText(
                      'settings.scope.projectStatus',
                      '{count} project override{plural} active. All other values show their inherited Global value.',
                      {
                        count: String(Object.keys(projectOverrides).length),
                        plural: Object.keys(projectOverrides).length === 1 ? '' : 's'
                      }
                    )}
              </p>
            </section>
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
            <PlannerSection isActive={active === 'planner'} />
            <AdhdModesSection isActive={active === 'adhd-modes'} />
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
            <WorkspaceStorageSection isActive={active === 'workspace-storage'} />
            <LicenseSection isActive={active === 'license'} />
            <PresenceIdentitySection isActive={active === 'presence'} />
            <RemoteSection isActive={active === 'remote'} onClose={onClose} />
            <TeamAccessSection isActive={active === 'team-access'} onClose={onClose} />
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
