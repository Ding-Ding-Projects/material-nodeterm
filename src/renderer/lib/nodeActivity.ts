import { useEffect, useState } from 'react'

/**
 * When each node last had something happen in it, and ONE clock that every surface reading those
 * numbers shares.
 *
 * Two ADHD modes need this and neither can afford the obvious implementations:
 *
 *   - TIME AWARENESS renders an elapsed readout on the node itself. A `setInterval` per node would
 *     put one timer on the event loop per terminal on the canvas — a canvas routinely holds dozens
 *     — and every one of them would wake React. So there is exactly one module-level interval here,
 *     started when the first subscriber arrives and stopped when the last one leaves. With both
 *     modes off nothing subscribes and the timer never exists at all, which is the property an
 *     accommodation that is off by default owes the people who leave it off.
 *   - MOMENTUM asks "has anything changed here for N minutes", which needs a timestamp updated on
 *     every byte a terminal produces. That cannot be store state: a flooding terminal would re-render
 *     the canvas thousands of times a second. So activity lives in a plain Map that nothing
 *     subscribes to, and the minute tick is what makes a reader look at it again.
 *
 * The two halves are deliberately separate: writing is free and unobserved, reading is coarse and
 * shared. `formatElapsed` is minute-granular by design (see `adhdModes.ts`), so a reader being up to
 * one tick behind is invisible rather than a bug.
 */

/** How often a subscriber is woken. Matches the coarsest thing `formatElapsed` can say. */
export const ACTIVITY_TICK_MS = 60_000

export interface NodeActivity {
  /** When this window first opened the node. NOT when the tmux session was created — an app
   *  restart reattaches a session that may be days old, and claiming otherwise would be a number
   *  the app cannot actually know. Every surface that shows it says "in this window". */
  openedAt: number
  /** The last time anything happened here: output from the process, or a keystroke into it. */
  lastActivityAt: number
}

/**
 * Bounded so a very long session cannot grow this forever. Nodes are not removed on unmount — a
 * project switch unmounts every terminal, and forgetting there would restart the clock on a
 * session that has been sitting untouched for an hour, which is exactly the case momentum exists
 * to notice.
 */
const MAX_TRACKED = 500

const activity = new Map<string, NodeActivity>()

function prune(): void {
  if (activity.size <= MAX_TRACKED) return
  const oldest = [...activity.entries()]
    .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt)
    .slice(0, activity.size - MAX_TRACKED)
  for (const [id] of oldest) activity.delete(id)
}

/** Record that a node's session is open. Idempotent: re-running a node's lifecycle (an offscreen
 *  release and revive, a respawn onto the same tmux session) must not restart its clock. */
export function markNodeOpened(nodeId: string, now: number = Date.now()): void {
  if (activity.has(nodeId)) return
  activity.set(nodeId, { openedAt: now, lastActivityAt: now })
  prune()
}

/** Record that something happened. Called from the PTY data path, so it stays one Map lookup and
 *  one assignment — no allocation, no store write, no render. */
export function markNodeActivity(nodeId: string, now: number = Date.now()): void {
  const entry = activity.get(nodeId)
  if (entry) {
    entry.lastActivityAt = now
    return
  }
  activity.set(nodeId, { openedAt: now, lastActivityAt: now })
  prune()
}

/** What is known about a node, or `null` when nothing has been recorded for it yet. */
export function nodeActivity(nodeId: string): NodeActivity | null {
  return activity.get(nodeId) ?? null
}

/** Drop everything. Tests only — production never needs to forget a whole canvas at once. */
export function resetNodeActivity(): void {
  activity.clear()
}

// ---------------------------------------------------------------------------------------------
// The one clock.

type Tick = () => void

const subscribers = new Set<Tick>()
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Wake `cb` about once a minute for as long as the returned unsubscribe has not been called. The
 * interval exists only while somebody is listening.
 */
export function subscribeActivityTick(cb: Tick): () => void {
  subscribers.add(cb)
  if (timer === null) {
    timer = setInterval(() => {
      for (const sub of [...subscribers]) sub()
    }, ACTIVITY_TICK_MS)
  }
  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** True while the shared interval is running. Tests assert that "off" really costs nothing. */
export function activityTickRunning(): boolean {
  return timer !== null
}

/**
 * Re-render about once a minute while `enabled`. The returned number is meaningless on its own —
 * it exists only to change, so the caller re-reads `Date.now()` and the activity map.
 *
 * `enabled: false` subscribes to nothing, so a person with both modes off pays for no timer.
 */
export function useActivityTick(enabled: boolean): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    return subscribeActivityTick(() => setTick((n) => n + 1))
  }, [enabled])
  return enabled ? tick : 0
}
