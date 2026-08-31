import { describe, expect, it } from 'vitest'
import {
  appendWslGroupPair,
  createWslGroupWithTerminal,
  verifyNewWslBinding,
  WSL_TERMINAL_INSET
} from './wslGroupCreation'

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

  it('keeps the original canvas when the child terminal placement is refused', () => {
    const assembled = createWslGroupWithTerminal({
      distroName: 'Debian',
      bindingId: '33333333-3333-4333-8333-333333333333',
      position: { x: 100, y: 100 },
      index: 1,
      sessionSource: 'local'
    })
    const existing = [{ ...assembled.group, id: 'existing-frame' }]
    const result = appendWslGroupPair(
      existing,
      assembled,
      { group: 'group-event', terminal: 'terminal-event' },
      (nodes, node) => node.type === 'terminal'
        ? { nodes: [...nodes], result: { node: null, error: 'child refused' } }
        : { nodes: [...nodes, node], result: { node } }
    )

    expect(result.result).toEqual({ ok: false, reason: 'child refused' })
    expect(result.nodes).toEqual(existing)
  })

  it('refuses binding when refreshed machine facts omit or cannot verify the new instance', () => {
    expect(verifyNewWslBinding({
      name: 'Debian',
      enumeratedNames: new Set(),
      ownedByApp: false
    })).toEqual({
      ok: false,
      reason: 'The refreshed WSL list did not confirm the app-owned instance Debian.',
      facts: ['Debian']
    })
    expect(verifyNewWslBinding({
      name: 'Debian',
      enumeratedNames: new Set(['Debian']),
      ownedByApp: true,
      refreshError: 'list unavailable'
    })).toEqual({
      ok: false,
      reason: 'The refreshed WSL list failed: list unavailable',
      facts: ['Debian', 'list unavailable']
    })
    expect(verifyNewWslBinding({
      name: 'Debian',
      enumeratedNames: new Set(['Debian']),
      ownedByApp: true
    })).toEqual({ ok: true })
  })
})
