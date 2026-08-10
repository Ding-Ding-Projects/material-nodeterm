import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCodexThreadNodeIdentity } from './codex-identity-proxy'

const roots: string[] = []

function root(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-identity-'))
  roots.push(value)
  return value
}

function identity(rootDir: string, scope: string, threadId: string, nodeId: string): void {
  const directory = path.join(rootDir, scope)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, threadId),
    `accountId=${scope}\nnodeId=${nodeId}\nendpoint=/tmp/nodeterm-hook/endpoint\n`
  )
}

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
      'nodeId=node-a\nendpoint=/tmp/nodeterm-hook/endpoint\n'
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
})
