import { describe, expect, it } from 'vitest'
import { createWslGroupWithTerminal, WSL_TERMINAL_INSET } from './wslGroupCreation'

describe('createWslGroupWithTerminal', () => {
  it('creates the frame and one selected terminal with a stable WSL profile', () => {
    const result = createWslGroupWithTerminal({
      distroName: 'Ubuntu-24.04',
      bindingId: '11111111-1111-4111-8111-111111111111',
      cwd: String.raw`C:\Users\dev\project`,
      position: { x: 100, y: 200 },
      index: 4,
      sessionSource: 'local'
    })

    expect(result.binding).toEqual({
      bindingId: '11111111-1111-4111-8111-111111111111',
      distroName: 'Ubuntu-24.04'
    })
    expect(result.profileId).toBe('wsl:Ubuntu-24.04')
    expect(result.group.type).toBe('group')
    expect(result.group.data.wsl).toEqual(result.binding)
    expect(result.terminal.type).toBe('terminal')
    expect(result.terminal.parentId).toBe(result.group.id)
    expect(result.terminal.extent).toBe('parent')
    expect(result.terminal.selected).toBe(true)
    expect(result.terminal.data.terminalProfileId).toBe('wsl:Ubuntu-24.04')
    expect(result.terminal.position).toEqual(WSL_TERMINAL_INSET)
    expect(result.terminal.data.cwd).toBe(String.raw`C:\Users\dev\project`)
  })

  it('keeps the child inset inside a custom frame without changing the binding', () => {
    const result = createWslGroupWithTerminal({
      distroName: 'Debian',
      bindingId: '22222222-2222-4222-8222-222222222222',
      position: { x: 0, y: 0 },
      index: 0,
      sessionSource: 'local',
      groupSize: { width: 760, height: 540 }
    })
    const childWidth = result.terminal.width ?? 0
    const childHeight = result.terminal.height ?? 0
    expect(result.terminal.position.x + childWidth).toBeLessThanOrEqual(760)
    expect(result.terminal.position.y + childHeight).toBeLessThanOrEqual(540)
    expect(result.group.data.wsl).toEqual({
      bindingId: '22222222-2222-4222-8222-222222222222',
      distroName: 'Debian'
    })
  })
})
