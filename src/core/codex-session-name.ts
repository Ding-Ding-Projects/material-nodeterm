import { homedir } from 'os'
import path from 'path'
import { WebSocket } from 'ws'

// Thread.name belongs to the one shared authenticated Codex app-server. Read it directly instead
// of routing a persistent tmux CLI through an Electron-owned proxy that dies on every app restart.
const SAFE_THREAD_ID = /^[A-Za-z0-9._-]+$/
const CACHE_MS = 3_000
const REQUEST_TIMEOUT_MS = 2_000
const names = new Map<string, { name: string | null; at: number }>()
const inflight = new Map<string, Promise<string | null>>()

function connectCodexAppServer(socketPath: string): WebSocket {
  return new WebSocket(codexUnixWebSocketUrl(socketPath), { perMessageDeflate: false })
}

export function defaultCodexAppServerSocket(): string {
  const configuredHome = process.env.CODEX_HOME
  const codexHome = configuredHome && path.isAbsolute(configuredHome)
    ? configuredHome
    : path.join(homedir(), '.codex')
  return path.join(codexHome, 'app-server-control', 'app-server-control.sock')
}

export function codexUnixWebSocketUrl(socketPath: string): string {
  if (!path.isAbsolute(socketPath) || /[\s:%?#]/.test(socketPath)) {
    throw new Error('Unsupported Codex app-server socket path')
  }
  return `ws+unix://${socketPath}:/rpc`
}

export function rememberCodexSessionName(threadId: string, name: unknown): void {
  if (!threadId) return
  const value = typeof name === 'string' && name.trim() ? name.trim() : null
  names.set(threadId, { name: value, at: Date.now() })
}

export function readCodexSessionNameAt(
  socketPath: string,
  threadId: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<string | null> {
  if (!SAFE_THREAD_ID.test(threadId)) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let ws: WebSocket
    const finish = (name: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* connection may never have opened */ }
      resolve(name)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    timer.unref?.()
    try {
      ws = connectCodexAppServer(socketPath)
    } catch {
      clearTimeout(timer)
      resolve(null)
      return
    }
    ws.once('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'nodeterm', version: '1' } }
      }))
    })
    ws.on('message', (raw) => {
      let message: Record<string, any>
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.id === 1) {
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({
          id: 2,
          method: 'thread/read',
          params: { threadId, includeTurns: false }
        }))
      } else if (message.id === 2) {
        const name = message.result?.thread?.name
        finish(typeof name === 'string' && name.trim() ? name.trim() : null)
      }
    })
    ws.once('error', () => finish(null))
    ws.once('close', () => finish(null))
  })
}

/**
 * Create one new thread on the shared authenticated app-server and return its exact identity.
 * NodeTerm does this before launching the remote TUI, then resumes this thread. That makes the
 * client↔canvas binding deterministic even when multiple nodes start concurrently: no process-
 * global node id, creation-time matching, or per-node app-server is involved.
 */
export function startCodexThreadAt(
  socketPath: string,
  cwd: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<string> {
  if (!path.isAbsolute(cwd) || cwd.includes('\0')) {
    return Promise.reject(new Error('Unsupported Codex thread cwd'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let ws: WebSocket
    const finish = (error: Error | null, threadId?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* connection may never have opened */
      }
      if (error) reject(error)
      else resolve(threadId as string)
    }
    const timer = setTimeout(
      () => finish(new Error('Codex app-server thread start timed out')),
      timeoutMs
    )
    timer.unref?.()
    try {
      ws = connectCodexAppServer(socketPath)
    } catch {
      clearTimeout(timer)
      reject(new Error('Codex app-server is unavailable'))
      return
    }
    ws.once('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'nodeterm', version: '1' } }
        })
      )
    })
    ws.on('message', (raw) => {
      let message: Record<string, any>
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (message.id === 1) {
        if (message.error) {
          finish(new Error('Codex app-server initialization failed'))
          return
        }
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({ id: 2, method: 'thread/start', params: { cwd } }))
      } else if (message.id === 2) {
        const threadId = message.result?.thread?.id
        if (message.error || typeof threadId !== 'string' || !SAFE_THREAD_ID.test(threadId)) {
          finish(new Error('Codex app-server returned no valid thread identity'))
          return
        }
        finish(null, threadId)
      }
    })
    ws.once('error', () => finish(new Error('Codex app-server is unavailable')))
    ws.once('close', () => finish(new Error('Codex app-server closed before thread start')))
  })
}

export function startCodexThread(cwd: string): Promise<string> {
  return startCodexThreadAt(defaultCodexAppServerSocket(), cwd)
}

export function readCodexSessionName(threadId: string): Promise<string | null> {
  if (!SAFE_THREAD_ID.test(threadId)) return Promise.resolve(null)
  const cached = names.get(threadId)
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.name)
  const running = inflight.get(threadId)
  if (running) return running
  const request = readCodexSessionNameAt(defaultCodexAppServerSocket(), threadId).then(
    (name) => {
      names.set(threadId, { name, at: Date.now() })
      inflight.delete(threadId)
      return name
    },
    () => {
      inflight.delete(threadId)
      return null
    }
  )
  inflight.set(threadId, request)
  return request
}

export function forgetCodexSessionNames(): void {
  names.clear()
  inflight.clear()
}
