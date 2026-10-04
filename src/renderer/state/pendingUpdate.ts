import { create } from 'zustand'

// The update the user still owes, as seen by the title-bar "Update" button. UpdateCard owns the
// updater subscriptions and writes here; the card's own dismiss only hides the CARD, never this,
// so a hidden card still leaves a way to install. Transient: a relaunch re-derives it from the
// updater.
//
//   downloaded → staged, click restarts into it
//   manual     → the updater found a version this install cannot self-install, click opens the
//                download page
//   required   → below the channel minimum, click triggers a check (which downloads it)
export type PendingUpdate =
  | { kind: 'downloaded'; version?: string }
  | { kind: 'manual'; version?: string }
  | { kind: 'required'; minSupported: string | null }

interface PendingUpdateState {
  pending: PendingUpdate | null
  setPending: (p: PendingUpdate | null) => void
}

export const usePendingUpdate = create<PendingUpdateState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending })
}))

export const RELEASES_URL = 'https://github.com/Ding-Ding-Projects/material-nodeterm/releases'

/** Which card states owe the title-bar button, and with what. Anything else leaves it unchanged:
 *  the card's dismiss sets `idle`, and dismissing the card must not take the install path away. */
export function pendingFromStatus(
  status:
    | { kind: 'downloaded'; version?: string }
    | { kind: 'manual'; version?: string }
    | { kind: 'required'; minSupported: string | null }
    | { kind: string }
): PendingUpdate | undefined {
  if (status.kind === 'downloaded' || status.kind === 'manual') {
    const version = (status as { version?: string }).version
    return { kind: status.kind, ...(version ? { version } : {}) }
  }
  if (status.kind === 'required') {
    return { kind: 'required', minSupported: (status as { minSupported: string | null }).minSupported }
  }
  return undefined
}

/** What clicking the title-bar button does for each pending kind. */
export function runPendingUpdate(
  p: PendingUpdate,
  api: { restart(): void; check(): void } = window.nodeTerminal.updates,
  open: (url: string) => void = (url) => void window.open(url, '_blank', 'noopener')
): void {
  if (p.kind === 'downloaded') api.restart()
  else if (p.kind === 'manual') open(RELEASES_URL)
  else api.check()
}
