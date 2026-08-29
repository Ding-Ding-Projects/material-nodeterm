import { describe, expect, it } from 'vitest'
import { HIDEABLE_HEADER_BUTTONS, HIDEABLE_MENU_ITEMS, isHidden, tidySeparators } from './ui-visibility'

type Row = { type?: 'item' | 'separator' | 'label'; label?: string }
const item = (label: string): Row => ({ label })
const sep: Row = { type: 'separator' }
const label = (label: string): Row => ({ type: 'label', label })

describe('isHidden', () => {
  it('hides a hideable id that is listed', () => {
    expect(isHidden('duplicate', ['duplicate'])).toBe(true)
    expect(isHidden('mic', ['mic', 'comments'])).toBe(true)
  })
  it('shows everything when nothing is listed', () => {
    for (const { id } of [...HIDEABLE_MENU_ITEMS, ...HIDEABLE_HEADER_BUTTONS])
      expect(isHidden(id, [])).toBe(false)
  })
  it('never hides an id outside the hideable inventory, however the list got there', () => {
    for (const id of ['delete', 'restart-agent', 'search', 'close', 'branch'])
      expect(isHidden(id, [id])).toBe(false)
  })
  it('ignores unknown ids in the list', () => {
    expect(isHidden('duplicate', ['nonsense', 'duplicate'])).toBe(true)
    expect(isHidden('nonsense', ['nonsense'])).toBe(false)
  })
})

describe('hideable inventories', () => {
  it('list the agreed ids and nothing destructive', () => {
    expect(HIDEABLE_MENU_ITEMS.map((r) => r.id)).toEqual([
      'group', 'remove-from-group', 'colors', 'duplicate', 'snap-zone', 'align-grid', 'collapse',
      'markdown-view', 'refresh-terminal'
    ])
    expect(HIDEABLE_HEADER_BUTTONS.map((r) => r.id)).toEqual(['refresh', 'mic', 'ai-name', 'comments'])
  })
  it('gives every entry a user-facing label', () => {
    for (const { label } of [...HIDEABLE_MENU_ITEMS, ...HIDEABLE_HEADER_BUTTONS])
      expect(label.length).toBeGreaterThan(0)
  })
})

describe('tidySeparators', () => {
  it('keeps a separator strictly between two content rows', () => {
    const rows = [item('A'), sep, item('B')]
    expect(tidySeparators(rows)).toEqual([item('A'), sep, item('B')])
  })

  it('drops a leading separator', () => {
    expect(tidySeparators([sep, item('A')])).toEqual([item('A')])
  })

  it('drops a trailing separator', () => {
    expect(tidySeparators([item('A'), sep])).toEqual([item('A')])
  })

  it('collapses two adjacent separators into one', () => {
    // The first separator's `prev` is content, so it survives; the second one's `prev` (in the
    // ORIGINAL array) is a separator, so it drops. One rule between the blocks, not two.
    expect(tidySeparators([item('A'), sep, sep, item('B')])).toEqual([item('A'), sep, item('B')])
  })

  it('drops a separator directly under a section label (reads as a double line)', () => {
    expect(tidySeparators([label('Group'), sep, item('A')])).toEqual([label('Group'), item('A')])
  })

  it('leaves a menu with no separators untouched', () => {
    const rows = [label('Group'), item('A'), item('B')]
    expect(tidySeparators(rows)).toEqual(rows)
  })
})
