import { create } from 'zustand'
import type { LicenseStatus } from '@shared/types'
import { useSettings } from './settings'

/**
 * Nobody ever pays a penny to use this app.
 *
 * Every capability ships to everyone who runs it: no purchase, no licence, no subscription, no
 * trial that lapses, and no feature held behind an unlock. That is not a pricing decision to be
 * revisited when the project gets popular — it is what the software is.
 *
 * So `isPremium` is no longer an entitlement read off a payment; it is the user's OWN switch
 * (`settings.proFeaturesEnabled`, default ON). Keeping one value that decides every gate means a
 * feature added tomorrow that reaches for `isPremium` is free by construction, rather than free
 * only until somebody forgets to delete a check. Turning the switch off is a preview of the
 * smaller surface for anyone who wants it, and turning it back on costs nothing.
 */
function unlocked(): boolean {
  // Defensive default: if settings have not hydrated yet, unlocked is the correct answer, because
  // the locked state is the one that takes something away from the user.
  return useSettings.getState().settings.proFeaturesEnabled !== false
}

/**
 * Seats available without paying. The old free tier was 0 and Pro's baseline was 3; since nobody
 * pays, the floor is simply generous enough that the number stops working as a gate. A real
 * licence reporting MORE than this still wins, so nothing is taken away from anyone.
 */
const FREE_SEATS = 32

interface EntitlementState {
  status: LicenseStatus
  /** Follows the user's own `proFeaturesEnabled` switch — never a payment. Feature gates read
   *  this, so with the switch on (the default) nothing in the app is gated. */
  isPremium: boolean
  /** Team seat cap, floored at FREE_SEATS. A cap of 0 is a paid gate wearing a number, and it
   *  would lock team access for exactly the people this app is free for. */
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
  const apply = (status: LicenseStatus) =>
    set({ status, isPremium: unlocked(), seats: Math.max(status.seats, FREE_SEATS) })

  // Live updates from the main process (launch refresh, offline grace).
  window.nodeTerminal.license.onChange(apply)

  // Follow the switch. Without this the toggle would only take effect after some other licence
  // event happened to re-run `apply` — i.e. it would look broken for the one action it exists for.
  useSettings.subscribe(() => {
    const next = unlocked()
    if (next !== get().isPremium) set({ isPremium: next })
  })

  return {
    status: EMPTY,
    isPremium: unlocked(),
    seats: FREE_SEATS,
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
