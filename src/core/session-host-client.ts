// The Electron-main-side client for the session host: one long-lived connection per app process,
// auto-spawning the host on first use and restoring every live local attachment before allowing
// ordinary traffic through a replacement connection.

import net from 'net'
import { randomUUID } from 'crypto'
import { sessionHostPaths } from '../session-host/paths'
import { readExistingSessionHostIdentity } from '../session-host/existing-host-state'
import {
  SESSION_HOST_PROTOCOL_VERSION,
  LineFramer,
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
  /** A previously confirmed attachment failed to restore. This is not an exit: the host's
   * rejection is retained so the owning manager can retire only the affected generation. */
  onAttachError?(error: Error): void
}

export const SESSION_HOST_REQUEST_TIMEOUT_MS = 10_000

const RECONNECT_DELAYS_MS = [50, 100, 250, 500, 1_000, 2_000] as const
const RECONNECT_REPAINT_PREFIX = '\x1b[3J\x1b[2J\x1b[H'
const HANDSHAKE_TIMEOUT_MS = 2_000
const KILL_CONFIRMATION_ATTEMPTS = 2

type PendingEntry = {
  socket: net.Socket
  timer: ReturnType<typeof setTimeout> | null
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

type SubscriberEntry = {
  sub: SessionSubscriber
  /** Present only on a cold create request. Warm reconnect and attachExisting deliberately carry
   * no spawn plan, so a stale profile can never recreate an exited generation. */
  spawn?: SessionHostSpawnOptions
  scrollback: number
  phase: 'attaching' | 'attached'
}

type BufferedFrame = {
  data: string
  /** Entry identity, not merely the callback object: an unsubscribe/re-attach using the same
   * object must not inherit bytes that belonged to its retired registration. */
  recipients: Set<SubscriberEntry>
}

type TerminalSize = { cols: number; rows: number }

type ClientSessionState = {
  name: string
  generation?: string
  protocolVersion?: 1 | 2
  entries: Map<SessionSubscriber, SubscriberEntry>
  pauseOwners: Set<SessionSubscriber>
  sizeClaims: Map<SessionSubscriber, TerminalSize>
  bufferedData: BufferedFrame[]
  /** Attaches that have actually reached their request phase. Only these may own data arriving
   * before the correlated attach response; a merely queued replacement must not absorb bytes
   * from the generation whose detach/kill still precedes it in the name lane. */
  preAckEntries: Set<SubscriberEntry>
  /** An exit can race the correlated attach response in the same socket turn. Remember it so the
   * response cannot promote a process generation the host has already retired. */
  preAckExit: boolean
  /** True after the last local pause owner leaves, until a host acknowledgement makes flowing
   *  certain again. Data that raced the acknowledgement is retained behind this gate. */
  releasePending: boolean
  appliedSocket: net.Socket | null
  appliedAttached: boolean
  appliedPaused: boolean
  appliedSize: TerminalSize | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isTransportUncertainty(value: unknown): boolean {
  const error = asError(value) as NodeJS.ErrnoException
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
    error.message.includes('session-host request timed out') ||
    error.message.includes('socket')
  )
}

/** Protocol-v1 hosts stay alive for warm terminal continuity. Operations that need atomic
 * generation or replacement semantics fail closed without replacing that live host. */
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

function sameSize(left: TerminalSize | null, right: TerminalSize): boolean {
  return left?.cols === right.cols && left.rows === right.rows
}

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

export class SessionHostClient {
  private socket: net.Socket | null = null
  private negotiatedProtocolVersion: 1 | 2 | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingEntry>()
  private readonly sessions = new Map<string, ClientSessionState>()
  /** Survives state replacement. Cleanup invoked for an old generation always stays ahead of a
   * later same-name attach, even after the old state has left `sessions`. */
  private readonly nameTails = new Map<string, Promise<void>>()
  private readonly sessionGenerations = new Map<string, string>()
  /** Installed before the first destructive write so reconnect restoration cannot resurrect an
   * old generation whose kill reply may have been lost. */
  private readonly killReplayBarriers = new Set<string>()
  private readonly killsInFlight = new Map<string, Promise<void>>()
  private readonly killOperations = new Map<
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
  private readonly replacementTokens = new Map<string, string>()
  private connecting: Promise<void> | null = null
  private everConnected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0

  constructor(
    private readonly deps: {
      userDataDir: string
      resourcesPath?: string | null
      repoRoot?: string | null
    }
  ) {}

  bundleAvailable(): boolean {
    return (
      resolveSessionHostScript({
        resourcesPath: this.deps.resourcesPath,
        repoRoot: this.deps.repoRoot
      }) !== null
    )
  }

  private newState(name: string): ClientSessionState {
    return {
      name,
      entries: new Map(),
      pauseOwners: new Set(),
      sizeClaims: new Map(),
      bufferedData: [],
      preAckEntries: new Set(),
      preAckExit: false,
      releasePending: false,
      appliedSocket: null,
      appliedAttached: false,
      appliedPaused: false,
      appliedSize: null
    }
  }

  private enqueueState<T>(state: ClientSessionState, task: () => Promise<T>): Promise<T> {
    return this.enqueueName(state.name, task)
  }

  private enqueueName<T>(name: string, task: () => Promise<T>): Promise<T> {
    const previous = this.nameTails.get(name) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    this.nameTails.set(name, settled)
    void settled.then(() => {
      if (this.nameTails.get(name) === settled) this.nameTails.delete(name)
    })
    return run
  }

  private hasAttachedEntry(state: ClientSessionState): boolean {
    for (const entry of state.entries.values()) {
      if (entry.phase === 'attached') return true
    }
    return false
  }

  private hasDesiredAttachments(): boolean {
    for (const state of this.sessions.values()) {
      if (this.hasAttachedEntry(state)) return true
    }
    return false
  }

  private effectiveSize(state: ClientSessionState): TerminalSize {
    let cols = Number.POSITIVE_INFINITY
    let rows = Number.POSITIVE_INFINITY
    for (const claim of state.sizeClaims.values()) {
      cols = Math.min(cols, claim.cols)
      rows = Math.min(rows, claim.rows)
    }
    // Every entry receives a claim before it enters the map. This fallback only protects a
    // teardown race from ever putting non-finite geometry on the wire.
    return {
      cols: Number.isFinite(cols) ? cols : 80,
      rows: Number.isFinite(rows) ? rows : 24
    }
  }

  private async ensureConnected(): Promise<void> {
    // A newly authenticated socket is visible while its reconnect restoration is still running.
    // The barrier wins over the raw socket check so no later request can overtake replay.
    if (this.connecting) return this.connecting
    if (this.socket && !this.socket.destroyed) return
    const attempt = this.doConnect()
    this.connecting = attempt
    void attempt.then(
      () => {
        if (this.connecting === attempt) this.connecting = null
        this.reconnectAttempt = 0
      },
      () => {
        if (this.connecting === attempt) this.connecting = null
        this.scheduleAutoReconnect()
      }
    )
    return attempt
  }

  private async doConnect(): Promise<void> {
    const wasConnectedBefore = this.everConnected
    if (await this.tryConnectBeforeLaunch()) {
      const socket = this.socket
      if (wasConnectedBefore && socket) await this.restoreSocket(socket)
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
    let lastPublicationError: Error | null = null
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(150)
      try {
        if (await this.tryConnectOnce()) {
          const socket = this.socket
          if (wasConnectedBefore && socket) await this.restoreSocket(socket)
          return
        }
        lastPublicationError = null
      } catch (error) {
        const typed = asError(error)
        if (!this.isTransientPublicationLock(typed)) throw typed
        lastPublicationError = typed
      }
    }
    if (lastPublicationError) throw lastPublicationError
    throw new Error('session-host did not come up in time')
  }

  private isTransientPublicationLock(error: Error): boolean {
    return error.message === 'invalid session-host state: file is empty'
  }

  /** An exclusive-create startup lock is briefly empty before atomic state publication. Retry
   * only that exact state within a small bound; every other unreadable or malformed observation
   * remains an immediate integrity failure and never reaches the launcher. */
  private async tryConnectBeforeLaunch(): Promise<boolean> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.tryConnectOnce()
      } catch (error) {
        const typed = asError(error)
        if (!this.isTransientPublicationLock(typed)) throw typed
        lastError = typed
        await sleep(50)
      }
    }
    throw lastError ?? new Error('session-host state publication did not complete')
  }

  private async tryConnectOnce(): Promise<boolean> {
    const paths = sessionHostPaths(this.deps.userDataDir)
    const identity = readExistingSessionHostIdentity(paths.statePath, {
      expectedEndpoint: paths.endpoint,
      expectedTokenPath: paths.tokenPath
    })
    if (identity.kind === 'absent') return false
    if (
      identity.state.protocolVersion !== 1 &&
      identity.state.protocolVersion !== SESSION_HOST_PROTOCOL_VERSION
    ) {
      throw new Error(
        `incompatible session-host protocol: host=${identity.state.protocolVersion}, ` +
          `client=${SESSION_HOST_PROTOCOL_VERSION}`
      )
    }
    const token = identity.token
    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new Error('invalid session-host token: expected 64 hexadecimal characters')
    }
    const endpoint = identity.state.endpoint
    return new Promise((resolve, reject) => {
      let settled = false
      let connected = false
      const socket = net.connect(endpoint)
      socket.unref?.()
      const framer = new LineFramer()
      const helloId = this.nextId++
      let protocolVersion: 1 | 2 | null = null
      const finish = (ok: boolean, trailing: SessionHostFrame[] = []): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.removeListener('connect', onHandshakeConnect)
        socket.removeListener('data', onHandshakeData)
        socket.removeListener('error', onHandshakeError)
        socket.removeListener('close', onHandshakeClose)
        if (ok) {
          if (!protocolVersion) {
            failHandshake(new Error('session-host hello did not negotiate a protocol version'))
            return
          }
          this.attachSocket(socket, protocolVersion)
          for (const frame of trailing) this.handleFrame(socket, frame)
        } else {
          try {
            socket.destroy()
          } catch {
            /* already gone */
          }
        }
        resolve(ok)
      }
      const failHandshake = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.removeListener('connect', onHandshakeConnect)
        socket.removeListener('data', onHandshakeData)
        socket.removeListener('error', onHandshakeError)
        socket.removeListener('close', onHandshakeClose)
        try {
          socket.destroy()
        } catch {
          /* already gone */
        }
        reject(error)
      }
      const onHandshakeError = (error: Error): void => {
        if (connected) failHandshake(error)
        else finish(false)
      }
      const onHandshakeClose = (): void => {
        if (connected) failHandshake(new Error('session-host closed during hello'))
        else finish(false)
      }
      const onHandshakeConnect = (): void => {
        connected = true
        try {
          socket.write(
            encodeFrame({
              id: helloId,
              cmd: 'hello',
              token,
              protocolVersion: SESSION_HOST_PROTOCOL_VERSION
            }),
            (error) => {
              if (error) failHandshake(asError(error))
            }
          )
        } catch (error) {
          failHandshake(asError(error))
        }
      }
      const onHandshakeData = (chunk: Buffer): void => {
        const frames = framer.push<SessionHostFrame>(chunk.toString('utf8'))
        for (let index = 0; index < frames.length; index++) {
          const frame = frames[index]
          if ('type' in frame || frame.id !== helloId) continue
          if (frame.ok) {
            const advertised = (frame.result as { protocolVersion?: unknown } | undefined)
              ?.protocolVersion
            const negotiated =
              advertised === undefined
                ? 1
                : advertised === SESSION_HOST_PROTOCOL_VERSION
                  ? 2
                  : null
            if (!negotiated) {
              failHandshake(
                new Error(
                  `session-host protocol is incompatible: expected version ` +
                    `${SESSION_HOST_PROTOCOL_VERSION}, received ${String(advertised ?? 'none')}`
                )
              )
              return
            }
            if (identity.state.protocolVersion !== negotiated) {
              failHandshake(
                new Error(
                  `session-host protocol publication disagrees with hello: state=` +
                    `${identity.state.protocolVersion}, hello=${negotiated}`
                )
              )
              return
            }
            protocolVersion = negotiated
            finish(true, frames.slice(index + 1))
          } else {
            failHandshake(new Error(`session-host hello rejected: ${frame.error}`))
          }
          return
        }
      }
      const timer = setTimeout(() => {
        if (connected) failHandshake(new Error('session-host hello timed out'))
        else finish(false)
      }, HANDSHAKE_TIMEOUT_MS)
      timer.unref?.()
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
      for (const frame of framer.push<SessionHostFrame>(chunk.toString('utf8'))) {
        this.handleFrame(socket, frame)
      }
    })
    const onError = (error: Error): void => this.dropSocket(socket, error)
    const onClose = (): void => this.dropSocket(socket, new Error('session-host connection lost'))
    socket.on('error', onError)
    socket.once('close', onClose)
  }

  private dropSocket(socket: net.Socket, error: Error, destroy = false): void {
    const wasCurrent = this.socket === socket
    if (wasCurrent) {
      this.socket = null
      this.negotiatedProtocolVersion = null
      for (const state of this.sessions.values()) {
        if (state.appliedSocket !== socket) continue
        state.appliedSocket = null
        state.appliedAttached = false
        state.appliedPaused = false
        state.appliedSize = null
      }
    }
    for (const [id, entry] of this.pending) {
      if (entry.socket !== socket) continue
      this.pending.delete(id)
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(error)
    }
    if (destroy && !socket.destroyed) {
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
    }
    if (wasCurrent) this.scheduleAutoReconnect()
  }

  private scheduleAutoReconnect(): void {
    if (this.socket || this.connecting || this.reconnectTimer || !this.hasDesiredAttachments()) {
      return
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.hasDesiredAttachments()) return
      void this.ensureConnected().catch(() => {
        // ensureConnected's rejection handler schedules the next bounded-backoff attempt.
      })
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private stopReconnectIfIdle(): void {
    if (this.hasDesiredAttachments()) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectAttempt = 0
  }

  private handleFrame(socket: net.Socket, frame: SessionHostFrame): void {
    if (this.socket !== socket) return
    if ('type' in frame) {
      const state = this.sessions.get(frame.name)
      if (!state) return
      const protocolVersion = this.negotiatedProtocolVersion
      if (protocolVersion === 2) {
        if (
          typeof frame.generation !== 'string' ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(frame.generation)
        ) {
          return
        }
        const expected = state.generation ?? this.sessionGenerations.get(frame.name)
        if (expected && expected !== frame.generation) return
        if (!expected && state.preAckEntries.size > 0) {
          state.generation = frame.generation
          this.sessionGenerations.set(frame.name, frame.generation)
        } else if (!expected) {
          return
        }
      } else if (state.protocolVersion === 2) {
        return
      }
      if (frame.type === 'data') {
        this.deliverData(state, frame.data)
      } else {
        this.handleExit(state, frame.exitCode)
      }
      return
    }

    const entry = this.pending.get(frame.id)
    if (!entry || entry.socket !== socket) return
    this.pending.delete(frame.id)
    if (entry.timer) clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(frame.error))
  }

  private deliverData(state: ClientSessionState, data: string): void {
    if (state.preAckExit) return
    const attached = [...state.entries.values()].filter((entry) => entry.phase === 'attached')
    if (attached.length === 0) {
      // A cold process can write between host-side subscriber activation and the attach response.
      // Retain those bytes for the attaching owner; the correlated response promotes it before
      // this queue is flushed. An old-generation exit clears the queue instead.
      if (state.preAckEntries.size > 0) {
        state.bufferedData.push({ data, recipients: new Set(state.preAckEntries) })
      }
      return
    }
    if (state.pauseOwners.size > 0 || state.releasePending) {
      state.bufferedData.push({ data, recipients: new Set(attached) })
      return
    }
    this.deliverToEntries(attached, data)
  }

  private deliverToEntries(entries: Iterable<SubscriberEntry>, data: string): void {
    for (const entry of entries) {
      try {
        entry.sub.onData(data)
      } catch {
        // One renderer subscriber must not starve its co-attached neighbors.
      }
    }
  }

  private flushData(state: ClientSessionState): void {
    if (state.pauseOwners.size > 0 || state.releasePending || state.bufferedData.length === 0) return
    const queued = state.bufferedData
    state.bufferedData = []
    for (const frame of queued) {
      const liveRecipients = [...frame.recipients].filter(
        (entry) =>
          entry.phase === 'attached' && state.entries.get(entry.sub) === entry
      )
      this.deliverToEntries(liveRecipients, frame.data)
    }
  }

  private handleExit(state: ClientSessionState, exitCode: number): void {
    const retired = [...state.entries.values()].filter((entry) => entry.phase === 'attached')
    if (retired.length === 0 && state.preAckEntries.size > 0) state.preAckExit = true
    // Retire the old generation before callbacks. An onExit callback may synchronously attach the
    // same name; post-callback deletion would otherwise erase that replacement generation.
    for (const entry of retired) {
      state.entries.delete(entry.sub)
      state.preAckEntries.delete(entry)
      state.pauseOwners.delete(entry.sub)
      state.sizeClaims.delete(entry.sub)
    }
    state.bufferedData = []
    state.releasePending = false
    state.appliedSocket = null
    state.appliedAttached = false
    state.appliedPaused = false
    state.appliedSize = null
    if (state.entries.size === 0 && this.sessions.get(state.name) === state) {
      this.sessions.delete(state.name)
    }
    if (retired.length > 0) {
      this.sessionGenerations.delete(state.name)
      state.generation = undefined
    }
    this.stopReconnectIfIdle()
    for (const entry of retired) {
      try {
        entry.sub.onExit(exitCode)
      } catch {
        // Exit delivery is isolated for the same reason as data delivery.
      }
    }
  }

  private async request<T>(
    request: SessionHostRequestBody,
    onSuccess?: (result: T, socket: net.Socket) => void
  ): Promise<T> {
    await this.ensureConnected()
    const socket = this.socket
    if (!socket) throw new Error('session-host: not connected')
    return this.requestOnSocket(socket, request, onSuccess)
  }

  /** Request on an already-authenticated socket. Reconnect restoration uses this directly because
   * calling ensureConnected from inside the connection barrier would recursively await itself. */
  private requestOnSocket<T>(
    socket: net.Socket,
    request: SessionHostRequestBody,
    onSuccess?: (result: T, socket: net.Socket) => void
  ): Promise<T> {
    if (this.socket !== socket || socket.destroyed) {
      return Promise.reject(new Error('session-host connection lost'))
    }
    const id = this.nextId++
    const full = { id, ...request } as SessionHostRequest
    return new Promise<T>((resolve, reject) => {
      const pending: PendingEntry = {
        socket,
        timer: null,
        resolve: (result) => {
          try {
            const typed = result as T
            onSuccess?.(typed, socket)
            resolve(typed)
          } catch (error) {
            reject(asError(error))
          }
        },
        reject
      }
      pending.timer = setTimeout(() => {
        if (this.pending.get(id) !== pending) return
        this.dropSocket(
          socket,
          new Error(`session-host request timed out: ${request.cmd}`),
          true
        )
      }, SESSION_HOST_REQUEST_TIMEOUT_MS)
      pending.timer.unref?.()
      this.pending.set(id, pending)
      try {
        socket.write(encodeFrame(full), (error) => {
          // A response may beat a late write callback. Identity-check this exact pending entry so
          // that callback can neither settle nor delete a newer request that reused surrounding state.
          if (!error || this.pending.get(id) !== pending) return
          this.dropSocket(socket, asError(error), true)
        })
      } catch (error) {
        if (this.pending.get(id) === pending) this.dropSocket(socket, asError(error), true)
      }
    })
  }

  private applyAttachment(
    state: ClientSessionState,
    socket: net.Socket,
    paused: boolean,
    size: TerminalSize
  ): void {
    if (this.sessions.get(state.name) !== state || !this.hasAttachedEntry(state)) return
    state.appliedSocket = socket
    state.appliedAttached = true
    state.appliedPaused = paused
    state.appliedSize = size
    if (!paused && state.pauseOwners.size === 0) {
      state.releasePending = false
      this.flushData(state)
    }
  }

  private async restoreSocket(socket: net.Socket): Promise<void> {
    try {
      for (const state of [...this.sessions.values()]) {
        if (this.sessions.get(state.name) !== state) continue
        if (this.killReplayBarriers.has(state.name)) continue
        const anchor = [...state.entries.values()].find((entry) => entry.phase === 'attached')
        if (!anchor) continue
        const size = this.effectiveSize(state)
        const paused = state.pauseOwners.size > 0
        const protocolVersion = this.negotiatedProtocolVersion
        if (!protocolVersion) throw new Error('session-host: not connected')
        try {
          if (state.protocolVersion && state.protocolVersion !== protocolVersion) {
            throw new Error(
              `session-host protocol changed while '${state.name}' was detached; warm replay is unsafe`
            )
          }
          const expectedGeneration = state.generation ?? this.sessionGenerations.get(state.name)
          const response =
            protocolVersion === 1
              ? await this.requestOnSocket<AttachResult>(socket, {
                  cmd: 'attach',
                  name: state.name,
                  spawn: legacyWarmOnlySentinel(this.deps.userDataDir),
                  scrollback: 1,
                  paused
                })
              : await this.requestOnSocket<AttachResult>(socket, {
                  cmd: 'attachExisting',
                  name: state.name,
                  expectedGeneration,
                  cols: size.cols,
                  rows: size.rows,
                  paused
                })
          const result = requireAttachResult(response, state.name, protocolVersion)
          if (result.fresh) {
            throw new Error(
              protocolVersion === 1
                ? `legacy session-host lost '${state.name}' before warm replay; no requested shell was spawned`
                : `session-host protocol violation: attachExisting '${state.name}' reported a fresh session`
            )
          }
          if (
            protocolVersion === 2 &&
            expectedGeneration &&
            result.generation !== expectedGeneration
          ) {
            throw new Error(
              `session-host generation changed while '${state.name}' was detached; warm replay is unsafe`
            )
          }
          if (this.sessions.get(state.name) !== state || !this.hasAttachedEntry(state)) {
            await this.requestOnSocket(socket, { cmd: 'detach', name: state.name })
            continue
          }
          state.protocolVersion = protocolVersion
          state.generation = result.generation ?? expectedGeneration
          if (state.generation) this.sessionGenerations.set(state.name, state.generation)
          this.applyAttachment(state, socket, paused, size)
          if (result.screen && state.appliedSocket === socket) {
            this.deliverData(state, RECONNECT_REPAINT_PREFIX + result.screen)
          }
          await this.reconcileOnSocket(state, socket)
        } catch (error) {
          if (this.socket !== socket || socket.destroyed || isTransportUncertainty(error)) throw error
          // A correlated warm-attach rejection retires exactly this generation. It must not keep
          // retrying forever or be translated into a process exit that the host never reported.
          if (this.sessions.get(state.name) === state) this.sessions.delete(state.name)
          this.sessionGenerations.delete(state.name)
          state.generation = undefined
          state.bufferedData = []
          state.preAckEntries.clear()
          state.appliedSocket = null
          state.appliedAttached = false
          state.appliedPaused = false
          state.appliedSize = null
          const failure = asError(error)
          for (const entry of state.entries.values()) {
            try {
              entry.sub.onAttachError?.(failure)
            } catch {
              /* one owner callback must not hide the same failure from its co-attached neighbors */
            }
          }
          state.entries.clear()
          this.stopReconnectIfIdle()
        }
      }
    } catch (error) {
      this.dropSocket(socket, asError(error), true)
      throw error
    }
  }

  private async reconcileOnSocket(state: ClientSessionState, socket: net.Socket): Promise<void> {
    if (
      this.sessions.get(state.name) !== state ||
      !this.hasAttachedEntry(state) ||
      state.appliedSocket !== socket ||
      !state.appliedAttached
    ) {
      return
    }
    const desiredPaused = state.pauseOwners.size > 0
    if (desiredPaused && !state.appliedPaused) {
      await this.requestOnSocket(socket, { cmd: 'pause', name: state.name })
      if (this.socket !== socket) return
      // Record a confirmed host ticket even if the final local owner retired while the request
      // was in flight. Its teardown lane then knows it owes the matching resume before detach.
      state.appliedPaused = true
      if (this.sessions.get(state.name) !== state) return
    }

    const desiredSize = this.effectiveSize(state)
    if (!sameSize(state.appliedSize, desiredSize)) {
      await this.requestOnSocket(socket, {
        cmd: 'resize',
        name: state.name,
        cols: desiredSize.cols,
        rows: desiredSize.rows
      })
      if (this.socket !== socket) return
      state.appliedSize = desiredSize
      if (this.sessions.get(state.name) !== state) return
    }

    if (!desiredPaused && state.appliedPaused) {
      await this.requestOnSocket(socket, { cmd: 'resume', name: state.name })
      if (this.socket !== socket) return
      state.appliedPaused = false
      if (this.sessions.get(state.name) !== state) return
    }
    if (state.pauseOwners.size === 0 && !state.appliedPaused) {
      state.releasePending = false
      this.flushData(state)
    }
  }

  private async reconcileState(state: ClientSessionState): Promise<void> {
    if (this.sessions.get(state.name) !== state || !this.hasAttachedEntry(state)) return
    await this.ensureConnected()
    const socket = this.socket
    if (!socket) throw new Error('session-host: not connected')
    await this.reconcileOnSocket(state, socket)
  }

  private queueReconcile(state: ClientSessionState): void {
    void this.enqueueState(state, () => this.reconcileState(state)).catch((error) => {
      const socket = this.socket
      if (socket) this.dropSocket(socket, asError(error), true)
    })
  }

  private async teardownRetiredState(state: ClientSessionState): Promise<void> {
    const socket = state.appliedSocket
    if (!socket || this.socket !== socket || socket.destroyed || !state.appliedAttached) return
    try {
      // `releasePending` covers the conservative edge where the last owner retired while its
      // pause acknowledgement was still crossing the wire. Resume is idempotent on the host.
      if (state.appliedPaused || state.releasePending) {
        await this.requestOnSocket(socket, { cmd: 'resume', name: state.name })
        state.appliedPaused = false
        state.releasePending = false
      }
      await this.requestOnSocket(socket, { cmd: 'detach', name: state.name })
      state.appliedAttached = false
    } catch (error) {
      // A failed detach is unknown membership. Closing the socket makes the host release every
      // ticket and subscriber deterministically, with no ghost to replay.
      this.dropSocket(socket, asError(error), true)
    }
  }

  async attach(
    name: string,
    spawn: SessionHostSpawnOptions,
    scrollback: number,
    sub: SessionSubscriber
  ): Promise<AttachResult> {
    const normalizedSpawn = {
      ...spawn,
      cols: normalizeDimension(spawn.cols, 80),
      rows: normalizeDimension(spawn.rows, 24)
    }
    return this.attachSubscriber(
      name,
      sub,
      { kind: 'create', spawn: normalizedSpawn, scrollback },
      { cols: normalizedSpawn.cols, rows: normalizedSpawn.rows }
    )
  }

  /** Warm-only attach. The request carries the generation confirmed by hasSession/attach and no
   * spawn plan, so an exit racing the attach cannot recreate a shell with stale options. */
  async attachExisting(name: string, sub: SessionSubscriber): Promise<AttachResult> {
    return this.attachSubscriber(
      name,
      sub,
      { kind: 'existing', scrollback: 1 },
      { cols: 80, rows: 24 }
    )
  }

  private async attachSubscriber(
    name: string,
    sub: SessionSubscriber,
    requestKind:
      | { kind: 'create'; spawn: SessionHostSpawnOptions; scrollback: number }
      | { kind: 'existing'; scrollback: number },
    initialSize: TerminalSize
  ): Promise<AttachResult> {
    if (this.killReplayBarriers.has(name)) {
      throw new Error(
        `session-host: cannot attach '${name}' while its kill result is unconfirmed; ` +
          'retry the kill before creating or attaching a replacement'
      )
    }
    let state = this.sessions.get(name)
    if (!state) {
      state = this.newState(name)
      this.sessions.set(name, state)
    }
    const previous = state.entries.get(sub)
    if (previous) throw new Error(`session-host subscriber is already attached: ${name}`)
    const entry: SubscriberEntry = {
      sub,
      ...(requestKind.kind === 'create' ? { spawn: requestKind.spawn } : {}),
      scrollback: requestKind.scrollback,
      phase: 'attaching'
    }
    state.entries.set(sub, entry)
    state.sizeClaims.set(sub, initialSize)

    return this.enqueueState(state, async () => {
      if (this.sessions.get(name) !== state || state.entries.get(sub) !== entry) {
        throw new Error(`session-host attachment was canceled: ${name}`)
      }
      const size = this.effectiveSize(state)
      const paused = state.pauseOwners.size > 0
      try {
        await this.ensureConnected()
        const protocolVersion = this.negotiatedProtocolVersion
        if (!protocolVersion) throw new Error('session-host: not connected')
        const alreadyAttached = this.hasAttachedEntry(state)
        const useWarmOnly = requestKind.kind === 'existing' || alreadyAttached
        if (!useWarmOnly && protocolVersion === 1) {
          throw new SessionHostProtocolCompatibilityError(`create terminal '${name}'`)
        }
        if (state.protocolVersion && state.protocolVersion !== protocolVersion) {
          throw new Error(
            `session-host protocol changed while '${name}' was attached; co-attach is unsafe`
          )
        }
        const expectedGeneration = state.generation ?? this.sessionGenerations.get(name)
        const replacementToken = useWarmOnly ? undefined : this.replacementTokens.get(name)
        state.preAckEntries.add(entry)
        let response: AttachResult | undefined
        const attempts = replacementToken ? 2 : 1
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            response = useWarmOnly
              ? protocolVersion === 1
                ? await this.request<AttachResult>({
                    cmd: 'attach',
                    name,
                    spawn: legacyWarmOnlySentinel(this.deps.userDataDir),
                    scrollback: 1,
                    paused
                  })
                : await this.request<AttachResult>({
                    cmd: 'attachExisting',
                    name,
                    expectedGeneration,
                    cols: size.cols,
                    rows: size.rows,
                    paused
                  })
              : await this.request<AttachResult>({
                  cmd: 'attach',
                  name,
                  spawn: {
                    ...(requestKind.kind === 'create'
                      ? requestKind.spawn
                      : legacyWarmOnlySentinel(this.deps.userDataDir)),
                    cols: size.cols,
                    rows: size.rows
                  },
                  scrollback: requestKind.scrollback,
                  replacementToken,
                  paused
                })
            break
          } catch (error) {
            if (!replacementToken || attempt + 1 >= attempts || !isTransportUncertainty(error)) {
              throw error
            }
          }
        }
        const result = requireAttachResult(response, name, protocolVersion)
        if (state.preAckExit) {
          throw new Error(`session-host session exited before its attach completed: ${name}`)
        }
        if (useWarmOnly && result.fresh) {
          throw new Error(
            protocolVersion === 1
              ? `legacy session-host lost '${name}' before warm attach; no requested shell was spawned`
              : `session-host protocol violation: attachExisting '${name}' reported a fresh session`
          )
        }
        if (
          useWarmOnly &&
          protocolVersion === 2 &&
          expectedGeneration &&
          result.generation !== expectedGeneration
        ) {
          throw new Error(
            `session-host generation changed before warm attach '${name}' completed`
          )
        }
        if (replacementToken && !result.fresh) {
          throw new Error(`session-host protocol violation: reserved replacement '${name}' was not fresh`)
        }
        state.preAckEntries.delete(entry)
        state.protocolVersion = protocolVersion
        state.generation = result.generation ?? expectedGeneration
        if (state.generation) this.sessionGenerations.set(name, state.generation)
        if (replacementToken && result.fresh) {
          if (this.replacementTokens.get(name) === replacementToken) {
            this.replacementTokens.delete(name)
          }
          if (this.killOperations.get(name)?.operationId === replacementToken) {
            this.killOperations.delete(name)
          }
        }
        const socket = this.socket
        if (!socket) throw new Error('session-host: not connected')
        if (this.sessions.get(name) === state && state.entries.get(sub) === entry) {
          entry.phase = 'attached'
          this.applyAttachment(state, socket, paused, size)
        } else {
          // The attach reached the host before its owner retired. Remember the confirmed
          // membership on the retired state so its ordered teardown can return pause + detach.
          state.appliedSocket = socket
          state.appliedAttached = true
          state.appliedPaused = paused
          state.appliedSize = size
        }
        if (this.sessions.get(name) !== state || state.entries.get(sub) !== entry) {
          // If another local subscriber remains, this attach also restored its socket membership;
          // detaching here would evict that neighbor. Only compensate when nobody still owns it.
          if (this.sessions.get(name) !== state || !this.hasAttachedEntry(state)) {
            await this.teardownRetiredState(state)
          } else {
            await this.reconcileState(state)
          }
          throw new Error(`session-host attachment was canceled: ${name}`)
        }
        await this.reconcileState(state)
        return result
      } catch (error) {
        state.preAckEntries.delete(entry)
        if (state.entries.get(sub) === entry) {
          state.entries.delete(sub)
          const releasedPause = state.pauseOwners.delete(sub)
          state.sizeClaims.delete(sub)
          if (releasedPause && state.pauseOwners.size === 0) state.releasePending = true
        }
        if (state.entries.size === 0 && this.sessions.get(name) === state) {
          this.sessions.delete(name)
          if (!state.generation || this.sessionGenerations.get(name) === state.generation) {
            this.sessionGenerations.delete(name)
          }
          state.bufferedData = []
          this.stopReconnectIfIdle()
          await this.teardownRetiredState(state)
        } else if (this.sessions.get(name) === state && this.hasAttachedEntry(state)) {
          if (
            state.pauseOwners.size === 0 &&
            state.appliedSocket === this.socket &&
            !state.appliedPaused
          ) {
            state.releasePending = false
            this.flushData(state)
          }
          this.queueReconcile(state)
        }
        throw error
      }
    })
  }

  unsubscribe(name: string, sub: SessionSubscriber): void {
    const state = this.sessions.get(name)
    const entry = state?.entries.get(sub)
    if (!state || !entry) return
    state.entries.delete(sub)
    state.preAckEntries.delete(entry)
    const releasedPause = state.pauseOwners.delete(sub)
    state.sizeClaims.delete(sub)
    if (!this.hasAttachedEntry(state)) state.bufferedData = []
    if (releasedPause && state.pauseOwners.size === 0) state.releasePending = true

    if (state.entries.size > 0) {
      this.queueReconcile(state)
      return
    }
    if (this.sessions.get(name) === state) this.sessions.delete(name)
    state.bufferedData = []
    this.stopReconnectIfIdle()
    void this.enqueueState(state, () => this.teardownRetiredState(state))
  }

  async hasSession(name: string): Promise<boolean> {
    const result = await this.request<HasSessionResult>({ cmd: 'hasSession', name })
    return result.exists
  }

  write(name: string, sub: SessionSubscriber, data: string): void {
    const state = this.sessions.get(name)
    const entry = state?.entries.get(sub)
    if (!state || !entry) return
    void this.enqueueState(state, async () => {
      if (this.sessions.get(name) !== state || state.entries.get(sub) !== entry) return
      try {
        await this.request({ cmd: 'write', name, data })
      } catch (error) {
        const socket = this.socket
        if (socket) this.dropSocket(socket, asError(error), true)
      }
    })
  }

  resize(name: string, sub: SessionSubscriber, cols: number, rows: number): void {
    const state = this.sessions.get(name)
    if (!state || !state.entries.has(sub)) return
    const previous = state.sizeClaims.get(sub) ?? { cols: 80, rows: 24 }
    state.sizeClaims.set(sub, {
      cols: normalizeDimension(cols, previous.cols),
      rows: normalizeDimension(rows, previous.rows)
    })
    this.queueReconcile(state)
  }

  pause(name: string, sub: SessionSubscriber): void {
    const state = this.sessions.get(name)
    if (!state || !state.entries.has(sub) || state.pauseOwners.has(sub)) return
    const wasFlowing = state.pauseOwners.size === 0
    state.pauseOwners.add(sub)
    if (wasFlowing) this.queueReconcile(state)
  }

  resume(name: string, sub: SessionSubscriber): void {
    const state = this.sessions.get(name)
    if (!state || !state.entries.has(sub) || !state.pauseOwners.delete(sub)) return
    if (state.pauseOwners.size === 0) {
      state.releasePending = true
      this.queueReconcile(state)
    }
  }

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
      const result = await this.request<PaneCommandResult>({ cmd: 'paneCommand', name })
      return result.command
    } catch {
      return null
    }
  }

  async capture(name: string, full: boolean): Promise<string> {
    const result = await this.request<CaptureResult>({ cmd: 'capture', name, full })
    return result.text
  }

  async killSession(name: string): Promise<void> {
    const state = this.sessions.get(name)
    if (!state) {
      await this.enqueueName(name, () => this.request({ cmd: 'killSession', name }))
      return
    }
    // New attaches queued after this call are a new desired generation and must survive the kill.
    const cutoff = new Set(state.entries.values())
    await this.enqueueState(state, async () => {
      // Always send the idempotent kill at this exact lane position. A natural old exit may have
      // replaced the local state already, but every post-invocation attach is still queued behind
      // this operation and therefore cannot be mistaken for the generation being killed.
      await this.request({ cmd: 'killSession', name })
      if (this.sessions.get(name) !== state) return
      for (const entry of cutoff) {
        if (state.entries.get(entry.sub) !== entry) continue
        state.entries.delete(entry.sub)
        state.preAckEntries.delete(entry)
        state.pauseOwners.delete(entry.sub)
        state.sizeClaims.delete(entry.sub)
      }
      state.bufferedData = []
      state.releasePending = false
      state.appliedSocket = null
      state.appliedAttached = false
      state.appliedPaused = false
      state.appliedSize = null
      if (state.entries.size === 0) this.sessions.delete(name)
      this.stopReconnectIfIdle()
    })
  }

  async listSessions(): Promise<string[]> {
    const result = await this.request<ListSessionsResult>({ cmd: 'listSessions' })
    return result.names
  }
}
