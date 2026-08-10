import { execFile } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindCodexThreadIdentity,
  codexThreadIdentityHasLiveConflict,
  installCodexLauncher,
  resolveCodexThreadNodeIdentity,
  validCodexIdentity,
  writeCodexThreadIdentity
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

  it('exposes the exact resume id before routing it through the selected account relay', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-relay-'))
    const bin = path.join(root, 'bin')
    const endpoint = path.join(root, 'hook-endpoint.env')
    const capture = path.join(root, 'args.json')
    const exposeCapture = path.join(root, 'expose.txt')
    const runtime = path.join(root, 'relay-runtime')
    const script = path.join(root, 'codex-relay.js')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', { mode: 0o600 })
    writeFileSync(
      path.join(bin, 'curl'),
      '#!/bin/sh\ncat >/dev/null\nprintf \'%s\\n\' "$@" > "$CAPTURE_EXPOSE"\n',
      { mode: 0o700 }
    )
    writeFileSync(
      path.join(bin, 'codex'),
      '#!/bin/sh\nnode -e \'require("fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(1)))\' -- "$@"\n',
      { mode: 0o700 }
    )
    writeFileSync(runtime, '#!/bin/sh\nprintf "ws://127.0.0.1:4321\\nroute-token-a\\n"\n', { mode: 0o700 })
    writeFileSync(script, '// isolated fixture\n', { mode: 0o600 })
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()
    await run(launcher, ['resume', 'thread-a'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        CAPTURE: capture,
        CAPTURE_EXPOSE: exposeCapture,
        NODETERM_CANVAS_CONTROL: '1',
        NODETERM_NODE_ID: 'node-a',
        NODETERM_HOOK_ENDPOINT: endpoint,
        NODETERM_CODEX_RELAY_RUNTIME: runtime,
        NODETERM_CODEX_RELAY_SCRIPT: script
      }
    })
    expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual([
      '--remote',
      'ws://127.0.0.1:4321',
      '--remote-auth-token-env',
      'NODETERM_CODEX_RELAY_TOKEN',
      'resume',
      'thread-a'
    ])
    const exposeArgs = readFileSync(exposeCapture, 'utf8')
    expect(exposeArgs).toContain('threadId=thread-a\n')
    expect(exposeArgs).toContain('accountId=\n')
    expect(exposeArgs).toContain('/codex-thread/expose\n')
  })

  it('lets the relay create a fresh thread directly without a broker seed fork', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-relay-fresh-'))
    const bin = path.join(root, 'bin')
    const endpoint = path.join(root, 'hook-endpoint.env')
    const capture = path.join(root, 'args.json')
    const runtime = path.join(root, 'relay-runtime')
    const script = path.join(root, 'codex-relay.js')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', { mode: 0o600 })
    writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\ncat >/dev/null\nexit 22\n', { mode: 0o700 })
    writeFileSync(
      path.join(bin, 'codex'),
      '#!/bin/sh\nnode -e \'require("fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(1)))\' -- "$@"\n',
      { mode: 0o700 }
    )
    writeFileSync(runtime, '#!/bin/sh\nprintf "ws://127.0.0.1:4321\\nroute-token-a\\n"\n', { mode: 0o700 })
    writeFileSync(script, '// isolated fixture\n', { mode: 0o600 })
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()

    await run(launcher, ['new prompt'], {
      cwd: '/tmp',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        CAPTURE: capture,
        NODETERM_CANVAS_CONTROL: '1',
        NODETERM_NODE_ID: 'node-a',
        NODETERM_HOOK_ENDPOINT: endpoint,
        NODETERM_CODEX_RELAY_RUNTIME: runtime,
        NODETERM_CODEX_RELAY_SCRIPT: script
      }
    })
    expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual([
      '--remote',
      'ws://127.0.0.1:4321',
      '--remote-auth-token-env',
      'NODETERM_CODEX_RELAY_TOKEN',
      'new prompt'
    ])
  })

  it('fails closed after bounded retries when a configured relay is unavailable', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-relay-fail-'))
    const bin = path.join(root, 'bin')
    const endpoint = path.join(root, 'hook-endpoint.env')
    const runtime = path.join(root, 'relay-runtime')
    const script = path.join(root, 'codex-relay.js')
    const codexCapture = path.join(root, 'codex-args')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', { mode: 0o600 })
    writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\ncat >/dev/null\nexit 0\n', { mode: 0o700 })
    writeFileSync(path.join(bin, 'codex'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${codexCapture}\n`, { mode: 0o700 })
    writeFileSync(runtime, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    writeFileSync(script, '// isolated fixture\n', { mode: 0o600 })
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()

    await expect(run(launcher, ['resume', 'thread-a'], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        NODETERM_CANVAS_CONTROL: '1',
        NODETERM_NODE_ID: 'node-a',
        NODETERM_HOOK_ENDPOINT: endpoint,
        NODETERM_CODEX_RELAY_RUNTIME: runtime,
        NODETERM_CODEX_RELAY_SCRIPT: script
      }
    })).rejects.toMatchObject({ code: 69 })
    expect(readFileSync(codexCapture, 'utf8').trim()).toBe('app-server daemon start')
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

  it('creates a managed identity while an unscoped legacy system mapping exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-legacy-managed-'))
    const mappings = path.join(root, '.nodeterm', 'codex-thread-nodes')
    mkdirSync(mappings, { recursive: true })
    writeFileSync(
      path.join(mappings, 'legacy-thread'),
      'nodeId=legacy-node\nendpoint=/isolated/hook.env\n'
    )
    vi.stubEnv('HOME', root)

    expect(() => writeCodexThreadIdentity(
      'managed-thread',
      'managed-node',
      '/isolated/hook.env',
      'account-a'
    )).not.toThrow()
    expect(readFileSync(
      path.join(mappings, 'account-a', 'managed-thread'),
      'utf8'
    )).toBe('accountId=account-a\nnodeId=managed-node\nendpoint=/isolated/hook.env\n')
  })

  it('preflights duplicate ownership without stealing a live thread', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-preflight-'))
    vi.stubEnv('HOME', root)
    bindCodexThreadIdentity('thread-a', 'node-a', '/isolated/hook.env', () => false)

    expect(
      codexThreadIdentityHasLiveConflict('thread-a', 'node-b', (nodeId) => nodeId === 'node-a')
    ).toBe(true)
    expect(codexThreadIdentityHasLiveConflict('thread-a', 'node-b', () => false)).toBe(false)
    expect(codexThreadIdentityHasLiveConflict('thread-a', 'node-a', () => true)).toBe(false)
    expect(codexThreadIdentityHasLiveConflict('../invalid', 'node-b', () => false)).toBe(true)
  })

  it('treats a malformed account mapping as a fail-closed ownership conflict', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-malformed-binding-'))
    vi.stubEnv('HOME', root)
    const dir = path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-a')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'thread-a'), 'accountId=wrong\nnodeId=../bad\nendpoint=relative\n')
    expect(codexThreadIdentityHasLiveConflict('thread-a', 'node-a', () => false)).toBe(true)
  })

  it('moves one thread id across accounts but rejects a second live node owner', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-account-binding-'))
    vi.stubEnv('HOME', root)
    bindCodexThreadIdentity(
      'same-thread',
      'node-a',
      '/isolated/hook.env',
      () => false,
      'account-a'
    )
    expect(() => bindCodexThreadIdentity(
      'same-thread',
      'node-b',
      '/isolated/hook.env',
      (nodeId) => nodeId === 'node-a',
      'account-b'
    )).toThrow('already bound')
    bindCodexThreadIdentity(
      'same-thread',
      'node-a',
      '/isolated/hook.env',
      () => true,
      'account-b'
    )
    expect(() => readFileSync(
      path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-a', 'same-thread'),
      'utf8'
    )).toThrow()
    expect(
      readFileSync(
        path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-b', 'same-thread'),
        'utf8'
      )
    ).toContain('nodeId=node-a')
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

  it('restores the source mapping when transfer cleanup cannot validate every mapping', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-transfer-rollback-'))
    vi.stubEnv('HOME', root)
    bindCodexThreadIdentity('thread-a', 'node-a', '/isolated/hook.env', () => false, 'account-a')
    const malformedDir = path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-x')
    mkdirSync(malformedDir, { recursive: true })
    writeFileSync(path.join(malformedDir, 'other-thread'), 'malformed\n')
    expect(() => bindCodexThreadIdentity(
      'thread-a',
      'node-a',
      '/isolated/hook.env',
      () => true,
      'account-b'
    )).toThrow('atomically transfer')
    expect(readFileSync(
      path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-a', 'thread-a'),
      'utf8'
    )).toContain('nodeId=node-a')
    expect(() => readFileSync(
      path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-b', 'thread-a'),
      'utf8'
    )).toThrow()
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
