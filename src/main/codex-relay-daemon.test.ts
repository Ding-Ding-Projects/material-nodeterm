import { describe, expect, it } from 'vitest'
import { createServer } from 'http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { WebSocketServer } from 'ws'
import {
  acquireProcessLock,
  forkForeignThreadAt,
  listThreadsAt,
  mergeRelayThreadLists,
  readThreadAt,
  relayControlPost,
  relaySourceReservationKey,
  retargetRelayResume,
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
        result: { thread: { id: 'active-a' } }
      })
    ).toEqual({
      threadId: 'active-a',
      source: 'source-a',
      name: undefined
    })
    expect(
      resolveRelayThreadResponse(b, {
        id: 7,
        result: { thread: { id: 'active-b', name: 'B' } }
      })
    ).toEqual({
      threadId: 'active-b',
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
    ).toBeUndefined()
    expect(pending.size).toBe(0)
  })

  it('normalizes a blank app-server name so the session-index fallback remains reachable', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, { id: 3, method: 'thread/resume', params: { threadId: 'source' } })
    expect(resolveRelayThreadResponse(pending, {
      id: 3,
      result: { thread: { id: 'active', name: '   ' } }
    })).toEqual({ threadId: 'active', source: 'source', name: undefined })
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

  it('carries a foreign title through the imported resume response', () => {
    const pending = new Map<string, RelayThreadRequest>()
    trackRelayThreadRequest(pending, {
      id: 8,
      method: 'thread/resume',
      params: { threadId: 'imported-id' }
    }, 'Foreign title')
    expect(resolveRelayThreadResponse(pending, {
      id: 8,
      result: { thread: { id: 'imported-id', name: null } }
    })).toEqual({
      threadId: 'imported-id',
      source: 'imported-id',
      name: 'Foreign title'
    })
  })

  it('resumes only the imported target id even when the picker repeats source path/history', () => {
    expect(retargetRelayResume({
      id: 9,
      method: 'thread/resume',
      params: {
        threadId: 'foreign-id',
        path: '/foreign/rollout.jsonl',
        history: [{ role: 'user' }],
        cwd: '/repo'
      }
    }, 'imported-id')).toEqual({
      id: 9,
      method: 'thread/resume',
      params: { threadId: 'imported-id', cwd: '/repo' }
    })
  })

  it('serializes duplicate imports per target account without blocking another target account', () => {
    const a = relaySourceReservationKey('/target/a.sock', '/source.sock', 'thread-1')
    expect(relaySourceReservationKey('/target/a.sock', '/source.sock', 'thread-1')).toBe(a)
    expect(relaySourceReservationKey('/target/b.sock', '/source.sock', 'thread-1')).not.toBe(a)
  })

  it('lists a paginated foreign fixture and imports it through the target app-server', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-relay-accounts-'))
    const sourceSocket = path.join(dir, 'source.sock')
    const targetSocket = path.join(dir, 'target.sock')
    const sourceRequests: any[] = []
    const targetRequests: any[] = []
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
    const stopTarget = await fakeCodexServer(targetSocket, (message) => {
      targetRequests.push(message)
      if (message.id === 1) return { id: 1, result: {} }
      if (message.id === 2) return { id: 2, result: { thread: { id: 'imported-target-id' } } }
    })
    try {
      await expect(listThreadsAt(sourceSocket, { cwd: '/repo' })).resolves.toHaveLength(2)
      await expect(readThreadAt(sourceSocket, 'foreign-a')).resolves.toMatchObject({
        id: 'foreign-a',
        path: '/fixtures/a-fresh.jsonl'
      })
      await expect(forkForeignThreadAt(
        targetSocket,
        '/fixtures/a.jsonl',
        '/repo'
      )).resolves.toBe('imported-target-id')
      expect(sourceRequests.filter((message) => message.method === 'thread/list').map((message) =>
        message.params.cursor
      )).toEqual([null, 'page-2'])
      expect(targetRequests).toContainEqual({
        id: 2,
        method: 'thread/fork',
        params: { threadId: '', path: '/fixtures/a.jsonl', cwd: '/repo' }
      })
    } finally {
      await Promise.all([stopSource(), stopTarget()])
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
