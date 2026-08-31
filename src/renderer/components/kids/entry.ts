import { create } from 'zustand'

import { useKidsMode } from '@renderer/state/kidsMode'

/**
 * The rail's `child_care` destination calls `enterKidsModeFromRail()` instead of toggling a local
 * view — per the brief, this is not a view a child could navigate back out of. It flips the real,
 * shared, cross-app Kids-mode record through the exact same `enable()` action Settings uses, and
 * once that record's `enabled` flips to true, App.tsx's own fail-closed routing swaps the whole
 * canvas out for `<KidsShell/>` on its own; this module never renders the shell itself.
 *
 * Three cases:
 *   - A grown-up PIN already exists on this machine → the dialog verifies it before enabling.
 *   - No PIN exists yet → a small dialog (`EnableKidsModeDialog`, mounted once via
 *     `EnableKidsModeDialogHost` at the app root) collects one. It is intentionally NOT the same
 *     masked `type="password"` field Settings uses: this is a digit-only PIN pad, matching the
 *     4-digit numeric pad `KidsGate` verifies against later (see PinPad.tsx's own note on why
 *     Kids-mode PINs are fixed at 4 digits).
 */
interface EnableKidsDialogState {
  open: boolean
  show(): void
  hide(): void
}

export const useEnableKidsDialog = create<EnableKidsDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))

export async function enterKidsModeFromRail(): Promise<void> {
  const { enabled } = useKidsMode.getState()
  if (enabled) return
  useEnableKidsDialog.getState().show()
}
