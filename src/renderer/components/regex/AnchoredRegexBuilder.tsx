import { useRef, useState, type RefObject } from 'react'
import { AnchoredPopover } from '../../ui/AnchoredPopover'
import { RegexBuilder } from './RegexBuilder'
import type { RegexBuilderBinding } from '../../lib/regex/useRegexSearchField'

interface AnchoredRegexBuilderProps {
  search: RegexBuilderBinding
  /** The field this builder attaches to. Pass the SAME ref you gave the `<input>` so the popover
   *  opens right beside it. */
  fieldRef?: RefObject<HTMLElement>
  /** Accessible label for the trigger button (defaults to a generic one — pass a field-specific
   *  label when several regex-capable fields exist on one screen, e.g. "Regex — Settings search"). */
  label?: string
}

/**
 * The default, non-modal way a search field offers the regex builder: a small `.*` toggle beside
 * the field that opens the FULL builder anchored right next to it — never a separate page or a
 * global dialog. One builder instance per field; nothing here is shared across fields.
 */
export function AnchoredRegexBuilder({ search, fieldRef, label }: AnchoredRegexBuilderProps): React.JSX.Element {
  const ownTriggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const anchor = (fieldRef as RefObject<HTMLElement>) ?? ownTriggerRef

  return (
    <>
      <button
        ref={ownTriggerRef}
        type="button"
        className={`regex-trigger${search.mode === 'regex' ? ' active' : ''}`}
        title={search.mode === 'regex' ? 'Regex mode — open the builder' : 'Switch to regex and open the builder'}
        aria-label={label ?? 'Open regex builder'}
        aria-pressed={search.mode === 'regex'}
        onClick={() => {
          if (search.mode !== 'regex') search.setMode('regex')
          setOpen(true)
        }}
      >
        .*
      </button>
      <AnchoredPopover anchorRef={anchor} open={open} onClose={() => setOpen(false)}>
        <RegexBuilder
          value={{ pattern: search.pattern, flags: search.flags }}
          onChange={(v) => {
            search.setValue(v.pattern)
            search.setFlags(v.flags)
          }}
          onDone={() => setOpen(false)}
        />
      </AnchoredPopover>
    </>
  )
}
