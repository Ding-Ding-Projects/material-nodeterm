import fs from 'fs'
import net from 'net'
import path from 'path'
import { randomUUID } from 'crypto'
import { webContents } from 'electron'
import {
  BrowserUseNotification,
  NativeFrameDecoder,
  NodeTermBrowserUseRouter,
  encodeNativeFrame
} from './browser-use-backend-core'

interface BrowserUseRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

interface ClientState {
  decoder: NativeFrameDecoder
  sessionId?: string
  socket: net.Socket
}

export class NodeTermBrowserUseBackend {
  private readonly clients = new Set<ClientState>()
  private readonly router: NodeTermBrowserUseRouter
  private readonly server = net.createServer((socket) => this.accept(socket))
  private socketPath?: string

  constructor(nodeIdForSession: (sessionId: string) => string | undefined) {
    this.router = new NodeTermBrowserUseRouter(
      nodeIdForSession,
      (sessionId, notification) => this.notify(sessionId, notification)
    )
  }

  async start(): Promise<void> {
    const directory =
      process.platform === 'win32' ? undefined : '/tmp/codex-browser-use'
    if (!directory) return
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    // The privileged Browser Plugin native-pipe bridge accepts UUID socket basenames only.
    // A descriptive/pid-based name is reachable with net.connect but intentionally omitted from
    // browser discovery, making a seemingly healthy backend invisible to Codex.
    const socketPath = path.join(directory, `${randomUUID()}.sock`)
    try {
      fs.unlinkSync(socketPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(socketPath, () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    fs.chmodSync(socketPath, 0o600)
    this.socketPath = socketPath
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.socket.destroy()
    this.clients.clear()
    if (this.server.listening) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
    }
    if (this.socketPath) {
      try {
        fs.unlinkSync(this.socketPath)
      } catch {
        // already removed
      }
      this.socketPath = undefined
    }
  }

  register(webContentsId: number, nodeId: string, ownerNodeId?: string): void {
    const contents = webContents.fromId(webContentsId)
    if (!contents || contents.getType() !== 'webview') return
    this.router.register({ contents, nodeId, ownerNodeId })
  }

  unregister(webContentsId: number): void {
    this.router.unregister(webContentsId)
  }

  private accept(socket: net.Socket): void {
    const client: ClientState = { decoder: new NativeFrameDecoder(), socket }
    this.clients.add(client)
    socket.setNoDelay(true)
    socket.on('data', (chunk) => {
      try {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        for (const value of client.decoder.push(bytes))
          void this.handle(client, value)
      } catch (error) {
        socket.destroy(error as Error)
      }
    })
    socket.on('close', () => this.clients.delete(client))
    socket.on('error', () => this.clients.delete(client))
  }

  private async handle(client: ClientState, value: unknown): Promise<void> {
    const request = value as BrowserUseRequest
    if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') return
    const params =
      request.params && typeof request.params === 'object'
        ? (request.params as Record<string, unknown>)
        : {}
    if (typeof params.session_id === 'string')
      client.sessionId = params.session_id
    const scopedParams =
      request.method === 'focusTab' && client.sessionId
        ? { ...params, session_id: client.sessionId }
        : params
    if (request.id === undefined) {
      await this.router
        .dispatch(request.method, scopedParams)
        .catch(() => undefined)
      return
    }
    try {
      const result = await this.router.dispatch(request.method, scopedParams)
      client.socket.write(
        encodeNativeFrame({ jsonrpc: '2.0', id: request.id, result })
      )
    } catch (error) {
      client.socket.write(
        encodeNativeFrame({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: 1,
            message: error instanceof Error ? error.message : String(error)
          }
        })
      )
    }
  }

  private notify(
    sessionId: string,
    notification: BrowserUseNotification
  ): void {
    const frame = encodeNativeFrame(notification)
    for (const client of this.clients) {
      if (client.sessionId === sessionId && !client.socket.destroyed)
        client.socket.write(frame)
    }
  }
}
