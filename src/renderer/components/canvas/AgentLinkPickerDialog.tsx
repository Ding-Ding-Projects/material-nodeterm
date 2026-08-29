import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { useDialogStack } from '../dialog-stack'
import { AgentIcon } from '../../lib/agentIcons'
import { MaterialSymbol } from '../MaterialSymbol'
import type { AgentId } from '@shared/agents/config'
import { useLocalizedVocabularyText } from '../../lib/personalVocabulary/useLocalizedVocabularyText'

export interface AgentLinkPickerOption {
  id: string
  agentId: AgentId
  title: string
  agentLabel: string
  color?: string
}

interface AgentLinkPickerDialogProps {
  sourceTitle: string
  targets: AgentLinkPickerOption[]
  anchorEl?: HTMLElement
  onPick: (targetId: string) => void
  onCancel: () => void
}

/**
 * Keyboard and screen-reader equivalent for dragging an agent's link-out handle to another
 * agent's link-in handle. It only chooses an endpoint; the canvas still runs the same
 * React Flow onConnect path as the pointer gesture, so duplicate, capability and persistence
 * semantics cannot diverge.
 */
export function AgentLinkPickerDialog({
  sourceTitle,
  targets,
  anchorEl,
  onPick,
  onCancel
}: AgentLinkPickerDialogProps): React.JSX.Element {
  const profileText = useLocalizedVocabularyText()
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const builderRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [regexBuilderOpen, setRegexBuilderOpen] = useState(false)
  const [regexCloseSignal, setRegexCloseSignal] = useState(0)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const isTop = useDialogStack()
  const title = profileText('agentLink.dialog.title', 'Link {source} to another agent', {
    source: sourceTitle || 'agent'
  })
  const description = profileText(
    'agentLink.dialog.description',
    'Choose a context-capable agent. No transcript is sent automatically.'
  )
  const targetFilterLabel = profileText('agentLink.dialog.filter', 'Filter link targets')
  const placeholder = profileText(
    search.mode === 'regex'
      ? 'agentLink.dialog.filterPlaceholderRegex'
      : 'agentLink.dialog.filterPlaceholder',
    search.mode === 'regex' ? 'Filter agents… (regex)' : 'Filter agents…'
  )
  const regexLabel = profileText('agentLink.dialog.regexLabel', 'Regex — agent link picker')
  const targetsLabel = profileText('agentLink.dialog.targets', 'Available agent link targets')
  const emptyLabel = profileText(
    'agentLink.dialog.empty',
    'No other context-capable agents are available.'
  )
  const noMatchLabel = profileText('agentLink.dialog.noMatch', 'No agents match that filter.')
  const cancelLabel = profileText('agentLink.dialog.cancel', 'Cancel')

  useLayoutEffect(() => {
    if (!anchorEl) {
      setPosition(null)
      return
    }
    let frame = 0
    const measure = (): void => {
      if (!anchorEl.isConnected) {
        setPosition(null)
        return
      }
      const rect = anchorEl.getBoundingClientRect()
      const width = dialogRef.current?.offsetWidth || 420
      const height = dialogRef.current?.offsetHeight || 520
      const margin = 16
      const below = rect.bottom + 8
      const top =
        below + height <= window.innerHeight - margin
          ? below
          : Math.max(margin, rect.top - height - 8)
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
      setPosition((previous) =>
        previous && previous.left === left && previous.top === top ? previous : { left, top }
      )
    }
    const tick = (): void => {
      measure()
      frame = requestAnimationFrame(tick)
    }
    measure()
    frame = requestAnimationFrame(tick)
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resizeObserver?.observe(anchorEl)
    if (dialogRef.current) resizeObserver?.observe(dialogRef.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorEl])

  const filtered = useMemo(
    () => targets.filter((target) => search.test(`${target.title} ${target.agentLabel}`)),
    [targets, search]
  )

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isTop()) return
      const eventTarget = event.target
      const inBuilder =
        eventTarget instanceof Node && !!builderRef.current?.contains(eventTarget)
      if (event.key === 'Escape') {
        if (regexBuilderOpen) {
          event.preventDefault()
          if (!inBuilder) setRegexCloseSignal((signal) => signal + 1)
          return
        }
        event.preventDefault()
        onCancel()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => Math.max(0, index - 1))
      } else if (event.key === 'Enter') {
        // A focused option is a real button. Let the browser's native activation call its
        // onClick; only the search field's active option uses the picker-level Enter shortcut.
        if (event.target instanceof HTMLButtonElement) return
        const target = filtered[activeIndex]
        if (target) {
          event.preventDefault()
          onPick(target.id)
        }
      } else if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const scopes: HTMLElement[] = []
        if (regexBuilderOpen) {
          if (builderRef.current) scopes.push(builderRef.current)
        }
        scopes.push(dialog)
        const focusable = Array.from(
          new Set(
            scopes.flatMap((scope) =>
              Array.from(
                scope.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )
              )
            )
          )
        )
        if (!focusable.length) return
        const current = focusable.indexOf(document.activeElement as HTMLElement)
        const next = event.shiftKey
          ? (current <= 0 ? focusable.length - 1 : current - 1)
          : (current + 1) % focusable.length
        event.preventDefault()
        focusable[next]?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isTop, filtered, activeIndex, onPick, onCancel, regexBuilderOpen])

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  return createPortal(
    <>
      <div className="agent-link-picker__backdrop" onClick={onCancel} />
      <div
        ref={dialogRef}
        className={`agent-link-picker${anchorEl ? ' agent-link-picker--anchored' : ''}`}
        style={position ? { left: position.left, top: position.top } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-link-picker-title"
        aria-describedby="agent-link-picker-description"
      >
        <div id="agent-link-picker-title" className="agent-link-picker__title">{title}</div>
        <div id="agent-link-picker-description" className="agent-link-picker__description">
          {description}
        </div>
        <div className="menu-filter agent-link-picker__search">
          <div className="menu-filter__row">
            <input
              ref={inputRef}
              className="menu-filter__input"
              value={search.value}
              spellCheck={false}
              placeholder={placeholder}
              aria-label={targetFilterLabel}
              onChange={(event) => search.setValue(event.target.value)}
            />
            <AnchoredRegexBuilder
              search={search}
              fieldRef={inputRef}
              label={regexLabel}
              zIndex={93}
              onOpenChange={setRegexBuilderOpen}
              closeSignal={regexCloseSignal}
              popoverRef={builderRef}
              ownsKeyboard={isTop}
            />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>
        <div
          ref={listRef}
          className="agent-link-picker__list"
          role="listbox"
          aria-label={targetsLabel}
          aria-live="polite"
          tabIndex={-1}
        >
          {filtered.length === 0 ? (
            <div className="agent-link-picker__empty">
              {targets.length === 0 ? emptyLabel : noMatchLabel}
            </div>
          ) : (
            filtered.map((target, index) => (
              <button
                key={target.id}
                type="button"
                data-idx={index}
                id={`agent-link-target-${index}`}
                tabIndex={index === activeIndex ? 0 : -1}
                role="option"
                aria-selected={index === activeIndex}
                className={`agent-link-picker__option${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => onPick(target.id)}
              >
                <span
                  className="agent-link-picker__swatch"
                  style={target.color ? { background: target.color } : undefined}
                >
                  <AgentIcon agentId={target.agentId} />
                </span>
                <span className="agent-link-picker__name">
                  {target.title || profileText('agentLink.dialog.untitled', 'Untitled agent')}
                </span>
                <span className="agent-link-picker__agent">{target.agentLabel}</span>
                <MaterialSymbol name="link" size={16} />
              </button>
            ))
          )}
        </div>
        <div className="agent-link-picker__footer">
          <button type="button" className="agent-link-picker__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
