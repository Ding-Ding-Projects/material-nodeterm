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
  type KillSessionResult,
  type ListSessionsResult
} from './protocol'
import { HostSession } from './session'
import { paneCommand as readPaneCommand } from './process-tree'
import { terminateWindowsProcessTree } from './windows-process-tree'

/** How long a session-less host lingers before exiting — mirrors tmux's own server lifetime rule
 *  ("the server exits when its last session dies"), plus a grace window so an app restart that
 *  briefly drops to zero sessions (closing every node, or a launcher racing a real create) does
 *  not tear down a host that is about to be handed a fresh session moments later. */
const GRACE_EXIT_MS = 30_000
const COMPLETED_KILL_TTL_MS = 10 * 60_000
const MAX_COMPLETED_KILLS = 1_024
const REPLACEMENT_RESERVATION_TTL_MS = 30_000

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
      socket.write(
        encodeFrame({ id: 0, cmd: 'hello', token, protocolVersion: currentProtocolVersion() })
      )
    })
    const framer = new LineFramer()
    socket.on('data', (chunk: Buffer) => {
      for (const frame of framer.push<{
        id: number
        ok?: boolean
        result?: { protocolVersion?: number }
      }>(chunk.toString('utf8'))) {
        clearTimeout(timer)
        // An authenticated v1 host replies `{ok:true}` without result metadata. It may still own
        // live terminals from the previous app version, so it is alive and must never be reclaimed
        // merely because the new client speaks v2. Capability gating happens on the client socket.
        finish(
          frame.ok === true &&
            (frame.result?.protocolVersion === undefined ||
              frame.result.protocolVersion === currentProtocolVersion())
        )
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
  type EndingOperation = {
    session: HostSession
    promise: Promise<KillSessionResult>
    resolve: (result: KillSessionResult) => void
    reject: (error: Error) => void
    operationIds: Set<string>
    reserveReplacement: boolean
    expectedGeneration?: string
  }
  const ending = new Map<string, EndingOperation>()
  const inProgressKillIds = new Map<string, { name: string; operation: EndingOperation }>()
  const completedKillIds = new Map<
    string,
    {
      name: string
      completedAt: number
      reserveReplacement: boolean
      expectedGeneration?: string
    }
  >()
  const replacementReservations = new Map<
    string,
    { token: string; expiresAt: number }
  >()
  let graceTimer: ReturnType<typeof setTimeout> | null = null

  function pruneCompletedKills(now = Date.now()): void {
    for (const [operationId, entry] of completedKillIds) {
      if (now - entry.completedAt <= COMPLETED_KILL_TTL_MS) continue
      completedKillIds.delete(operationId)
    }
    while (completedKillIds.size > MAX_COMPLETED_KILLS) {
      const oldest = completedKillIds.keys().next().value as string | undefined
      if (!oldest) break
      completedKillIds.delete(oldest)
    }
  }

  function rememberCompletedKill(
    operationId: string,
    name: string,
    reserveReplacement: boolean,
    expectedGeneration?: string
  ): void {
    completedKillIds.delete(operationId)
    completedKillIds.set(operationId, {
      name,
      completedAt: Date.now(),
      reserveReplacement,
      expectedGeneration
    })
    pruneCompletedKills()
  }

  function validateKillOperationId(operationId: string): void {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(operationId)) {
      throw new Error('invalid kill operation id')
    }
  }

  function activeReplacementReservation(
    name: string
  ): { token: string; expiresAt: number } | undefined {
    const reservation = replacementReservations.get(name)
    if (reservation && reservation.expiresAt <= Date.now()) {
      replacementReservations.delete(name)
      return undefined
    }
    return reservation
  }

  function setReplacementReservation(name: string, token: string): void {
    replacementReservations.set(name, {
      token,
      expiresAt: Date.now() + REPLACEMENT_RESERVATION_TTL_MS
    })
    // A zero-session host is now carrying a live cross-client replacement lease. Restart its
    // grace window so it cannot exit underneath the owner before the equally-bounded lease does.
    cancelGraceExit()
    scheduleGraceExitIfEmpty()
  }

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
   *  broadcasts the exit frame exactly once — see `HostSession.exited`. */
  function endSession(session: HostSession, exitCode: number): void {
    if (session.exited) return
    session.exited = true
    sessions.delete(session.name)
    const kill = ending.get(session.name)
    let killResult: KillSessionResult | undefined
    if (kill?.session === session) {
      ending.delete(session.name)
      const ownerToken = kill.operationIds.values().next().value as string | undefined
      if (ownerToken && kill.reserveReplacement) {
        setReplacementReservation(session.name, ownerToken)
      }
      for (const operationId of kill.operationIds) {
        rememberCompletedKill(
          operationId,
          session.name,
          kill.reserveReplacement,
          kill.expectedGeneration
        )
        inProgressKillIds.delete(operationId)
      }
      killResult = {
        replacementToken: kill.reserveReplacement ? ownerToken : undefined
      }
    }
    // For a confirmed replacement, the reservation above is the commit. Publish the exact
    // generation exit only after it exists so a client that loses the correlated reply can adopt
    // the same operationId without opening an unreserved cross-app race.
    broadcast(session, {
      type: 'exit',
      name: session.name,
      exitCode,
      generation: session.generation
    })
    session.dispose()
    scheduleGraceExitIfEmpty()
    log(`session ended name=${session.name} exitCode=${exitCode}`)
    if (kill && killResult) kill.resolve(killResult)
  }

  function wireSession(session: HostSession): void {
    session.proc.onData((data) => {
      // node-pty may flush a queued data callback after its exit callback. Once endSession has
      // disposed the emulator and broadcast exit, no data may touch or appear after that boundary.
      if (session.exited) return
      // Trusted launch input is typed through the same ConPTY and therefore echoed by the shell.
      // While HostSession verifies that echo, keep the entire chunk out of both renderer push
      // frames and the reconstructable screen so executable/argv/prompt material stays core-only.
      if (session.suppressingPrivateLaunchOutput) return
      void session.term.write(data)
      broadcast(session, {
        type: 'data',
        name: session.name,
        data,
        generation: session.generation
      })
    })
    session.proc.onExit(({ exitCode }) => endSession(session, exitCode))
  }

  async function launchProcessReady(session: HostSession): Promise<boolean> {
    const command = await readPaneCommand(session.proc.pid)
    if (!command) return false
    const liveName = command.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
    return Boolean(liveName && liveName !== session.shellExecutableName)
  }

  async function handleAttach(
    req: Extract<SessionHostRequest, { cmd: 'attach' }>,
    socket: net.Socket
  ): Promise<AttachResult> {
    if (ending.has(req.name)) {
      throw new Error(`session '${req.name}' is ending and cannot be attached`)
    }
    const existing = sessions.get(req.name)
    if (existing && !existing.exited) {
      if (req.replacementToken) {
        if (existing.createdByReplacementToken !== req.replacementToken) {
          throw new Error(
            `reserved replacement '${req.name}' cannot attach a different live generation`
          )
        }
        if (!existing.matchesReplacementReplay(req.spawn, req.scrollback)) {
          throw new Error(
            `reserved replacement '${req.name}' replay changed its trusted launch plan`
          )
        }
        // The original cold attach may have created/launched successfully and then lost its reply.
        // Replaying the SAME token is an idempotent attach to that exact generation, never a spawn.
        const initialLaunch = await existing.executeInitialLaunch(req.spawn, () =>
          launchProcessReady(existing)
        )
        cancelGraceExit()
        existing.subscribers.add(socket)
        const screen = existing.term.serialize()
        return {
          fresh: true,
          screen: screen || undefined,
          generation: existing.generation,
          launchDialect: existing.launchDialect,
          initialLaunchStatus: initialLaunch?.status
        }
      }
      cancelGraceExit()
      existing.subscribers.add(socket)
      const screen = existing.term.serialize()
      log(`attach (warm) name=${req.name} subscribers=${existing.subscribers.size}`)
      return {
        fresh: false,
        screen: screen || undefined,
        generation: existing.generation,
        launchDialect: existing.launchDialect
      }
    }
    if (existing?.exited) sessions.delete(req.name) // stale entry racing its own exit — replace it
    const reservation = activeReplacementReservation(req.name)
    if (reservation && req.replacementToken !== reservation.token) {
      throw new Error(`session '${req.name}' is reserved for confirmed replacement`)
    }
    if (!reservation && req.replacementToken) {
      throw new Error(`replacement reservation for session '${req.name}' is no longer valid`)
    }
    // Consume before construction: a resolver/spawn failure releases the name for recovery.
    if (reservation) replacementReservations.delete(req.name)
    let session: HostSession
    try {
      session = new HostSession(req.name, req.spawn, req.scrollback, reservation?.token)
    } catch (error) {
      scheduleGraceExitIfEmpty()
      void error
      log(`spawn failed name=${req.name} category=profile-start-failed`)
      // Executable, argv, cwd and native process details are trusted-core/private state. The wire
      // carries only a stable actionable category; full diagnostics stay in the host-local log.
      throw new Error('session-host could not start the requested terminal profile')
    }
    cancelGraceExit()
    sessions.set(req.name, session)
    session.subscribers.add(socket)
    wireSession(session)
    log(`attach (cold) name=${req.name} pid=${session.proc.pid}`)
    const initialLaunch = await session.executeInitialLaunch(req.spawn, () =>
      launchProcessReady(session)
    )
    return {
      fresh: true,
      generation: session.generation,
      launchDialect: session.launchDialect,
      initialLaunchStatus: initialLaunch?.status
    }
  }

  function handleAttachExisting(
    req: Extract<SessionHostRequest, { cmd: 'attachExisting' }>,
    socket: net.Socket
  ): AttachResult {
    if (ending.has(req.name)) {
      throw new Error(`session '${req.name}' is ending and cannot be attached`)
    }
    const existing = sessions.get(req.name)
    if (!existing || existing.exited) {
      if (existing?.exited) sessions.delete(req.name)
      throw new Error(`no existing session '${req.name}'`)
    }
    if (req.expectedGeneration && req.expectedGeneration !== existing.generation) {
      throw new Error(`session '${req.name}' was replaced by a different generation`)
    }
    cancelGraceExit()
    existing.subscribers.add(socket)
    const screen = existing.term.serialize()
    log(`attach-existing name=${req.name} subscribers=${existing.subscribers.size}`)
    return {
      fresh: false,
      screen: screen || undefined,
      generation: existing.generation,
      launchDialect: existing.launchDialect
    }
  }

  async function handleKill(
    name: string,
    operationId: string,
    expectedGeneration: string | undefined,
    reserveReplacement: boolean
  ): Promise<KillSessionResult> {
    validateKillOperationId(operationId)
    pruneCompletedKills()
    const completed = completedKillIds.get(operationId)
    if (completed) {
      if (completed.name !== name) throw new Error('kill operation id belongs to another session')
      if (completed.reserveReplacement !== reserveReplacement) {
        throw new Error('kill operation retry changed replacement mode')
      }
      if (completed.expectedGeneration !== expectedGeneration) {
        throw new Error('kill operation retry changed expected generation')
      }
      if (!reserveReplacement) return {}
      const current = sessions.get(name)
      if (current && !current.exited) {
        throw new Error(`session '${name}' was replaced by a different generation`)
      }
      const reservation = activeReplacementReservation(name)
      if (reservation && reservation.token !== operationId) {
        throw new Error(`session '${name}' is already restarting`)
      }
      // Refresh a same-operation reservation that expired while the client was uncertain.
      setReplacementReservation(name, operationId)
      return { replacementToken: operationId }
    }
    const byId = inProgressKillIds.get(operationId)
    if (byId) {
      if (byId.name !== name) throw new Error('kill operation id belongs to another session')
      if (byId.operation.reserveReplacement !== reserveReplacement) {
        throw new Error('kill operation retry changed replacement mode')
      }
      if (byId.operation.expectedGeneration !== expectedGeneration) {
        throw new Error('kill operation retry changed expected generation')
      }
      return byId.operation.promise
    }

    const alreadyEnding = ending.get(name)
    if (alreadyEnding) {
      // Only the same operation id is a retry. A second client must not join the destructive
      // operation and then falsely believe its own id owns the single replacement reservation.
      throw new Error(`session '${name}' is already restarting`)
    }

    const session = sessions.get(name)
    if (!session || session.exited) {
      const reservation = activeReplacementReservation(name)
      if (reserveReplacement && reservation && reservation.token !== operationId) {
        throw new Error(`session '${name}' is already restarting`)
      }
      if (reserveReplacement) setReplacementReservation(name, operationId)
      rememberCompletedKill(operationId, name, reserveReplacement, expectedGeneration)
      return { replacementToken: reserveReplacement ? operationId : undefined }
    }
    if (expectedGeneration === undefined) {
      // In v2, undefined after the client's immediate probe is an explicit expected-absence
      // observation, not name-only permission. A later generation is outside this operation even
      // after the completed-op cache expires: generic delete confirms its observed target was
      // already absent; a requested lease rejects because another app won the name.
      if (reserveReplacement) {
        throw new Error(`session '${name}' became live before its replacement lease was acquired`)
      }
      rememberCompletedKill(operationId, name, false, undefined)
      return {}
    }
    if (expectedGeneration !== undefined && expectedGeneration !== session.generation) {
      // A different opaque generation confirms the requested process is already gone, but that
      // live replacement belongs to somebody else and must not be reserved or terminated.
      if (reserveReplacement) {
        throw new Error(`session '${name}' was replaced by a different generation`)
      }
      rememberCompletedKill(operationId, name, false, expectedGeneration)
      return {}
    }

    let resolve!: (result: KillSessionResult) => void
    let reject!: (error: Error) => void
    const promise = new Promise<KillSessionResult>((done, fail) => {
      resolve = done
      reject = fail
    })
    const operation: EndingOperation = {
      session,
      promise,
      resolve,
      reject,
      operationIds: new Set([operationId]),
      reserveReplacement,
      expectedGeneration
    }
    // Store before either termination mechanism: node-pty may emit onExit synchronously.
    ending.set(name, operation)
    inProgressKillIds.set(operationId, { name, operation })

    const failOperation = (error: unknown): void => {
      if (ending.get(name) !== operation) return // real exit already confirmed and resolved it
      ending.delete(name)
      for (const id of operation.operationIds) inProgressKillIds.delete(id)
      operation.reject(error instanceof Error ? error : new Error(String(error)))
    }

    if (process.platform === 'win32') {
      // node-pty defers WindowsTerminal.kill() until first output. taskkill owns the process tree
      // independently, then endSession acknowledges only after the PID is confirmed absent.
      void terminateWindowsProcessTree(session.proc.pid).then(
        () => {
          if (sessions.get(name) !== session || session.exited) return
          try {
            session.releaseWindowsPtyAfterExternalTreeKill()
            // No manual endSession here. Closing the ConPTY handle must produce node-pty's real
            // onExit, which is the proof that shell descendants *and* host-parented conhost are
            // gone. If it never arrives, the client times out uncertain instead of receiving a
            // false destructive acknowledgement.
          } catch (error) {
            log(`ConPTY release failed name=${name}: ${String(error)}`)
            failOperation(new Error('session-host could not confirm terminal process termination'))
          }
        },
        (error) => {
          log(`process-tree termination failed name=${name}: ${String(error)}`)
          failOperation(new Error('session-host could not confirm terminal process termination'))
        }
      )
    } else {
      try {
        session.proc.kill()
      } catch (error) {
        failOperation(error)
      }
    }
    return promise
  }

  async function dispatch(
    req: SessionHostRequest,
    socket: net.Socket,
    clientProtocolVersion: 1 | 2
  ): Promise<{ ok: true; result?: unknown } | { ok: false; error: string }> {
    switch (req.cmd) {
      case 'attach':
        return { ok: true, result: await handleAttach(req, socket) }
      case 'attachExisting':
        if (clientProtocolVersion === 1) {
          return { ok: false, error: 'attachExisting requires session-host protocol v2' }
        }
        return { ok: true, result: handleAttachExisting(req, socket) }
      case 'hasSession':
        {
          const session = sessions.get(req.name)
          const result: HasSessionResult =
            session && !session.exited
              ? { exists: true, generation: session.generation }
              : { exists: false }
          return {
            ok: true,
            result
          }
        }
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
        s.term.resize(req.cols, req.rows)
        return { ok: true }
      }
      case 'pause': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        try {
          s.proc.pause()
        } catch {
          /* already exited */
        }
        return { ok: true }
      }
      case 'resume': {
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        try {
          s.proc.resume()
        } catch {
          /* already exited */
        }
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
        const text = s.term.serialize(req.full ? undefined : 200)
        return { ok: true, result: { text } satisfies CaptureResult }
      }
      case 'executeLaunch': {
        if (clientProtocolVersion === 1) {
          return { ok: false, error: 'opaque launch requires session-host protocol v2' }
        }
        const s = sessions.get(req.name)
        if (!s || s.exited) return { ok: false, error: 'no such session' }
        if (req.generation !== s.generation) {
          return { ok: false, error: `session '${req.name}' was replaced by another generation` }
        }
        const result = await s.executeLaunch(
          req.launchId,
          req.command,
          req.stdinAfterStart,
          () => launchProcessReady(s)
        )
        return { ok: true, result }
      }
      case 'killSession': {
        // Do not acknowledge merely because kill() was requested. The per-name promise resolves
        // only when the real node-pty onExit path has removed/disposed the generation. A retry on
        // another socket coalesces here, and a retry after completion sees absence as success.
        const raw = req as Extract<SessionHostRequest, { cmd: 'killSession' }> & {
          operationId?: unknown
          expectedGeneration?: unknown
          reserveReplacement?: unknown
        }
        if (clientProtocolVersion === 1 && raw.reserveReplacement === true) {
          return { ok: false, error: 'replacement reservation requires session-host protocol v2' }
        }
        const operationId =
          clientProtocolVersion === 2 && typeof raw.operationId === 'string'
            ? raw.operationId
            : crypto.randomUUID()
        const expectedGeneration =
          clientProtocolVersion === 2 && typeof raw.expectedGeneration === 'string'
            ? raw.expectedGeneration
            : sessions.get(req.name)?.generation
        const reserveReplacement =
          clientProtocolVersion === 2 && raw.reserveReplacement === true
        const result = await handleKill(
          req.name,
          operationId,
          expectedGeneration,
          reserveReplacement
        )
        return { ok: true, result }
      }
      case 'detach': {
        sessions.get(req.name)?.subscribers.delete(socket)
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
    let clientProtocolVersion: 1 | 2 | null = null
    const framer = new LineFramer()
    socket.on('data', (chunk: Buffer) => {
      const frames = framer.push<SessionHostRequest>(chunk.toString('utf8'))
      for (const req of frames) {
        if (!authed) {
          const requestedVersion =
            req.cmd === 'hello'
              ? (req as { protocolVersion?: unknown }).protocolVersion
              : undefined
          if (
            req.cmd === 'hello' &&
            req.token === token &&
            (requestedVersion === undefined ||
              requestedVersion === 1 ||
              requestedVersion === currentProtocolVersion())
          ) {
            authed = true
            clientProtocolVersion =
              requestedVersion === undefined || requestedVersion === 1 ? 1 : 2
            socket.write(
              encodeFrame(
                clientProtocolVersion === 1
                  ? { id: req.id, ok: true }
                  : {
                      id: req.id,
                      ok: true,
                      result: { protocolVersion: currentProtocolVersion() }
                    }
              )
            )
          } else {
            const error =
              req.cmd === 'hello' && req.token === token
                ? `incompatible session-host protocol: expected ${currentProtocolVersion()}`
                : 'unauthorized'
            socket.write(encodeFrame({ id: req.id, ok: false, error }))
            socket.destroy()
          }
          continue
        }
        if (req.cmd === 'hello') {
          socket.write(
            encodeFrame(
              clientProtocolVersion === 1
                ? { id: req.id, ok: true }
                : {
                    id: req.id,
                    ok: true,
                    result: { protocolVersion: currentProtocolVersion() }
                  }
            )
          )
          continue
        }
        void dispatch(req, socket, clientProtocolVersion ?? 1)
          .then((res) => socket.write(encodeFrame({ id: req.id, ...res })))
          .catch((e) =>
            socket.write(
              encodeFrame({
                id: req.id,
                ok: false,
                error: e instanceof Error ? e.message : String(e)
              })
            )
          )
      }
    })
    socket.on('close', () => {
      // A connection dropping is a DETACH, never a kill — sessions belong to the host, not to
      // any one connection. Mirrors tmux: closing a client's terminal only ends that client.
      for (const session of sessions.values()) session.subscribers.delete(socket)
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
    const tmp = `${paths.statePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, paths.statePath) // atomic: replaces the empty startup-lock file
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
