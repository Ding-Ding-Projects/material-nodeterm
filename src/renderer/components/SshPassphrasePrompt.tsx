import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogStack } from './dialog-stack'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

interface SshPassphrasePromptProps {
  identityFile: string
  retry: boolean
  /** `user@host` this unlock is for, when main could name it (see SshPassphraseRequest). */
  target?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** Basename of a local identity file path, for the prompt message. */
function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed
}

/**
 * Passphrase prompt for an SSH ControlMaster's encrypted identity file (the SSH_ASKPASS relay in
 * ssh-project.ts / ssh-askpass.ts). Mounted once at the Canvas level, not inside
 * SshProjectDialog: the ControlMaster watchdog and the powerMonitor resume-reconnect path can
 * trigger a prompt long after the "Connect over SSH…" dialog has closed.
 */
export function SshPassphrasePrompt({ identityFile, retry, target, onSubmit, onCancel }: SshPassphrasePromptProps) {
  const [value, setValue] = useState('')
  const map = useVocabularyMapper()
  const identityName = baseName(identityFile)

  const submit = useCallback(() => {
    if (!value) return
    onSubmit(value)
  }, [value, onSubmit])

  // Registered in the modal stack so a dialog underneath does not ALSO answer the Enter / Escape
  // typed here (its listener is on `window`). Keys are handled on the input itself, which is
  // autoFocused, so this needs no window listener of its own — one had both firing, cancelling
  // twice on a single Escape. Same contract as InputDialog.
  useDialogStack()

  const heading = map(retry ? "That passphrase didn't work" : 'Passphrase required')
  const detail = retry
    ? mapOwnedSentence(map, [copy('Try again for '), fact(identityName), copy('.')])
    : mapOwnedSentence(map, [fact(identityName), copy(' is passphrase-protected.')])
  const targetDetail = target
    ? mapOwnedSentence(map, [copy(' Unlocking for '), fact(target), copy('.')])
    : ''
  const inputLabel = mapOwnedSentence(map, [copy('Passphrase for '), fact(identityName)])
  const cancelLabel = map('Cancel')
  const unlockLabel = map('Unlock')

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <p className="confirm__msg" style={{ fontWeight: 600 }}>
          {heading}
        </p>
        <p className="confirm__msg" style={{ opacity: 0.8 }}>
          {detail}
          {targetDetail}
        </p>
        <Input
          autoFocus
          type="password"
          autoComplete="off"
          spellCheck={false}
          // Named so a password manager can offer the right entry, and so the field is not
          // mistaken for a login form: this unlocks a local key file, it is not a server credential.
          vocabularyMode="factual"
          aria-label={inputLabel}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // preventDefault so the key is consumed here rather than bubbling to a sibling modal's
            // window listener (InputDialog:53-59 does the same).
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          className="my-2 mb-3.5 w-full"
        />
        <div className="confirm__actions">
          <Button vocabularyMode="factual" onClick={onCancel}>{cancelLabel}</Button>
          <Button vocabularyMode="factual" variant="primary" onClick={submit} disabled={!value}>
            {unlockLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
