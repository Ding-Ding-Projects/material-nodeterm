import { describe, expect, it, vi } from 'vitest'
import {
  defaultTerminalCreationHandler,
  defaultTerminalShortcutAction,
  profileTerminalCreationHandler,
  terminalProfileCreationActions,
  type AddTerminalFromSurface
} from './terminal-creation-surfaces'

function addTerminalSpy(): ReturnType<typeof vi.fn<AddTerminalFromSurface>> {
  return vi.fn<AddTerminalFromSurface>()
}

describe('terminal creation surface funnels', () => {
  it.each(['keyboard', 'sidebar', 'Dock', 'command palette'])(
    '%s one-click creation leaves the profile argument absent so the saved default wins',
    () => {
      const addTerminal = addTerminalSpy()

      defaultTerminalCreationHandler(addTerminal)()

      expect(addTerminal).toHaveBeenCalledOnce()
      expect(addTerminal).toHaveBeenCalledWith()
    }
  )

  it('keeps the canvas context-menu point while leaving profile selection absent', () => {
    const addTerminal = addTerminalSpy()
    const center = { x: 125, y: 240 }

    defaultTerminalCreationHandler(addTerminal, { center })()

    expect(addTerminal).toHaveBeenCalledWith(center)
  })

  it('keeps the group context-menu point and parent while leaving profile selection absent', () => {
    const addTerminal = addTerminalSpy()
    const center = { x: 20, y: 40 }

    defaultTerminalCreationHandler(addTerminal, { center, groupId: 'group-1' })()

    expect(addTerminal).toHaveBeenCalledWith(center, undefined, 'group-1')
  })

  it.each(['Dock', 'command palette'])(
    '%s explicit selection forwards only the stable profile id in the fifth slot',
    () => {
      const addTerminal = addTerminalSpy()

      profileTerminalCreationHandler(addTerminal, 'wsl:Ubuntu Development')()

      expect(addTerminal).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        'wsl:Ubuntu Development'
      )
    }
  )

  it('preserves canvas and group context for explicit profile submenus', () => {
    const addTerminal = addTerminalSpy()
    const center = { x: 300, y: 450 }

    profileTerminalCreationHandler(addTerminal, 'pwsh', { center })()
    profileTerminalCreationHandler(addTerminal, 'cmd', { center, groupId: 'group-2' })()

    expect(addTerminal).toHaveBeenNthCalledWith(
      1,
      center,
      undefined,
      undefined,
      undefined,
      'pwsh'
    )
    expect(addTerminal).toHaveBeenNthCalledWith(
      2,
      center,
      undefined,
      'group-2',
      undefined,
      'cmd'
    )
  })

  it('assembles command/menu actions with stable ids and keeps unavailable choices inert', () => {
    const addTerminal = addTerminalSpy()
    const [available, unavailable] = terminalProfileCreationActions(addTerminal, [
      { id: 'pwsh', label: 'PowerShell 7', disabled: false },
      {
        id: 'wsl:Missing Linux',
        label: 'WSL — Missing Linux',
        disabled: true,
        hint: 'The distribution is no longer installed.'
      }
    ])

    expect(available).toMatchObject({
      id: 'new-term-profile:pwsh',
      profileId: 'pwsh',
      label: 'PowerShell 7',
      disabled: false,
      note: undefined
    })
    expect(unavailable).toMatchObject({
      id: 'new-term-profile:wsl:Missing Linux',
      profileId: 'wsl:Missing Linux',
      label: 'WSL — Missing Linux',
      disabled: true,
      note: 'The distribution is no longer installed.'
    })

    available?.run()
    unavailable?.run()

    expect(addTerminal).toHaveBeenCalledOnce()
    expect(addTerminal).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, 'pwsh')
  })
})

describe('default terminal keyboard shortcut', () => {
  const event = {
    key: 't',
    metaKey: false,
    ctrlKey: true,
    shiftKey: false
  }

  it('routes Cmd/Ctrl+T to the default-only action', () => {
    expect(defaultTerminalShortcutAction(event, { kanbanOpen: false, typing: false })).toBe(
      'create-default-terminal'
    )
    expect(
      defaultTerminalShortcutAction(
        { ...event, ctrlKey: false, metaKey: true, key: 'T' },
        { kanbanOpen: false, typing: false }
      )
    ).toBe('create-default-terminal')
  })

  it('refuses the shortcut under the board, while typing, without a command modifier, or with Shift', () => {
    expect(defaultTerminalShortcutAction(event, { kanbanOpen: true, typing: false })).toBeNull()
    expect(defaultTerminalShortcutAction(event, { kanbanOpen: false, typing: true })).toBeNull()
    expect(
      defaultTerminalShortcutAction(
        { ...event, ctrlKey: false },
        { kanbanOpen: false, typing: false }
      )
    ).toBeNull()
    expect(
      defaultTerminalShortcutAction(
        { ...event, shiftKey: true },
        { kanbanOpen: false, typing: false }
      )
    ).toBeNull()
  })
})
