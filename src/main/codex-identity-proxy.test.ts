import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { createConnection } from 'net'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { CodexIdentityProxyManager, type CodexNodeIdentity } from './codex-identity-proxy'

function identity(nodeId: string): CodexNodeIdentity {
  return {
    NODETERM_NODE_ID: nodeId,
    NODETERM_HOOK_ENDPOINT: `/isolated/${nodeId}/hook.env`,
    NODETERM_CANVAS_CONTROL: '1'
  }
}

function openClient(socket: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost/rpc', {
      createConnection: () => createConnection(socket)
    })
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

describe('CodexIdentityProxy', () => {
  let upstreamServer: Server
  let upstreamWss: WebSocketServer
  let proxy: CodexIdentityProxyManager
  let upstreamSocket: string
  let requests: Array<Record<string, unknown>>

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-proxy-test-'))
    upstreamSocket = path.join(dir, 'upstream.sock')
    requests = []
    upstreamServer = createServer()
    upstreamWss = new WebSocketServer({ server: upstreamServer })
    upstreamWss.on('connection', (ws) => {
      ws.on('message', (data) => requests.push(JSON.parse(data.toString())))
    })
    await new Promise<void>((resolve, reject) => {
      upstreamServer.once('error', reject)
      upstreamServer.listen(upstreamSocket, resolve)
    })
    proxy = new CodexIdentityProxyManager(dir, upstreamSocket)
  })

  afterEach(() => {
    proxy.stop()
    upstreamWss.close()
    upstreamServer.close()
  })

  it('keeps two parallel thread start/resume mappings isolated', async () => {
    const [socketA, socketB] = await Promise.all([
      proxy.ensureNode('node-a', identity('node-a')),
      proxy.ensureNode('node-b', identity('node-b'))
    ])
    expect(socketA).toBeTruthy()
    expect(socketB).toBeTruthy()
    expect(socketA).not.toBe(socketB)
    const [a, b] = await Promise.all([openClient(socketA!), openClient(socketB!)])
    a.send(JSON.stringify({ id: 1, method: 'thread/start', params: { config: { personality: 'none' } } }))
    b.send(JSON.stringify({ id: 2, method: 'thread/resume', params: { threadId: 'thread-b' } }))

    await expect.poll(() => requests.length).toBe(2)
    const byId = Object.fromEntries(requests.map((request) => [request.id, request])) as Record<
      string,
      { params: { config: Record<string, unknown> } }
    >
    expect(byId[1].params.config).toMatchObject({
      personality: 'none',
      'shell_environment_policy.set.NODETERM_NODE_ID': 'node-a',
      'shell_environment_policy.set.NODETERM_HOOK_ENDPOINT': '/isolated/node-a/hook.env',
      'shell_environment_policy.set.NODETERM_CANVAS_CONTROL': '1'
    })
    expect(byId[2].params.config).toMatchObject({
      'shell_environment_policy.set.NODETERM_NODE_ID': 'node-b',
      'shell_environment_policy.set.NODETERM_HOOK_ENDPOINT': '/isolated/node-b/hook.env',
      'shell_environment_policy.set.NODETERM_CANVAS_CONTROL': '1'
    })
    expect(JSON.stringify(byId[1])).not.toContain('node-b')
    expect(JSON.stringify(byId[2])).not.toContain('node-a')
    a.close()
    b.close()
  })

  it.each(['', '../invalid'])('fails closed for invalid node id %s', async (nodeId) => {
    expect(await proxy.ensureNode(nodeId, identity(nodeId))).toBeNull()
    expect(requests).toEqual([])
  })

  it('fails closed when the requested node and identity disagree', async () => {
    expect(await proxy.ensureNode('node-a', identity('node-b'))).toBeNull()
    expect(requests).toEqual([])
  })
})
