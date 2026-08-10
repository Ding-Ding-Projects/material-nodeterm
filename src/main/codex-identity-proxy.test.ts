import { execFile } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindCodexThreadIdentity,
  installCodexLauncher,
  resolveCodexThreadNodeIdentity,
  validCodexIdentity
} from '../core/codex-identity-proxy'

const run = promisify(execFile)

describe('NodeTerm Codex remote launcher', () => {
  const oldHome = process.env.HOME

  afterEach(() => {
    vi.unstubAllEnvs()
    if (oldHome === undefined) delete process.env.HOME
    else process.env.HOME = oldHome
  })

  it('keeps two parallel node identities isolated on one shared remote endpoint', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-'))
    const bin = path.join(root, 'bin')
    const fakeCodex = path.join(bin, 'codex')
    const fakeCurl = path.join(bin, 'curl')
    const endpoint = path.join(root, 'hook-endpoint.env')
    const outA = path.join(root, 'a.json')
    const outB = path.join(root, 'b.json')
    const bindA = path.join(root, 'bind-a.txt')
    const bindB = path.join(root, 'bind-b.txt')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', {
      mode: 0o600
    })
    writeFileSync(
      fakeCurl,
      '#!/bin/sh\ncat >/dev/null\nprintf \'%s\\n\' "$@" > "$CAPTURE_BIND"\n',
      { mode: 0o700 }
    )
    writeFileSync(
      fakeCodex,
      '#!/bin/sh\nprintf \'[\' > "$CAPTURE"\nfirst=1\nfor arg in "$@"; do [ "$first" = 1 ] || printf \',\' >> "$CAPTURE"; first=0; node -e \'process.stdout.write(JSON.stringify(process.argv[1]))\' -- "$arg" >> "$CAPTURE"; done\nprintf \']\' >> "$CAPTURE"\n',
      { mode: 0o700 }
    )
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()
    const base = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_HOOK_ENDPOINT: endpoint
    }
    await Promise.all([
      run(launcher, ['resume', 'thread-a'], { env: {
        ...process.env, ...base, CAPTURE: outA,
        NODETERM_NODE_ID: 'node-a', NODETERM_CODEX_ACCOUNT_ID: 'account-a', CAPTURE_BIND: bindA
      }}),
      run(launcher, ['resume', 'thread-b'], { env: {
        ...process.env, ...base, CAPTURE: outB,
        NODETERM_NODE_ID: 'node-b', NODETERM_CODEX_ACCOUNT_ID: 'account-b', CAPTURE_BIND: bindB
      }})
    ])
    const argsA = JSON.parse(readFileSync(outA, 'utf8'))
    const argsB = JSON.parse(readFileSync(outB, 'utf8'))
    expect(argsA).toEqual(['--remote', 'unix://', 'resume', 'thread-a'])
    expect(argsB).toEqual(['--remote', 'unix://', 'resume', 'thread-b'])
    expect(argsA.slice(0, 2)).toEqual(argsB.slice(0, 2))
    expect(readFileSync(bindA, 'utf8')).toContain('nodeId=node-a\n')
    expect(readFileSync(bindA, 'utf8')).toContain('threadId=thread-a\n')
    expect(readFileSync(bindA, 'utf8')).toContain('accountId=account-a\n')
    expect(readFileSync(bindB, 'utf8')).toContain('nodeId=node-b\n')
    expect(readFileSync(bindB, 'utf8')).toContain('threadId=thread-b\n')
    expect(readFileSync(bindB, 'utf8')).toContain('accountId=account-b\n')
  })

  it('pre-creates and binds two fresh sessions independently on the shared app-server', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-fresh-'))
    const bin = path.join(root, 'bin')
    const fakeCodex = path.join(bin, 'codex')
    const fakeCurl = path.join(bin, 'curl')
    const endpoint = path.join(root, 'hook-endpoint.env')
    const outA = path.join(root, 'a.json')
    const outB = path.join(root, 'b.json')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', {
      mode: 0o600
    })
    writeFileSync(
      fakeCurl,
      '#!/bin/sh\ncat >/dev/null\nfor arg in "$@"; do case "$arg" in nodeId=node-a) printf thread-new-a; exit 0 ;; nodeId=node-b) printf thread-new-b; exit 0 ;; esac; done\nexit 22\n',
      { mode: 0o700 }
    )
    writeFileSync(
      fakeCodex,
      '#!/bin/sh\nprintf \'[\' > "$CAPTURE"\nfirst=1\nfor arg in "$@"; do [ "$first" = 1 ] || printf \',\' >> "$CAPTURE"; first=0; node -e \'process.stdout.write(JSON.stringify(process.argv[1]))\' -- "$arg" >> "$CAPTURE"; done\nprintf \']\' >> "$CAPTURE"\n',
      { mode: 0o700 }
    )
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()
    const base = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_HOOK_ENDPOINT: endpoint
    }

    await Promise.all([
      run(launcher, ['prompt a'], {
        cwd: '/tmp',
        env: { ...base, CAPTURE: outA, NODETERM_NODE_ID: 'node-a' }
      }),
      run(launcher, ['prompt b'], {
        cwd: '/tmp',
        env: { ...base, CAPTURE: outB, NODETERM_NODE_ID: 'node-b' }
      })
    ])

    expect(JSON.parse(readFileSync(outA, 'utf8'))).toEqual([
      '--remote',
      'unix://',
      'resume',
      'thread-new-a',
      'prompt a'
    ])
    expect(JSON.parse(readFileSync(outB, 'utf8'))).toEqual([
      '--remote',
      'unix://',
      'resume',
      'thread-new-b',
      'prompt b'
    ])
  })

  it('fails closed before launch for a missing or invalid resume-thread mapping key', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-invalid-'))
    const bin = path.join(root, 'bin')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 99\n', { mode: 0o700 })
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_NODE_ID: 'node-a',
      NODETERM_HOOK_ENDPOINT: '/isolated/node-a/hook.env'
    }
    await expect(run(launcher, ['resume'], { env })).rejects.toMatchObject({ code: 64 })
    await expect(run(launcher, ['resume', '../other'], { env })).rejects.toMatchObject({ code: 64 })
    await expect(
      run(launcher, ['resume', 'thread-a'], {
        env: { ...env, NODETERM_CODEX_ACCOUNT_ID: '..' }
      })
    ).rejects.toMatchObject({ code: 64 })
  })

  it('rejects a live duplicate owner but permits replacing a stale node binding', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-binding-'))
    vi.stubEnv('HOME', root)
    bindCodexThreadIdentity('thread-a', 'node-a', '/isolated/hook.env', () => false)
    expect(() =>
      bindCodexThreadIdentity('thread-a', 'node-b', '/isolated/hook.env', (nodeId) => nodeId === 'node-a')
    ).toThrow('already bound')
    bindCodexThreadIdentity('thread-a', 'node-b', '/isolated/hook.env', () => false)
    expect(
      readFileSync(
        path.join(root, '.nodeterm', 'codex-thread-nodes', 'system', 'thread-a'),
        'utf8'
      )
    ).toBe('accountId=system\nnodeId=node-b\nendpoint=/isolated/hook.env\n')
  })

  it('keeps an equal thread id isolated across two account app-servers', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-account-binding-'))
    vi.stubEnv('HOME', root)
    bindCodexThreadIdentity(
      'same-thread',
      'node-a',
      '/isolated/hook.env',
      () => false,
      'account-a'
    )
    bindCodexThreadIdentity(
      'same-thread',
      'node-b',
      '/isolated/hook.env',
      () => true,
      'account-b'
    )
    expect(
      readFileSync(
        path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-a', 'same-thread'),
        'utf8'
      )
    ).toContain('nodeId=node-a')
    expect(
      readFileSync(
        path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-b', 'same-thread'),
        'utf8'
      )
    ).toContain('nodeId=node-b')
  })

  it('releases the old owner only after the target account binds successfully', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-release-binding-'))
    vi.stubEnv('HOME', root)
    bindCodexThreadIdentity('thread-a', 'node-a', '/isolated/hook.env', () => false, 'account-a')
    expect(resolveCodexThreadNodeIdentity('thread-a')).toBe('node-a')
    bindCodexThreadIdentity('thread-b', 'node-a', '/isolated/hook.env', () => true, 'account-b')
    expect(resolveCodexThreadNodeIdentity('thread-a')).toBeUndefined()
    bindCodexThreadIdentity('thread-a', 'node-new', '/isolated/hook.env', () => true, 'account-a')
    expect(resolveCodexThreadNodeIdentity('thread-a')).toBe('node-new')
    expect(resolveCodexThreadNodeIdentity('thread-b')).toBe('node-a')
  })

  it.each([
    ['', '/isolated/hook.env'],
    ['../invalid', '/isolated/hook.env'],
    ['node-a', 'relative.env'],
    ['node-a', '/isolated/evil"value']
  ])('fails closed for invalid identity node=%s endpoint=%s', (nodeId, endpoint) => {
    expect(validCodexIdentity(nodeId, endpoint)).toBe(false)
  })

  it('rejects an account scope that could escape the mapping directory', () => {
    expect(() =>
      bindCodexThreadIdentity(
        'thread-a',
        'node-a',
        '/isolated/hook.env',
        () => false,
        '..'
      )
    ).toThrow('Invalid NodeTerm Codex account identity')
  })
})
