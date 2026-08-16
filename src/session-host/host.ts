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
import { readExistingSessionHostIdentity } from './existing-host-state'
import {
  RETRY_SESSION_GENERATION,
  SessionGenerationCoordinator,
  retireSessionGeneration
} from './generation-barrier'
import { drainSessionHostTransport, writeSessionHostFrame } from './socket-flow'
import { SessionHostSocketRequestQueue } from './socket-request-queue'
import { trySessionHostHello } from './hello-probe'
import { killHostSession } from './kill-session'

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

/** Poll for a WINNER of the startup race to finish writing its state file and come up — the state
 *  file can legitimately exist-but-be-incomplete for a brief window between this process losing
 *  the exclusive-create race and the winner actually binding + writing token + state. */
async function probeExisting(
  statePath: string,
  expectedEndpoint: string,
  expectedTokenPath: string
): Promise<boolean> {
  let lastFailure: unknown = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const identity = readExistingSessionHostIdentity(statePath, {
        expectedEndpoint,
        expectedTokenPath
      })
      // ENOENT is the only observation that can prove absence. It also supersedes an earlier
      // partial-publication read failure: the final bounded observation is what owns reclaim.
      lastFailure = null
      if (
        identity.kind === 'ready' &&
        (await trySessionHostHello(identity.state.endpoint, identity.token, 1000))
      ) {
        return true
      }
    } catch (error) {
      // A winner can be between exclusive-create and atomic publication, so retry within the
      // existing bound. If the final observation is still unreadable/invalid, propagate it: that
      // is evidence of possible ownership, never permission to unlink and steal the state path.
      lastFailure = error
    }
    await sleep(150)
  }
  if (lastFailure) throw lastFailure
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
    let alive: boolean
    try {
      alive = await probeExisting(paths.statePath, paths.endpoint, paths.tokenPath)
    } catch (error) {
      log(`fatal: existing host ownership state is unreadable: ${String(error)}`)
      process.exit(1)
      return
    }
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
  const generationCoordinator = new SessionGenerationCoordinator(sessions, cancelGraceExit)

  function broadcast(session: HostSession, frame: SessionHostFrame): void {
    const line = encodeFrame(frame)
    for (const sub of session.subscribers) {
      writeSessionHostFrame(sub, line, sessions.values())
    }
  }

  /** Publish and remove a generation only after node-pty has authoritatively observed process
   * exit. A successful `proc.kill()` call merely dispatched a signal and cannot enter here. */
  async function publishSessionEnd(session: HostSession, exitCode: number): Promise<void> {
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
  }

  function endSession(session: HostSession, exitCode: number): Promise<void> {
    if (session.ending) return session.ending
    session.retiring = true
    session.ending = publishSessionEnd(session, exitCode)
    return session.ending
  }

  /** Claim the name immediately after a kill signal succeeds, then wait for onExit. The generation
   * coordinator sees `retiring` and blocks same-name attach until the real exit frame, output drain
   * and disposal have all completed. */
  function beginKillRetirement(session: HostSession): Promise<void> {
    if (session.ending) return session.ending
    session.retiring = true
    session.ending = (async () => {
      const exitCode = await session.waitForProcessExit()
      await publishSessionEnd(session, exitCode)
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
    session.proc.onExit(({ exitCode }) => {
      session.observeProcessExit(exitCode)
      void endSession(session, exitCode)
    })
  }

  async function handleAttach(req: Extract<SessionHostRequest, { cmd: 'attach' }>, socket: net.Socket): Promise<AttachResult> {
    return generationCoordinator.run<AttachResult>(req.name, async (existing) => {
      if (existing && !existing.exited) {
        // Restore this connection's flow + geometry before taking the screen. A reconnect carrying
        // `paused` must never receive bytes in the gap before its explicit ticket is reasserted.
        // Live delivery still starts only AFTER the barrier+snapshot, so a pending chunk cannot be
        // delivered to this socket and then appear again in the warm screen.
        const attachment = await existing.prepareAttachment(
          socket,
          req.spawn.cols,
          req.spawn.rows,
          req.paused === true
        )
        try {
          const screen = await existing.serialize()
          if (!attachment.isCurrent()) {
            await attachment.rollback()
            throw new Error('attach cancelled before activation')
          }
          // The process can exit while the async emulator drains. Retain this name claim and cross
          // its retirement barrier again; recursive attach would deadlock or race another waiter.
          if (existing.exited || sessions.get(req.name) !== existing) {
            await attachment.rollback()
            if (!attachment.isCurrent()) throw new Error('attach cancelled during retry')
            return RETRY_SESSION_GENERATION
          }
          if (!attachment.commit()) throw new Error('attach cancelled before activation')
          log(`attach (warm) name=${req.name} subscribers=${existing.subscribers.size}`)
          return { fresh: false, screen: screen || undefined }
        } catch (error) {
          await attachment.rollback()
          throw error
        }
      }
      const session = new HostSession(req.name, req.spawn, req.scrollback)
      // prepareAttachment books `paused` synchronously before its first await. Do that before the
      // process is wired for output so a reconnect cannot leak initial bytes before the ticket.
      const preparing = session.prepareAttachment(
        socket,
        req.spawn.cols,
        req.spawn.rows,
        req.paused === true
      )
      sessions.set(req.name, session)
      wireSession(session)
      try {
        const attachment = await preparing
        if (
          session.exited ||
          sessions.get(req.name) !== session ||
          !attachment.isCurrent() ||
          !attachment.commit()
        ) {
          await attachment.rollback()
          throw new Error('attach cancelled before activation')
        }
      } catch (error) {
        if (session.exited) {
          await session.ending
        } else if (sessions.get(req.name) === session) {
          await killHostSession(session, beginKillRetirement)
        }
        throw error
      }
      log(`attach (cold) name=${req.name} pid=${session.proc.pid}`)
      return { fresh: true }
    })
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
        if (!s.subscribers.has(socket)) return { ok: false, error: 'not attached to session' }
        s.proc.write(req.data)
        return { ok: true }
      }
      case 'resize': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        if (!s.subscribers.has(socket)) return { ok: false, error: 'not attached to session' }
        await s.resizeFor(socket, req.cols, req.rows)
        return { ok: true }
      }
      case 'pause': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        if (!s.subscribers.has(socket)) return { ok: false, error: 'not attached to session' }
        s.pauseFor(socket)
        return { ok: true }
      }
      case 'resume': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        if (!s.subscribers.has(socket)) return { ok: false, error: 'not attached to session' }
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
          // A natural exit may already own this completion. Await the shared barrier either way;
          // acknowledging here early would recreate the same old-generation publication race.
          await killHostSession(s, beginKillRetirement)
        }
        return { ok: true }
      }
      case 'detach': {
        await sessions.get(req.name)?.detach(socket)
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

  const liveSockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    liveSockets.add(socket)
    let authed = false
    const framer = new LineFramer()
    const requestQueue = new SessionHostSocketRequestQueue()
    const dispatchAndRespond = async (req: SessionHostRequest): Promise<void> => {
      if (socket.destroyed) return
      try {
        const res = await dispatch(req, socket)
        writeSessionHostFrame(
          socket,
          encodeFrame({ id: req.id, ...res }),
          sessions.values()
        )
      } catch (e) {
        writeSessionHostFrame(
          socket,
          encodeFrame({ id: req.id, ok: false, error: String(e) }),
          sessions.values()
        )
      }
    }
    socket.on('data', (chunk: Buffer) => {
      const frames = framer.push<SessionHostRequest>(chunk.toString('utf8'))
      for (const req of frames) {
        if (!authed) {
          if (req.cmd === 'hello' && req.token === token) {
            authed = true
            writeSessionHostFrame(
              socket,
              encodeFrame({ id: req.id, ok: true }),
              sessions.values()
            )
          } else {
            writeSessionHostFrame(
              socket,
              encodeFrame({ id: req.id, ok: false, error: 'unauthorized' }),
              sessions.values()
            )
            socket.destroy()
          }
          continue
        }
        if (req.cmd === 'hello') {
          writeSessionHostFrame(
            socket,
            encodeFrame({ id: req.id, ok: true }),
            sessions.values()
          )
          continue
        }
        if ('name' in req) void requestQueue.enqueue(req.name, () => dispatchAndRespond(req))
        else void dispatchAndRespond(req)
      }
    })
    socket.on('drain', () => drainSessionHostTransport(socket, sessions.values()))
    socket.on('close', () => {
      liveSockets.delete(socket)
      // A connection dropping is a DETACH, never a kill — sessions belong to the host, not to
      // any one connection. Mirrors tmux: closing a client's terminal only ends that client.
      // `detach` also returns this socket's pause ticket; without that second half, a crashed
      // viewer can leave the global node-pty actuator paused forever for every healthy viewer.
      for (const session of sessions.values()) {
        void session.detach(socket).catch((e) =>
          log(`detach cleanup failed name=${session.name}: ${String(e)}`)
        )
      }
    })
    socket.on('error', () => {
      /* the 'close' handler above still runs and does the real cleanup */
    })
  })

  let abortingStartup = false
  function abortListeningStartup(reason: string, error: unknown): void {
    if (abortingStartup) return
    abortingStartup = true
    log(`fatal: ${reason}: ${String(error)}`)
    // `listen` has already succeeded when token/state publication runs. Stop accepting first and
    // destroy anything that reached the tiny pre-publication window, then remove every artifact
    // owned behind our exclusive startup lock. The uncaughtException logger below deliberately
    // keeps the process alive, so startup failures must terminate through this explicit path.
    for (const socket of liveSockets) socket.destroy()
    const finish = (): void => {
      cleanupFiles()
      process.exit(1)
    }
    try {
      server.close(finish)
    } catch {
      finish()
    }
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    log(`listen error: ${err.code ?? err.message}`)
    // We hold the state-file lock, so a genuine EADDRINUSE here means a PRIOR host (from before
    // this file existed, or one that crashed after binding but before this run started) is still
    // bound. Give the probe one more honest look before giving up.
    if (err.code === 'EADDRINUSE') {
      void probeExisting(paths.statePath, paths.endpoint, paths.tokenPath).then(
        (alive) => {
          if (alive) process.exit(0)
          cleanupFiles()
          process.exit(1)
        },
        (error) => {
          log(`fatal: ownership probe after EADDRINUSE failed: ${String(error)}`)
          cleanupFiles()
          process.exit(1)
        }
      )
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
      abortListeningStartup('could not write token file', e)
      return
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
    try {
      publishSessionHostState(paths.statePath, JSON.stringify(state))
    } catch (e) {
      abortListeningStartup('could not publish state file', e)
      return
    }
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
