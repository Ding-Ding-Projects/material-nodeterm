// The app-server protocol client, against a real WebSocket server on a real unix socket.
//
// Two of its answers are load-bearing in ways a mocked test would not show: `codexThreadExistsAt`
// is what stands between a stale session id and a node that dies AFTER exec (where no fallback is
// left), and both readers must answer the conservative thing when the server is simply not there —
// which, for a CLI whose app-server starts on demand, is a completely ordinary state.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { createHash } from 'node:crypto'
import {
  codexThreadExistsAt,
  codexUnixWebSocketUrl,
  readCodexAccountAt,
  readCodexSessionNameAt,
  relayedCodexSessionName,
  startCodexThreadAt,
  forgetCodexSessionNames,
  readCodexAccountAt,
  readCodexSessionName,
  readCodexSessionNameAt,
  readCodexThreadAt,
  readCodexThreadRollout,
  relayedCodexSessionName,
  rememberCodexSessionName,
  waitForCodexAppServer
} from './codex-session-name'

let dir = ''
let sock = ''
let server: http.Server
let wss: WebSocketServer
/** Threads the fake app-server knows about, id → name. */
const threads = new Map<string, string | null>([
  ['thread-known', 'Named by codex'],
  ['thread-nameless', null]
])
let initializeFails = false

function handle(ws: WebSocket): void {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as Record<string, any>
    if (msg.method === 'initialize') {
      ws.send(
        JSON.stringify(
          initializeFails
            ? { id: msg.id, error: { message: 'not authenticated' } }
            : { id: msg.id, result: {} }
        )
      )
      return
    }
    if (msg.method === 'thread/read') {
      const id = msg.params?.threadId as string
      if (!threads.has(id)) {
        ws.send(JSON.stringify({ id: msg.id, error: { message: 'no rollout found' } }))
        return
      }
      ws.send(
        JSON.stringify({
          id: msg.id,
          result: {
            thread: {
              id,
              name: threads.get(id),
              status: id === 'thread-known' ? { type: 'active', activeFlags: [] } : { type: 'idle' }
            }
          }
        })
      )
    }
  })
}

// This suite drives the app-server protocol client against a REAL AF_UNIX socket on purpose (see
// the file header) — codex's own app-server only ever speaks over one. Node has supported binding
// an arbitrary filesystem path as an AF_UNIX socket on win32 for a while, but doing so is refused
// with EACCES in this sandboxed environment: verified directly with a bare `net.createServer()`
// listening on a plain path, no shim/shell/http involved at all, reproduced on both the Bash and
// PowerShell hosts, and for every candidate path tried (mkdtemp, a bare drive-root file). That is
// an environment limitation this suite cannot work around locally, so every describe below that
// needs the socket is skipped on win32 rather than silently reporting a false pass or hanging on a
// server that never binds. `codexUnixWebSocketUrl` needs no socket at all and stays unguarded.
beforeAll(async () => {
  if (process.platform === 'win32') return
  // Short prefix and short socket name ON PURPOSE. Unix socket paths are capped at `sun_path`
  // (104 bytes on macOS), and macOS's `os.tmpdir()` is already ~49 of them
  // (`/var/folders/ab/…/T/`); a descriptive prefix plus `app-server-control.sock` lands exactly on
  // the limit and fails to bind on a developer's machine while passing in CI. Everything still
  // lives inside the mkdtemp directory, so the path stays unpredictable.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-cx-'))
  sock = path.join(dir, 'as.sock')
  server = http.createServer()
  wss = new WebSocketServer({ server })
  wss.on('connection', handle)
  await new Promise<void>((resolve) => server.listen(sock, resolve))
})

afterAll(async () => {
  if (process.platform === 'win32') return
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe.skipIf(process.platform === 'win32')('codexThreadExistsAt', () => {
  it('confirms a thread the app-server knows', async () => {
    expect(await codexThreadExistsAt(sock, 'thread-known')).toBe(true)
    expect(await codexThreadExistsAt(sock, 'thread-nameless')).toBe(true)
  })

  it('refuses an id the app-server never heard of (the stale-session-id case)', async () => {
    // This is the whole point: the launcher's bind falls back to plain codex instead of exec'ing
    // a resume that dies with "no rollout found" where nothing can catch it.
    expect(await codexThreadExistsAt(sock, 'thread-from-a-past-life')).toBe(false)
  })

  it('refuses when the app-server is not running at all', async () => {
    expect(await codexThreadExistsAt(path.join(dir, 'nope.sock'), 'thread-known', 500, 1)).toBe(
      false
    )
  })

  it('waits out a daemon whose socket is still binding, instead of refusing a good resume', async () => {
    // `codex app-server daemon start` exiting 0 does not mean the socket is listening yet, and
    // this check runs immediately after it on the cold/reboot path. Without the retry, a daemon
    // that binds a beat late turns a legitimate resume into `thread-bind-refused` → plain codex:
    // a NEW way to lose shared identity on exactly the path the feature exists for.
    const latePath = path.join(dir, 'lt.sock')
    const late = http.createServer()
    const lateWss = new WebSocketServer({ server: late })
    lateWss.on('connection', handle)
    const listening = new Promise<void>((resolve) =>
      setTimeout(() => late.listen(latePath, resolve), 250)
    )
    try {
      expect(await codexThreadExistsAt(latePath, 'thread-known', 500)).toBe(true)
    } finally {
      await listening
      await new Promise<void>((resolve) => lateWss.close(() => resolve()))
      await new Promise<void>((resolve) => late.close(() => resolve()))
    }
  })

  it('does NOT retry a server that answered — "I do not have it" is an answer', async () => {
    // Retrying a definite no just delays it. Measured by the clock: three attempts with the
    // default 200ms gap could not come back this fast.
    const started = Date.now()
    expect(await codexThreadExistsAt(sock, 'thread-from-a-past-life')).toBe(false)
    expect(Date.now() - started).toBeLessThan(200)
  })

  it('refuses an id that is not shaped like one, without opening a socket', async () => {
    expect(await codexThreadExistsAt(sock, '../../etc/passwd')).toBe(false)
  })

  it('refuses when the server will not initialize (a logged-out CLI)', async () => {
    initializeFails = true
    try {
      expect(await codexThreadExistsAt(sock, 'thread-known')).toBe(false)
    } finally {
      initializeFails = false
    }
  })
})

describe.skipIf(process.platform === 'win32')('waitForCodexAppServer', () => {
  it('answers true for a live socket and false for a dead one, without throwing', async () => {
    expect(await waitForCodexAppServer(sock, 1)).toBe(true)
    expect(await waitForCodexAppServer(path.join(dir, 'nope.sock'), 2, 10)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('readCodexSessionNameAt', () => {
  it("reads the thread's own name", async () => {
    expect(await readCodexSessionNameAt(sock, 'thread-known')).toBe('Named by codex')
  })

  it('answers null for a nameless or unknown thread, and for a dead server', async () => {
    // Null means "the node keeps its own title" — never a wrong one.
    expect(await readCodexSessionNameAt(sock, 'thread-nameless')).toBeNull()
    expect(await readCodexSessionNameAt(sock, 'thread-from-a-past-life')).toBeNull()
    expect(await readCodexSessionNameAt(path.join(dir, 'nope.sock'), 'thread-known', 500)).toBeNull()
  })
})

describe('readCodexThreadAt', () => {
  it('shares the read-only thread request and exposes runtime status', async () => {
    expect(await readCodexThreadAt(sock, 'thread-known')).toMatchObject({
      id: 'thread-known',
      name: 'Named by codex',
      status: { type: 'active', activeFlags: [] }
    })
  })
})

describe('codexUnixWebSocketUrl', () => {
  it('refuses a socket path that could not survive being put in a URL', () => {
    expect(() => codexUnixWebSocketUrl('relative/app-server.sock')).toThrow()
    expect(() => codexUnixWebSocketUrl('/tmp/with space/app.sock')).toThrow()
    expect(() => codexUnixWebSocketUrl('/tmp/a?b/app.sock')).toThrow()
  })
})

// Same environment limitation the file header and the three describe blocks above document: this
// suite drives the app-server protocol client against a real AF_UNIX socket, and binding an
// arbitrary filesystem path as one is refused with EACCES in this sandboxed environment. This
// block was added after the win32 skip pass (99dfb2db) that guarded `codexThreadExistsAt`,
// `waitForCodexAppServer` and `readCodexSessionNameAt`, so it never picked up the same guard —
// a fixture that fell behind, not a different case. `codexUnixWebSocketUrl` needs no socket at
// all, so its own describe block above stays unguarded, same as before.
describe.skipIf(process.platform === 'win32')('Codex shared app-server session names', () => {
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

  it('reads a relay-preserved resume title from the socket-scoped isolated store', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-relay-name-'))
    const scope = createHash('sha256').update(socket).digest('hex').slice(0, 16)
    const dir = path.join(home, '.nodeterm', 'codex-thread-names', scope)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'resumed-thread'), 'Resumed task title\n')
    expect(relayedCodexSessionName(socket, 'resumed-thread', home)).toBe('Resumed task title')
    expect(relayedCodexSessionName(socket, 'missing-thread', home)).toBeNull()
  })

  it.each(['/tmp/socket:bad', '/tmp/socket with-space', 'relative.sock'])(
    'rejects ambiguous socket path %s',
    (value) =>
      expect(() => codexUnixWebSocketUrl(value)).toThrow('Unsupported Codex app-server socket path')
  )
describe('relayedCodexSessionName (the on-disk relay fallback)', () => {
  it('reads, trims and caps the name the relay stored under the socket-scoped path', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-relay-name-'))
    const socketPath = '/home/x/.codex/app-server-control/app-server-control.sock'
    const scope = createHash('sha256').update(socketPath).digest('hex').slice(0, 16)
    const nameDir = path.join(home, '.nodeterm', 'codex-thread-names', scope)
    fs.mkdirSync(nameDir, { recursive: true })
    fs.writeFileSync(path.join(nameDir, 'thread-1'), `  ${'z'.repeat(600)}  `)
    const value = relayedCodexSessionName(socketPath, 'thread-1', home)
    expect(value).toBe('z'.repeat(500))
    expect(relayedCodexSessionName(socketPath, 'thread-missing', home)).toBeNull()
    expect(relayedCodexSessionName(socketPath, '../escape', home)).toBeNull()
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('readCodexSessionName relay fallback wiring', () => {
  it('falls back to the relayed name when the app-server reports none, and a real name wins', async () => {
    const savedHome = process.env.HOME
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-name-wire-'))
    process.env.HOME = home
    forgetCodexSessionNames()
    try {
      const scope = createHash('sha256').update(sock).digest('hex').slice(0, 16)
      const nameDir = path.join(home, '.nodeterm', 'codex-thread-names', scope)
      fs.mkdirSync(nameDir, { recursive: true })
      fs.writeFileSync(path.join(nameDir, 'thread-nameless'), 'Relayed title')
      // The server has this thread but with a null name → the relay copy fills in.
      expect(await readCodexSessionName('thread-nameless', sock)).toBe('Relayed title')
      forgetCodexSessionNames()
      // A real server name always wins over the relay copy.
      fs.writeFileSync(path.join(nameDir, 'thread-known'), 'Stale relayed title')
      expect(await readCodexSessionName('thread-known', sock)).toBe('Named by codex')
    } finally {
      forgetCodexSessionNames()
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('rememberCodexSessionName', () => {
  it('seeds the cache so the next read serves it without a socket, and rejects a bad id', async () => {
    forgetCodexSessionNames()
    try {
      // A dead socket would answer null; the seeded value is served instead.
      const dead = path.join(dir, 'dead-remember.sock')
      rememberCodexSessionName('thread-seeded', 'Seeded title', dead)
      expect(await readCodexSessionName('thread-seeded', dead)).toBe('Seeded title')
      rememberCodexSessionName('../bad', 'ignored', dead)
      expect(relayedCodexSessionName(dead, '../bad')).toBeNull()
    } finally {
      forgetCodexSessionNames()
    }
  })
})

describe('readCodexThreadRollout / readCodexAccountAt', () => {
  let d = ''
  let s = ''
  let srv: http.Server
  let w: WebSocketServer

  beforeAll(async () => {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-cx2-'))
    s = path.join(d, 'as.sock')
    srv = http.createServer()
    w = new WebSocketServer({ server: srv })
    w.on('connection', (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, any>
        if (msg.method === 'initialize') return ws.send(JSON.stringify({ id: msg.id, result: {} }))
        if (msg.method === 'thread/read') {
          const id = msg.params?.threadId as string
          if (id === 'thread-a')
            return ws.send(
              JSON.stringify({
                id: msg.id,
                result: { thread: { id, name: 'A', path: '/abs/rollout-thread-a.jsonl' } }
              })
            )
          if (id === 'thread-b')
            return ws.send(
              JSON.stringify({ id: msg.id, result: { thread: { id, name: null, path: 'relative' } } })
            )
          if (id === 'thread-forked')
            // The server answers with a DIFFERENT id — must be refused.
            return ws.send(
              JSON.stringify({ id: msg.id, result: { thread: { id: 'other', path: '/abs/x.jsonl' } } })
            )
          return ws.send(JSON.stringify({ id: msg.id, error: { message: 'no rollout found' } }))
        }
        if (msg.method === 'account/read')
          return ws.send(
            JSON.stringify({ id: msg.id, result: { account: { email: '  dev@example.com  ' } } })
          )
      })
    })
    await new Promise<void>((resolve) => srv.listen(s, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => w.close(() => resolve()))
    await new Promise<void>((resolve) => srv.close(() => resolve()))
    fs.rmSync(d, { recursive: true, force: true })
  })

  it('reads id, name and absolute path; drops a non-absolute path to null', async () => {
    expect(await readCodexThreadRollout(s, 'thread-a')).toEqual({
      id: 'thread-a',
      name: 'A',
      path: '/abs/rollout-thread-a.jsonl'
    })
    expect(await readCodexThreadRollout(s, 'thread-b')).toEqual({ id: 'thread-b', name: null, path: null })
  })

  it('refuses a response whose thread id does not match the one asked for', async () => {
    expect(await readCodexThreadRollout(s, 'thread-forked')).toBeNull()
    expect(await readCodexThreadRollout(s, 'thread-unknown')).toBeNull()
    expect(await readCodexThreadRollout(s, '../../etc/passwd')).toBeNull()
  })

  it('reads and trims the account email', async () => {
    expect(await readCodexAccountAt(s)).toEqual({ email: 'dev@example.com' })
  })
})
