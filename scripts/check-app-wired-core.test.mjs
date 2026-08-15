import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertManagedConfigUnchanged,
  captureManagedConfigSentinel,
  createAppSandbox,
  managedConfigTargets,
  repoElectronPids,
} from './check-app-wired-core.mjs'

const scratch = []

afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function temp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

describe('check-app-wired home isolation', () => {
  it('makes a real child os.homedir and every config root land inside the disposable sandbox', () => {
    const forbidden = temp('nt-wired-forbidden-')
    const baseEnv = {
      ...process.env,
      HOME: forbidden,
      USERPROFILE: forbidden,
      XDG_CONFIG_HOME: path.join(forbidden, 'xdg'),
      XDG_DATA_HOME: path.join(forbidden, 'xdg-data'),
      XDG_CACHE_HOME: path.join(forbidden, 'xdg-cache'),
      XDG_STATE_HOME: path.join(forbidden, 'xdg-state'),
      XDG_RUNTIME_DIR: path.join(forbidden, 'xdg-runtime'),
      CLAUDE_CONFIG_DIR: path.join(forbidden, 'claude'),
      CODEX_HOME: path.join(forbidden, 'codex'),
      GROK_HOME: path.join(forbidden, 'grok'),
      KIMI_CODE_HOME: path.join(forbidden, 'kimi'),
      APPDATA: path.join(forbidden, 'roaming'),
      LOCALAPPDATA: path.join(forbidden, 'local'),
      TEMP: path.join(forbidden, 'temp'),
      TMP: path.join(forbidden, 'temp'),
      TMPDIR: path.join(forbidden, 'temp'),
      ELECTRON_RENDERER_URL: 'https://renderer.invalid',
      NODETERM_API_BASE: 'https://api.invalid',
      NODETERM_RELAY_URL: 'wss://relay.invalid',
    }
    const sentinelFile = path.join(forbidden, '.claude', 'settings.json')
    write(sentinelFile, 'real profile sentinel\n')
    const sentinelBefore = captureManagedConfigSentinel({
      home: forbidden,
      env: baseEnv,
    })

    const sandbox = createAppSandbox({ baseEnv })
    scratch.push(sandbox.root)
    const isolatedValues = [
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'TMPDIR',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'XDG_STATE_HOME',
      'XDG_RUNTIME_DIR',
      'CLAUDE_CONFIG_DIR',
      'CODEX_HOME',
      'GROK_HOME',
      'KIMI_CODE_HOME',
      'NT_USER_DATA',
    ]
    for (const key of isolatedValues) {
      expect(path.relative(sandbox.root, sandbox.env[key])).not.toMatch(/^\.\.(?:[\\/]|$)/)
    }
    expect(sandbox.env.NT_MULTI).toBe('1')
    expect(sandbox.env.ELECTRON_RENDERER_URL).toBeUndefined()
    expect(sandbox.env.NODETERM_API_BASE).toBeUndefined()
    expect(sandbox.env.NODETERM_RELAY_URL).toBeUndefined()

    // This child follows the same os.homedir/XDG/GROK inputs as the real hook installers. It
    // writes representative boot artefacts; an omitted USERPROFILE, XDG, or GROK override sends
    // at least one of them into `forbidden` and changes the sentinel below.
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs'),os=require('node:os'),p=require('node:path');
           const put=(f)=>{fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,'boot')};
           put(p.join(os.homedir(),'.claude','settings.json'));
           put(p.join(process.env.XDG_CONFIG_HOME,'opencode','plugins','nodeterm-status.js'));
           put(p.join(process.env.GROK_HOME,'hooks','nodeterm-status.json'));
           process.stdout.write(JSON.stringify({home:os.homedir()}));`,
        ],
        { env: sandbox.env, encoding: 'utf8' },
      ),
    )
    expect(path.resolve(result.home)).toBe(path.resolve(sandbox.home))
    expect(fs.existsSync(path.join(sandbox.home, '.claude', 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(sandbox.env.XDG_CONFIG_HOME, 'opencode', 'plugins', 'nodeterm-status.js'))).toBe(true)
    expect(fs.existsSync(path.join(sandbox.env.GROK_HOME, 'hooks', 'nodeterm-status.json'))).toBe(true)

    const sentinelAfter = captureManagedConfigSentinel({
      home: forbidden,
      env: baseEnv,
    })
    expect(() => assertManagedConfigUnchanged(sentinelBefore, sentinelAfter)).not.toThrow()
    expect(fs.readFileSync(sentinelFile, 'utf8')).toBe('real profile sentinel\n')
  })

  it('turns red when an existing or previously absent managed target changes', () => {
    const home = temp('nt-wired-sentinel-')
    const settings = path.join(home, '.claude', 'settings.json')
    write(settings, 'before')
    const before = captureManagedConfigSentinel({ home, env: {} })

    write(settings, 'after')
    write(path.join(home, '.gemini', 'settings.json'), 'new')
    const after = captureManagedConfigSentinel({ home, env: {} })

    expect(() => assertManagedConfigUnchanged(before, after)).toThrow(/\.claude.*settings\.json/)
    expect(() => assertManagedConfigUnchanged(before, after)).toThrow(/\.gemini.*settings\.json/)
  })

  it('covers every boot file that the managed hook, context-link, and canvas installers own', () => {
    const home = path.resolve('fixture-home')
    const targets = managedConfigTargets({ home, env: {}, platform: process.platform })
    expect(targets).toContain(path.join(home, '.claude', 'settings.json'))
    expect(targets).toContain(path.join(home, '.codex', 'hooks.json'))
    expect(targets).toContain(path.join(home, '.codex', 'config.toml'))
    expect(targets).toContain(path.join(home, '.gemini', 'settings.json'))
    expect(targets).toContain(path.join(home, '.nodeterm', 'agent-hooks', 'grok.sh'))
    expect(targets).toContain(path.join(home, '.claude', 'skills', 'get-linked-context', 'SKILL.md'))
    expect(targets).toContain(path.join(home, '.claude', 'skills', 'manage-nodeterm-canvas', 'SKILL.md'))
    expect(targets).toContain(path.join(home, '.config', 'opencode', 'plugins', 'nodeterm-status.js'))
  })
})

describe.runIf(process.platform === 'win32')('check-app-wired Windows PID matching', () => {
  const fixtureQuery =
    `([Text.Encoding]::UTF8.GetString(` +
    `[Convert]::FromBase64String([Environment]::GetEnvironmentVariable('NT_WIRED_PID_FIXTURE')))).Split([char]10) | ` +
    `Where-Object { $_ } | ForEach-Object { ConvertFrom-Json -InputObject $_ }`

  it('executes the production PowerShell predicate literally, with wildcard characters as data', () => {
    const root = String.raw`C:\oak[prod]?star*`
    const rows = [
      { Name: 'electron.exe', ProcessId: 101, CommandLine: `${root}\\node_modules\\electron\\electron.exe` },
      { Name: 'electron.exe', ProcessId: 102, CommandLine: `${root.toUpperCase()}\\out\\main\\index.js` },
      // A -like mutant treats [prod], ?, and * as syntax and selects this unrelated path.
      { Name: 'electron.exe', ProcessId: 201, CommandLine: String.raw`C:\oakpXstarZZ\other\electron.exe` },
      // Dropping the trailing separator boundary mistakes a sibling prefix for this repository.
      { Name: 'electron.exe', ProcessId: 202, CommandLine: `${root}ling\\electron.exe` },
      { Name: 'electron.exe', ProcessId: 203, CommandLine: null },
      { Name: 'not-electron.exe', ProcessId: 204, CommandLine: `${root}\\electron.exe` },
    ]
    const encoded = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8').toString('base64')

    expect(
      repoElectronPids({
        root,
        platform: 'win32',
        processQuery: fixtureQuery,
        extraEnv: { NT_WIRED_PID_FIXTURE: encoded },
      }),
    ).toEqual([101, 102])
  })

  it('does not collapse a failed process probe into an empty successful snapshot', () => {
    expect(() =>
      repoElectronPids({
        root: String.raw`C:\oak`,
        platform: 'win32',
        processQuery: `throw 'fixture query failed'`,
      }),
    ).toThrow()
  })
})
