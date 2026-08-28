import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NODE_COLORS } from '../state/workspace'
import { useMenuFlip } from '../ui/useMenuFlip'
import { fitFlyout, FLYOUT_MARGIN, type FlyoutFit } from '../ui/flyoutFit'
import { ColorPicker } from './color/ColorPicker'
import { RAINBOW_COLOR, isRainbowColor } from '../lib/nodeColor'
import { useMenuFilter, type MenuFilterItem } from './menu/useMenuFilter'
import { FilterableMenuHeader } from './menu/FilterableMenu'
import { isFilterableMenu, menuRowVisibility } from './menu/menuVisibility'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { keyLabel } from '@shared/platform-utils'
import type { AccountPresentation } from '../lib/accountPresentation'
import { AccountIdentityPills } from './AccountIdentityPills'
import { useVocabularyMapper, type VocabularyTextMode } from '../lib/personalVocabulary/useVocabularyText'

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
      /** Whether this row's visible label and hint are app-authored copy or an exact fact. */
      vocabularyMode?: VocabularyTextMode
    } & AccountMenuPresentation)
  | { type: 'separator' }
  | { type: 'label'; label: string; vocabularyMode?: VocabularyTextMode }
  | {
      type: 'colors'
      onPick: (color: string) => void
      /** The target's CURRENT colour, so the custom picker opens on it instead of on an arbitrary
       *  default. Optional: callers that cannot cheaply resolve one (a mixed multi-node selection)
       *  omit it and the picker starts from the first preset. */
      value?: string
    }
  | ({
      type: 'submenu'
      label: string
      icon?: ReactNode
      children: MenuItem[]
      vocabularyMode?: VocabularyTextMode
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

/** Map only explicitly authored menu copy. Raw ContextMenu callers intentionally default to
 * factual because this shell also renders paths, branch names, commit identities, and commands.
 * The prose-menu wrapper may continue to map its complete authored tree before it reaches here. */
export function mapAuthoredMenuItems(
  items: MenuItem[],
  map: <T extends string | undefined | null>(text: T) => T
): MenuItem[] {
  let changed = false
  const mapped = items.map((item) => {
    if (item.type === 'separator' || item.type === 'colors') return item
    if (item.type === 'submenu') {
      const label = item.vocabularyMode === 'authored' ? map(item.label) : item.label
      const children = mapAuthoredMenuItems(item.children, map)
      if (label === item.label && children === item.children) return item
      changed = true
      return { ...item, label, children }
    }
    if (item.type === 'label') {
      if (item.vocabularyMode !== 'authored') return item
      const label = map(item.label)
      if (label === item.label) return item
      changed = true
      return { ...item, label }
    }
    if (item.vocabularyMode !== 'authored') return item
    const label = map(item.label)
    const hint = map(item.hint)
    if (label === item.label && hint === item.hint) return item
    changed = true
    return { ...item, label, hint }
  })
  return changed ? mapped : items
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
export function ContextMenu({ x, y, items, onClose, zIndex }: ContextMenuProps) {
  const vocab = useVocabularyMapper()
  const visibleItems = mapAuthoredMenuItems(items, vocab)
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
  // Custom-colour state lives on the MENU, not the row, so a re-render of the items array (the
  // live filter rebuilds it on every keystroke) cannot collapse an open picker mid-drag.
  const [customOpen, setCustomOpen] = useState(false)
  const [customColor, setCustomColor] = useState<string | null>(null)

  // The parent menu has flipped away from the viewport edges for a long time; the FLYOUT never
  // did. `.ctx-submenu` is `position: absolute` off its row, so a list long enough — the Windows
  // profile submenu grows with every installed shell and WSL distribution — simply ran off the
  // bottom of the screen with its last entries unreachable. Measured after mount but before paint
  // so the correction is never a visible jump, and re-measured on resize because the flyout is
  // built from an async profile probe and GROWS while it is open.
  const flyoutRef = useRef<HTMLDivElement>(null)
  const flyoutTriggerRef = useRef<HTMLButtonElement>(null)
  const [flyoutFit, setFlyoutFit] = useState<FlyoutFit>({ shiftY: 0, flipX: false })
  const [flyoutPosition, setFlyoutPosition] = useState({ top: -9999, left: -9999 })
  const flyoutCloseTimer = useRef<number | null>(null)
  const flyoutPointerInside = useRef(false)
  const cancelFlyoutClose = (): void => {
    if (flyoutCloseTimer.current !== null) {
      window.clearTimeout(flyoutCloseTimer.current)
      flyoutCloseTimer.current = null
    }
  }
  const scheduleFlyoutClose = (): void => {
    cancelFlyoutClose()
    flyoutCloseTimer.current = window.setTimeout(() => {
      flyoutCloseTimer.current = null
      if (!flyoutPointerInside.current) setOpenSub(null)
    }, 120)
  }
  useLayoutEffect(() => {
    if (openSub == null) {
      // Reset when it closes, or the next flyout opens wearing the last one's correction.
      setFlyoutFit((cur) => (cur.shiftY === 0 && !cur.flipX ? cur : { shiftY: 0, flipX: false }))
      setFlyoutPosition((cur) => (cur.top === -9999 && cur.left === -9999 ? cur : { top: -9999, left: -9999 }))
      return
    }
    const el = flyoutRef.current
    const trigger = flyoutTriggerRef.current
    if (!el || !trigger) return
    const measure = (): void => {
      const triggerRect = trigger.getBoundingClientRect()
      const measured = el.getBoundingClientRect()
      // The flyout is portaled to document.body, so the root menu's scroll container cannot clip
      // it. Its natural position is still the same four-pixel overlap used by the old anchored
      // layout, then the pure fit helper keeps the tail inside the viewport.
      const raw = {
        top: triggerRect.top - 6,
        left: triggerRect.right - 4,
        width: measured.width,
        height: measured.height
      }
      const next = fitFlyout(
        raw,
        { left: triggerRect.left, right: triggerRect.right },
        { width: window.innerWidth, height: window.innerHeight },
      )
      // Identity-guarded, exactly like useMenuFlip: an unguarded set here is an infinite loop,
      // because applying the correction resizes the element and re-fires the observer.
      setFlyoutFit((cur) => (cur.shiftY === next.shiftY && cur.flipX === next.flipX ? cur : next))
      const naturalLeft = next.flipX ? triggerRect.left - measured.width + 4 : triggerRect.right - 4
      const left = Math.max(
        FLYOUT_MARGIN,
        Math.min(naturalLeft, window.innerWidth - measured.width - FLYOUT_MARGIN),
      )
      const top = Math.max(FLYOUT_MARGIN, raw.top - next.shiftY)
      setFlyoutPosition((cur) => (cur.top === top && cur.left === left ? cur : { top, left }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    menuRef.current?.addEventListener('scroll', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      menuRef.current?.removeEventListener('scroll', measure)
    }
  }, [openSub, flyoutFit.shiftY, menuRef])

  useEffect(() => () => cancelFlyoutClose(), [])

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

  const filterable = isFilterableMenu(visibleItems)
  // Every root menu gets its own bounded scroll body. Flyouts are portaled to document.body below,
  // so the root scroll container cannot clip a child surface. Keep the legacy `scroll` prop in the
  // public API for callers, but no longer let its omission leave a dynamic menu unbounded.
  const shouldScroll = true
  // Hooks run every render regardless of `filterable` — only what we DO with the results differs —
  // so the rules of hooks hold even though filtering is conditionally rendered below.
  const search = useRegexSearchField()
  // The full per-row visibility (items, submenus, colors, labels, separators) — the single source
  // of truth `menuRowVisibility` computes; see its doc for the section/dangling-separator rules.
  const rowVisible = filterable ? menuRowVisibility(visibleItems, search.test, search.active) : []
  // The KEYBOARD-navigable subset: only rows with their own activation (plain items and submenu
  // triggers) — a label/separator/colors row has no "activate" semantic for Enter/arrow nav.
  // Built with an explicit loop (not filter+map) so TypeScript narrows `it` per branch instead of
  // losing the union across the chain.
  const filterItems: MenuFilterItem[] = []
  if (filterable) {
    visibleItems.forEach((it, i) => {
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
      const item = visibleItems[Number(fi.id)]
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

  const openSubmenu = openSub == null ? undefined : visibleItems[openSub]
  const flyoutPortal = openSubmenu?.type === 'submenu'
    ? createPortal(
        <div
          ref={flyoutRef}
          id={`${menuId}-submenu-${openSub}`}
          role="menu"
          aria-labelledby={`${menuId}-submenu-trigger-${openSub}`}
          className="ctx-menu ctx-submenu"
          style={{
            top: flyoutPosition.top,
            left: flyoutPosition.left,
            zIndex: (zIndex ?? 46) + 2,
            visibility: flyoutPosition.top < 0 ? 'hidden' : 'visible'
          }}
          onMouseEnter={() => {
            cancelFlyoutClose()
            flyoutPointerInside.current = true
          }}
          onMouseLeave={() => {
            flyoutPointerInside.current = false
            scheduleFlyoutClose()
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setOpenSub(null)
            flyoutPointerInside.current = false
            cancelFlyoutClose()
            document.getElementById(`${menuId}-submenu-trigger-${openSub}`)?.focus()
          }}
        >
          {openSubmenu.children.map((child, j) => {
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
              ? `${menuId}-submenu-${openSub}-reason-${j}`
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
        </div>,
        document.body
      )
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
        role="menu"
        data-appearance-id="app:context-menu"
        className={`ctx-menu${shouldScroll ? ' ctx-menu--scroll' : ''}`}
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
        {visibleItems.map((item, i) => {
          if (filterable && !rowVisible[i]) return null
          if (item.type === 'separator') return <div key={i} className="ctx-sep" role="separator" />
          if (item.type === 'label') return <div key={i} className="ctx-label">{item.label}</div>
          if (item.type === 'colors') {
            return (
              <div key={i} className="ctx-colors-block">
                <div className="ctx-colors">
                  {NODE_COLORS.map((c) => (
                    <button
                      key={c}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                      onClick={() => {
                        item.onPick(c)
                        onClose()
                      }}
                    />
                  ))}
                  {/* The seven presets are the fast path, not the whole vocabulary. This opens the
                      full picker in place — the same component Settings uses, so every format it
                      understands works here too. */}
                  <button
                    className={`ctx-colors__custom${customOpen ? ' is-open' : ''}`}
                    aria-expanded={customOpen}
                    aria-label="Custom colour"
                    title="Custom colour…"
                    onClick={() => setCustomOpen((o) => !o)}
                  />
                  {/* The rainbow sits in the swatch row rather than behind the custom picker, and
                      that placement is the decision: it is a CHOICE of colour, not a way of
                      composing one, so hiding it inside the full picker would file it under the
                      wrong idea. It is deliberately not a member of NODE_COLORS — several call
                      sites build a tint by appending alpha to the stored value, and a sentinel
                      there yields `rainbow33`, which is not an error but an ignored declaration,
                      so the surface would render with no background and nothing would say why.
                      See renderer/lib/nodeColor.ts. */}
                  <button
                    className={`nt-rainbow-swatch ctx-colors__rainbow${isRainbowColor(item.value) ? ' is-active' : ''}`}
                    aria-label="Rainbow, cycles continuously"
                    aria-pressed={isRainbowColor(item.value)}
                    title="Rainbow — cycles continuously. Speed is in Settings."
                    onClick={() => {
                      item.onPick(RAINBOW_COLOR)
                      onClose()
                    }}
                  />
                </div>
                {customOpen && (
                  <ColorPicker
                    className="ctx-colors__picker"
                    label="Node colour"
                    allowAlpha={false}
                    value={customColor ?? item.value ?? NODE_COLORS[0]}
                    // Applied live on every drag, and the menu deliberately stays open: a colour is
                    // chosen by SEEING it on the node, and a picker that dismissed itself on the
                    // first change would make that impossible. Dismiss via the backdrop or Escape.
                    onChange={(next) => {
                      setCustomColor(next)
                      item.onPick(next)
                    }}
                  />
                )}
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
                  cancelFlyoutClose()
                  flyoutPointerInside.current = true
                  setOpenSub(i)
                  if (filterable)
                    menuFilter.setActiveIndex(
                      menuFilter.filtered.findIndex((fi) => fi.id === String(i))
                    )
                }}
                onMouseLeave={() => {
                  flyoutPointerInside.current = false
                  scheduleFlyoutClose()
                }}
              >
                <button
                  ref={openSub === i ? flyoutTriggerRef : undefined}
                  id={triggerId}
                  type="button"
                  role="menuitem"
                  className={`ctx-item ctx-item--submenu${filterable && menuFilter.filtered[menuFilter.activeIndex]?.id === String(i) ? ' kbd-active' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={openSub === i}
                  aria-controls={submenuId}
                  onClick={() => {
                    cancelFlyoutClose()
                    flyoutPointerInside.current = true
                    setOpenSub((cur) => (cur === i ? null : i))
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ArrowRight' ||
                      event.key === 'ArrowDown' ||
                      event.key === 'Enter' ||
                      event.key === ' '
                    ) {
                      event.preventDefault()
                      cancelFlyoutClose()
                      flyoutPointerInside.current = true
                      keyboardOpenedSub.current = i
                      setOpenSub(i)
                    } else if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                      event.preventDefault()
                      setOpenSub(null)
                      flyoutPointerInside.current = false
                      cancelFlyoutClose()
                    }
                  }}
                >
                  <span className="ctx-icon">{item.icon}</span>
                  <MenuItemLabel item={item} />
                </button>
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
      {flyoutPortal}
    </>,
    document.body
  )
}
