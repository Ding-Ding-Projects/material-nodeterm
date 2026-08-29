import { createElement, type ReactNode } from 'react'
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
import { GitHubIssuesSection } from './sections/GitHubIssuesSection'
import { KidsModeSection } from './sections/KidsModeSection'
import { LanguageSection } from './sections/LanguageSection'
import { LicenseSection } from './sections/LicenseSection'
import { LocalHistorySection } from './sections/LocalHistorySection'
import { NarratorSection } from './sections/NarratorSection'
import { NotchSection } from './sections/NotchSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { PersonalVocabularySection } from './sections/PersonalVocabularySection'
import { PhoneSection } from './sections/PhoneSection'
import { PresenceIdentitySection } from './sections/PresenceIdentitySection'
import { PrivacySection } from './sections/PrivacySection'
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

export type SettingsSectionId =
  | 'terminal'
  | 'shell'
  | 'behavior'
  | 'workspace-storage'
  | 'appearance'
  | 'appearance-editor'
  | 'app-identity'
  | 'notch'
  | 'phone'
  | 'speech'
  | 'schedule'
  | 'adhd-modes'
  | 'shortcuts'
  | 'agents'
  | 'usage'
  | 'accounts'
  | 'custom-agents'
  | 'notifications'
  | 'narrator'
  | 'commit'
  | 'tmux'
  | 'github-issues'
  | 'license'
  | 'presence'
  | 'remote'
  | 'team-access'
  | 'ssh'
  | 'updates'
  | 'privacy'
  | 'language'
  | 'school-mode'
  | 'kids-mode'
  | 'vocabulary'
  | 'history'
  | 'toylocks'
  | 'authenticator'
  | 'support'

export interface SettingsSectionRef {
  id: SettingsSectionId
  title: string
  /** Only meaningful on macOS (the notch capsule) — hidden elsewhere by `visibleSettingsGroups`. */
  macOnly?: boolean
}

export interface SettingsSectionRenderProps {
  isActive: boolean
  onClose: () => void
  onNavigate: (id: SettingsSectionId) => void
}

export interface SettingsSectionRegistration extends SettingsSectionRef {
  /** The same registration drives the sidebar identity and the page's mounted section. */
  render: (props: SettingsSectionRenderProps) => ReactNode
}

export interface SettingsGroup {
  id: string
  title: string
  sections: SettingsSectionRegistration[]
}

type BasicSection = (props: { isActive: boolean }) => ReactNode

const basic = (component: BasicSection) =>
  ({ isActive }: SettingsSectionRenderProps): ReactNode => createElement(component, { isActive })

// Grouped by what the user is DOING, not by where the code lives: AI work first (it is what
// the app is for), then the workspace around it, then connectivity, then app housekeeping.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'ai',
    title: 'AI capabilities',
    sections: [
      { id: 'agents', title: 'Agents', render: basic(AgentsSection) },
      { id: 'accounts', title: 'Accounts', render: basic(AccountsSection) },
      { id: 'custom-agents', title: 'Custom agents', render: basic(CustomAgentsSection) },
      { id: 'usage', title: 'Usage', render: basic(UsageSection) },
      { id: 'commit', title: 'Commit messages', render: basic(CommitSection) }
    ]
  },
  {
    id: 'workspace',
    title: 'Workspace',
    sections: [
      { id: 'terminal', title: 'Terminal', render: basic(TerminalSection) },
      { id: 'shell', title: 'Shell', render: basic(ShellSection) },
      { id: 'tmux', title: 'tmux', render: basic(TmuxSection) },
      { id: 'github-issues', title: 'GitHub Issues', render: basic(GitHubIssuesSection) },
      { id: 'behavior', title: 'Behavior', render: basic(BehaviorSection) },
      { id: 'workspace-storage', title: 'Project storage', render: basic(WorkspaceStorageSection) }
    ]
  },
  {
    id: 'interface',
    title: 'Interface',
    sections: [
      { id: 'appearance', title: 'Appearance', render: basic(AppearanceSection) },
      { id: 'appearance-editor', title: 'Appearance editor', render: basic(AppearanceEditorSection) },
      { id: 'app-identity', title: 'App name & logo', render: basic(AppIdentitySection) },
      { id: 'notch', title: 'Notch', macOnly: true, render: basic(NotchSection) },
      { id: 'notifications', title: 'Notifications', render: basic(NotificationsSection) },
      { id: 'language', title: 'Language', render: basic(LanguageSection) },
      { id: 'narrator', title: 'Narrator', render: basic(NarratorSection) },
      { id: 'speech', title: 'Speech', render: basic(SpeechSection) },
      { id: 'schedule', title: 'Schedule', render: basic(ScheduleSection) },
      { id: 'adhd-modes', title: 'ADHD modes', render: basic(AdhdModesSection) },
      { id: 'shortcuts', title: 'Shortcuts', render: basic(ShortcutsSection) }
    ]
  },
  {
    id: 'connectivity',
    title: 'Remote & team',
    sections: [
      { id: 'presence', title: 'Your name', render: basic(PresenceIdentitySection) },
      { id: 'phone', title: 'Phone', render: basic(PhoneSection) },
      { id: 'remote', title: 'Docker host', render: ({ isActive, onClose }) => createElement(RemoteSection, { isActive, onClose }) },
      { id: 'team-access', title: 'Team seats', render: basic(TeamAccessSection) },
      { id: 'ssh', title: 'Remote (SSH)', render: ({ isActive, onNavigate }) => createElement(SshSection, { isActive, onNavigate }) }
    ]
  },
  {
    id: 'application',
    title: 'Application',
    sections: [
      { id: 'license', title: 'License', render: basic(LicenseSection) },
      { id: 'updates', title: 'Updates', render: basic(UpdatesSection) },
      { id: 'privacy', title: 'Privacy', render: basic(PrivacySection) },
      { id: 'school-mode', title: 'School mode', render: basic(SchoolModeSection) },
      { id: 'kids-mode', title: 'Kids mode', render: basic(KidsModeSection) },
      { id: 'vocabulary', title: 'Personal vocabulary', render: basic(PersonalVocabularySection) },
      { id: 'history', title: 'History', render: basic(LocalHistorySection) }
    ]
  },
  {
    id: 'fun',
    title: 'Just for fun',
    sections: [
      { id: 'toylocks', title: 'Toy locks', render: basic(ToyLocksSection) },
      { id: 'authenticator', title: 'Authenticator', render: basic(AuthenticatorSection) },
      { id: 'support', title: 'Support Tickets', render: basic(SupportTicketsSection) }
    ]
  }
]

export const FIRST_SECTION_ID: SettingsSectionId = 'agents'

/** Single source of truth for section identity, shared by navigation and SettingsPage routing. */
export const SETTINGS_SECTION_REGISTRY: readonly SettingsSectionRegistration[] = SETTINGS_GROUPS.flatMap(
  (group) => group.sections
)

export function allSectionIds(): SettingsSectionId[] {
  return SETTINGS_SECTION_REGISTRY.map((section) => section.id)
}

/**
 * The groups as the sidebar should render them for this platform: a mac-only section is dropped
 * entirely off macOS (an empty group would be dropped too, though none exists today). Pure — the
 * caller passes the platform so this stays testable.
 */
export function visibleSettingsGroups(
  isMac: boolean,
  schoolModeAllowsLanguage = true
): SettingsGroup[] {
  // Route and navigation must agree on the same live registration set. Filtering through the
  // flattened registry makes a removed entry disappear from both surfaces instead of leaving a
  // sidebar button whose page has no renderer.
  const registeredIds = new Set(SETTINGS_SECTION_REGISTRY.map((section) => section.id))
  return SETTINGS_GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter(
      (s) => registeredIds.has(s.id) && (isMac || !s.macOnly) && (schoolModeAllowsLanguage || s.id !== 'language')
    )
  })).filter((g) => g.sections.length > 0)
}
