import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  codexUnixWebSocketUrl,
  forkCodexThreadFromPathAt,
  readCodexAccountAt,
  readCodexSessionNameAt,
  startCodexThreadAt
} from './codex-session-name'

describe('Codex shared app-server session names', () => {
  let server: Server
  let wss: WebSocketServer
  let socket: string
  let requests: Array<Record<string, unknown>>

  beforeEach(async () => {
    socket = path.join(mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-name-')), 'server.sock')
    requests = []
    server = createServer()
    wss = new WebSocketServer({ server })
    wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const request = JSON.parse(raw.toString())
        requests.push(request)
        if (request.id === 1) ws.send(JSON.stringify({ id: 1, result: {} }))
        if (request.method === 'thread/read') {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                thread: {
                  id: request.params.threadId,
                  name: 'Shared task title',
                  path: '/isolated/source-thread.jsonl'
                }
              }
            })
          )
        }
        if (request.method === 'thread/start') {
          ws.send(
            JSON.stringify({
              id: request.id,
              result: {
                thread: { id: `thread-${path.basename(request.params.cwd)}` }
              }
            })
          )
        }
        if (request.method === 'turn/start') {
          const response = JSON.stringify({
            id: request.id,
            result: { turn: { id: 'bootstrap-turn' } }
          })
          const started = JSON.stringify({
            method: 'turn/started',
            params: { turn: { id: 'bootstrap-turn', status: 'inProgress' } }
          })
          // Exercise both legal server orderings while the two starts run concurrently.
          if (request.params.threadId === 'thread-node-b') {
            ws.send(started)
            ws.send(JSON.stringify({
              method: 'turn/completed',
              params: { turn: { id: 'bootstrap-turn', status: 'completed' } }
            }))
            ws.send(response)
          } else {
            ws.send(response)
            ws.send(started)
          }
        }
        if (request.method === 'turn/interrupt') {
          const response = JSON.stringify({ id: request.id, result: {} })
          const completed = JSON.stringify({
            method: 'turn/completed',
            params: { turn: { id: 'bootstrap-turn', status: 'interrupted' } }
          })
          // Exercise both legal server orderings before cleanup starts.
          if (request.params.threadId === 'thread-node-b') {
            ws.send(completed)
            ws.send(response)
          } else {
            ws.send(response)
            ws.send(completed)
          }
        }
        if (request.method === 'thread/fork') {
          if (request.params.beforeTurnId && request.params.threadId === 'thread-fail-cleanup') {
            ws.send(JSON.stringify({
              id: request.id,
              error: { code: -32600, message: 'fixture cleanup failure' }
            }))
            return
          }
          const id = request.params.beforeTurnId
            ? `ready-${request.params.threadId}`
            : 'thread-forked'
          ws.send(JSON.stringify({ id: request.id, result: { thread: { id } } }))
        }
        if (request.method === 'thread/delete') {
          ws.send(JSON.stringify({ id: request.id, result: {} }))
        }
        if (request.method === 'account/read') {
          ws.send(JSON.stringify({
            id: request.id,
            result: { account: { type: 'chatgpt', email: 'account@example.com', planType: 'pro' } }
          }))
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socket, resolve)
    })
  })

  afterEach(() => {
    wss.close()
    server.close()
  })

  it('reads Thread.name without routing the persistent CLI through Electron', async () => {
    await expect(readCodexSessionNameAt(socket, 'thread-a')).resolves.toBe('Shared task title')
    expect(requests).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'nodeterm', version: '1' } }
      },
      { method: 'initialized' },
      {
        id: 2,
        method: 'thread/read',
        params: { threadId: 'thread-a', includeTurns: false }
      }
    ])
  })

  it('fails closed for missing or invalid thread identity', async () => {
    await expect(readCodexSessionNameAt(socket, '../other')).resolves.toBeNull()
    expect(requests).toEqual([])
  })

  it('starts two threads independently on the same shared app-server', async () => {
    await expect(
      Promise.all([
        startCodexThreadAt(socket, '/isolated/node-a'),
        startCodexThreadAt(socket, '/isolated/node-b')
      ])
    ).resolves.toEqual(['ready-thread-node-a', 'ready-thread-node-b'])

    const starts = requests.filter((request) => request.method === 'thread/start')
    expect(starts.map((request: any) => request.params)).toEqual([
      { cwd: '/isolated/node-a' },
      { cwd: '/isolated/node-b' }
    ])
    expect(requests.filter((request) => request.method === 'turn/start')).toHaveLength(2)
    // node-b completed before its turn/start response, so cleanup must not interrupt it again.
    expect(requests.filter((request) => request.method === 'turn/interrupt')).toHaveLength(1)
    expect(requests.filter((request) =>
      request.method === 'thread/fork' && (request as any).params.beforeTurnId
    )).toHaveLength(2)
    expect(requests.filter((request) => request.method === 'thread/delete')).toHaveLength(2)
  })

  it('fails closed before connecting for a relative thread cwd', async () => {
    await expect(startCodexThreadAt(socket, '../other')).rejects.toThrow(
      'Unsupported Codex thread cwd'
    )
    expect(requests).toEqual([])
  })

  it('fails closed instead of returning an unresumable bootstrap thread', async () => {
    await expect(startCodexThreadAt(socket, '/isolated/fail-cleanup')).rejects.toThrow(
      'could not clean up thread materialization'
    )
  })

  it('reads account email through app-server without exposing credentials', async () => {
    await expect(readCodexAccountAt(socket)).resolves.toEqual({ email: 'account@example.com' })
  })

  it('forks an idle rollout into another account app-server', async () => {
    await expect(
      forkCodexThreadFromPathAt(socket, '/isolated/source-thread.jsonl', '/isolated/worktree')
    ).resolves.toBe('thread-forked')
    expect(requests[0]).toEqual({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'nodeterm', version: '1' },
        capabilities: { experimentalApi: true }
      }
    })
    expect(requests.find((request) => request.method === 'thread/fork')).toMatchObject({
      params: {
        threadId: '',
        path: '/isolated/source-thread.jsonl',
        cwd: '/isolated/worktree'
      }
    })
  })

  it.each(['/tmp/socket:bad', '/tmp/socket with-space', 'relative.sock'])(
    'rejects ambiguous socket path %s',
    (value) =>
      expect(() => codexUnixWebSocketUrl(value)).toThrow('Unsupported Codex app-server socket path')
  )
})
