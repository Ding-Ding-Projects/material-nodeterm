import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { createConnection } from 'net'
import { homedir, tmpdir } from 'os'
import path from 'path'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

const SAFE_NODE_ID = /^[A-Za-z0-9._-]+$/
const THREAD_METHODS = new Set(['thread/start', 'thread/resume', 'thread/fork'])
type JsonRpcRequest = { id?: unknown; method?: unknown; params?: unknown }

function parseRequest(raw: RawData): { input: Buffer; request: JsonRpcRequest | null } {
  const input = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
  try {
    const value = JSON.parse(input.toString('utf8'))
    return { input, request: value && typeof value === 'object' ? (value as JsonRpcRequest) : null }
  } catch {
    return { input, request: null }
  }
}

function requestKey(id: unknown): string | null {
  return typeof id === 'string' || typeof id === 'number' ? `${typeof id}:${id}` : null
}

function responseThreadId(raw: RawData): { key: string; threadId: string } | null {
  const { request: response } = parseRequest(raw)
  if (!response) return null
  const key = requestKey(response.id)
  const result = (response as { result?: unknown }).result
  if (!key || !result || typeof result !== 'object') return null
  const thread = (result as { thread?: unknown }).thread
  if (!thread || typeof thread !== 'object') return null
  const threadId = (thread as { id?: unknown }).id
  return typeof threadId === 'string' ? { key, threadId } : null
}

function closePeer(peer: WebSocket, code: number, reason: Buffer): void {
  if (peer.readyState !== WebSocket.OPEN && peer.readyState !== WebSocket.CONNECTING) return
  if (code === 1005 || code === 1006 || code === 1015) peer.close()
  else peer.close(code, reason)
}

export type CodexNodeIdentity = {
  NODETERM_NODE_ID: string
  NODETERM_HOOK_ENDPOINT: string
  NODETERM_CANVAS_CONTROL: string
}

export function codexLauncherDir(): string {
  return path.join(homedir(), '.nodeterm', 'bin')
}

export function installCodexLauncher(): string {
  const dir = codexLauncherDir()
  const file = path.join(dir, 'nodeterm-codex')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    file,
    `#!/bin/sh\n` +
      `case "\${NODETERM_NODE_ID-}" in ''|*[!A-Za-z0-9._-]*) echo "NodeTerm Codex identity unavailable" >&2; exit 64 ;; esac\n` +
      `case "\${NODETERM_CODEX_PROXY_SOCKET-}" in /*) ;; *) echo "NodeTerm Codex identity unavailable" >&2; exit 64 ;; esac\n` +
      `case "\${NODETERM_CODEX_PROXY_SOCKET}" in *[!A-Za-z0-9._/-]*) echo "NodeTerm Codex identity unavailable" >&2; exit 64 ;; esac\n` +
      `[ -S "\${NODETERM_CODEX_PROXY_SOCKET}" ] || { echo "NodeTerm Codex identity unavailable" >&2; exit 64; }\n` +
      `exec codex --remote "unix://\${NODETERM_CODEX_PROXY_SOCKET}" "$@"\n`,
    { encoding: 'utf8', mode: 0o700 }
  )
  chmodSync(file, 0o700)
  return file
}

export function injectCodexIdentity(raw: RawData, identity: CodexNodeIdentity): Buffer {
  const { input, request } = parseRequest(raw)
  if (!request) return input
  if (typeof request.method !== 'string' || !THREAD_METHODS.has(request.method)) return input
  const params = request.params && typeof request.params === 'object' ? request.params : {}
  const existingConfig = (params as { config?: unknown }).config
  const config = existingConfig && typeof existingConfig === 'object' ? (existingConfig as Record<string, unknown>) : {}
  request.params = {
    ...params,
    config: {
      ...config,
      'shell_environment_policy.set.NODETERM_NODE_ID': identity.NODETERM_NODE_ID,
      'shell_environment_policy.set.NODETERM_HOOK_ENDPOINT': identity.NODETERM_HOOK_ENDPOINT,
      'shell_environment_policy.set.NODETERM_CANVAS_CONTROL': identity.NODETERM_CANVAS_CONTROL
    }
  }
  return Buffer.from(JSON.stringify(request))
}

export class CodexIdentityProxy {
  private server: Server | null = null
  private wss: WebSocketServer | null = null

  constructor(
    readonly socketPath: string,
    private readonly upstreamSocketPath: string,
    private readonly identity: CodexNodeIdentity,
    private readonly claimThread: (threadId: string, nodeId: string) => boolean
  ) {}

  async start(): Promise<void> {
    if (this.server) return
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath)
    const server = createServer()
    const wss = new WebSocketServer({ server, maxPayload: 128 << 20 })
    wss.on('connection', (client) => {
      const upstream = new WebSocket('ws://localhost/rpc', {
        createConnection: () => createConnection(this.upstreamSocketPath)
      })
      const pending: Array<{ data: RawData; binary: boolean }> = []
      const resultOwners = new Map<string, 'thread/start' | 'thread/fork'>()
      client.on('message', (data, binary) => {
        const { request } = parseRequest(data)
        if (request?.method === 'thread/resume' || request?.method === 'thread/fork') {
          const params = request.params && typeof request.params === 'object' ? request.params : null
          const threadId = params && (params as { threadId?: unknown }).threadId
          if (typeof threadId === 'string' && !this.claimThread(threadId, this.identity.NODETERM_NODE_ID)) {
            if (request.id !== undefined && client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  id: request.id,
                  error: {
                    code: -32001,
                    message: 'Codex thread is already owned by another NodeTerm node'
                  }
                })
              )
            }
            return
          }
        }
        if (request?.method === 'thread/start' || request?.method === 'thread/fork') {
          const key = requestKey(request.id)
          if (key) resultOwners.set(key, request.method)
        }
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(injectCodexIdentity(data, this.identity), { binary })
        } else {
          pending.push({ data, binary })
        }
      })
      upstream.on('open', () => {
        for (const item of pending) {
          upstream.send(injectCodexIdentity(item.data, this.identity), { binary: item.binary })
        }
        pending.length = 0
      })
      upstream.on('message', (data, binary) => {
        const result = responseThreadId(data)
        if (result && resultOwners.delete(result.key)) {
          // A started/forked thread is already loaded with this node's injected environment.
          // Record the returned id before any other node can resume it through this router.
          this.claimThread(result.threadId, this.identity.NODETERM_NODE_ID)
        }
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
      })
      upstream.on('close', (code, reason) => closePeer(client, code, reason))
      client.on('close', (code, reason) => closePeer(upstream, code, reason))
      upstream.on('error', () => client.close(1011, 'Shared Codex app-server unavailable'))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => {
        server.off('error', reject)
        resolve()
      })
    })
    chmodSync(this.socketPath, 0o600)
    this.server = server
    this.wss = wss
  }

  stop(): void {
    this.wss?.close()
    this.server?.close()
    this.wss = null
    this.server = null
    if (existsSync(this.socketPath)) unlinkSync(this.socketPath)
  }
}

export class CodexIdentityProxyManager {
  private readonly proxies = new Map<string, CodexIdentityProxy>()
  private readonly threadOwners = new Map<string, string>()
  private readonly prefix: string

  constructor(
    userDataDir: string,
    private readonly upstreamSocketPath: string
  ) {
    const appId = createHash('sha256').update(userDataDir).digest('hex').slice(0, 10)
    this.prefix = path.join(tmpdir(), `nt-codex-${appId}`)
  }

  async ensureNode(nodeId: string, identity: CodexNodeIdentity): Promise<string | null> {
    if (!SAFE_NODE_ID.test(nodeId) || identity.NODETERM_NODE_ID !== nodeId) return null
    const existing = this.proxies.get(nodeId)
    if (existing) return existing.socketPath
    const nodeKey = createHash('sha256').update(nodeId).digest('hex').slice(0, 16)
    const proxy = new CodexIdentityProxy(
      `${this.prefix}-${nodeKey}.sock`,
      this.upstreamSocketPath,
      identity,
      (threadId, ownerNodeId) => this.claimThread(threadId, ownerNodeId)
    )
    await proxy.start()
    this.proxies.set(nodeId, proxy)
    return proxy.socketPath
  }

  socketForNode(nodeId: string): string | null {
    return this.proxies.get(nodeId)?.socketPath ?? null
  }

  private claimThread(threadId: string, nodeId: string): boolean {
    const owner = this.threadOwners.get(threadId)
    if (owner && owner !== nodeId) return false
    this.threadOwners.set(threadId, nodeId)
    return true
  }

  stop(): void {
    for (const proxy of this.proxies.values()) proxy.stop()
    this.proxies.clear()
    this.threadOwners.clear()
  }
}

let sharedManager: CodexIdentityProxyManager | null = null

export function codexIdentityProxyManager(userDataDir: string): CodexIdentityProxyManager {
  if (!sharedManager) {
    sharedManager = new CodexIdentityProxyManager(userDataDir, defaultCodexAppServerSocket())
  }
  return sharedManager
}

export function defaultCodexAppServerSocket(): string {
  const configuredHome = process.env.CODEX_HOME
  const codexHome = configuredHome && path.isAbsolute(configuredHome) ? configuredHome : path.join(homedir(), '.codex')
  return path.join(codexHome, 'app-server-control', 'app-server-control.sock')
}
