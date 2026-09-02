import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject
} from 'react'
import { AnchoredPopover } from '../../ui/AnchoredPopover'
import { RegexBuilder } from './RegexBuilder'
import type { RegexBuilderBinding } from '../../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'
import { Chip } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

interface AnchoredRegexBuilderProps {
  search: RegexBuilderBinding
  /** The field this builder attaches to. Pass the SAME ref you gave the `<Input vocabularyMode="factual">` so the popover
   *  opens right beside it. */
  fieldRef?: RefObject<HTMLElement>
  /** Accessible label for the trigger button (defaults to a generic one — pass a field-specific
   *  label when several regex-capable fields exist on one screen, e.g. "Regex — Settings search"). */
  label?: string
  /** Override the popover's stacking order — needed when the field lives inside something with
   *  its own elevated z-index (a ContextMenu opened at z 80, say): the popover must paint ABOVE
   *  the surface it's anchored inside of, or it renders invisible behind it. */
  zIndex?: number
  /** Notifies a parent overlay while the builder owns keyboard focus. */
  onOpenChange?: (open: boolean) => void
  /** Incremented by an owning modal when Escape must close this portaled builder first. */
  closeSignal?: number
  /** Optional owner ref for the portaled popover, avoiding document-wide lookups. */
  popoverRef?: MutableRefObject<HTMLDivElement | null>
  /** Optional topmost-dialog predicate supplied by an owning modal. */
  ownsKeyboard?: () => boolean
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
export function AnchoredRegexBuilder({
  search,
  fieldRef,
  label,
  zIndex,
  onOpenChange,
  closeSignal,
  popoverRef,
  ownsKeyboard
}: AnchoredRegexBuilderProps): React.JSX.Element {
  const profileText = useLocalizedVocabularyText()
  const ownTriggerRef = useRef<HTMLButtonElement>(null)
  const ownPopoverRef = useRef<HTMLDivElement | null>(null)
  const popoverId = useId()
  const [open, setOpen] = useState(false)
  const vocab = useVocabularyMapper()
  const anchor = (fieldRef as RefObject<HTMLElement>) ?? ownTriggerRef
  const effectivePopoverRef = popoverRef ?? ownPopoverRef
  const triggerTitle = profileText(
    search.mode === 'regex' ? 'regex.trigger.activeTitle' : 'regex.trigger.openTitle',
    search.mode === 'regex' ? 'Regex mode: open the builder' : 'Switch to regex and open the builder'
  )
  const triggerLabel = label ?? profileText('regex.trigger.aria', 'Open regex builder')

  useLayoutEffect(() => {
    if (!open) return
    // The builder is portaled, so focus must cross the portal explicitly. Its first real control
    // is the pattern field when present, otherwise the first enabled button is the safest entry.
    const focusTarget = () => effectivePopoverRef.current
      ?.querySelector<HTMLElement>('.md3-regex-builder__pattern-input')
    focusTarget()?.focus()
    requestAnimationFrame(() => focusTarget()?.focus())
  }, [effectivePopoverRef, open])

  useEffect(() => {
    if (closeSignal === undefined || closeSignal === 0) return
    setOpen(false)
    onOpenChange?.(false)
  }, [closeSignal, onOpenChange])

  return (
    <>
      <Chip vocabularyMode="factual" selected={search.mode === 'regex'}
        ref={ownTriggerRef}
       
        className={`md3-regex-trigger${search.mode === 'regex' ? ' md3-regex-trigger--active' : ''}`}
        title={vocab(triggerTitle)}
        aria-label={vocab(triggerLabel)}
        aria-pressed={search.mode === 'regex'}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          if (search.mode !== 'regex') search.setMode('regex')
          setOpen(true)
          onOpenChange?.(true)
        }}
      >
        .*
      </Chip>
      <AnchoredPopover
        anchorRef={anchor}
        open={open}
        onClose={() => {
          if (ownsKeyboard && !ownsKeyboard()) return
          setOpen(false)
          onOpenChange?.(false)
        }}
        width={BUILDER_POPOVER_WIDTH}
        className="md3-regex-popover"
        zIndex={zIndex}
        contentRef={effectivePopoverRef}
        id={popoverId}
      >
        <RegexBuilder
          value={{ pattern: search.pattern, flags: search.flags }}
          onChange={(v) => {
            search.setValue(v.pattern)
            search.setFlags(v.flags)
          }}
          onDone={() => {
            if (ownsKeyboard && !ownsKeyboard()) return
            setOpen(false)
            onOpenChange?.(false)
          }}
          autoFocusPattern
        />
      </AnchoredPopover>
    </>
  )
}
