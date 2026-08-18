import { describe, expect, it } from 'vitest'
import { paneMenuGroup } from './paneMenuGroup'
import { isFilterableMenu, menuRowVisibility } from '../components/menu/menuVisibility'
import { tidySeparators } from '../lib/ui-visibility'
import type { MenuItem } from '../components/ContextMenu'

const noop = (): void => {}

function item(label: string): MenuItem {
  return { label, onClick: noop }
}

function submenu(label: string, children: MenuItem[]): MenuItem {
  return { type: 'submenu', label, children }
}

/** Plain substring matcher — mirrors `useRegexSearchField`'s text mode (case-insensitive
 *  substring, empty query matches everything) without pulling the hook into a pure test. */
function substringTest(query: string): (label: string) => boolean {
  const q = query.trim().toLowerCase()
  return (label: string) => q === '' || label.toLowerCase().includes(q)
}

/** A string is a valid ReactNode, so the icon can be a sentinel and this file stays plain TS. */
const ICON = 'group-icon'

describe('paneMenuGroup', () => {
  it('collapses a multi-row group into one submenu carrying the group icon', () => {
    const children = [item('New sticky note'), item('New browser'), item('Open file…')]
    expect(paneMenuGroup('Canvas objects', ICON, children)).toEqual([
      { type: 'submenu', label: 'Canvas objects', icon: ICON, children }
    ])
  })

  it('emits nothing for an empty group', () => {
    // Every builtin agent can be disabled in Settings, so "Agents" really does reach zero rows;
    // an empty submenu trigger would open onto nothing.
    expect(paneMenuGroup('Agents', ICON, [])).toEqual([])
  })

  it('leaves a single-row group as that bare row — no submenu, no heading', () => {
    const only = item('New worktree…')
    expect(paneMenuGroup('Worktree', ICON, [only])).toEqual([only])
  })

  it('keeps a group that contains a submenu as a labelled flat section', () => {
    // ContextMenu renders no second-level flyout: a `submenu` CHILD of a submenu is skipped
    // entirely. Nesting this group would silently delete the account picker, not indent it.
    const accounts = submenu('New Claude', [item('work@example.com'), item('personal')])
    const plain = item('New Codex')
    expect(paneMenuGroup('Agents', ICON, [accounts, plain])).toEqual([
      { type: 'label', label: 'Agents' },
      accounts,
      plain
    ])
  })

  it('preserves every row of a group it declines to nest', () => {
    const children = [
      submenu('New Claude', [item('work@example.com')]),
      item('New Codex'),
      item('New Gemini')
    ]
    const rows = paneMenuGroup('Agents', ICON, children)
    // The rows a nested submenu would have swallowed are all still reachable at top level.
    expect(rows.filter((row) => row.type !== 'label')).toEqual(children)
  })
})

describe('the restructured pane menu still filters', () => {
  /** The SMALLEST pane menu the builder in `Canvas.tsx` can produce: no agents enabled, no
   *  project cwd (so no "New file…"), no Windows profiles, too few nodes to tidy and no
   *  restartable agent. Mirrors that literal — update both together. */
  function minimalPaneMenu(): MenuItem[] {
    return tidySeparators<MenuItem>([
      item('New terminal'),
      item('New remote…'),
      ...paneMenuGroup('Agents', ICON, []),
      ...paneMenuGroup('Canvas objects', ICON, [
        item('New browser'),
        item('New sticky note'),
        item('New Loop'),
        item('New dino game'),
        item('Open file…')
      ]),
      ...paneMenuGroup('Worktree', ICON, [item('New worktree…')]),
      ...paneMenuGroup('Drawing', ICON, [
        item('Draw colored area'),
        item('Draw line'),
        item('Draw arrow')
      ]),
      { type: 'label', label: 'Canvas' },
      item('Select all'),
      item('Fit view')
    ])
  }

  it('keeps enough actionable rows to stay filterable at its smallest', () => {
    // Collapsing groups into submenus removes rows from the top level, and the filter field
    // disappears below the threshold. This is the case that gets closest to losing it.
    expect(isFilterableMenu(minimalPaneMenu())).toBe(true)
  })

  it('surfaces a submenu whose CHILD matches the query', () => {
    const items = minimalPaneMenu()
    const visible = menuRowVisibility(items, substringTest('sticky'), true)
    const shown = items.filter((_, i) => visible[i])
    expect(shown).toEqual([
      { type: 'submenu', label: 'Canvas objects', icon: ICON, children: expect.anything() }
    ])
  })

  it('hides a group whose label and children both miss', () => {
    const items = minimalPaneMenu()
    const visible = menuRowVisibility(items, substringTest('draw'), true)
    const shownLabels = items
      .filter((_, i) => visible[i])
      .map((row) => (row.type === 'separator' || row.type === 'colors' ? '' : row.label))
    expect(shownLabels).toEqual(['Drawing'])
  })

  it('keeps a declined group filterable through its own heading and rows', () => {
    const items = tidySeparators<MenuItem>([
      item('New terminal'),
      ...paneMenuGroup('Agents', ICON, [
        submenu('New Claude', [item('work@example.com')]),
        item('New Codex')
      ]),
      { type: 'label', label: 'Canvas' },
      item('Select all')
    ])
    const visible = menuRowVisibility(items, substringTest('codex'), true)
    // Heading + the matching row survive; the unrelated rows and the "Canvas" heading do not.
    expect(items.filter((_, i) => visible[i])).toEqual([
      { type: 'label', label: 'Agents' },
      item('New Codex')
    ])
  })

  it('leaves no dangling separator in the assembled menu', () => {
    const items = minimalPaneMenu()
    // Both the unfiltered build and a live filter run through tidySeparators; neither may leave a
    // rule with nothing above it, nothing below it, or another rule beside it.
    expect(items).toEqual(tidySeparators(items))
    const visible = menuRowVisibility(items, substringTest('new'), true)
    const shown = items.filter((_, i) => visible[i])
    expect(shown).toEqual(tidySeparators(shown))
  })
})
