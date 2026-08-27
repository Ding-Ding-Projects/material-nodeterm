/**
 * Who is allowed into `browserGuests`, and what the answer is when the page an agent asked for is
 * gone. The pure half of both, so it is testable without Electron.
 */
// `src/main` may import `src/core`; the renderer may not, which is why this predicate will move to
// `@shared/safe-id` when the capability work needs it renderer-side. One predicate, never a copy.
import { isSafeNodeId } from '../core/remote-safety'

/**
 * Which of a node's two possible webviews a registration is.
 *
 * One node id can have TWO live guests — the canvas one (`BrowserNode`) and the kanban card modal
 * one (`CardModal`) — both mounting `BrowserSurface` with the SAME nodeId, so a reverse lookup by
 * node id picks arbitrarily. The field is recorded here first; threading it from both mount sites
 * is its own change.
 * node id picks arbitrarily.
 */
export type BrowserSurfaceKind = 'canvas' | 'modal'

export interface BrowserGuest {
  nodeId: string
  /**
   * ABSENT until both mount sites are threaded, and absent is the only honest value: neither of
   * them sends a surface yet, so this field is `undefined` for every registration the app makes
   * today.
   *
   * New mounts identify canvas versus modal explicitly. Omitted values remain unknown for older
   * renderers rather than being silently reclassified as canvas.
   */
  surface?: BrowserSurfaceKind
}

/** The minimum of Electron's `webContents` this module needs, injected so the guard is testable
 *  without Electron (`src/main` is not unit-testable against the real module). */
export type WebContentsLookup = (id: number) => { getType(): string } | null

/**
 * Record a browser guest, having first proven the renderer told the truth about it.
 *
 * WHY THE GUARD: main stored whatever integer the renderer sent. That was harmless while the map
 * only routed new-window events — and it becomes a privilege escalation the moment the integer
 * selects a `webContents` whose `.debugger` we attach to, because an unvalidated id can name the
 * app's own window. Stolen from the external S8 backend (`browser-use-backend.ts`, which checked
 * `contents.getType() !== 'webview'` before treating a renderer-supplied id as a guest) with credit
 * to **proteus-dev**; the strongest single idea in that file, and the only part of it kept.
 *
 * The node id is validated too: it is a map key here and a lease/partition key later, and it comes
 * from a canvas built out of git-shared `project.json`.
 *
 * Returns whether the registration was accepted, so the caller can say so in the log rather than
 * failing silently — a refused guest shows up later as a popup that does not open, and there is
 * nothing else on the wire to explain it.
 */
export function registerBrowserGuest(
  guests: Map<number, BrowserGuest>,
  webContentsId: unknown,
  nodeId: unknown,
  surface: unknown,
  lookup: WebContentsLookup
): boolean {
  if (typeof webContentsId !== 'number' || !Number.isInteger(webContentsId) || webContentsId <= 0)
    return false
  if (typeof nodeId !== 'string' || !isSafeNodeId(nodeId)) return false
  if (surface !== 'canvas' && surface !== 'modal') return false
  // Either lookup or inspection can throw when destruction races registration. A guest that
  // cannot be inspected all the way through is not a guest.
  let contents: { getType(): string } | null = null
  try {
    contents = lookup(webContentsId)
    if (!contents || contents.getType() !== 'webview') return false
  } catch {
    return false
  }
  guests.set(webContentsId, { nodeId, surface })
  return true
}

export interface BrowserGuestRegistrationRefusal {
  webContentsId: unknown
  nodeId: unknown
  surface: unknown
}

/**
 * Handle the renderer-facing registration request through the validation boundary.
 *
 * `surface` remains optional on the wire for compatibility with the original two-argument
 * registration. Only absence defaults to `canvas`; a present invalid value is refused. Keeping the
 * compatibility decision beside `registerBrowserGuest` makes the production IPC callback a thin
 * transport adapter and lets the complete request behavior run without importing Electron.
 */
export function registerBrowserGuestRequest(
  guests: Map<number, BrowserGuest>,
  webContentsId: unknown,
  nodeId: unknown,
  surface: unknown,
  lookup: WebContentsLookup,
  onRefused: (details: BrowserGuestRegistrationRefusal) => void
): boolean {
  const kind = surface === undefined ? 'canvas' : surface
  const accepted = registerBrowserGuest(guests, webContentsId, nodeId, kind, lookup)
  if (!accepted) onRefused({ webContentsId, nodeId, surface })
  return accepted
}

/**
 * What to say when a node exists but its page does not, because the memory saver released it.
 *
 * NEVER blame permissions for a lifecycle event. A target killed by the hidden-webview discard
 * reads as a permissions failure if we answer "not drivable", and that sends the next debugger to
 * the identity code for a bug that lives in `browser-discard-policy.ts`. It names the cause, names
 * the two ways out, and stays one line (every control reply is single-line by construction).
 */
export const browserDiscardedMessage = (id: string): string =>
  `browser: ${id} was released to save memory while hidden and its page is gone; ` +
  `bring it on screen or open a new one`
