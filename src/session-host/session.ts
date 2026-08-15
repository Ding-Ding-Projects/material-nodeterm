import type { Socket } from 'net'
import * as pty from 'node-pty'
import { TerminalEmulator } from './terminal-emulator'
import type { SessionHostSpawnOptions } from './protocol'

/**
 * One persisted session, owned by the host process for as long as it lives — this is the
 * Windows-and-anywhere-else-tmux-is-missing analogue of a tmux session: it survives every
 * connecting client detaching, and outlives the app that spawned it.
 */
export class HostSession {
  readonly name: string
  readonly proc: pty.IPty
  private readonly term: TerminalEmulator
  /** The tail of every xterm write accepted so far. `@xterm/headless` applies writes
   *  asynchronously, so every screen read must cross this barrier or a warm attach/capture can
   *  serialize a prefix of output whose data frame has already left the host. The rejection
   *  handler keeps one anomalous write from wedging every later snapshot forever; the individual
   *  caller still receives the rejection and can log it. */
  private outputTail: Promise<void> = Promise.resolve()
  /** The underlying node-pty pause actuator is session-global, but the reasons for holding it are
   *  connection-scoped. A socket may return only its own ticket, and a vanished socket's ticket
   *  is released by `detach` so it cannot leave every remaining viewer frozen. */
  private readonly pauseOwners = new Set<Socket>()
  /** Sockets currently receiving `data`/`exit` push frames for this session — the same "N
   *  subscribers, one underlying process" shape `pty-manager.ts` already implements for tmux
   *  co-attach, one level further down the stack. */
  readonly subscribers = new Set<Socket>()
  readonly createdAt = Date.now()
  /** Set once, by whichever path (natural pty exit or an explicit `killSession`) ends this
   *  session first — guards against double-dispose/double-broadcast when both could race. */
  exited = false
  /** Shared completion for the natural-exit / explicit-kill race. A second caller waits for the
   *  first caller's output drain instead of acknowledging while teardown is still in flight. */
  ending: Promise<void> | null = null

  constructor(
    name: string,
    spawn: SessionHostSpawnOptions,
    scrollback: number,
    overrides?: { proc?: pty.IPty; term?: TerminalEmulator }
  ) {
    this.name = name
    this.proc =
      overrides?.proc ??
      pty.spawn(spawn.shell, spawn.args, {
        name: 'xterm-256color',
        cols: Math.max(1, spawn.cols),
        rows: Math.max(1, spawn.rows),
        cwd: spawn.cwd,
        env: spawn.env
      })
    this.term =
      overrides?.term ??
      new TerminalEmulator({ cols: spawn.cols, rows: spawn.rows, scrollback })
  }

  /** Queue one PTY-output chunk into the headless emulator, preserving arrival order. */
  recordOutput(data: string): Promise<void> {
    const applied = this.outputTail.then(() => this.term.write(data))
    this.outputTail = applied.catch(() => {})
    return applied
  }

  /** Wait until every PTY-output chunk observed before this call has reached xterm. */
  settleOutput(): Promise<void> {
    return this.outputTail
  }

  /** Serialize only after prior asynchronous writes have landed. The barrier is inside this
   *  method so a caller cannot accidentally reproduce the stale warm-attach race. */
  async serialize(scrollback?: number): Promise<string> {
    await this.outputTail
    return this.term.serialize(scrollback)
  }

  /** Keep a resize ordered after output already accepted by the old terminal geometry. */
  async resize(cols: number, rows: number): Promise<void> {
    await this.outputTail
    this.term.resize(cols, rows)
  }

  pauseFor(socket: Socket): void {
    const wasPaused = this.pauseOwners.size > 0
    this.pauseOwners.add(socket)
    if (wasPaused) return
    try {
      this.proc.pause()
    } catch {
      /* pty may have exited between the session lookup and the actuator call */
    }
  }

  resumeFor(socket: Socket): void {
    if (!this.pauseOwners.delete(socket) || this.pauseOwners.size > 0) return
    try {
      this.proc.resume()
    } catch {
      /* pty may already have exited */
    }
  }

  /** A protocol detach and a transport close mean the same thing for flow control: this socket
   *  can never send its matching resume now, so return only its ticket before forgetting it. */
  detach(socket: Socket): void {
    this.subscribers.delete(socket)
    this.resumeFor(socket)
  }

  dispose(): void {
    this.pauseOwners.clear()
    this.term.dispose()
  }
}
