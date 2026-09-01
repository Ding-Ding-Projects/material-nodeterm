import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/md3/Button'
import { Input } from '../ui/Input'
import { createPortal } from 'react-dom'
import { useDialogStack } from './dialog-stack'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

interface InputDialogProps {
  message: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Mask the input and turn off every convenience that would leak the value: a password typed
   *  here is a real credential (it opens an encrypted project file), so it must not be spell
   *  checked, autofilled, or offered as an autocomplete suggestion later. */
  password?: boolean
  /** Shown under the input in the error colour — a failed attempt, so the dialog stays open with
   *  the reason in it rather than closing and reporting elsewhere. */
  error?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * A small themed text-input dialog — the in-app replacement for `window.prompt`, which Electron
 * does not support (it throws "prompt() is and will not be supported"). Enter submits, Esc cancels.
 * Reuses the `.confirm*` shell styles; usually driven via the `promptDialog()` singleton helper.
 */
export function InputDialog({
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  password = false,
  error,
  onSubmit,
  onCancel
}: InputDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  // Personal-vocabulary boundary: the prompt's own copy only. `initialValue` and the typed value
  // are deliberately NOT mapped — that string is what the caller receives and usually persists
  // (a rename, a branch name), and rewriting it would write vocabulary words to disk.
  const vocab = useVocabularyMapper()
  // Registered in the modal stack so a ConfirmDialog underneath does not ALSO answer the Enter /
  // Escape typed into this input (its own listener is on `window`). The keys here are handled on
  // the input element itself, so nothing else is needed.
  useDialogStack()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm" onClick={(e) => e.stopPropagation()}>
        <p className="confirm__msg">{vocab(message)}</p>
        <Input
          ref={inputRef}
          className="confirm__input"
          vocabularyMode="factual"
          type={password ? 'password' : 'text'}
          autoComplete={password ? 'off' : undefined}
          value={value}
          placeholder={vocab(placeholder)}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit(value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        {error ? (
          <p className="confirm__error" role="alert">
            {vocab(error)}
          </p>
        ) : null}
        <div className="confirm__actions">
          <Button variant="outlined" className="confirm__btn" vocabularyMode="factual" onClick={onCancel}>
            {vocab(cancelLabel)}
          </Button>
          <Button className="confirm__btn primary" vocabularyMode="factual" onClick={() => onSubmit(value)}>
            {vocab(confirmLabel)}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
