// The managed hook merge against a REAL settings.json on disk. The user's shared settings file
// (Claude, Gemini) goes through the guarded settings transaction: only ENOENT means "no file", a
// blank file is restored, and a malformed, unreadable or uninterpretable file is left byte-for-byte
// as found. Grok's hook file is ours outright, so it alone may be healed.
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `installManagedHookScript` writes into homedir()/.nodeterm — point that at a temp dir so the
// test never touches the machine's real home.
let home = ''
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => home }, homedir: () => home }
})

import { installHooksInto, removeHooksFrom } from './install-helper'
import { CLAUDE_HOOK_EVENTS, type ManagedHookEvent } from '@shared/agents/hook-events'

const FOREIGN = { hooks: [{ type: 'command', command: 'sh "/opt/tools/agent-hooks/other.sh"' }] }
const eventName = (e: ManagedHookEvent): string => (typeof e === 'string' ? e : e.event)

let dir = ''
const configPath = () => path.join(dir, '.claude', 'settings.json')
const readConfig = () => JSON.parse(readFileSync(configPath(), 'utf8'))
const install = (file = configPath()) =>
  installHooksInto({
    agentId: 'claude',
    scriptFileName: 'claude.sh',
    configPath: file,
    events: CLAUDE_HOOK_EVENTS
  })
const uninstall = (file = configPath()) =>
  removeHooksFrom({ configPath: file, events: CLAUDE_HOOK_EVENTS, scriptFileName: 'claude.sh' })

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nt-hooks-'))
  home = dir
  mkdirSync(path.join(dir, '.claude'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('installHooksInto — shared settings keep the user`s data', () => {
  it('merges into an existing file and keeps other tools` hooks and unrelated settings', () => {
    writeFileSync(configPath(), JSON.stringify({ model: 'opus', hooks: { PreCompact: [FOREIGN], Stop: [FOREIGN] } }, null, 2))
    install()
    const after = readConfig()
    expect(after.model).toBe('opus')
    expect(after.hooks.PreCompact).toEqual([FOREIGN])
    expect(after.hooks.Stop[0]).toEqual(FOREIGN)
    expect(after.hooks.Stop[1].hooks[0].command).toContain('agent-hooks')
    for (const ev of CLAUDE_HOOK_EVENTS.map(eventName)) expect(after.hooks[ev], ev).toBeTruthy()
  })

  it('is idempotent — a second and third run change nothing', () => {
    install()
    const once = readFileSync(configPath(), 'utf8')
    install()
    install()
    expect(readFileSync(configPath(), 'utf8')).toBe(once)
  })

  it('creates the file only when it does not exist (ENOENT), with private permissions', () => {
    rmSync(path.join(dir, '.claude'), { recursive: true, force: true })
    install()
    expect(Object.keys(readConfig().hooks).length).toBeGreaterThan(0)
    if (process.platform !== 'win32') expect(statSync(configPath()).mode & 0o777).toBe(0o600)
  })

  it('restores a blank file (a successful read of zero bytes is an empty object)', () => {
    writeFileSync(configPath(), '  \n')
    install()
    expect(Object.keys(readConfig().hooks).length).toBeGreaterThan(0)
  })

  it.skipIf(process.platform === 'win32')('keeps the existing file mode', () => {
    writeFileSync(configPath(), '{"model":"keep"}')
    chmodSync(configPath(), 0o640)
    install()
    expect(statSync(configPath()).mode & 0o777).toBe(0o640)
    expect(readConfig().model).toBe('keep')
  })

  // POSIX-only: creating a symlink on Windows needs a privilege a CI user does not hold.
  it.skipIf(process.platform === 'win32')('writes through a symlinked settings.json and keeps the link', () => {
    const shared = path.join(dir, 'dotfiles', 'claude-settings.json')
    mkdirSync(path.dirname(shared), { recursive: true })
    writeFileSync(shared, JSON.stringify({ theme: 'dark' }))
    symlinkSync(shared, configPath())
    install()
    expect(lstatSync(configPath()).isSymbolicLink()).toBe(true)
    const written = JSON.parse(readFileSync(shared, 'utf8'))
    expect(written.theme).toBe('dark')
    expect(JSON.stringify(written.hooks)).toContain('agent-hooks')
  })

  it.skipIf(process.platform === 'win32')('never repairs a dangling symlink', () => {
    symlinkSync(path.join(dir, 'missing', 'settings.json'), configPath())
    install()
    expect(lstatSync(configPath()).isSymbolicLink()).toBe(true)
    expect(existsSync(path.join(dir, 'missing'))).toBe(false)
  })
})

describe('shared settings are never healed by replacing user data', () => {
  it.each(['{broken', 'null', '[]', '"text"', '{"model":"keep","hooks":"x"}', '{"model":"keep","hooks":{"Stop":{}}}', '{"hooks":{"Stop":[null]}}'])(
    'preserves %s through install and uninstall',
    (raw) => {
      writeFileSync(configPath(), raw)
      install()
      expect(readFileSync(configPath(), 'utf8')).toBe(raw)
      uninstall()
      expect(readFileSync(configPath(), 'utf8')).toBe(raw)
    }
  )

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('leaves an unreadable file alone', () => {
    writeFileSync(configPath(), '{"model":"keep"}')
    chmodSync(configPath(), 0o000)
    try {
      install()
      uninstall()
    } finally {
      chmodSync(configPath(), 0o600)
    }
    expect(readFileSync(configPath(), 'utf8')).toBe('{"model":"keep"}')
  })

  it('leaves a hand-edited value on an event we do not subscribe to exactly as found', () => {
    writeFileSync(configPath(), JSON.stringify({ hooks: { SomethingElse: 'keep me' } }))
    install()
    const after = readConfig()
    expect(after.hooks.SomethingElse).toBe('keep me')
    expect(JSON.stringify(after.hooks.Stop)).toContain('agent-hooks')
  })
})

describe('removeHooksFrom — shared settings', () => {
  it('removes our entries and keeps a foreign one', () => {
    install()
    const withForeign = readConfig()
    withForeign.hooks.Stop.unshift(FOREIGN)
    writeFileSync(configPath(), JSON.stringify(withForeign, null, 2))
    uninstall()
    const after = readConfig()
    expect(after.hooks.Stop).toEqual([FOREIGN])
    expect(JSON.stringify(after)).not.toContain('agent-hooks/claude.sh')
  })

  it('keeps a user handler that was hand-merged into the same definition as ours', () => {
    install()
    const merged = readConfig()
    merged.hooks.Stop[0].hooks.push(FOREIGN.hooks[0])
    writeFileSync(configPath(), JSON.stringify(merged, null, 2))
    install()
    expect(readConfig().hooks.Stop.flatMap((d: { hooks: unknown[] }) => d.hooks)).toContainEqual(FOREIGN.hooks[0])
    uninstall()
    expect(readConfig().hooks.Stop).toEqual([{ hooks: [FOREIGN.hooks[0]] }])
  })

  it('does not create a settings file that does not exist', () => {
    uninstall()
    expect(existsSync(configPath())).toBe(false)
  })
})

describe('owned Grok config repair', () => {
  it.each(['{broken', '{"hooks":[]}', '{"hooks":{"Stop":"x"}}', 'null', ''])('heals %s only for an owned config', (raw) => {
    writeFileSync(configPath(), raw)
    installHooksInto({ agentId: 'grok', scriptFileName: 'grok.sh', configPath: configPath(), events: ['Stop'], atomicConfig: true })
    expect(readConfig().hooks.Stop[0].hooks[0].command).toContain('grok.sh')
  })

  it('removes our entry from an owned config', () => {
    installHooksInto({ agentId: 'grok', scriptFileName: 'grok.sh', configPath: configPath(), events: ['Stop'], atomicConfig: true })
    removeHooksFrom({ configPath: configPath(), events: ['Stop'], scriptFileName: 'grok.sh', atomicConfig: true })
    expect(readConfig().hooks.Stop).toBeUndefined()
  })
})
