// @vitest-environment jsdom
// The selected priority chip is filled with a WASH of that priority's colour. Built by appending a
// hex alpha suffix (`${pr.color}2e`) that wash is only a colour while PRIORITIES stays 6-digit hex:
// the day anyone widens the palette to anything the app's own picker can emit, the chip keeps its
// border and text and loses its fill, with no error anywhere. These render the real component and
// read the DOM back, because that silent drop is only observable there.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ProjectKanban } from '@shared/types'
import { parseAnyColor } from '@renderer/lib/color/convert'
import { CardMetaBar, PRIORITIES } from './CardMetaBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const board: ProjectKanban = {
  columns: [{ id: 'c1', title: 'Doing', color: '#0a84ff' }],
  assignments: [{ nodeId: 'n1', columnId: 'c1' }],
  meta: [{ nodeId: 'n1', priority: 'urgent' }]
}

describe('CardMetaBar priority chip fill', () => {
  let host: HTMLElement
  let root: Root

  const renderBar = async (): Promise<HTMLElement> => {
    await act(async () => {
      root.render(<CardMetaBar nodeId="n1" board={board} onChange={() => {}} />)
    })
    const on = host.querySelector('.kanban-prio--on')
    if (!on) throw new Error('no selected priority chip rendered')
    return on as HTMLElement
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

  it('keeps the exact wash the 6-digit hex presets already produced', async () => {
    // 0x2e = 46/255 against Urgent's #ff453a — the pixels this chip has always had.
    const chip = await renderBar()
    expect(chip.style.background).toBe('rgba(255, 69, 58, 0.18)')
    expect(chip.style.borderColor).toBe('rgb(255, 69, 58)')
  })

  it('still fills when a priority colour is not hex', async () => {
    // Simulates the exact future change that makes this latent bug real — a priority colour that
    // came from the app's own picker rather than the shipped hex preset. `"rgb(255, 69, 58)2e"` is
    // not a colour, so the declaration is dropped entirely and the chip renders unfilled.
    const urgent = PRIORITIES.find((p) => p.id === 'urgent')
    if (!urgent) throw new Error('no urgent priority')
    const original = urgent.color
    try {
      urgent.color = 'rgb(255, 69, 58)'
      const chip = await renderBar()
      expect(chip.style.background).not.toBe('')
      expect(parseAnyColor(chip.style.background)).not.toBeNull()
      expect(chip.style.background).toBe('rgba(255, 69, 58, 0.18)')
    } finally {
      urgent.color = original
    }
  })

  it('leaves unselected priority chips unstyled', async () => {
    // Fixture check: the assertions above must be reading the SELECTED chip's own style, not a
    // blanket one every chip would have carried anyway.
    await renderBar()
    const off = [...host.querySelectorAll('.kanban-prio')].filter(
      (el) => !el.classList.contains('kanban-prio--on')
    )
    expect(off.length).toBe(PRIORITIES.length - 1)
    for (const el of off) expect((el as HTMLElement).style.background).toBe('')
  })
})
