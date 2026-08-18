import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import WebSocket from 'ws'
import { startServer } from '../../src/server/index'
import { SESSION_COOKIE } from '../../src/server/http'
import { decodePtyData } from '../../src/shared/rpc'
import { IPC } from '../../src/shared/ipc'
import { TMUX_SOCKET, sessionName } from '../../src/core/tmux-naming'

const hasTmux = (() => { try { execSync('tmux -V'); return true } catch { return false } })()

async function removeFixtureDir(dataDir: string): Promise<void> {
  // Teardown must not decide this test's verdict. The subject is shutdown ORDERING — that the
  // upgraded websocket is terminated before the HTTP server closes — and by the time this runs
  // every assertion proving it has already passed.
  //
  // This used to fail on Windows with EPERM on the directory itself: about one run in four with a
  // 1 s bounded retry, still one in six at 5 s. The comment here correctly concluded that a holder
  // surviving five seconds is not transient lag and that buying more time was the wrong fix. The
  // owner is now known, and it was never going to yield to a longer wait.
  //
  // `fs.rmSync`'s retries are SYNCHRONOUS. They block the event loop, so they cannot let in-flight
  // async work in this same process finish and release what it holds — the retry loop waits for
  // the thing it is itself preventing. The holder is a mirror publication: it opens
  // `agent-status.json.publication.sqlite3` under this very dataDir inside a BEGIN IMMEDIATE
  // transaction, and nothing awaits that flush. Diagnosed in src/server/handlers/index.test.ts,
  // where the same symptom went from 2-4 failures per 6 runs to 8 of 8 on this one change.
  //
  // So: await. Same options, same retry count, one keyword. The warning below stays as a net,
  // because a teardown must still never fail a passing test — but it should now be silent.
  try {
    await fs.promises.rm(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  } catch (error) {
    console.warn(
      `[server-e2e] fixture directory outlived the run and could not be removed: ${dataDir}\n` +
        `  ${String(error)}\n` +
        '  The shutdown assertions above still passed; this is a resource-release signal, not a ' +
        'failure of the behaviour under test.'
    )
  }
}

// Unique per run so a leftover `nt-<persistKey>` tmux session (e.g. from a crashed prior run)
// can never make the fresh-check below return false — the test asserts fresh === true, which
// is the whole point (a real cold start spawns a real pty inside a brand-new tmux session).
const PERSIST_KEY = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

describe.skipIf(!hasTmux)('server e2e: login → ws → pty echo round-trip', () => {
  let dataDir: string, close: () => Promise<void>, port: number, cookie: string

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-e2e-'))
    const srv = await startServer({
      port: 0, host: '127.0.0.1', dataDir,
      rendererDir: path.join(dataDir, 'no-renderer'), insecureHttp: false,
      passwordSeed: 'e2e-password-123',
      // Never touch the developer's real ~/.claude — the hook would point into `dataDir`,
      // which afterAll removes, leaving a dangling hook that breaks every agent session.
      installHooks: false
    })
    port = srv.port
    close = srv.close
    const res = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=e2e-password-123',
      redirect: 'manual'
    })
    expect(res.status).toBe(303)
    cookie = res.headers.get('set-cookie')!.split(';')[0]
    expect(cookie).toContain(SESSION_COOKIE)
  }, 30_000)

  afterAll(async () => {
    await close?.()
    // Best-effort teardown of the specific session for this run, in case the destroy cast in the
    // test didn't land (e.g. an assertion threw first). Target ONLY this run's session — never
    // `kill-server`, which would nuke every other tmux session on the same socket.
    try {
      execSync(`tmux -L ${TMUX_SOCKET} kill-session -t ${sessionName(PERSIST_KEY)}`, { stdio: 'ignore' })
    } catch {
      // session already gone / no server — fine
    }
    await removeFixtureDir(dataDir)
  })

  it('creates a real pty, echoes output over binary frames, destroys it', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } })
    await new Promise<void>((res, rej) => { ws.on('open', () => res()); ws.on('error', rej) })

    let sessionId = ''
    let output = ''
    let sawBinaryFrame = false
    const done = new Promise<void>((resolve) => {
      ws.on('message', (d, isBinary) => {
        if (isBinary) {
          const frame = decodePtyData(new Uint8Array(d as Buffer))
          if (frame && frame.sessionId === sessionId) {
            sawBinaryFrame = true
            output += frame.data
            if (output.includes('E2E_MARKER_OK')) resolve()
          }
          return
        }
        const m = JSON.parse(d.toString())
        if (m.t === 'res' && m.id === 1) {
          expect(m.ok).toBe(true)
          expect(m.result.fresh).toBe(true)
          sessionId = m.result.sessionId
          ws.send(JSON.stringify({ t: 'cast', method: IPC.ptyWrite, args: [sessionId, 'echo E2E_MARKER_OK\r'] }))
        }
      })
    })

    ws.send(JSON.stringify({
      t: 'req', id: 1, method: IPC.ptyCreate,
      args: [{ cols: 80, rows: 24, cwd: os.tmpdir(), persistKey: PERSIST_KEY }]
    }))

    await Promise.race([
      done,
      new Promise((_r, rej) => setTimeout(() => rej(new Error(`no echo; got: ${output.slice(-500)}`)), 20_000))
    ])

    // The echoed marker must have arrived over a BINARY pty-data frame, not a text RPC message.
    expect(sawBinaryFrame).toBe(true)
    expect(output).toContain('E2E_MARKER_OK')

    // ptyDestroy takes the PERSIST KEY (node id), not the pty sessionId — see PtyManager.registerIpc
    // (`IPC.ptyDestroy → destroySession(persistKey)`). Send the exact key the create call used.
    ws.send(JSON.stringify({ t: 'cast', method: IPC.ptyDestroy, args: [PERSIST_KEY] }))
    ws.close()
  }, 30_000)
})

describe('server shutdown with a live websocket', () => {
  it('terminates the upgraded client before closing the HTTP server', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-e2e-shutdown-'))
    const srv = await startServer({
      port: 0, host: '127.0.0.1', dataDir,
      rendererDir: path.join(dataDir, 'no-renderer'), insecureHttp: false,
      passwordSeed: 'e2e-shutdown-password-123', installHooks: false
    })
    const res = await fetch(`http://127.0.0.1:${srv.port}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=e2e-shutdown-password-123',
      redirect: 'manual'
    })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { headers: { cookie } })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const clientClosed = new Promise<void>((resolve) => ws.once('close', () => resolve()))
    let closeTimer: ReturnType<typeof setTimeout> | undefined

    try {
      await Promise.race([
        srv.close(),
        new Promise<never>((_resolve, reject) => {
          closeTimer = setTimeout(
            () => reject(new Error('server close hung on upgraded websocket')),
            2_000
          )
        })
      ])
      await clientClosed
      expect(ws.readyState).toBe(WebSocket.CLOSED)
    } finally {
      if (closeTimer) clearTimeout(closeTimer)
      ws.terminate()
      await removeFixtureDir(dataDir)
    }
  }, 10_000)
})
