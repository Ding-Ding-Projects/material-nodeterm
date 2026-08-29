import fs from 'node:fs'
import path from 'node:path'

/**
 * Name the files inside `dir` that cannot be opened for writing, i.e. the ones something else
 * still holds.
 *
 * This exists because a Windows `EPERM` on removing a directory says only that the directory is
 * busy — never which entry, and never who. That is exactly the information needed to identify an
 * owner, and without it a flake attracts guesses: three plausible causes were eliminated for one
 * test in this repository (retries, git background maintenance, an undisposed platform) purely
 * because nothing said which path was locked.
 *
 * Diagnostic only. It runs after a removal has already failed, so its own cost is irrelevant, and
 * it must never throw — a diagnostic that fails while reporting a failure just hides it.
 */
export function lockedPathsIn(dir: string, limit = 12): string[] {
  const locked: string[] = []
  const walk = (current: string) => {
    if (locked.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (error) {
      // A directory we cannot even list is itself evidence, and is worth reporting as such.
      locked.push(`${current} (unreadable: ${(error as NodeJS.ErrnoException).code ?? 'unknown'})`)
      return
    }
    for (const entry of entries) {
      if (locked.length >= limit) return
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        // Opening for APPEND rather than truncating write: the point is to find out whether the
        // file can be opened at all, not to damage evidence somebody may want to look at.
        fs.closeSync(fs.openSync(full, 'a'))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // EACCES is an ordinary read-only file and says nothing about a holder; EPERM/EBUSY on
        // Windows is the sharing violation this is looking for.
        if (code === 'EPERM' || code === 'EBUSY') locked.push(`${full} (${code})`)
      }
    }
  }
  try {
    walk(dir)
  } catch {
    // Never let the diagnostic itself throw.
  }
  return locked
}

/** Remove `dir`, and on failure say which paths are held rather than only that something is. */
export function removeDirReportingHolders(dir: string, options: fs.RmOptions = {}): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50, ...options })
  } catch (error) {
    const held = lockedPathsIn(dir)
    const detail = held.length
      ? '\n  held: ' + held.join('\n        ')
      : '\n  held: no individual file is locked, so the DIRECTORY handle is busy — which means a' +
        '\n        process whose working directory is inside it, or a watch on it'
    throw new Error(String(error) + detail)
  }
}

// Deliberately NOT reported here: `process.getActiveResourcesInfo()`. It was added, it looked
// convincing — a failure showed `ProcessWrapx1, PipeWrapx7`, which reads exactly like a subprocess
// still holding the directory — and it is noise. The same tally, character for character, appears
// on runs where the removal SUCCEEDS, because it is vitest's own worker plumbing. It was caught
// only by printing the tally on success as a control, which is the step worth copying, not the
// diagnostic itself: a signal nobody compared against a passing run is not a signal.
