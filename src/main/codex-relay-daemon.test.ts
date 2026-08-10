import { describe, expect, it } from 'vitest'
import { createServer } from 'http'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { WebSocketServer } from 'ws'
import {
  acquireProcessLock,
  listThreadsAt,
  mergeRelayThreadLists,
  readThreadAt,
  relayControlPost,
  relayThreadReservationKey,
  resolveForeignThreadAt,
  retargetRelayResumeByPath,
  resolveRelayThreadResponse,
  trackRelayThreadRequest,
  type RelayThreadRequest
} from './codex-relay-daemon'

async function fakeCodexServer(
  socketPath: string,
  onRequest: (message: any) => any
): Promise<() => Promise<void>> {
  const server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('message', (raw) => {
        const response = onRequest(JSON.parse(raw.toString()))
        if (response) ws.send(JSON.stringify(response))
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  return async () => {
    for (const client of wss.clients) client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('Codex shared relay thread observation', () => {
  it('binds the exact native thread/start response without a seed resume or fork', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, { id: 6, method: 'thread/start', params: { cwd: '/tmp' } })
    expect(resolveRelayThreadResponse(pending, {
      id: 6,
      result: { thread: { id: 'new-thread', name: 'Fresh' } }
    })).toEqual({ ok: true, threadId: 'new-thread', source: undefined, name: 'Fresh' })
  })

  it('keeps equal JSON-RPC ids isolated between two parallel node connections', () => {
    const a = new Map<string, RelayThreadRequest>()
    const b = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(a, {
      id: 7,
      method: 'thread/resume',
      params: { threadId: 'source-a' }
    })
    trackRelayThreadRequest(b, {
      id: 7,
      method: 'thread/resume',
      params: { threadId: 'source-b' }
    })

    expect(
      resolveRelayThreadResponse(a, {
        id: 7,
        result: { thread: { id: 'source-a' } }
      })
    ).toEqual({
      ok: true,
      threadId: 'source-a',
      source: 'source-a',
      name: undefined
    })
    expect(
      resolveRelayThreadResponse(b, {
        id: 7,
        result: { thread: { id: 'source-b', name: 'B' } }
      })
    ).toEqual({
      ok: true,
      threadId: 'source-b',
      source: 'source-b',
      name: 'B'
    })
  })

  it('ignores unrelated methods and fails closed on malformed thread ids', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, {
      id: 1,
      method: 'turn/start',
      params: { threadId: 'source' }
    })
    expect(pending.size).toBe(0)
    trackRelayThreadRequest(pending, {
      id: 2,
      method: 'thread/resume',
      params: { threadId: 'source' }
    })
    expect(
      resolveRelayThreadResponse(pending, {
        id: 2,
        result: { thread: { id: '../wrong' } }
      })
    ).toEqual({ ok: false })
    expect(pending.size).toBe(0)
  })

  it('normalizes a blank app-server name so the session-index fallback remains reachable', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, { id: 3, method: 'thread/resume', params: { threadId: 'source' } })
    expect(resolveRelayThreadResponse(pending, {
      id: 3,
      result: { thread: { id: 'source', name: '   ' } }
    })).toEqual({ ok: true, threadId: 'source', source: 'source', name: undefined })
  })

  it('rejects a path-resume response that changes the conversation id', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, {
      id: 4,
      method: 'thread/resume',
      params: { threadId: 'source' }
    })
    expect(resolveRelayThreadResponse(pending, {
      id: 4,
      result: { thread: { id: 'forked' } }
    })).toEqual({ ok: false, unexpectedThreadId: 'forked' })
  })

  it('keeps two account catalogs visible while preserving the selected account as duplicate owner', () => {
    const current = '/tmp/current/app-server-control.sock'
    const foreign = '/tmp/foreign/app-server-control.sock'
    const merged = mergeRelayThreadLists([
      {
        socketPath: foreign,
        threads: [
          { id: 'foreign-1', path: '/foreign/rollout.jsonl', cwd: '/repo', name: 'Foreign', updatedAt: 30 },
          { id: 'same', path: '/foreign/same.jsonl', cwd: '/repo', updatedAt: 40 }
        ]
      },
      {
        socketPath: current,
        threads: [
          { id: 'current-1', path: '/current/rollout.jsonl', cwd: '/repo', updatedAt: 20 },
          { id: 'same', path: '/current/same.jsonl', cwd: '/repo', updatedAt: 10 }
        ]
      }
    ], current, { limit: 10, sortKey: 'updated_at', sortDirection: 'desc' })

    expect(merged.result.data.map((thread) => thread.id)).toEqual(['foreign-1', 'current-1', 'same'])
    expect(merged.result.data.find((thread) => thread.id === 'same')?.path).toBe('/current/same.jsonl')
    expect(merged.foreignThreads.get('foreign-1')).toEqual({
      socketPath: foreign,
      path: '/foreign/rollout.jsonl',
      cwd: '/repo',
      name: 'Foreign'
    })
    expect(merged.foreignThreads.has('same')).toBe(false)
  })

  it('paginates the merged catalog and never advertises an unimportable foreign thread', () => {
    const current = '/tmp/current/app-server-control.sock'
    const foreign = '/tmp/foreign/app-server-control.sock'
    const sources = [{
      socketPath: foreign,
      threads: [
        { id: 'newest', path: '/foreign/newest.jsonl', cwd: '/repo', createdAt: 3 },
        { id: 'missing-path', path: null, cwd: '/repo', createdAt: 4 },
        { id: 'oldest', path: '/foreign/oldest.jsonl', cwd: '/repo', createdAt: 1 }
      ]
    }, {
      socketPath: current,
      threads: [{ id: 'middle', path: '/current/middle.jsonl', cwd: '/repo', createdAt: 2 }]
    }]
    const first = mergeRelayThreadLists(sources, current, {
      limit: 2,
      sortKey: 'created_at',
      sortDirection: 'desc'
    })
    expect(first.result.data.map((thread) => thread.id)).toEqual(['newest', 'middle'])
    expect(first.result.nextCursor).toMatch(/^nodeterm:/)
    sources[1].threads.push({ id: 'inserted', path: '/current/inserted.jsonl', cwd: '/repo', createdAt: 4 })
    const second = mergeRelayThreadLists(sources, current, {
      limit: 2,
      cursor: first.result.nextCursor,
      sortKey: 'created_at',
      sortDirection: 'desc'
    })
    expect(second.result.data.map((thread) => thread.id)).toEqual(['oldest'])
    expect(second.result.backwardsCursor).toBeNull()
    expect(second.result.nextCursor).toBeNull()
  })

  it('fails closed when the same id belongs to two foreign account stores', () => {
    const current = '/tmp/current/app-server-control.sock'
    const merged = mergeRelayThreadLists([
      { socketPath: current, threads: [] },
      {
        socketPath: '/tmp/a/app-server-control.sock',
        threads: [{ id: 'collision', path: '/a/rollout.jsonl', cwd: '/repo', createdAt: 2 }]
      },
      {
        socketPath: '/tmp/b/app-server-control.sock',
        threads: [{ id: 'collision', path: '/b/rollout.jsonl', cwd: '/repo', createdAt: 2 }]
      }
    ], current, {})
    expect(merged.result.data).toEqual([])
    expect(merged.foreignThreads.size).toBe(0)
  })

  it('keeps one hardlinked rollout visible once when two foreign accounts expose it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-picker-hardlink-'))
    const rolloutA = path.join(dir, 'a.jsonl')
    const rolloutB = path.join(dir, 'b.jsonl')
    writeFileSync(rolloutA, 'one inode')
    linkSync(rolloutA, rolloutB)
    const current = path.join(dir, 'current.sock')
    const merged = mergeRelayThreadLists([
      { socketPath: current, threads: [] },
      { socketPath: path.join(dir, 'a.sock'), threads: [{ id: 'shared', path: rolloutA, cwd: '/repo' }] },
      { socketPath: path.join(dir, 'b.sock'), threads: [{ id: 'shared', path: rolloutB, cwd: '/repo' }] }
    ], current, {})
    expect(merged.result.data.map((thread) => thread.id)).toEqual(['shared'])
    expect(merged.foreignThreads.get('shared')?.path).toBe(rolloutA)
    rmSync(dir, { recursive: true, force: true })
  })

  it('carries a foreign title through the path-resumed response', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, {
      id: 8,
      method: 'thread/resume',
      params: { threadId: 'foreign-id' }
    }, 'Foreign title')
    expect(resolveRelayThreadResponse(pending, {
      id: 8,
      result: { thread: { id: 'foreign-id', name: null } }
    })).toEqual({
      ok: true,
      threadId: 'foreign-id',
      source: 'foreign-id',
      name: 'Foreign title'
    })
  })

  it('resumes the verified foreign path without changing the conversation id', () => {
    expect(retargetRelayResumeByPath({
      id: 9,
      method: 'thread/resume',
      params: {
        threadId: 'foreign-id',
        path: '/foreign/rollout.jsonl',
        history: [{ role: 'user' }],
        cwd: '/repo'
      }
    }, 'foreign-id', '/verified/rollout.jsonl', '/repo')).toEqual({
      id: 9,
      method: 'thread/resume',
      params: { threadId: 'foreign-id', path: '/verified/rollout.jsonl', cwd: '/repo' }
    })
  })

  it('uses one global reservation for a thread across every source and target account', () => {
    const key = relayThreadReservationKey('thread-1')
    expect(relayThreadReservationKey('thread-1')).toBe(key)
    expect(relayThreadReservationKey('thread-2')).not.toBe(key)
  })

  it('lists and freshly verifies a paginated foreign fixture before path resume', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-accounts-'))
    const sourceSocket = path.join(dir, 'source.sock')
    const sourceRequests: any[] = []
    const stopSource = await fakeCodexServer(sourceSocket, (message) => {
      sourceRequests.push(message)
      if (message.id === 1) return { id: 1, result: {} }
      if (message.id === 2 && message.method === 'thread/read') return {
        id: 2,
        result: {
          thread: { id: 'foreign-a', path: '/fixtures/a-fresh.jsonl', cwd: '/repo', name: 'Fresh' }
        }
      }
      if (message.id === 2) return {
        id: 2,
        result: {
          data: [{ id: 'foreign-a', path: '/fixtures/a.jsonl', cwd: '/repo', updatedAt: 2 }],
          nextCursor: 'page-2'
        }
      }
      if (message.id === 3) return {
        id: 3,
        result: {
          data: [{ id: 'foreign-b', path: '/fixtures/b.jsonl', cwd: '/repo', updatedAt: 1 }],
          nextCursor: null
        }
      }
    })
    try {
      await expect(listThreadsAt(sourceSocket, { cwd: '/repo' })).resolves.toHaveLength(2)
      await expect(readThreadAt(sourceSocket, 'foreign-a')).resolves.toMatchObject({
        id: 'foreign-a',
        path: '/fixtures/a-fresh.jsonl'
      })
      expect(sourceRequests.filter((message) => message.method === 'thread/list').map((message) =>
        message.params.cursor
      )).toEqual([null, 'page-2'])
    } finally {
      await stopSource()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a direct resume to exactly one foreign account without picker state', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-direct-resume-'))
    const currentSocket = path.join(dir, 'current.sock')
    const foreignSocket = path.join(dir, 'foreign.sock')
    const foreignRollout = path.join(dir, 'foreign-thread-a.jsonl')
    writeFileSync(foreignRollout, 'fixture')
    const stopCurrent = await fakeCodexServer(currentSocket, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read') return {
        id: message.id,
        error: { code: -32600, message: 'thread not loaded: thread-a' }
      }
    })
    const stopForeign = await fakeCodexServer(foreignSocket, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read') return {
        id: message.id,
        result: {
          thread: {
            id: 'thread-a',
            path: foreignRollout,
            cwd: '/repo',
            name: 'Existing conversation'
          }
        }
      }
    })
    try {
      await expect(resolveForeignThreadAt(
        currentSocket,
        [currentSocket, foreignSocket],
        'thread-a'
      )).resolves.toEqual({
        kind: 'foreign',
        thread: {
          socketPath: foreignSocket,
          path: foreignRollout,
          cwd: '/repo',
          name: 'Existing conversation'
        }
      })
    } finally {
      await Promise.all([stopCurrent(), stopForeign()])
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('distinguishes a native thread from an unavailable id', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-native-resume-'))
    const currentSocket = path.join(dir, 'current.sock')
    const stop = await fakeCodexServer(currentSocket, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read' && message.params.threadId === 'native-id') return {
        id: message.id,
        result: {
          thread: { id: 'native-id', path: '/current/native.jsonl', cwd: '/repo' }
        }
      }
      if (message.method === 'thread/read') return {
        id: message.id,
        error: { code: -32600, message: `no rollout found for thread id ${message.params.threadId}` }
      }
    })
    try {
      await expect(resolveForeignThreadAt(
        currentSocket,
        [currentSocket],
        'native-id'
      )).resolves.toEqual({ kind: 'native' })
      await expect(resolveForeignThreadAt(
        currentSocket,
        [currentSocket],
        'missing-id'
      )).resolves.toEqual({ kind: 'unavailable' })
    } finally {
      await stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps direct resume fail-closed when two foreign accounts expose the same id', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-ambiguous-resume-'))
    const currentSocket = path.join(dir, 'current.sock')
    const foreignA = path.join(dir, 'foreign-a.sock')
    const foreignB = path.join(dir, 'foreign-b.sock')
    const rolloutA = path.join(dir, 'foreign-a.jsonl')
    const rolloutB = path.join(dir, 'foreign-b.jsonl')
    writeFileSync(rolloutA, 'a')
    writeFileSync(rolloutB, 'b')
    const server = (socketPath: string, rolloutPath?: string) => fakeCodexServer(socketPath, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read' && rolloutPath) return {
        id: message.id,
        result: { thread: { id: 'same-id', path: rolloutPath, cwd: '/repo' } }
      }
      if (message.method === 'thread/read') return {
        id: message.id,
        error: { code: -32600, message: `no rollout found for thread id ${message.params.threadId}` }
      }
    })
    const stops = await Promise.all([
      server(currentSocket),
      server(foreignA, rolloutA),
      server(foreignB, rolloutB)
    ])
    try {
      await expect(resolveForeignThreadAt(
        currentSocket,
        [currentSocket, foreignA, foreignB],
        'same-id'
      )).resolves.toEqual({ kind: 'ambiguous' })
    } finally {
      await Promise.all(stops.map((stop) => stop()))
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('deduplicates the same account-neutral rollout exposed by two foreign accounts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-shared-resume-'))
    const currentSocket = path.join(dir, 'current.sock')
    const foreignA = path.join(dir, 'foreign-a.sock')
    const foreignB = path.join(dir, 'foreign-b.sock')
    const rollout = path.join(dir, 'shared.jsonl')
    const aliasA = path.join(dir, 'a.jsonl')
    const aliasB = path.join(dir, 'b.jsonl')
    writeFileSync(rollout, 'shared')
    symlinkSync(rollout, aliasA)
    symlinkSync(rollout, aliasB)
    const server = (socketPath: string, rolloutPath?: string) => fakeCodexServer(socketPath, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read' && rolloutPath) return {
        id: message.id,
        result: { thread: { id: 'same-id', path: rolloutPath, cwd: '/repo' } }
      }
      if (message.method === 'thread/read') return {
        id: message.id,
        error: { code: -32600, message: `no rollout found for thread id ${message.params.threadId}` }
      }
    })
    const stops = await Promise.all([
      server(currentSocket),
      server(foreignA, aliasA),
      server(foreignB, aliasB)
    ])
    try {
      await expect(resolveForeignThreadAt(
        currentSocket,
        [currentSocket, foreignA, foreignB],
        'same-id'
      )).resolves.toMatchObject({ kind: 'foreign', thread: { path: aliasA } })
    } finally {
      await Promise.all(stops.map((stop) => stop()))
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed when one foreign account matches but another account is unavailable', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-partial-catalog-'))
    const currentSocket = path.join(dir, 'current.sock')
    const foreignSocket = path.join(dir, 'foreign.sock')
    const unavailableSocket = path.join(dir, 'unavailable.sock')
    const stopCurrent = await fakeCodexServer(currentSocket, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read') return {
        id: message.id,
        error: { code: -32600, message: 'no rollout found for thread id same-id' }
      }
    })
    const stopForeign = await fakeCodexServer(foreignSocket, (message) => {
      if (message.id === 1) return { id: 1, result: {} }
      if (message.method === 'thread/read') return {
        id: message.id,
        result: { thread: { id: 'same-id', path: '/foreign/thread.jsonl', cwd: '/repo' } }
      }
    })
    try {
      await expect(resolveForeignThreadAt(
        currentSocket,
        [currentSocket, foreignSocket, unavailableSocket],
        'same-id'
      )).resolves.toEqual({ kind: 'unavailable' })
    } finally {
      await Promise.all([stopCurrent(), stopForeign()])
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reclaims a dead lock but never steals one owned by a live process', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-lock-'))
    const lock = path.join(dir, 'relay.lock')
    writeFileSync(lock, '99999999\n')
    expect(acquireProcessLock(lock)).toBe(true)
    expect(readFileSync(path.join(lock, 'owner'), 'utf8').trim()).toBe(String(process.pid))
    expect(acquireProcessLock(lock)).toBe(false)
  })

  it('never steals a freshly created directory lock before its owner pid is written', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-lock-race-'))
    const lock = path.join(dir, 'relay.lock')
    mkdirSync(lock)
    expect(acquireProcessLock(lock)).toBe(false)
  })

  it('times out a stale control port that accepts but never answers', async () => {
    const server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test port')
    const started = Date.now()
    await expect(relayControlPost(address.port, 'token', '/ping', {})).rejects.toThrow('timed out')
    expect(Date.now() - started).toBeLessThan(2_000)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
