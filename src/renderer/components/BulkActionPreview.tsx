// The reviewable preview every bulk action shows before it runs — "say what will happen before it
// happens", and "distinguish '42 selected' from '39 will change' when some are skipped". Built on
// the app's existing ConfirmDialog so it gets the same keyboard/focus/dialog-stack behavior as
// every other confirmation in the app, rather than a bespoke modal.

import { ConfirmDialog } from './ConfirmDialog'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { copy, fact } from '../lib/personalVocabulary/ownedCopy'

export interface BulkActionPreviewProps<T> {
  title: string
  /** Set when the caller already mapped this application-owned action label. */
  titleAlreadyMapped?: boolean
  items: T[]
  describe: (item: T) => string
  excluded: { item: T; reason: string }[]
  destructive: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

const MAX_LISTED = 12

export function BulkActionPreview<T>({
  title,
  titleAlreadyMapped = false,
  items,
  describe,
  excluded,
  destructive,
  busy,
  onConfirm,
  onCancel
}: BulkActionPreviewProps<T>): JSX.Element {
  const vocab = useVocabularyMapper()
  const willChange = items.length
  const totalSelected = willChange + excluded.length
  const listed = items.slice(0, MAX_LISTED)
  const hiddenCount = items.length - listed.length

  const messageSegments = totalSelected === willChange
    ? [titleAlreadyMapped ? fact(title) : copy(title), copy(': '), fact(String(willChange)), copy(` item${willChange === 1 ? '' : 's'}.`)]
    : [titleAlreadyMapped ? fact(title) : copy(title), copy(': '), fact(String(willChange)), copy(' of '), fact(String(totalSelected)), copy(' selected will change.')]

  return (
    <ConfirmDialog
      message=""
      messageSegments={messageSegments}
      confirmLabel={busy ? 'Working…' : title}
      confirmLabelAlreadyMapped={titleAlreadyMapped && !busy}
      // The label alone never stopped a second submit — pass it through so the button disables.
      busy={busy}
      cancelLabel="Cancel"
      danger={destructive}
      // A pure-informational action (export) has nothing irreversible to gate behind Enter, so it
      // may still confirm on Enter; a destructive one requires the explicit click, same rule the
      // rest of the app's confirm dialogs follow.
      enterConfirms={!destructive}
      body={
        <div className="bulk-preview">
          {listed.length > 0 && (
            <ul className="bulk-preview__list">
              {listed.map((item, i) => (
                <li key={i}>{describe(item)}</li>
              ))}
                {hiddenCount > 0 && <li className="bulk-preview__more">+{hiddenCount} {vocab('more')}</li>}
            </ul>
          )}
          {excluded.length > 0 && (
            <div className="bulk-preview__excluded">
              <div className="bulk-preview__excluded-title">
                {excluded.length} {vocab('excluded — will NOT change:')}
              </div>
              <ul className="bulk-preview__list bulk-preview__list--excluded">
                {excluded.slice(0, MAX_LISTED).map(({ item, reason }, i) => (
                  <li key={i}>
                    {describe(item)} — <span className="bulk-preview__reason">{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
