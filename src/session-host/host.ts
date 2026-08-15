// The standalone session-host process: a plain Node entry point (NOT Electron-dependent — it is
// launched with ELECTRON_RUN_AS_NODE=1 when process.execPath is the Electron binary, see
// src/core/session-host-launcher.ts) that owns PTYs and outlives the app that spawned it. This is
// the Windows-and-anywhere-tmux-is-missing analogue of a tmux server.
//
// Bundled by esbuild (`npm run host:build`) to out/session-host/host.cjs, mirroring the existing
// `server:build` script's shape — node-pty stays external (native module). See
// docs/windows-session-host.md for the full architecture, lifetime rules, protocol and the
// warm-attach seeding trap this file's `handleAttach` exists to avoid.
//
// Invocation: `node host.cjs <userDataDir>`. Everything the host needs — where to bind, where to
// write its token/state — is DERIVED from userDataDir alone (see paths.ts); nothing else is ever
// passed on argv, so nothing sensitive ever appears in this process's command line.

import fs from 'fs'
import net from 'net'
import path from 'path'
import crypto from 'crypto'
import { sessionHostPaths, currentProtocolVersion, type SessionHostState } from './paths'
import {
  LineFramer,
  encodeFrame,
  type SessionHostRequest,
  type SessionHostFrame,
  type AttachResult,
  type HasSessionResult,
  type PaneCommandResult,
  type CaptureResult,
  type ListSessionsResult
} from './protocol'
import { HostSession } from './session'
import { paneCommand as readPaneCommand } from './process-tree'
import { publishSessionHostState } from './state-file'
import {
  currentSessionAfterRetirement,
  retireSessionGeneration
} from './generation-barrier'

/** How long a session-less host lingers before exiting — mirrors tmux's own server lifetime rule
 *  ("the server exits when its last session dies"), plus a grace window so an app restart that
 *  briefly drops to zero sessions (closing every node, or a launcher racing a real create) does
 *  not tear down a host that is about to be handed a fresh session moments later. */
const GRACE_EXIT_MS = 30_000

/** Bounded log file — this is a headless daemon with `stdio: 'ignore'`, so this is the only way
 *  to see what it did after the fact. Best-effort: a failure to write here must never affect a
 *  session. Capped by truncating rather than rotating — simplicity over completeness for a file
 *  nobody reads except when diagnosing a report. */
let logPath = ''
const LOG_CAP_BYTES = 512 * 1024
function log(line: string): void {
  if (!logPath) return
  try {
    const stat = fs.existsSync(logPath) ? fs.statSync(logPath) : null
    if (stat && stat.size > LOG_CAP_BYTES) fs.writeFileSync(logPath, '')
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* diagnostics only */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Try a one-shot hello against an already-running host. Resolves true only on a real `{ok:true}`
 *  reply within `timeoutMs` — anything else (refused, timed out, wrong token) is "not alive". */
function tryHello(endpoint: string, token: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
      resolve(ok)
    }
    const socket = net.connect(endpoint)
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    socket.once('connect', () => {
      socket.write(encodeFrame({ id: 0, cmd: 'hello', token }))
    })
    const framer = new LineFramer()
    socket.on('data', (chunk: Buffer) => {
      for (const frame of framer.push<{ id: number; ok?: boolean }>(chunk.toString('utf8'))) {
        clearTimeout(timer)
        finish(frame.ok === true)
      }
    })
  })
}

/** Poll for a WINNER of the startup race to finish writing its state file and come up — the state
 *  file can legitimately exist-but-be-incomplete for a brief window between this process losing
 *  the exclusive-create race and the winner actually binding + writing token + state. */
async function probeExisting(statePath: string, tokenPathFallback: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const raw = fs.readFileSync(statePath, 'utf8').trim()
      if (raw) {
        const state = JSON.parse(raw) as Partial<SessionHostState>
        if (state.endpoint && state.tokenPath) {
          const token = fs.readFileSync(state.tokenPath, 'utf8').trim()
          if (token && (await tryHello(state.endpoint, token, 1000))) return true
        }
      }
    } catch {
      // not written yet, or the winner already died — keep polling within the bound
    }
    await sleep(150)
  }
  // Last resort: the state file never resolved to a live host in the window above. Try the
  // caller's own freshly-generated token path too, in case tokenPath alone survived a torn write.
  void tokenPathFallback
  return false
}

async function main(): Promise<void> {
  const userDataDir = process.argv[2]
  if (!userDataDir) {
    process.stderr.write('session-host: missing userDataDir argument\n')
    process.exit(1)
  }
  const paths = sessionHostPaths(userDataDir)
  logPath = path.join(userDataDir, 'session-host.log')
  log(`starting pid=${process.pid} endpoint=${paths.endpoint}`)

  // 1) Exclusive-create race gate. Two app instances launched at once will both spawn a host;
  // exactly one of them may proceed past this point on the first try.
  let haveLock = false
  try {
    fs.closeSync(fs.openSync(paths.statePath, 'wx'))
    haveLock = true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
      log(`fatal: could not create state file: ${String(e)}`)
      process.exit(1)
    }
  }
  if (!haveLock) {
    const alive = await probeExisting(paths.statePath, paths.tokenPath)
    if (alive) {
      log('another host is already running and answered hello — exiting quietly')
      process.exit(0)
    }
    // Stale lock: a previous host crashed before cleaning up, or lost the race and left a
    // half-written file. Steal it — we already waited out the whole probe window above.
    log('stale state file with no live host behind it — reclaiming')
    try {
      fs.unlinkSync(paths.statePath)
    } catch {
      /* already gone */
    }
    try {
      fs.closeSync(fs.openSync(paths.statePath, 'wx'))
    } catch (e) {
      log(`fatal: could not reclaim state file: ${String(e)}`)
      process.exit(1)
    }
  }

  // POSIX: a stale socket FILE left by an unclean shutdown makes bind() fail EADDRINUSE even
  // though nothing is listening. Safe to clear now — we hold the state-file lock, so nothing
  // legitimate can be bound here without having just re-won that same lock.
  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(paths.endpoint)
    } catch {
      /* nothing to remove */
    }
  }

  const sessions = new Map<string, HostSession>()
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  function cancelGraceExit(): void {
    if (graceTimer) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
  }
  function scheduleGraceExitIfEmpty(): void {
    if (sessions.size > 0) return
    cancelGraceExit()
    graceTimer = setTimeout(() => {
      if (sessions.size > 0) return
      log('no sessions left — exiting')
      cleanupFiles()
      process.exit(0)
    }, GRACE_EXIT_MS)
    graceTimer.unref?.()
  }
  function cleanupFiles(): void {
    for (const p of [paths.statePath, paths.tokenPath]) {
      try {
        fs.unlinkSync(p)
      } catch {
        /* best-effort */
      }
    }
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(paths.endpoint)
      } catch {
        /* best-effort */
      }
    }
  }

  function broadcast(session: HostSession, frame: SessionHostFrame): void {
    const line = encodeFrame(frame)
    for (const sub of session.subscribers) {
      try {
        sub.write(line)
      } catch {
        /* subscriber socket mid-close — it will be dropped on its own 'close' handler */
      }
    }
  }

  /** Ends a session exactly once, however it ends (natural pty exit or an explicit kill), and
   *  broadcasts the exit frame exactly once — see `HostSession.exited`. Output already accepted
   *  from node-pty drains through the emulator first, so subscribers cannot observe `exit` ahead
   *  of the final data chunk and a kill acknowledgement cannot outrun that same drain. */
  function endSession(session: HostSession, exitCode: number): Promise<void> {
    if (session.ending) return session.ending
    session.exited = true
    session.ending = (async () => {
      const released = await retireSessionGeneration(
        sessions,
        session.name,
        session,
        async () => {
          await session.settleOutput()
          broadcast(session, { type: 'exit', name: session.name, exitCode })
          session.dispose()
        }
      )
      if (released) scheduleGraceExitIfEmpty()
      log(`session ended name=${session.name} exitCode=${exitCode}`)
    })()
    return session.ending
  }

  function wireSession(session: HostSession): void {
    session.proc.onData((data) => {
      if (session.exited) return
      void session.recordOutput(data).then(
        () => broadcast(session, { type: 'data', name: session.name, data }),
        (e) => {
          // Delivery is still preferable to silently losing real PTY bytes if the screen mirror
          // itself ever rejects. The queue recovers for later writes; a capture may omit this one.
          log(`terminal mirror write failed name=${session.name}: ${String(e)}`)
          broadcast(session, { type: 'data', name: session.name, data })
        }
      )
    })
    session.proc.onExit(({ exitCode }) => void endSession(session, exitCode))
  }

  async function handleAttach(req: Extract<SessionHostRequest, { cmd: 'attach' }>, socket: net.Socket): Promise<AttachResult> {
    cancelGraceExit()
    // An exited entry deliberately keeps the name reserved until all old-generation frames have
    // reached its subscribers. The protocol carries only `name`, not a generation id, so creating
    // the replacement sooner lets a delayed old exit kill that replacement on the same socket.
    const existing = await currentSessionAfterRetirement(sessions, req.name)
    if (existing && !existing.exited) {
      // Add the new subscriber only AFTER the barrier+snapshot. Otherwise a pending chunk can be
      // delivered live to this socket and then appear again in its warm-attach screen.
      const screen = await existing.serialize()
      // The process can exit while the async emulator drains. Do not serialize/dispose the stale
      // object into a replacement session; retry the ordinary cold path instead.
      if (existing.exited || sessions.get(req.name) !== existing) {
        return handleAttach(req, socket)
      }
      existing.subscribers.add(socket)
      log(`attach (warm) name=${req.name} subscribers=${existing.subscribers.size}`)
      return { fresh: false, screen: screen || undefined }
    }
    const session = new HostSession(req.name, req.spawn, req.scrollback)
    sessions.set(req.name, session)
    session.subscribers.add(socket)
    wireSession(session)
    log(`attach (cold) name=${req.name} pid=${session.proc.pid}`)
    return { fresh: true }
  }

  async function dispatch(req: SessionHostRequest, socket: net.Socket): Promise<{ ok: true; result?: unknown } | { ok: false; error: string }> {
    switch (req.cmd) {
      case 'attach':
        return { ok: true, result: await handleAttach(req, socket) }
      case 'hasSession':
        return { ok: true, result: { exists: sessions.has(req.name) } satisfies HasSessionResult }
      case 'write': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        s.proc.write(req.data)
        return { ok: true }
      }
      case 'resize': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        try {
          s.proc.resize(Math.max(1, req.cols), Math.max(1, req.rows))
        } catch {
          /* pty may have just exited — resize on a dead pty is a no-op, not a caller error */
        }
        await s.resize(req.cols, req.rows)
        return { ok: true }
      }
      case 'pause': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        s.pauseFor(socket)
        return { ok: true }
      }
      case 'resume': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        s.resumeFor(socket)
        return { ok: true }
      }
      case 'sendKeys': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        s.proc.write(req.text + (req.enter ? '\r' : ''))
        return { ok: true }
      }
      case 'paneCommand': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: true, result: { command: null } satisfies PaneCommandResult }
        const command = await readPaneCommand(s.proc.pid)
        return { ok: true, result: { command } satisfies PaneCommandResult }
      }
      case 'capture': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: true, result: { text: '' } satisfies CaptureResult }
        const text = await s.serialize(req.full ? undefined : 200)
        if (s.exited || sessions.get(req.name) !== s) {
          return { ok: true, result: { text: '' } satisfies CaptureResult }
        }
        return { ok: true, result: { text } satisfies CaptureResult }
      }
      case 'killSession': {
        const s = sessions.get(req.name)
        if (s) {
          if (!s.exited) {
            try {
              s.proc.kill()
            } catch {
              /* already dead */
            }
          }
          // A natural exit may already own this completion. Await the shared barrier either way;
          // acknowledging here early would recreate the same old-generation publication race.
          await endSession(s, 0)
        }
        return { ok: true }
      }
      case 'detach': {
        sessions.get(req.name)?.detach(socket)
        return { ok: true }
      }
      case 'listSessions':
        return { ok: true, result: { names: [...sessions.keys()] } satisfies ListSessionsResult }
      case 'ping':
        return { ok: true }
      default:
        return { ok: false, error: `unknown command` }
    }
  }

  const server = net.createServer((socket) => {
    let authed = false
    const framer = new LineFramer()
    socket.on('data', (chunk: Buffer) => {
      const frames = framer.push<SessionHostRequest>(chunk.toString('utf8'))
      for (const req of frames) {
        if (!authed) {
          if (req.cmd === 'hello' && req.token === token) {
            authed = true
            socket.write(encodeFrame({ id: req.id, ok: true }))
          } else {
            socket.write(encodeFrame({ id: req.id, ok: false, error: 'unauthorized' }))
            socket.destroy()
          }
          continue
        }
        if (req.cmd === 'hello') {
          socket.write(encodeFrame({ id: req.id, ok: true }))
          continue
        }
        void dispatch(req, socket)
          .then((res) => socket.write(encodeFrame({ id: req.id, ...res })))
          .catch((e) => socket.write(encodeFrame({ id: req.id, ok: false, error: String(e) })))
      }
    })
    socket.on('close', () => {
      // A connection dropping is a DETACH, never a kill — sessions belong to the host, not to
      // any one connection. Mirrors tmux: closing a client's terminal only ends that client.
      // `detach` also returns this socket's pause ticket; without that second half, a crashed
      // viewer can leave the global node-pty actuator paused forever for every healthy viewer.
      for (const session of sessions.values()) session.detach(socket)
    })
    socket.on('error', () => {
      /* the 'close' handler above still runs and does the real cleanup */
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    log(`listen error: ${err.code ?? err.message}`)
    // We hold the state-file lock, so a genuine EADDRINUSE here means a PRIOR host (from before
    // this file existed, or one that crashed after binding but before this run started) is still
    // bound. Give the probe one more honest look before giving up.
    if (err.code === 'EADDRINUSE') {
      void probeExisting(paths.statePath, paths.tokenPath).then((alive) => {
        if (alive) process.exit(0)
        cleanupFiles()
        process.exit(1)
      })
      return
    }
    cleanupFiles()
    process.exit(1)
  })

  const token = crypto.randomBytes(32).toString('hex')
  server.listen(paths.endpoint, () => {
    try {
      fs.writeFileSync(paths.tokenPath, token, { mode: 0o600 })
    } catch (e) {
      log(`fatal: could not write token file: ${String(e)}`)
      process.exit(1)
    }
    const state: SessionHostState = {
      pid: process.pid,
      endpoint: paths.endpoint,
      tokenPath: paths.tokenPath,
      startedAt: Date.now(),
      protocolVersion: currentProtocolVersion()
    }
    // Replace the empty startup-lock file atomically from a temp owned by THIS process. A fixed
    // `.tmp` lets racing/stale-reclaim hosts publish or remove one another's bytes; a bare rename
    // also loses the boot on Windows when a scanner briefly holds the state file open.
    publishSessionHostState(paths.statePath, JSON.stringify(state))
    log(`listening pid=${process.pid} endpoint=${paths.endpoint}`)
    scheduleGraceExitIfEmpty() // a host with zero sessions ever attached still exits eventually
  })

  // Detaching every client (app quit) is not a lifecycle event here at all — there is no
  // "client" concept at the process level, only sockets, and their 'close' handler above already
  // does the right thing. Nothing to hook for that case.

  process.on('uncaughtException', (e) => log(`uncaughtException: ${String(e)}`))
  process.on('unhandledRejection', (e) => log(`unhandledRejection: ${String(e)}`))
}

void main()
