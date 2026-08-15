import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NODE_COLORS } from '../state/workspace'
import { useMenuFlip } from '../ui/useMenuFlip'
import { useMenuFilter, type MenuFilterItem } from './menu/useMenuFilter'
import { FilterableMenuHeader } from './menu/FilterableMenu'

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
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'colors'; onPick: (color: string) => void }
  | { type: 'submenu'; label: string; icon?: ReactNode; children: MenuItem[] }

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

/** Below this count a filter field costs more space than it saves — see the CLAUDE.md note on
 *  this exact trade-off. Menus at or under this size render exactly as before. */
const FILTER_THRESHOLD = 6

/** Only a fully flat menu (every entry is a plain clickable item — no submenu/colors/separator/
 *  label mixed in) is filterable. Filtering a menu with sections would mean deciding what happens
 *  to a group's label/separator once every row under it is filtered out — real UI work this lane
 *  didn't attempt; those menus render exactly as they did before this change. */
function isFilterable(items: MenuItem[]): boolean {
  return items.length > FILTER_THRESHOLD && items.every((it) => !it.type || it.type === 'item')
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

  const filterable = isFilterable(items)
  // Hooks run every render regardless of `filterable` — only the array CONTENT differs — so the
  // rules of hooks hold even though filtering is conditionally rendered below.
  const filterItems: MenuFilterItem[] = filterable
    ? items.map((it, i) => ({
        id: String(i),
        label: it.type === 'item' || !it.type ? it.label : '',
        disabled: it.type === 'item' ? it.disabled : false
      }))
    : []
  const menuFilter = useMenuFilter(filterItems, {
    onActivate: (fi) => {
      const item = items[Number(fi.id)]
      if (item && (item.type === 'item' || !item.type)) {
        item.onClick()
        onClose()
      }
    },
    onEmptyEscape: onClose
  })
  const visibleIndices = filterable
    ? new Set(menuFilter.filtered.map((fi) => Number(fi.id)))
    : null

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
          if (visibleIndices && !visibleIndices.has(i)) return null
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
                          onClick={() => {
                            child.onClick()
                            onClose()
                          }}
                        >
                          <span className="ctx-icon">{child.icon}</span>
                          {child.label}
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
              className={`ctx-item${item.danger ? ' danger' : ''}${filterable && menuFilter.filtered[menuFilter.activeIndex]?.id === String(i) ? ' kbd-active' : ''}`}
              disabled={item.disabled}
              title={item.hint}
              onMouseEnter={() => {
                if (filterable) menuFilter.setActiveIndex(menuFilter.filtered.findIndex((fi) => fi.id === String(i)))
              }}
              onClick={() => {
                item.onClick()
                onClose()
              }}
            >
              <span className="ctx-icon">{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </div>
    </>,
    document.body
  )
}
