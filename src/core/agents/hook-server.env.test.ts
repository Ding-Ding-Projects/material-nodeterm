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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-hookenv-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  hookServer.setCodexThreadStartHandler(async (request) => {
    brokerCalls.push(request)
    return `thread-${request.nodeId}`
  })
  hookServer.setCodexThreadBindHandler(async (request) => {
    bindCalls.push(request)
    if (request.threadId === 'thread-conflict') throw new Error('already bound')
  })
  // buildPtyEnv returns {} until the server has a port and a token.
  await hookServer.start()
})

afterAll(() => {
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
})

describe('hookServer Codex thread broker', () => {
  const request = (nodeId: string, cwd: string, accountId?: string) =>
    fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': hookServer.getToken()
      },
      body: new URLSearchParams({ nodeId, cwd, ...(accountId ? { accountId } : {}) })
    })
  const bind = (nodeId: string, threadId: string) =>
    fetch(`http://127.0.0.1:${hookServer.getPort()}/codex-thread/bind`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-nodeterm-hook-token': hookServer.getToken()
      },
      body: new URLSearchParams({ nodeId, threadId })
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
})
