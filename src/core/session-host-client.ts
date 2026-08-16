// The Electron-main-side client for the session host: one long-lived connection per app process,
// auto-spawning the host on first use (session-host-launcher.ts) and reconnecting transparently
// if the connection drops while the host itself keeps running (a client disconnect is NEVER a
// reason to think a session died — see docs/windows-session-host.md).
//
// src/core is Electron-free (see no-electron.test.ts); this file imports only `net`/`fs`/`crypto`
// and the pure protocol/paths modules under src/session-host — no `electron`, no `../main/*`.

import fs from 'fs'
import net from 'net'
import { randomUUID } from 'crypto'
import { sessionHostPaths } from '../session-host/paths'
import {
  LineFramer,
  SESSION_HOST_PROTOCOL_VERSION,
  encodeFrame,
  type SessionHostRequest,
  type SessionHostRequestBody,
  type SessionHostFrame,
  type SessionHostSpawnOptions,
  type AttachResult,
  type HasSessionResult,
  type PaneCommandResult,
  type CaptureResult,
  type KillSessionResult,
  type ExecuteLaunchResult,
  type ListSessionsResult
} from '../session-host/protocol'
import { resolveSessionHostScript, spawnSessionHost } from './session-host-launcher'

export interface SessionSubscriber {
  onData(data: string): void
  onExit(exitCode: number): void
  /** A previously-confirmed attachment failed to re-establish after reconnect. Unlike an exit,
   * this preserves the host's exact rejection reason so the owning manager can retire the local
   * generation and surface an actionable error without guessing that the process ended. */
  onAttachError?(error: Error): void
}

type PendingEntry = {
  resolve: (v: { ok: true; result?: unknown }) => void
  reject: (e: Error) => void
}

type AttachMemory =
  | {
      kind: 'attach'
      spawn: SessionHostSpawnOptions
      scrollback: number
      confirmed: boolean
      generation?: string
      protocolVersion?: 1 | 2
    }
  | {
      kind: 'existing'
      confirmed: boolean
      generation?: string
      protocolVersion?: 1 | 2
    }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function isTransportUncertainty(value: unknown): boolean {
  const error = toError(value) as NodeJS.ErrnoException
  if (
    error.code === 'ECONNRESET' ||
    error.code === 'EPIPE' ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ERR_STREAM_DESTROYED'
  ) {
    return true
  }
  return (
    error.message.includes('session-host connection lost') ||
    error.message.includes('session-host: no reply') ||
    error.message.includes('socket')
  )
}

/** A live authenticated legacy host is intentionally kept alive so its existing terminals remain
 * attachable. Operations that require protocol-v2 atomicity fail with this typed, renderer-safe
 * error instead of replacing that host or leaking a private spawn plan onto the legacy wire. */
export class SessionHostProtocolCompatibilityError extends Error {
  readonly code = 'SESSION_HOST_PROTOCOL_INCOMPATIBLE'

  constructor(operation: string) {
    super(
      `The persistent terminal host is from an older nodeterm version and cannot ${operation}. ` +
        'Existing terminals remain attachable; close them and let the legacy host exit before ' +
        'starting or restarting a Windows terminal.'
    )
    this.name = 'SessionHostProtocolCompatibilityError'
  }
}

function requireAttachResult(
  result: AttachResult | undefined,
  name: string,
  protocolVersion: 1 | 2
): AttachResult {
  if (!result || typeof result.fresh !== 'boolean') {
    throw new Error(`session-host returned an invalid attachment result for '${name}'`)
  }
  if (
    protocolVersion === 2 &&
    (typeof result.generation !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(result.generation))
  ) {
    throw new Error(`session-host returned no generation for attachment '${name}'`)
  }
  return result
}

function legacyWarmOnlySentinel(userDataDir: string): SessionHostSpawnOptions {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  return {
    cwd: userDataDir,
    shell: process.execPath,
    args: ['-e', 'process.stdout.write("nodeterm legacy warm-only sentinel\\n")'],
    env,
    cols: 1,
    rows: 1
  }
}

/**
 * Everything a live client needs to know about ONE connection attempt. Recreated on every
 * (re)connect; `SessionHostClient` itself outlives any single socket.
 */
/** How long a single request may go unanswered before it is treated as a dead host.
 *
 *  Generous on purpose: the slowest legitimate request is an attach that has to SPAWN a shell on
 *  a cold, contended Windows machine, and killing that early would turn a slow terminal into a
 *  broken one. Ten seconds is far past that and far short of "the user thinks it is frozen". */
const REQUEST_TIMEOUT_MS = 10_000
const HANDSHAKE_TIMEOUT_MS = 2_000
const KILL_CONFIRMATION_ATTEMPTS = 2

export class SessionHostClient {
  private socket: net.Socket | null = null
  private negotiatedProtocolVersion: 1 | 2 | null = null
  private nextId = 1
  private pending = new Map<number, PendingEntry>()
  /** Local (in-process) subscribers per session name — the client-side half of co-attach. Several
   *  `SessionHostPty` instances (e.g. the canvas node AND the relay host's detached pty for the
   *  same node) may each hold one entry here; the LAST one leaving is what tells the host `detach`. */
  private subs = new Map<string, Set<SessionSubscriber>>()
  /** What to replay if the connection drops and comes back — spawn options are cheap to keep and
   *  this is the only way a reconnect can re-attach without the caller doing anything. */
  private attachMemory = new Map<string, AttachMemory>()
  private sessionGenerations = new Map<string, string>()
  /** A destructive request must become a replay barrier before its first write. If the host
   * kills the process and its reply is lost, reconnect must not use stale attach options to
   * recreate that same process before the idempotent kill retry can be confirmed. */
  private killReplayBarriers = new Set<string>()
  private killsInFlight = new Map<string, Promise<void>>()
  /** Retained after a bounded uncertain result so a later explicit retry asks about the same
   * destructive operation rather than targeting a newer same-name generation. */
  private killOperations = new Map<
    string,
    {
      operationId: string
      expectedGeneration?: string
      reserveReplacement: boolean
      requireV2: boolean
      expectedAbsent: boolean
      prepared?: boolean
    }
  >()
  private replacementTokens = new Map<string, string>()
  private connecting: Promise<void> | null = null
  private everConnected = false

  constructor(
    private readonly deps: {
      userDataDir: string
      resourcesPath?: string | null
      repoRoot?: string | null
    }
  ) {}

  /** Is a real, tested backend selectable on this machine at all? Session-host has no external
   *  binary dependency (unlike tmux), so this is really "was the bundle built" — false only in a
   *  dev checkout that never ran `npm run host:build` / `npm run build`. */
  bundleAvailable(): boolean {
    return (
      resolveSessionHostScript({
        resourcesPath: this.deps.resourcesPath,
        repoRoot: this.deps.repoRoot
      }) !== null
    )
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    if (this.connecting) return this.connecting
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    const wasConnectedBefore = this.everConnected
    if (await this.tryConnectOnce()) {
      if (wasConnectedBefore) void this.replayAttachesAfterReconnect()
      return
    }
    const script = resolveSessionHostScript({
      resourcesPath: this.deps.resourcesPath,
      repoRoot: this.deps.repoRoot
    })
    if (!script) {
      throw new Error(
        'session-host bundle not found (out/session-host/host.cjs is missing — run `npm run host:build`, ' +
          'or `npm run build` which now runs it too)'
      )
    }
    spawnSessionHost(script, this.deps.userDataDir)
    // Bounded poll for the freshly-spawned host to bind and write its token — startup is a
    // `net.createServer().listen()` plus two small file writes, so this is generous, not tuned.
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(150)
      if (await this.tryConnectOnce()) {
        if (wasConnectedBefore) void this.replayAttachesAfterReconnect()
        return
      }
    }
    throw new Error('session-host did not come up in time')
  }

  private tryConnectOnce(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const paths = sessionHostPaths(this.deps.userDataDir)
      let token: string
      try {
        token = fs.readFileSync(paths.tokenPath, 'utf8').trim()
      } catch (error) {
        // Absence means "no host to connect to yet". A failed read is not absence: treating an
        // unreadable/corrupt token as a missing host would spawn a competitor and hide the fault.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') resolve(false)
        else reject(error)
        return
      }
      if (!token) {
        reject(new Error(`session-host token is empty or whitespace-only: ${paths.tokenPath}`))
        return
      }
      let settled = false
      let connected = false
      const socket = net.connect(paths.endpoint)
      socket.unref?.() // never keep the app process alive on our account
      const framer = new LineFramer()
      let helloId: number | null = null
      let protocolVersion: 1 | 2 | null = null
      const thisClient = this

      function onHandshakeError(error: Error): void {
        const code = (error as NodeJS.ErrnoException).code
        // Only a refusal before connect proves that there is no host to authenticate. Once a
        // socket connected, any error is protocol/transport uncertainty and must keep its cause.
        if (!connected && (code === 'ENOENT' || code === 'ECONNREFUSED')) finish(false)
        else finish(false, error)
      }

      function onHandshakeClose(): void {
        if (!connected) finish(false)
        else finish(false, new Error('session-host connection closed before hello completed'))
      }

      function onHandshakeConnect(): void {
        connected = true
        helloId = thisClient.nextId++
        socket.write(
          encodeFrame({
            id: helloId,
            cmd: 'hello',
            token,
            protocolVersion: SESSION_HOST_PROTOCOL_VERSION
          }),
          (error) => {
            if (error) finish(false, error)
          }
        )
      }

      function onHandshakeData(chunk: Buffer): void {
        for (const frame of framer.push<{
          id: number
          ok?: boolean
          error?: unknown
          result?: unknown
        }>(chunk.toString('utf8'))) {
          // Authentication is a correlated request, not the first optimistic frame on the socket.
          if (frame.id !== helloId) continue
          if (frame.ok === true) {
            const version = (frame.result as { protocolVersion?: unknown } | undefined)
              ?.protocolVersion
            if (version === undefined) {
              // Authenticated protocol-v1 hosts predate the result metadata. Keep them alive for
              // warm continuity; v2-only destructive/replacement operations fail closed later.
              protocolVersion = 1
              finish(true)
            } else if (version === SESSION_HOST_PROTOCOL_VERSION) {
              protocolVersion = 2
              finish(true)
            } else {
              finish(
                false,
                new Error(
                  `session-host protocol is incompatible: expected version ` +
                    `${SESSION_HOST_PROTOCOL_VERSION}, received ${String(version ?? 'none')}`
                  )
              )
            }
          }
          else if (frame.ok === false) {
            finish(
              false,
              new Error(
                typeof frame.error === 'string' && frame.error
                  ? frame.error
                  : 'session-host rejected hello without a reason'
              )
            )
          } else {
            finish(false, new Error('session-host returned an invalid correlated hello response'))
          }
          return
        }
      }

      const finish = (ok: boolean, error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // Remove only listeners installed by this handshake. Broad data-listener cleanup can
        // delete the production listener installed during the ownership hand-off below.
        socket.removeListener('connect', onHandshakeConnect)
        socket.removeListener('data', onHandshakeData)
        socket.removeListener('error', onHandshakeError)
        socket.removeListener('close', onHandshakeClose)
        if (ok) {
          // Hand the socket over before resolving: the continuation may issue `attach` immediately.
          this.attachSocket(socket, protocolVersion ?? 1)
        } else {
          try {
            socket.destroy()
          } catch {
            /* already gone */
          }
        }
        if (error) reject(error)
        else resolve(ok)
      }
      const timer = setTimeout(() => {
        if (!connected) finish(false)
        else {
          finish(
            false,
            new Error(`session-host hello timed out after ${HANDSHAKE_TIMEOUT_MS}ms`)
          )
        }
      }, HANDSHAKE_TIMEOUT_MS)
      socket.once('error', onHandshakeError)
      socket.once('close', onHandshakeClose)
      socket.once('connect', onHandshakeConnect)
      socket.on('data', onHandshakeData)
    })
  }

  private attachSocket(socket: net.Socket, protocolVersion: 1 | 2): void {
    this.socket = socket
    this.negotiatedProtocolVersion = protocolVersion
    this.everConnected = true
    const framer = new LineFramer()
    socket.on('data', (chunk: Buffer) => {
      // A retired socket can still deliver a buffered final chunk. Never parse it through mutable
      // current-connection state or let its name-only v1 events affect the replacement socket.
      if (this.socket !== socket) return
      for (const frame of framer.push<SessionHostFrame>(chunk.toString('utf8'))) {
        this.handleFrame(frame, protocolVersion)
      }
    })
    const onDrop = (): void => {
      this.retireSocket(socket, new Error('session-host connection lost'))
    }
    socket.once('close', onDrop)
    socket.once('error', onDrop)
  }

  private retireSocket(socket: net.Socket, error: Error): void {
    if (this.socket !== socket) return
    this.socket = null
    this.negotiatedProtocolVersion = null
    try {
      socket.destroy()
    } catch {
      /* already gone */
    }
    for (const [, entry] of this.pending) entry.reject(error)
    this.pending.clear()
    // Sessions live in the HOST, not here — a dropped connection does NOT mean a session died.
    // The next request reconnects lazily. Kill confirmation installs its replay barrier before
    // reaching this path, so reconnect can restore unrelated sessions without resurrecting it.
  }

  private handleFrame(frame: SessionHostFrame, protocolVersion: 1 | 2): void {
    if ('type' in frame) {
      const memory = this.attachMemory.get(frame.name)
      if (protocolVersion === 2) {
        if (
          typeof frame.generation !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(frame.generation)
        ) {
          return
        }
        const expectedGeneration =
          memory?.generation ??
          this.sessionGenerations.get(frame.name) ??
          this.killOperations.get(frame.name)?.expectedGeneration
        if (expectedGeneration && expectedGeneration !== frame.generation) return
        if (!expectedGeneration && memory && !memory.confirmed) {
          memory.generation = frame.generation
          this.sessionGenerations.set(frame.name, frame.generation)
        } else if (!expectedGeneration) {
          return
        }
      } else {
        if (memory?.protocolVersion === 2) return
        // Buffer/drop legacy events until attach proves it was warm. If the hasSession→attach
        // race lost, only the harmless short-lived sentinel exists and none of its output leaks.
        if (memory && !memory.confirmed) return
      }
      const set = this.subs.get(frame.name)
      if (!set) return
      if (frame.type === 'data') {
        for (const sub of set) sub.onData(frame.data)
      } else {
        for (const sub of set) sub.onExit(frame.exitCode)
        this.subs.delete(frame.name)
        this.attachMemory.delete(frame.name)
        this.sessionGenerations.delete(frame.name)
      }
      return
    }
    const entry = this.pending.get(frame.id)
    if (!entry) return
    this.pending.delete(frame.id)
    if (frame.ok) entry.resolve({ ok: true, result: frame.result })
    else entry.reject(new Error(frame.error))
  }

  /** Send one request and await its correlated response. Reconnects (spawning the host if needed)
   *  before every call — cheap once warm (`ensureConnected` is a no-op on a live socket). */
  private async request<T>(req: SessionHostRequestBody): Promise<T> {
    await this.ensureConnected()
    const socket = this.socket
    if (!socket) throw new Error('session-host: not connected')
    const id = this.nextId++
    const full = { id, ...req } as SessionHostRequest
    return new Promise<T>((resolve, reject) => {
      // A DEADLINE, because "never answers" was a real state and it was the worst possible one.
      //
      // This promise used to settle only on a reply or a failed write. Every other path left it
      // pending forever: a host that accepted the frame and went quiet, a reply lost to a framing
      // bug, a session-host wedged mid-spawn. `PtyManager.create` awaits this to learn a session's
      // real `fresh`, inside a try/catch — and a catch cannot help a promise that never settles.
      // So opening a terminal hung indefinitely, with no error anywhere, and the caller had no way
      // to tell that from a slow machine. Measured on Windows: 45 s and still pending, silent.
      //
      // Rejecting gives the caller the real failure boundary. A session-host create must fail
      // closed rather than return a plausible id whose writes can never reach a live process.
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(
          new Error(
            `session-host: no reply to '${req.cmd}' within ${REQUEST_TIMEOUT_MS}ms — the host is ` +
              'running but not answering'
          )
        )
      }, REQUEST_TIMEOUT_MS)
      timer.unref?.() // never hold the app process open on a pending request's account
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve((v.result ?? undefined) as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      try {
        socket.write(encodeFrame(full), (error) => {
          if (!error) return
          const current = this.pending.get(id)
          if (!current) return
          this.pending.delete(id)
          current.reject(error)
        })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  /**
   * Attach-or-create `name`, registering `sub` as a local subscriber of its `data`/`exit` push
   * frames. Remembers the spawn options so a later reconnect can replay this call transparently.
   */
  async attach(
    name: string,
    spawn: SessionHostSpawnOptions,
    scrollback: number,
    sub: SessionSubscriber
  ): Promise<AttachResult> {
    if (this.killReplayBarriers.has(name)) {
      throw new Error(
        `session-host: cannot attach '${name}' while its kill result is unconfirmed; ` +
          'retry the kill before creating or attaching a replacement'
      )
    }
    let set = this.subs.get(name)
    if (!set) {
      set = new Set()
      this.subs.set(name, set)
    }
    const added = !set.has(sub)
    set.add(sub)
    // Object identity lets this attempt roll itself back without overwriting the state of a
    // concurrent co-attach that installed newer options for the same session name.
    const previousMemory = this.attachMemory.get(name)
    const memory: AttachMemory = { kind: 'attach', spawn, scrollback, confirmed: false }
    this.attachMemory.set(name, memory)
    const replacementToken = this.replacementTokens.get(name)
    try {
      await this.ensureConnected()
      const protocolVersion = this.negotiatedProtocolVersion
      if (!protocolVersion) throw new Error('session-host: not connected')
      if (protocolVersion === 1) {
        throw new SessionHostProtocolCompatibilityError(`create terminal '${name}'`)
      }
      let response: AttachResult | undefined
      const attempts = replacementToken ? 2 : 1
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          response = await this.request<AttachResult>({
            cmd: 'attach',
            name,
            spawn,
            scrollback,
            replacementToken
          })
          break
        } catch (error) {
          if (!replacementToken || attempt + 1 >= attempts || !isTransportUncertainty(error)) {
            throw error
          }
          const socket = this.socket
          if (socket) {
            this.retireSocket(socket, new Error(`session-host connection reset to retry '${name}'`))
          }
        }
      }
      const result = requireAttachResult(response, name, protocolVersion)
      if (replacementToken && !result.fresh) {
        throw new Error(
          `session-host protocol violation: reserved replacement '${name}' was not fresh`
        )
      }
      if (replacementToken && result.fresh) {
        if (this.replacementTokens.get(name) === replacementToken) {
          this.replacementTokens.delete(name)
        }
        if (this.killOperations.get(name)?.operationId === replacementToken) {
          this.killOperations.delete(name)
        }
      }
      // Once any attach-or-create succeeds, reconnect is attach-only forever. Keeping spawn data
      // replayable would recreate a naturally-ended session using stale profile/cwd settings.
      memory.confirmed = true
      memory.generation = result.generation
      memory.protocolVersion = protocolVersion
      if (result.generation) this.sessionGenerations.set(name, result.generation)
      if (this.attachMemory.get(name) === memory) {
        this.attachMemory.set(name, {
          kind: 'existing',
          confirmed: true,
          generation: result.generation,
          protocolVersion
        })
      }
      return result
    } catch (error) {
      const current = this.subs.get(name)
      if (added && current) current.delete(sub)
      if (current?.size === 0) {
        this.subs.delete(name)
        if (this.attachMemory.get(name) === memory) this.attachMemory.delete(name)
      } else if (this.attachMemory.get(name) === memory && previousMemory) {
        // Restore the options belonging to the pre-existing attachment. A later concurrent
        // attempt wins when it has already replaced `memory`, so its state is never rolled back.
        this.attachMemory.set(name, previousMemory)
      }
      throw error
    }
  }

  /** Atomically attach to a session that the host has already confirmed exists. Unlike `attach`,
   * this request carries no spawn plan, so an exit between the manager's probe and this operation
   * rejects instead of recreating a shell with stale profile/cwd settings. */
  async attachExisting(name: string, sub: SessionSubscriber): Promise<AttachResult> {
    if (this.killReplayBarriers.has(name)) {
      throw new Error(
        `session-host: cannot attach '${name}' while its kill result is unconfirmed; ` +
          'retry the kill before creating or attaching a replacement'
      )
    }
    let set = this.subs.get(name)
    if (!set) {
      set = new Set()
      this.subs.set(name, set)
    }
    const added = !set.has(sub)
    set.add(sub)
    const previousMemory = this.attachMemory.get(name)
    const expectedGeneration = this.sessionGenerations.get(name)
    const memory: AttachMemory = {
      kind: 'existing',
      confirmed: false,
      generation: expectedGeneration
    }
    this.attachMemory.set(name, memory)
    try {
      await this.ensureConnected()
      const protocolVersion = this.negotiatedProtocolVersion
      if (!protocolVersion) throw new Error('session-host: not connected')
      memory.protocolVersion = protocolVersion
      const response =
        protocolVersion === 1
          ? await this.request<AttachResult>({
              cmd: 'attach',
              name,
              spawn: legacyWarmOnlySentinel(this.deps.userDataDir),
              scrollback: 1
            })
          : await this.request<AttachResult>({
              cmd: 'attachExisting',
              name,
              expectedGeneration
            })
      const result = requireAttachResult(
        response,
        name,
        protocolVersion
      )
      if (result.fresh) {
        throw new Error(
          protocolVersion === 1
            ? `legacy session-host lost '${name}' before warm attach; no requested shell was spawned`
            : `session-host protocol violation: attachExisting '${name}' reported a fresh session`
        )
      }
      memory.confirmed = true
      memory.generation = result.generation ?? expectedGeneration
      if (memory.generation) this.sessionGenerations.set(name, memory.generation)
      return result
    } catch (error) {
      const current = this.subs.get(name)
      if (added && current) current.delete(sub)
      if (current?.size === 0) {
        this.subs.delete(name)
        if (this.attachMemory.get(name) === memory) this.attachMemory.delete(name)
      } else if (this.attachMemory.get(name) === memory && previousMemory) {
        this.attachMemory.set(name, previousMemory)
      }
      throw error
    }
  }

  /** Stop delivering `name`'s frames to `sub`. When it was the LAST local subscriber, also tells
   *  the host so it stops writing to this (now uninterested) connection. Never kills the session. */
  unsubscribe(name: string, sub: SessionSubscriber): void {
    const set = this.subs.get(name)
    if (!set) return
    set.delete(sub)
    if (set.size === 0) {
      this.subs.delete(name)
      this.attachMemory.delete(name)
      // A detached generation is no longer authoritative. If another app later replaces this
      // name, a new user-initiated delete must probe and target the new generation rather than
      // treating this stale identity as proof that the delete succeeded.
      if (!this.killOperations.has(name)) this.sessionGenerations.delete(name)
      void this.request({ cmd: 'detach', name }).catch(() => {})
    }
  }

  /** After a reconnect, re-attach every name we still have local subscribers for (the new socket
   *  starts with an empty subscriber set at the host — see host.ts), and hand any returned screen
   *  to those subscribers as a synthetic repaint so their terminals catch up with whatever ran
   *  while the connection was down. A deliberately simpler cousin of the app's own `pty:resync`:
   *  it reuses the ordinary `onData` path rather than a dedicated resync channel, so it needs no
   *  changes anywhere above this file. */
  private async replayAttachesAfterReconnect(): Promise<void> {
    for (const [name, memory] of [...this.attachMemory]) {
      // A lost kill reply is maximally dangerous here: attach-or-create could resurrect the exact
      // old process that the host already killed. The kill path owns this name until confirmation.
      if (this.killReplayBarriers.has(name)) continue
      // The socket may drop while an initial attach is still awaiting its response. Only a
      // completed attachment is eligible for reconnect; an unconfirmed spawn plan is never.
      if (!memory.confirmed) continue
      const set = this.subs.get(name)
      if (!set || set.size === 0) continue
      try {
        const protocolVersion = this.negotiatedProtocolVersion
        if (!protocolVersion) throw new Error('session-host: not connected')
        if (memory.protocolVersion && memory.protocolVersion !== protocolVersion) {
          throw new Error(
            `session-host protocol changed while '${name}' was detached; warm replay is unsafe`
          )
        }
        const response =
          protocolVersion === 1
            ? await this.request<AttachResult>({
                cmd: 'attach',
                name,
                spawn: legacyWarmOnlySentinel(this.deps.userDataDir),
                scrollback: 1
              })
            : await this.request<AttachResult>({
                cmd: 'attachExisting',
                name,
                expectedGeneration: memory.generation
              })
        const result = requireAttachResult(
          response,
          name,
          protocolVersion
        )
        if (result.fresh) {
          throw new Error(
            protocolVersion === 1
              ? `legacy session-host lost '${name}' before warm replay; no requested shell was spawned`
              : `session-host protocol violation: attachExisting '${name}' reported a fresh session`
          )
        }
        // A newer attach attempt replaced this remembered object while the request was pending;
        // its state and subscribers own all later delivery/rollback decisions.
        if (this.attachMemory.get(name) !== memory || this.killReplayBarriers.has(name)) continue
        if (result.generation) {
          memory.generation = result.generation
          this.sessionGenerations.set(name, result.generation)
        }
        memory.protocolVersion = protocolVersion
        if (result.screen) {
          const repaint = '\x1b[2J\x1b[H' + result.screen
          for (const sub of this.subs.get(name) ?? []) sub.onData(repaint)
        }
      } catch (error) {
        if (
          this.attachMemory.get(name) !== memory ||
          this.killReplayBarriers.has(name)
        ) {
          continue
        }
        // Retire exactly the attachment whose replay failed. Keeping its local subscriber/memory
        // would claim persistence and repeatedly attempt attach-or-create despite a real host
        // rejection. The explicit callback retains the rejection reason without inventing exit.
        this.attachMemory.delete(name)
        if (
          !memory.generation ||
          this.sessionGenerations.get(name) === memory.generation
        ) {
          this.sessionGenerations.delete(name)
        }
        const failed = this.subs.get(name)
        this.subs.delete(name)
        const failure = toError(error)
        for (const sub of failed ?? []) {
          try {
            sub.onAttachError?.(failure)
          } catch {
            /* one owner callback must not hide the same failure from the remaining owners */
          }
        }
      }
    }
  }

  async hasSession(name: string): Promise<boolean> {
    await this.ensureConnected()
    const protocolVersion = this.negotiatedProtocolVersion
    if (!protocolVersion) throw new Error('session-host: not connected')
    const r = await this.request<HasSessionResult>({ cmd: 'hasSession', name })
    if (!r || typeof r.exists !== 'boolean') {
      throw new Error(`session-host returned an invalid existence result for '${name}'`)
    }
    if (r.exists) {
      if (protocolVersion === 2) {
        const generation = r.generation
        if (
          typeof generation !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(generation)
        ) {
          throw new Error(`session-host returned no generation for existing session '${name}'`)
        }
        this.sessionGenerations.set(name, generation)
      } else {
        this.sessionGenerations.delete(name)
      }
    } else {
      this.sessionGenerations.delete(name)
    }
    return r.exists
  }

  write(name: string, data: string): void {
    void this.request({ cmd: 'write', name, data }).catch(() => {})
  }

  resize(name: string, cols: number, rows: number): void {
    void this.request({ cmd: 'resize', name, cols, rows }).catch(() => {})
  }

  pause(name: string): void {
    void this.request({ cmd: 'pause', name }).catch(() => {})
  }

  resume(name: string): void {
    void this.request({ cmd: 'resume', name }).catch(() => {})
  }

  /** Background write — does not require an attached subscriber; the host looks the session up by
   *  name regardless (mirrors `sendText`'s tmux `send-keys -t <name>`, which needs no client). */
  async sendKeys(name: string, text: string, enter: boolean): Promise<boolean> {
    try {
      await this.request({ cmd: 'sendKeys', name, text, enter })
      return true
    } catch {
      return false
    }
  }

  async paneCommand(name: string): Promise<string | null> {
    try {
      const r = await this.request<PaneCommandResult>({ cmd: 'paneCommand', name })
      return r.command
    } catch {
      return null
    }
  }

  async capture(name: string, full: boolean): Promise<string> {
    // Empty output is a confirmed capture result. A rejected request is unknown and must remain a
    // failure so the snapshot loop retains its dirty bit and retries.
    const r = await this.request<CaptureResult>({ cmd: 'capture', name, full })
    return r.text
  }

  async executeLaunch(
    name: string,
    launchId: string,
    plan: { command: string; stdinAfterStart?: string }
  ): Promise<ExecuteLaunchResult> {
    await this.ensureConnected()
    const protocolVersion = this.negotiatedProtocolVersion
    if (protocolVersion !== 2) {
      throw new SessionHostProtocolCompatibilityError(`launch an agent in terminal '${name}'`)
    }
    const generation = this.sessionGenerations.get(name)
    if (!generation) throw new Error(`session-host has no confirmed generation for '${name}'`)
    const result = await this.request<ExecuteLaunchResult>({
      cmd: 'executeLaunch',
      name,
      generation,
      launchId,
      command: plan.command,
      ...(plan.stdinAfterStart !== undefined ? { stdinAfterStart: plan.stdinAfterStart } : {})
    })
    if (
      !result ||
      (result.status !== 'executed' && result.status !== 'already-executed')
    ) {
      throw new Error(`session-host returned an invalid launch result for '${name}'`)
    }
    return result
  }

  async killSession(
    name: string,
    options: {
      reserveReplacement?: boolean
      requireV2?: boolean
      expectedAbsent?: boolean
    } = {}
  ): Promise<void> {
    const reserveReplacement = options.reserveReplacement === true
    const requireV2 = options.requireV2 === true
    const expectedAbsent = options.expectedAbsent === true
    if (expectedAbsent && !reserveReplacement) {
      throw new Error('session-host expected-absent mode requires a replacement reservation')
    }
    const knownIdentity = this.killOperations.get(name)
    if (
      knownIdentity &&
      (knownIdentity.reserveReplacement !== reserveReplacement ||
        knownIdentity.requireV2 !== requireV2 ||
        knownIdentity.expectedAbsent !== expectedAbsent)
    ) {
      throw new Error(
        `session-host: kill retry mode changed for '${name}'; retry with ` +
          `reserveReplacement=${String(knownIdentity.reserveReplacement)} and ` +
          `requireV2=${String(knownIdentity.requireV2)} and ` +
          `expectedAbsent=${String(knownIdentity.expectedAbsent)}`
      )
    }
    const active = this.killsInFlight.get(name)
    if (active) return active

    // Install the barrier before the first write. The host may complete the kill and lose its
    // reply; without this ordering, reconnect's attach-or-create replay resurrects the old shell.
    this.killReplayBarriers.add(name)
    const memory = this.attachMemory.get(name)
    const identity = knownIdentity ?? {
      operationId: randomUUID(),
      expectedGeneration: this.sessionGenerations.get(name) ?? memory?.generation,
      reserveReplacement,
      requireV2,
      expectedAbsent
    }
    this.killOperations.set(name, identity)
    let operation!: Promise<void>
    operation = this.prepareAndConfirmKillSession(name, identity)
      .catch((error) => {
        // Compatibility/probe failures happen before a destructive frame exists. Roll the local
        // barrier back so a live attachment is not stranded behind an operation the host never
        // saw. Once confirmKillSession starts, it deliberately retains identity/barrier on doubt.
        if (this.killOperations.get(name) === identity && identity.prepared !== true) {
          this.killOperations.delete(name)
          this.killReplayBarriers.delete(name)
        }
        throw error
      })
      .finally(() => {
        if (this.killsInFlight.get(name) === operation) this.killsInFlight.delete(name)
      })
    this.killsInFlight.set(name, operation)
    return operation
  }

  private async prepareAndConfirmKillSession(
    name: string,
    identity: {
      operationId: string
      expectedGeneration?: string
      reserveReplacement: boolean
      requireV2: boolean
      expectedAbsent: boolean
      prepared?: boolean
    }
  ): Promise<void> {
    await this.ensureConnected()
    const protocolVersion = this.negotiatedProtocolVersion
    if (!protocolVersion) throw new Error('session-host: not connected')
    if (protocolVersion === 1 && (identity.reserveReplacement || identity.requireV2)) {
      throw new SessionHostProtocolCompatibilityError(`restart terminal '${name}'`)
    }

    // With no live authoritative attachment, determine the exact current generation immediately
    // before creating this destructive operation. An uncertain prior operation skips this probe
    // because its original operationId/generation is precisely what makes retry ABA-safe.
    if (protocolVersion === 2 && !identity.expectedGeneration && !identity.expectedAbsent) {
      const result = await this.request<HasSessionResult>({ cmd: 'hasSession', name })
      if (!result || typeof result.exists !== 'boolean') {
        throw new Error(`session-host returned an invalid existence result for '${name}'`)
      }
      if (result.exists) {
        const generation = result.generation
        if (
          typeof generation !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(generation)
        ) {
          throw new Error(`session-host returned no generation for existing session '${name}'`)
        }
        identity.expectedGeneration = generation
        this.sessionGenerations.set(name, generation)
      }
    }

    identity.prepared = true
    await this.confirmKillSession(
      name,
      identity.operationId,
        identity.expectedGeneration,
      identity.reserveReplacement,
      identity.requireV2
    )
  }

  private async confirmKillSession(
    name: string,
    operationId: string,
    expectedGeneration: string | undefined,
    reserveReplacement: boolean,
    requireV2: boolean
  ): Promise<void> {
    let lastError = new Error('session-host kill did not run')
    for (let attempt = 0; attempt < KILL_CONFIRMATION_ATTEMPTS; attempt++) {
      try {
        await this.ensureConnected()
        const protocolVersion = this.negotiatedProtocolVersion
        if (!protocolVersion) throw new Error('session-host: not connected')
        if (protocolVersion === 1 && (reserveReplacement || requireV2)) {
          throw new SessionHostProtocolCompatibilityError(`restart terminal '${name}'`)
        }
        // The host defines missing as success and coalesces an in-progress kill by name. Resending
        // after reconnect is therefore the confirmation operation for both "reply lost after
        // kill" and "first write never reached the host".
        const result = await this.request<KillSessionResult>({
          cmd: 'killSession',
          name,
          operationId,
          expectedGeneration,
          reserveReplacement
        })
        if (protocolVersion === 2 && (!result || typeof result !== 'object')) {
          throw new Error(`session-host returned an invalid kill result for '${name}'`)
        }
        if (reserveReplacement) {
          if (result?.replacementToken !== operationId) {
            throw new Error(
              `session-host did not confirm the replacement reservation for '${name}'`
            )
          }
          this.replacementTokens.set(name, result.replacementToken)
        } else {
          if (result?.replacementToken) {
            throw new Error(
              `session-host returned an unexpected replacement reservation for '${name}'`
            )
          }
          this.replacementTokens.delete(name)
        }
        this.subs.delete(name)
        this.attachMemory.delete(name)
        this.sessionGenerations.delete(name)
        this.killReplayBarriers.delete(name)
        if (!reserveReplacement && this.killOperations.get(name)?.operationId === operationId) {
          this.killOperations.delete(name)
        }
        return
      } catch (error) {
        lastError = toError(error)
        if (attempt + 1 < KILL_CONFIRMATION_ATTEMPTS) {
          // A timeout or explicit error can leave an apparently-live socket behind. Force the
          // retry through a fresh authenticated connection; target replay remains barred while
          // unrelated attachments are eligible for ordinary reconnect replay.
          const socket = this.socket
          if (socket) {
            this.retireSocket(
              socket,
              new Error(`session-host connection reset to retry kill '${name}'`)
            )
          }
        }
      }
    }

    // Preserve subscribers/memory as evidence of the uncertain generation, but never replay it.
    // A later explicit killSession(name) starts a fresh bounded confirmation pass and can clear
    // this barrier once the idempotent host operation answers.
    throw new Error(
      `session-host: kill of '${name}' remains unconfirmed after ` +
        `${KILL_CONFIRMATION_ATTEMPTS} attempts; attach replay is suspended to prevent recreating ` +
        `the old process. Retry the kill before starting a replacement. Last error: ${lastError.message}`
    )
  }

  async listSessions(): Promise<string[]> {
    try {
      const r = await this.request<ListSessionsResult>({ cmd: 'listSessions' })
      return r.names
    } catch {
      return []
    }
  }
}
