// Session budget: reap long-idle nt- tmux sessions under memory pressure (or past a count cap),
// so abandoned agent sessions can't accumulate until the host swaps itself to death (field report:
// 95 sessions / 34 GB of idle claude processes on one host).
//
// This is the tmux counterpart of the renderer's WebGL budget (`terminal/webgl-budget.ts`), and it
// deliberately reuses that design's rules rather than inventing an expiry policy:
//   - a bounded budget, enforced only when exceeded — never a calendar-based expiry;
//   - eviction picks the LEAST-RECENTLY-ACTIVE holder;
//   - a recently-active session is protected by a grace window (the WebGL release delay);
//   - reaping is gradual (per-sweep batch), so one sweep can never mass-kill its way past the
//     target — the next sweep re-evaluates.
//
// ATTACHMENT IS NOT PART OF THAT ANALOGY, and used to be — the rule was "an attached session is
// never evicted, exactly like a visible WebGL holder". It made the reaper a structural no-op:
// measured on the multi-tenant host, 54 of 54 nt- sessions reported attached=1 and `planReap`
// returned [] on every sweep it had ever run. The analogy breaks because the two words mean
// different things. WebGL "visible" is a live attention signal — the terminal is inside the
// viewport at this instant. tmux "attached" only means a mounted node exists somewhere, which is
// true for every node on every project's canvas whether or not the user is looking at that
// project, and whether or not it has been touched in a week. The honest analogue of "visible"
// (node is in the ACTIVE project's viewport) is renderer state the host-side reaper cannot see.
//
// So activity staleness is the only signal left, and it carries the protection alone: the grace
// window is now the whole guard, which is why it defaults to a day rather than the 6 h that was
// safe back when attachment was also required. Measured on the same host: over a 3-minute sample,
// 5 of 53 attached sessions advanced their activity and 48 did not — attachment separates nothing,
// activity separates cleanly.
//
// Killing an idle session is safe BECAUSE of the cold-restore contract: to the node, a reap is
// indistinguishable from a machine reboot. On next open `tmux has-session` fails → fresh=true →
// the renderer replays the scrollback snapshot and re-launches a resumable agent
// (`claude --resume …`). For that to hold, the reaper must kill ONLY the tmux session: it must
// never delete scrollback snapshots and never write a pty-manager tombstone (both belong to the
// user-deletes-the-node path, `destroySession`).
//
// Electron-free (src/core): all exec/mem/clock access is behind injectable seams (template:
// ack-sweep.ts), so both shells boot it and tests drive it without touching tmux.

import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { TMUX_SOCKET } from './tmux-naming'
import { RMT_TMUX_SOCKET } from './remote-ssh/control-master'
import { readMemInfo, type MemInfo } from './session-memory'

const runAsync = promisify(execFile)

// One definition, two consumers (the reaper's watermark and the system-resource pill): a copied
// second reader would let them disagree about how much RAM is free.
export { readMemInfo, type MemInfo } from './session-memory'

/** One tmux session as reported by `list-sessions`. `activitySec` is epoch seconds. */
export interface SessionInfo {
  name: string
  /**
   * How many clients tmux reports attached. A COUNT, not a flag: `#{session_attached}` is the
   * number of clients, and one session can have several — the app's painter, the user's own `tmux
   * -L node-terminal attach`, a second nodeterm process on the same socket, one of our
   * control-mode shadows.
   *
   * Carried numerically rather than collapsed to a boolean so the existing `shadowed` seam can
   * continue to normalize this diagnostic fact without changing its public shape. Reaping itself
   * deliberately ignores attachment and uses activity age; see the module header.
   */
  clients: number
  activitySec: number
}

export interface SessionBudgetConfig {
  /** Kill switch (`NODETERM_SESSION_REAP_DISABLED=1`): sweeps become no-ops. */
  disabled: boolean
  /** Watermark: reap only while host available memory is BELOW this (primary trigger). */
  minAvailableMb: number
  /** Backstop: max idle-past-grace nt- sessions across sockets; excess is reaped without pressure. */
  maxIdle: number
  /** A session with activity newer than this is never reaped. Sole guard — see the header. */
  graceSec: number
  /** Max kills per sweep — convergence is gradual and re-evaluated each sweep. */
  batchMax: number
}

/**
 * A positive INTEGER from the environment, or the fallback.
 *
 * The floor is `>= 1`, not `> 0`, and that is the whole point: `Math.floor(0.5)` is 0, and a zero
 * here is not a smaller setting — it is the REMOVAL of a safety. `MAX_DETACHED=0.5` became a cap of
 * zero, so every detached session counted as over-cap and a full batch died every sweep;
 * `GRACE_HOURS=0.5` became zero grace, so a session was reapable the moment it detached.
 *
 * The asymmetry is what makes it dangerous rather than merely wrong: `abc`, `''` and `0` all fall
 * back to the safe default, while `0.5` — the most PLAUSIBLE thing an operator would type, meaning
 * "half" — silently disarmed the guard. A hand-editable value must degrade to the safe default,
 * never to something more destructive than the default.
 *
 * Sub-hour grace is a legitimate wish, so it is served properly by `envHours` rather than being
 * floored into nothing.
 */
function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Number(env[key])
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

/** Hours as a possibly-FRACTIONAL positive number, returned in seconds. `0.5` means 30 minutes —
 *  the reading the operator intended — instead of `Math.floor`-ing to no grace at all. */
function envHours(env: NodeJS.ProcessEnv, key: string, fallbackHours: number): number {
  const n = Number(env[key])
  return Math.round((Number.isFinite(n) && n > 0 ? n : fallbackHours) * 3600)
}

/**
 * Defaults, overridable per host via env (systemd `Environment=` lines):
 *   NODETERM_SESSION_MIN_AVAILABLE_MB  (default: 10% of total RAM, floor 1 GB)
 *   NODETERM_SESSION_MAX_IDLE          (default: 48)
 *   NODETERM_SESSION_GRACE_HOURS       (default: 24)
 *   NODETERM_SESSION_REAP_BATCH        (default: 8)
 *   NODETERM_SESSION_REAP_DISABLED=1   (kill switch)
 *
 * `NODETERM_SESSION_MAX_DETACHED` is still read as a fallback: the cap it names counts a different
 * population now (idle rather than detached), but an operator who set it meant "do not let more
 * than N of these pile up", and that intent survives the rename. Dropping it would silently
 * restore the default on hosts that had deliberately tuned it.
 *
 * The grace default is 24 h, not the original 6 h, because attachment no longer gates eligibility
 * (see the header): grace is the only thing standing between a session someone left open over
 * lunch and a sweep that happens to run while memory is tight.
 */
export function sessionBudgetConfig(env: NodeJS.ProcessEnv, totalMb: number): SessionBudgetConfig {
  return {
    disabled: env.NODETERM_SESSION_REAP_DISABLED === '1' || env.NODETERM_SESSION_REAP_DISABLED === 'true',
    minAvailableMb: envInt(env, 'NODETERM_SESSION_MIN_AVAILABLE_MB', Math.max(1024, Math.round(totalMb * 0.1))),
    maxIdle: envInt(env, 'NODETERM_SESSION_MAX_IDLE', envInt(env, 'NODETERM_SESSION_MAX_DETACHED', 48)),
    graceSec: envHours(env, 'NODETERM_SESSION_GRACE_HOURS', 24),
    batchMax: envInt(env, 'NODETERM_SESSION_REAP_BATCH', 8)
  }
}

/**
 * Pure policy: which sessions to kill this sweep, least-recently-active first.
 *
 * Eligible = named `nt-*` AND idle past the grace window. Attachment is deliberately NOT consulted
 * — see the header for why it separated nothing on a canvas app. Then:
 *   - memory below the watermark → up to `batchMax` (a failed memory read — `mem === null` — is
 *     NOT pressure: absence of evidence never triggers the primary path);
 *   - `externalPressure` → the same allowance, for a resource this module cannot measure (today:
 *     pty devices — see core/pty-pressure.ts). It exists because the 2026-08-11 host had HEALTHY
 *     memory and sat well under `maxIdle` while being unable to open a single terminal, so
 *     every term above was zero and the sweep the shell fired was a no-op;
 *   - idle count over `maxIdle` → the excess, even with healthy memory;
 * combined take is bounded by `batchMax`.
 *
 * An allowance is not an exemption: `externalPressure` raises how MANY of the eligible may go, and
 * touches nothing about which sessions are eligible. Sessions inside the grace window stay
 * unkillable under it, exactly as under memory pressure — that is this module's one hard rule and
 * no caller gets to spend it.
 *
 * The cap counts the ELIGIBLE population, not every nt- session: a host where fifty sessions are
 * all in active use is not accumulating anything, and a cap that fired on it would reap sessions
 * out from under people who are working. What the backstop is meant to bound is the idle pile.
 */
export function planReap(
  sessions: SessionInfo[],
  mem: MemInfo | null,
  nowSec: number,
  cfg: SessionBudgetConfig,
  externalPressure = false
): string[] {
  if (cfg.disabled) return []
  const eligible = sessions
    .filter((s) => s.name.startsWith('nt-'))
    .filter((s) => nowSec - s.activitySec >= cfg.graceSec)
    .sort((a, b) => a.activitySec - b.activitySec)

  const lowMem = mem !== null && mem.availableMb < cfg.minAvailableMb
  const pressure = lowMem || externalPressure ? cfg.batchMax : 0
  const overCap = Math.max(0, eligible.length - cfg.maxIdle)
  const take = Math.min(cfg.batchMax, Math.max(pressure, overCap))
  return eligible.slice(0, take).map((s) => s.name)
}

/** Parse `list-sessions -F '#{session_name}|#{session_attached}|#{session_activity}'` output.
 *  Tolerant: malformed lines are skipped, never thrown on. */
export function parseSessionList(stdout: string): SessionInfo[] {
  const out: SessionInfo[] = []
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split('|')
    if (parts.length !== 3) continue
    const attached = Number(parts[1])
    const activity = Number(parts[2])
    if (!parts[0] || !Number.isFinite(attached) || !Number.isFinite(activity)) continue
    out.push({ name: parts[0], clients: Math.max(0, attached), activitySec: activity })
  }
  return out
}

/**
 * The DEFAULT host-memory reader — still silent on **darwin**, but no longer for the reason this
 * comment used to give.
 *
 * The original reason was that `readMemInfo` fell back to `os.freemem()` off Linux, which on darwin
 * counts only genuinely free pages — excluding inactive, purgeable and compressor pages, all of
 * which macOS hands back on demand. A healthy Mac idles at a few hundred MB "free", under BOTH
 * watermarks, so this monitor would have sat permanently CRITICAL on the primary desktop platform.
 * (The same reading had the session reaper culling idle detached sessions on every sweep — a
 * confirmed field symptom, reported as "my sessions keep disappearing".)
 *
 * That instrument is fixed: `readMemInfo` now reads `vm_stat` on darwin, VERIFIED on a real 24 GB
 * Mac (2026-08-12) — Activity Monitor's App 7.67 + Wired 2.95 + Compressed 8.38 = 19.00 GB against
 * our 19.1 GB, where the same machine read 23.9/24.0 before. So the REAPER's watermark is honest
 * there now, which is what closed the bug.
 *
 * **This leg stays silent anyway, and the verification is what sharpened the reason.** Available
 * BYTES is not macOS's pressure signal. That same capture had the machine at 82% used with 8.38 GB
 * compressed and 1.77 GB of swap in use — and macOS's own Memory Pressure graph was GREEN. A
 * watermark at 10%/5% available therefore fires in states the OS itself calls healthy, and the
 * critical one sweeps the reaper: we would cull sessions on a machine macOS says is fine. That is
 * the same class of mistake as the bug this started with, reached from the other direction.
 *
 * Follow-up (unchanged in shape, sharper in target): give this leg macOS's REAL pressure signal —
 * `kern.memorystatus_vm_pressure_level`, or the `memory_pressure` tool — rather than a byte count.
 */
export function hostMemReader(platform: NodeJS.Platform = process.platform): () => MemInfo | null {
  return platform === 'darwin' ? (): null => null : readMemInfo
}

export interface SessionReaperOpts {
  /** Lazy tmux binary resolver (PtyManager resolves after init; null = tmux unavailable → no-op). */
  tmuxBin: () => string | null
  /** tmux sockets to sweep. Default: the local socket + the SSH-remote socket — a host that serves
   *  SSH projects accumulates sessions on `nodeterm-rmt`, and its own nodeterm-server (this
   *  process) is the natural owner of reaping them; the desktops that spawned them may be gone. */
  sockets?: string[]
  /**
   * The tmux sessions THIS process holds a control-mode client on, per socket — a per-session
   * shadow or the shared background-write client (see `PtyManager.shadowedTmuxSessions`). Each name
   * listed has exactly ONE client subtracted from its diagnostic count. The seam remains for
   * compatibility with the PTY manager and its focused accounting, but attachment no longer gates
   * the reaper: activity age is the sole live-work signal available to this host-side policy.
   *
   * At most one of ours per name: PtyManager retires the shared client before shadowing the session
   * it is attached to, so nothing here ever owes a subtraction of two.
   *
   * Per SOCKET, not per name: `nt-<node>` is only unique within a socket.
   */
  shadowed?: (socket: string) => Iterable<string>
  exec?: (bin: string, args: string[]) => Promise<string>
  readMem?: () => MemInfo | null
  env?: NodeJS.ProcessEnv
  nowSec?: () => number
  intervalMs?: number
  log?: (msg: string) => void
}

/**
 * A resource OUTSIDE this module's instruments that is exhausted right now, named by the shell
 * that measured it. Today only pty devices (`kern.tty.ptmx_max`, core/pty-pressure.ts).
 */
export type SweepPressure = 'pty'

export interface SweepOptions {
  /** Grant this sweep the same allowance low memory would. Omitted ⇒ ordinary budget semantics. */
  pressure?: SweepPressure
}

export interface SessionReaper {
  /** One sweep; resolves to the number of sessions killed. Never throws. */
  sweep(opts?: SweepOptions): Promise<number>
  start(): void
  stop(): void
}

export const SESSION_SWEEP_INTERVAL_MS = 10 * 60_000

/**
 * Periodic reaper over the injectable seams. Failure rules (CLAUDE.md: a failed read is never
 * evidence of absence): a socket whose `list-sessions` fails contributes NO candidates — only a
 * successful listing can put a session on the kill list, and the kill is re-verified against a
 * FRESH listing at kill time (a session whose activity advanced between plan and kill is spared).
 */
export function createSessionReaper(opts: SessionReaperOpts): SessionReaper {
  const sockets = opts.sockets ?? [TMUX_SOCKET, RMT_TMUX_SOCKET]
  const exec =
    opts.exec ??
    (async (bin: string, args: string[]): Promise<string> => {
      const { stdout } = await runAsync(bin, args, { timeout: 15_000 })
      return stdout
    })
  // Platform-aware BY DEFAULT — not injected by the shells. A wiring line can be deleted with
  // the suite green (measured); a default cannot. See hostMemReader for why darwin is silent.
  const readMem = opts.readMem ?? hostMemReader()
  const env = opts.env ?? process.env
  const nowSec = opts.nowSec ?? ((): number => Math.floor(Date.now() / 1000))
  const log = opts.log ?? ((m: string): void => console.log(m))
  const cfg = sessionBudgetConfig(env, readMem()?.totalMb ?? Math.round(os.totalmem() / 1048576))

  const LIST_FMT = '#{session_name}|#{session_attached}|#{session_activity}'

  const listSocket = async (bin: string, socket: string): Promise<SessionInfo[] | null> => {
    try {
      const listed = parseSessionList(await exec(bin, ['-L', socket, 'list-sessions', '-F', LIST_FMT]))
      // Preserve the existing per-socket client-count normalization for callers and diagnostics.
      // The reaper's decision intentionally ignores the resulting count and follows activity age.
      const shadowed = new Set(opts.shadowed?.(socket) ?? [])
      if (shadowed.size === 0) return listed
      return listed.map((s) =>
        s.clients > 0 && shadowed.has(s.name) ? { ...s, clients: s.clients - 1 } : s
      )
    } catch {
      // "no server running" and a real failure both land here; neither yields candidates.
      return null
    }
  }

  const sweep = async (sweepOpts?: SweepOptions): Promise<number> => {
    if (cfg.disabled) return 0
    const bin = opts.tmuxBin()
    if (!bin) return 0

    const bySocket = new Map<string, SessionInfo[]>()
    for (const s of sockets) {
      const listed = await listSocket(bin, s)
      if (listed) bySocket.set(s, listed)
    }
    if (bySocket.size === 0) return 0

    const all = [...bySocket.entries()].flatMap(([, list]) => list)
    const plan = new Set(planReap(all, readMem(), nowSec(), cfg, sweepOpts?.pressure !== undefined))
    if (plan.size === 0) return 0

    let killed = 0
    for (const [socket, listed] of bySocket) {
      const names = listed.filter((s) => plan.has(s.name)).map((s) => s.name)
      if (names.length === 0) continue
      // Kill-time re-verify on a FRESH list: only sessions still present and STILL IDLE die. This
      // used to re-check attachment; it now re-checks the same rule that made the session eligible,
      // so a session that woke up between planning and killing is spared on the signal that
      // actually means it woke up. A sweep can take seconds across sockets, and the whole point of
      // re-verifying is that the world may have moved in between.
      const fresh = await listSocket(bin, socket)
      if (!fresh) continue
      const now = nowSec()
      const stillIdle = new Set(
        fresh.filter((s) => now - s.activitySec >= cfg.graceSec).map((s) => s.name)
      )
      for (const name of names) {
        if (!stillIdle.has(name)) continue
        try {
          // `=` forces an exact target match — never tmux's prefix matching.
          await exec(bin, ['-L', socket, 'kill-session', '-t', `=${name}`])
          killed++
          log(`[session-budget] reaped idle session ${name} (socket ${socket})`)
        } catch {
          // A vanished-in-between session or a kill failure changes nothing; next sweep re-plans.
        }
      }
    }
    return killed
  }

  let timer: ReturnType<typeof setInterval> | null = null
  return {
    sweep,
    start(): void {
      if (timer) return
      timer = setInterval(() => void sweep(), opts.intervalMs ?? SESSION_SWEEP_INTERVAL_MS)
      timer.unref?.()
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
