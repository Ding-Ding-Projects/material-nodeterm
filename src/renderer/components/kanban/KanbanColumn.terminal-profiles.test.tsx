// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { KanbanColumn } from './KanbanColumn'
import type { KanbanCreateOption } from './KanbanView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const options: KanbanCreateOption[] = [
  {
    key: 'terminal',
    label: 'Terminal',
    choice: { kind: 'terminal' },
    icon: <span>T</span>
  },
  {
    type: 'submenu',
    key: 'terminal-profile',
    label: 'New terminal with profile…',
    icon: <span>T</span>,
    children: [
      {
        key: 'pwsh',
        label: 'PowerShell 7',
        choice: { kind: 'terminal', profileId: 'pwsh' },
        icon: <span>P</span>
      },
      {
        key: 'missing-wsl',
        label: 'WSL — Missing Linux',
        choice: { kind: 'terminal', profileId: 'wsl:Missing Linux' },
        icon: <span>W</span>,
        disabled: true,
        hint: 'The distribution is no longer installed.'
      }
    ]
  }
]

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const hit = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label)
  )
  if (!hit) throw new Error(`missing button ${label}`)
  return hit
}

describe('KanbanColumn terminal profile creation', () => {
  it('keeps default creation direct and passes an explicit stable profile from the drill-in submenu', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onCreate = vi.fn()
    act(() =>
      root.render(
        <KanbanColumn
          column={null}
          cards={[]}
          onOpenCard={() => {}}
          metaOf={() => undefined}
          labelsOf={() => []}
          terminalProfileOf={() => undefined}
          createOptions={options}
          onCreate={onCreate}
          onCardDragStart={() => {}}
          onDragEnd={() => {}}
          onDropOnColumn={() => {}}
          onDropAtCard={() => {}}
          onCardContext={() => {}}
        />
      )
    )

    act(() => button(host, '+ New session').click())
    act(() => button(host, 'Terminal').click())
    expect(onCreate).toHaveBeenLastCalledWith({ kind: 'terminal' }, null)

    act(() => button(host, '+ New session').click())
    act(() => button(host, 'New terminal with profile').click())
    expect(document.activeElement?.textContent).toContain('Back to new sessions')
    act(() => button(host, 'PowerShell 7').click())
    expect(onCreate).toHaveBeenLastCalledWith({ kind: 'terminal', profileId: 'pwsh' }, null)

    act(() => root.unmount())
    host.remove()
  })

  it('keeps an unavailable profile inert and exposes its reason to keyboard users', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onCreate = vi.fn()
    act(() =>
      root.render(
        <KanbanColumn
          column={null}
          cards={[]}
          onOpenCard={() => {}}
          metaOf={() => undefined}
          labelsOf={() => []}
          terminalProfileOf={() => undefined}
          createOptions={options}
          onCreate={onCreate}
          onCardDragStart={() => {}}
          onDragEnd={() => {}}
          onDropOnColumn={() => {}}
          onDropAtCard={() => {}}
          onCardContext={() => {}}
        />
      )
    )

    act(() => button(host, '+ New session').click())
    act(() => button(host, 'New terminal with profile').click())
    const unavailable = button(host, 'WSL — Missing Linux')
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')
    expect(unavailable.textContent).toContain('The distribution is no longer installed.')
    act(() => unavailable.click())
    expect(onCreate).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })
})
