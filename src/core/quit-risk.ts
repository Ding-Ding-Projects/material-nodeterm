/**
 * The one question the confirm-before-quit dialog needs answered: would quitting right now kill
 * work the user has running?
 *
 * A tmux (or session-host) backed terminal survives quit untouched — `PtyManager.killAll()`
 * detaches every client and leaves the session running for the next launch, exactly the
 * persistence this whole app is built around (see the "Terminal session continuity" section of
 * the root CLAUDE.md). A PLAIN-SHELL session has no such backend: the pty IS the foreground
 * process, and quitting kills it for real, same as `live-work.ts`'s sibling predicate on the
 * renderer side for the memory-reclaim levers.
 *
 * So "nothing at risk" means every live session is persistent. One non-persistent session with a
 * live process in it is enough to make quitting a real, irreversible loss — that is what earns
 * the confirmation dialog. A canvas with zero terminals, or a canvas where every terminal is
 * tmux-backed, quits silently: there is nothing there to confirm losing.
 */

export interface QuitRiskSessionInfo {
  /** Mirrors `Session.tmuxBacked` in pty-manager.ts / `LiveWorkInput.tmuxBacked` in live-work.ts:
   *  true when a tmux session (local or remote) or the standalone session host is holding this
   *  session's work, so detaching the pty client here loses nothing. */
  tmuxBacked: boolean
}

/** True when at least one live session would be genuinely killed (not just detached) by quitting
 *  right now — i.e. some session has no persistent backend under it. */
export function quitWouldLoseWork(sessions: Iterable<QuitRiskSessionInfo>): boolean {
  for (const session of sessions) {
    if (!session.tmuxBacked) return true
  }
  return false
}
