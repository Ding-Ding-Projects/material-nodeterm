import type { Socket } from 'net'
import * as pty from 'node-pty'
import { TerminalEmulator } from './terminal-emulator'
import type { SessionHostSpawnOptions } from './protocol'

/** Pause before the asynchronous headless terminal retains more than this many queued UTF-8
 * bytes. node-pty can still have a bounded amount already in flight, but it cannot keep feeding an
 * unbounded promise chain while xterm is behind. */
export const SESSION_EMULATOR_OUTPUT_HIGH_WATER_BYTES = 4 * 1024 * 1024
/** Resume only after the queued emulator tail drains this far, leaving hysteresis so a producer
 * hovering around the high-water boundary cannot chatter node-pty's global pause actuator. */
export const SESSION_EMULATOR_OUTPUT_LOW_WATER_BYTES = 1 * 1024 * 1024

interface Geometry {
  cols: number
  rows: number
}

interface AttachmentState {
  geometry?: Geometry
  explicitPaused: boolean
  subscribed: boolean
}

/** A warm attach must temporarily claim geometry and (on reconnect) restore its explicit pause
 * before reading a screen. The transaction makes a failed/retried attach restore only its own
 * prior socket state instead of leaking a claim or erasing an already-live duplicate attach. */
export interface PreparedHostAttachment {
  isCurrent(): boolean
  /** False means a concurrent detach/close cancelled this exact socket+name transaction. */
  commit(): boolean
  rollback(): Promise<void>
}

function normalizedGeometry(cols: number, rows: number): Geometry {
  if (
    !Number.isInteger(cols) ||
    !Number.isFinite(cols) ||
    cols <= 0 ||
    !Number.isInteger(rows) ||
    !Number.isFinite(rows) ||
    rows <= 0
  ) {
    throw new Error('terminal geometry must use finite positive integer cols and rows')
  }
  return { cols, rows }
}

/**
 * One persisted session, owned by the host process for as long as it lives — this is the
 * Windows-and-anywhere-else-tmux-is-missing analogue of a tmux session: it survives every
 * connecting client detaching, and outlives the app that spawned it.
 */
export class HostSession {
  readonly name: string
  readonly proc: pty.IPty
  private readonly term: TerminalEmulator
  /** The tail of every emulator mutation accepted so far. `@xterm/headless` applies writes
   * asynchronously, so warm attach/capture/resize/exit all cross this barrier. Rejections heal the
   * shared tail while the individual recordOutput caller still observes its own failure. */
  private outputTail: Promise<void> = Promise.resolve()
  private queuedOutputBytes = 0
  /** Explicit protocol flow and named-pipe transport flow drain independently. Collapsing them by
   * socket lets a `drain` event cancel a renderer pause that is still owed. */
  private readonly explicitPauseOwners = new Set<Socket>()
  private readonly transportPauseOwners = new Set<Socket>()
  /** The emulator queue is session-global, not owned by a connection. */
  private emulatorPauseOwner = false
  /** Each app connection contributes one componentwise geometry claim. The effective PTY size is
   * the minimum across live claims so every viewer fits; removing the smallest claim grows it. */
  private readonly geometryClaims = new Map<Socket, Geometry>()
  /** A detach/close increments the socket epoch before clearing state. A delayed prepare/rollback
   * from the prior epoch can then observe cancellation instead of resurrecting a ghost socket. */
  private readonly attachmentEpochs = new WeakMap<Socket, number>()
  private appliedGeometry: Geometry
  /** Consecutive callers asking for the same effective target share one acknowledgement. If that
   * actuator attempt fails, every waiter sees the failure; a later exact retry starts a new one. */
  private pendingGeometry: { key: string; promise: Promise<void> } | null = null
  /** Sockets currently receiving `data`/`exit` push frames for this session — the same "N
   * subscribers, one underlying process" shape `pty-manager.ts` already implements for tmux
   * co-attach, one level further down the stack. */
  readonly subscribers = new Set<Socket>()
  readonly createdAt = Date.now()
  /** Set once, by whichever path (natural pty exit or an explicit `killSession`) ends this
   * session first — guards against double-dispose/double-broadcast when both could race. */
  exited = false
  /** True once a successful explicit kill has claimed the name but before node-pty proves process
   * death with onExit. Same-name attach waits behind `ending` instead of joining this generation. */
  retiring = false
  /** Shared completion for the natural-exit / explicit-kill race. A second caller waits for the
   * first caller's output drain instead of acknowledging while teardown is still in flight. */
  ending: Promise<void> | null = null
  private processExitCode: number | null = null
  private readonly processExit: Promise<number>
  private resolveProcessExit!: (exitCode: number) => void

  constructor(
    name: string,
    spawn: SessionHostSpawnOptions,
    scrollback: number,
    overrides?: { proc?: pty.IPty; term?: TerminalEmulator }
  ) {
    this.name = name
    this.processExit = new Promise<number>((resolve) => {
      this.resolveProcessExit = resolve
    })
    this.appliedGeometry = normalizedGeometry(spawn.cols, spawn.rows)
    this.proc =
      overrides?.proc ??
      pty.spawn(spawn.shell, spawn.args, {
        name: 'xterm-256color',
        cols: this.appliedGeometry.cols,
        rows: this.appliedGeometry.rows,
        cwd: spawn.cwd,
        env: spawn.env
      })
    this.term =
      overrides?.term ??
      new TerminalEmulator({
        cols: this.appliedGeometry.cols,
        rows: this.appliedGeometry.rows,
        scrollback
      })
  }

  /** Queue one PTY-output chunk into the headless emulator, preserving arrival order and bounding
   * the retained byte tail. Accounting happens before chaining because promises not yet started
   * still retain their chunk strings and therefore count against the memory bound. */
  recordOutput(data: string): Promise<void> {
    const bytes = Buffer.byteLength(data, 'utf8')
    this.queuedOutputBytes += bytes
    if (this.queuedOutputBytes >= SESSION_EMULATOR_OUTPUT_HIGH_WATER_BYTES) {
      this.setEmulatorPause(true)
    }

    const applied = this.outputTail.then(() => this.term.write(data))
    const settled = applied.finally(() => {
      this.queuedOutputBytes = Math.max(0, this.queuedOutputBytes - bytes)
      if (this.queuedOutputBytes <= SESSION_EMULATOR_OUTPUT_LOW_WATER_BYTES) {
        this.setEmulatorPause(false)
      }
    })
    this.outputTail = settled.catch(() => {})
    return settled
  }

  /** Wait until every PTY-output chunk observed before this call has reached xterm. */
  settleOutput(): Promise<void> {
    return this.outputTail
  }

  /** Record the one authoritative process-death observation. A kill syscall returning is not this
   * event; only node-pty's onExit resolves the barrier and permits retirement acknowledgement. */
  observeProcessExit(exitCode: number): void {
    if (this.processExitCode !== null) return
    this.processExitCode = exitCode
    this.exited = true
    this.resolveProcessExit(exitCode)
  }

  waitForProcessExit(): Promise<number> {
    return this.processExit
  }

  /** Serialize only after prior asynchronous writes and geometry changes have landed. */
  async serialize(scrollback?: number): Promise<string> {
    await this.outputTail
    return this.term.serialize(scrollback)
  }

  /** Stage an attach's explicit flow state and per-socket geometry before the warm screen barrier.
   * The returned commit is the only operation that activates live delivery. */
  async prepareAttachment(
    socket: Socket,
    cols: number,
    rows: number,
    paused: boolean
  ): Promise<PreparedHostAttachment> {
    const epoch = (this.attachmentEpochs.get(socket) ?? 0) + 1
    this.attachmentEpochs.set(socket, epoch)
    const previous: AttachmentState = {
      geometry: this.geometryClaims.get(socket),
      explicitPaused: this.explicitPauseOwners.has(socket),
      subscribed: this.subscribers.has(socket)
    }
    this.setSocketPauseOwner(this.explicitPauseOwners, socket, paused)
    try {
      await this.setGeometryClaim(socket, cols, rows)
    } catch (error) {
      await this.restoreAttachment(socket, previous, epoch)
      throw error
    }

    let finished = false
    return {
      isCurrent: () => this.attachmentEpochs.get(socket) === epoch && !socket.destroyed,
      commit: () => {
        if (finished) return false
        finished = true
        if (this.attachmentEpochs.get(socket) !== epoch || socket.destroyed) return false
        this.subscribers.add(socket)
        // A response written before this attach may already have filled the socket. The new
        // session must inherit that socket-wide transport ticket before any live frame can add to
        // the same queue.
        if (socket.writableNeedDrain) this.setSocketPauseOwner(this.transportPauseOwners, socket, true)
        return true
      },
      rollback: async () => {
        if (finished) return
        finished = true
        await this.restoreAttachment(socket, previous, epoch)
      }
    }
  }

  /** Update only the requesting subscriber's geometry claim. */
  async resizeFor(socket: Socket, cols: number, rows: number): Promise<void> {
    if (!this.subscribers.has(socket)) return
    await this.setGeometryClaim(socket, cols, rows)
  }

  pauseFor(socket: Socket): void {
    if (!this.subscribers.has(socket)) return
    this.setSocketPauseOwner(this.explicitPauseOwners, socket, true)
  }

  resumeFor(socket: Socket): void {
    if (!this.subscribers.has(socket)) return
    this.setSocketPauseOwner(this.explicitPauseOwners, socket, false)
  }

  pauseTransportFor(socket: Socket): void {
    if (!this.subscribers.has(socket)) return
    this.setSocketPauseOwner(this.transportPauseOwners, socket, true)
  }

  resumeTransportFor(socket: Socket): void {
    this.setSocketPauseOwner(this.transportPauseOwners, socket, false)
  }

  /** A protocol detach and a transport close mean the same thing for ownership: this socket can
   * never return either flow ticket or its geometry claim, so release all three unconditionally. */
  async detach(socket: Socket): Promise<void> {
    this.attachmentEpochs.set(socket, (this.attachmentEpochs.get(socket) ?? 0) + 1)
    const wasPaused = this.hasPauseOwner()
    this.subscribers.delete(socket)
    this.explicitPauseOwners.delete(socket)
    this.transportPauseOwners.delete(socket)
    this.reconcileProcFlow(wasPaused)
    if (!this.geometryClaims.delete(socket)) return
    await this.applyEffectiveGeometry()
  }

  dispose(): void {
    this.explicitPauseOwners.clear()
    this.transportPauseOwners.clear()
    this.emulatorPauseOwner = false
    this.geometryClaims.clear()
    this.term.dispose()
  }

  private async restoreAttachment(
    socket: Socket,
    previous: AttachmentState,
    epoch: number
  ): Promise<void> {
    if (this.attachmentEpochs.get(socket) !== epoch) return
    const wasPaused = this.hasPauseOwner()
    if (previous.explicitPaused) this.explicitPauseOwners.add(socket)
    else this.explicitPauseOwners.delete(socket)
    if (previous.subscribed) this.subscribers.add(socket)
    else this.subscribers.delete(socket)
    this.reconcileProcFlow(wasPaused)

    if (previous.geometry) this.geometryClaims.set(socket, previous.geometry)
    else this.geometryClaims.delete(socket)
    await this.applyEffectiveGeometry()
  }

  private setGeometryClaim(socket: Socket, cols: number, rows: number): Promise<void> {
    this.geometryClaims.set(socket, normalizedGeometry(cols, rows))
    return this.applyEffectiveGeometry()
  }

  private applyEffectiveGeometry(): Promise<void> {
    const requested = this.effectiveGeometry()
    const key = requested ? `${requested.cols}x${requested.rows}` : 'unclaimed'
    if (this.pendingGeometry?.key === key) return this.pendingGeometry.promise
    // Recompute inside the serialized emulator tail, not when the request arrives. Concurrent
    // resize/detach calls can change the claim ledger while an earlier xterm write is pending; a
    // captured target would land stale after the newer operation. `appliedGeometry` advances only
    // after both real actuators succeed, so identical waiters share a real failure and a later
    // exact retry cannot false-no-op on a marker that never reached the terminal.
    const reconciled = this.outputTail.then(() => {
      const target = this.effectiveGeometry()
      if (!target) return
      if (
        target.cols === this.appliedGeometry.cols &&
        target.rows === this.appliedGeometry.rows
      ) {
        return
      }
      this.proc.resize(target.cols, target.rows)
      this.term.resize(target.cols, target.rows)
      this.appliedGeometry = target
    })
    const pending = { key, promise: reconciled }
    this.pendingGeometry = pending
    void reconciled.then(
      () => {
        if (this.pendingGeometry === pending) this.pendingGeometry = null
      },
      () => {
        if (this.pendingGeometry === pending) this.pendingGeometry = null
      }
    )
    this.outputTail = reconciled.catch(() => {})
    return reconciled
  }

  private effectiveGeometry(): Geometry | null {
    if (this.geometryClaims.size === 0) return null
    let cols = Number.MAX_SAFE_INTEGER
    let rows = Number.MAX_SAFE_INTEGER
    for (const claim of this.geometryClaims.values()) {
      cols = Math.min(cols, claim.cols)
      rows = Math.min(rows, claim.rows)
    }
    return { cols, rows }
  }

  private hasPauseOwner(): boolean {
    return (
      this.emulatorPauseOwner ||
      this.explicitPauseOwners.size > 0 ||
      this.transportPauseOwners.size > 0
    )
  }

  private setSocketPauseOwner(owners: Set<Socket>, socket: Socket, held: boolean): void {
    const wasPaused = this.hasPauseOwner()
    if (held) owners.add(socket)
    else owners.delete(socket)
    this.reconcileProcFlow(wasPaused)
  }

  private setEmulatorPause(held: boolean): void {
    const wasPaused = this.hasPauseOwner()
    this.emulatorPauseOwner = held
    this.reconcileProcFlow(wasPaused)
  }

  private reconcileProcFlow(wasPaused: boolean): void {
    const isPaused = this.hasPauseOwner()
    if (wasPaused === isPaused) return
    try {
      if (isPaused) this.proc.pause()
      else this.proc.resume()
    } catch {
      /* pty may have exited between the session lookup and the actuator call */
    }
  }
}
