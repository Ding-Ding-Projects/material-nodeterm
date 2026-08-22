import { useEffect, useRef } from 'react'
import { useProjects } from './projects'
import { useToyLocks } from './toylocks'

/**
 * A 'session' duration toy lock (docs/toy-locks.md) re-locks the moment its tab is LEFT (switched
 * away from) — see `ToyLockDurationMode`'s doc comment in `shared/toylock.ts`. 'minutes'/'until-
 * close' locks expire on their own (`isUnlocked` re-evaluates the timestamp every read), so only
 * 'session' needs this watcher.
 *
 * Extracted out of `TabBar` (2026-08, MD3 shell prep) so this behaviour survives the tab bar's
 * own eventual removal — it is a session-lifecycle rule, not tab-bar UI, and belongs mounted once
 * regardless of which component renders the project switcher. Reads `activeProjectId` and the
 * lock records straight from their own stores rather than taking props, so it can be mounted
 * anywhere exactly once (see `Canvas.tsx`) with no wiring required at the call site.
 */
export function useSessionRelock(): void {
  const activeId = useProjects((s) => s.activeProjectId)
  const lockRecords = useToyLocks((s) => s.records)
  const prevActiveIdRef = useRef<string | undefined>(activeId ?? undefined)
  useEffect(() => {
    const prev = prevActiveIdRef.current
    if (prev && prev !== activeId) {
      const lock = lockRecords.find((r) => r.target.kind === 'tab' && r.target.id === prev)
      if (lock && lock.duration === 'session') useToyLocks.getState().relock(lock.id)
    }
    prevActiveIdRef.current = activeId ?? undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the lookup reads lockRecords
  }, [activeId, lockRecords])
}
