// Atomic file writes that survive Windows.
//
// Every store in this app persists the same way: write a temp file, then rename it over the
// target, so a reader sees either the old bytes or the new ones and never a half-written file.
// That is correct on POSIX, where `rename(2)` is atomic and replaces the destination
// unconditionally.
//
// It is NOT sufficient on Windows, and the difference is quiet. `MoveFileEx` fails with a sharing
// violation — surfacing through Node as `EPERM` (sometimes `EACCES`/`EBUSY`) — whenever the
// DESTINATION is open by anyone at that instant. Not held open for long: opened. The usual
// culprits are not exotic:
//
//   - Windows Defender's real-time scanner opens each file we just wrote, to scan it;
//   - the search indexer does the same;
//   - a backup or sync client (OneDrive over a user profile, very common) holds a read handle;
//   - two of our own concurrent writers race their renames onto one destination.
//
// The last one is reproducible on demand and is what exposed this: the approved-devices store has
// three un-queued writers, and its own test — which deliberately overlaps two saves — fails on
// Windows with `EPERM: operation not permitted, rename`. It passed on POSIX for as long as the
// store has existed.
//
// The consequence is worse than a failed save. These are the stores holding the user's canvas
// layout, their settings, their pinned remote devices and their sealed credentials. On Windows a
// scanner touching the file at the wrong millisecond turned a routine save into a thrown error,
// and the save was simply lost — intermittently, unreproducibly, and more often on exactly the
// machines that are most protected.
//
// One file already knew. `src/core/github/cache.ts` carried a full write-up of this — naming
// EPERM, naming NTFS, and citing a direct measurement: "two concurrent writers to one path failed
// with EPERM in roughly 3 of 5 runs on this host" — and had its own bounded retry loop. It had had
// it for some time. The knowledge sat in that one file and reached none of the other twenty-odd
// stores doing the identical thing a few directories away, because a comment cannot propagate and
// nothing scanned for the pattern. That is the argument for the guard test beside this file rather
// than for another comment: a written explanation protects the file it is written in.
//
// The fix is the standard one: retry the rename briefly. Each attempt is still a single atomic
// rename, so retrying cannot tear a write — it only tries the same indivisible operation again
// once whoever held the destination has let go. The window these scanners hold is milliseconds.
//
// What this deliberately does NOT do:
//   - It does not retry forever. A genuinely locked file must fail, and fail loudly: several
//     callers (revocation.ts's `persisted:false`, for one) have contracts that depend on a failed
//     save being reported as a failed save.
//   - It does not retry every error. `ENOENT` means the temp file is gone, which is a bug in the
//     caller, and retrying only delays a clearer error. `ENOSPC` will not improve by waiting.
//   - It does not swallow the final failure. The last error is thrown with its original code.

import { promises as fs, renameSync } from 'fs'

/**
 * Errors that mean "someone else has the destination open right now", rather than "this will
 * never work". Windows reports a sharing violation as EPERM most often, EACCES and EBUSY
 * occasionally, depending on which layer refused.
 */
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** Backoff between rename attempts, in ms. Five tries over ~310 ms total.
 *
 *  Sized against what actually holds the file: an antivirus or indexer scan of a small JSON file
 *  finishes in single-digit milliseconds, so the first retry usually wins. The long tail exists
 *  for a sync client mid-upload. It stays under a third of a second because these calls sit
 *  behind user actions — a save that blocks for seconds is its own defect. */
const RETRY_DELAYS_MS = [10, 25, 75, 200]

function codeOf(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Rename `tmp` over `target`, retrying briefly if the destination is momentarily held open.
 *
 * Use this instead of `fs.rename` for every temp-then-publish write. The retry is a no-op on
 * POSIX, where these codes do not arise from this operation, so there is no reason to branch on
 * platform — and branching would mean the behaviour under test on a developer's Mac was not the
 * behaviour shipped to a user on Windows.
 */
export async function renameAtomic(tmp: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, target)
      return
    } catch (e) {
      // Out of attempts, or an error waiting will not fix: give the caller the real error, with
      // its original code, so `persisted:false` contracts and error messages stay accurate.
      if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT.has(codeOf(e))) throw e
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}

/**
 * The synchronous twin, for the paths that cannot be async: hook installers that run during
 * startup, the codex trust-hash write, the per-node token file. Same retry, same codes, same
 * refusal to loop forever.
 *
 * It blocks the thread while it waits, which is the honest cost of a synchronous API and the
 * reason the budget is the same ~310 ms rather than something more generous. `Atomics.wait` is a
 * real sleep rather than a spin, so the wait does not also burn a core — Node permits it on the
 * main thread (browsers do not).
 *
 * `rename` is a parameter only because a spy cannot be attached to an ESM namespace export, so a
 * test has no other way to make this fail on a platform where it does not. Production never
 * passes it. Injecting it here rather than exporting a mutable hook keeps the seam typed and
 * visible, and keeps every other caller exercising the real default.
 */
export function renameAtomicSync(
  tmp: string,
  target: string,
  rename: (from: string, to: string) => void = renameSync
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(tmp, target)
      return
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length || !TRANSIENT.has(codeOf(e))) throw e
      Atomics.wait(SLEEP_SLOT, 0, 0, RETRY_DELAYS_MS[attempt])
    }
  }
}

/** A slot that is never written, so `Atomics.wait` always waits out its full timeout. */
const SLEEP_SLOT = new Int32Array(new SharedArrayBuffer(4))

/** Paired with `process.pid` in the temp name below: the counter makes a name unique WITHIN this
 *  process, the pid makes it unique ACROSS processes (it restarts at 0 in every new one). */
let writeSeq = 0

/**
 * A temp path for publishing over `target`, unique per call.
 *
 * The second bug that lives at every temp-then-rename site, independent of the platform question
 * above: a **fixed** name (always `<file>.tmp`). Two writers then share one temp path, so one
 * writer's rename publishes the other's half-written bytes — or moves the temp out from under it,
 * and the loser fails with a confusing `ENOENT` that says nothing about what actually happened.
 *
 * Both halves of the name matter and for different reasons. The counter separates writers inside
 * one process. The pid separates PROCESSES, which is the case that looks impossible until it is
 * not: the Server Edition takes a `--data-dir`, so two servers can be pointed at one directory,
 * and a desktop app can share it too. Several stores here reasoned "only one instance exists" and
 * were right about their own process and silent about the other one. `scrollback-store` had the
 * counter and no pid, which is exactly that gap.
 *
 * The cost of uniqueness is that a temp never self-heals the way a fixed one did, where the next
 * save simply overwrote the litter. Every caller therefore owes its own cleanup on failure —
 * `writeFileAtomic` does it for you, and a site that builds its own sequence must do it by hand.
 */
export function tempNameFor(target: string): string {
  return `${target}.${process.pid}.${++writeSeq}.tmp`
}

/**
 * Write `data` to `target` atomically: unique temp file, then a retrying rename.
 *
 * The temp name is unique per call, which matters wherever more than one writer can reach a store
 * with nothing queueing them. With one shared `<file>.tmp`, a writer's rename publishes the
 * other's half-written bytes — or moves the temp out from under it, so the loser's rename fails
 * with a confusing ENOENT.
 *
 * A failed write removes its own temp (a unique name never self-heals the way a fixed one did,
 * where the next save simply reused it) and rethrows. The OLD file is left byte-for-byte intact
 * either way, which is the half callers depend on when they report a save as not persisted.
 */
export async function writeFileAtomic(
  target: string,
  data: string,
  opts: { mode?: number } = {}
): Promise<void> {
  const tmp = `${target}.${process.pid}.${++writeSeq}.tmp`
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf-8', ...opts })
    await renameAtomic(tmp, target)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}
