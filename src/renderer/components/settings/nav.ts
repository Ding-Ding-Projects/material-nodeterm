import { projectSectionId } from './project-settings-targets'
import type { ProjectIcon } from '@shared/project-icon'

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
  | 'planner'
  | 'adhd-modes'
  | 'shortcuts'
  | 'agents'
  | 'usage'
  | 'accounts'
  | 'provider-accounts'
  | 'custom-agents'
  | 'model-gateway'
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
  | 'narrator'
  | 'school-mode'
  | 'kids-mode'
  | 'vocabulary'
  | 'history'
  | 'toylocks'
  | 'authenticator'
  | 'support'
  | 'debug'
  | `project-${string}`

export interface ProjectNavItem {
  id: string
  name: string
  color: string
  icon?: ProjectIcon
}

export interface SettingsSectionRef {
  id: SettingsSectionId
  title: string
  /** Only meaningful on macOS (the notch capsule) — hidden elsewhere by `visibleSettingsGroups`. */
  macOnly?: boolean
  /** Project-section rows only (`project-${string}` ids): the project's own color/icon, so the
   *  sidebar can render its `ProjectGlyph` beside the title instead of the generic folder glyph
   *  every project section used to share. Absent on every static section. */
  color?: string
  icon?: ProjectIcon
}

export interface SettingsGroup {
  id: string
  title: string
  sections: SettingsSectionRef[]
}

// Grouped by what the user is DOING, not by where the code lives: AI work first (it is what
// the app is for), then the workspace around it, then connectivity, then app housekeeping.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'ai',
    title: 'AI capabilities',
    sections: [
      { id: 'agents', title: 'Agents' },
      { id: 'accounts', title: 'Accounts' },
      { id: 'provider-accounts', title: 'Provider accounts' },
      { id: 'custom-agents', title: 'Custom agents' },
      { id: 'model-gateway', title: 'Model gateway' },
      { id: 'usage', title: 'Usage' },
      { id: 'commit', title: 'Commit messages' }
    ]
  },
  {
    id: 'workspace',
    title: 'Workspace',
    sections: [
      { id: 'terminal', title: 'Terminal' },
      { id: 'shell', title: 'Shell' },
      { id: 'tmux', title: 'tmux' },
      { id: 'github-issues', title: 'GitHub Issues' },
      { id: 'behavior', title: 'Behavior' },
      { id: 'workspace-storage', title: 'Project storage' }
    ]
  },
  {
    id: 'interface',
    title: 'Interface',
    sections: [
      { id: 'appearance', title: 'Appearance' },
      { id: 'appearance-editor', title: 'Appearance editor' },
      { id: 'app-identity', title: 'App name & logo' },
      { id: 'notch', title: 'Notch', macOnly: true },
      { id: 'notifications', title: 'Notifications' },
      { id: 'language', title: 'Language' },
      { id: 'narrator', title: 'Narrator' },
      { id: 'speech', title: 'Speech' },
      { id: 'schedule', title: 'Schedule' },
      { id: 'planner', title: 'Planner' },
      { id: 'adhd-modes', title: 'ADHD modes' },
       { id: 'shortcuts', title: 'Shortcuts' }
    ]
  },
  {
    id: 'connectivity',
    title: 'Remote & team',
    sections: [
      { id: 'presence', title: 'Your name' },
      { id: 'phone', title: 'Phone' },
      { id: 'remote', title: 'Docker host' },
      { id: 'team-access', title: 'Team seats' },
      { id: 'ssh', title: 'Remote (SSH)' }
    ]
  },
  {
    id: 'application',
    title: 'Application',
    sections: [
      { id: 'license', title: 'License' },
      { id: 'updates', title: 'Updates' },
      { id: 'privacy', title: 'Privacy' },
      { id: 'school-mode', title: 'School mode' },
      { id: 'kids-mode', title: 'Kids mode' },
      { id: 'vocabulary', title: 'Personal vocabulary' },
      { id: 'history', title: 'History' }
    ]
  },
  {
    id: 'fun',
    title: 'Just for fun',
    sections: [
      { id: 'toylocks', title: 'Toy locks' },
      { id: 'authenticator', title: 'Authenticator' },
       { id: 'support', title: 'Support Tickets' },
      { id: 'debug', title: 'Debug' }
    ]
  }
]

export const FIRST_SECTION_ID: SettingsSectionId = 'agents'

/** Single source of truth for section identity, shared by navigation and SettingsPage routing. */
export const SETTINGS_SECTION_REGISTRY: readonly SettingsSectionRef[] = SETTINGS_GROUPS.flatMap(
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
  return SETTINGS_GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter(
      (s) => (isMac || !s.macOnly) && (schoolModeAllowsLanguage || s.id !== 'language')
    )
  })).filter((g) => g.sections.length > 0)
}

/**
 * Render-time only — deliberately NOT part of `SETTINGS_GROUPS`. Open projects change at
 * runtime, so this builds a group from the current project list on every render instead of
 * baking project ids into the static nav (which would break the `nav.test.ts` section-count
 * pins). Returns null when there are no open projects, so callers can skip rendering the group.
 */
export function projectsSettingsGroup(projects: ProjectNavItem[]): SettingsGroup | null {
  if (projects.length === 0) return null
  return {
    id: 'projects',
    title: 'Projects',
    sections: projects.map((p) => ({
      id: projectSectionId(p.id),
      title: p.name,
      color: p.color,
      icon: p.icon
    }))
  }
}
