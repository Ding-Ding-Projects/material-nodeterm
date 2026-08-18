import { execFile } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindCodexThreadIdentity,
  codexThreadIdentityHasLiveConflict,
  installCodexLauncher,
  resolveCodexThreadNodeIdentity,
  setCodexThreadIdentityAuthSecret,
  validCodexIdentity,
  writeCodexThreadIdentity
} from '../core/codex-identity-proxy'
import {
  environmentForPosixShell,
  REAL_POSIX_SHELL,
  pathsForPosixShellEnv,
  posixShellScriptArgs,
  quotePathForPosixShell
} from '../core/testing/posix-shell'

const run = promisify(execFile)

// The identity store and the launcher installer resolve their directories through
// `platform().userDataDir` and fall back to `homedir()` only when no CorePlatform was
// initialized — which is exactly this file's situation (it never calls `initPlatform`). On POSIX,
// `os.homedir()` reads `$HOME`, so `vi.stubEnv('HOME', root)` alone was enough to redirect it.
// On Windows, `os.homedir()` ignores `HOME` entirely (it reads `USERPROFILE` / the OS profile
// API), so every write and read in this file silently landed in the REAL `C:\Users\<user>`
// instead of the isolated temp root.
//
// `vi.spyOn(os, 'homedir')` — the pattern `kids-mode.test.ts` / `school-mode.test.ts` /
// `opencode.test.ts` / `transcript-ipc.test.ts` all use — does NOT reach `codex-identity-proxy.ts`
// here: those targets call `os.homedir()` off a DEFAULT import, so patching the `os` module's
// `homedir` property is visible at every call site. `codex-identity-proxy.ts` instead does
// `import { homedir } from 'os'` and calls the bare name — under this project's esbuild/Vite
// transform that NAMED import is resolved once at module-evaluation time, decoupled from later
// mutation of the `os` object's own property (verified directly: `vi.spyOn(os,'homedir')` changed
// what `os.homedir()` returned but left a sibling module's own `import { homedir } from 'os'; homedir()`
// completely unaffected). `vi.mock('os', …)` intercepts module RESOLUTION itself instead of a
// property, so it redirects every import style, including this one.
// `vi.mock` factories are hoisted above every top-level statement in this file (including plain
// `const` declarations), so the mock function itself must be created through `vi.hoisted` — a
// bare `const homedirMock = vi.fn()` above throws "Cannot access 'homedirMock' before
// initialization" the moment the hoisted factory runs.
const { homedirMock } = vi.hoisted(() => ({ homedirMock: vi.fn<() => string>() }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: homedirMock }, homedir: homedirMock }
})

const SHELL_PATH_ENV_KEYS = [
  'HOME',
  'NODETERM_HOOK_ENDPOINT',
  'NODETERM_HOOK_SOCK',
  'NODETERM_NODE_TOKEN_DIR',
  'NODETERM_CODEX_RELAY_RUNTIME',
  'NODETERM_CODEX_RELAY_SCRIPT',
  'CODEX_HOME'
] as const

/**
 * The generated launcher is `#!/bin/sh`; Windows cannot exec that directly (no shebang support),
 * so it must run through a real POSIX shell exactly like `managed-script.test.ts` and
 * `ssh-project.test.ts` — the shell binary itself, and every path the script will read, both need
 * the POSIX translation `posix-shell.ts` provides.
 */
function runLauncher(
  launcherPath: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  return run(REAL_POSIX_SHELL, posixShellScriptArgs(launcherPath, args), {
    env: environmentForPosixShell(pathsForPosixShellEnv(env, SHELL_PATH_ENV_KEYS)),
    cwd
  })
}

// installCodexLauncher() legitimately returns `string | null` (null = could not be installed,
// e.g. a read-only home). In the test sandbox the temp HOME is always writable, so a null here
// is a real test-environment failure, not an expected outcome — fail loudly instead of silencing
// the type with a cast or a non-null assertion.
function requireLauncher(launcher: string | null): string {
  if (launcher === null) {
    throw new Error('installCodexLauncher() unexpectedly returned null in the test sandbox')
  }
  return launcher
}

describe('NodeTerm Codex remote launcher', () => {
  const oldHome = process.env.HOME
  const nodeTokenA = 'A'.repeat(43)
  const nodeTokenB = 'B'.repeat(43)

  beforeEach(() => setCodexThreadIdentityAuthSecret(Buffer.alloc(32, 9)))

  afterEach(() => {
    vi.unstubAllEnvs()
    homedirMock.mockReset()
    if (oldHome === undefined) delete process.env.HOME
    else process.env.HOME = oldHome
  })

  /** `vi.stubEnv('HOME', root)` alone is a no-op for `os.homedir()` on Windows — see the note by
   *  `SHELL_PATH_ENV_KEYS` above. Every test that stubs HOME calls this right after. */
  function stubHome(root: string): void {
    vi.stubEnv('HOME', root)
    homedirMock.mockReturnValue(root)
  }

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
    const headersA = path.join(root, 'headers-a.txt')
    const headersB = path.join(root, 'headers-b.txt')
    mkdirSync(bin, { recursive: true })
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', {
      mode: 0o600
    })
    writeFileSync(
      fakeCurl,
      '#!/bin/sh\ncat > "$CAPTURE_HEADERS"\nprintf \'%s\\n\' "$@" > "$CAPTURE_BIND"\n',
      { mode: 0o700 }
    )
    writeFileSync(
      fakeCodex,
      '#!/bin/sh\nprintf \'[\' > "$CAPTURE"\nfirst=1\nfor arg in "$@"; do [ "$first" = 1 ] || printf \',\' >> "$CAPTURE"; first=0; node -e \'process.stdout.write(JSON.stringify(process.argv[1]))\' -- "$arg" >> "$CAPTURE"; done\nprintf \']\' >> "$CAPTURE"\n',
      { mode: 0o700 }
    )
    stubHome(root)
    const launcher = requireLauncher(installCodexLauncher())
    const base = {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_HOOK_ENDPOINT: endpoint
    }
    await Promise.all([
      runLauncher(launcher, ['resume', 'thread-a'], {
        ...process.env, ...base, CAPTURE: outA,
        NODETERM_NODE_ID: 'node-a', NODETERM_CODEX_NODE_TOKEN: nodeTokenA,
        NODETERM_CODEX_ACCOUNT_ID: 'account-a', CAPTURE_BIND: bindA, CAPTURE_HEADERS: headersA
      }),
      runLauncher(launcher, ['resume', 'thread-b'], {
        ...process.env, ...base, CAPTURE: outB,
        NODETERM_NODE_ID: 'node-b', NODETERM_CODEX_NODE_TOKEN: nodeTokenB,
        NODETERM_CODEX_ACCOUNT_ID: 'account-b', CAPTURE_BIND: bindB, CAPTURE_HEADERS: headersB
      })
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
    expect(readFileSync(headersA, 'utf8')).toContain(`X-NodeTerm-Node-Token: ${nodeTokenA}`)
    expect(readFileSync(headersB, 'utf8')).toContain(`X-NodeTerm-Node-Token: ${nodeTokenB}`)
  })

  it('pre-creates and binds two fresh sessions independently on the shared app-server', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-fresh-'))
    const bin = path.join(root, 'bin')
    const fakeCodex = path.join(bin, 'codex')
    const fakeCurl = path.join(bin, 'curl')
    const endpoint = path.join(root, 'hook-endpoint.env')
    const outA = path.join(root, 'a.json')
    const outB = path.join(root, 'b.json')
    mkdirSync(bin, { recursive: true })
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
    stubHome(root)
    const launcher = requireLauncher(installCodexLauncher())
    const base = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_HOOK_ENDPOINT: endpoint
    }

    await Promise.all([
      runLauncher(
        launcher,
        ['prompt a'],
        { ...base, CAPTURE: outA, NODETERM_NODE_ID: 'node-a', NODETERM_CODEX_NODE_TOKEN: nodeTokenA },
        root
      ),
      runLauncher(
        launcher,
        ['prompt b'],
        { ...base, CAPTURE: outB, NODETERM_NODE_ID: 'node-b', NODETERM_CODEX_NODE_TOKEN: nodeTokenB },
        root
      )
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
    mkdirSync(bin, { recursive: true })
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
    stubHome(root)
    const launcher = requireLauncher(installCodexLauncher())
    await runLauncher(launcher, ['resume', 'thread-a'], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      CAPTURE: capture,
      CAPTURE_EXPOSE: exposeCapture,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_NODE_ID: 'node-a',
      NODETERM_CODEX_NODE_TOKEN: nodeTokenA,
      NODETERM_HOOK_ENDPOINT: endpoint,
      NODETERM_CODEX_RELAY_RUNTIME: runtime,
      NODETERM_CODEX_RELAY_SCRIPT: script
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
    mkdirSync(bin, { recursive: true })
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', { mode: 0o600 })
    writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\ncat >/dev/null\nexit 22\n', { mode: 0o700 })
    writeFileSync(
      path.join(bin, 'codex'),
      '#!/bin/sh\nnode -e \'require("fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(1)))\' -- "$@"\n',
      { mode: 0o700 }
    )
    writeFileSync(runtime, '#!/bin/sh\nprintf "ws://127.0.0.1:4321\\nroute-token-a\\n"\n', { mode: 0o700 })
    writeFileSync(script, '// isolated fixture\n', { mode: 0o600 })
    stubHome(root)
    const launcher = requireLauncher(installCodexLauncher())

    await runLauncher(
      launcher,
      ['new prompt'],
      {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        CAPTURE: capture,
        NODETERM_CANVAS_CONTROL: '1',
        NODETERM_NODE_ID: 'node-a',
        NODETERM_CODEX_NODE_TOKEN: nodeTokenA,
        NODETERM_HOOK_ENDPOINT: endpoint,
        NODETERM_CODEX_RELAY_RUNTIME: runtime,
        NODETERM_CODEX_RELAY_SCRIPT: script
      },
      root
    )
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
    mkdirSync(bin, { recursive: true })
    writeFileSync(endpoint, 'NODETERM_HOOK_PORT=12345\nNODETERM_HOOK_TOKEN=test-token\n', { mode: 0o600 })
    writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\ncat >/dev/null\nexit 0\n', { mode: 0o700 })
    writeFileSync(
      path.join(bin, 'codex'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${quotePathForPosixShell(codexCapture)}\n`,
      { mode: 0o700 }
    )
    writeFileSync(runtime, '#!/bin/sh\nexit 1\n', { mode: 0o700 })
    writeFileSync(script, '// isolated fixture\n', { mode: 0o600 })
    stubHome(root)
    const launcher = requireLauncher(installCodexLauncher())

    await expect(runLauncher(launcher, ['resume', 'thread-a'], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_NODE_ID: 'node-a',
      NODETERM_CODEX_NODE_TOKEN: nodeTokenA,
      NODETERM_HOOK_ENDPOINT: endpoint,
      NODETERM_CODEX_RELAY_RUNTIME: runtime,
      NODETERM_CODEX_RELAY_SCRIPT: script
    })).rejects.toMatchObject({ code: 69 })
    expect(readFileSync(codexCapture, 'utf8').trim()).toBe('app-server daemon start')
  })

  it('fails closed before launch for a missing or invalid resume-thread mapping key', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-invalid-'))
    const bin = path.join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 99\n', { mode: 0o700 })
    stubHome(root)
    const launcher = requireLauncher(installCodexLauncher())
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_NODE_ID: 'node-a',
      NODETERM_CODEX_NODE_TOKEN: nodeTokenA,
      NODETERM_HOOK_ENDPOINT: '/isolated/node-a/hook.env'
    }
    await expect(runLauncher(launcher, ['resume'], env)).rejects.toMatchObject({ code: 64 })
    await expect(runLauncher(launcher, ['resume', '../other'], env)).rejects.toMatchObject({ code: 64 })
    await expect(
      runLauncher(launcher, ['resume', 'thread-a'], { ...env, NODETERM_CODEX_ACCOUNT_ID: '..' })
    ).rejects.toMatchObject({ code: 64 })
  })

  it('rejects a live duplicate owner but permits replacing a stale node binding', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-binding-'))
    stubHome(root)
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
    ).toMatch(/^accountId=system\nnodeId=node-b\nendpoint=\/isolated\/hook\.env\nsignature=[A-Za-z0-9_-]{43}\n$/)
  })

  it('creates a managed identity while an unscoped legacy system mapping exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-legacy-managed-'))
    const mappings = path.join(root, '.nodeterm', 'codex-thread-nodes')
    mkdirSync(mappings, { recursive: true })
    writeFileSync(
      path.join(mappings, 'legacy-thread'),
      'nodeId=legacy-node\nendpoint=/isolated/hook.env\n'
    )
    stubHome(root)

    expect(() => writeCodexThreadIdentity(
      'managed-thread',
      'managed-node',
      '/isolated/hook.env',
      'account-a'
    )).not.toThrow()
    expect(readFileSync(
      path.join(mappings, 'account-a', 'managed-thread'),
      'utf8'
    )).toMatch(/^accountId=account-a\nnodeId=managed-node\nendpoint=\/isolated\/hook\.env\nsignature=[A-Za-z0-9_-]{43}\n$/)
  })

  it('preflights duplicate ownership without stealing a live thread', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-preflight-'))
    stubHome(root)
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
    stubHome(root)
    const dir = path.join(root, '.nodeterm', 'codex-thread-nodes', 'account-a')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'thread-a'), 'accountId=wrong\nnodeId=../bad\nendpoint=relative\n')
    expect(codexThreadIdentityHasLiveConflict('thread-a', 'node-a', () => false)).toBe(true)
  })

  it('moves one thread id across accounts but rejects a second live node owner', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-account-binding-'))
    stubHome(root)
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
    stubHome(root)
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
    stubHome(root)
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
