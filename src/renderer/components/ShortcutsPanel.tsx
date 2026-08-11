import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { isHoldChord, shortcutKeyParts } from '@shared/shortcut'
import { isBrowserRuntime } from '../bridge/runtime'
import { useSettings } from '../state/settings'
import { shortcutGroups } from '@shared/shortcuts'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
import { keyLabel } from '@shared/platform-utils'

export interface ShortcutsPanelProps {
  onClose: () => void
}

interface Row {
  keys: string[]
  label: string
}

/** Fixed reference rows shown under each group AFTER the configurable hotkeys: mouse gestures
 *  and one-off UI keys that have no combo string to configure. The actual key combos (⌘K, ⌘T,
 *  ⌘⇧G, ⌘⇧F, …) are NOT here — they come from the shortcuts registry and render from current
 *  settings, so a rebind shows here immediately. */
const GESTURE_ROWS: Record<string, Row[]> = {
  General: [
    // Desktop only: browsers own Cmd/Ctrl+1-9 for tab switching and a page cannot take it
    // back, so listing it in the Server Edition would promise a shortcut that never fires.
    ...(isBrowserRuntime() ? [] : [{ keys: ['⌘', '1-9'], label: 'Jump to project' }])
  ],
  Canvas: [
    { keys: ['Delete'], label: 'Delete selected node(s) — asks first' },
    { keys: ['Right-click'], label: 'Actions menu (empty space or node)' },
    { keys: ['Left-drag'], label: 'Box-select (touch to select)' },
    { keys: ['Middle / Right-drag'], label: 'Pan the canvas' },
    { keys: ['Double-click'], label: 'Frame & focus a node' },
    { keys: ['⌘', 'wheel'], label: 'Zoom in / out' },
    // Advertised on BOTH surfaces, unlike "Jump to project" above. ⌘1-9 is dropped there
    // because the browser RESERVES it (tab switching, un-preventable) for something unrelated;
    // ⌘0 is neither — it is not in the reserved set, so the page gets the keydown, and even
    // where a browser insists on handling it too it means the same thing we do ("actual size")
    // instead of fighting us. Shift+1 is nobody else's key on any surface. Neither is
    // configurable via the Shortcuts registry (they're matched on physical key layout, not a
    // combo string — see `lib/zoomShortcut.ts`).
    { keys: ['⌘', '0'], label: 'Zoom to 100%' },
    { keys: ['⇧', '1'], label: 'Fit view' }
  ],
  Terminal: [
    { keys: ['Hover ~0.6s'], label: 'Enter the terminal (type/select)' },
    { keys: ['Quick drag'], label: 'Move the terminal (before it focuses)' },
    { keys: ['✦'], label: 'Name the terminal with AI' }
  ],
  // Source Control has no fixed gesture rows: Open Source Control and Commit are configurable
  // (toggleSourceControl / commitStaged) and render from the registry.
  'Source Control': []
}

/**
 * Keyboard shortcuts reference; shown on first launch and via ⌘/ or the ? button.
 * Configurable hotkeys render from the CURRENT settings (so a rebind in Keyboard Shortcuts
 * shows here immediately); mouse gestures are fixed reference rows. The dictation row reflects
 * `settings.speech.shortcut` (a modifier-only chord is hold-to-talk — no trailing key badge).
 */
export function ShortcutsPanel({ onClose }: ShortcutsPanelProps) {
  const speechShortcut = useSettings((s) => s.settings.speech.shortcut)
  const shortcutsMap = useSettings((s) => s.settings.shortcuts)

  const sections = shortcutGroups().map((group) => ({
    title: group.title,
    rows: [
      ...group.defs.map((d) => ({
        keys: shortcutKeyParts(shortcutsMap[d.id], isMac),
        label: d.label
      })),
      ...(GESTURE_ROWS[group.title] ?? [])
    ]
  }))

  // General group also leads with the dictation row (speech shortcut) before the rest.
  const general = sections.find((s) => s.title === 'General')
  if (general) {
    general.rows.unshift({
      keys: shortcutKeyParts(speechShortcut, isMac),
      label: isHoldChord(speechShortcut) ? 'Dictate (hold)' : 'Dictate'
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="sc-overlay" onClick={onClose}>
      <div className="shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts__head">
          <h2>Keyboard shortcuts</h2>
          <button className="drawer__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="shortcuts__body">
          {sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              {s.rows.map((r) => (
                <div key={r.label} className="shortcut-row">
                  <span className="shortcut-label">{r.label}</span>
                  <span className="shortcut-keys">
                    {r.keys.map((k, i) => (
                      <kbd key={i} className="kbd">
                        {keyLabel(k)}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="shortcuts__footer">
          <button
            className="toylock-btn--link"
            onClick={() => {
              onClose()
              window.dispatchEvent(new CustomEvent('nodeterm:open-settings', { detail: { section: 'support' } }))
            }}
          >
            Need help? Open Support Tickets…
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}