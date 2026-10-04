// Prepare-for-update (ported from upstream, issue #829 there): the wire shapes between the desktop
// main process and the renderer's prepare flow. Windows only. The session host outlives the app by
// design and runs from its own staged copy, so an update installs while it keeps running, but that
// host keeps its OLDER version until it stops. The flow ends every session through the host's own
// `shutdown` command (never a name-based kill, never node deletion) after giving each idle agent a
// chance to exit cleanly, then quits, so the next launch starts the updated host.

/** What the running host holds right now. Asked without ever launching a host. */
export type UpdatePrepInspection =
  /** Not Windows, or the session-host backend is not the one this app uses. */
  | { kind: 'unsupported' }
  /** No host is running: nothing holds the install directory on its behalf. */
  | { kind: 'no-host' }
  | {
      kind: 'host'
      /** Host session names (`nt-<nodeId>`), every project's — closed ones included. */
      sessions: string[]
      /** The host speaks `shutdown`. False for a host started by an older build, which must be
       *  handled by the manual steps — the app never kills a host by itself. */
      shutdownSupported: boolean
      /** Core's status mirror per session: the only state source for nodes whose project is not
       *  on screen (an unmounted node's renderer state is cleared). `attention` = an unanswered
       *  question or approval ticket is held. */
      mirror: Record<string, { state?: string; attention: boolean }>
    }
  | { kind: 'error'; error: string }

export type UpdatePrepShutdown =
  | { kind: 'unsupported' }
  | { kind: 'no-host' }
  /** The host ended every session and its process exited. */
  | { kind: 'shut-down'; ended: string[] }
  /** The host answered that it could not end some sessions; it is still running and serving. */
  | { kind: 'failed'; error: string }
  /** No answer we can trust (timeout, lost connection, host still alive after its reply). */
  | { kind: 'unconfirmed'; error: string }
  /** The host predates the `shutdown` feature. */
  | { kind: 'host-unsupported' }

/** The manual steps, for a host that cannot shut itself down (or did not confirm it did). Kept in
 *  one place so the dialog and the docs say the same thing. */
export const MANUAL_UPDATE_STEPS: readonly string[] = [
  'Save work in every terminal and agent, and exit each program and its shell normally. Do not use End session or delete nodes: those remove the nodes.',
  'Quit nodeterm and wait at least 30 seconds: an empty session host shuts itself down.',
  'If session-host-runtime.exe is still running, open Task Manager, Details, verify it is your own user\'s process, and end only that process (every session it owns stops).',
  'Start nodeterm again. Your canvas nodes stay; agents resume from their saved conversations, and the updated session host starts.'
]
