import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NODE_COLORS } from '../state/workspace'
import { useMenuFlip } from '../ui/useMenuFlip'
import { keyLabel } from '@shared/platform-utils'

export type MenuItem =
  | {
      type?: 'item'
      label: string
      onClick: () => void
      icon?: ReactNode
      danger?: boolean
      /** Renders the row muted and inert (`onClick` never fires). Pair it with `hint`: a row that
       *  is off for a reason the user cannot see teaches nothing — worse than not showing it. */
      disabled?: boolean
      /** Why the row is disabled (or what it does). Surfaced as the row's native `title` tooltip —
       *  deliberately not a tooltip system of our own. */
      hint?: string
      /**
       * The REAL global keyboard shortcut that performs this exact action in this exact
       * context, as canonical key tokens (`'⌘'`, `'⇧'`, `'T'`, …) — the same tokens
       * `ShortcutsPanel` uses, so a rename there and here can never drift apart from what the
       * key listener actually does. Rendered right-aligned, rewritten for the current platform
       * via `keyLabel` (⌘/⇧ become Ctrl/Shift off macOS). Omit entirely for an item with no
       * bound shortcut — never pad the column with a placeholder.
       */
      shortcut?: string[]
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'colors'; onPick: (color: string) => void }
  | { type: 'submenu'; label: string; icon?: ReactNode; children: MenuItem[] }

/** `['⌘', '⇧', 'T']` → `"Meta+Shift+T"` — the token shape `aria-keyshortcuts` expects, so a
 *  screen reader announces the binding as a shortcut rather than reading decorative glyphs. */
function ariaKeyShortcuts(tokens: string[], isMac: boolean): string | undefined {
  if (tokens.length === 0) return undefined
  return tokens
    .map((t) => {
      if (t === '⌘') return isMac ? 'Meta' : 'Control'
      if (t === '⇧') return 'Shift'
      if (t === '⌥') return 'Alt'
      if (t === '⌃') return 'Control'
      return t.length === 1 ? t.toUpperCase() : t
    })
    .join('+')
}

const isMacPlatform = /Mac/i.test(navigator.platform || navigator.userAgent)

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /**
   * Override the base stacking order. The default CSS z-index (46) sits BELOW drawer
   * overlays (z-index 55), so a ContextMenu opened from inside a drawer (e.g. the Source
   * Control panel) would render hidden behind it. Pass a value above the host overlay.
   */
  zIndex?: number
  /**
   * Cap the menu height and scroll overflow — for data-driven flat lists that can grow
   * unbounded (e.g. the branch pickers: repos easily hold 30+ branches, and a fixed-position
   * menu otherwise runs past the viewport with no way to reach the tail). Only for menus
   * with NO submenu items: `overflow-y: auto` would clip a hover flyout.
   */
  scroll?: boolean
}

/**
 * A right-click menu rendered in a body portal at fixed coordinates, so it is never
 * clipped or hidden behind the canvas. Closes on backdrop click.
 */
export function ContextMenu({ x, y, items, onClose, zIndex, scroll }: ContextMenuProps) {
  // Keep the menu one above its backdrop (matches the default 46/45 CSS ordering).
  const backdropStyle = zIndex != null ? { zIndex } : undefined
  // Flip away from the viewport edges: a right-click near the bottom (or right) edge used to
  // open the menu DOWNWARD off-screen, cutting the tail rows off. See useMenuFlip.
  const flip = useMenuFlip(y, x)
  const menuRef = flip.ref
  const menuStyle =
    zIndex != null
      ? { top: flip.top, left: flip.left, zIndex: zIndex + 1 }
      : { top: flip.top, left: flip.left }
  // Index of the row whose submenu flyout is currently open (hover-driven).
  const [openSub, setOpenSub] = useState<number | null>(null)
  return createPortal(
    <>
      <div
        className="ctx-backdrop"
        style={backdropStyle}
        onContextMenu={(e) => e.preventDefault()}
        onClick={onClose}
      />
      <div
        ref={menuRef}
        className={`ctx-menu${scroll ? ' ctx-menu--scroll' : ''}`}
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, i) => {
          if (item.type === 'separator') return <div key={i} className="ctx-sep" />
          if (item.type === 'label') return <div key={i} className="ctx-label">{item.label}</div>
          if (item.type === 'colors') {
            return (
              <div key={i} className="ctx-colors">
                {NODE_COLORS.map((c) => (
                  <button
                    key={c}
                    style={{ background: c }}
                    onClick={() => {
                      item.onPick(c)
                      onClose()
                    }}
                  />
                ))}
              </div>
            )
          }
          if (item.type === 'submenu') {
            return (
              <div
                key={i}
                className="ctx-item ctx-item--submenu"
                onMouseEnter={() => setOpenSub(i)}
                onMouseLeave={() => setOpenSub((cur) => (cur === i ? null : cur))}
              >
                <span className="ctx-icon">{item.icon}</span>
                {item.label}
                {openSub === i && (
                  <div className="ctx-menu ctx-submenu" onClick={(e) => e.stopPropagation()}>
                    {item.children.map((child, j) => {
                      if (child.type === 'separator') return <div key={j} className="ctx-sep" />
                      if (child.type === 'label')
                        return <div key={j} className="ctx-label">{child.label}</div>
                      if (child.type === 'colors' || child.type === 'submenu') return null
                      return (
                        <button
                          key={j}
                          className={`ctx-item${child.danger ? ' danger' : ''}`}
                          disabled={child.disabled}
                          title={child.hint}
                          aria-keyshortcuts={
                            child.shortcut ? ariaKeyShortcuts(child.shortcut, isMacPlatform) : undefined
                          }
                          onClick={() => {
                            child.onClick()
                            onClose()
                          }}
                        >
                          <span className="ctx-icon">{child.icon}</span>
                          <span className="ctx-item__label">{child.label}</span>
                          {child.shortcut && child.shortcut.length > 0 && (
                            <span className="ctx-item__shortcut" aria-hidden>
                              {child.shortcut.map((k, ki) => (
                                <kbd key={ki} className="kbd">
                                  {keyLabel(k, isMacPlatform)}
                                </kbd>
                              ))}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }
          return (
            <button
              key={i}
              className={`ctx-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              title={item.hint}
              aria-keyshortcuts={
                item.shortcut ? ariaKeyShortcuts(item.shortcut, isMacPlatform) : undefined
              }
              onClick={() => {
                item.onClick()
                onClose()
              }}
            >
              <span className="ctx-icon">{item.icon}</span>
              <span className="ctx-item__label">{item.label}</span>
              {item.shortcut && item.shortcut.length > 0 && (
                <span className="ctx-item__shortcut" aria-hidden>
                  {item.shortcut.map((k, ki) => (
                    <kbd key={ki} className="kbd">
                      {keyLabel(k, isMacPlatform)}
                    </kbd>
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>,
    document.body
  )
}
