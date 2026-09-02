import { useRef, useState } from 'react'
import { usePersonalVocabulary } from '../../../state/personalVocabulary'
import { useSchoolMode } from '../../../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../../../lib/schoolModePolicy'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { useVocabularyMapper, useVocabularyTemplate } from '../../../lib/personalVocabulary/useVocabularyText'
import {
  VOCAB_MAX_ENTRIES,
  VOCAB_MAX_FILE_BYTES,
  VOCAB_MAX_KEY_LENGTH,
  VOCAB_MAX_VALUE_LENGTH
} from '../../../lib/personalVocabulary/schema'
import { Input } from '@renderer/ui/Input'

const ROWS = {
  upload: {
    title: 'Personal vocabulary',
    keywords: ['vocabulary', 'personal', 'json', 'upload', 'replace', 'terms', 'wording']
  }
}
const ENTRIES = Object.values(ROWS)

/** File-size limit as a human string, e.g. "256 KB". */
function humanBytes(n: number): string {
  return `${Math.round(n / 1024)} KB`
}

/**
 * Settings surface for the local personal-vocabulary upload. See docs/personal-vocabulary.md.
 * Always present (even with no file yet); fully OMITTED (not just disabled) while School mode
 * is on, per that mode's contract — a rendered-but-inert control here would be more confusing
 * than its absence, and the substitution itself is already suppressed while the mode is on.
 */
export function PersonalVocabularySection({ isActive }: { isActive: boolean }): React.JSX.Element | null {
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const status = usePersonalVocabulary((s) => s.status)
  const entryCount = usePersonalVocabulary((s) => s.entryCount)
  const lastError = usePersonalVocabulary((s) => s.lastError)
  const upload = usePersonalVocabulary((s) => s.upload)
  const clear = usePersonalVocabulary((s) => s.clear)
  const reject = usePersonalVocabulary((s) => s.reject)
  const beginRead = usePersonalVocabulary((s) => s.beginRead)
  const vocab = useVocabularyMapper()
  const loadedStatusLine = useVocabularyTemplate(
    `Loaded — {count} usable ${entryCount === 1 ? 'pair' : 'pairs'} applied to the app's own wording: Settings, dialogs and prompts, tooltips, notifications, the command palette, and the board and source-control menus.`,
    { count: String(entryCount) }
  )
  const description =
    "Upload a small JSON file of your own term → replacement pairs; they apply to the app's own wording only — never to your file paths, commands, terminal output, branch or commit names, or anything saved to disk. Nothing leaves this machine. Up to {maxEntries} entries, {keyLength}/{valueLength}-character keys/values, {fileSize} file size. See {docs} for the exact JSON shape."
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  if (
    !schoolModeAllowsOptionalFeatures({
      enabled: schoolModeEnabled,
      hydrated: schoolModeHydrated
    })
  )
    return null

  const handleFile = (file: File): void => {
    if (file.size > VOCAB_MAX_FILE_BYTES) {
      reject('The selected file is too large. Maximum size is 256 KB.')
      return
    }
    beginRead()
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      setBusy(false)
      const text = typeof reader.result === 'string' ? reader.result : ''
      upload(text)
      if (inputRef.current) inputRef.current.value = ''
    }
    reader.onerror = () => {
      setBusy(false)
      reject('The selected vocabulary file could not be read.')
      if (inputRef.current) inputRef.current.value = ''
    }
    reader.readAsText(file)
  }

  // The old copy said "across Settings labels", which was true when only FieldRow/SettingsSection
  // consumed the boundary. It now reaches the app's own wording generally, so the sentence has to
  // say so — a status line that under-reports the reach is how a user concludes a 41-entry file
  // "only replaced one thing". It says "usable pairs" rather than "terms replaced" for the same
  // honesty reason: this is how many rows of the uploaded file became substitutions (a dictionary
  // export's prose/documentation rows are skipped, see schema.ts), not how many hits occurred.
  // Keep dynamic facts out of the mapper. A vocabulary term such as "1" or "256" must not
  // rewrite a count or a format limit, and an exact validator error must never be rewritten.
  const statusLine =
    status === 'reading'
      ? vocab('Reading the selected vocabulary file…')
      : status === 'loaded'
      ? loadedStatusLine ?? ''
      : status === 'invalid'
        ? `${vocab('Rejected:')} ${lastError ?? vocab('the file did not match the expected format.')}`
        : vocab('No file loaded — original wording is shown everywhere.')
  return (
    <SettingsSection id="vocabulary" title="Personal vocabulary" isActive={isActive} searchEntries={ENTRIES}>
      <SearchableRow {...ROWS.upload}>
        <FieldRow
          label="Local vocabulary file"
          description={description}
          descriptionParams={{
            maxEntries: VOCAB_MAX_ENTRIES.toLocaleString(),
            keyLength: String(VOCAB_MAX_KEY_LENGTH),
            valueLength: String(VOCAB_MAX_VALUE_LENGTH),
            fileSize: humanBytes(VOCAB_MAX_FILE_BYTES),
            docs: 'docs/personal-vocabulary.md'
          }}
          htmlFor="personal-vocabulary-file"
          control={
            <div className="flex flex-col items-end gap-2">
              {/* The input itself is visually hidden and driven by a real MD3 button. A native
                  `<Input vocabularyMode="factual" type="file">` renders the browser's own "Choose File / No file chosen"
                  control, which no amount of `file:` styling makes part of the design system --
                  it was the one element on this screen drawn entirely by Chromium. The input
                  keeps its id and label so the FieldRow's `htmlFor` and screen readers are
                  unchanged. */}
              <Input vocabularyMode="factual"
                ref={inputRef}
                id="personal-vocabulary-file"
                type="file"
                accept="application/json,.json"
                aria-label={vocab('Choose a personal vocabulary JSON file')}
                disabled={busy}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                }}
              />
              <Button
                variant="default"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {vocab(status === 'reading' ? 'Reading file…' : status === 'loaded' ? 'Replace file' : 'Choose file')}
              </Button>
              {status === 'loaded' ? (
                <Button
                  onClick={() => {
                    clear()
                  }}
                >
                  {vocab('Clear')}
                </Button>
              ) : null}
            </div>
          }
        />
        {status === 'invalid' ? (
          <p className="text-[12px] leading-relaxed text-danger" role="alert">
            {statusLine}
          </p>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted-2">{statusLine}</p>
        )}
      </SearchableRow>
    </SettingsSection>
  )
}
