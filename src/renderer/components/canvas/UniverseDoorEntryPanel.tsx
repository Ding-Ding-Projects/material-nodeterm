import { useCallback, useMemo, useRef, useState } from 'react'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { useI18n } from '@renderer/lib/i18n'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'
import { formatText, t as resolveText, type FunnyLevel } from '@shared/i18n'
import { UNIVERSE_DOOR_ENTRY_CATALOG } from '@shared/i18n/universe-door-entry'
import {
  validateUniverseDoorEntrySubmission,
  type PortableUniverseDoorEntryV3,
  type UniverseDoorEntryMethod,
  type UniverseDoorEntrySubmission
} from '../../../core/universe-door-entry'
import { Button, SegmentedButton, TextField } from '@renderer/ui/md3'

export interface UniverseDoorEntryPanelProps {
  /** Safe schema 3 policy. It contains no credential values. */
  policy: PortableUniverseDoorEntryV3
  /** Destination is a caller-owned label and remains an exact fact in rendered copy. */
  destinationLabel: string
  busy?: boolean
  error?: string | null
  onSubmit: (submission: UniverseDoorEntrySubmission) => void
  onCancel: () => void
}

type LocalizedCopy = { primary: string; secondary: string | null }

function joinedCopy(copy: LocalizedCopy): string {
  return copy.secondary ? `${copy.primary} · ${copy.secondary}` : copy.primary
}

function safeFunnyLevel(value: number): FunnyLevel {
  return value >= 1 && value <= 5 && Number.isInteger(value) ? (value as FunnyLevel) : 1
}

/**
 * Guided portal credential entry. This component intentionally knows nothing about toy locks,
 * lockout credentials, or credential storage. The caller decides how a valid submission reaches
 * the local credential-vault adapter and how a successful answer changes the canvas.
 */
export function UniverseDoorEntryPanel({
  policy,
  destinationLabel,
  busy = false,
  error = null,
  onSubmit,
  onCancel
}: UniverseDoorEntryPanelProps): React.JSX.Element {
  const { mode, funnyLevelEn, funnyLevelYue } = useI18n()
  const vocab = useVocabularyMapper()
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const [method, setMethod] = useState<UniverseDoorEntryMethod>(policy.defaultMethod)
  const [value, setValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const levels = useMemo(
    () => ({ en: safeFunnyLevel(funnyLevelEn), yue: safeFunnyLevel(funnyLevelYue) }),
    [funnyLevelEn, funnyLevelYue]
  )
  const localize = useCallback(
    (id: string, fallback: string, params: Record<string, string> = {}): LocalizedCopy => {
      const resolved = resolveText(id, fallback, mode, levels, UNIVERSE_DOOR_ENTRY_CATALOG)
      const mapAndFormat = (text: string): string => formatText(vocab(text), params)
      return {
        primary: mapAndFormat(resolved.primary),
        secondary: resolved.secondary ? mapAndFormat(resolved.secondary) : null
      }
    },
    [levels, mode, vocab]
  )

  const title = localize('universeDoorEntry.title', 'Enter the door credential')
  const destination = localize('universeDoorEntry.destination', 'Destination: {destination}', {
    destination: destinationLabel
  })
  const description = localize(
    'universeDoorEntry.description',
    'Choose an enabled method and enter its credential to open this portal door.'
  )
  const searchLabel = localize('universeDoorEntry.search.label', 'Search entry methods')
  const searchPlaceholder = localize('universeDoorEntry.search.placeholder', 'Filter methods')
  const regexLabel = localize('universeDoorEntry.search.regex', 'Open regex builder for entry methods')
  const numericLabel = localize('universeDoorEntry.numericCode', 'Numeric code')
  const passphraseLabel = localize('universeDoorEntry.passphrase', 'Passphrase')
  const searchLabelText = joinedCopy(searchLabel)
  const searchPlaceholderText = joinedCopy(searchPlaceholder)
  const regexLabelText = joinedCopy(regexLabel)
  const numericLabelText = joinedCopy(numericLabel)
  const passphraseLabelText = joinedCopy(passphraseLabel)
  const methods = useMemo(
    () =>
      policy.methods.map((entryMethod) => {
        if (entryMethod === 'numeric-code') {
          const hint = localize(
            'universeDoorEntry.numericHint',
            'Enter exactly {digits} digits. The value stays on this computer.',
            { digits: String(policy.numericCodeDigits) }
          )
          return {
            value: entryMethod,
            label: numericLabelText,
            description: joinedCopy(hint)
          }
        }
        const hint = localize(
          'universeDoorEntry.passphraseHint',
          'Enter at least {length} characters. The value stays on this computer.',
          { length: String(policy.passphraseMinLength) }
        )
        return {
          value: entryMethod,
          label: passphraseLabelText,
          description: joinedCopy(hint)
        }
      }),
    [localize, numericLabelText, passphraseLabelText, policy.methods, policy.numericCodeDigits, policy.passphraseMinLength]
  )
  const visibleMethods = useMemo(
    () => methods.filter((entry) => search.test(`${entry.label} ${entry.description}`)),
    [methods, search]
  )
  const selectedVisible = visibleMethods.some((entry) => entry.value === method)
  const activeMethod = methods.find((entry) => entry.value === method) ?? methods[0]
  const submitLabel = localize('universeDoorEntry.submit', 'Open door')
  const submittingLabel = localize('universeDoorEntry.submitting', 'Opening door…')
  const cancelLabel = localize('universeDoorEntry.cancel', 'Cancel')
  const noMethod = localize('universeDoorEntry.noMethod', 'No enabled entry method matches this search.')
  const invalidSearch = localize(
    'universeDoorEntry.invalidSearch',
    'This pattern is invalid. Showing all enabled methods.'
  )

  const methodOptions = visibleMethods.map((entry) => ({ value: entry.value, label: entry.label }))
  const handleSubmit = (): void => {
    if (!activeMethod || !selectedVisible) return
    const result = validateUniverseDoorEntrySubmission(policy, { method, value })
    if (!result.valid) {
      const key =
        result.code === 'method-unavailable'
          ? 'universeDoorEntry.validation.method'
          : result.code === 'numeric-code-required'
            ? 'universeDoorEntry.validation.numericRequired'
            : result.code === 'numeric-code-shape'
              ? 'universeDoorEntry.validation.numericShape'
              : result.code === 'passphrase-required'
                ? 'universeDoorEntry.validation.passphraseRequired'
                : result.code === 'passphrase-too-short'
                  ? 'universeDoorEntry.validation.passphraseShort'
                  : 'universeDoorEntry.validation.passphraseLong'
      const params =
        result.code === 'numeric-code-shape'
          ? { digits: String(policy.numericCodeDigits) }
          : result.code === 'passphrase-too-short'
            ? { length: String(policy.passphraseMinLength) }
            : {}
      setValidationError(localize(key, result.message, params).primary)
      return
    }
    setValidationError(null)
    onSubmit(result.submission)
  }

  return (
    <section
      className="universe-door-entry"
      role="dialog"
      aria-label={title.primary}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <form
        className="universe-door-entry__form"
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
      <header className="universe-door-entry__header">
        <h2 className="universe-door-entry__title">{title.primary}</h2>
        {title.secondary && <p className="universe-door-entry__secondary">{title.secondary}</p>}
        <p className="universe-door-entry__destination">{destination.primary}</p>
        {destination.secondary && <p className="universe-door-entry__secondary">{destination.secondary}</p>}
        <p className="universe-door-entry__description">{description.primary}</p>
        {description.secondary && <p className="universe-door-entry__secondary">{description.secondary}</p>}
      </header>

      <div className="universe-door-entry__search">
        <TextField
          ref={searchRef}
          label={searchLabelText}
          value={search.value}
          placeholder={searchPlaceholderText}
          aria-label={searchLabelText}
          onChange={(event) => search.setValue(event.target.value)}
          trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchRef} label={regexLabelText} zIndex={94} />}
        />
        {search.error && <p className="universe-door-entry__search-error" role="status">{invalidSearch.primary}</p>}
      </div>

      {visibleMethods.length === 0 ? (
        <p className="universe-door-entry__empty" role="status">{noMethod.primary}</p>
      ) : (
        <>
          <SegmentedButton
            value={method}
            options={methodOptions}
            ariaLabel={searchLabelText}
            onChange={(next) => {
              setMethod(next)
              setValue('')
              setValidationError(null)
            }}
            className="universe-door-entry__methods"
          />
          {activeMethod && (
            <div className="universe-door-entry__form-field">
              {method === 'numeric-code' ? (
                <TextField
                  label={numericLabelText}
                  value={value}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={policy.numericCodeDigits}
                  aria-describedby="universe-door-entry-hint"
                  onChange={(event) => {
                    setValue(event.target.value)
                    setValidationError(null)
                  }}
                />
              ) : (
                <TextField
                  label={passphraseLabelText}
                  value={value}
                  type="password"
                  autoComplete="off"
                  maxLength={256}
                  aria-describedby="universe-door-entry-hint"
                  onChange={(event) => {
                    setValue(event.target.value)
                    setValidationError(null)
                  }}
                />
              )}
              <p id="universe-door-entry-hint" className="universe-door-entry__hint">
                {activeMethod.description}
              </p>
            </div>
          )}
        </>
      )}

      {(validationError || error) && (
        <p className="universe-door-entry__error" role="alert">{validationError ?? error}</p>
      )}
      <footer className="universe-door-entry__actions">
        <Button variant="text" onClick={onCancel} disabled={busy}>{cancelLabel.primary}</Button>
        <Button
          variant="filled"
          type="submit"
          disabled={busy || visibleMethods.length === 0 || !selectedVisible}
        >
          {busy ? joinedCopy(submittingLabel) : joinedCopy(submitLabel)}
        </Button>
      </footer>
      </form>
    </section>
  )
}
