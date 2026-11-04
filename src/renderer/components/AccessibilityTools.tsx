import { useEffect, useRef, useState } from 'react'
import { MaterialSymbol } from './MaterialSymbol'
import { Button, IconButton, Switch } from '../ui/md3'
import { useSettings } from '../state/settings'
import { useI18n } from '../lib/i18n'
import { resolveUiScale, UI_SCALE_MAX, UI_SCALE_MIN } from '@shared/ui-scale'
import type { Settings } from '@shared/types'
import { canReadAloud, pickReadAloudText, readAloud, stopReadingAloud } from '../lib/readAloud'

/** The four independent modes the menu toggles. Each is read as on only when the stored value is a
 *  literal `true`, because settings.json is hand-editable. */
const MODE_ROWS = [
  { key: 'a11yHighContrast', id: 'a11yTools.highContrast', fallback: 'High contrast' },
  { key: 'a11yReduceMotion', id: 'a11yTools.reduceMotion', fallback: 'Reduce motion' },
  { key: 'a11yBoldFocus', id: 'a11yTools.boldFocus', fallback: 'Bold focus ring' },
  { key: 'a11yLargerTargets', id: 'a11yTools.largerTargets', fallback: 'Larger targets' }
] as const satisfies readonly { key: keyof Settings; id: string; fallback: string }[]

/** One text-size step. The same 10% the browser zoom chords use, clamped by `resolveUiScale`. */
export const UI_SCALE_STEP = 0.1

/** Next UI scale for a step, rounded to one decimal so repeated steps never drift (0.1 is not
 *  exactly representable), and clamped to the shared bounds. */
export function stepUiScale(current: unknown, direction: 1 | -1): number {
  const next = Math.round((resolveUiScale(current) + direction * UI_SCALE_STEP) * 10) / 10
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, next))
}

export interface AccessibilityToolsProps {
  /** Opens the app's keyboard shortcuts panel. */
  onOpenShortcuts: () => void
}

/**
 * The always-reachable accessibility tools (design/v3 `Overlays.dc.html`): a rail button that
 * opens an anchored, non-modal menu with text size, high contrast, reduce motion, a bold focus
 * ring, larger targets and the keyboard shortcuts panel. Every control writes the ordinary
 * persisted setting, so it joins schedules, history, reset and the command palette like any
 * other appearance value.
 *
 * Hiding the button is a separate action behind its own confirmation, with Cancel focused first.
 * It changes only `a11yToolsVisible`; the modes the user turned on stay on, and Settings →
 * Appearance (or resetting Appearance) brings the button back.
 */
export function AccessibilityTools({ onOpenShortcuts }: AccessibilityToolsProps) {
  const { t, ts } = useI18n()
  const visible = useSettings((s) => s.settings.a11yToolsVisible !== false)
  const uiScale = useSettings((s) => s.settings.uiScale)
  // One primitive per selector: an object literal here is a new value on every store read, which
  // zustand treats as a change and re-renders forever.
  const highContrast = useSettings((s) => s.settings.a11yHighContrast === true)
  const reduceMotion = useSettings((s) => s.settings.a11yReduceMotion === true)
  const boldFocus = useSettings((s) => s.settings.a11yBoldFocus === true)
  const largerTargets = useSettings((s) => s.settings.a11yLargerTargets === true)
  const modes = {
    a11yHighContrast: highContrast,
    a11yReduceMotion: reduceMotion,
    a11yBoldFocus: boldFocus,
    a11yLargerTargets: largerTargets
  }
  const update = useSettings((s) => s.update)
  const [open, setOpen] = useState(false)
  const [confirmingHide, setConfirmingHide] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // What Read aloud will speak, captured the moment the trigger is pressed: after that, focus is
  // on the trigger and the panel, not on what the user was reading.
  const readTargetRef = useRef('')
  const [readNotice, setReadNotice] = useState<string | null>(null)
  const captureReadTarget = () => {
    readTargetRef.current = pickReadAloudText(window.getSelection?.()?.toString() ?? '', document.activeElement)
  }

  const close = (restoreFocus: boolean) => {
    setOpen(false)
    setConfirmingHide(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  // Escape closes (first the confirmation, then the menu) and returns focus to the trigger; a
  // pointer press outside closes without stealing focus from wherever the user clicked.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (confirmingHide) setConfirmingHide(false)
      else close(true)
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && (panelRef.current?.contains(target) || triggerRef.current?.contains(target))) return
      close(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open, confirmingHide])

  useEffect(() => {
    if (confirmingHide) cancelRef.current?.focus()
  }, [confirmingHide])

  if (!visible) return null
  const label = ts('a11yTools.open', 'Accessibility tools')
  const scalePercent = `${Math.round(resolveUiScale(uiScale) * 100)}%`
  const scale = resolveUiScale(uiScale)

  return (
    <div className="md3-a11y-tools">
      <Button
        ref={triggerRef}
        variant="text"
        vocabularyMode="factual"
        className={`md3-rail-item md3-rail-item--a11y${open ? ' is-active' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={() => {
          if (!open) captureReadTarget()
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'Enter' || e.key === ' ')) captureReadTarget()
        }}
        onClick={() => {
          setReadNotice(null)
          if (open) close(false)
          else setOpen(true)
        }}
      >
        <span className="md3-rail-item__pill md3-a11y-tools__pill">
          <MaterialSymbol name="accessibility_new" />
        </span>
        <span className="md3-rail-item__label">{t('a11yTools.short', 'Access').primary}</span>
      </Button>
      {open && (
        <div ref={panelRef} className="md3-a11y-tools__panel" role="dialog" aria-label={label}>
          <div className="md3-a11y-tools__head">
            <MaterialSymbol name="accessibility_new" />
            <span>{label}</span>
          </div>
          <div className="md3-a11y-tools__row">
            <span className="md3-a11y-tools__label">{ts('a11yTools.textSize', 'Text size')}</span>
            <IconButton
              size="dense"
              icon="text_decrease"
              aria-label={ts('a11yTools.smaller', 'Smaller text')}
              disabled={scale <= UI_SCALE_MIN}
              onClick={() => update({ uiScale: stepUiScale(uiScale, -1) })}
            />
            <span className="md3-a11y-tools__value" aria-live="polite">
              {scalePercent}
            </span>
            <IconButton
              size="dense"
              icon="text_increase"
              aria-label={ts('a11yTools.larger', 'Larger text')}
              disabled={scale >= UI_SCALE_MAX}
              onClick={() => update({ uiScale: stepUiScale(uiScale, 1) })}
            />
          </div>
          {MODE_ROWS.map((row) => (
            <div key={row.key} className="md3-a11y-tools__row">
              <span className="md3-a11y-tools__label">{ts(row.id, row.fallback)}</span>
              <Switch
                checked={modes[row.key]}
                ariaLabel={ts(row.id, row.fallback)}
                vocabularyMode="factual"
                onChange={(v) => update({ [row.key]: v } as Partial<Settings>)}
              />
            </div>
          ))}
          <div className="md3-a11y-tools__row md3-a11y-tools__read">
            <Button
              variant="tonal"
              vocabularyMode="factual"
              leadingIcon={<MaterialSymbol name="record_voice_over" />}
              disabled={!canReadAloud()}
              title={canReadAloud() ? undefined : ts('a11yTools.readUnavailable', 'Speech is not available on this system.')}
              onClick={() => {
                const ok = readAloud(readTargetRef.current)
                setReadNotice(
                  ok ? null : ts('a11yTools.readNothing', 'Select some text, or focus something, then open this menu again.')
                )
              }}
            >
              {ts('a11yTools.read', 'Read aloud')}
            </Button>
            <Button variant="text" vocabularyMode="factual" onClick={() => stopReadingAloud()}>
              {ts('a11yTools.stopReading', 'Stop')}
            </Button>
          </div>
          {readNotice && (
            <p className="md3-a11y-tools__notice" role="status">
              {readNotice}
            </p>
          )}
          <Button
            variant="tonal"
            vocabularyMode="factual"
            leadingIcon={<MaterialSymbol name="keyboard" />}
            onClick={() => {
              close(false)
              onOpenShortcuts()
            }}
          >
            {ts('a11yTools.shortcuts', 'Keyboard shortcuts')}
          </Button>
          <div className="md3-a11y-tools__divider" />
          {confirmingHide ? (
            <div className="md3-a11y-tools__confirm" role="alertdialog" aria-label={ts('a11yTools.hideTitle', 'Hide the accessibility tools button?')}>
              <strong>{ts('a11yTools.hideTitle', 'Hide the accessibility tools button?')}</strong>
              <p>{ts('a11yTools.hideBody', 'Your accessibility settings stay as they are. Bring the button back from Settings → Appearance, or reset Appearance.')}</p>
              <div className="md3-a11y-tools__confirm-actions">
                <Button ref={cancelRef} variant="text" vocabularyMode="factual" onClick={() => setConfirmingHide(false)}>
                  {ts('a11yTools.cancel', 'Cancel')}
                </Button>
                <Button
                  variant="filled"
                  vocabularyMode="factual"
                  onClick={() => {
                    close(false)
                    update({ a11yToolsVisible: false })
                  }}
                >
                  {ts('a11yTools.hideConfirm', 'Hide button')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="text" vocabularyMode="factual" className="md3-a11y-tools__hide" onClick={() => setConfirmingHide(true)}>
              {ts('a11yTools.hide', 'Hide this button…')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
