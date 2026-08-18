/**
 * The session env the hook server hands every spawned agent. Only the canvas-control gate is
 * covered here, because it is the one pair that is CONDITIONAL: the shim disables itself on its own
 * `NODETERM_CANVAS_CONTROL` check, so an agent missing from CANVAS_CONTROL_CAPABLE has the skill
 * installed and inert — a failure with no symptom other than the agent saying it cannot do it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hookServer } from './hook-server'
import { nodeAuthToken, verifyNodeToken } from './node-auth-token'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform } from '../platform-fake'

let dir = ''
const brokerCalls: Array<{
  nodeId: string
  cwd: string
  hookEndpoint: string
  accountId?: string
}> = []
const bindCalls: Array<{
  nodeId: string
  threadId: string
  hookEndpoint: string
  accountId?: string
}> = []
const authorizeCalls: Array<{ nodeId: string; threadId: string; accountId?: string }> = []
const exposeCalls: Array<{ nodeId: string; threadId: string; accountId?: string }> = []

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-hookenv-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  hookServer.setCodexNodeAuthSecret(Buffer.alloc(32, 7))
  hookServer.setCodexThreadStartHandler(async (request) => {
    brokerCalls.push(request)
    return `thread-${request.nodeId}`
  })
  hookServer.setCodexThreadBindHandler(async (request) => {
    bindCalls.push(request)
    if (request.threadId === 'thread-conflict') throw new Error('already bound')
  })
  hookServer.setCodexThreadAuthorizeHandler(async (request) => {
    authorizeCalls.push(request)
    if (request.threadId === 'thread-conflict') throw new Error('already bound')
  })
  hookServer.setCodexThreadExposeHandler(async (request) => {
    exposeCalls.push(request)
    if (request.threadId === 'thread-conflict') throw new Error('ambiguous')
  })
  hookServer.setCodexThreadCatalogHandler(async () => [
    { socketPath: '/isolated/system.sock' },
    { accountId: 'account-a', socketPath: '/isolated/account-a.sock' }
  ])
  // buildPtyEnv returns {} until the server has a port and a token.
  await hookServer.start()
  // ...and the per-node capability branch is dead code until a node-auth secret is armed. Without
  // this line the argv-leak guard below passes for the wrong reason: it asserts the absence of a
  // key the code was never going to emit.
  hookServer.setNodeAuthSecret(new Uint8Array(32).fill(7))
})

afterAll(() => {
  hookServer.clearNodeAuthSecretForTests() // module singleton — otherwise it leaks into other files
  hookServer.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('hookServer.buildPtyEnv — canvas control gate', () => {
  it('arms canvas control for a grok session', () => {
    expect(hookServer.buildPtyEnv('n1', 'grok').NODETERM_CANVAS_CONTROL).toBe('1')
  })

  it('arms it for the other capable builtins too', () => {
    for (const id of ['claude', 'codex', 'gemini', 'opencode'])
      expect(hookServer.buildPtyEnv('n1', id).NODETERM_CANVAS_CONTROL, id).toBe('1')
  })

  it('leaves the pair absent for a custom agent', () => {
    // Absent, not '0': the shim tests for a non-empty value.
    expect(hookServer.buildPtyEnv('n1', 'custom:abc')).not.toHaveProperty('NODETERM_CANVAS_CONTROL')
  })

  it('still identifies the agent to the hook, whatever the gate says', () => {
    expect(hookServer.buildPtyEnv('n1', 'grok').NODETERM_AGENT_ID).toBe('grok')
    expect(hookServer.buildPtyEnv('n1', 'grok').NODETERM_NODE_ID).toBe('n1')
  })

  it('gives each Codex node a stable distinct identity capability outside the shared endpoint', () => {
    // NOT buildPtyEnv(...).NODETERM_CODEX_NODE_TOKEN: measured 2026-08-13, that field rode the
    // tmux `-e` argv into a long-lived tmux client whose /proc/<pid>/cmdline is world-readable on
    // a stock Linux (no hidepid) — buildPtyEnv() deliberately never emits it any more (see its own
    // "NO NODETERM_CODEX_NODE_TOKEN either" comment, and the regression guard in
    // codex-launcher-sh.test.ts asserting `baseEnv().NODETERM_CODEX_NODE_TOKEN` is undefined). The
    // real per-node capability is codexNodeAuthToken(nodeId), delivered to the client through the
    // 0600 node-token file instead — this test's own title still holds, only the retrieval API does.
    const a = hookServer.codexNodeAuthToken('node-a')
    const b = hookServer.codexNodeAuthToken('node-b')
    // `kid.mac`, the one canonical wire shape. This asserted a bare 43-char MAC with no dot,
    // which is exactly the derivation that could never match the token a client actually holds —
    // so the shape assertion was pinning the bug in place. The property that matters is the last
    // one below: what this mints must verify, which is the check the drift walked straight past.
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(b).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(hookServer.codexNodeAuthToken('node-a')).toBe(a)
    expect(fs.readFileSync(path.join(dir, 'hook-endpoint.env'), 'utf8')).not.toContain(a)
    expect(hookServer.buildPtyEnv('node-a', 'codex')).not.toHaveProperty('NODETERM_CODEX_NODE_TOKEN')
    // Mint and verify must agree, and must be the SAME derivation the client's token file carries.
    expect(verifyNodeToken(hookServer.nodeAuthSecretOrNull(), 'node-a', a)).toBe('verified')
    expect(verifyNodeToken(hookServer.nodeAuthSecretOrNull(), 'node-b', a)).not.toBe('verified')
  })
})

describe('hookServer Codex thread broker', () => {
  const nodeToken = (nodeId: string) => hookServer.codexNodeAuthToken(nodeId)
  const nodeHeaders = (nodeId: string) => ({ 'x-nodeterm-node-token': nodeToken(nodeId) })
  const request = (nodeId: string, cwd: string, accountId?: string) =>
    fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': hookServer.getToken(),
        ...nodeHeaders(nodeId)
      },
      body: new URLSearchParams({ nodeId, cwd, ...(accountId ? { accountId } : {}) })
    })
  const bind = (nodeId: string, threadId: string, token = nodeToken(nodeId)) =>
    fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/bind`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': hookServer.getToken(),
        'x-nodeterm-node-token': token
      },
      body: new URLSearchParams({ nodeId, threadId })
    })
  const authorize = (nodeId: string, threadId: string, accountId?: string) =>
    fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': hookServer.getToken(),
        ...nodeHeaders(nodeId)
      },
      body: new URLSearchParams({ nodeId, threadId, ...(accountId ? { accountId } : {}) })
    })
  const expose = (nodeId: string, threadId: string, accountId?: string) =>
    fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/expose`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': hookServer.getToken(),
        ...nodeHeaders(nodeId)
      },
      body: new URLSearchParams({ nodeId, threadId, ...(accountId ? { accountId } : {}) })
    })

  it('keeps two parallel session creations bound to their requesting nodes', async () => {
    const [a, b] = await Promise.all([
      request('node-a', '/isolated/node-a'),
      request('node-b', '/isolated/node-b')
    ])

    expect([a.status, b.status]).toEqual([200, 200])
    await expect(Promise.all([a.text(), b.text()])).resolves.toEqual([
      'thread-node-a\n',
      'thread-node-b\n'
    ])
    expect(brokerCalls).toEqual([
      {
        nodeId: 'node-a',
        cwd: '/isolated/node-a',
        hookEndpoint: path.join(dir, 'hook-endpoint.env')
      },
      {
        nodeId: 'node-b',
        cwd: '/isolated/node-b',
        hookEndpoint: path.join(dir, 'hook-endpoint.env')
      }
    ])
  })

  it('rejects missing or invalid node/cwd identity before the broker', async () => {
    const before = brokerCalls.length
    const [missing, traversal, invalidAccount] = await Promise.all([
      request('', '/isolated/node'),
      request('node-c', '../other'),
      request('node-d', '/isolated/node', '..')
    ])
    expect([missing.status, traversal.status, invalidAccount.status]).toEqual([400, 400, 400])
    expect(brokerCalls).toHaveLength(before)
  })

  it('routes two parallel accounts to distinct broker identities', async () => {
    const before = brokerCalls.length
    const [a, b] = await Promise.all([
      request('node-account-a', '/isolated/a', 'account-a'),
      request('node-account-b', '/isolated/b', 'account-b')
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(brokerCalls.slice(before)).toEqual([
      expect.objectContaining({ nodeId: 'node-account-a', accountId: 'account-a' }),
      expect.objectContaining({ nodeId: 'node-account-b', accountId: 'account-b' })
    ])
  })

  it('binds explicit resumes and fails closed on invalid or conflicting ownership', async () => {
    const [accepted, invalid, conflict] = await Promise.all([
      bind('node-resume', 'thread-resume'),
      bind('node-resume', '../invalid'),
      bind('node-other', 'thread-conflict')
    ])
    expect([accepted.status, invalid.status, conflict.status]).toEqual([204, 400, 409])
    expect(bindCalls).toContainEqual({
      nodeId: 'node-resume',
      threadId: 'thread-resume',
      hookEndpoint: path.join(dir, 'hook-endpoint.env')
    })
  })

  it('rejects a valid global bearer when its node capability belongs to another node', async () => {
    const before = bindCalls.length
    const [forged, missing] = await Promise.all([
      bind('victim-node', 'victim-thread', nodeToken('attacker-node')),
      fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/bind`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-nodeterm-hook-token': hookServer.getToken()
        },
        body: new URLSearchParams({ nodeId: 'victim-node', threadId: 'victim-thread' })
      })
    ])
    expect([forged.status, missing.status]).toEqual([403, 403])
    expect(bindCalls).toHaveLength(before)
  })

  it('authorizes a relay resume only through the account-scoped ownership preflight', async () => {
    const [accepted, invalid, conflict] = await Promise.all([
      authorize('node-resume', 'thread-resume', 'account-a'),
      authorize('node-resume', '../invalid'),
      authorize('node-other', 'thread-conflict')
    ])
    expect([accepted.status, invalid.status, conflict.status]).toEqual([204, 400, 409])
    expect(authorizeCalls).toContainEqual({
      nodeId: 'node-resume',
      threadId: 'thread-resume',
      accountId: 'account-a'
    })
  })

  it('exposes only the exact caller-supplied id to the selected account', async () => {
    const [accepted, invalid, conflict] = await Promise.all([
      expose('node-resume', 'thread-resume', 'account-a'),
      expose('node-resume', '../invalid'),
      expose('node-resume', 'thread-conflict', 'account-b')
    ])
    expect([accepted.status, invalid.status, conflict.status]).toEqual([204, 400, 409])
    // The route scopes the expose to the CALLER's node as well as the account — `nodeId` is
    // what makes 'the exact caller-supplied id' exact, so it is part of the recorded call.
    expect(exposeCalls).toContainEqual({
      nodeId: 'node-resume',
      threadId: 'thread-resume',
      accountId: 'account-a'
    })
  })

  it('returns the isolated account socket catalog only to the authenticated relay', async () => {
    const url = `http://127.0.0.1:${hookServer.getPort()}/codex-thread/catalog`
    const [accepted, rejected] = await Promise.all([
      fetch(url, {
        method: 'POST',
        headers: {
          'x-nodeterm-hook-token': hookServer.getToken(),
          'x-nodeterm-node-id': 'node-catalog',
          ...nodeHeaders('node-catalog')
        }
      }),
      fetch(url, { method: 'POST' })
    ])
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toEqual({
      accounts: [
        { socketPath: '/isolated/system.sock' },
        { accountId: 'account-a', socketPath: '/isolated/account-a.sock' }
      ]
    })
    expect(rejected.status).toBe(403)
  })
})

describe('hookServer.setNodeAuthSecret — length guard', () => {
  it('rejects a secret shorter than 32 bytes rather than arming a weak identity', () => {
    expect(() => hookServer.setNodeAuthSecret(new Uint8Array(31))).toThrow(/invalid|secret/i)
  })
})

describe('hookServer.buildPtyEnv — no credential in the tmux -e argv (the §2.1 regression guard)', () => {
  it('emits no bearer token and no port — they leaked through /proc/<pid>/cmdline', () => {
    const env = hookServer.buildPtyEnv('n1', 'claude')
    expect(env).not.toHaveProperty('NODETERM_HOOK_TOKEN')
    expect(env).not.toHaveProperty('NODETERM_HOOK_PORT')
    // The tmux `-e` argv is built by flattening this map — assert the live token never appears in it.
    const argv = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
    expect(argv.join(' ')).not.toContain(hookServer.getToken())
  })

  it('still carries the non-credential wiring: endpoint file path, node id, agent id, version', () => {
    const env = hookServer.buildPtyEnv('n1', 'claude')
    expect(env.NODETERM_HOOK_ENDPOINT).toBeTruthy()
    expect(env.NODETERM_NODE_ID).toBe('n1')
    expect(env.NODETERM_AGENT_ID).toBe('claude')
    expect(env.NODETERM_HOOK_VERSION).toBe('2')
  })

  /**
   * The PER-NODE capability is the same class of leak as the app-wide bearer above and needs its own
   * assertion, on an agent that can actually trigger the emitting branch: `claude` is not in
   * SHARED_IDENTITY_CAPABLE, so the case above never reaches the mint at all. Both preconditions —
   * a capable agent AND an armed secret — are asserted here, because a guard that reads green while
   * its subject is unreachable is worse than no guard.
   */
  it('emits no PER-NODE capability either, for a shared-identity agent with identity armed', () => {
    expect(hookServer.identityAvailable()).toBe(true)
    const minted = nodeAuthToken(hookServer.nodeAuthSecretOrNull()!, 'n1')
    expect(minted).toBeTruthy() // the value that must NOT be reachable via /proc/<pid>/cmdline
    const env = hookServer.buildPtyEnv('n1', 'codex')
    expect(Object.keys(env).filter((k) => /token/i.test(k))).toEqual([])
    const argv = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
    expect(argv.join(' ')).not.toContain(minted)
    // ...while the rest of the codex wiring is untouched, so the launcher still reaches the shell.
    expect(env.NODETERM_AGENT_ID).toBe('codex')
    expect(env.NODETERM_HOOK_ENDPOINT).toBeTruthy()
  })
})
