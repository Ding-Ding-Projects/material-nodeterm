import { useCallback, useEffect, useState } from 'react'
import type { SpeechModelInfo } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { hasSpeechModel, modelAfterDelete, modelAfterDownload, SPEECH_MODEL_NONE } from '@shared/speech'
import { dictationBinding } from '../../../lib/keybindingOverrides'
import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Select } from '@renderer/ui/Select'
import { Radio } from '@renderer/ui/md3'
import { SegmentedPill } from '@renderer/ui/SegmentedPill'
import { Button } from '@renderer/ui/Button'
import { formatShortcut, isHoldChord } from '@shared/shortcut'
import { ShortcutCaptureField } from '../ShortcutCaptureField'
import type { SettingsSectionId } from '../nav'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

const ROWS = {
  engine: {
    title: 'Speech engine',
    keywords: ['speech', 'dictation', 'whisper', 'cloud', 'engine', 'voice', 'microphone']
  },
  shortcut: {
    title: 'Dictation shortcut',
    keywords: ['shortcut', 'dictation', 'hotkey', 'keybinding', 'press-to-talk', 'microphone']
  },
  models: {
    title: 'Whisper models',
    keywords: [
      'whisper',
      'model',
      'download',
      'delete',
      'tiny',
      'base',
      'small',
      'large',
      'pro',
      'none',
      'off',
      'disable',
      'no dictation'
    ]
  },
  language: {
    title: 'Language',
    keywords: [
      'language',
      'locale',
      'auto',
      'english',
      'turkish',
      'german',
      'french',
      'spanish',
      'japanese'
    ]
  }
}
const ENTRIES = Object.values(ROWS)

/**
 * Dictation (desktop/server): engine, model, language, and the press/hold-to-talk shortcut.
 * The ShortcutCaptureField is the shared settings capture control (also used by Keyboard
 * Shortcuts); here it is wired hold-to-talk-capable (`allowChord`) with the speech default.
 */
const LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Turkish' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'ja', label: 'Japanese' }
]

/** `1600` -> `"1.6 GB"`, `142` -> `"142 MB"`. Used for both the approximate (undownloaded) and
 *  real (downloaded) size, so the two read consistently in the same row. */
function formatSize(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/** `large-v3-turbo` -> `"Large V3 Turbo"`. */
function modelLabel(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function SpeechSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  // The chord's single source is the registry override (`speech.shortcut` is only the legacy
  // downgrade mirror), and a string selector keeps an unrelated settings write from re-rendering
  // this section. `''` = the user disabled dictation's shortcut.
  const dictationChord = useSettings(() => dictationBinding())
  const isPremium = useEntitlement((s) => s.isPremium)

  const [models, setModels] = useState<SpeechModelInfo[]>([])
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [rowError, setRowError] = useState<Record<string, string>>({})

  // Returns the fresh list as well as storing it: a caller that has just downloaded or deleted
  // needs to decide the selection from the POST-change state, and `models` is a render behind.
  const refreshModels = useCallback(async (): Promise<SpeechModelInfo[]> => {
    try {
      const next = await window.nodeTerminal.speech.models()
      setModels(next)
      return next
    } catch {
      // leave the last-known list on a transient read error
      return []
    }
  }, [])

  // Fetch once on mount (this component always renders — SettingsSection just hides its own
  // subtree when inactive — so this isn't re-run on every tab switch).
  useEffect(() => {
    void refreshModels()
  }, [refreshModels])

  // Subscribe on mount, unsubscribe on unmount; a completed download (pct 100) refreshes the
  // model list so the row flips to "downloaded" with its real on-disk size.
  useEffect(() => {
    const unsub = window.nodeTerminal.speech.onProgress(({ id, pct }) => {
      setProgress((p) => ({ ...p, [id]: pct }))
      if (pct >= 100) {
        setProgress((p) => {
          const next = { ...p }
          delete next[id]
          return next
        })
        setBusy((b) => ({ ...b, [id]: false }))
        void refreshModels()
      }
    })
    return unsub
  }, [refreshModels])

  const setEngine = (engine: 'whisper' | 'cloud'): void => {
    update({ speech: { ...settings.speech, engine } })
  }
  const setLanguage = (language: string): void => {
    update({ speech: { ...settings.speech, language } })
  }

  // No gate: every model is free to pick and free to download. The larger ones simply cost more
  // disk and more time to run, which the size on each row already tells the user.
  const selectModel = (m: SpeechModelInfo): void => {
    update({ speech: { ...settings.speech, model: m.id } })
  }

  const downloadModel = async (m: SpeechModelInfo): Promise<void> => {
    setRowError((e) => ({ ...e, [m.id]: '' }))
    setBusy((b) => ({ ...b, [m.id]: true }))
    setProgress((p) => ({ ...p, [m.id]: 0 }))
    try {
      await window.nodeTerminal.speech.downloadModel(m.id)
      const fresh = await refreshModels()
      // Downloading is not selecting — but the setting defaults to `tiny`, so someone whose first
      // download is `base` is left pointed at a model that is not on disk, and dictation fails.
      // `modelAfterDownload` adopts the fresh one only when the current pick has nothing behind
      // it, so an already-working choice is never taken away by trying a second model.
      // Read the settings back from the store, not the render scope: a download takes minutes,
      // and this closure's `settings` is a snapshot from before it started.
      const live = useSettings.getState().settings.speech
      const adopt = modelAfterDownload(fresh, live.model, m.id)
      if (adopt) update({ speech: { ...live, model: adopt } })
    } catch (err) {
      setRowError((e) => ({
        ...e,
        [m.id]: err instanceof Error ? err.message : 'Download failed.'
      }))
    } finally {
      setBusy((b) => ({ ...b, [m.id]: false }))
      setProgress((p) => {
        const next = { ...p }
        delete next[m.id]
        return next
      })
    }
  }

  const deleteModel = async (m: SpeechModelInfo): Promise<void> => {
    setRowError((e) => ({ ...e, [m.id]: '' }))
    setBusy((b) => ({ ...b, [m.id]: true }))
    try {
      await window.nodeTerminal.speech.deleteModel(m.id)
      const fresh = await refreshModels()
      // Deleting the selected model leaves the same dangling pointer a first download does.
      const live = useSettings.getState().settings.speech
      const adopt = modelAfterDelete(fresh, live.model)
      if (adopt) update({ speech: { ...live, model: adopt } })
    } catch (err) {
      setRowError((e) => ({ ...e, [m.id]: err instanceof Error ? err.message : 'Delete failed.' }))
    } finally {
      setBusy((b) => ({ ...b, [m.id]: false }))
    }
  }

  return (
    <SettingsSection
      id="speech"
      title="Speech"
      description="Dictate into any terminal or chat node. Local Whisper runs fully on-device — nothing leaves this machine."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.engine}>
        <FieldRow
          label="Engine"
          description="Local Whisper transcribes on-device. Cloud requires the nodeterm backend · not available yet."
          control={
            <SegmentedPill<'whisper' | 'cloud'>
              value={settings.speech.engine}
              ariaLabel="Speech engine"
              options={[
                { value: 'whisper', label: 'Local Whisper' },
                { value: 'cloud', label: 'Cloud' }
              ]}
              onChange={setEngine}
            />
          }
        />
      </SearchableRow>

      <SearchableRow {...ROWS.shortcut}>
        <FieldRow
          label="Shortcut"
          description="Dictation's shortcut is managed with every other keyboard shortcut."
          note={
            dictationChord === ''
              ? 'Currently disabled.'
              : isHoldChord(dictationChord)
                ? `Currently hold-to-talk: hold ${formatShortcut(dictationChord, isMac)}.`
                : `Currently toggle: press ${formatShortcut(dictationChord, isMac)}.`
          }
          control={
            <Button variant="ghost" onClick={() => onNavigate('shortcuts')}>
              Open Keyboard Shortcuts
            </Button>
          }
          control={
            <ShortcutCaptureField
              value={settings.speech.shortcut}
              onChange={setShortcut}
              defaultValue={DEFAULT_SHORTCUT}
              allowChord
            />
          }
        />
      </SearchableRow>

      <SearchableRow {...ROWS.models}>
        <div className="space-y-3">
          <h4 className="text-[13px] font-medium text-text"><SettingsText>Whisper models</SettingsText></h4>
          {models.length === 0 ? (
            <p className="text-[12px] text-muted"><SettingsText>Loading models…</SettingsText></p>
          ) : (
            <div className="space-y-2">
              {/* The honest off switch (issue #143): dictation is optional, and None is a real row
                  in the same radio group — not a missing selection the heal helpers would fix. */}
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <Radio
                    name="speech-model"
                    className="shrink-0"
                    checked={!hasSpeechModel(settings.speech.model)}
                    onChange={() => update({ speech: { ...settings.speech, model: SPEECH_MODEL_NONE } })}
                  />
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-text">None</span>
                    <p className="text-[12px] text-muted">
                      Dictation off — the shortcut and the Dock mic explain instead of recording.
                      Downloading a model below turns it on.
                    </p>
                  </div>
                </label>
              </div>
              {models.map((m) => {
                const pct = progress[m.id]
                const downloading = busy[m.id] && pct !== undefined
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <Radio
                        name="speech-model"
                        checked={settings.speech.model === m.id}
                        onChange={() => selectModel(m)}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text">
                            {modelLabel(m.id)}
                          </span>
                        </div>
                        <p className="text-[12px] text-muted">
                          {m.downloaded ? formatSize(m.sizeMB ?? m.approxMB) : `~${formatSize(m.approxMB)}`}
                          {downloading ? ` · downloading ${pct}%` : ''}
                        </p>
                        {rowError[m.id] ? (
                          <p className="text-[12px]" style={{ color: '#ff9f0a' }}>
                            {rowError[m.id]}
                          </p>
                        ) : null}
                      </div>
                    </label>
                    <div className="flex shrink-0 items-center gap-2">
                      {m.downloaded ? (
                        <Button
                          variant="ghost"
                          disabled={busy[m.id]}
                          onClick={() => void deleteModel(m)}
                        >
                          Delete
                        </Button>
                      ) : (
                        <Button disabled={busy[m.id]} onClick={() => void downloadModel(m)}>
                          {downloading ? `${pct}%` : 'Download'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.language}>
        <FieldRow
          label="Language"
          description="A hint for transcription; auto-detect works well for mixed speech."
          control={
            <Select
              aria-label="Speech language"
              value={settings.speech.language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          }
        />
      </SearchableRow>
    </SettingsSection>
  )
}
