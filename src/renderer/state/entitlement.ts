import { create } from 'zustand'
import type { LicenseDetail, LicenseStatus } from '@shared/types'
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
import { isReleaseRefusal } from '@renderer/lib/licenseCopy'

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
  /**
   * The license key + device usage, or null before the first read.
   *
   * **`detail.error` here means ONE thing: the last DETAIL READ, or a release refusal about the
   * license itself.** Only two kinds of code can be in it:
   * - **The read failed** — `unauthorized` | `inactive` | `offline` | `disabled` | `network`.
   *   Everything beside it is a placeholder: the zeros are NOT a device count and the null key is
   *   not "no key". Render the failure, never the numbers.
   * - **The read was fine; the RELEASE was refused** — `too_soon` (with `retryAfterDays`) |
   *   `not_applicable`. These ride on top of the last good read (see `releaseOthers`), so `key`,
   *   `source` and the counts are real and worth showing — say the action was refused, not that
   *   the license could not be read. (The counts are the last good read's; if nothing was ever
   *   read successfully they are still EMPTY_DETAIL's zeros, so call `loadDetail` first.)
   *
   * A release that failed for any OTHER reason never lands here — `releaseOthers` hands that code
   * back to its caller instead. It said nothing about the license, and merging it made the panel
   * replace a real key and real counts with "could not read this license", while saying nothing
   * about the action the user had just pressed.
   */
  detail: LicenseDetail | null
  hydrate(): Promise<void>
  /** Kept so existing callers still type-check, but there is nothing to buy: it re-reads the
   *  current status and never opens a checkout. */
  upgrade(target?: 'pro' | 'seats'): Promise<void>
  activate(key: string): Promise<void>
  deactivate(): Promise<void>
  /** Read the key + device usage (token-authorized). Replaces `detail` wholesale — it is the one
   *  call that states every field.
   *  **REJECTS on the Server Edition** (`E_UNSUPPORTED` from the bridge stub — there is no license
   *  layer in `src/server`), and neither this nor `releaseOthers` catches it. A caller that fires
   *  this on mount must `.catch(…)`, or it is an unhandled rejection on every browser session. */
  loadDetail(): Promise<void>
  /**
   * Deactivate every other device on this license, then fold the new counts into `detail`.
   *
   * Resolves to `null` when the release landed, or when the server refused it on terms `detail`
   * can carry (`too_soon` / `not_applicable` — merged onto the last good read, where
   * `licenseSentence` speaks for them). Any OTHER reason code is resolved AS the value and
   * `detail` is left exactly as it was: that code is about the call, not the license, so only the
   * caller — which knows a release was attempted — can say anything true about it.
   *
   * Rejects on the Server Edition exactly like `loadDetail` — see there.
   */
  releaseOthers(): Promise<string | null>
}

const EMPTY: LicenseStatus = { tier: null, active: false, expiresAt: null, seats: 0, error: null }

const EMPTY_DETAIL: LicenseDetail = {
  key: null,
  used: 0,
  seats: 0,
  source: null,
  error: null
}

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
  // Canvas can be imported before the preload bridge is attached (notably in an isolated
  // renderer mount). Register the live listener when the namespace exists, rather than turning a
  // bridge-ordering race into a module-evaluation crash. Calls that require the bridge still
  // report their own unavailable result through the normal action paths below.
  window.nodeTerminal?.license?.onChange?.(apply)

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
    detail: null,
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
    },
    async loadDetail() {
      set({ detail: await window.nodeTerminal.license.detail() })
    },
    async releaseOthers() {
      const r = await window.nodeTerminal.license.releaseOthers()
      const prev = get().detail ?? EMPTY_DETAIL
      // A release that did not land tells us nothing about the license, and for `offline`/`network`
      // it does not even tell us the server did nothing — the request may have arrived and only
      // the reply been lost. So `detail` keeps the last good read untouched (its key and counts are
      // still the best thing we know) and the code goes back to the caller, which is the only
      // place that knows a RELEASE was pressed and can say so.
      if (r.error && !isReleaseRefusal(r.error)) return r.error
      // The release route answers with COUNTS ONLY — no key, no source. Replacing `detail`
      // wholesale would blank the key the user came to this screen to copy, and drop the source
      // that decides whether this action is offered at all. A refusal carries no counts either
      // (its zeros are placeholders), so only its reason code rides.
      set({
        detail: r.error
          ? { ...prev, error: r.error, retryAfterDays: r.retryAfterDays }
          : { ...prev, used: r.used, seats: r.seats, error: null, retryAfterDays: undefined }
      })
      return null
    }
  }
})

/** True when a given per-feature switch is currently effective (master AND its own choice) —
 *  a convenience for non-React code that wants one feature's state without subscribing to the
 *  whole store. React code should prefer `useEntitlement((s) => s.features[id])`. */
export function isProFeatureEnabled(id: ProFeatureId): boolean {
  return useEntitlement.getState().features[id]
}
