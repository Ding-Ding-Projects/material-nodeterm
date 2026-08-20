// @vitest-environment jsdom
// Renders the REAL StatusSurface — which also proves, through the same Vite pipeline the build
// uses, that the ?raw imports of docs/assets/shots/capture-manifest.json and package.json resolve
// from above the renderer root (the typecheck alone cannot prove a file exists). The interaction
// tests exist because "decorative-looking UI must be functional": the evidence toggle and the
// state-filter chips are controls, so they are exercised, not admired.
//
// Assertions are deliberately DATA-INDEPENDENT where the underlying repo data can legitimately
// change (the capture manifest's verdict, the release state). What can never change by data alone:
// the unrecorded gates (typecheck, tests, …) are UNRUN by construction, so those anchor the tests.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { StatusSurface } from '../StatusSurface'
import { UNRECORDED_GATES } from '../../../shared/project-status'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('StatusSurface', () => {
  let host: HTMLElement
  let root: Root

  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(<StatusSurface />)
    })
  }

  const cards = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.status-card')]
  const cardByTitle = (title: string): HTMLElement => {
    const card = cards().find((c) => c.querySelector('.status-card__title')?.textContent === title)
    if (!card) throw new Error(`no card titled "${title}" is rendered`)
    return card
  }
  const click = async (el: HTMLElement): Promise<void> => {
    await act(async () => {
      el.click()
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('renders one card per gate from the real bundled evidence, unrecorded gates included', async () => {
    await render()
    // captures + release + every unrecorded gate.
    expect(cards().length).toBe(2 + UNRECORDED_GATES.length)
    for (const spec of UNRECORDED_GATES) {
      const card = cardByTitle(spec.title)
      // Unrun by construction — the emoji/label must never upgrade an unrecorded verdict.
      expect(card.querySelector('.status-chip')?.textContent).toBe('Unrun')
      expect(card.textContent).toContain('unrun, not passed')
    }
    // The heartbeat line is present, so the surface is visibly current about its own ages.
    expect(host.textContent).toContain('Viewing at')
  })

  it('the evidence toggle is a real control: aria-expanded flips and the facts appear', async () => {
    await render()
    const card = cardByTitle('Typecheck')
    const btn = card.querySelector<HTMLButtonElement>('.status-card__expand')
    if (!btn) throw new Error('no expand button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(card.querySelector('.status-card__detail')).toBeNull()
    await click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(card.querySelector('.status-card__detail')?.textContent).toContain('npm run typecheck')
    await click(btn)
    expect(card.querySelector('.status-card__detail')).toBeNull()
  })

  it('state-filter chips filter, and an expanded card stays expanded across filtering', async () => {
    await render()
    const total = cards().length
    // Expand an always-unrun card first.
    await click(cardByTitle('Test suite').querySelector<HTMLButtonElement>('.status-card__expand')!)
    // Filter to Unrun: the unrecorded gates stay, the release card (never unrun while the
    // changelog records a dated release) disappears.
    const unrunChip = [...host.querySelectorAll<HTMLButtonElement>('.status-filter-chip')].find((b) =>
      b.textContent?.includes('Unrun')
    )
    if (!unrunChip) throw new Error('no Unrun filter chip')
    await click(unrunChip)
    expect(unrunChip.getAttribute('aria-pressed')).toBe('true')
    const filtered = cards()
    expect(filtered.length).toBeLessThan(total)
    expect(filtered.length).toBeGreaterThanOrEqual(UNRECORDED_GATES.length)
    expect(cards().some((c) => c.querySelector('.status-card__title')?.textContent === 'Release')).toBe(false)
    // Back to All: the earlier expansion was not forgotten by filtering.
    const allChip = [...host.querySelectorAll<HTMLButtonElement>('.status-filter-chip')].find((b) =>
      b.textContent?.startsWith('All')
    )
    await click(allChip!)
    expect(cards().length).toBe(total)
    const testsCard = cardByTitle('Test suite')
    expect(testsCard.querySelector<HTMLButtonElement>('.status-card__expand')?.getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(testsCard.querySelector('.status-card__detail')).not.toBeNull()
  })

  it('the search field filters by title and carries the anchored regex builder affordance', async () => {
    await render()
    const input = host.querySelector<HTMLInputElement>('.md3-status-search__input')
    if (!input) throw new Error('no search input')
    // The anchored regex builder trigger sits beside the field, per the house search contract.
    expect(host.querySelector('.md3-status-search .md3-regex-trigger')).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Typecheck')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cards().length).toBe(1)
    expect(cards()[0].querySelector('.status-card__title')?.textContent).toBe('Typecheck')
  })
})
