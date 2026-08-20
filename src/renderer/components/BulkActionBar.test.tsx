// @vitest-environment jsdom
/**
 * Behavioral suite for the bulk-actions contract (docs/bulk-actions.md): the pure selection model
 * (`lib/bulkSelection.ts`), the reusable `BulkActionBar`, and the `BulkActionPreview` it opens
 * before every action runs. Until this file existed the contract was only asserted as *wired*
 * (a row in scripts/check-app-contract.mjs), never as *behaving*.
 *
 * The component half drives a small harness wired exactly per docs/bulk-actions.md §"Extending to
 * a new list" — the same shape SessionMemoryPanel and LocalHistoryPanel use (checkbox per row,
 * shift-click ranges through `selectRange`, prune on refresh) — so the reusable pieces are tested
 * through their real documented integration, not through invented props.
 *
 * Contract clauses covered here, in the brief's own words:
 *  - multi-select via click and shift-click RANGES ................ pure + component tests
 *  - a keyboard equivalent ........................................ native checkbox (see the
 *    keyboard test's comment for what is and is NOT satisfiable — reported as a partial gap)
 *  - select-all states plainly THIS PAGE vs EVERY MATCH ........... label test ("N matching";
 *    no list in this repo paginates, per the module's own header note)
 *  - inverse selection ............................................ pure + component tests
 *  - exact affected COUNT before acting; "42 selected" vs
 *    "39 will change" .............................................. preview-message tests
 *  - never silently skip — what was excluded and why is reported .. excluded-list + merged
 *    onActionComplete tests
 *  - bulk search/filter composes with selection ................... filter harness tests
 */

import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BulkActionBar, type BulkAction } from './BulkActionBar'
import { resetDialogStack } from './dialog-stack'
import { CONFIRM_ARM_MS } from './confirm-key'
import {
  clearSelection,
  emptySelection,
  invertSelection,
  isSelected,
  pruneSelection,
  selectAll,
  selectRange,
  toggleOne,
  type BulkSelectionState
} from '../lib/bulkSelection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------------------------------------------------------------------------------------------
// Pure selection model
// ---------------------------------------------------------------------------------------------

describe('bulkSelection (pure model)', () => {
  it('click toggles one row on and off, and the anchor follows the last deliberate click', () => {
    let s = toggleOne(emptySelection(), 'a')
    expect(isSelected(s, 'a')).toBe(true)
    expect(s.anchor).toBe('a')
    s = toggleOne(s, 'b')
    expect([...s.selected].sort()).toEqual(['a', 'b'])
    expect(s.anchor).toBe('b')
    // Re-clicking deselects but STILL moves the anchor (Finder/Explorer/GMail convention).
    s = toggleOne(s, 'a')
    expect(isSelected(s, 'a')).toBe(false)
    expect(s.anchor).toBe('a')
  })

  it('shift-click selects the anchor→clicked range inclusive, in visibleIds order, both directions', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    let s = toggleOne(emptySelection(), 'b')
    s = selectRange(s, 'd', ids)
    expect([...s.selected].sort()).toEqual(['b', 'c', 'd'])
    expect(s.anchor).toBe('d')
    // Upward range from the new anchor.
    s = selectRange(s, 'a', ids)
    expect([...s.selected].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shift-click ranges track the CURRENT visible order, not an index captured at click time', () => {
    // Anchor on 'c' while the list read a,b,c,d — then the list is re-sorted to c,a,b,d.
    let s = toggleOne(emptySelection(), 'c')
    s = selectRange(s, 'b', ['c', 'a', 'b', 'd'])
    // Under the re-sorted order c..b spans {c,a,b}. Under the ORIGINAL order it would have been
    // just {b,c} — that difference is exactly the doc's claim about re-sorted/filtered lists.
    expect([...s.selected].sort()).toEqual(['a', 'b', 'c'])
  })

  it('shift-click with no anchor yet, or with an anchor no longer visible, falls back to a plain toggle', () => {
    const ids = ['a', 'b', 'c']
    let s = selectRange(emptySelection(), 'b', ids)
    expect([...s.selected]).toEqual(['b'])
    // Anchor filtered out of the current view → toggle, never a wild range.
    s = { selected: new Set(['x']), anchor: 'x' } as BulkSelectionState
    s = selectRange(s, 'c', ids)
    expect(isSelected(s, 'c')).toBe(true)
    expect(isSelected(s, 'a')).toBe(false)
    expect(isSelected(s, 'b')).toBe(false)
  })

  it('selectAll selects exactly the currently-matching ids ("every match", composed with the filter)', () => {
    const filtered = ['b', 'd']
    const s = selectAll(filtered)
    expect([...s.selected].sort()).toEqual(['b', 'd'])
  })

  it('invertSelection flips only the visible rows and leaves a filtered-out selection untouched', () => {
    const state: BulkSelectionState = { selected: new Set(['hidden', 'a']), anchor: 'a' }
    const s = invertSelection(state, ['a', 'b'])
    expect(isSelected(s, 'a')).toBe(false)
    expect(isSelected(s, 'b')).toBe(true)
    // 'hidden' is not in the current view — an inversion of what is visible does not touch it.
    expect(isSelected(s, 'hidden')).toBe(true)
  })

  it('pruneSelection drops ids that no longer exist so a stale id never lingers in the count', () => {
    const state: BulkSelectionState = { selected: new Set(['a', 'gone']), anchor: 'a' }
    const s = pruneSelection(state, ['a', 'b'])
    expect([...s.selected]).toEqual(['a'])
    // Nothing to drop → the SAME state object back (cheap no-op for React setState identity).
    expect(pruneSelection(s, ['a', 'b'])).toBe(s)
  })

  it('clearSelection empties both the set and the anchor', () => {
    const s = clearSelection()
    expect(s.selected.size).toBe(0)
    expect(s.anchor).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Component harness — the documented "Extending to a new list" wiring, verbatim
// ---------------------------------------------------------------------------------------------

interface Item {
  id: string
  name: string
}

const INITIAL_ITEMS: Item[] = [
  { id: '1', name: 'red' },
  { id: '2', name: 'green' },
  { id: '3', name: 'blue' },
  { id: '4', name: 'grey' }
]

function Harness({
  actions,
  onActionComplete
}: {
  actions: BulkAction<Item>[]
  onActionComplete?: (id: string, result: { succeeded: Item[]; failed: { item: Item; reason: string }[] }) => void
}): React.JSX.Element {
  const [items, setItems] = useState<Item[]>(INITIAL_ITEMS)
  const [filter, setFilter] = useState('')
  const [selection, setSelection] = useState<BulkSelectionState>(emptySelection())
  const visible = items.filter((i) => i.name.includes(filter))
  const visibleIds = visible.map((i) => i.id)
  const liveKey = items.map((i) => i.id).join(',')
  useEffect(() => {
    setSelection((s) => pruneSelection(s, liveKey ? liveKey.split(',') : []))
  }, [liveKey])
  return (
    <div>
      <input aria-label="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <BulkActionBar<Item>
        visible={visible}
        idOf={(i) => i.id}
        selectedIds={selection.selected}
        onSelectAll={() => setSelection(selectAll(visibleIds))}
        onInvert={() => setSelection(invertSelection(selection, visibleIds))}
        onClear={() => setSelection(clearSelection())}
        actions={actions}
        onActionComplete={onActionComplete}
      />
      <ul>
        {visible.map((i) => (
          <li key={i.id}>
            {/* The same wiring SessionMemoryPanel/LocalHistoryPanel use: a NATIVE checkbox (its
                keyboard operability — Space toggles — is the platform's), shift-click extends the
                range, onChange is a deliberate no-op because onClick already toggled. */}
            <input
              type="checkbox"
              aria-label={`Select ${i.name}`}
              checked={isSelected(selection, i.id)}
              onClick={(e) => {
                if (e.shiftKey) setSelection((s) => selectRange(s, i.id, visibleIds))
                else setSelection((s) => toggleOne(s, i.id))
              }}
              onChange={() => {}}
            />
            <button aria-label={`Remove ${i.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== i.id))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

let host: HTMLDivElement
let root: Root

function q<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`expected element for selector: ${selector}`)
  return el
}

function checkbox(name: string): HTMLInputElement {
  return q<HTMLInputElement>(`input[aria-label="Select ${name}"]`)
}

function click(el: Element): void {
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function shiftClick(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
  })
}

function setInput(el: HTMLInputElement, value: string): void {
  act(() => {
    // React redefines `.value` on the element instance to track it; a direct assignment updates
    // that tracker too, so the following event is deduped as "no change" and onChange never
    // fires. The prototype setter bypasses the instance tracker — the canonical way to drive a
    // controlled input from a test.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function countText(): string {
  return q('.bulk-bar__count').textContent ?? ''
}

function render(ui: React.ReactElement): void {
  act(() => {
    root.render(ui)
  })
}

function exportAction(overrides: Partial<BulkAction<Item>> = {}): {
  action: BulkAction<Item>
  run: ReturnType<typeof vi.fn>
} {
  const run = vi.fn(async (items: Item[]) => ({ succeeded: items, failed: [] as { item: Item; reason: string }[] }))
  const action: BulkAction<Item> = {
    id: 'export',
    label: 'Export selected',
    describe: (i) => i.name,
    run: run as unknown as BulkAction<Item>['run'],
    ...overrides
  }
  return { action, run }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  resetDialogStack()
  // The preview portals to document.body — never let one leak into the next test.
  document.querySelectorAll('.confirm-overlay').forEach((el) => el.remove())
})

describe('BulkActionBar selection surface', () => {
  it('states plainly that select-all means EVERY MATCH, with the live count in the label', () => {
    render(<Harness actions={[]} />)
    expect(q('.bulk-bar__select-all').textContent).toBe('Select all (4 matching)')
    // Filter → the stated universe follows the matches, not the whole list.
    setInput(q<HTMLInputElement>('input[aria-label="Filter rows"]'), 'gr')
    expect(q('.bulk-bar__select-all').textContent).toBe('Select all (2 matching)')
  })

  it('click and shift-click on rows drive multi-select through the bar count', () => {
    render(<Harness actions={[]} />)
    click(checkbox('red'))
    expect(countText()).toBe('1 selected')
    shiftClick(checkbox('blue'))
    expect(countText()).toBe('3 selected')
    expect(checkbox('green').checked).toBe(true)
    expect(checkbox('grey').checked).toBe(false)
  })

  it('rows are NATIVE checkboxes — the keyboard equivalent is the platform one (Space activates)', () => {
    // What is honestly assertable in jsdom: the row control is a real <input type="checkbox">
    // (focusable, standard Space-toggles semantics), and programmatic activation — the event a
    // keyboard Space produces — flows through the same selection handler as a mouse click.
    // What is NOT assertable here, and is reported as a contract gap in the suite's report:
    // range-extension has no dedicated keyboard path. In a real browser Shift+Space produces a
    // click with shiftKey=true so the same handler extends the range, but jsdom does not
    // synthesize activation clicks from keydown, and no arrow-key/Home/End selection exists.
    render(<Harness actions={[]} />)
    const box = checkbox('green')
    expect(box.tagName).toBe('INPUT')
    expect(box.type).toBe('checkbox')
    expect(box.tabIndex).toBe(0)
    click(box) // .click() is exactly what keyboard activation dispatches
    expect(countText()).toBe('1 selected')
  })

  it('invert flips the visible rows; clear empties; clear only renders while something is selected', () => {
    render(<Harness actions={[]} />)
    expect(document.querySelector('.bulk-bar__clear')).toBeNull()
    click(checkbox('red'))
    click(q('.bulk-bar__invert'))
    expect(countText()).toBe('3 selected')
    expect(checkbox('red').checked).toBe(false)
    expect(checkbox('green').checked).toBe(true)
    click(q('.bulk-bar__clear'))
    expect(countText()).toBe('0 selected')
    expect(document.querySelector('.bulk-bar__clear')).toBeNull()
  })

  it('the filter composes with selection: the count is the visible∩selected intersection', () => {
    render(<Harness actions={[]} />)
    click(checkbox('red'))
    click(checkbox('green'))
    expect(countText()).toBe('2 selected')
    // 'gr' matches green + grey; red is selected but filtered out → not counted, not actionable.
    setInput(q<HTMLInputElement>('input[aria-label="Filter rows"]'), 'gr')
    expect(countText()).toBe('1 selected')
    // Select-all under a filter = "select everything matching this query".
    click(q('.bulk-bar__select-all'))
    expect(countText()).toBe('2 selected')
    // Back to no filter: the select-all replaced the selection with the matching set.
    setInput(q<HTMLInputElement>('input[aria-label="Filter rows"]'), '')
    expect(countText()).toBe('2 selected')
    expect(checkbox('green').checked).toBe(true)
    expect(checkbox('grey').checked).toBe(true)
    expect(checkbox('red').checked).toBe(false)
  })

  it('a deleted row is pruned out of the selection — a stale id never lingers in the count', () => {
    render(<Harness actions={[]} />)
    click(checkbox('blue'))
    expect(countText()).toBe('1 selected')
    click(q('button[aria-label="Remove blue"]'))
    expect(countText()).toBe('0 selected')
  })

  it('select-all and invert are disabled when nothing matches', () => {
    render(<Harness actions={[]} />)
    setInput(q<HTMLInputElement>('input[aria-label="Filter rows"]'), 'zzz')
    expect(q<HTMLButtonElement>('.bulk-bar__select-all').disabled).toBe(true)
    expect(q<HTMLButtonElement>('.bulk-bar__invert').disabled).toBe(true)
  })
})

describe('BulkActionBar actions and the reviewable preview', () => {
  it('shows the exact count before acting: "Label: N items." when nothing is excluded', () => {
    const { action } = exportAction()
    render(<Harness actions={[action]} />)
    click(checkbox('red'))
    shiftClick(checkbox('green'))
    click(q('.bulk-bar__action'))
    expect(q('.confirm__msg').textContent).toContain('Export selected: 2 items.')
    expect(document.querySelector('.bulk-preview__excluded')).toBeNull()
  })

  it('names every excluded item with its reason, and states the counts truthfully', () => {
    const { action } = exportAction({
      excluded: (items) =>
        items.filter((i) => i.id === '3').map((item) => ({ item, reason: 'no node — nothing to end' }))
    })
    render(<Harness actions={[action]} />)
    click(checkbox('red'))
    shiftClick(checkbox('blue')) // red, green, blue selected; blue (id 3) will be excluded
    click(q('.bulk-bar__action'))
    // 3 selected, 1 excluded, so the contract sentence is "2 of 3 selected will change"
    // (docs/bulk-actions.md's own example is "3 of 5" for 5 selected / 2 excluded).
    //
    // This read "3 of 4" until the fix: the bar passed the FULL selection as the preview's
    // `items` while the preview ALSO added `excluded.length` on top, counting every excluded
    // row twice — more items than were selected, and one more "will change" than would.
    // contract sentence is "2 of 3 selected will change" (docs/bulk-actions.md's own example is
    // "3 of 5" for 5 selected / 2 excluded). But BulkActionBar passes the FULL selection as the
    // preview's `items` while BulkActionPreview ALSO adds `excluded.length` on top — so the
    // dialog claims "3 of 4 selected will change": more items than are selected, and one more
    // "will change" than actually will. The fix is to pass `selectedItems` minus the excluded
    // set as `items` (the same `runnable` filter confirmAction already applies before run()).
    expect(q('.confirm__msg').textContent).toContain('Export selected: 2 of 3 selected will change.')
    // Second symptom of the same defect: the excluded row used to appear in BOTH lists at
    // once. It belongs only in the excluded block.
    // change, so "blue" appears in both lists at once.
    const willChangeList = q('.bulk-preview__list:not(.bulk-preview__list--excluded)')
    expect(willChangeList.textContent).not.toContain('blue')
    // The excluded report itself is honest — every excluded item is named, with its reason.
    const excludedBlock = q('.bulk-preview__excluded')
    expect(excludedBlock.textContent).toContain('1 excluded — will NOT change:')
    expect(excludedBlock.textContent).toContain('blue')
    expect(excludedBlock.textContent).toContain('no node — nothing to end')
  })

  it('confirm runs the action over ONLY the runnable items and reports exclusions merged into failed', async () => {
    const onComplete = vi.fn()
    const { action, run } = exportAction({
      excluded: (items) =>
        items.filter((i) => i.id === '3').map((item) => ({ item, reason: 'no node — nothing to end' })),
      run: vi.fn(async (items: Item[]) => ({
        succeeded: items.filter((i) => i.id !== '2'),
        failed: items.filter((i) => i.id === '2').map((item) => ({ item, reason: 'disk full' }))
      })) as unknown as BulkAction<Item>['run']
    })
    render(<Harness actions={[action]} onActionComplete={onComplete} />)
    click(checkbox('red'))
    shiftClick(checkbox('blue'))
    click(q('.bulk-bar__action'))
    await act(async () => {
      q<HTMLButtonElement>('.confirm__btn.primary').click()
    })
    // The excluded row never reached run().
    const ranWith = (action.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as Item[]
    expect(ranWith.map((i) => i.id).sort()).toEqual(['1', '2'])
    void run
    // The summary is COMPLETE: up-front exclusions merged with run-time failures, reasons intact.
    expect(onComplete).toHaveBeenCalledTimes(1)
    const [, result] = onComplete.mock.calls[0]
    expect(result.succeeded.map((i: Item) => i.id)).toEqual(['1'])
    expect(
      result.failed.map((f: { item: Item; reason: string }) => `${f.item.id}:${f.reason}`).sort()
    ).toEqual(['2:disk full', '3:no node — nothing to end'])
  })

  it('cancel closes the preview without running anything', () => {
    const { action, run } = exportAction()
    render(<Harness actions={[action]} />)
    click(checkbox('red'))
    click(q('.bulk-bar__action'))
    click(q('.confirm__btn:not(.primary):not(.danger)'))
    expect(document.querySelector('.confirm-overlay')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('a disabled action names its reason (title + aria-disabled), never a bare dead button', () => {
    const { action, run } = exportAction({
      disabledReason: () => 'Only orphaned rows are selected'
    })
    render(<Harness actions={[action]} />)
    click(checkbox('red'))
    const btn = q<HTMLButtonElement>('.bulk-bar__action')
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe('Only orphaned rows are selected')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(run).not.toHaveBeenCalled()
  })

  it('Enter may confirm a NON-destructive preview once armed, but never a destructive one', async () => {
    vi.useFakeTimers({ now: Date.now() })
    try {
      // Non-destructive: Enter (aimed at the dialog, after CONFIRM_ARM_MS) confirms.
      const nonDestructive = exportAction()
      render(<Harness actions={[nonDestructive.action]} />)
      click(checkbox('red'))
      click(q('.bulk-bar__action'))
      act(() => {
        vi.advanceTimersByTime(CONFIRM_ARM_MS + 100)
      })
      await act(async () => {
        q('.confirm').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(nonDestructive.run).toHaveBeenCalledTimes(1)
      expect(document.querySelector('.confirm-overlay')).toBeNull()

      // Destructive: the same armed Enter is refused; only the explicit click runs it.
      const destructive = exportAction({ id: 'kill', label: 'End sessions', destructive: true })
      render(<Harness actions={[destructive.action]} />)
      click(checkbox('green'))
      click(q('.bulk-bar__action'))
      act(() => {
        vi.advanceTimersByTime(CONFIRM_ARM_MS + 100)
      })
      await act(async () => {
        q('.confirm').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(destructive.run).not.toHaveBeenCalled()
      expect(q<HTMLButtonElement>('.confirm__btn.danger')).toBeTruthy()
      await act(async () => {
        q<HTMLButtonElement>('.confirm__btn.danger').click()
      })
      expect(destructive.run).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a second submit while a slow run is in flight — disabled control AND re-entry guard', async () => {
    // Both halves are required, and this used to have neither. BulkActionPreview only relabelled
    // the confirm button "Working…" while leaving it live, and confirmAction only checked
    // `pending`, which stays set until the run settles — so a second click invoked run() again
    // over the same rows. A disabled button is the visible guard, never the real one: a keyboard
    // submit walks straight past it, which is why the handler refuses re-entry too.
    const resolvers: ((r: { succeeded: Item[]; failed: { item: Item; reason: string }[] }) => void)[] = []
    const run = vi.fn(
      () =>
        new Promise<{ succeeded: Item[]; failed: { item: Item; reason: string }[] }>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const { action } = exportAction({ run: run as unknown as BulkAction<Item>['run'] })
    render(<Harness actions={[action]} />)
    click(checkbox('red'))
    click(q('.bulk-bar__action'))
    await act(async () => {
      q<HTMLButtonElement>('.confirm__btn.primary').click()
    })
    expect(run).toHaveBeenCalledTimes(1)
    const busyBtn = q<HTMLButtonElement>('.confirm__btn.primary')
    expect(busyBtn.textContent).toBe('Working…')
    expect(busyBtn.disabled).toBe(true) // the visible guard
    await act(async () => {
      busyBtn.click()
    })
    expect(run).toHaveBeenCalledTimes(1) // still once: the second submit was refused
    await act(async () => {
      resolvers.forEach((r) => r({ succeeded: [], failed: [] }))
    })
  })
})
