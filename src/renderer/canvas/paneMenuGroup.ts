import type { ReactNode } from 'react'
import type { MenuItem } from '../components/ContextMenu'

/**
 * How one named group of the canvas PANE context menu is presented: as a real submenu, as a
 * labelled flat section, or as nothing at all.
 *
 * The pane menu used to render every group as a `label` heading over flat rows, which is still one
 * long list — ~17 rows deep. A submenu collapses a group to a single row, but it costs a hover (or
 * a click) to reach anything inside it, so the choice is not unconditional. Three rules, each of
 * which prevented a concrete failure:
 *
 * - **Empty group → nothing.** A heading (or a submenu trigger) with no rows under it claims a
 *   group that isn't there. "Agents" reaches zero rows for real: every builtin agent can be
 *   disabled individually in Settings, and a Kids-mode canvas can disable all of them.
 * - **One row → that row, top level, with no heading.** A submenu here is strictly worse than the
 *   bare row (an extra hover to reach exactly one thing), and a heading over a single
 *   self-describing row ("New worktree…") is pure chrome. This is why "Worktree" has no heading
 *   any more, and why a canvas with one enabled agent shows "New Claude" directly.
 * - **A group that already contains a submenu stays a labelled flat section.** `ContextMenu.tsx`
 *   renders a submenu's children itself and deliberately returns `null` for a child of type
 *   `submenu` (there is no second-level flyout); nesting such a group would therefore not "look
 *   nested", it would DELETE those rows with no error — the Claude/Codex per-account pickers and
 *   the Windows "New terminal with profile…" list are exactly the rows that vanish. Degrading to
 *   the previous, correct layout is the safe direction. If nested flyouts ever land in
 *   `ContextMenu.tsx`, this branch is the one to revisit.
 *
 * Children are action rows (plain items and submenu triggers); this does not try to interpret
 * separators or nested headings inside a group, because no pane-menu group builds one.
 */
export function paneMenuGroup(label: string, icon: ReactNode, children: MenuItem[]): MenuItem[] {
  if (children.length === 0) return []
  if (children.length === 1) return children
  if (children.some((child) => child.type === 'submenu')) {
    return [{ type: 'label', label }, ...children]
  }
  return [{ type: 'submenu', label, icon, children }]
}
