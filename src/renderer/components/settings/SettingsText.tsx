import { useDebugValue, type React } from 'react'
import { useVocabularyMapper, useVocabularyTemplate } from '../../lib/personalVocabulary/useVocabularyText'

export type SettingsTextSegment =
  | { kind: 'copy'; value: string }
  | { kind: 'fact'; value: React.ReactNode }

type SettingsTextProps = {
  /** Stable source identifier for the exact authored-copy boundary, used by the coverage audit. */
  callsiteId?: string
} & (
  | { children: string; template?: never; facts?: never; segments?: never }
  | { children?: never; template: string; facts?: Record<string, string>; segments?: never }
  | { children?: never; template?: never; facts?: never; segments: readonly SettingsTextSegment[] }
)

/** Canonical runtime ownership for every inventoried settings copy boundary. */
export const SETTINGS_CALLSITE_OWNERS: Readonly<Record<string, string>> = {
  'settings.accounts.adding-on': 'src/renderer/components/settings/sections/AccountsSection.tsx',
  'settings.accounts.unavailable': 'src/renderer/components/settings/sections/AccountsSection.tsx',
  'settings.accounts.cli-version-warning': 'src/renderer/components/settings/sections/AccountsSection.tsx',
  'settings.accounts.working-directory': 'src/renderer/components/settings/sections/AccountsSection.tsx',
  'settings.accounts.credentials-disclosure': 'src/renderer/components/settings/sections/AccountsSection.tsx',
  'settings.app-identity.display-name-facts': 'src/renderer/components/settings/sections/AppIdentitySection.tsx',
  'settings.app-identity.current-name': 'src/renderer/components/settings/sections/AppIdentitySection.tsx',
  'settings.app-identity.logo-error': 'src/renderer/components/settings/sections/AppIdentitySection.tsx',
  'settings.app-identity.crop-facts': 'src/renderer/components/settings/sections/AppIdentitySection.tsx',
  'settings.appearance.presets-import-result': 'src/renderer/components/appearance/AppearanceEditor.tsx',
  'settings.schedule.source-error': 'src/renderer/components/settings/sections/ScheduleSection.tsx',
  'settings.schedule.source-success': 'src/renderer/components/settings/sections/ScheduleSection.tsx',
  'settings.schedule.source-unchecked': 'src/renderer/components/settings/sections/ScheduleSection.tsx',
  'settings.schedule.load-error-kind': 'src/renderer/components/settings/sections/ScheduleSection.tsx',
  'settings.schedule.load-error-path': 'src/renderer/components/settings/sections/ScheduleSection.tsx',
  'settings.schedule.value-source-status': 'src/renderer/components/settings/sections/ScheduleSection.tsx',
  'settings.school.toggle': 'src/renderer/components/settings/sections/SchoolModeSection.tsx',
  'settings.school.no-pin': 'src/renderer/components/settings/sections/SchoolModeSection.tsx',
  'settings.school.error': 'src/renderer/components/settings/sections/SchoolModeSection.tsx',
  'settings.school.recovery': 'src/renderer/components/settings/sections/SchoolModeSection.tsx',
  'settings.school.pin-change-message': 'src/renderer/components/settings/sections/SchoolModeSection.tsx',
  'settings.kids.toggle': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.no-pin': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.error': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.recovery': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.disclosure': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.refused-modes': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.refused-mode-reason': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.kids.pin-change-message': 'src/renderer/components/settings/sections/KidsModeSection.tsx',
  'settings.narrator.voice-picker': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.choose-automatically': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.preview': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.voices-loading': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.no-voice': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.missing-voice': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.network-voice': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.active-voice': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.unavailable': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.narrator.enabled': 'src/renderer/components/settings/sections/NarratorSection.tsx',
  'settings.speech.engine': 'src/renderer/components/settings/sections/SpeechSection.tsx',
  'settings.speech.shortcut': 'src/renderer/components/settings/sections/SpeechSection.tsx',
  'settings.speech.models-heading': 'src/renderer/components/settings/sections/SpeechSection.tsx',
  'settings.speech.models-loading': 'src/renderer/components/settings/sections/SpeechSection.tsx',
  'settings.speech.language': 'src/renderer/components/settings/sections/SpeechSection.tsx',
  'settings.terminal.theme': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.font': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.size-weight': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.spacing': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.word-separators': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.cursor': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.cursor-unfocused': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.middle-click': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.bold-bright': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.minimum-contrast': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.terminal.rendering': 'src/renderer/components/settings/sections/TerminalSection.tsx',
  'settings.workspace-storage.split': 'src/renderer/components/settings/sections/WorkspaceStorageSection.tsx',
  'settings.custom-agents.label': 'src/renderer/components/settings/sections/CustomAgentsSection.tsx',
  'settings.custom-agents.launch-command': 'src/renderer/components/settings/sections/CustomAgentsSection.tsx',
  'settings.custom-agents.prompt-injection': 'src/renderer/components/settings/sections/CustomAgentsSection.tsx',
  'settings.ssh.label': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.ssh.host': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.ssh.user': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.ssh.port': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.ssh.remote-directory': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.ssh.identity-file': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.ssh.extra-args': 'src/renderer/components/settings/sections/SshSection.tsx',
  'settings.support.advance': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.recovery-path': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.copy-path': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.open-folder': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.browser-boundary': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.no-delete': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.close-ticket': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.disclosure': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.status-label': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.canned-response': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.severity-value': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.category-value': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.category-option': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.severity-option': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.submit': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.export': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx',
  'settings.support.empty': 'src/renderer/components/settings/sections/SupportTicketsSection.tsx'
}

const SETTINGS_CALLSITE_ID = /^settings\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Validate and consume the stable id at runtime, so ids are not inert source-only markers. */
export function validateSettingsCallsiteId(callsiteId: string | undefined): string | undefined {
  if (
    callsiteId !== undefined &&
    (!SETTINGS_CALLSITE_ID.test(callsiteId) ||
      !Object.prototype.hasOwnProperty.call(SETTINGS_CALLSITE_OWNERS, callsiteId))
  ) {
    throw new Error(`Invalid settings callsite id: ${callsiteId}`)
  }
  return callsiteId
}

/** Explicit settings prose boundary. Copy segments are mapped, facts are rendered verbatim. */
export function SettingsText(props: SettingsTextProps): React.JSX.Element {
  const callsiteId = validateSettingsCallsiteId(props.callsiteId)
  useDebugValue(callsiteId ? `settings:${callsiteId}` : undefined)
  const vocab = useVocabularyMapper()
  const template = useVocabularyTemplate(
    'template' in props ? props.template : undefined,
    'facts' in props ? props.facts : undefined
  )
  if ('segments' in props) {
    return (
      <>
        {props.segments.map((segment, index) =>
          segment.kind === 'copy' ? <React.Fragment key={index}>{vocab(segment.value)}</React.Fragment> : <React.Fragment key={index}>{segment.value}</React.Fragment>
        )}
      </>
    )
  }
  return <>{'template' in props ? template : vocab(props.children)}</>
}
