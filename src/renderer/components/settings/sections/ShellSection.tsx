import { useEffect, useMemo, useRef, useState } from 'react'
import type { WindowsTerminalProfile } from '@shared/types'
import { useSettings } from '../../../state/settings'
import {
  supportsWindowsTerminalProfiles,
  terminalProfileDisplayError,
  terminalProfileLabel,
  useTerminalProfiles
} from '../../../state/terminal-profiles'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { useLocalizedVocabularyText } from '../../../lib/personalVocabulary/useLocalizedVocabularyText'

const BASE_ROWS = {
  profile: {
    title: 'Default terminal profile',
    keywords: [
      'shell',
      'profile',
      'powershell',
      'windows powershell',
      'pwsh',
      'cmd',
      'command prompt',
      'git bash',
      'wsl',
      'distribution'
    ]
  },
  availability: {
    title: 'Detected profile availability',
    keywords: ['shell', 'profile', 'available', 'unavailable', 'detect', 'refresh', 'failure']
  },
  custom: {
    title: 'Custom executable',
    keywords: ['shell', 'custom', 'advanced', 'path', 'executable', 'picker']
  },
  legacyShell: {
    title: 'Default shell',
    keywords: ['shell', 'bash', 'zsh', 'fish', 'default']
  }
}
const UNAVAILABLE_PROFILE_OPTION = '__configured-profile-unavailable__'
type ProfileText = ReturnType<typeof useLocalizedVocabularyText>

function localizedRows(profileText: ProfileText): typeof BASE_ROWS {
  const localizeKeywords = (id: string, keywords: readonly string[]): string[] =>
    keywords.map((keyword, index) => profileText(`terminalProfiles.settings.${id}.keyword.${index}`, keyword))
  return {
    ...BASE_ROWS,
    profile: {
      ...BASE_ROWS.profile,
      title: profileText('terminalProfiles.settings.defaultLabel', 'Default terminal profile'),
      keywords: localizeKeywords('profile', BASE_ROWS.profile.keywords)
    },
    availability: {
      ...BASE_ROWS.availability,
      title: profileText(
        'terminalProfiles.settings.availabilityRowTitle',
        'Detected profile availability'
      ),
      keywords: localizeKeywords('availability', BASE_ROWS.availability.keywords)
    },
    custom: {
      ...BASE_ROWS.custom,
      title: profileText('terminalProfiles.settings.customLabel', 'Custom executable'),
      keywords: localizeKeywords('custom', BASE_ROWS.custom.keywords)
    },
    legacyShell: {
      ...BASE_ROWS.legacyShell,
      title: profileText('terminalProfiles.settings.legacyDefaultLabel', 'Default shell'),
      keywords: localizeKeywords('legacyShell', BASE_ROWS.legacyShell.keywords)
    }
  }
}

function LegacyShellControl({ rows }: { rows: typeof BASE_ROWS }): React.JSX.Element {
  const profileText = useLocalizedVocabularyText()
  const defaultShell = useSettings((state) => state.settings.defaultShell)
  const update = useSettings((state) => state.update)
  return (
    <SearchableRow {...rows.legacyShell} resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all', searchEntries: 'mapped' }}>
      <FieldRow
        resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}
        label={profileText('terminalProfiles.settings.legacyDefaultLabel', 'Default shell')}
        htmlFor="settings-default-shell"
        control={
          <Input
            id="settings-default-shell"
            className="w-64"
            placeholder={profileText(
              'terminalProfiles.settings.systemDefaultPlaceholder',
              'system default'
            )}
            vocabularyMode="factual"
            value={defaultShell}
            onChange={(event) => update({ defaultShell: event.target.value })}
          />
        }
      />
    </SearchableRow>
  )
}

function effectiveProfiles(
  profiles: readonly WindowsTerminalProfile[],
  customExecutable: string,
  customNeedsRefresh: boolean,
  refreshReason: string,
  chooseReason: string
): WindowsTerminalProfile[] {
  if (customExecutable.trim() && !customNeedsRefresh) return [...profiles]
  return profiles.map((profile) =>
    profile.id === 'custom'
      ? {
          ...profile,
          available: false,
          unavailableReason: customExecutable.trim()
            ? refreshReason
            : chooseReason
        }
      : profile
  )
}

function WindowsProfileControls({ rows }: { rows: typeof BASE_ROWS }): React.JSX.Element {
  const profileText = useLocalizedVocabularyText()
  const defaultShell = useSettings((state) => state.settings.defaultShell)
  const savedProfileId = useSettings((state) => state.settings.defaultTerminalProfileId)
  const update = useSettings((state) => state.update)
  const profiles = useTerminalProfiles((state) => state.profiles)
  const loading = useTerminalProfiles((state) => state.loading)
  const initialized = useTerminalProfiles((state) => state.initialized)
  const error = useTerminalProfiles((state) => state.error)
  const ensureLoaded = useTerminalProfiles((state) => state.ensureLoaded)
  const refresh = useTerminalProfiles((state) => state.refresh)
  const [customNeedsRefresh, setCustomNeedsRefresh] = useState(false)
  const [preparingRefresh, setPreparingRefresh] = useState(false)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const customRevision = useRef(0)

  // This component is a child of SettingsSection rather than ShellSection itself. React does not
  // mount it while SettingsSection returns null, so opening Settings elsewhere never performs a
  // Windows profile probe in the background.
  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

  // Only nullish is legacy/absent. An explicitly saved empty or malformed id must remain visible
  // as unavailable; using truthiness here would silently open Auto or Custom instead.
  const profileId = savedProfileId ?? (defaultShell.trim() ? 'custom' : 'auto')
  const displayedProfiles = useMemo(
    () =>
      effectiveProfiles(
        profiles,
        defaultShell,
        customNeedsRefresh,
        profileText(
          'terminalProfiles.settings.customNeedsRefresh',
          'Refresh detection to verify this executable.'
        ),
        profileText(
          'terminalProfiles.settings.customChooseFirst',
          'Choose a custom executable before using this profile.'
        )
      ),
    [profiles, defaultShell, customNeedsRefresh, profileText]
  )
  const profileLabelFallbacks = useMemo(
    () => ({
      defaultProfile: profileText('terminalProfiles.label.default', 'Default profile'),
      automatic: profileText('terminalProfiles.label.automatic', 'Automatic'),
      custom: profileText('terminalProfiles.label.custom', 'Custom executable'),
      unavailable: profileText(
        'terminalProfiles.label.unavailable',
        'Unavailable terminal profile'
      )
    }),
    [profileText]
  )
  const selectedFallbackLabel = terminalProfileLabel(
    profileId,
    displayedProfiles,
    profileLabelFallbacks
  )
  const selectedProfile = displayedProfiles.find((profile) => profile.id === profileId)
  const missingSelection = initialized && !loading && !error && !selectedProfile

  let selectedStatus = profileText(
    'terminalProfiles.settings.detectingInstalled',
    'Detecting installed terminal profiles…'
  )
  if (error) {
    selectedStatus = profileText(
      'terminalProfiles.settings.detectionFailedSavedDefault',
      'Profile detection failed. The saved default was not changed.'
    )
  } else if (selectedProfile) {
    selectedStatus = selectedProfile.available
      ? profileText(
          'terminalProfiles.settings.selectedAvailable',
          '{profile} is available.',
          { profile: selectedProfile.label }
        )
      : profileText(
          'terminalProfiles.settings.selectedUnavailable',
          '{profile} is unavailable: {reason}',
          {
            profile: selectedProfile.label,
            reason:
              selectedProfile.unavailableReason ??
              profileText('terminalProfiles.common.noReasonProvided', 'No reason was provided.')
          }
        )
  } else if (missingSelection) {
    selectedStatus = profileText(
      'terminalProfiles.settings.savedProfileMissing',
      '{profile} is unavailable: this saved profile is no longer detected on this computer.',
      { profile: selectedFallbackLabel }
    )
  }

  const selectedOptionMissing = !displayedProfiles.some((profile) => profile.id === profileId)
  const selectValue = selectedOptionMissing ? UNAVAILABLE_PROFILE_OPTION : profileId
  const customProfile = displayedProfiles.find((profile) => profile.id === 'custom')
  const customNote = !defaultShell.trim()
    ? profileText(
        'terminalProfiles.settings.customEmptyNote',
        'Unavailable until an executable is chosen. New terminals will not silently fall back.'
      )
    : customProfile && !customProfile.available
      ? profileText('terminalProfiles.settings.customUnavailable', 'Unavailable: {reason}', {
          reason:
            customProfile.unavailableReason ??
            profileText(
              'terminalProfiles.settings.executableUnresolved',
              'The executable could not be resolved.'
            )
        })
      : undefined

  const chooseCustomExecutable = async (): Promise<void> => {
    const executable = await window.nodeTerminal.dialog.selectFile()
    if (executable !== null) {
      update({ defaultShell: executable, defaultTerminalProfileId: 'custom' })
      customRevision.current += 1
      setCustomNeedsRefresh(true)
    }
  }

  const refreshDetection = async (): Promise<void> => {
    const revisionBeingChecked = customRevision.current
    setPreparingRefresh(true)
    setPreparationError(null)
    try {
      // Detection receives the effective active-project value directly. Persisting `base` here
      // bypassed project scope, ignored sparse overrides, and could make a project-local shell look
      // global. The detector uses this bounded value for this refresh only; settings persistence
      // remains owned by useSettings.update().
      await refresh(useSettings.getState().settings.defaultShell)
      if (
        customRevision.current === revisionBeingChecked &&
        !useTerminalProfiles.getState().error
      ) {
        setCustomNeedsRefresh(false)
      }
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message.trim() : ''
      setPreparationError(
        message ||
          profileText(
            'terminalProfiles.settings.saveBeforeDetectionFailed',
            'Could not save settings before detection.'
          )
      )
    } finally {
      setPreparingRefresh(false)
    }
  }

  const detectionError =
    preparationError ??
    terminalProfileDisplayError(
      error,
      profileText(
        'terminalProfiles.common.detectionFailed',
        'Terminal profile detection failed.'
      )
    )
  const detecting = loading || preparingRefresh

  return (
    <>
      <SearchableRow {...rows.profile} resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all', searchEntries: 'mapped' }}>
        <FieldRow
          resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}
          label={profileText(
            'terminalProfiles.settings.defaultLabel',
            'Default terminal profile'
          )}
          description={profileText(
            'terminalProfiles.settings.defaultDescription',
            'Used by every one-click New terminal action. Existing nodes keep their selected profile.'
          )}
          htmlFor="terminal-profile-select"
          control={
            <Select
              id="terminal-profile-select"
              className="w-72"
              value={selectValue}
              aria-invalid={
                Boolean(selectedProfile && !selectedProfile.available) || missingSelection
              }
              aria-describedby="terminal-profile-status"
              disabled={loading && displayedProfiles.length === 0}
              onChange={(event) => {
                // The synthetic option deliberately does not contain a hand-edited id. It is
                // disabled, but keep the guard in case a scripted change event targets it.
                if (event.target.value !== UNAVAILABLE_PROFILE_OPTION) {
                  update({ defaultTerminalProfileId: event.target.value })
                }
              }}
            >
              {selectedOptionMissing ? (
                <option value={UNAVAILABLE_PROFILE_OPTION} disabled>
                  {loading
                    ? profileText(
                        'terminalProfiles.settings.optionDetecting',
                        '{profile} — detecting…',
                        { profile: selectedFallbackLabel }
                      )
                    : error
                      ? profileText(
                          'terminalProfiles.settings.optionDetectionFailed',
                          '{profile} — detection failed',
                          { profile: selectedFallbackLabel }
                        )
                      : profileText(
                          'terminalProfiles.settings.optionUnavailable',
                          '{profile} — unavailable',
                          { profile: selectedFallbackLabel }
                        )}
                </option>
              ) : null}
              {displayedProfiles.map((profile) => (
                <option key={profile.id} value={profile.id} disabled={!profile.available}>
                  {profile.label}
                  {profile.available
                    ? ''
                    : profileText(
                        'terminalProfiles.settings.optionUnavailableSuffix',
                        ' — unavailable'
                      )}
                </option>
              ))}
            </Select>
          }
        />
        <p
          id="terminal-profile-status"
          className="mt-3 text-right text-xs leading-relaxed text-muted"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {selectedStatus}
        </p>
      </SearchableRow>

      <SearchableRow {...rows.availability}>
        <div>
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-text">
                {profileText('terminalProfiles.settings.detectedHeading', 'Detected profiles')}
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {profileText(
                  'terminalProfiles.settings.detectedDescription',
                  'Missing shells and WSL distributions stay unavailable instead of opening a different profile.'
                )}
              </p>
            </div>
            <Button disabled={detecting} onClick={() => void refreshDetection()}>
              {detecting
                ? profileText('terminalProfiles.settings.detecting', 'Detecting…')
                : profileText('terminalProfiles.settings.refresh', 'Refresh detection')}
            </Button>
          </div>
          {detectionError ? (
            <p className="mt-3 text-xs leading-relaxed text-[color:var(--warn)]" role="alert">
              {profileText(
                'terminalProfiles.settings.detectionFailedStale',
                'Detection failed: {error} Previous availability may be stale.',
                { error: detectionError }
              )}
            </p>
          ) : null}
          {displayedProfiles.length > 0 ? (
            <ul
              id="terminal-profile-availability"
              className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2"
              aria-label={profileText(
                'terminalProfiles.settings.availabilityAria',
                'Detected terminal profile availability'
              )}
            >
              {displayedProfiles.map((profile) => (
                <li key={profile.id} className="rounded-lg border border-border/70 px-3 py-2">
                  <span className="font-medium text-text">{profile.label}</span>
                  <span className="ml-2">
                    {profile.available
                      ? profileText('terminalProfiles.common.available', 'Available')
                      : profileText('terminalProfiles.common.unavailable', 'Unavailable')}
                  </span>
                  {!profile.available && profile.unavailableReason ? (
                    <span className="mt-1 block leading-relaxed">{profile.unavailableReason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : !loading && !detectionError ? (
            <p className="mt-3 text-xs text-muted">
              {profileText(
                'terminalProfiles.settings.noProfilesReturned',
                'No terminal profiles were returned.'
              )}
            </p>
          ) : null}
        </div>
      </SearchableRow>

      <SearchableRow {...rows.custom} resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all', searchEntries: 'mapped' }}>
        <FieldRow
          resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}
          label={profileText('terminalProfiles.settings.customLabel', 'Custom executable')}
          description={profileText(
            'terminalProfiles.settings.customDescription',
            'Executable name or absolute path. Paths with spaces are supported; enter no arguments or quotes.'
          )}
          note={customNote}
          htmlFor="custom-shell-executable"
          control={
            <div className="flex max-w-[430px] flex-wrap justify-end gap-2">
              <Input
                id="custom-shell-executable"
                className="w-72 font-mono"
                placeholder="C:\\Program Files\\PowerShell\\7\\pwsh.exe"
                vocabularyMode="factual"
                value={defaultShell}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  update({
                    defaultShell: event.target.value,
                    defaultTerminalProfileId: 'custom'
                  })
                  customRevision.current += 1
                  setCustomNeedsRefresh(true)
                }}
              />
              <Button
                aria-label={profileText(
                  'terminalProfiles.settings.chooseExecutableAria',
                  'Choose custom terminal executable'
                )}
                aria-controls="custom-shell-executable"
                onClick={() => void chooseCustomExecutable()}
              >
                {profileText(
                  'terminalProfiles.settings.chooseExecutable',
                  'Choose executable…'
                )}
              </Button>
            </div>
          }
        />
      </SearchableRow>
    </>
  )
}

export function ShellSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const profileText = useLocalizedVocabularyText()
  const profileSupport = supportsWindowsTerminalProfiles()
  const rows = localizedRows(profileText)
  return (
    <SettingsSection
      id="shell"
      resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all', searchEntries: 'mapped' }}
      title={profileText('terminalProfiles.settings.sectionTitle', 'Shell')}
      description={
        profileSupport
          ? profileText(
              'terminalProfiles.settings.sectionDescription',
              'Choose the Windows profile used for new local terminals.'
            )
          : profileText(
              'terminalProfiles.settings.legacySectionDescription',
              'The shell new terminals launch. Empty uses the system default.'
            )
      }
      isActive={isActive}
      searchEntries={Object.values(rows)}
    >
      {profileSupport ? <WindowsProfileControls rows={rows} /> : <LegacyShellControl rows={rows} />}
    </SettingsSection>
  )
}
