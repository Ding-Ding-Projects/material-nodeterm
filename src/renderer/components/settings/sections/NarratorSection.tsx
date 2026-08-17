import { useEffect, useState } from 'react'
import { useSettings } from '../../../state/settings'
import { useSchoolMode } from '../../../state/schoolMode'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { Select } from '@renderer/ui/Select'
import { SegmentedPill } from '@renderer/ui/SegmentedPill'
import { Button } from '@renderer/ui/Button'
import {
  isSynthesisAvailable,
  previewVoice,
  stopNarrator,
  subscribeVoices,
  voiceStatus,
  voicesForTrack,
  type NarratorTrack
} from '@renderer/lib/narrator'
import { schoolModeAllowsOptionalFeatures } from '@renderer/lib/schoolModePolicy'
import { executeNarratorPreview } from '@renderer/canvas/narration-policy'
import type { NarratorLanguage } from '@shared/types'

const ROWS = {
  enabled: {
    title: 'Speak app events aloud',
    keywords: ['narrator', 'narration', 'speak', 'speech', 'tts', 'text to speech', 'voice', 'announce', 'read aloud']
  },
  language: {
    title: 'Narrated language',
    keywords: ['narrator', 'language', 'english', 'cantonese', 'both', 'bilingual']
  },
  voiceEn: {
    title: 'English voice',
    keywords: ['narrator', 'voice', 'english', 'tts', 'automatic']
  },
  voiceYue: {
    title: 'Cantonese voice',
    keywords: ['narrator', 'voice', 'cantonese', 'yue', 'zh-hk', 'hong kong', 'tts', 'automatic']
  },
  delivery: {
    title: 'Rate & pitch',
    keywords: ['narrator', 'rate', 'pitch', 'speed', 'tts']
  }
}
const ENTRIES = Object.values(ROWS)
const ENGLISH_ONLY_ENTRIES = [ROWS.enabled, ROWS.voiceEn, ROWS.delivery]

const LANGUAGE_OPTIONS: { value: NarratorLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'yue', label: 'Cantonese' },
  { value: 'both', label: 'Both' }
]

/** Live platform voice list for one track, handling the late-arrival trap: `getVoices()` often
 *  answers empty on the first call and fills in behind `voiceschanged` a moment later. `ready`
 *  flips true once we've seen a non-empty list, or after a short grace period — so a genuinely
 *  voice-less platform still resolves to "no voices installed" instead of spinning forever. */
function useTrackVoices(track: NarratorTrack): { voices: SpeechSynthesisVoice[]; ready: boolean } {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => voicesForTrack(track))
  const [ready, setReady] = useState(() => voicesForTrack(track).length > 0)
  useEffect(() => {
    const unsub = subscribeVoices(() => {
      const list = voicesForTrack(track)
      setVoices(list)
      if (list.length > 0) setReady(true)
    })
    const grace = setTimeout(() => setReady(true), 1800)
    return () => {
      unsub()
      clearTimeout(grace)
    }
  }, [track])
  return { voices, ready }
}

function VoicePicker({
  track,
  label,
  voiceURI,
  rate,
  pitch,
  disabled,
  onChange
}: {
  track: NarratorTrack
  label: string
  voiceURI: string | null
  rate: number
  pitch: number
  disabled: boolean
  onChange: (voiceURI: string | null) => void
}): React.JSX.Element {
  const { voices, ready } = useTrackVoices(track)
  const status = voiceStatus(voiceURI, track)
  return (
    <FieldRow
      label={label}
      description={
        track === 'yue'
          ? 'Prefers a Hong Kong Cantonese (zh-HK) voice when choosing automatically.'
          : undefined
      }
      control={
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <Select
              disabled={disabled}
              aria-label={label}
              className="w-56"
              value={voiceURI ?? ''}
              onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">Choose automatically</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}
                  {v.localService ? '' : ', network'})
                </option>
              ))}
            </Select>
            <Button
              onClick={() => {
                // A shared-mode update can land after this button's click was queued but before
                // React removes the Cantonese picker. Re-check at the speech boundary so a stale
                // control cannot preview the capability School Mode just suppressed.
                if (!disabled) {
                  executeNarratorPreview(track, useSchoolMode.getState, () => {
                    previewVoice(track, voiceURI, rate, pitch)
                  })
                }
              }}
              disabled={disabled || !status.voice}
              title={status.voice ? 'Play a short sample' : 'No voice available to preview'}
            >
              Preview
            </Button>
          </div>
          <p className="max-w-xs text-right text-[12px] leading-snug text-muted">
            {!ready
              ? 'Looking for installed voices…'
              : status.noVoiceForTrack
                ? `No ${track === 'yue' ? 'Cantonese' : 'English'} voice is installed on this computer.`
                : status.missingChosen
                  ? `Your chosen voice isn't installed here — falling back to “${status.voice?.name}”. Your choice is kept.`
                  : status.networkOnly
                    ? `Will speak with “${status.voice?.name}” — needs a network connection, and will go quiet offline.`
                    : `Will speak with “${status.voice?.name}” (${status.voice?.lang}).`}
          </p>
        </div>
      }
    />
  )
}

export function NarratorSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const narratorEnabled = useSettings((s) => s.settings.narratorEnabled)
  const narratorLanguage = useSettings((s) => s.settings.narratorLanguage)
  const narratorVoiceEn = useSettings((s) => s.settings.narratorVoiceEn)
  const narratorVoiceYue = useSettings((s) => s.settings.narratorVoiceYue)
  const narratorRate = useSettings((s) => s.settings.narratorRate)
  const narratorPitch = useSettings((s) => s.settings.narratorPitch)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const update = useSettings((s) => s.update)
  const available = isSynthesisAvailable()
  const narratorControlsDisabled = !narratorEnabled || !available
  const cantoneseAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  const updateCantoneseIfAllowed = (patch: Parameters<typeof update>[0]): void => {
    if (schoolModeAllowsOptionalFeatures(useSchoolMode.getState())) update(patch)
  }

  return (
    <SettingsSection
      id="narrator"
      title="Narrator"
      description="A spoken narrator for app events — a turn finishing, an agent needing you, or an error. Off by default."
      isActive={isActive}
      searchEntries={cantoneseAllowed ? ENTRIES : ENGLISH_ONLY_ENTRIES}
    >
      {!available && (
        <p className="text-[13px] text-[color:var(--warn)]">
          Speech synthesis isn't available in this window, so the narrator can't speak here.
        </p>
      )}
      <SearchableRow {...ROWS.enabled}>
        <FieldRow
          label="Speak app events aloud"
          description="Speaks a short line when an agent finishes, needs your attention, or hits an error. Coexists with sound effects and notifications — it doesn't replace them."
          control={
            <Switch
              checked={narratorEnabled}
              ariaLabel="Speak app events aloud"
              onChange={(on) => {
                update({ narratorEnabled: on })
                if (!on) stopNarrator()
              }}
            />
          }
        />
      </SearchableRow>
      <fieldset
        disabled={narratorControlsDisabled}
        ref={(element) => {
          // React 18's DOM typings predate `inert`, but Chromium/Electron implement it. Keep the
          // native disabled fieldset for form controls and inert the whole subtree for any future
          // focusable non-form descendant.
          element?.toggleAttribute('inert', narratorControlsDisabled)
        }}
        className={
          'm-0 min-w-0 space-y-5 border-0 p-0' +
          (narratorEnabled && available ? '' : ' pointer-events-none opacity-40')
        }
        aria-disabled={narratorControlsDisabled}
        data-narrator-controls=""
      >
        {cantoneseAllowed && (
          <SearchableRow {...ROWS.language}>
            <FieldRow
              label="Narrated language"
              description="“Both” speaks the English line, then the Cantonese line — one after the other, never overlapping."
              control={
                <SegmentedPill
                  ariaLabel="Narrated language"
                  value={narratorLanguage}
                  options={LANGUAGE_OPTIONS}
                  onChange={(v) => updateCantoneseIfAllowed({ narratorLanguage: v })}
                />
              }
            />
          </SearchableRow>
        )}
        <SearchableRow {...ROWS.voiceEn}>
          <VoicePicker
            track="en"
            label="English voice"
            voiceURI={narratorVoiceEn}
            rate={narratorRate}
            pitch={narratorPitch}
            disabled={narratorControlsDisabled}
            onChange={(v) => update({ narratorVoiceEn: v })}
          />
        </SearchableRow>
        {cantoneseAllowed && (
          <SearchableRow {...ROWS.voiceYue}>
            <VoicePicker
              track="yue"
              label="Cantonese voice"
              voiceURI={narratorVoiceYue}
              rate={narratorRate}
              pitch={narratorPitch}
              disabled={narratorControlsDisabled}
              onChange={(v) => updateCantoneseIfAllowed({ narratorVoiceYue: v })}
            />
          </SearchableRow>
        )}
        <SearchableRow {...ROWS.delivery}>
          {/* SpeechSynthesisUtterance documents rate as 0.1–10 and pitch as 0–2; the sliders cap
              at a usable window (0.5x–3x rate, 0–2x pitch) rather than exposing the full range,
              but `narrator.ts` clamps to the full documented range regardless of how a value got
              into settings.json (it's hand-editable). 100% = the voice's own normal delivery. */}
          <FieldRow
            label="Rate"
            control={
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={50}
                  max={300}
                  step={5}
                  value={Math.round(narratorRate * 100)}
                  aria-label="Narrator speech rate"
                  onChange={(e) => update({ narratorRate: Number(e.target.value) / 100 })}
                  className="w-40 accent-[var(--accent)]"
                />
                <span className="w-10 text-right text-[12px] text-muted tabular-nums">
                  {Math.round(narratorRate * 100)}%
                </span>
              </div>
            }
          />
          <FieldRow
            label="Pitch"
            control={
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={Math.round(narratorPitch * 100)}
                  aria-label="Narrator pitch"
                  onChange={(e) => update({ narratorPitch: Number(e.target.value) / 100 })}
                  className="w-40 accent-[var(--accent)]"
                />
                <span className="w-10 text-right text-[12px] text-muted tabular-nums">
                  {Math.round(narratorPitch * 100)}%
                </span>
              </div>
            }
          />
        </SearchableRow>
      </fieldset>
    </SettingsSection>
  )
}
