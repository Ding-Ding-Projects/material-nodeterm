import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { rankQuickOpenFiles, type QuickOpenIndexedFile } from '../lib/quickOpenSearch'
import { IconEditor } from './icons'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'

/**
 * A row's LIVE, inline control — a setting result renders its own switch/select rather than a
 * label describing it, and changing it goes through the SAME setter (persistence, validation,
 * everything) the originating settings section uses. See docs/command-palette.md.
 */
export type CommandControl =
  | { type: 'toggle'; checked: boolean; onToggle: (v: boolean) => void; ariaLabel?: string }
  | {
      type: 'select'
      value: string
      options: { label: string; value: string }[]
      onChange: (v: string) => void
      ariaLabel?: string
    }

export interface Command {
  id: string
  label: string
  /** Right-aligned metadata that IS part of the search corpus (e.g. a file's directory). */
  hint?: string
  /**
   * Right-aligned metadata that is NOT searchable — a reason, not a key. A disabled affordance still
   * has to say why (worktrees on an SSH project), and putting that sentence in `hint` fed it to the
   * fuzzy matcher, so the row answered queries like "ssh" or "supported". Shown when `hint` is unset.
   */
  note?: string
  section?: string
  icon?: ReactNode
  /** Searchable body text (e.g. a terminal's visible output) — matched by substring. */
  content?: string
  run: () => void
  /** Optional secondary action shown as a right-aligned button (e.g. "Reveal in Explorer"). */
  onSecondary?: () => void
  /** Label for the secondary-action button (defaults to "Reveal"). */
  secondaryLabel?: string
  /** An inline live control (switch, select, …) rendered on the row itself — see `CommandControl`. */
  control?: CommandControl
}

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
  /** Prepared file index for the active project (⌘K file search). */
  fileIndex?: QuickOpenIndexedFile[]
  /** Open a file result by its root-relative path. */
  onOpenFile?: (relPath: string) => void
  /** Reveal a file result in the Explorer by its root-relative path. */
  onRevealFile?: (relPath: string) => void
  /** Called whenever the query input changes (for async result sources). */
  onQueryChange?: (q: string) => void
  /** Pre-filtered commands appended verbatim (NOT re-filtered) — e.g. transcript hits. */
  extraCommands?: Command[]
}

/** Bounded card vs. full window — a user choice, persisted (see docs/command-palette.md). */
const SIZE_KEY = 'nodeterm.paletteSize'
function loadPaletteSize(): 'card' | 'full' {
  return localStorage.getItem(SIZE_KEY) === 'full' ? 'full' : 'card'
}

/** Case-insensitive subsequence match — "ntr" matches "New TeRminal". Used only in the default
 *  (plain-text) mode; regex mode uses a real pattern test instead. */
function matches(label: string, q: string): boolean {
  if (!q) return true
  const s = label.toLowerCase()
  let i = 0
  for (const ch of q.toLowerCase()) {
    i = s.indexOf(ch, i)
    if (i === -1) return false
    i++
  }
  return true
}

/** Cmd/Ctrl+K command palette: fuzzy-filter actions and jump targets, Enter to run. Plain text is
 *  a fuzzy subsequence match (the default); the `.*` toggle switches to a real regex test against
 *  the same label+hint corpus, for when "starts with X" or "ends in .ts" beats fuzzy guessing. */
export function CommandPalette({
  commands,
  onClose,
  fileIndex,
  onOpenFile,
  onRevealFile,
  onQueryChange,
  extraCommands
}: CommandPaletteProps) {
  const field = useRegexSearchField()
  const query = field.query
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)

  const setQuery = (q: string): void => {
    field.setValue(q)
    onQueryChange?.(q)
  }

  // Fuzzy-match label+hint in text mode, regex-test the same corpus in regex mode; also
  // substring-match the body text (e.g. terminal output) either way.
  const contentHit = (c: Command) =>
    field.value.length >= 2 && !!c.content && field.test(c.content)
  const labelHit = (c: Command) => {
    const label = `${c.label} ${c.hint ?? ''}`
    return field.mode === 'text' ? matches(label, field.query) : field.test(label)
  }

  const filtered = useMemo(
    () => commands.filter((c) => labelHit(c) || contentHit(c)).slice(0, 50),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commands, field.mode, field.query, field.pattern, field.flags]
  )

  const fileCommands = useMemo<Command[]>(() => {
    if (!fileIndex || !onOpenFile || field.mode !== 'text' || query.trim().length < 1) return []
    return rankQuickOpenFiles(query, fileIndex, 20).map((r) => {
      const base = r.path.split('/').pop() ?? r.path
      const dir = r.path.slice(0, r.path.length - base.length).replace(/\/$/, '')
      return {
        id: `file:${r.path}`,
        label: base,
        hint: dir,
        section: 'Files',
        icon: <IconEditor />,
        run: () => onOpenFile(r.path),
        onSecondary: onRevealFile ? () => onRevealFile(r.path) : undefined,
        secondaryLabel: 'Reveal in Explorer'
      }
    })
  }, [fileIndex, onOpenFile, onRevealFile, query, field.mode])

  const items = useMemo(
    () => [...filtered, ...fileCommands, ...(extraCommands ?? [])],
    [filtered, fileCommands, extraCommands]
  )

  const run = (cmd?: Command) => {
    if (!cmd) return
    cmd.run()
    onClose()
  }

  const [size, setSize] = useState<'card' | 'full'>(loadPaletteSize)
  const toggleSize = () => {
    setSize((s) => {
      const next = s === 'card' ? 'full' : 'card'
      localStorage.setItem(SIZE_KEY, next)
      return next
    })
  }

  return createPortal(
    <div className="palette-overlay" onClick={onClose}>
      <div
        className={`palette${size === 'full' ? ' palette--full' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette__header-row">
          <input
            ref={inputRef}
            className="palette__input"
            autoFocus
            spellCheck={false}
            placeholder={field.mode === 'regex' ? 'Type a regex pattern…' : 'Type a command or name…'}
            value={field.value}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
              onQueryChange?.(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                const c = items[active]
                if (c?.onSecondary) {
                  c.onSecondary()
                  onClose()
                }
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(items[active])
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
          />
          <AnchoredRegexBuilder search={field} fieldRef={inputRef} label="Regex — command palette" />
          {/* Size is a user choice, persisted (localStorage) — default is the bounded card. */}
          <button
            className="palette__size-toggle"
            title={size === 'card' ? 'Expand to full window' : 'Collapse to bounded card'}
            onClick={toggleSize}
          >
            {size === 'card' ? '⤢' : '⤡'}
          </button>
        </div>
        {field.error && <div className="palette__error">{field.error}</div>}
        <div className="palette__list">
          {items.length === 0 && <div className="palette__empty">No matches</div>}
          {items.map((c, i) => (
            <PaletteRow
              key={c.id}
              c={c}
              active={i === active}
              showSection={c.section !== undefined && c.section !== items[i - 1]?.section}
              labelHit={labelHit(c)}
              contentHit={contentHit(c)}
              onHover={() => setActive(i)}
              onRun={() => run(c)}
              onSecondary={
                c.onSecondary
                  ? () => {
                      c.onSecondary?.()
                      onClose()
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * One palette row. A row WITHOUT a `control` stays a `<button>` (unchanged historical markup —
 * every existing command keeps its exact click/keyboard behavior). A row WITH one renders as a
 * `role="option"` container instead, because the live control (a real switch) is itself an
 * interactive element and HTML forbids nesting one inside a `<button>`. Enter/click on the row
 * still runs the row's default action (for a toggle command that IS the toggle, so the row and
 * its inline control can never disagree about what happened); clicking the control directly
 * stops propagation so it fires exactly once.
 */
function PaletteRow({
  c,
  active,
  showSection,
  labelHit,
  contentHit,
  onHover,
  onRun,
  onSecondary
}: {
  c: Command
  active: boolean
  showSection: boolean
  labelHit: boolean
  contentHit: boolean
  onHover: () => void
  onRun: () => void
  onSecondary?: () => void
}): React.JSX.Element {
  // Defer the live control's own construction until the row has actually scrolled into view —
  // a palette with hundreds of setting rows must not instantiate hundreds of subscribed
  // switches/selects up front. Ordinary rows (icon + label) stay cheap regardless of count.
  const rowRef = useRef<HTMLDivElement>(null)
  const [everVisible, setEverVisible] = useState(false)
  useEffect(() => {
    if (!c.control || everVisible) return
    const el = rowRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setEverVisible(true)
      },
      { root: el.closest('.palette__list'), rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [c.control, everVisible])

  const body = (
    <>
      <span className="palette__icon">{c.icon}</span>
      <span className="palette__label">{c.label}</span>
      {!labelHit && contentHit ? (
        <span className="palette__hint">found in output</span>
      ) : (
        (c.hint ?? c.note) && <span className="palette__hint">{c.hint ?? c.note}</span>
      )}
      {c.control && everVisible && (
        <span className="palette__control" onClick={(e) => e.stopPropagation()}>
          <InlineControl control={c.control} />
        </span>
      )}
      {onSecondary && (
        <span
          className="palette__secondary"
          title={c.secondaryLabel}
          onClick={(e) => {
            e.stopPropagation()
            onSecondary()
          }}
        >
          ⤷
        </span>
      )}
    </>
  )

  return (
    <div className="palette__row" ref={rowRef}>
      {showSection && <div className="palette__section">{c.section}</div>}
      {c.control ? (
        <div
          className={`palette__item palette__row--control${active ? ' active' : ''}`}
          role="option"
          aria-selected={active}
          onMouseEnter={onHover}
          onClick={onRun}
        >
          {body}
        </div>
      ) : (
        <button
          className={`palette__item${active ? ' active' : ''}`}
          onMouseEnter={onHover}
          onClick={onRun}
        >
          {body}
        </button>
      )}
    </div>
  )
}

/** The row's live control — a real switch (or, for `select`, a value that cycles through its
 *  options on click) wired directly to the caller's setter. No local state: it always reflects
 *  whatever the originating store currently holds, exactly like the settings-page control it
 *  mirrors. */
function InlineControl({ control }: { control: CommandControl }): React.JSX.Element {
  if (control.type === 'toggle') {
    return (
      <span
        role="switch"
        aria-checked={control.checked}
        aria-label={control.ariaLabel}
        className={`palette__switch${control.checked ? ' on' : ''}`}
        onClick={() => control.onToggle(!control.checked)}
      >
        <span className="palette__switch-thumb" />
      </span>
    )
  }
  const idx = Math.max(
    0,
    control.options.findIndex((o) => o.value === control.value)
  )
  const current = control.options[idx] ?? control.options[0]
  return (
    <span
      role="button"
      aria-label={control.ariaLabel}
      className="palette__cycle"
      title="Click to change"
      onClick={() => {
        const next = control.options[(idx + 1) % control.options.length]
        if (next) control.onChange(next.value)
      }}
    >
      {current?.label ?? ''}
    </span>
  )
}
