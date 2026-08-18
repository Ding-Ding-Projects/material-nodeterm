// @vitest-environment jsdom
// A dino node's header is tinted with a wash of `data.color`, and `data.color` is a plain string a
// node context menu's full picker can set to `rgb(…)` / `oklch(…)` text. Appending a hex alpha
// suffix (`${data.color}33`) only yields a colour for 6-digit hex, so for every other picked value
// CSS drops the whole declaration: the border stays right and the header tint just vanishes. That
// is only observable in the DOM, so this renders the real component and reads the style back.
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseAnyColor } from '@renderer/lib/color/convert'
import { DinoNode } from './DinoNode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The game canvas, React Flow's node context and the presence session are all irrelevant to the
// header's colour — they are stubbed so this stays a test of the tint and nothing else.
vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ updateNodeData: vi.fn(), deleteElements: vi.fn() })
}))
vi.mock('./dino/dino-game', () => ({
  createDinoGame: () => ({
    isAuthority: () => true,
    setRemote: vi.fn(),
    destroy: vi.fn()
  })
}))
vi.mock('../session/session', () => ({
  useActiveSessionPresence: () => ({
    dino: vi.fn(),
    selectDino: () => null,
    store: (select: (s: { myId: string }) => unknown) => select({ myId: 'me' })
  })
}))

describe('DinoNode header tint survives a non-hex node colour', () => {
  let host: HTMLElement
  let root: Root

  const renderWith = async (color: string): Promise<HTMLElement> => {
    const props = {
      id: 'dino-1',
      data: { title: 'Dino', color },
      selected: false
    } as unknown as ComponentProps<typeof DinoNode>
    await act(async () => {
      root.render(<DinoNode {...props} />)
    })
    const header = host.querySelector('.dino-node__header')
    if (!header) throw new Error('no dino header rendered')
    return header as HTMLElement
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

  it('keeps the exact wash a 6-digit hex colour already produced', async () => {
    // 0x33 = 51/255 — the pixels this header has always had, unchanged by the fix.
    const header = await renderWith('#0a84ff')
    expect(header.style.background).toBe('rgba(10, 132, 255, 0.2)')
  })

  it('still tints when the picked colour is not hex', async () => {
    // The discriminating case: `"rgb(10, 132, 255)" + "33"` is not a colour, so the declaration is
    // refused outright and the header paints on the bare node background instead.
    const header = await renderWith('rgb(10, 132, 255)')
    expect(header.style.background).not.toBe('')
    expect(parseAnyColor(header.style.background)).not.toBeNull()
    expect(header.style.background).toBe('rgba(10, 132, 255, 0.2)')
  })

  it('degrades to no tint — never a wrong colour — for an unparsable colour', async () => {
    // A hand-edited .nodeterm/project.json is the realistic source. Painting the raw string would
    // be a solid header in a colour nobody chose; the honest outcome is the stylesheet's own.
    const header = await renderWith('not-a-colour')
    expect(header.style.background).toBe('')
  })
})
