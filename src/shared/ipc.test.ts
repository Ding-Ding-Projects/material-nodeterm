import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parse } from '@babel/parser'
import { IPC } from './ipc'

const EXPECTED_CODEX_KEYS = [
  'codexAccountsAdd',
  'codexAccountsWaitLogin',
  'codexAccountsCancelWait',
  'codexAccountsRemove',
  'codexAccountsIdentity',
  'codexAccountsSystemIdentity',
  'codexAccountsSwitchThread',
  'codexAccountsTransferThreadToSsh',
  'codexAccountsCommitSwitch',
  'codexAccountsFinishSwitch',
  'codexAccountsRollbackSwitch'
] as const

function ipcObjectProperties(source: string): string[] {
  const file = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const names: string[] = []
  function visit(node: any): void {
    const initializer = node.init?.type === 'TSAsExpression' ? node.init.expression : node.init
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'IPC' && initializer?.type === 'ObjectExpression') {
      for (const property of initializer.properties) {
        if ((property.type === 'ObjectProperty' || property.type === 'ObjectMethod') && property.key.type === 'Identifier') {
          names.push(property.key.name)
        }
      }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(visit)
        else visit(value)
      }
    }
  }
  visit(file as any)
  return names
}

/** Resolve every IPC entry to its concrete channel string(s): plain strings pass through, and the
 *  per-id factory functions (e.g. `ptyData(sessionId)`) are invoked with a sample id. */
function allChannels(): string[] {
  const out: string[] = []
  for (const value of Object.values(IPC)) {
    if (typeof value === 'string') out.push(value)
    else if (typeof value === 'function') out.push((value as (...a: string[]) => string)('sample', 'sample'))
  }
  return out
}

describe('IPC channels', () => {
  it('keeps every IPC property unique and retains the complete Codex account key inventory', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ipc.ts'), 'utf8')
    const properties = ipcObjectProperties(source)
    expect(properties.length).toBeGreaterThan(0)
    expect(new Set(properties).size).toBe(properties.length)
    expect(properties.filter((name) => name.startsWith('codexAccounts'))).toEqual(
      EXPECTED_CODEX_KEYS
    )
  })

  it('every channel string is unique', () => {
    const channels = allChannels()
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('exposes the Windows terminal profile channels', () => {
    expect(IPC.terminalProfilesList).toBe('terminal-profiles:list')
    expect(IPC.terminalProfilesRefresh).toBe('terminal-profiles:refresh')
    expect(IPC.ptyRecycleConfirmed).toBe('pty:recycle-confirmed')
  })

  it('exposes the new relay tunnel host channels (distinct from the legacy remote* dialect)', () => {
    expect(IPC.relayHostStart).toBe('relay:host:start')
    expect(IPC.relayHostStop).toBe('relay:host:stop')
    expect(IPC.relayHostPeerPending).toBe('relay:host:peer-pending')
    expect(IPC.relayHostConfirm).toBe('relay:host:confirm')
    expect(IPC.relayHostOpen).toBe('relay:host:open')
    expect(IPC.relayHostClosed).toBe('relay:host:closed')
    // The new tunnel MUST NOT reuse the legacy `remote:*` namespace (both coexist until Task 10).
    for (const ch of [
      IPC.relayHostStart,
      IPC.relayHostStop,
      IPC.relayHostPeerPending,
      IPC.relayHostConfirm,
      IPC.relayHostOpen,
      IPC.relayHostClosed
    ]) {
      expect(ch.startsWith('relay:')).toBe(true)
    }
  })

  it('exposes the new relay tunnel client channels, with per-id factories', () => {
    expect(IPC.relayClientConnect).toBe('relay:client:connect')
    expect(IPC.relayClientConfirm).toBe('relay:client:confirm')
    expect(IPC.relayClientSend).toBe('relay:client:send')
    expect(IPC.relayClientDisconnect).toBe('relay:client:disconnect')
    expect(IPC.relayClientSas('abc')).toBe('relay:client:sas:abc')
    expect(IPC.relayClientApproved('abc')).toBe('relay:client:approved:abc')
    expect(IPC.relayClientFrame('abc')).toBe('relay:client:frame:abc')
    expect(IPC.relayClientClosed('abc')).toBe('relay:client:closed:abc')
  })
})
