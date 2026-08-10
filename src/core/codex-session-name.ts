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

export function rememberCodexSessionName(
  threadId: string,
  name: unknown,
  socketPath = defaultCodexAppServerSocket()
): void {
  if (!threadId) return
  const value = typeof name === 'string' && name.trim() ? name.trim() : null
  names.set(`${socketPath}\0${threadId}`, { name: value, at: Date.now() })
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
        if (message.error) return finish(null)
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

export function readCodexThreadAt(
  socketPath: string,
  threadId: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<{ id: string; name: string | null; path: string | null } | null> {
  if (!SAFE_THREAD_ID.test(threadId)) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let ws: WebSocket
    const finish = (value: { id: string; name: string | null; path: string | null } | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* connection may never have opened */ }
      resolve(value)
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
        if (message.error) return finish(null)
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({ id: 2, method: 'thread/read', params: { threadId, includeTurns: false } }))
      } else if (message.id === 2) {
        const thread = message.result?.thread
        if (message.error || typeof thread?.id !== 'string' || thread.id !== threadId) {
          finish(null)
          return
        }
        finish({
          id: thread.id,
          name: typeof thread.name === 'string' && thread.name.trim() ? thread.name.trim() : null,
          path: typeof thread.path === 'string' && path.isAbsolute(thread.path) ? thread.path : null
        })
      }
    })
    ws.once('error', () => finish(null))
    ws.once('close', () => finish(null))
  })
}

export function readCodexAccountAt(
  socketPath: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<{ email: string | null } | null> {
  return new Promise((resolve) => {
    let settled = false
    let ws: WebSocket
    const finish = (value: { email: string | null } | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* connection may never have opened */ }
      resolve(value)
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
        ws.send(JSON.stringify({ id: 2, method: 'account/read', params: { refreshToken: false } }))
      } else if (message.id === 2) {
        const account = message.result?.account
        if (!account) return finish(null)
        const email = typeof account.email === 'string' && account.email.trim()
          ? account.email.trim()
          : null
        finish({ email })
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

export function forkCodexThreadFromPathAt(
  socketPath: string,
  sourcePath: string,
  cwd: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<string> {
  if (!path.isAbsolute(sourcePath) || sourcePath.includes('\0') ||
      !path.isAbsolute(cwd) || cwd.includes('\0')) {
    return Promise.reject(new Error('Unsupported Codex thread fork path'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let ws: WebSocket
    const finish = (error: Error | null, threadId?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* connection may never have opened */ }
      if (error) reject(error)
      else resolve(threadId as string)
    }
    const timer = setTimeout(
      () => finish(new Error('Codex account switch timed out')),
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
        if (message.error) return finish(new Error('Codex app-server initialization failed'))
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({ id: 2, method: 'thread/fork', params: { path: sourcePath, cwd } }))
      } else if (message.id === 2) {
        const threadId = message.result?.thread?.id
        if (message.error || typeof threadId !== 'string' || !SAFE_THREAD_ID.test(threadId)) {
          finish(new Error('Codex account switch returned no valid thread'))
          return
        }
        finish(null, threadId)
      }
    })
    ws.once('error', () => finish(new Error('Codex app-server is unavailable')))
    ws.once('close', () => finish(new Error('Codex app-server closed during account switch')))
  })
}

export function startCodexThread(cwd: string): Promise<string> {
  return startCodexThreadAt(defaultCodexAppServerSocket(), cwd)
}

export function readCodexSessionName(
  threadId: string,
  socketPath = defaultCodexAppServerSocket()
): Promise<string | null> {
  if (!SAFE_THREAD_ID.test(threadId)) return Promise.resolve(null)
  const key = `${socketPath}\0${threadId}`
  const cached = names.get(key)
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.name)
  const running = inflight.get(key)
  if (running) return running
  const request = readCodexSessionNameAt(socketPath, threadId).then(
    (name) => {
      names.set(key, { name, at: Date.now() })
      inflight.delete(key)
      return name
    },
    () => {
      inflight.delete(key)
      return null
    }
  )
  inflight.set(key, request)
  return request
}

export function forgetCodexSessionNames(): void {
  names.clear()
  inflight.clear()
}
