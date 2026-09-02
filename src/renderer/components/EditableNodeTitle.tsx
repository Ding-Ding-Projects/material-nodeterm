import { useState } from 'react'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button } from '../ui/md3'
import { Input } from '../ui/Input'

/**
 * The one click-to-rename title control every node header uses.
 *
 * Before this component, four node kinds each hand-rolled the same click → input → Enter/Escape
 * dance (TerminalNode/StickyNode called their state `editingTitle`, ServiceNode called it
 * `editingLabel` — same behaviour, drifted spelling), and eight more kinds rendered a static
 * `data.title` with no rename affordance at all. This is the shared implementation: click (or
 * Enter/Space on the trigger button) opens an input seeded with the current value, Enter or blur
 * commits, Escape restores the value editing started with and does NOT commit.
 *
 * Deliberately excluded: **TerminalNode** keeps its own hand-written editing block. Its rename
 * is load-bearing beyond the label — committing flips `data.titleAuto` to false and pushes
 * `/rename <name>` into the live agent session (see `applyManualTitle`/`pushSessionRename` in
 * TerminalNode.tsx), and a `skipBlurRef` dance suppresses a double-commit from the blur that can
 * follow an Enter-triggered unmount. Reproducing that exactly through this component's own
 * commit/cancel callbacks was judged higher risk than leaving one call site alone; see
 * CLAUDE.md's node-rename entry for the reasoning.
 */
export interface EditableNodeTitleProps {
  /** The current value (`data.title`, `data.serviceLabel`, …) — this component is controlled. */
  value: string
  /** Called on every keystroke while editing, mirroring the "live" pattern the pre-existing
   *  Sticky/Service editors used (so a caller wired to `updateNodeData` sees the value change as
   *  it's typed, not only on commit). */
  onChange: (next: string) => void
  /** Called once editing ends with a value that actually differs from what editing started with
   *  (trimmed comparison) — never called for a no-op edit or for a rejected empty commit. */
  onCommit?: (value: string) => void
  /** Text shown on the display trigger when `value` is empty and not editing. */
  emptyLabel?: React.ReactNode
  /** Accessible name for the trigger button and the input. Falls back to "Rename". */
  ariaLabel?: string
  /** Tooltip on the trigger button. Defaults to "Click to rename". */
  title?: string
  /** Extra class(es) on the display trigger button — the input always gets `nodeAppend`-independent
   *  base styling via `term-node__title`. */
  triggerClassName?: string
  /** Base class on the display trigger, before `triggerClassName`. Defaults to the shared
   *  `term-node__title-text`; a caller with its own fully-specified trigger class (ServiceNode's
   *  `service-node__label-text` already resets button chrome and sets its own sizing) passes `''`
   *  so the two rule sets don't stack. */
  baseTriggerClassName?: string
  /** Extra class(es) on the `<input>` while editing. */
  inputClassName?: string
  /** When false (default true), an empty trimmed commit is accepted instead of reverted. Kept
   *  configurable because at least one caller (a free-text note) treats "" as a legitimate title. */
  rejectEmpty?: boolean
  /** `data-*` passthrough for the appearance editor's element picker (see CLAUDE.md's
   *  appearance-editor entry) — attached to the display trigger only. */
  appearanceId?: string
  /** Fires whenever the internal editing state flips, for a caller that needs to react to it
   *  outside this component — e.g. hiding a layout spacer that only exists to give the input its
   *  `flex: 1` room, or gating an external "don't overwrite while the user is typing" poll. */
  onEditingChange?: (editing: boolean) => void
}

/**
 * Click-to-rename title. See the module doc above for what this replaces and what it
 * deliberately does not touch (TerminalNode).
 */
export function EditableNodeTitle({
  value,
  onChange,
  onCommit,
  emptyLabel,
  ariaLabel,
  title = 'Click to rename',
  triggerClassName,
  baseTriggerClassName = 'term-node__title-text',
  inputClassName,
  rejectEmpty = true,
  appearanceId,
  onEditingChange
}: EditableNodeTitleProps) {
  const vocab = useVocabularyMapper()
  const [editing, setEditingState] = useState(false)
  const setEditing = (next: boolean) => {
    setEditingState(next)
    onEditingChange?.(next)
  }
  /** The value editing started with, so Escape can put it back and so a no-op edit (open, no
   *  change, close) never fires `onCommit` or a rename push in a caller that has one. */
  const [before, setBefore] = useState('')

  const startEdit = () => {
    setBefore(value)
    setEditing(true)
  }

  const finishEdit = (raw: string) => {
    setEditing(false)
    const trimmed = raw.trim()
    if (trimmed === before.trim()) return
    if (trimmed === '' && rejectEmpty) {
      // Empty is rejected by reverting the live value back to what editing started with — the
      // same "put it back" behaviour Escape uses, since an accepted empty title is usually a
      // typo (select-all + type-over) rather than a deliberate rename to nothing.
      onChange(before)
      return
    }
    onCommit?.(raw)
  }

  if (editing) {
    return (
      <Input
        vocabularyMode="factual"
        className={`mdx-input--bare term-node__title nodrag${inputClassName ? ` ${inputClassName}` : ''}`}
        value={value}
        spellCheck={false}
        autoFocus
        aria-label={vocab(ariaLabel ?? 'Rename')}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => finishEdit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            finishEdit((e.target as HTMLInputElement).value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onChange(before)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <Button
      variant="text"
      vocabularyMode="factual"
      className={`nodrag${baseTriggerClassName ? ` ${baseTriggerClassName}` : ''}${triggerClassName ? ` ${triggerClassName}` : ''}`}
      title={vocab(title)}
      aria-label={ariaLabel ? `${vocab(ariaLabel)}: ${value || 'untitled'}` : undefined}
      data-appearance-id={appearanceId}
      onClick={startEdit}
    >
      {value || (typeof emptyLabel === 'string' ? vocab(emptyLabel) : emptyLabel) || vocab('Untitled')}
    </Button>
  )
}
