import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NODE_COLORS } from '../state/workspace'
import { useMenuFlip } from '../ui/useMenuFlip'
import { useMenuFilter, type MenuFilterItem } from './menu/useMenuFilter'
import { FilterableMenuHeader } from './menu/FilterableMenu'
import { isFilterableMenu, menuRowVisibility } from './menu/menuVisibility'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { keyLabel } from '@shared/platform-utils'
import type { AccountPresentation } from '../lib/accountPresentation'
import { AccountIdentityPills } from './AccountIdentityPills'

type AccountMenuPresentation = {
  accountPresentation?: AccountPresentation
  accountSelected?: boolean
}

export type MenuItem =
  | ({
      type?: 'item'
      label: string
      onClick: () => void
      icon?: ReactNode
      danger?: boolean
      /** Renders the row muted and inert (`onClick` never fires). Pair it with `hint`: a row that
       *  is off for a reason the user cannot see teaches nothing — worse than not showing it. */
      disabled?: boolean
      /** Why the row is disabled (or what it does). Disabled rows render this explanation inline
       *  and expose it through `aria-describedby`; enabled rows retain the native title hint. */
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
    } & AccountMenuPresentation)
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'colors'; onPick: (color: string) => void }
  | ({
      type: 'submenu'
      label: string
      icon?: ReactNode
      children: MenuItem[]
    } & AccountMenuPresentation)

function MenuItemLabel({ item }: { item: AccountMenuPresentation & { label: string } }) {
  return (
    <span className="ctx-item__label">
      {item.label ? <span>{item.label}</span> : null}
      {item.accountPresentation ? (
        <AccountIdentityPills account={item.accountPresentation} selected={item.accountSelected} />
      ) : null}
    </span>
  )
}

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
  const menuId = useId()
  const keyboardOpenedSub = useRef<number | null>(null)

  // A keyboard-opened flyout must move focus into the flyout after React has mounted it.
  // Disabled menu items remain focusable by design, so the first row is a valid target even
  // when it only explains why an unavailable profile cannot be launched.
  useEffect(() => {
    if (openSub == null || keyboardOpenedSub.current !== openSub) return
    keyboardOpenedSub.current = null
    document
      .getElementById(`${menuId}-submenu-${openSub}`)
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus()
  }, [menuId, openSub])

  const filterable = isFilterableMenu(items)
  // Hooks run every render regardless of `filterable` — only what we DO with the results differs —
  // so the rules of hooks hold even though filtering is conditionally rendered below.
  const search = useRegexSearchField()
  // The full per-row visibility (items, submenus, colors, labels, separators) — the single source
  // of truth `menuRowVisibility` computes; see its doc for the section/dangling-separator rules.
  const rowVisible = filterable ? menuRowVisibility(items, search.test, search.active) : []
  // The KEYBOARD-navigable subset: only rows with their own activation (plain items and submenu
  // triggers) — a label/separator/colors row has no "activate" semantic for Enter/arrow nav.
  // Built with an explicit loop (not filter+map) so TypeScript narrows `it` per branch instead of
  // losing the union across the chain.
  const filterItems: MenuFilterItem[] = []
  if (filterable) {
    items.forEach((it, i) => {
      if (!rowVisible[i]) return
      if (it.type === 'item' || !it.type) {
        filterItems.push({ id: String(i), label: it.label, disabled: it.disabled })
      } else if (it.type === 'submenu') {
        filterItems.push({ id: String(i), label: it.label, disabled: false })
      }
    })
  }
  const menuFilter = useMenuFilter(filterItems, search, {
    onActivate: (fi) => {
      const item = items[Number(fi.id)]
      if (!item) return
      if (item.type === 'item' || !item.type) {
        item.onClick()
        onClose()
      } else if (item.type === 'submenu') {
        // Enter on a filtered submenu row opens its flyout — the same target ArrowRight already
        // reaches — instead of silently no-op'ing now that submenu rows are keyboard-reachable.
        keyboardOpenedSub.current = Number(fi.id)
        setOpenSub(Number(fi.id))
      }
    },
    onEmptyEscape: onClose
  })

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
        role="menu"
        data-appearance-id="app:context-menu"
        className={`ctx-menu${scroll ? ' ctx-menu--scroll' : ''}`}
        style={menuStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {filterable && (
          <FilterableMenuHeader
            filter={menuFilter}
            placeholder="Filter…"
            regexLabel="Regex — this menu"
            zIndex={(zIndex ?? 46) + 2}
          />
        )}
        {filterable && menuFilter.filtered.length === 0 && (
          <div className="ctx-empty">No matches</div>
        )}
        {items.map((item, i) => {
          if (filterable && !rowVisible[i]) return null
          if (item.type === 'separator') return <div key={i} className="ctx-sep" role="separator" />
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
            const submenuId = `${menuId}-submenu-${i}`
            const triggerId = `${menuId}-submenu-trigger-${i}`
            return (
              <div
                key={i}
                className="ctx-submenu-host"
                role="none"
                onMouseEnter={() => {
                  setOpenSub(i)
                  if (filterable)
                    menuFilter.setActiveIndex(
                      menuFilter.filtered.findIndex((fi) => fi.id === String(i))
                    )
                }}
                onMouseLeave={() => setOpenSub((cur) => (cur === i ? null : cur))}
              >
                <button
                  id={triggerId}
                  type="button"
                  role="menuitem"
                  className={`ctx-item ctx-item--submenu${filterable && menuFilter.filtered[menuFilter.activeIndex]?.id === String(i) ? ' kbd-active' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={openSub === i}
                  aria-controls={submenuId}
                  onClick={() => setOpenSub((cur) => (cur === i ? null : i))}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ArrowRight' ||
                      event.key === 'ArrowDown' ||
                      event.key === 'Enter' ||
                      event.key === ' '
                    ) {
                      event.preventDefault()
                      keyboardOpenedSub.current = i
                      setOpenSub(i)
                    } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                      event.preventDefault()
                      setOpenSub(null)
                    }
                  }}
                >
                  <span className="ctx-icon">{item.icon}</span>
                  <MenuItemLabel item={item} />
                </button>
                {openSub === i && (
                  <div
                    id={submenuId}
                    role="menu"
                    aria-labelledby={triggerId}
                    className="ctx-menu ctx-submenu"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'Escape') return
                      event.preventDefault()
                      event.stopPropagation()
                      setOpenSub(null)
                      document.getElementById(triggerId)?.focus()
                    }}
                  >
                    {item.children.map((child, j) => {
                      if (child.type === 'separator')
                        return <div key={j} className="ctx-sep" role="separator" />
                      if (child.type === 'label')
                        return (
                          <div key={j} className="ctx-label">
                            {child.label}
                          </div>
                        )
                      if (child.type === 'colors' || child.type === 'submenu') return null
                      const reasonId = child.disabled && child.hint
                        ? `${submenuId}-reason-${j}`
                        : undefined
                      return (
                        <button
                          key={j}
                          type="button"
                          role="menuitem"
                          className={`ctx-item${child.danger ? ' danger' : ''}`}
                          aria-disabled={child.disabled || undefined}
                          aria-label={reasonId ? child.label : undefined}
                          aria-describedby={reasonId}
                          title={child.hint}
                          aria-keyshortcuts={
                            child.shortcut ? ariaKeyShortcuts(child.shortcut, isMacPlatform) : undefined
                          }
                          onClick={(event) => {
                            if (child.disabled) {
                              event.preventDefault()
                              event.stopPropagation()
                              return
                            }
                            child.onClick()
                            onClose()
                          }}
                        >
                          <span className="ctx-icon">{child.icon}</span>
                          <span className="ctx-item__copy">
                            <MenuItemLabel item={child} />
                            {reasonId && (
                              <span id={reasonId} className="ctx-item__hint">
                                {child.hint}
                              </span>
                            )}
                          </span>
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
          const reasonId = item.disabled && item.hint ? `${menuId}-reason-${i}` : undefined
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`ctx-item${item.danger ? ' danger' : ''}${filterable && menuFilter.filtered[menuFilter.activeIndex]?.id === String(i) ? ' kbd-active' : ''}`}
              aria-disabled={item.disabled || undefined}
              aria-label={reasonId ? item.label : undefined}
              aria-describedby={reasonId}
              title={item.hint}
              onMouseEnter={() => {
                if (filterable) menuFilter.setActiveIndex(menuFilter.filtered.findIndex((fi) => fi.id === String(i)))
              }}
              aria-keyshortcuts={
                item.shortcut ? ariaKeyShortcuts(item.shortcut, isMacPlatform) : undefined
              }
              onClick={(event) => {
                if (item.disabled) {
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }
                item.onClick()
                onClose()
              }}
            >
              <span className="ctx-icon">{item.icon}</span>
              <span className="ctx-item__copy">
                <MenuItemLabel item={item} />
                {reasonId && (
                  <span id={reasonId} className="ctx-item__hint">
                    {item.hint}
                  </span>
                )}
              </span>
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
