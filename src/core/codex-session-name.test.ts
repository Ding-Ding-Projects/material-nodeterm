import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { codexUnixWebSocketUrl, readCodexSessionNameAt } from './codex-session-name'

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
        if (request.id === 2) {
          ws.send(
            JSON.stringify({
              id: 2,
              result: {
                thread: {
                  id: request.params.threadId,
                  name: 'Shared task title'
                }
              }
            })
          )
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

  it.each(['/tmp/socket:bad', '/tmp/socket with-space', 'relative.sock'])(
    'rejects ambiguous socket path %s',
    (value) =>
      expect(() => codexUnixWebSocketUrl(value)).toThrow('Unsupported Codex app-server socket path')
  )
})
