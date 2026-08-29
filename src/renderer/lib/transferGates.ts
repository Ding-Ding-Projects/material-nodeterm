import { canTransferFrom, type AgentId } from '@shared/agents/config'
import { E_UNSUPPORTED } from '@shared/rpc'
import type { HandoffResult } from '@shared/types'

/**
 * Should this node offer "Transfer conversation to…", and what happens when the build behind it
 * cannot run?
 *
 * The transfer action renders the source agent's native transcript to a portable handoff file and
 * opens a target node pointed at it. The renderer of that file is `src/main/handoff` behind the
 * `handoff:build` IPC channel, registered **only** in `src/main` — nothing in `src/core` or
 * `src/server` registers it, so the Server Edition's bridge has never had anything to call. Its
 * stub rejects with `E_UNSUPPORTED`, and the menu item was gated purely on agent capability +
 * a live session id, both of which the browser build satisfies. The result was the worst shape a
 * degrade can take: a visible, enabled menu item that did *literally nothing*, because the call
 * site expects a RESOLVED `{ error }` and a rejection throws past that check into a `void`ed
 * promise with no `.catch` and no `unhandledrejection` handler anywhere.
 *
 * Both halves of the fix live here so they can be tested without mounting the canvas:
 *
 *  - `canOfferTransfer` adds the capability bit to the gate, so the affordance is absent where the
 *    builder is. This follows the house pattern already set by `PairingApi.supported` (declared on
 *    the API type, `false` in `bridge/stubs.ts`, `true` in the preload, checked before the UI
 *    mounts) rather than inventing a second convention.
 *  - `buildTransferHandoff` keeps the call site's resolved-result contract true even if a stub
 *    reappears — a rejection becomes `{ error }` instead of escaping the `'error' in res` check.
 *    Belt and braces on purpose: the capability bit hides the affordance, this makes any other
 *    route to a rejection visible to the user instead of silent.
 */
export const TRANSFER_UNSUPPORTED_BODY =
  'Transferring a conversation is not available in this edition — the handoff file is rendered by ' +
  'the desktop app. Run the transfer from the desktop app on the machine hosting this session.'

/** Shown when the build rejected for a reason that carried no message of its own. */
export const TRANSFER_FAILED_BODY = 'The conversation could not be transferred.'

/** Everything the menu needs to decide whether to draw the "Transfer conversation to…" section.
 *  `handoffSupported` is `window.nodeTerminal.handoff.supported` — read at menu-build time, like
 *  the pairing checks elsewhere in Canvas, because the api object can change with the session. */
export function canOfferTransfer(o: {
  agentId: AgentId | undefined
  sessionId: string | undefined
  handoffSupported: boolean
}): boolean {
  return o.handoffSupported && !!o.agentId && canTransferFrom(o.agentId) && !!o.sessionId
}

/** The body for a rejected build: the edition limitation when the api refused, otherwise the real
 *  error text — an IPC handler that genuinely failed on the desktop must not be reported as an
 *  edition limitation it is not. */
export function transferFailureBody(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === E_UNSUPPORTED
  ) {
    return TRANSFER_UNSUPPORTED_BODY
  }
  if (err instanceof Error && err.message.trim()) return err.message
  return TRANSFER_FAILED_BODY
}

/** Run the handoff build and always RESOLVE, so the caller's `'error' in res` branch is the one
 *  place a failure is reported. Never throws. */
export async function buildTransferHandoff(
  build: () => Promise<HandoffResult>
): Promise<HandoffResult> {
  try {
    return await build()
  } catch (err) {
    return { error: transferFailureBody(err) }
  }
}
