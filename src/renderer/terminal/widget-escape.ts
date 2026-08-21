import type { SessionSource } from '../session/session'
import { offscreenCoreIsRemote } from './offscreen-policy'

export interface WidgetEscapeInputs {
  /** Server Edition browser tab — there is no OS window to open. */
  readonly browserRuntime: boolean
  /** SSH project, or an SSH-project terminal (`data.ssh` / `data.sshRemoteTmux`). */
  readonly remoteSession: boolean
  /** Which machine this session's core runs on. A relay/server tab is somebody else's. */
  readonly sessionSource: SessionSource
}

/**
 * Whether a terminal node may be popped into an always-on-top widget window.
 *
 * WidgetApp builds its OWN `new LocalTransport()`, so the widget can only ever talk to the local
 * core. Offering it for a remote node would hand a remote node id to the local core — the
 * `requireRemote` hole this repo already paid for once, where an SSH node quietly became a local
 * shell in the local $HOME with the remote session's scrollback replayed into it, leaving an
 * orphaned local `nt-<id>` behind.
 *
 * Both remote terms are needed and neither subsumes the other: `remoteSession` answers for SSH,
 * and `sessionSource` answers for a relay/server tab whose core is another machine entirely.
 * `data.remote` is deliberately NOT consulted — nothing sets that field on node data, so a gate
 * built on it is constant-false and type-invisible, exactly as the offscreen policy records.
 */
export function canEscapeToWidget(inputs: WidgetEscapeInputs): boolean {
  if (inputs.browserRuntime) return false
  if (inputs.remoteSession) return false
  if (offscreenCoreIsRemote(inputs.sessionSource)) return false
  return true
}
