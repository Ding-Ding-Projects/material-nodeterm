/* A single tiny, detached WebSocket relay shared by every local Codex node. It keeps the TUI
 * connected across Electron restarts while observing thread/resume on that node's own connection.
 * The authenticated Codex app-server remains shared per account; this is only a routing shim. */
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { createServer, request } from 'http'
import { homedir } from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { WebSocket, WebSocketServer } from 'ws'

// Protocol v2 routes the bare ws://host:port accepted by Codex through a per-node Bearer token.
// Keep v1 on its own state file so already-connected legacy nodes may drain without being killed.
const VERSION = '2'
const SAFE = /^[A-Za-z0-9._-]+$/
const root = path.join(homedir(), '.nodeterm')
const statePath = path.join(root, `codex-relay-v${VERSION}.json`)

type State = { version: string; pid: number; port: number; token: string }
type Route = {
  nodeId: string
  accountId?: string
  socketPath: string
  hookEndpoint: string
}
type RegisteredRoute = { route: Route; timer: NodeJS.Timeout }

export type RelayThreadRequest = { method: string; source?: string }

/** Per-connection JSON-RPC tracking. Equal request ids in parallel node connections remain
 * isolated because every connection supplies its own map. */
export function trackRelayThreadRequest(pending: Map<string, RelayThreadRequest>, message: unknown): void {
  const m = message as {
    id?: unknown
    method?: unknown
    params?: { threadId?: unknown }
  }
  if (m?.id === undefined || typeof m.method !== 'string' || !/^thread\/(?:resume|start|fork)$/.test(m.method)) return
  pending.set(String(m.id), {
    method: m.method,
    source: typeof m.params?.threadId === 'string' ? m.params.threadId : undefined
  })
}

export function resolveRelayThreadResponse(
  pending: Map<string, RelayThreadRequest>,
  message: unknown
): { threadId: string; source?: string; name?: string } | undefined {
  const m = message as {
    id?: unknown
    result?: { thread?: { id?: unknown; name?: unknown } }
  }
  if (m?.id === undefined) return undefined
  const tracked = pending.get(String(m.id))
  if (!tracked) return undefined
  pending.delete(String(m.id))
  const threadId = m.result?.thread?.id
  if (typeof threadId !== 'string' || !SAFE.test(threadId)) return undefined
  const rawName = typeof m.result?.thread?.name === 'string' ? m.result.thread.name.trim() : ''
  return {
    threadId,
    source: tracked.source,
    name: rawName || undefined
  }
}

function readState(): State | null {
  try {
    const x = JSON.parse(readFileSync(statePath, 'utf8')) as State
    return x.version === VERSION && x.port > 0 && !!x.token ? x : null
  } catch {
    return null
  }
}

export function acquireProcessLock(lock: string): boolean {
  const attempt = (): boolean => {
    try {
      // mkdir is the ownership operation. Unlike create-then-write of a file, contenders can never
      // observe a newly-created empty lock and delete it before this process writes its pid.
      mkdirSync(lock, { mode: 0o700 })
      writeFileSync(path.join(lock, 'owner'), `${process.pid}\n`, { mode: 0o600 })
      return true
    } catch {
      return false
    }
  }
  if (attempt()) return true
  let owner = 0
  let directory = false
  try {
    directory = statSync(lock).isDirectory()
    owner = Number(readFileSync(directory ? path.join(lock, 'owner') : lock, 'utf8').trim())
  } catch {}
  if (owner > 0) {
    try {
      process.kill(owner, 0)
      return false
    } catch {}
  }
  if (directory && owner <= 0) {
    // A missing owner is the tiny post-mkdir/pre-write window of a live contender. Only reclaim it
    // after it has remained incomplete long enough that the creator demonstrably died.
    try {
      if (Date.now() - statSync(lock).mtimeMs < 10_000) return false
    } catch { return false }
  }
  try {
    if (directory) rmSync(lock, { recursive: true, force: true })
    else unlinkSync(lock)
  } catch { return false }
  return attempt()
}

function releaseProcessLock(lock: string): void {
  try {
    const owner = Number(readFileSync(path.join(lock, 'owner'), 'utf8').trim())
    if (owner === process.pid) rmSync(lock, { recursive: true, force: true })
  } catch {}
}

function authOk(raw: string | undefined, token: string): boolean {
  if (!raw?.startsWith('Bearer ')) return false
  const a = Buffer.from(raw.slice(7))
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearerToken(raw: string | undefined): string {
  return raw?.startsWith('Bearer ') ? raw.slice(7) : ''
}

export function relayControlPost(port: number, token: string, pathname: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data)
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.from(c)))
        res.on('end', () =>
          res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error('relay request failed'))
        )
      }
    )
    req.on('error', reject)
    req.setTimeout(1_000, () => req.destroy(new Error('relay request timed out')))
    req.end(data)
  })
}

async function ensureServer(): Promise<State> {
  const current = readState()
  if (current) {
    try {
      await relayControlPost(current.port, current.token, '/ping', {})
      return current
    } catch {
      /* stale */
    }
  }
  const lock = `${statePath}.lock`
  const ownsLock = acquireProcessLock(lock)
  if (ownsLock) {
    const child = spawn(process.execPath, [__filename, 'serve'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    child.unref()
  }
  try {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const state = readState()
      if (state) {
        try {
          await relayControlPost(state.port, state.token, '/ping', {})
          return state
        } catch {}
      }
    }
    throw new Error('NodeTerm Codex relay unavailable')
  } finally {
    if (ownsLock) {
      releaseProcessLock(lock)
    }
  }
}

function scope(accountId?: string): string {
  return accountId || 'system'
}
function identityFile(threadId: string, accountId?: string): string {
  return path.join(root, 'codex-thread-nodes', scope(accountId), threadId)
}
function nameFile(socketPath: string, threadId: string): string {
  const socketScope = createHash('sha256').update(socketPath).digest('hex').slice(0, 16)
  return path.join(root, 'codex-thread-names', socketScope, threadId)
}
function parseOwner(file: string): string {
  try {
    return /^nodeId=(.+)$/m.exec(readFileSync(file, 'utf8'))?.[1] ?? ''
  } catch {
    return ''
  }
}
function conflictingOwner(route: Route, threadId: string): string {
  if (!SAFE.test(threadId)) return ''
  const scoped = identityFile(threadId, route.accountId)
  const owner = parseOwner(scoped)
  if (owner) return owner
  return route.accountId ? '' : parseOwner(path.join(root, 'codex-thread-nodes', threadId))
}
function persistName(route: Route, threadId: string, name?: string): void {
  if (!name?.trim()) return
  const nf = nameFile(route.socketPath, threadId)
  mkdirSync(path.dirname(nf), { recursive: true, mode: 0o700 })
  writeFileSync(nf, name.trim().slice(0, 500), { mode: 0o600 })
}

async function bind(route: Route, threadId: string, name?: string): Promise<boolean> {
  if (!SAFE.test(threadId) || !SAFE.test(route.nodeId)) return false
  const file = identityFile(threadId, route.accountId)
  const existingOwner = parseOwner(file)
  // Without Electron's live workspace we cannot distinguish a stale owner from a live one. Never
  // steal another node's thread in the detached fallback; the authenticated main handler may
  // rebind it after checking liveness.
  if (existingOwner && existingOwner !== route.nodeId) {
    persistName(route, threadId, name)
    // The reservation remains held until Electron has atomically checked liveness and committed
    // the replacement mapping. Without that acknowledgement, report failure to the TUI.
    return notifyElectron(route, threadId, name)
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `accountId=${scope(route.accountId)}\nnodeId=${route.nodeId}\nendpoint=${route.hookEndpoint}\n`, {
    mode: 0o600
  })
  renameSync(tmp, file)
  const mappings = path.join(root, 'codex-thread-nodes')
  try {
    for (const dir of readdirSync(mappings, { withFileTypes: true })) {
      const files = dir.isDirectory()
        ? readdirSync(path.join(mappings, dir.name)).map((n) => path.join(mappings, dir.name, n))
        : dir.isFile()
          ? [path.join(mappings, dir.name)]
          : []
      for (const other of files)
        if (other !== file && parseOwner(other) === route.nodeId) {
          try {
            unlinkSync(other)
          } catch {}
        }
    }
  } catch {}
  persistName(route, threadId, name)
  // Local atomic mapping is already the ownership commit. Await Electron for immediate title/status
  // refresh, but an app restart must not invalidate the durable mapping the relay just wrote.
  await notifyElectron(route, threadId, name)
  return true
}

function indexedName(socketPath: string, threadId?: string): string | undefined {
  if (!threadId || !SAFE.test(threadId)) return undefined
  const home = path.dirname(path.dirname(socketPath))
  try {
    let found: string | undefined
    for (const line of readFileSync(path.join(home, 'session_index.jsonl'), 'utf8').split('\n')) {
      if (!line.includes(threadId)) continue
      const x = JSON.parse(line) as { id?: string; thread_name?: string }
      if (x.id === threadId && x.thread_name?.trim()) found = x.thread_name.trim()
    }
    return found
  } catch {
    return undefined
  }
}

function hookRequest(
  route: Route,
  pathname: string,
  fields: Record<string, string>
): Promise<number> {
  return new Promise((resolve, reject) => {
    let env: Record<string, string>
    try {
      env = Object.fromEntries(
        readFileSync(route.hookEndpoint, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const i = l.indexOf('=')
            return i > 0 ? [l.slice(0, i), l.slice(i + 1)] : ['', '']
          })
      )
    } catch (error) {
      reject(error)
      return
    }
    const port = Number(env.NODETERM_HOOK_PORT)
    const token = env.NODETERM_HOOK_TOKEN
    if (!port || !token) {
      reject(new Error('NodeTerm hook endpoint unavailable'))
      return
    }
    const body = new URLSearchParams(fields).toString()
    const req = request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'x-nodeterm-hook-token': token,
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.setTimeout(3_000, () => req.destroy(new Error('NodeTerm hook request timed out')))
    req.end(body)
  })
}

async function authorizeResume(route: Route, threadId: string): Promise<boolean> {
  const owner = conflictingOwner(route, threadId)
  if (owner === '' || owner === route.nodeId) return true
  try {
    return (await hookRequest(route, '/codex-thread/authorize', {
      nodeId: route.nodeId,
      threadId,
      accountId: route.accountId ?? ''
    })) === 204
  } catch { return false }
}

async function notifyElectron(route: Route, threadId: string, name?: string): Promise<boolean> {
  try {
    return (await hookRequest(route, '/codex-thread/observed', {
      nodeId: route.nodeId,
      threadId,
      accountId: route.accountId ?? '',
      name: name ?? ''
    })) === 204
  } catch {
    return false
  }
}

function serve(): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const lock = `${statePath}.serve-lock`
  if (!acquireProcessLock(lock)) return
  const current = readState()
  if (current) {
    try {
      process.kill(current.pid, 0)
      releaseProcessLock(lock)
      return
    } catch {}
  }
  const token = randomUUID()
  const routes = new Map<string, RegisteredRoute>()
  const reservations = new Map<string, symbol>()
  const wss = new WebSocketServer({ noServer: true })
  const server = createServer((req, res) => {
    if (!authOk(req.headers.authorization, token) || req.method !== 'POST') {
      res.writeHead(403).end()
      return
    }
    if (req.url === '/ping') {
      res.writeHead(200).end('ok')
      return
    }
    if (req.url !== '/register') {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => {
      try {
        const route = JSON.parse(Buffer.concat(chunks).toString()) as Route
        if (
          !SAFE.test(route.nodeId) ||
          (route.accountId && !SAFE.test(route.accountId)) ||
          !path.isAbsolute(route.socketPath) ||
          !path.isAbsolute(route.hookEndpoint)
        )
          throw new Error()
        const key = randomUUID()
        const timer = setTimeout(() => routes.delete(key), 60_000)
        timer.unref?.()
        routes.set(key, { route, timer })
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(key)
      } catch {
        res.writeHead(400).end()
      }
    })
  })
  server.on('upgrade', (req, socket, head) => {
    // Codex 0.147 deliberately accepts only `ws://host:port` as --remote; URL paths are rejected
    // before a connection is attempted. Use the already-required per-connection Bearer token as
    // the one-shot route capability while every node still shares this single listener.
    const routeKey = bearerToken(req.headers.authorization)
    const registered = routeKey && routes.get(routeKey)
    if (!registered || !authOk(req.headers.authorization, routeKey)) {
      socket.destroy()
      return
    }
    const route = registered.route
    clearTimeout(registered.timer)
    routes.delete(routeKey)
    wss.handleUpgrade(req, socket, head, (down) => {
      const up = new WebSocket(`ws+unix://${route.socketPath}:/rpc`, {
        perMessageDeflate: false
      })
      const queued: Array<{ data: Buffer; binary: boolean }> = []
      const pending = new Map<string, RelayThreadRequest>()
      const reservationOwner = Symbol(route.nodeId)
      const requestReservations = new Map<string, string>()
      down.on('message', async (data, binary) => {
        const buf = Buffer.from(data as any)
        let message: any
        try {
          message = JSON.parse(buf.toString())
          if (message.method === 'thread/resume' || message.method === 'thread/fork') {
            const threadId = message.params?.threadId
            const requestId = message.id === undefined ? '' : String(message.id)
            const reservationKey = typeof threadId === 'string'
              ? `${route.socketPath}\0${threadId}`
              : ''
            // Set synchronously BEFORE authorizeResume's first await. Two connections arriving in
            // the same event-loop turn therefore cannot both pass and reach the shared app-server.
            if (!requestId || !reservationKey || reservations.has(reservationKey)) {
              if (message.id !== undefined && down.readyState === WebSocket.OPEN) {
                down.send(JSON.stringify({
                  id: message.id,
                  error: { code: -32001, message: 'Codex thread is already open in another NodeTerm node' }
                }))
              }
              return
            }
            reservations.set(reservationKey, reservationOwner)
            requestReservations.set(requestId, reservationKey)
            const authorized = await authorizeResume(route, threadId)
            // Close may have run while authorization was pending. It released this reservation;
            // never resurrect it or forward a queued resume after its owning connection is gone.
            if (reservations.get(reservationKey) !== reservationOwner || down.readyState !== WebSocket.OPEN) return
            if (!authorized) {
              if (reservations.get(reservationKey) === reservationOwner) reservations.delete(reservationKey)
              requestReservations.delete(requestId)
              if (down.readyState === WebSocket.OPEN) {
              down.send(JSON.stringify({
                id: message.id,
                error: { code: -32001, message: 'Codex thread is already open in another NodeTerm node' }
              }))
              }
              return
            }
          }
          trackRelayThreadRequest(pending, message)
        } catch {}
        if (up.readyState === WebSocket.OPEN) up.send(buf, { binary })
        else queued.push({ data: buf, binary })
      })
      up.on('open', () => {
        if (down.readyState !== WebSocket.OPEN) {
          queued.length = 0
          up.close()
          return
        }
        for (const q of queued.splice(0)) up.send(q.data, { binary: q.binary })
      })
      up.on('message', async (data, binary) => {
        const buf = Buffer.from(data as any)
        let outbound = buf
        let reservationKey: string | undefined
        let responseId = ''
        try {
          const message = JSON.parse(buf.toString())
          if (message?.id !== undefined) {
            responseId = String(message.id)
            reservationKey = requestReservations.get(responseId)
          }
          const observed = resolveRelayThreadResponse(pending, message)
          const committed = observed
            ? await bind(
                route,
                observed.threadId,
                observed.name ?? indexedName(route.socketPath, observed.source)
              ).catch(() => false)
            : true
          if (!committed) {
            outbound = Buffer.from(JSON.stringify({
              id: message.id,
              error: { code: -32002, message: 'NodeTerm could not commit Codex thread ownership' }
            }))
          }
        } catch {}
        if (reservationKey) {
          requestReservations.delete(responseId)
          if (reservations.get(reservationKey) === reservationOwner) reservations.delete(reservationKey)
        }
        if (down.readyState === WebSocket.OPEN) down.send(outbound, { binary })
      })
      const close = () => {
        for (const key of requestReservations.values())
          if (reservations.get(key) === reservationOwner) reservations.delete(key)
        requestReservations.clear()
        queued.length = 0
        try {
          down.close()
        } catch {}
        try {
          up.close()
        } catch {}
      }
      down.on('close', close)
      down.on('error', close)
      up.on('close', close)
      up.on('error', close)
    })
  })
  const releaseLock = (): void => {
    releaseProcessLock(lock)
  }
  const onListenError = (): void => releaseLock()
  server.once('error', onListenError)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', onListenError)
    const addr = server.address()
    if (!addr || typeof addr === 'string') process.exit(1)
    const tmp = `${statePath}.${process.pid}.tmp`
    writeFileSync(
      tmp,
      JSON.stringify({
        version: VERSION,
        pid: process.pid,
        port: addr.port,
        token
      }),
      { mode: 0o600 }
    )
    renameSync(tmp, statePath)
    releaseLock()
  })
}

async function register(): Promise<void> {
  const [nodeId, accountRaw, socketPath, hookEndpoint] = process.argv.slice(3)
  const accountId = accountRaw || undefined
  if (
    !SAFE.test(nodeId) ||
    (accountId && !SAFE.test(accountId)) ||
    !path.isAbsolute(socketPath) ||
    !path.isAbsolute(hookEndpoint)
  )
    throw new Error('invalid relay registration')
  const state = await ensureServer()
  const key = await relayControlPost(state.port, state.token, '/register', {
    nodeId,
    accountId,
    socketPath,
    hookEndpoint
  })
  process.stdout.write(`ws://127.0.0.1:${state.port}\n${key}\n`)
}

if (process.argv[2] === 'serve') serve()
else if (process.argv[2] === 'register')
  void register().catch((error) => {
    console.error(error instanceof Error ? error.message : 'NodeTerm Codex relay unavailable')
    process.exit(69)
  })
