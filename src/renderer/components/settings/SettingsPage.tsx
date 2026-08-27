import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@renderer/ui/Button'
import { SegmentedButton } from '@renderer/ui/md3'
import { useEntitlement } from '../../state/entitlement'
import { useProjects } from '../../state/projects'
import { useSchoolMode } from '../../state/schoolMode'
import { useSettings } from '../../state/settings'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'
import { useRegexSearchField, type RegexSearchFieldState } from '../../lib/regex/useRegexSearchField'
import { schoolModeAllowsOptionalFeatures } from '../../lib/schoolModePolicy'
import { SettingsSearchContext } from './context'
import {
  FIRST_SECTION_ID,
  SETTINGS_SECTION_REGISTRY,
  projectsSettingsGroup,
  type SettingsSectionId
} from './nav'
import { parseProjectSectionId, projectSectionId } from './project-settings-targets'
import { SettingsSidebar } from './SettingsSidebar'
import { useSettingsTarget } from './useSettingsTarget'
import { AccountsSection } from './sections/AccountsSection'
import { AdhdModesSection } from './sections/AdhdModesSection'
import { AgentsSection } from './sections/AgentsSection'
import { AppearanceEditorSection } from './sections/AppearanceEditorSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { AppIdentitySection } from './sections/AppIdentitySection'
import { AuthenticatorSection } from './sections/AuthenticatorSection'
import { BehaviorSection } from './sections/BehaviorSection'
import { CommitSection } from './sections/CommitSection'
import { CustomAgentsSection } from './sections/CustomAgentsSection'
import { DebugSection } from './sections/DebugSection'
import { GitHubIssuesSection } from './sections/GitHubIssuesSection'
import { KidsModeSection } from './sections/KidsModeSection'
import { LanguageSection } from './sections/LanguageSection'
import { LicenseSection } from './sections/LicenseSection'
import { LocalHistorySection } from './sections/LocalHistorySection'
import { ModelGatewaySection } from './sections/ModelGatewaySection'
import { NarratorSection } from './sections/NarratorSection'
import { NotchSection } from './sections/NotchSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { PersonalVocabularySection } from './sections/PersonalVocabularySection'
import { PhoneSection } from './sections/PhoneSection'
import { PlannerSection } from './sections/PlannerSection'
import { PresenceIdentitySection } from './sections/PresenceIdentitySection'
import { PrivacySection } from './sections/PrivacySection'
import { ProjectSettingsSection } from './sections/ProjectSettingsSection'
import { RemoteSection } from './sections/RemoteSection'
import { ScheduleSection } from './sections/ScheduleSection'
import { SchoolModeSection } from './sections/SchoolModeSection'
import { ShellSection } from './sections/ShellSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { SpeechSection } from './sections/SpeechSection'
import { SshSection } from './sections/SshSection'
import { SupportTicketsSection } from './sections/SupportTicketsSection'
import { TeamAccessSection } from './sections/TeamAccessSection'
import { TerminalSection } from './sections/TerminalSection'
import { TmuxSection } from './sections/TmuxSection'
import { ToyLocksSection } from './sections/ToyLocksSection'
import { UpdatesSection } from './sections/UpdatesSection'
import { UsageSection } from './sections/UsageSection'
import { WorkspaceStorageSection } from './sections/WorkspaceStorageSection'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

export function SettingsPage({
  onClose,
  initialSection,
  initialQuery,
  retargetNonce
}: {
  onClose: () => void
  /** Section to open on; lets callers deep-link to the exact destination. */
  initialSection?: SettingsSectionId
  /** Pre-fills the same full regex-capable field the sidebar renders. */
  initialQuery?: string
  /** A changed nonce re-targets even when the requested section id did not change. */
  retargetNonce?: number
}): React.JSX.Element {
  const hydrate = useEntitlement((s) => s.hydrate)
  const scope = useSettings((s) => s.scope)
  const setScope = useSettings((s) => s.setScope)
  const setProjectContext = useSettings((s) => s.setProjectContext)
  const resetProjectAll = useSettings((s) => s.resetProjectAll)
  const projectOverrides = useSettings((s) => s.projectOverrides)

  // One live project list feeds both the dynamically appended nav group and its panes.
  const projects = useProjects((s) => s.projects)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const openProjects = useMemo(() => projects.filter((project) => !project.closed), [projects])
  const openProjectIds = useMemo(() => openProjects.map((project) => project.id), [openProjects])
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [activeProjectId, projects]
  )

  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const languageFeaturesAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  const profileText = useLocalizedVocabularyText()

  const { active, setActive, setQuery } = useSettingsTarget(
    initialSection,
    retargetNonce,
    openProjectIds
  )

  const safeSection = useCallback(
    (section: SettingsSectionId | undefined): SettingsSectionId => {
      if (!section) return FIRST_SECTION_ID
      if (!languageFeaturesAllowed && (section === 'language' || section === 'vocabulary')) {
        return 'school-mode'
      }
      if (SETTINGS_SECTION_REGISTRY.some((entry) => entry.id === section)) return section
      const projectId = parseProjectSectionId(section)
      return projectId !== null && openProjectIds.includes(projectId) ? section : FIRST_SECTION_ID
    },
    [languageFeaturesAllowed, openProjectIds]
  )

  // useSettingsTarget owns deep-link retargeting while this hook owns the full text/regex field.
  // Mirror its plain query only as a retarget signal, so a changed nonce clears text and regex
  // state without replacing the anchored builder with the older plain-text-only field.
  const rawSearch = useRegexSearchField({ query: initialQuery })
  const search = useMemo<RegexSearchFieldState>(
    () => ({
      ...rawSearch,
      setValue: (value) => {
        rawSearch.setValue(value)
        setQuery(value)
      },
      reset: () => {
        rawSearch.reset()
        setQuery('')
      }
    }),
    [rawSearch, setQuery]
  )
  const searchState = useMemo(
    () => ({ mode: search.mode, query: search.query, pattern: search.pattern, flags: search.flags }),
    [search.flags, search.mode, search.pattern, search.query]
  )
  const seededTargetQuery = useRef(false)
  const previousRetarget = useRef({ initialSection, retargetNonce })

  useEffect(() => {
    if (seededTargetQuery.current) return
    seededTargetQuery.current = true
    if (initialQuery) setQuery(initialQuery)
  }, [initialQuery, setQuery])

  useEffect(() => {
    const previous = previousRetarget.current
    if (
      previous.initialSection === initialSection &&
      previous.retargetNonce === retargetNonce
    ) {
      return
    }
    previousRetarget.current = { initialSection, retargetNonce }
    rawSearch.reset()
    setQuery('')
  }, [initialSection, rawSearch.reset, retargetNonce, setQuery])

  const extraGroups = useMemo(() => {
    const group = projectsSettingsGroup(
      openProjects.map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
        icon: project.icon
      }))
    )
    return group ? [group] : []
  }, [openProjects])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    setProjectContext(activeProjectId, activeProject?.settingsOverrides)
  }, [activeProjectId, activeProject?.settingsOverrides, setProjectContext])

  useEffect(() => {
    const next = safeSection(active)
    if (next !== active) setActive(next)
  }, [active, safeSection, setActive])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="nt-settings md3-settings-shell fixed inset-0 z-[55] flex"
      data-easter-surface="settings"
      data-appearance-id="app:settings-dialog"
    >
      <SettingsSidebar
        activeSectionId={active}
        search={search}
        onSelect={(section) => setActive(safeSection(section))}
        onClose={onClose}
        extraGroups={extraGroups}
      />
      <SettingsSearchContext.Provider value={searchState}>
        <main className="min-w-0 flex-1 overflow-y-auto px-12 py-10">
          <div className="mx-auto max-w-[860px] space-y-10">
            <section
              className="rounded-[20px] border border-outline/30 bg-surface-container p-4"
              aria-label={profileText('settings.scope.ariaLabel', 'Settings scope')}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">
                    {profileText('settings.scope.title', 'Settings mode')}
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    {profileText(
                      'settings.scope.description',
                      'Global mode stores durable app-wide defaults. Project mode edits a complete sparse overlay for {project}; every unset value inherits Global mode.',
                      {
                        project:
                          activeProject?.name ??
                          profileText('settings.scope.activeProject', 'the active project')
                      }
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <SegmentedButton
                    value={scope}
                    vocabularyMode="factual"
                    ariaLabel={profileText('settings.scope.chooseMode', 'Choose settings mode')}
                    onChange={setScope}
                    options={[
                      {
                        value: 'global',
                        label: profileText('settings.scope.global', 'Global mode')
                      },
                      {
                        value: 'project',
                        label: profileText('settings.scope.project', 'Project mode'),
                        disabled: !activeProjectId
                      }
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
                  ? profileText(
                      'settings.scope.globalStatus',
                      'Editing Global defaults. Projects with overrides keep them.'
                    )
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
            {isMac ? <NotchSection isActive={active === 'notch'} /> : null}
            <PhoneSection isActive={active === 'phone'} />
            <SpeechSection isActive={active === 'speech'} onNavigate={setActive} />
            {languageFeaturesAllowed ? <LanguageSection isActive={active === 'language'} /> : null}
            <ScheduleSection isActive={active === 'schedule'} />
            <PlannerSection isActive={active === 'planner'} />
            <AdhdModesSection isActive={active === 'adhd-modes'} />
            <ShortcutsSection isActive={active === 'shortcuts'} />
            <AgentsSection isActive={active === 'agents'} />
            <UsageSection isActive={active === 'usage'} />
            <AccountsSection isActive={active === 'accounts'} />
            <CustomAgentsSection isActive={active === 'custom-agents'} />
            <ModelGatewaySection isActive={active === 'model-gateway'} />
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
            {languageFeaturesAllowed ? (
              <PersonalVocabularySection isActive={active === 'vocabulary'} />
            ) : null}
            <LocalHistorySection isActive={active === 'history'} />
            <ToyLocksSection isActive={active === 'toylocks'} />
            <AuthenticatorSection isActive={active === 'authenticator'} />
            <SupportTicketsSection isActive={active === 'support'} />
            <DebugSection isActive={active === 'debug'} />
            {openProjects.map((project) => (
              <ProjectSettingsSection
                key={project.id}
                projectId={project.id}
                isActive={active === projectSectionId(project.id)}
              />
            ))}
          </div>
        </main>
      </SettingsSearchContext.Provider>
    </div>,
    document.body
  )
}
