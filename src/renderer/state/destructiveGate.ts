import { create } from 'zustand'

/**
 * One request for the destructive-action super-confirmation gate (two keys + a full-range slider)
 * — see `components/DestructiveConfirmGate` and docs/destructive-confirmation.md.
 */
export interface DestructiveGateRequest {
  /** The exact destructive action, in plain words. Never a euphemism. */
  title: string
  /** What will be affected and why it cannot be undone. */
  description: string
  /** The exact items affected, so the user approves what they were shown. */
  affected?: string[]
  confirmLabel?: string
  /** Screen coordinates of the control that triggered this — anchors the card beside it. */
  anchor?: { x: number; y: number }
  /** The control to return keyboard focus to once this closes (confirm OR cancel). */
  restoreFocusEl?: HTMLElement | null
  onConfirm: () => void
}

/**
 * The gate as a module-level store rather than one surface's `useState`.
 *
 * It began life inside `Canvas.tsx`, which meant it was reachable only from the canvas — so the
 * two destructive actions that live elsewhere (discarding a file's changes in Source Control,
 * revoking a paired device in Settings) could not use it however much they should. The security
 * review that found them recorded the cause honestly: not a decision, just where the state
 * happened to sit. A guard that exists but cannot be reached from half the app is not a guard.
 *
 * Nothing about the gate itself wanted to be local: `DestructiveConfirmGate` already portals to
 * the body and registers on the shared dialog stack, so where it sits in the React tree never
 * affected where it painted. Lifting the request out of Canvas is the whole change.
 *
 * It also fixes a hazard nobody had hit yet. Held in Canvas, an open gate was inside a subtree a
 * project switch re-renders — so the dialog could be torn down mid-confirmation, and the user
 * would be left unsure whether the thing they were half-way through approving had happened.
 * Mounted once at the root (`DestructiveGateHost`), it outlives every view change beneath it.
 *
 * One request at a time, deliberately. Two of these open together would present two sliders for
 * two different irreversible actions with nothing on screen saying which key belongs to which —
 * so a second `open` while one is live is REFUSED rather than queued or stacked. Refused, not
 * silently dropped: a caller learns its action did not fire and can say so.
 */
interface DestructiveGateState {
  request: DestructiveGateRequest | null
  /** Returns false when a gate is already open — the caller's action did NOT run. */
  open(request: DestructiveGateRequest): boolean
  close(): void
}

export const useDestructiveGate = create<DestructiveGateState>((set, get) => ({
  request: null,
  open(request) {
    if (get().request) return false
    set({ request })
    return true
  },
  close() {
    set({ request: null })
  }
}))

/**
 * Ask for the super-confirmation gate from anywhere, without subscribing to it.
 *
 * Surfaces call this; only `DestructiveGateHost` reads the store. A component that subscribed
 * merely to open a gate would re-render every time one opened or closed somewhere else entirely.
 */
export function openDestructiveGate(request: DestructiveGateRequest): boolean {
  return useDestructiveGate.getState().open(request)
}
