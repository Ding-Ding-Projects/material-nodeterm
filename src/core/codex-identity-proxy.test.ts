import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveCodexThreadNodeIdentity, setCodexThreadIdentityAuthSecret } from './codex-identity-proxy'

const roots: string[] = []
const authSecret = Buffer.alloc(32, 11)

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-identity-'))
  roots.push(value)
  return value
}

function identity(rootDir: string, scope: string, threadId: string, nodeId: string): void {
  const directory = path.join(rootDir, scope)
  fs.mkdirSync(directory, { recursive: true })
  const endpoint = '/tmp/nodeterm-hook/endpoint'
  const signature = createHmac('sha256', authSecret)
    .update(`${threadId}\0${scope}\0${nodeId}\0${endpoint}`)
    .digest('base64url')
  fs.writeFileSync(
    path.join(directory, threadId),
    `accountId=${scope}\nnodeId=${nodeId}\nendpoint=${endpoint}\nsignature=${signature}\n`
  )
}

beforeEach(() => setCodexThreadIdentityAuthSecret(authSecret))

afterEach(() => {
  for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true })
})

describe('resolveCodexThreadNodeIdentity', () => {
  it('recovers one account-scoped owner after an app restart', () => {
    const dir = root()
    identity(dir, 'account-a', 'thread-1', 'node-a')
    expect(resolveCodexThreadNodeIdentity('thread-1', dir)).toBe('node-a')
  })

  it('accepts duplicate legacy and system records only when their owner matches', () => {
    const dir = root()
    identity(dir, 'system', 'thread-1', 'node-a')
    fs.writeFileSync(
      path.join(dir, 'thread-1'),
      `nodeId=node-a\nendpoint=/tmp/nodeterm-hook/endpoint\nsignature=${createHmac('sha256', authSecret)
        .update('thread-1\0system\0node-a\0/tmp/nodeterm-hook/endpoint')
        .digest('base64url')}\n`
    )
    expect(resolveCodexThreadNodeIdentity('thread-1', dir)).toBe('node-a')
  })

  it('fails closed for the same thread id owned by different accounts', () => {
    const dir = root()
    identity(dir, 'account-a', 'thread-1', 'node-a')
    identity(dir, 'account-b', 'thread-1', 'node-b')
    expect(resolveCodexThreadNodeIdentity('thread-1', dir)).toBeUndefined()
  })

  it('ignores malformed, mismatched, and invalid mappings', () => {
    const dir = root()
    identity(dir, 'account-a', 'thread-1', 'node-a')
    fs.writeFileSync(
      path.join(dir, 'account-a', 'thread-1'),
      'accountId=account-b\nnodeId=../node\nendpoint=relative\n'
    )
    expect(resolveCodexThreadNodeIdentity('thread-1', dir)).toBeUndefined()
    expect(resolveCodexThreadNodeIdentity('../thread', dir)).toBeUndefined()
  })

  it('rejects an otherwise valid mapping whose owner was edited without the signing key', () => {
    const dir = root()
    identity(dir, 'account-a', 'thread-1', 'node-a')
    const file = path.join(dir, 'account-a', 'thread-1')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('nodeId=node-a', 'nodeId=victim-node'))
    expect(resolveCodexThreadNodeIdentity('thread-1', dir)).toBeUndefined()
  })
})
