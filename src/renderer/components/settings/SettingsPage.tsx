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
import { ProviderAccountsSection } from './sections/ProviderAccountsSection'
import { AdhdModesSection } from './sections/AdhdModesSection'
import { AgentsSection } from './sections/AgentsSection'
import { ClaudeSkillsSection } from './sections/ClaudeSkillsSection'
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

type SettingsSectionHostProps = {
  isActive: boolean
  onClose: () => void
  onNavigate: (id: SettingsSectionId) => void
  projectId?: string | null
  providerBlueprints?: Parameters<typeof ProviderAccountsSection>[0]['blueprints']
}

type SettingsSectionHostRenderer = (
  props: SettingsSectionHostProps
) => React.JSX.Element

/**
 * The page and sidebar must agree about which static settings sections exist. Keep the renderer
 * map exhaustive so adding a navigation id without a host is a type error, not an empty pane.
 * Dynamic project sections stay outside this map because their ids and props are runtime data.
 */
const SETTINGS_SECTION_HOST_RENDERERS: Record<SettingsSectionId, SettingsSectionHostRenderer> = {
  terminal: ({ isActive }) => <TerminalSection isActive={isActive} />,
  shell: ({ isActive }) => <ShellSection isActive={isActive} />,
  behavior: ({ isActive }) => <BehaviorSection isActive={isActive} />,
  'workspace-storage': ({ isActive }) => <WorkspaceStorageSection isActive={isActive} />,
  appearance: ({ isActive }) => <AppearanceSection isActive={isActive} />,
  'appearance-editor': ({ isActive }) => <AppearanceEditorSection isActive={isActive} />,
  'app-identity': ({ isActive }) => <AppIdentitySection isActive={isActive} />,
  notch: ({ isActive }) => <NotchSection isActive={isActive} />,
  phone: ({ isActive }) => <PhoneSection isActive={isActive} />,
  speech: ({ isActive, onNavigate }) => (
    <SpeechSection isActive={isActive} onNavigate={onNavigate} />
  ),
  schedule: ({ isActive }) => <ScheduleSection isActive={isActive} />,
  planner: ({ isActive }) => <PlannerSection isActive={isActive} />,
  'adhd-modes': ({ isActive }) => <AdhdModesSection isActive={isActive} />,
  shortcuts: ({ isActive }) => <ShortcutsSection isActive={isActive} />,
  agents: ({ isActive }) => <AgentsSection isActive={isActive} />,
  'claude-skills': ({ isActive }) => <ClaudeSkillsSection isActive={isActive} />,
  usage: ({ isActive }) => <UsageSection isActive={isActive} />,
  accounts: ({ isActive }) => <AccountsSection isActive={isActive} />,
  'provider-accounts': ({ isActive, projectId, providerBlueprints }) => (
    <ProviderAccountsSection
      isActive={isActive}
      projectId={projectId ?? null}
      blueprints={providerBlueprints}
    />
  ),
  'custom-agents': ({ isActive }) => <CustomAgentsSection isActive={isActive} />,
  'model-gateway': ({ isActive }) => <ModelGatewaySection isActive={isActive} />,
  notifications: ({ isActive }) => <NotificationsSection isActive={isActive} />,
  narrator: ({ isActive }) => <NarratorSection isActive={isActive} />,
  commit: ({ isActive }) => <CommitSection isActive={isActive} />,
  tmux: ({ isActive }) => <TmuxSection isActive={isActive} />,
  'github-issues': ({ isActive }) => <GitHubIssuesSection isActive={isActive} />,
  license: ({ isActive }) => <LicenseSection isActive={isActive} />,
  presence: ({ isActive }) => <PresenceIdentitySection isActive={isActive} />,
  remote: ({ isActive, onClose }) => <RemoteSection isActive={isActive} onClose={onClose} />,
  'team-access': ({ isActive, onClose }) => (
    <TeamAccessSection isActive={isActive} onClose={onClose} />
  ),
  ssh: ({ isActive, onNavigate }) => <SshSection isActive={isActive} onNavigate={onNavigate} />,
  updates: ({ isActive }) => <UpdatesSection isActive={isActive} />,
  privacy: ({ isActive }) => <PrivacySection isActive={isActive} />,
  language: ({ isActive }) => <LanguageSection isActive={isActive} />,
  'school-mode': ({ isActive }) => <SchoolModeSection isActive={isActive} />,
  'kids-mode': ({ isActive }) => <KidsModeSection isActive={isActive} />,
  vocabulary: ({ isActive }) => <PersonalVocabularySection isActive={isActive} />,
  history: ({ isActive }) => <LocalHistorySection isActive={isActive} />,
  toylocks: ({ isActive }) => <ToyLocksSection isActive={isActive} />,
  authenticator: ({ isActive }) => <AuthenticatorSection isActive={isActive} />,
  support: ({ isActive }) => <SupportTicketsSection isActive={isActive} />,
  debug: ({ isActive }) => <DebugSection isActive={isActive} />
}

/** Materializes the page hosts from the same static registry that drives the sidebar. */
export function renderSettingsSectionHosts(
  active: SettingsSectionId,
  onClose: () => void,
  onNavigate: (id: SettingsSectionId) => void,
  registry = SETTINGS_SECTION_REGISTRY,
  platformIsMac = isMac,
  options: {
    languageFeaturesAllowed?: boolean
    projectId?: string | null
    providerBlueprints?: Parameters<typeof ProviderAccountsSection>[0]['blueprints']
  } = {}
): React.JSX.Element[] {
  const languageFeaturesAllowed = options.languageFeaturesAllowed ?? true
  return registry.flatMap((entry) => {
    if (entry.macOnly && !platformIsMac) return []
    if (
      !languageFeaturesAllowed &&
      (entry.id === 'language' || entry.id === 'vocabulary')
    ) {
      return []
    }
    const render = SETTINGS_SECTION_HOST_RENDERERS[entry.id]
    if (!render) {
      throw new Error(`Settings section "${entry.id}" has no registered host renderer.`)
    }
    return [
      <div key={entry.id} data-settings-section-host={entry.id}>
        {render({
          isActive: active === entry.id,
          onClose,
          onNavigate,
          projectId: options.projectId,
          providerBlueprints: options.providerBlueprints
        })}
      </div>
    ]
  })
}

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

            {renderSettingsSectionHosts(
              active,
              onClose,
              setActive,
              SETTINGS_SECTION_REGISTRY,
              isMac,
              {
                languageFeaturesAllowed,
                projectId: activeProjectId,
                providerBlueprints: activeProject?.providerBlueprints
              }
            )}
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
