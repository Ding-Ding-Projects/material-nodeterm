// The one password/PIN input every lock surface uses, so the lock dialogs stop being two bare
// `<input type="password">` boxes with different bugs.
//
// What a password field owes the person typing into it, and what the previous ones did not give:
//
//   · A REVEAL toggle. Masked entry with no way to check is how a locked-out user is made, and it
//     matters most on exactly the credential that cannot be recovered.
//   · A CAPS LOCK warning. It is the single commonest cause of "the password is wrong" on a
//     credential that is, in fact, right, and the field is the only place that can see it.
//   · ENTER submits. Every one of these dialogs has a primary action, and a password field that
//     ignores Enter is a field people press Enter at anyway.
//
// The reveal is deliberately OFF by default and resets whenever the field is remounted: a revealed
// password is on screen for anyone behind the user, and for any capture the app itself takes.
import { useEffect, useId, useRef, useState } from 'react'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '../../lib/personalVocabulary/ownedCopy'

export function PasswordField({
  label,
  hint,
  value,
  onChange,
  onSubmit,
  autoFocus = false,
  numeric = false,
  autoComplete = 'current-password',
  disabled = false,
  inputRef
}: {
  label: string
  /** Small print under the field: what this credential is for, or what it must look like. */
  hint?: string
  value: string
  onChange: (value: string) => void
  /** Enter in the field runs this. Omit for a field that is not the last one before the action. */
  onSubmit?: () => void
  autoFocus?: boolean
  /** A Windows PIN: digits only, numeric keypad, and non-digits are refused as they are typed. */
  numeric?: boolean
  autoComplete?: 'current-password' | 'new-password' | 'off'
  disabled?: boolean
  inputRef?: React.RefObject<HTMLInputElement>
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [revealed, setRevealed] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const ownRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>
  const ref = inputRef ?? ownRef
  const id = useId()
  const labelText = vocab(label)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
    // Focus once on mount. Re-running on every render would steal focus back from the reveal
    // toggle the moment somebody used it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `getModifierState` is only available on a real keyboard event, so caps lock can only be read
  // while the user is actually typing here. That is the right moment anyway: a warning shown
  // before the field is touched is noise.
  const readCaps = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (typeof e.getModifierState === 'function') setCapsLock(e.getModifierState('CapsLock'))
  }

  return (
    <div className="toylock-field">
      <label className="toylock-field__label" htmlFor={id}>
        {labelText}
      </label>
      <div className="toylock-passwordfield">
        <input
          id={id}
          ref={ref}
          type={revealed ? 'text' : 'password'}
          inputMode={numeric ? 'numeric' : undefined}
          className="toylock-input toylock-passwordfield__input"
          value={value}
          disabled={disabled}
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
          onKeyUp={readCaps}
          onKeyDown={(e) => {
            readCaps(e)
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault()
              onSubmit()
            }
          }}
          onBlur={() => setCapsLock(false)}
        />
        <button
          type="button"
          className="toylock-passwordfield__reveal"
          // The accessible name says what the button DOES next, which is what a screen-reader user
          // needs, rather than describing the current state and leaving them to infer it.
          aria-label={mapOwnedSentence(vocab, [
            copy(revealed ? 'Hide ' : 'Show '),
            fact(labelText.toLowerCase())
          ])}
          aria-pressed={revealed}
          disabled={disabled}
          onClick={() => {
            setRevealed((v) => !v)
            ref.current?.focus()
          }}
        >
          {revealed ? '🙈' : '👁'}
        </button>
      </div>
      {capsLock && (
        <div className="toylock-field__warn" role="status">
          {vocab('Caps Lock is on.')}
        </div>
      )}
      {hint && <div className="toylock-field__hint">{vocab(hint)}</div>}
    </div>
  )
}
