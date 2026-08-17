import { create } from 'zustand'
import type { LicenseStatus } from '@shared/types'
import { useSettings } from './settings'
import { featureEnabled, resolveProFeatures, type ProFeatureId } from '../lib/proFeatureAccess'

/**
 * Nobody ever pays a penny to use this app.
 *
 * Every capability ships to everyone who runs it: no purchase, no licence, no subscription, no
 * trial that lapses, and no feature held behind an unlock. That is not a pricing decision to be
 * revisited when the project gets popular — it is what the software is.
 *
 * So `isPremium` is no longer an entitlement read off a payment; it is resolved from the user's
 * OWN settings — the master "Unlock all features" switch (`settings.proFeaturesEnabled`) plus,
 * underneath it, one per-feature switch per capability that genuinely costs something when idle
 * (see lib/proFeatureAccess.ts for the resolution rules and why `remoteAccess` covers exactly the
 * scope it does). Turning the master off locks everything; turning it back on restores whatever
 * each feature was individually set to. `isPremium` and `seats` below are kept as the SAME flat
 * fields every existing consumer already reads (RemoteSection, RemoteAccessDialog, OnboardingFlow,
 * TeamAccessSection, upgradeGate) — they now simply resolve through the per-feature rules instead
 * of the master switch alone, so a feature added tomorrow that reaches for `isPremium` is still
 * free-by-construction, and an existing consumer's behavior is unchanged for anyone who never
 * touches the new per-feature switches (they default to on, exactly matching the old master-only
 * behavior).
 */
function currentFeatures(): Record<ProFeatureId, boolean> {
  return resolveProFeatures(useSettings.getState().settings)
}

/**
 * Seats available without paying. The old free tier was 0 and Pro's baseline was 3; since nobody
 * pays, the floor is simply generous enough that the number stops working as a gate. A real
 * licence reporting MORE than this still wins, so nothing is taken away from anyone.
 */
const FREE_SEATS = 32

interface EntitlementState {
  status: LicenseStatus
  /** Resolves through the `remoteAccess` per-feature switch (master AND its own choice). Feature
   *  gates read this, so with both on (the default) nothing in the app is gated. */
  isPremium: boolean
  /** Every per-feature toggle's current EFFECTIVE state (master + that feature's own choice,
   *  already resolved — see lib/proFeatureAccess.ts). LicenseSection renders each row's switch
   *  from this; `isPremium`/`seats` below are the same values, just projected onto the flat shape
   *  every pre-existing consumer already reads. */
  features: Record<ProFeatureId, boolean>
  /** Team seat cap, floored at FREE_SEATS — but 0 outright when the `teamSeats` per-feature switch
   *  is off, whatever the real entitlement says. A cap of 0 elsewhere is a paid gate wearing a
   *  number; here it's the user's own choice, and it is honored exactly. */
  seats: number
  hydrate(): Promise<void>
  /** Kept so existing callers still type-check, but there is nothing to buy: it re-reads the
   *  current status and never opens a checkout. */
  upgrade(target?: 'pro' | 'seats'): Promise<void>
  activate(key: string): Promise<void>
  deactivate(): Promise<void>
}

const EMPTY: LicenseStatus = { tier: null, active: false, expiresAt: null, seats: 0, error: null }

export const useEntitlement = create<EntitlementState>((set, get) => {
  const apply = (status: LicenseStatus) => {
    const features = currentFeatures()
    set({
      status,
      isPremium: features.remoteAccess,
      features,
      seats: features.teamSeats ? Math.max(status.seats, FREE_SEATS) : 0
    })
  }

  // Live updates from the main process (launch refresh, offline grace).
  window.nodeTerminal.license.onChange(apply)

  // Follow the master switch AND every per-feature switch. Without this the toggles would only
  // take effect after some other licence event happened to re-run `apply` — i.e. they would look
  // broken for the one action they exist for.
  useSettings.subscribe(() => {
    const features = currentFeatures()
    const prev = get()
    const nextIsPremium = features.remoteAccess
    const nextSeats = features.teamSeats ? Math.max(prev.status.seats, FREE_SEATS) : 0
    if (
      nextIsPremium !== prev.isPremium ||
      nextSeats !== prev.seats ||
      prev.features.remoteAccess !== features.remoteAccess ||
      prev.features.teamSeats !== features.teamSeats
    ) {
      set({ isPremium: nextIsPremium, seats: nextSeats, features })
    }
  })

  const initialFeatures = currentFeatures()
  return {
    status: EMPTY,
    isPremium: initialFeatures.remoteAccess,
    features: initialFeatures,
    seats: initialFeatures.teamSeats ? FREE_SEATS : 0,
    async hydrate() {
      apply(await window.nodeTerminal.license.getStatus())
    },
    async upgrade() {
      // No checkout, no payment link, no upsell. Just re-read what we already have.
      apply(await window.nodeTerminal.license.getStatus())
    },
    async activate(key) {
      apply(await window.nodeTerminal.license.activate(key))
    },
    async deactivate() {
      apply(await window.nodeTerminal.license.deactivate())
    }
  }
})

/** True when a given per-feature switch is currently effective (master AND its own choice) —
 *  a convenience for non-React code that wants one feature's state without subscribing to the
 *  whole store. React code should prefer `useEntitlement((s) => s.features[id])`. */
export function isProFeatureEnabled(id: ProFeatureId): boolean {
  return useEntitlement.getState().features[id]
}
