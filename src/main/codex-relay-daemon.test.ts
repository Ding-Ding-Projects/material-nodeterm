import { describe, expect, it } from 'vitest'
import { createServer } from 'http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  acquireProcessLock,
  relayControlPost,
  resolveRelayThreadResponse,
  trackRelayThreadRequest,
  type RelayThreadRequest
} from './codex-relay-daemon'

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
