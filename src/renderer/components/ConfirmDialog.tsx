import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { confirmKeyAction } from './confirm-key'
import { isTopDialog, nextDialogId, popDialog, pushDialog } from './dialog-stack'
import { useI18n } from '@renderer/lib/i18n'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'
import { Checkbox } from '@renderer/ui/md3'
import type { DisplaySegment } from '../lib/personalVocabulary/ownedCopy'
import { mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'

interface ConfirmDialogProps {
  message: string
  /** Typed mixed-copy path. Application prose is mapped, while exact names, paths, and ids stay
   * byte-identical inside the same confirmation sentence. */
  messageSegments?: readonly DisplaySegment[]
  /** Optional content rendered ABOVE the message (e.g. the remote-access ConsentNotice), so the
   *  human reads what they are granting before the SAS body + buttons. */
  body?: ReactNode
  /** The confirm action is in flight. Disables the confirm button AND makes Enter inert, so a
   *  second submit cannot re-run an irreversible action. A relabel alone is not enough: a
   *  disabled button is the visible guard, never the real one — a keyboard submit walks past
   *  it, which is exactly how a bulk run could be fired twice over the same rows. */
  busy?: boolean
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Nothing to decide — the dialog only REPORTS (an error, a "not ready yet"). Renders a single
   *  dismiss button instead of the destructive default pair: an error message offering
   *  "Cancel / Delete" reads as though dismissing it will delete something. */
  alert?: boolean
  /** An explicit opt-in shown above the buttons (e.g. "Delete the worktree directory from disk
   *  too"). The caller owns the value, so it can also swap the confirm label / danger styling. */
  option?: { label: string; checked: boolean; onChange: (checked: boolean) => void }
  /**
   * May Enter confirm this dialog? Default true — the user asked for it. Pass FALSE for a dialog
   * the app raised on someone ELSE's behalf (an agent verb like `close-worktree`): the user never
   * asked for it, it appeared under their hands, and it must be answered by an explicit click.
   * Escape still cancels either way.
   */
  enterConfirms?: boolean
  /**
   * When false, NEITHER button takes `autoFocus`. Default true (historical behavior). Pass false
   * for a dialog that appears under the user's hands (the capability clone notice): `autoFocus`
   * steals focus from whatever they were typing in, and their next Enter/Space then NATIVELY
   * activates the focused button — a path `enterConfirms`/confirm-key never sees, because the
   * browser's default button activation is not the window keydown listener.
   */
  autoFocusButtons?: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * When provided, Escape and an overlay click call THIS instead of `onCancel`, and the cancel
   * button remains the only path to `onCancel`. For a dialog where cancel is itself a recorded
   * ANSWER (the capability clone notice's "Turn it off"), a stray Escape aimed at a terminal or a
   * misclick outside the box must be a non-answer — close for now, decide nothing — not a
   * consent-recording cancel. Absent = historical behavior (dismissal cancels).
   */
  onDismiss?: () => void
}

/**
 * A small themed confirm dialog. Enter confirms and Esc cancels — but only under the conditions in
 * ./confirm-key, which exist because this listener is on `window` and therefore sees every key the
 * user aims at a terminal, a chat box or the command palette. Read that file before touching the
 * key handling: a stray Enter used to be able to delete a worktree.
 */
export function ConfirmDialog({
  message,
  messageSegments,
  body,
  busy = false,
  confirmLabel,
  cancelLabel,
  danger: dangerProp,
  alert = false,
  option,
  enterConfirms = true,
  autoFocusButtons = true,
  onConfirm,
  onCancel,
  onDismiss
}: ConfirmDialogProps) {
  // Escape / overlay-click land here: the caller's dismiss channel when it has one, else cancel.
  const dismiss = onDismiss ?? onCancel
  const { ts, emoji } = useI18n()
  // Personal-vocabulary boundary: every confirmation in the app funnels through this one
  // component, so translating here is what makes "are you sure" copy speak the user's words
  // everywhere instead of only on the Settings page. Applied to prose only — `body` is caller
  // JSX (it can contain a path or a SAS code) and is passed through untouched.
  //
  // Mixed sentences use `messageSegments` so a vocabulary term in a target name, path, revision,
  // or diagnostic cannot be rewritten. Legacy string callers still use the historical whole-copy
  // mapping, while new callers that disclose exact facts must use the typed path above.
  const vocab = useVocabularyMapper()
  // An alert has nothing destructive to warn about and nothing to cancel; anything else keeps the
  // historical destructive defaults ("Delete", danger styling, focus parked on the safe button).
  // Only the component's OWN defaults are localized here — a caller-supplied label (e.g. "Remove
  // worktree") is that caller's copy and passes through untouched.
  const danger = dangerProp ?? !alert
  const cancelText = vocab(cancelLabel ?? ts('dialog.confirm.cancel', 'Cancel'))
  const confirmText = vocab(confirmLabel ?? (alert ? ts('dialog.confirm.ok', 'OK') : ts('dialog.confirm.delete', 'Delete')))
  const messageText = messageSegments ? mapOwnedSentence(vocab, messageSegments) : vocab(message)
  const cancelText = cancelLabel ? vocab(cancelLabel) : ts('dialog.confirm.cancel', 'Cancel')
  const confirmText = confirmLabel
    ? vocab(confirmLabel)
    : alert
      ? ts('dialog.confirm.ok', 'OK')
      : ts('dialog.confirm.delete', 'Delete')
  const messageText = vocab(message)
  const optionLabel = vocab(option?.label)
  // Non-semantic decoration only (Settings → Language → "Show emojis…"): purely visual, never
  // part of the accessible name, and never a substitute for the message's actual words.
  const emojiChar = emoji(alert ? 'ℹ️' : danger ? '🗑️' : '❓')
  // One id per instance, for the lifetime of the component (mount order == paint order == stack).
  const idRef = useRef<string>()
  if (!idRef.current) idRef.current = nextDialogId()
  const id = idRef.current
  const boxRef = useRef<HTMLDivElement>(null)
  // Set once, on the first render — not in an effect, so a key that arrives before the effect runs
  // is still measured against the moment the dialog appeared.
  const mountedAtRef = useRef(Date.now())

  useEffect(() => {
    pushDialog(id)
    return () => popDialog(id)
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = confirmKeyAction({
        key: e.key,
        repeat: e.repeat,
        // Not the dialog on top → this key is not ours (the topmost dialog's own listener still has
        // to see it, so we must not preventDefault it either).
        top: isTopDialog(id),
        // Aimed HERE, not at whatever had focus when we appeared. `boxRef` is the dialog box, so a
        // key typed into a terminal underneath the overlay can never answer it.
        inDialog: !!(e.target instanceof Node && boxRef.current?.contains(e.target)),
        sinceMount: Date.now() - mountedAtRef.current,
        enterConfirms
      })
      if (!action) return
      e.preventDefault()
      if (action === 'confirm' && !busy) onConfirm()
      else dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, enterConfirms, onConfirm, dismiss, busy])

  return createPortal(
    <div className="confirm-overlay" onClick={dismiss}>
      <div className="confirm" ref={boxRef} onClick={(e) => e.stopPropagation()}>
        {body}
        <p className="confirm__msg">
          {emojiChar && (
            <span aria-hidden="true">
              {emojiChar}{' '}
            </span>
          )}
          {messageText}
        </p>
        {option && (
          <label className="confirm__option">
            <Checkbox
              checked={option.checked}
              onChange={(e) => option.onChange(e.target.checked)}
            />
            {optionLabel}
          </label>
        )}
        <div className="confirm__actions">
          {/* The DESTRUCTIVE button never takes focus: autoFocus on it is what turned a stray Enter
              (or Space) into a deletion. On a danger dialog the safe button is the focused one; on a
              harmless one the primary action may keep it. */}
          {!alert && (
            <button className="confirm__btn" autoFocus={autoFocusButtons && danger} onClick={onCancel}>
              {cancelText}
            </button>
          )}
          <button
            className={`confirm__btn${danger ? ' danger' : ' primary'}`}
            autoFocus={autoFocusButtons && !danger}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
