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
  /** Override the popover's stacking order — needed when the field lives inside something with
   *  its own elevated z-index (a ContextMenu opened at z 80, say): the popover must paint ABOVE
   *  the surface it's anchored inside of, or it renders invisible behind it. */
  zIndex?: number
}

/** Preferred popover width — the builder's real content (a 3-column token palette / pattern+
 *  sample / matches+explanation layout) needs far more room than a typical anchored popover.
 *  `md3-regex-popover` in styles.md3.css re-clamps this responsively (`min(920px, 100vw-32px)`)
 *  so a narrow window still gets a usable, viewport-bounded popover rather than one that hangs off
 *  the screen edge; this number is only the pre-measurement estimate AnchoredPopover's own layout
 *  math falls back to before it can read the real rendered width off the DOM. */
const BUILDER_POPOVER_WIDTH = 920

/**
 * The default, non-modal way a search field offers the regex builder: a small `.*` toggle beside
 * the field that opens the FULL builder anchored right next to it — never a separate page or a
 * global dialog. One builder instance per field; nothing here is shared across fields.
 */
export function AnchoredRegexBuilder({ search, fieldRef, label, zIndex }: AnchoredRegexBuilderProps): React.JSX.Element {
  const ownTriggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const anchor = (fieldRef as RefObject<HTMLElement>) ?? ownTriggerRef

  return (
    <>
      <button
        ref={ownTriggerRef}
        type="button"
        className={`md3-regex-trigger${search.mode === 'regex' ? ' md3-regex-trigger--active' : ''}`}
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
      <AnchoredPopover
        anchorRef={anchor}
        open={open}
        onClose={() => setOpen(false)}
        width={BUILDER_POPOVER_WIDTH}
        className="md3-regex-popover"
        zIndex={zIndex}
      >
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
