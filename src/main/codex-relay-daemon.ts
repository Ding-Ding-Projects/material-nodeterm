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

// Protocol v4 additionally merges the account-isolated thread catalogs and imports a selected
// foreign rollout through Codex's own fork API before resuming it in the chosen account.
// Keep earlier versions on their own state files so already-connected nodes may drain safely.
const VERSION = '4'
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
export type RelayForeignThread = {
  socketPath: string
  path: string
  cwd: string
  name?: string
}
type RegisteredRoute = {
  route: Route
  timer: NodeJS.Timeout
  active: number
  foreignThreads: Map<string, RelayForeignThread>
}

export type RelayThreadRequest = { method: string; source?: string; sourceName?: string }

/** Per-connection JSON-RPC tracking. Equal request ids in parallel node connections remain
 * isolated because every connection supplies its own map. */
export function trackRelayThreadRequest(
  pending: Map<string, RelayThreadRequest>,
  message: unknown,
  sourceName?: string
): void {
  const m = message as {
    id?: unknown
    method?: unknown
    params?: { threadId?: unknown }
  }
  if (m?.id === undefined || typeof m.method !== 'string' || !/^thread\/(?:resume|start|fork)$/.test(m.method)) return
  pending.set(String(m.id), {
    method: m.method,
    source: typeof m.params?.threadId === 'string' ? m.params.threadId : undefined,
    sourceName
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
    name: rawName || tracked.sourceName
  }
}

type RelayThread = Record<string, any> & {
  id: string
  path?: string | null
  cwd: string
  name?: string | null
  createdAt?: number
  updatedAt?: number
  recencyAt?: number | null
}

type RelayThreadSource = { socketPath: string; threads: RelayThread[] }

type RelayCursor = { key: string; direction: 1 | -1; value: number; id: string }

function decodeRelayCursor(cursor: unknown): RelayCursor | null {
  if (typeof cursor !== 'string' || !cursor.startsWith('nodeterm:')) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor.slice(9), 'base64url').toString()) as RelayCursor
    return typeof parsed.key === 'string' && (parsed.direction === 1 || parsed.direction === -1) &&
      Number.isFinite(parsed.value) && typeof parsed.id === 'string' && SAFE.test(parsed.id)
      ? parsed
      : null
  } catch {
    return null
  }
}

function encodeRelayCursor(cursor: RelayCursor): string {
  return `nodeterm:${Buffer.from(JSON.stringify(cursor)).toString('base64url')}`
}

/** Merge already server-filtered account pages without ever sharing their state databases. The
 * selected account wins an equal thread id. Foreign entries without an absolute rollout path are
 * omitted because they cannot be safely imported into the selected account. */
export function mergeRelayThreadLists(
  sources: RelayThreadSource[],
  currentSocketPath: string,
  params: Record<string, any>
): {
  result: { data: RelayThread[]; nextCursor: string | null; backwardsCursor: string | null }
  foreignThreads: Map<string, RelayForeignThread>
} {
  const ordered = [...sources].sort((a, b) =>
    a.socketPath === currentSocketPath ? -1 : b.socketPath === currentSocketPath ? 1 : 0
  )
  const byId = new Map<string, { thread: RelayThread; socketPath: string } | null>()
  for (const source of ordered) {
    for (const thread of source.threads) {
      if (!thread || typeof thread.id !== 'string' || !SAFE.test(thread.id)) continue
      if (source.socketPath !== currentSocketPath &&
          (typeof thread.path !== 'string' || !path.isAbsolute(thread.path))) continue
      const existing = byId.get(thread.id)
      if (source.socketPath === currentSocketPath) {
        byId.set(thread.id, { thread, socketPath: source.socketPath })
        continue
      }
      if (existing === null || (existing && existing.socketPath !== currentSocketPath)) {
        // Equal ids in two foreign account stores are ambiguous. Never pick one by catalog order.
        byId.set(thread.id, null)
        continue
      }
      if (existing) continue
      byId.set(thread.id, { thread, socketPath: source.socketPath })
    }
  }
  const sortKey = params.sortKey === 'updated_at'
    ? 'updatedAt'
    : params.sortKey === 'recency_at'
      ? 'recencyAt'
      : 'createdAt'
  const direction = params.sortDirection === 'asc' ? 1 : -1
  const valueOf = (thread: RelayThread): number =>
    Number(thread[sortKey] ?? thread.updatedAt ?? thread.createdAt ?? 0)
  const compare = (
    a: { thread: RelayThread },
    b: { thread: RelayThread }
  ): number => {
    const av = valueOf(a.thread)
    const bv = valueOf(b.thread)
    return av === bv ? a.thread.id.localeCompare(b.thread.id) : (av - bv) * direction
  }
  const all = [...byId.values()].filter(
    (entry): entry is { thread: RelayThread; socketPath: string } => entry !== null
  ).sort(compare)
  const cursor = decodeRelayCursor(params.cursor)
  let offset = 0
  if (cursor && cursor.key === sortKey && cursor.direction === direction) {
    offset = all.findIndex((entry) => compare(entry, {
      thread: { id: cursor.id, cwd: '', [sortKey]: cursor.value }
    }) > 0)
    if (offset < 0) offset = all.length
  }
  const requestedLimit = Number(params.limit)
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 1000)
    : 50
  const page = all.slice(offset, offset + limit)
  const foreignThreads = new Map<string, RelayForeignThread>()
  for (const { thread, socketPath } of page) {
    if (socketPath === currentSocketPath || typeof thread.path !== 'string') continue
    foreignThreads.set(thread.id, {
      socketPath,
      path: thread.path,
      cwd: thread.cwd,
      name: typeof thread.name === 'string' && thread.name.trim() ? thread.name.trim() : undefined
    })
  }
  const next = offset + page.length
  const last = page.at(-1)?.thread
  return {
    result: {
      data: page.map((entry) => entry.thread),
      nextCursor: next < all.length && last
        ? encodeRelayCursor({ key: sortKey, direction, value: valueOf(last), id: last.id })
        : null,
      backwardsCursor: null
    },
    foreignThreads
  }
}

export function retargetRelayResume(message: Record<string, any>, importedThreadId: string): Record<string, any> {
  const params = { ...(message.params ?? {}), threadId: importedThreadId }
  // Resume precedence is history > path > id. Keeping picker-supplied source fields would reopen
  // the foreign rollout instead of the target-account fork.
  delete params.path
  delete params.history
  return { ...message, params }
}

export function relaySourceReservationKey(
  targetSocketPath: string,
  sourceSocketPath: string,
  threadId: string
): string {
  return `${targetSocketPath}\0${sourceSocketPath}\0${threadId}`
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

function hookJsonRequest<T>(route: Route, pathname: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let env: Record<string, string>
    try {
      env = Object.fromEntries(
        readFileSync(route.hookEndpoint, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const separator = line.indexOf('=')
            return separator > 0
              ? [line.slice(0, separator), line.slice(separator + 1)]
              : ['', '']
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
    const req = request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        'x-nodeterm-hook-token': token,
        'content-length': '0'
      }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('NodeTerm hook request failed'))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()) as T)
        } catch {
          reject(new Error('NodeTerm hook returned invalid JSON'))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => req.destroy(new Error('NodeTerm hook request timed out')))
    req.end()
  })
}

export function listThreadsAt(
  socketPath: string,
  requestedParams: Record<string, any>,
  timeoutMs = 10_000
): Promise<RelayThread[]> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    let settled = false
    let requestId = 2
    const threads: RelayThread[] = []
    const seenCursors = new Set<string>()
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      if (error) reject(error)
      else resolve(threads)
    }
    const timer = setTimeout(() => finish(new Error('Codex thread catalog timed out')), timeoutMs)
    timer.unref?.()
    try {
      ws = new WebSocket(`ws+unix://${socketPath}:/rpc`, { perMessageDeflate: false })
    } catch {
      clearTimeout(timer)
      reject(new Error('Codex app-server is unavailable'))
      return
    }
    const requestPage = (cursor?: string): void => {
      const params = { ...requestedParams, cursor: cursor ?? null, limit: 1000 }
      ws.send(JSON.stringify({ id: requestId, method: 'thread/list', params }))
    }
    ws.once('open', () => ws.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'nodeterm-relay', version: VERSION },
        capabilities: { experimentalApi: true }
      }
    })))
    ws.on('message', (raw) => {
      let message: Record<string, any>
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('Codex app-server initialization failed'))
        ws.send(JSON.stringify({ method: 'initialized' }))
        requestPage()
        return
      }
      if (message.id !== requestId) return
      if (message.error || !Array.isArray(message.result?.data)) {
        finish(new Error('Codex thread catalog failed'))
        return
      }
      threads.push(...message.result.data)
      const cursor = message.result.nextCursor
      if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor) || threads.length >= 10_000) {
        finish()
        return
      }
      seenCursors.add(cursor)
      requestId += 1
      requestPage(cursor)
    })
    ws.once('error', () => finish(new Error('Codex app-server is unavailable')))
    ws.once('close', () => finish(new Error('Codex app-server closed during thread listing')))
  })
}

export function readThreadAt(
  socketPath: string,
  threadId: string,
  timeoutMs = 5_000
): Promise<RelayThread> {
  if (!SAFE.test(threadId)) return Promise.reject(new Error('Invalid Codex thread identity'))
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    let settled = false
    const finish = (error?: Error, thread?: RelayThread): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      if (error) reject(error)
      else resolve(thread as RelayThread)
    }
    const timer = setTimeout(() => finish(new Error('Codex thread verification timed out')), timeoutMs)
    timer.unref?.()
    try {
      ws = new WebSocket(`ws+unix://${socketPath}:/rpc`, { perMessageDeflate: false })
    } catch {
      clearTimeout(timer)
      reject(new Error('Codex app-server is unavailable'))
      return
    }
    ws.once('open', () => ws.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'nodeterm-relay', version: VERSION } }
    })))
    ws.on('message', (raw) => {
      let message: Record<string, any>
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('Codex app-server initialization failed'))
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({
          id: 2,
          method: 'thread/read',
          params: { threadId, includeTurns: false }
        }))
      } else if (message.id === 2) {
        const thread = message.result?.thread as RelayThread | undefined
        if (message.error || !thread || thread.id !== threadId ||
            typeof thread.path !== 'string' || !path.isAbsolute(thread.path) ||
            typeof thread.cwd !== 'string' || !path.isAbsolute(thread.cwd)) {
          finish(new Error('Codex source thread is unavailable'))
          return
        }
        finish(undefined, thread)
      }
    })
    ws.once('error', () => finish(new Error('Codex app-server is unavailable')))
    ws.once('close', () => finish(new Error('Codex app-server closed during thread verification')))
  })
}

export function forkForeignThreadAt(
  socketPath: string,
  sourcePath: string,
  cwd: string,
  timeoutMs = 10_000
): Promise<string> {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(cwd)) {
    return Promise.reject(new Error('Unsupported Codex thread import'))
  }
  return new Promise((resolve, reject) => {
    let ws: WebSocket
    let settled = false
    const finish = (error?: Error, threadId?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      if (error) reject(error)
      else resolve(threadId as string)
    }
    const timer = setTimeout(() => finish(new Error('Codex thread import timed out')), timeoutMs)
    timer.unref?.()
    try {
      ws = new WebSocket(`ws+unix://${socketPath}:/rpc`, { perMessageDeflate: false })
    } catch {
      clearTimeout(timer)
      reject(new Error('Codex app-server is unavailable'))
      return
    }
    ws.once('open', () => ws.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'nodeterm-relay', version: VERSION },
        capabilities: { experimentalApi: true }
      }
    })))
    ws.on('message', (raw) => {
      let message: Record<string, any>
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('Codex app-server initialization failed'))
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({
          id: 2,
          method: 'thread/fork',
          params: { threadId: '', path: sourcePath, cwd }
        }))
      } else if (message.id === 2) {
        const threadId = message.result?.thread?.id
        if (message.error || typeof threadId !== 'string' || !SAFE.test(threadId)) {
          finish(new Error('Codex thread import failed'))
          return
        }
        finish(undefined, threadId)
      }
    })
    ws.once('error', () => finish(new Error('Codex app-server is unavailable')))
    ws.once('close', () => finish(new Error('Codex app-server closed during thread import')))
  })
}

function deleteThreadAt(socketPath: string, threadId: string, timeoutMs = 5_000): Promise<void> {
  if (!SAFE.test(threadId)) return Promise.resolve()
  return new Promise((resolve) => {
    let ws: WebSocket
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch {}
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    timer.unref?.()
    try {
      ws = new WebSocket(`ws+unix://${socketPath}:/rpc`, { perMessageDeflate: false })
    } catch {
      clearTimeout(timer)
      resolve()
      return
    }
    ws.once('open', () => ws.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'nodeterm-relay', version: VERSION } }
    })))
    ws.on('message', (raw) => {
      let message: Record<string, any>
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish()
        ws.send(JSON.stringify({ method: 'initialized' }))
        ws.send(JSON.stringify({ id: 2, method: 'thread/delete', params: { threadId } }))
      } else if (message.id === 2) finish()
    })
    ws.once('error', finish)
    ws.once('close', finish)
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
        routes.set(key, { route, timer, active: 0, foreignThreads: new Map() })
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
    // Codex TUI opens more than one WebSocket for one invocation (session picker/bootstrap and
    // the main session). The random capability remains scoped to this exact node route while any
    // connection is live, then expires shortly after the final disconnect to allow reconnects.
    registered.active += 1
    wss.handleUpgrade(req, socket, head, (down) => {
      const up = new WebSocket(`ws+unix://${route.socketPath}:/rpc`, {
        perMessageDeflate: false
      })
      const queued: Array<{ data: Buffer; binary: boolean }> = []
      const pending = new Map<string, RelayThreadRequest>()
      const reservationOwner = Symbol(route.nodeId)
      const requestReservations = new Map<string, string>()
      const requestImportedThreads = new Map<string, string>()
      down.on('message', async (data, binary) => {
        let buf = Buffer.from(data as any)
        let message: any
        let importedName: string | undefined
        let importedThreadId: string | undefined
        try {
          message = JSON.parse(buf.toString())
          if (message.method === 'thread/list' && message.id !== undefined) {
            try {
              const catalog = await hookJsonRequest<{
                accounts: Array<{ accountId?: string; socketPath: string }>
              }>(route, '/codex-thread/catalog')
              const socketPaths = [...new Set([
                route.socketPath,
                ...catalog.accounts
                  .map((account) => account.socketPath)
                  .filter((socketPath) => path.isAbsolute(socketPath))
              ])]
              if (socketPaths.length > 1) {
                const params = message.params && typeof message.params === 'object'
                  ? message.params
                  : {}
                const sourceParams = { ...params }
                delete sourceParams.cursor
                const sources = (await Promise.all(socketPaths.map(async (socketPath) => {
                  try {
                    return { socketPath, threads: await listThreadsAt(socketPath, sourceParams) }
                  } catch {
                    return null
                  }
                }))).filter((source): source is RelayThreadSource => source !== null)
                if (sources.some((source) => source.socketPath === route.socketPath)) {
                  const merged = mergeRelayThreadLists(sources, route.socketPath, params)
                  if (!decodeRelayCursor(params.cursor)) registered.foreignThreads.clear()
                  for (const [threadId, foreign] of merged.foreignThreads) {
                    registered.foreignThreads.set(threadId, foreign)
                  }
                  if (down.readyState === WebSocket.OPEN) {
                    down.send(JSON.stringify({ id: message.id, result: merged.result }))
                  }
                  return
                }
              }
            } catch {
              // Electron may be restarting. Fall through to the selected account's native list.
            }
          }
          if (message.method === 'thread/resume') {
            const selectedThreadId = message.params?.threadId
            const foreign = typeof selectedThreadId === 'string'
              ? registered.foreignThreads.get(selectedThreadId)
              : undefined
            if (foreign) {
              const requestId = message.id === undefined ? '' : String(message.id)
              const sourceReservationKey = relaySourceReservationKey(
                route.socketPath,
                foreign.socketPath,
                selectedThreadId
              )
              // Reserve the SOURCE before forking. Reserving only the not-yet-known imported id
              // allows two nodes to create duplicate target threads in the same event-loop turn.
              if (!requestId || requestReservations.has(requestId) || reservations.has(sourceReservationKey)) {
                if (message.id !== undefined && down.readyState === WebSocket.OPEN) {
                  down.send(JSON.stringify({
                    id: message.id,
                    error: { code: -32001, message: 'Codex thread is already open in another NodeTerm node' }
                  }))
                }
                return
              }
              reservations.set(sourceReservationKey, reservationOwner)
              requestReservations.set(requestId, sourceReservationKey)
              try {
                // The picker entry is only a display cache. Re-read the exact id from the source
                // account immediately before import so a stale route can never redirect by path.
                const fresh = await readThreadAt(foreign.socketPath, selectedThreadId)
                if (reservations.get(sourceReservationKey) !== reservationOwner ||
                    down.readyState !== WebSocket.OPEN) return
                const cwd = typeof message.params?.cwd === 'string' && path.isAbsolute(message.params.cwd)
                  ? message.params.cwd
                  : fresh.cwd
                importedThreadId = await forkForeignThreadAt(
                  route.socketPath,
                  fresh.path as string,
                  cwd
                )
                if (reservations.get(sourceReservationKey) !== reservationOwner ||
                    down.readyState !== WebSocket.OPEN) {
                  // The picker disconnected while Codex was creating the target fork. Remove that
                  // now-unreachable import; close() already released the source reservation.
                  await deleteThreadAt(route.socketPath, importedThreadId)
                  return
                }
                importedName = (typeof fresh.name === 'string' && fresh.name.trim()
                  ? fresh.name.trim()
                  : foreign.name) ?? indexedName(foreign.socketPath, selectedThreadId)
                message = retargetRelayResume(message, importedThreadId)
                buf = Buffer.from(JSON.stringify(message))
              } catch {
                if (reservations.get(sourceReservationKey) === reservationOwner) {
                  reservations.delete(sourceReservationKey)
                }
                requestReservations.delete(requestId)
                if (importedThreadId) await deleteThreadAt(route.socketPath, importedThreadId)
                if (message.id !== undefined && down.readyState === WebSocket.OPEN) {
                  down.send(JSON.stringify({
                    id: message.id,
                    error: { code: -32003, message: 'NodeTerm could not import this Codex session into the selected account' }
                  }))
                }
                return
              }
            }
          }
          if (message.method === 'thread/resume' || message.method === 'thread/fork') {
            const threadId = message.params?.threadId
            const requestId = message.id === undefined ? '' : String(message.id)
            const heldReservationKey = requestReservations.get(requestId)
            const reservationKey = heldReservationKey ?? (typeof threadId === 'string'
              ? `${route.socketPath}\0${threadId}`
              : '')
            // Set synchronously BEFORE authorizeResume's first await. Two connections arriving in
            // the same event-loop turn therefore cannot both pass and reach the shared app-server.
            if (!requestId || !reservationKey ||
                (!heldReservationKey && reservations.has(reservationKey))) {
              if (message.id !== undefined && down.readyState === WebSocket.OPEN) {
                down.send(JSON.stringify({
                  id: message.id,
                  error: { code: -32001, message: 'Codex thread is already open in another NodeTerm node' }
                }))
              }
              return
            }
            if (!heldReservationKey) {
              reservations.set(reservationKey, reservationOwner)
              requestReservations.set(requestId, reservationKey)
            }
            const authorized = await authorizeResume(route, threadId)
            // Close may have run while authorization was pending. It released this reservation;
            // never resurrect it or forward a queued resume after its owning connection is gone.
            if (reservations.get(reservationKey) !== reservationOwner || down.readyState !== WebSocket.OPEN) {
              if (importedThreadId) await deleteThreadAt(route.socketPath, importedThreadId)
              return
            }
            if (!authorized) {
              if (reservations.get(reservationKey) === reservationOwner) reservations.delete(reservationKey)
              requestReservations.delete(requestId)
              if (importedThreadId) await deleteThreadAt(route.socketPath, importedThreadId)
              if (down.readyState === WebSocket.OPEN) {
              down.send(JSON.stringify({
                id: message.id,
                error: { code: -32001, message: 'Codex thread is already open in another NodeTerm node' }
              }))
              }
              return
            }
            if (importedThreadId) requestImportedThreads.set(requestId, importedThreadId)
          }
          trackRelayThreadRequest(pending, message, importedName)
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
        let importedResponseThreadId: string | undefined
        try {
          const message = JSON.parse(buf.toString())
          if (message?.id !== undefined) {
            responseId = String(message.id)
            reservationKey = requestReservations.get(responseId)
            importedResponseThreadId = requestImportedThreads.get(responseId)
            // Once the target app-server answered, the response handler owns cleanup. A concurrent
            // downstream close must not race it and delete a thread whose bind is committing.
            requestImportedThreads.delete(responseId)
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
          if (importedResponseThreadId && (message.error || !observed || !committed)) {
            await deleteThreadAt(route.socketPath, importedResponseThreadId)
          }
        } catch {}
        if (reservationKey) {
          requestReservations.delete(responseId)
          if (reservations.get(reservationKey) === reservationOwner) reservations.delete(reservationKey)
        }
        if (down.readyState === WebSocket.OPEN) down.send(outbound, { binary })
      })
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        for (const key of requestReservations.values())
          if (reservations.get(key) === reservationOwner) reservations.delete(key)
        requestReservations.clear()
        const orphanImports = [...requestImportedThreads.values()]
        requestImportedThreads.clear()
        for (const threadId of orphanImports) void deleteThreadAt(route.socketPath, threadId)
        queued.length = 0
        try {
          down.close()
        } catch {}
        try {
          up.close()
        } catch {}
        registered.active = Math.max(0, registered.active - 1)
        if (registered.active === 0) {
          registered.timer = setTimeout(() => {
            if (routes.get(routeKey) === registered && registered.active === 0) routes.delete(routeKey)
          }, 5 * 60_000)
          registered.timer.unref?.()
        }
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
