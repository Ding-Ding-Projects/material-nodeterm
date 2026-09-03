import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Supply the ARIA tabs keyboard contract to an existing `role="tablist"` container.
 *
 * `Tabs.tsx` is the canonical primitive and remains the right choice for a new tab strip. This
 * exists for the strips already built out of another Material primitive -- a chip set, a segmented
 * row -- where the visual is legitimate and only the interaction was missing. Rewriting those into
 * `Tabs` would change their appearance in eighteen places nobody has captured yet; this changes
 * nothing on screen and adds exactly the behaviour the role promises.
 *
 * It is still ONE implementation of the contract, which is the property that matters. A per-file
 * `onKeyDown` is what produced eighteen strips that each announced themselves as tabs and then
 * ignored the arrow keys -- the announcement without the behaviour, which is worse than having no
 * role at all, because a screen-reader user is told the keys will work.
 *
 * What it does, per the APG Tabs pattern:
 *   - Arrow keys move along the rendered axis (Left/Right, or Up/Down when vertical).
 *   - Home/End jump to the first and last enabled tab.
 *   - Exactly one tab sits in the tab order (roving `tabIndex`), so Tab enters and leaves the set
 *     instead of walking through every tab inside it.
 *
 * It reads the tabs out of the DOM on each interaction rather than from a list passed in, because
 * a caller's tab set is often conditional and a captured array goes stale the moment one is
 * hidden. Disabled tabs are skipped: focusing a tab that cannot be activated is a dead end the
 * keyboard user then has to arrow back out of.
 */
export function useTablistKeys(
  ref: RefObject<HTMLElement | null>,
  orientation: 'horizontal' | 'vertical' = 'horizontal'
): void {
  useEffect(() => {
    const container = ref.current
    if (!container) return

    const tabs = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
        (tab) => !tab.hasAttribute('disabled') && tab.getAttribute('aria-disabled') !== 'true'
      )

    /**
     * Keep exactly one tab in the tab order.
     *
     * Selection is the caller's state, so this follows `aria-selected` rather than owning it. When
     * nothing is selected the first tab takes the tab stop, so the set is always reachable.
     */
    const rove = (): void => {
      const all = tabs()
      const selectedIndex = all.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
      const stop = selectedIndex >= 0 ? selectedIndex : 0
      all.forEach((tab, index) => {
        tab.tabIndex = index === stop ? 0 : -1
      })
    }

    const activate = (tab: HTMLElement | undefined): void => {
      if (!tab) return
      tab.focus()
      // Click is what the caller already listens for, so selection stays the caller's business and
      // this never has to know how their state is shaped.
      tab.click()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const current = target?.closest<HTMLElement>('[role="tab"]')
      if (!current || !container.contains(current)) return

      const all = tabs()
      const index = all.indexOf(current)
      if (index < 0 || all.length === 0) return

      const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
      const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

      if (event.key === forward) {
        event.preventDefault()
        activate(all[(index + 1) % all.length])
      } else if (event.key === backward) {
        event.preventDefault()
        activate(all[(index - 1 + all.length) % all.length])
      } else if (event.key === 'Home') {
        event.preventDefault()
        activate(all[0])
      } else if (event.key === 'End') {
        event.preventDefault()
        activate(all[all.length - 1])
      }
    }

    container.setAttribute('aria-orientation', orientation)
    rove()

    container.addEventListener('keydown', onKeyDown)
    // Selection and the tab set both change underneath this -- a conditional tab appears, the
    // caller selects another one -- and the tab order has to follow. Watching the subtree is
    // cheaper and more reliable than asking every caller to re-run it.
    const observer = new MutationObserver(rove)
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'disabled', 'aria-disabled']
    })

    return () => {
      container.removeEventListener('keydown', onKeyDown)
      observer.disconnect()
    }
  }, [orientation, ref])
}
