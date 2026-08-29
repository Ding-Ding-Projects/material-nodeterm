// The canvas-control verbs selected by the renderer's executable destructive dispatcher.
//
// This lives in `src/shared` because main validates the same verbs the renderer executes, while the
// web build cannot import the main-process model. `dispatchDestructiveControl` reads this set before
// Canvas reaches its ordinary switch; write/close effects exist only behind the callbacks it gives
// the confirmation UI. The behavior Chut iterates the exact set and proves neither effect runs
// before confirmation. A new member therefore turns red as an unsupported destructive verb until
// its behavior is deliberately implemented in that dispatcher.
//
// This is not the complete list of actions that ask a human. `close-worktree --mode remove` owns a
// separate option-bearing confirmation route and intentionally answers false here. Typed on string
// because renderer dispatch receives a raw IPC verb and cannot import main's `ControlVerb` type.

export const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set(['write', 'close'])

/**
 * Is this verb owned by the renderer's destructive-control dispatcher?
 *
 * NOT "is a human asked about this verb" — `close-worktree --mode remove` is confirmed by a human
 * and answers `false` here (see the file header). A newly-added member is fail-closed by the
 * dispatcher until its concrete confirmation/effect behavior is implemented.
 *
 * `open-terminal --cmd` is deliberately NOT in the set and never was; the 2026-08-13 argv-leak
 * writeup in `docs/node-identity.md` is the record of what that costs when the bearer leaks.
 */
export function isDestructiveVerb(verb: string): boolean {
  return DESTRUCTIVE_VERBS.has(verb)
}
