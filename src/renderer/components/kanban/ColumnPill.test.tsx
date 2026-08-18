// @vitest-environment jsdom
// The pill's fill is a WASH of the column colour, and a wash built by appending a hex alpha suffix
// (`${column.color}2e`) is only a colour when the string is 6-digit hex. These tests render the
// real component and ask the DOM what it got, because that is the only place the defect is visible:
// an unparsable value makes CSS drop the whole `background` declaration — border and text stay
// correct, the fill just silently disappears, and nothing anywhere reports an error.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Project } from '@shared/types'
import { parseAnyColor } from '@renderer/lib/color/convert'
import { useProjects } from '../../state/projects'
import { ColumnPill } from './ColumnPill'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const project = (columnColor: string): Project => ({
  id: 'p1',
  name: 'P',
  color: '#0a84ff',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  kanban: {
    columns: [{ id: 'c1', title: 'Doing', color: columnColor }],
    assignments: [{ nodeId: 'n1', columnId: 'c1' }]
  }
})

describe('ColumnPill fill survives a non-hex column colour', () => {
  let host: HTMLElement
  let root: Root

  const renderWith = async (columnColor: string): Promise<HTMLButtonElement> => {
    useProjects.setState({ projects: [project(columnColor)], activeProjectId: 'p1' })
    await act(async () => {
      root.render(<ColumnPill nodeId="n1" />)
    })
    const btn = host.querySelector('button.kanban-node-pill')
    if (!btn) throw new Error('no pill rendered')
    return btn as HTMLButtonElement
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

  it('keeps the exact wash a 6-digit hex column already produced', async () => {
    // 0x2e = 46/255 — the pixels this pill has always had, unchanged by the fix.
    const btn = await renderWith('#0a84ff')
    expect(btn.style.background).toBe('rgba(10, 132, 255, 0.18)')
    expect(btn.style.borderColor).toBe('rgb(10, 132, 255)')
  })

  it('still fills when the column colour is not hex', async () => {
    // The discriminating case: `"rgb(10, 132, 255)" + "2e"` is not a colour, so the browser (and
    // jsdom) refuses the declaration outright and the pill renders with NO background at all.
    const btn = await renderWith('rgb(10, 132, 255)')
    expect(btn.style.background).not.toBe('')
    expect(parseAnyColor(btn.style.background)).not.toBeNull()
    expect(btn.style.background).toBe('rgba(10, 132, 255, 0.18)')
  })

  it('renders no pill at all for an unassigned node', async () => {
    // Guards the fixture itself: if this were not empty, the two assertions above could be passing
    // on a pill that was never actually driven by the column colour they set.
    useProjects.setState({ projects: [project('#0a84ff')], activeProjectId: 'p1' })
    await act(async () => {
      root.render(<ColumnPill nodeId="not-on-the-board" />)
    })
    expect(host.querySelector('button.kanban-node-pill')).toBeNull()
  })
})
