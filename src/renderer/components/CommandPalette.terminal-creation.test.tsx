// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultTerminalCreationHandler,
  terminalProfileCreationActions,
  type AddTerminalFromSurface
} from '../lib/terminal-creation-surfaces'
import { CommandPalette, type Command } from './CommandPalette'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

function render(commands: Command[]): ReturnType<typeof vi.fn> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onClose = vi.fn()
  act(() => root?.render(<CommandPalette commands={commands} onClose={onClose} />))
  return onClose
}

function commandButton(label: string): HTMLButtonElement {
  const hit = [...document.body.querySelectorAll<HTMLButtonElement>('.palette__item')].find(
    (button) => button.textContent?.includes(label)
  )
  if (!hit) throw new Error(`missing command ${label}`)
  return hit
}

describe('CommandPalette terminal creation funnel', () => {
  it('dispatches the ordinary command with no profile argument', () => {
    const addTerminal = vi.fn<AddTerminalFromSurface>()
    const onClose = render([
      {
        id: 'new-term',
        label: 'New terminal',
        run: defaultTerminalCreationHandler(addTerminal)
      }
    ])

    act(() => commandButton('New terminal').click())

    expect(addTerminal).toHaveBeenCalledOnce()
    expect(addTerminal).toHaveBeenCalledWith()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dispatches an assembled profile command with the exact stable id only', () => {
    const addTerminal = vi.fn<AddTerminalFromSurface>()
    const [action] = terminalProfileCreationActions(addTerminal, [
      { id: 'wsl:Ubuntu Development', label: 'WSL — Ubuntu Development', disabled: false }
    ])
    if (!action) throw new Error('missing terminal profile action')
    const onClose = render([
      {
        id: action.id,
        label: `New terminal — ${action.label}`,
        disabled: action.disabled,
        note: action.note,
        run: action.run
      }
    ])

    act(() => commandButton('WSL — Ubuntu Development').click())

    expect(addTerminal).toHaveBeenCalledOnce()
    expect(addTerminal).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      'wsl:Ubuntu Development'
    )
    expect(onClose).toHaveBeenCalledOnce()
  })
})
