import type { Socket } from 'net'
import { createHash, randomUUID } from 'crypto'
import * as pty from 'node-pty'
import { TerminalEmulator } from './terminal-emulator'
import type {
  ExecuteLaunchResult,
  SessionHostShellDialect,
  SessionHostSpawnOptions
} from './protocol'

const MAX_LAUNCH_LEDGER_ENTRIES = 256
const SHELL_QUIET_MS = 200
const SHELL_QUIET_CAP_MS = 1_500
const POST_LAUNCH_READY_CAP_MS = 5_000
const LAUNCH_READINESS_POLL_MS = 100
const VERIFY_TIMEOUT_MS = 2_000
const DELIVERY_ATTEMPTS = 3
const ECHO_TAIL_CHARS = 24
const KILL_LINE = '\x15'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// eslint-disable-next-line no-control-regex
const ESC_SEQ = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g

function cleanEcho(chunk: string): string {
  // eslint-disable-next-line no-control-regex
  return chunk.replace(ESC_SEQ, '').replace(/[\r\n]/g, '')
}

interface LaunchLedgerEntry {
  fingerprint: string
  outcome: Promise<{ ok: true } | { ok: false }>
}

function launchFingerprint(command: string, stdinAfterStart: string | undefined): string {
  const hash = createHash('sha256')
  hash.update(command, 'utf8')
  hash.update('\0', 'utf8')
  if (stdinAfterStart !== undefined) hash.update(stdinAfterStart, 'utf8')
  return hash.digest('hex')
}

function replacementAttachFingerprint(
  spawn: SessionHostSpawnOptions,
  scrollback: number
): string {
  const canonical = {
    cwd: spawn.cwd,
    shell: spawn.shell,
    args: [...spawn.args],
    env: Object.fromEntries(Object.entries(spawn.env).sort(([a], [b]) => a.localeCompare(b))),
    cols: spawn.cols,
    rows: spawn.rows,
    launchDialect: spawn.launchDialect ?? null,
    initialLaunch: spawn.initialLaunch ?? null,
    scrollback
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

/**
 * One persisted session, owned by the host process for as long as it lives — this is the
 * Windows-and-anywhere-else-tmux-is-missing analogue of a tmux session: it survives every
 * connecting client detaching, and outlives the app that spawned it.
 */
export class HostSession {
  readonly name: string
  /** Opaque identity for this exact process generation. Same-name replacement gets a new value. */
  readonly generation = randomUUID()
  readonly launchDialect?: SessionHostShellDialect
  readonly shellExecutableName: string
  /** Operation that created this generation after consuming a replacement lease. Retained only
   * with the live generation so a lost attach reply can be replayed idempotently with that token. */
  readonly createdByReplacementToken?: string
  private readonly replacementFingerprint: string
  readonly proc: pty.IPty
  readonly term: TerminalEmulator
  /** Sockets currently receiving `data`/`exit` push frames for this session — the same "N
   *  subscribers, one underlying process" shape `pty-manager.ts` already implements for tmux
   *  co-attach, one level further down the stack. */
  readonly subscribers = new Set<Socket>()
  readonly createdAt = Date.now()
  /** Set once, by whichever path (natural pty exit or an explicit `killSession`) ends this
   *  session first — guards against double-dispose/double-broadcast when both could race. */
  exited = false
  /** Generation-local exactly-once ledger. Promise insertion happens before command delivery, so
   * another app process repeating a launch whose first reply was lost observes the same result. */
  private readonly launchLedger = new Map<string, LaunchLedgerEntry>()
  /** Different launch ids must not type over one another in the same interactive prompt. */
  private launchQueue: Promise<void> = Promise.resolve()
  /** While trusted private input is being echo-verified, host.ts must neither broadcast it nor
   * write it into the reconstructable emulator screen. */
  private privateLaunchOutput = false

  get suppressingPrivateLaunchOutput(): boolean {
    return this.privateLaunchOutput
  }

  constructor(
    name: string,
    spawn: SessionHostSpawnOptions,
    scrollback: number,
    createdByReplacementToken?: string
  ) {
    this.name = name
    this.launchDialect = spawn.launchDialect
    this.shellExecutableName = (spawn.shell.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()
    this.createdByReplacementToken = createdByReplacementToken
    this.replacementFingerprint = replacementAttachFingerprint(spawn, scrollback)
    this.proc = pty.spawn(spawn.shell, spawn.args, {
      name: 'xterm-256color',
      cols: Math.max(1, spawn.cols),
      rows: Math.max(1, spawn.rows),
      cwd: spawn.cwd,
      env: spawn.env
    })
    this.term = new TerminalEmulator({ cols: spawn.cols, rows: spawn.rows, scrollback })
  }

  async executeInitialLaunch(
    spawn: SessionHostSpawnOptions,
    readinessProbe?: () => Promise<boolean>
  ): Promise<ExecuteLaunchResult | undefined> {
    const initial = spawn.initialLaunch
    if (!initial) return undefined
    return this.executeLaunch(
      initial.launchId,
      initial.command,
      initial.stdinAfterStart,
      readinessProbe
    )
  }

  matchesReplacementReplay(spawn: SessionHostSpawnOptions, scrollback: number): boolean {
    return this.replacementFingerprint === replacementAttachFingerprint(spawn, scrollback)
  }

  dispose(): void {
    this.term.dispose()
  }

  async executeLaunch(
    launchId: string,
    command: string,
    stdinAfterStart?: string,
    readinessProbe?: () => Promise<boolean>
  ): Promise<ExecuteLaunchResult> {
    if (!this.launchDialect) {
      throw new Error('session-host terminal has no trusted launch dialect')
    }
    if (!UUID_V4.test(launchId)) throw new Error('session-host launch id is invalid')
    if (!command || command.length > 128 * 1024 || command.includes('\0')) {
      throw new Error('session-host launch input is invalid')
    }
    if (
      stdinAfterStart !== undefined &&
      (stdinAfterStart.length > 1024 * 1024 || stdinAfterStart.includes('\0'))
    ) {
      throw new Error('session-host launch follow-up input is invalid')
    }
    const fingerprint = launchFingerprint(command, stdinAfterStart)
    const existing = this.launchLedger.get(launchId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error('session-host launch id was reused with different input')
      }
      const outcome = await existing.outcome
      if (!outcome.ok) throw new Error('session-host launch delivery previously failed')
      return { status: 'already-executed' }
    }

    // Never evict within a live generation. Eviction would make an old lost-reply retry execute a
    // second time; at the bounded cap, fail new ids closed until this generation ends.
    if (this.launchLedger.size >= MAX_LAUNCH_LEDGER_ENTRIES) {
      throw new Error('session-host launch ledger is full for this terminal generation')
    }

    const execution = this.launchQueue
      .catch(() => {
        // A failed older launch must not poison the serialization queue for a distinct id.
      })
      .then(() => this.deliverLaunch(command, stdinAfterStart, readinessProbe))
    const outcome = execution.then(
      () => ({ ok: true }) as const,
      () => ({ ok: false }) as const
    )
    const entry: LaunchLedgerEntry = { fingerprint, outcome }
    // Insert before the queued work can begin. This is the exactly-once commit point.
    this.launchLedger.set(launchId, entry)
    this.launchQueue = execution.catch(() => {})
    const result = await outcome
    if (!result.ok) throw new Error('session-host launch delivery failed')
    return { status: 'executed' }
  }

  private async deliverLaunch(
    command: string,
    stdinAfterStart?: string,
    readinessProbe?: () => Promise<boolean>
  ): Promise<void> {
    await this.waitForOutputQuiet(SHELL_QUIET_CAP_MS)
    await this.deliverVerifiedCommand(command)
    if (stdinAfterStart !== undefined) {
      // Time/quiet alone is not readiness: a short-lived failed agent can already have returned to
      // the shell prompt. Require the host's process-tree probe to observe a non-shell descendant
      // before literal follow-up input is allowed anywhere near the terminal.
      if (!readinessProbe) throw new Error('session-host has no launch readiness probe')
      await this.waitForLaunchReadiness(readinessProbe)
      await this.waitForOutputQuiet(SHELL_QUIET_MS)
      if (this.exited) throw new Error('session-host terminal exited during launch delivery')
      try {
        this.privateLaunchOutput = true
        this.proc.write(stdinAfterStart)
        this.proc.write('\r')
        // Keep any asynchronous terminal echo private through one bounded settle window.
        await this.waitForOutputQuiet(SHELL_QUIET_CAP_MS)
      } catch {
        throw new Error('session-host could not deliver launch follow-up input')
      } finally {
        this.privateLaunchOutput = false
      }
    }
  }

  private async waitForLaunchReadiness(probe: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + POST_LAUNCH_READY_CAP_MS
    while (!this.exited && Date.now() < deadline) {
      try {
        if (await probe()) return
      } catch {
        // A failed read is uncertainty, never readiness. Keep polling within the fixed bound.
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, LAUNCH_READINESS_POLL_MS)
        timer.unref?.()
      })
    }
    if (this.exited) throw new Error('session-host terminal exited during launch delivery')
    throw new Error('session-host could not confirm launched agent readiness')
  }

  private waitForOutputQuiet(capMs: number): Promise<void> {
    if (this.exited) return Promise.reject(new Error('session-host terminal exited during launch delivery'))
    return new Promise<void>((resolve, reject) => {
      let done = false
      let quietTimer: ReturnType<typeof setTimeout> | undefined
      let dataSub: { dispose(): void } | undefined
      let exitSub: { dispose(): void } | undefined
      const capTimer = setTimeout(() => finish(), capMs)
      capTimer.unref?.()
      const cleanup = (): void => {
        clearTimeout(capTimer)
        if (quietTimer) clearTimeout(quietTimer)
        dataSub?.dispose()
        exitSub?.dispose()
      }
      const finish = (error?: Error): void => {
        if (done) return
        done = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      dataSub = this.proc.onData(() => {
        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = setTimeout(() => finish(), SHELL_QUIET_MS)
        quietTimer.unref?.()
      })
      exitSub = this.proc.onExit(() =>
        finish(new Error('session-host terminal exited during launch delivery'))
      )
    })
  }

  private deliverVerifiedCommand(command: string): Promise<void> {
    if (this.exited) return Promise.reject(new Error('session-host terminal exited during launch delivery'))
    return new Promise<void>((resolve, reject) => {
      this.privateLaunchOutput = true
      let done = false
      let attempt = 0
      let echoed = ''
      let timer: ReturnType<typeof setTimeout> | undefined
      let dataSub: { dispose(): void } | undefined
      let exitSub: { dispose(): void } | undefined
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        dataSub?.dispose()
        exitSub?.dispose()
      }
      const finish = (error?: Error): void => {
        if (done) return
        done = true
        this.privateLaunchOutput = false
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const write = (data: string): boolean => {
        try {
          this.proc.write(data)
          return true
        } catch {
          finish(new Error('session-host could not deliver launch input'))
          return false
        }
      }
      const submit = (): void => {
        if (!write('\r')) return
        finish()
      }
      const tryOnce = (): void => {
        if (done) return
        attempt++
        echoed = ''
        timer = setTimeout(() => {
          if (done) return
          if (attempt >= DELIVERY_ATTEMPTS) {
            // Never submit an unverified/mangled command. Clear it so the terminal remains
            // recoverable, cache the fixed failure, and let explicit user action decide next.
            write(KILL_LINE)
            finish(new Error('session-host could not verify launch command delivery'))
            return
          }
          if (!write(KILL_LINE)) return
          tryOnce()
        }, VERIFY_TIMEOUT_MS)
        timer.unref?.()
        write(command)
      }
      dataSub = this.proc.onData((chunk) => {
        if (done) return
        echoed = (echoed + cleanEcho(chunk)).slice(-Math.max(command.length + 256, 512))
        if (echoed.includes(command.slice(-ECHO_TAIL_CHARS))) submit()
      })
      exitSub = this.proc.onExit(() =>
        finish(new Error('session-host terminal exited during launch delivery'))
      )
      tryOnce()
    })
  }

  /** Release node-pty's Windows ConPTY handle after the independently verified `/T /F` process
   * tree termination. `WindowsTerminal.kill()` cannot be used here: node-pty defers that public
   * method until the first output byte, so a valid silent process would keep its host-parented
   * conhost alive forever. The internal agent call is the narrow upstream-compatible primitive
   * that closes the ConPTY handle; the host still waits for this pty's real `onExit` before ack. */
  releaseWindowsPtyAfterExternalTreeKill(): void {
    if (process.platform !== 'win32') {
      throw new Error('external ConPTY release is Windows-only')
    }
    const internal = this.proc as unknown as {
      _close?: () => void
      _agent?: { kill?: () => void }
    }
    if (typeof internal._close !== 'function' || typeof internal._agent?.kill !== 'function') {
      throw new Error('installed node-pty does not expose the required ConPTY release primitive')
    }
    internal._close()
    internal._agent.kill()
  }
}
