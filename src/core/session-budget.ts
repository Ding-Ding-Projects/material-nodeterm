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

import fs from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { TMUX_SOCKET } from './tmux-naming'
import { RMT_TMUX_SOCKET } from './remote-ssh/control-master'

const runAsync = promisify(execFile)

/** One tmux session as reported by `list-sessions`. `activitySec` is epoch seconds. */
export interface SessionInfo {
  name: string
  attached: boolean
  activitySec: number
}

/** Host memory snapshot in MB. `null` from a reader means "could not read" — see planReap. */
export interface MemInfo {
  availableMb: number
  totalMb: number
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

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const n = Number(env[key])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
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
    graceSec: envInt(env, 'NODETERM_SESSION_GRACE_HOURS', 24) * 3600,
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
 *   - idle count over `maxIdle` → the excess, even with healthy memory;
 * combined take is bounded by `batchMax`.
 *
 * The cap counts the ELIGIBLE population, not every nt- session: a host where fifty sessions are
 * all in active use is not accumulating anything, and a cap that fired on it would reap sessions
 * out from under people who are working. What the backstop is meant to bound is the idle pile.
 */
export function planReap(
  sessions: SessionInfo[],
  mem: MemInfo | null,
  nowSec: number,
  cfg: SessionBudgetConfig
): string[] {
  if (cfg.disabled) return []
  const eligible = sessions
    .filter((s) => s.name.startsWith('nt-'))
    .filter((s) => nowSec - s.activitySec >= cfg.graceSec)
    .sort((a, b) => a.activitySec - b.activitySec)

  const pressure = mem !== null && mem.availableMb < cfg.minAvailableMb ? cfg.batchMax : 0
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
    out.push({ name: parts[0], attached: attached > 0, activitySec: activity })
  }
  return out
}

/** Linux `/proc/meminfo` (MemAvailable is the honest number); `os.freemem()` fallback elsewhere.
 *  Returns null when nothing readable — the policy treats that as "no pressure signal". */
export function readMemInfo(): MemInfo | null {
  try {
    const text = fs.readFileSync('/proc/meminfo', 'utf8')
    const avail = /MemAvailable:\s+(\d+)\s*kB/.exec(text)
    const total = /MemTotal:\s+(\d+)\s*kB/.exec(text)
    if (avail && total) {
      return { availableMb: Math.round(Number(avail[1]) / 1024), totalMb: Math.round(Number(total[1]) / 1024) }
    }
  } catch {
    // fall through to the os fallback
  }
  try {
    return { availableMb: Math.round(os.freemem() / 1048576), totalMb: Math.round(os.totalmem() / 1048576) }
  } catch {
    return null
  }
}

export interface SessionReaperOpts {
  /** Lazy tmux binary resolver (PtyManager resolves after init; null = tmux unavailable → no-op). */
  tmuxBin: () => string | null
  /** tmux sockets to sweep. Default: the local socket + the SSH-remote socket — a host that serves
   *  SSH projects accumulates sessions on `nodeterm-rmt`, and its own nodeterm-server (this
   *  process) is the natural owner of reaping them; the desktops that spawned them may be gone. */
  sockets?: string[]
  exec?: (bin: string, args: string[]) => Promise<string>
  readMem?: () => MemInfo | null
  env?: NodeJS.ProcessEnv
  nowSec?: () => number
  intervalMs?: number
  log?: (msg: string) => void
}

export interface SessionReaper {
  /** One sweep; resolves to the number of sessions killed. Never throws. */
  sweep(): Promise<number>
  start(): void
  stop(): void
}

export const SESSION_SWEEP_INTERVAL_MS = 10 * 60_000

/**
 * Periodic reaper over the injectable seams. Failure rules (CLAUDE.md: a failed read is never
 * evidence of absence): a socket whose `list-sessions` fails contributes NO candidates — only a
 * successful listing can put a session on the kill list, and the kill is re-verified against a
 * FRESH listing at kill time (a session that got attached between plan and kill is spared).
 */
export function createSessionReaper(opts: SessionReaperOpts): SessionReaper {
  const sockets = opts.sockets ?? [TMUX_SOCKET, RMT_TMUX_SOCKET]
  const exec =
    opts.exec ??
    (async (bin: string, args: string[]): Promise<string> => {
      const { stdout } = await runAsync(bin, args, { timeout: 15_000 })
      return stdout
    })
  const readMem = opts.readMem ?? readMemInfo
  const env = opts.env ?? process.env
  const nowSec = opts.nowSec ?? ((): number => Math.floor(Date.now() / 1000))
  const log = opts.log ?? ((m: string): void => console.log(m))
  const cfg = sessionBudgetConfig(env, readMem()?.totalMb ?? Math.round(os.totalmem() / 1048576))

  const LIST_FMT = '#{session_name}|#{session_attached}|#{session_activity}'

  const listSocket = async (bin: string, socket: string): Promise<SessionInfo[] | null> => {
    try {
      return parseSessionList(await exec(bin, ['-L', socket, 'list-sessions', '-F', LIST_FMT]))
    } catch {
      // "no server running" and a real failure both land here; neither yields candidates.
      return null
    }
  }

  const sweep = async (): Promise<number> => {
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
    const plan = new Set(planReap(all, readMem(), nowSec(), cfg))
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
