import { describe, expect, it } from 'vitest'
import { isFilterableMenu, menuRowVisibility } from './menuVisibility'
import type { MenuItem } from '../ContextMenu'

const noop = (): void => {}

/** Plain substring test — mirrors `useRegexSearchField`'s text-mode contract (case-insensitive
 *  substring; empty query matches everything) without pulling the hook into a pure-function test. */
function substringTest(query: string): (label: string) => boolean {
  const q = query.trim().toLowerCase()
  return (label: string) => q === '' || label.toLowerCase().includes(q)
}

function item(label: string, extra?: Partial<MenuItem>): MenuItem {
  return { label, onClick: noop, ...extra } as MenuItem
}

const sep: MenuItem = { type: 'separator' }
const label = (label: string): MenuItem => ({ type: 'label', label })
const colors: MenuItem = { type: 'colors', onPick: noop }
const submenu = (label: string, children: MenuItem[]): MenuItem => ({
  type: 'submenu',
  label,
  children
})

describe('isFilterableMenu', () => {
  it('counts only actionable rows (items/submenus), not separators or labels', () => {
    // 7 actionable rows wrapped in structural padding — was NOT filterable under the old
    // "every entry, including separators" count at the same threshold.
    const items: MenuItem[] = [
      label('Section'),
      ...Array.from({ length: 7 }, (_, i) => item(`Row ${i}`)),
      sep
    ]
    expect(isFilterableMenu(items)).toBe(true)
  })

  it('stays non-filterable for a small sectioned menu', () => {
    const items: MenuItem[] = [label('Section'), item('A'), item('B'), sep, item('C')]
    expect(isFilterableMenu(items)).toBe(false)
  })

  it('does not let structural padding alone push a menu over the threshold', () => {
    // 8 total rows, but only 3 are actionable — the rest is labels/separators. A count that
    // includes structural rows would wrongly call this filterable at the same threshold.
    const items: MenuItem[] = [
      label('One'),
      item('A'),
      sep,
      label('Two'),
      item('B'),
      sep,
      label('Three'),
      item('C')
    ]
    expect(isFilterableMenu(items)).toBe(false)
  })

  it('counts a submenu trigger as one actionable row, not its children', () => {
    const items: MenuItem[] = [
      submenu('Profiles', [item('p1'), item('p2'), item('p3'), item('p4'), item('p5')]),
      item('A'),
      item('B'),
      item('C'),
      item('D'),
      item('E')
    ]
    // 6 top-level actionable rows — at the threshold, not over it.
    expect(isFilterableMenu(items)).toBe(false)
  })
})

describe('menuRowVisibility', () => {
  it('matches a plain item on its own label', () => {
    const items = [item('Alpha'), item('Beta')]
    expect(menuRowVisibility(items, substringTest('alp'), true)).toEqual([true, false])
  })

  it('shows every row for an empty query', () => {
    const items = [item('Alpha'), sep, item('Beta')]
    expect(menuRowVisibility(items, substringTest(''), false)).toEqual([true, true, true])
  })

  it('matches a submenu on its own label', () => {
    const items = [submenu('Restart with profile', [item('x')]), item('Other')]
    expect(menuRowVisibility(items, substringTest('restart'), true)).toEqual([true, false])
  })

  it('matches a submenu on a CHILD label even when the trigger label does not match', () => {
    const items = [submenu('New terminal with profile', [item('PowerShell 7'), item('Git Bash')])]
    // "powershell" appears only inside a child — the trigger row must still show, or the query
    // hides the only way to reach the thing it named.
    expect(menuRowVisibility(items, substringTest('powershell'), true)).toEqual([true])
  })

  it('hides a colors row once a query is active, shows it for an empty query', () => {
    const items = [colors]
    expect(menuRowVisibility(items, substringTest(''), false)).toEqual([true])
    expect(menuRowVisibility(items, substringTest('anything'), true)).toEqual([false])
  })

  it('hides a section label when nothing under it survives', () => {
    const items = [label('Group'), item('Alpha'), item('Beta'), label('Other'), item('Gamma')]
    // Query matches only "Gamma" — "Group" heading has nothing left under it.
    const visible = menuRowVisibility(items, substringTest('gamma'), true)
    expect(visible).toEqual([false, false, false, true, true])
  })

  it('keeps a section label visible when ANY row under it survives', () => {
    const items = [label('Group'), item('Alpha'), item('Beta')]
    const visible = menuRowVisibility(items, substringTest('beta'), true)
    expect(visible).toEqual([true, false, true])
  })

  it('drops a separator left dangling by filtered-out neighbors, via tidySeparators', () => {
    const items = [item('Alpha'), sep, item('Beta'), sep, item('Gamma')]
    // Only "Gamma" contains "mm" — Alpha/Beta and both separators around them must disappear
    // along with it, leaving a single surviving row with no dangling rule beside it.
    const visible = menuRowVisibility(items, substringTest('mm'), true)
    expect(visible).toEqual([false, false, false, false, true])
  })

  it('collapses two separators either side of one surviving section into a single rule', () => {
    const items = [item('Alpha'), sep, label('Group'), item('Beta'), sep, item('Gamma')]
    const visible = menuRowVisibility(items, substringTest('beta'), true)
    // Alpha gone, "Group"+"Beta" survive, Gamma gone — exactly one separator should remain
    // between Alpha's slot and the surviving section, none dangling at the tail.
    const sepIndices = [1, 4]
    const survivingSeps = sepIndices.filter((i) => visible[i])
    expect(survivingSeps.length).toBeLessThanOrEqual(1)
    expect(visible[2]).toBe(true) // label
    expect(visible[3]).toBe(true) // item
    expect(visible[5]).toBe(false) // Gamma filtered out
  })
})
