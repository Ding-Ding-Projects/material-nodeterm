import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'

/**
 * Hand-written first-class contract for every static string introduced by Windows terminal
 * profiles. Keeping the expected English fallback beside the exact id makes a removed surface
 * fail even when the catalog and its callers disappear together.
 *
 * Values supplied at runtime (`profile`, `reason`, `error`, and so on) are deliberately tokens:
 * detected profile labels, WSL distribution names, executable paths, and trusted-core errors must
 * pass through unchanged rather than becoming translation inputs.
 */
const REQUIRED_TERMINAL_PROFILE_COPY = {
  'terminalProfiles.common.detectingProfiles': 'Detecting profiles…',
  'terminalProfiles.common.profilesUnavailable': 'Profiles unavailable',
  'terminalProfiles.common.noProfilesDetected': 'No Windows terminal profiles were detected.',
  'terminalProfiles.common.detectionPending': 'Profile detection has not finished yet.',
  'terminalProfiles.common.detectionFailed': 'Terminal profile detection failed.',
  'terminalProfiles.common.unavailableOnMachine': 'This profile is unavailable on this machine.',
  'terminalProfiles.common.unavailableHereTitle': 'Windows profile unavailable here',
  'terminalProfiles.common.unavailableHereBody':
    'Local Windows profiles cannot be applied to an SSH or relay terminal.',
  'terminalProfiles.common.noReasonProvided': 'No reason was provided.',
  'terminalProfiles.common.available': 'Available',
  'terminalProfiles.common.unavailable': 'Unavailable',

  'terminalProfiles.label.default': 'Default profile',
  'terminalProfiles.label.automatic': 'Automatic',
  'terminalProfiles.label.custom': 'Custom executable',
  'terminalProfiles.label.unavailable': 'Unavailable terminal profile',
  'terminalProfiles.label.unknown': 'Unknown profile',

  'terminalProfiles.settings.sectionTitle': 'Shell',
  'terminalProfiles.settings.sectionDescription':
    'Choose the Windows profile used for new local terminals.',
  'terminalProfiles.settings.legacySectionDescription':
    'The shell new terminals launch. Empty uses the system default.',
  'terminalProfiles.settings.legacyDefaultLabel': 'Default shell',
  'terminalProfiles.settings.legacyDefaultDescription':
    'Shell executable (leave empty to use $SHELL or the system default)',
  'terminalProfiles.settings.systemDefaultPlaceholder': 'system default',
  'terminalProfiles.settings.defaultLabel': 'Default terminal profile',
  'terminalProfiles.settings.defaultDescription':
    'Used by every one-click New terminal action. Existing nodes keep their selected profile.',
  'terminalProfiles.settings.availabilityRowTitle': 'Detected profile availability',
  'terminalProfiles.settings.customLabel': 'Custom executable',
  'terminalProfiles.settings.customNeedsRefresh': 'Refresh detection to verify this executable.',
  'terminalProfiles.settings.customChooseFirst':
    'Choose a custom executable before using this profile.',
  'terminalProfiles.settings.detectingInstalled': 'Detecting installed terminal profiles…',
  'terminalProfiles.settings.detectionFailedSavedDefault':
    'Profile detection failed. The saved default was not changed.',
  'terminalProfiles.settings.selectedAvailable': '{profile} is available.',
  'terminalProfiles.settings.selectedUnavailable': '{profile} is unavailable: {reason}',
  'terminalProfiles.settings.savedProfileMissing':
    '{profile} is unavailable: this saved profile is no longer detected on this computer.',
  'terminalProfiles.settings.customEmptyNote':
    'Unavailable until an executable is chosen. New terminals will not silently fall back.',
  'terminalProfiles.settings.customUnavailable': 'Unavailable: {reason}',
  'terminalProfiles.settings.executableUnresolved': 'The executable could not be resolved.',
  'terminalProfiles.settings.saveBeforeDetectionFailed':
    'Could not save settings before detection.',
  'terminalProfiles.settings.optionDetecting': '{profile} — detecting…',
  'terminalProfiles.settings.optionDetectionFailed': '{profile} — detection failed',
  'terminalProfiles.settings.optionUnavailable': '{profile} — unavailable',
  'terminalProfiles.settings.optionUnavailableSuffix': ' — unavailable',
  'terminalProfiles.settings.detectedHeading': 'Detected profiles',
  'terminalProfiles.settings.detectedDescription':
    'Missing shells and WSL distributions stay unavailable instead of opening a different profile.',
  'terminalProfiles.settings.detecting': 'Detecting…',
  'terminalProfiles.settings.refresh': 'Refresh detection',
  'terminalProfiles.settings.detectionFailedStale':
    'Detection failed: {error} Previous availability may be stale.',
  'terminalProfiles.settings.availabilityAria': 'Detected terminal profile availability',
  'terminalProfiles.settings.noProfilesReturned': 'No terminal profiles were returned.',
  'terminalProfiles.settings.customDescription':
    'Executable name or absolute path. Paths with spaces are supported; enter no arguments or quotes.',
  'terminalProfiles.settings.chooseExecutableAria': 'Choose custom terminal executable',
  'terminalProfiles.settings.chooseExecutable': 'Choose executable…',

  'terminalProfiles.named.heading': 'Named terminal profiles',
  'terminalProfiles.named.description': 'Save a name, initial directory, and optional startup command for new terminal or agent nodes. These values stay on this computer and are not written to shared project files.',
  'terminalProfiles.named.search': 'Search named profiles',
  'terminalProfiles.named.listLabel': 'Saved named terminal profiles',
  'terminalProfiles.named.empty': 'No named profiles match this search. Create one below.',
  'terminalProfiles.named.noStartup': 'No startup command',
  'terminalProfiles.named.default': 'Default',
  'terminalProfiles.named.useDefault': 'Use for new nodes',
  'terminalProfiles.named.defaultStatus': '{profile} is used for one-click new nodes.',
  'terminalProfiles.named.edit': 'Edit',
  'terminalProfiles.named.remove': 'Remove',
  'terminalProfiles.named.confirmRemove': 'Confirm remove',
  'terminalProfiles.named.editorTitle': 'Create named profile',
  'terminalProfiles.named.nameLabel': 'Name',
  'terminalProfiles.named.nameDescription': 'A short label shown in profile pickers.',
  'terminalProfiles.named.cwdLabel': 'Initial directory',
  'terminalProfiles.named.cwdDescription': 'The directory opened before the startup command runs.',
  'terminalProfiles.named.browse': 'Browse…',
  'terminalProfiles.named.commandLabel': 'Startup command',
  'terminalProfiles.named.commandDescription': 'Optional text sent once after the shell is ready. It is user-authored and runs locally.',
  'terminalProfiles.named.invalid': 'Enter a name and initial directory. Keep each value within its stated limit.',
  'terminalProfiles.named.cancel': 'Cancel',
  'terminalProfiles.named.saveChanges': 'Save changes',
  'terminalProfiles.named.create': 'Create profile',

  'terminalProfiles.create.menuLabel': 'New terminal with profile…',
  'terminalProfiles.create.chooseProfileAria': 'Choose terminal profile',
  'terminalProfiles.create.backToNewNodes': 'Back to new nodes',
  'terminalProfiles.create.backToNewSessions': 'Back to new sessions',
  'terminalProfiles.create.unavailableInView':
    'Terminal profile creation is unavailable in this view.',
  'terminalProfiles.create.detectionReturnedNone':
    'Profile detection has not returned any profiles.',
  'terminalProfiles.create.commandLabel': 'New terminal — {profile}',

  'terminalProfiles.restart.menuLabel': 'Restart with profile…',
  'terminalProfiles.restart.hostCannotConfirm':
    'This host cannot confirm that the old persistent session ended.',
  'terminalProfiles.restart.noLongerLocal': 'This node is no longer a local Windows terminal.',
  'terminalProfiles.restart.confirmedUnavailable':
    'Confirmed persistent-session recycling is unavailable on this host.',
  'terminalProfiles.restart.busy':
    'This terminal is already restarting. Wait for that restart to finish.',
  'terminalProfiles.restart.progress': 'Restarting with profile…',
  'terminalProfiles.restart.customAgentMissingConfig':
    'This custom agent is no longer configured. Restore its launch command before restarting; the live process was not changed.',
  'terminalProfiles.restart.crossEnvironmentUnavailable':
    'This agent cannot be restarted across Windows and WSL environments because its CLI and conversation store cannot be verified there. Choose a profile in the current environment.',
  'terminalProfiles.restart.newBuiltInConversationWarning':
    'No resumable conversation id is available. The agent will start a new conversation after the profile switch.',
  'terminalProfiles.restart.newCustomConversationWarning':
    'This custom agent will restart from its configured launch command in a new conversation.',
  'terminalProfiles.restart.projectChanged':
    'The project changed before confirmation, so nothing was restarted.',
  'terminalProfiles.restart.confirmTitle': 'Restart “{node}” with {profile}',
  'terminalProfiles.restart.confirmDescription':
    'The live process and persistent session will end, including anything still running inside it. The node will then be recreated with {profile}.',
  'terminalProfiles.restart.confirmButton': 'Restart',
  'terminalProfiles.restart.failedTitle': 'Restart with profile failed',
  'terminalProfiles.restart.defaultNodeLabel': 'terminal',

  'terminalProfiles.header.statusAvailable': 'available',
  'terminalProfiles.header.statusUnavailable': 'unavailable',
  'terminalProfiles.header.statusUnknown': 'availability unknown',
  'terminalProfiles.header.ariaLabel': 'Terminal profile: {profile}, {status}',
  'terminalProfiles.header.ariaLabelWithHint': 'Terminal profile: {profile}, {status}: {hint}',
  'terminalProfiles.header.title': 'Terminal profile: {profile}',
  'terminalProfiles.header.checkingAvailability':
    'Checking whether this terminal profile is available on this machine.',
  'terminalProfiles.header.noLongerDetected':
    'This selected profile is no longer detected on this machine.',
  'terminalProfiles.header.availableTitle': '{profile} terminal profile',
  'terminalProfiles.header.unavailableTitle': '{profile} is unavailable.',
  'terminalProfiles.header.unavailableTitleWithReason': '{profile} is unavailable: {reason}',

  'terminalProfiles.error.unresolved': 'The terminal profile could not be resolved.',
  'terminalProfiles.error.spawnLead': 'This terminal could not be started. {error}',
  'terminalProfiles.error.recovery':
    'Choose Restart with profile… from this card’s menu, then try again.',
  'terminalProfiles.error.nodeRecovery':
    'Choose Restart with profile… from this node’s menu, then try again.',
  'terminalProfiles.error.tryAgain': 'Try again',
  'terminalProfiles.error.agentRelaunchLead': 'This agent could not be relaunched. {reason}',
  'terminalProfiles.error.agentCustomMissing':
    'This custom agent is no longer configured. Restore its launch command, then try again. No agent was launched in the replacement shell.',
  'terminalProfiles.error.agentRecycleUnavailable':
    'This host cannot confirm that the blank replacement session ended. Nothing was restarted.',
  'terminalProfiles.error.agentRecycleFailed':
    'Could not safely replace the blank terminal session. Nothing was restarted.',
  'terminalProfiles.error.agentRecycleFailedWithDetail':
    'Could not safely replace the blank terminal session: {detail} Nothing was restarted.',
  'terminalProfiles.error.agentRetryPreparing': 'Preparing a fresh session…',
  'terminalProfiles.error.agentTryAgain': 'Try agent again',
  'terminalProfiles.error.sessionEnded':
    'This persistent session ended before a replacement was ready. Nothing was restarted.',
  'terminalProfiles.error.openCanvasToReopen': 'Open on canvas to reopen'
} as const

type TerminalProfileCopyId = keyof typeof REQUIRED_TERMINAL_PROFILE_COPY

function tokens(text: string): string[] {
  return [...text.matchAll(/\{[a-zA-Z][a-zA-Z0-9]*\}/g)].map((match) => match[0]).sort()
}

describe('Windows terminal-profile localization catalog', () => {
  it('contains exactly the hand-written first-class profile-copy inventory', () => {
    const actual = Object.keys(CATALOG)
      .filter((id) => id.startsWith('terminalProfiles.'))
      .sort()
    const required = Object.keys(REQUIRED_TERMINAL_PROFILE_COPY).sort()

    expect(actual).toEqual(required)
  })

  it('ships every English fallback and all five non-empty variants in both languages', () => {
    for (const [id, fallback] of Object.entries(REQUIRED_TERMINAL_PROFILE_COPY) as Array<
      [TerminalProfileCopyId, string]
    >) {
      const entry = CATALOG[id]
      expect(entry, `${id} is missing`).toBeDefined()
      expect(entry.en, `${id}.en must retain all ten tone levels`).toEqual([
        fallback,
        fallback,
        fallback,
        fallback,
        fallback,
        fallback,
        fallback,
        fallback,
        fallback,
        fallback
      ])
      expect(entry.yue, `${id}.yue must retain all ten tone levels`).toHaveLength(10)
      for (const [index, variant] of entry.yue.entries()) {
        expect(variant.trim(), `${id}.yue[${index}] must not be blank`).not.toBe('')
      }
    }
  })

  it('preserves every runtime-value token in both languages at every tone level', () => {
    for (const [id, fallback] of Object.entries(REQUIRED_TERMINAL_PROFILE_COPY) as Array<
      [TerminalProfileCopyId, string]
    >) {
      const expectedTokens = tokens(fallback)
      for (const language of ['en', 'yue'] as const) {
        for (const [index, variant] of CATALOG[id][language].entries()) {
          expect(tokens(variant), `${id}.${language}[${index}] changed its runtime tokens`).toEqual(
            expectedTokens
          )
        }
      }
    }
  })
})
