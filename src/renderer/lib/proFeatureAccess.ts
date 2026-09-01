// Resolution logic for nodeterm's per-feature performance toggles.
//
// Nobody pays for nodeterm (see renderer/state/entitlement.ts) — the "Unlock all features" master
// switch (`settings.proFeaturesEnabled`) exists purely so someone on an older or busier machine
// can shed the background cost of the handful of features that keep a standing connection open or
// hold real memory even while idle. This module lets each of THOSE features be turned on or off on
// its own, without turning the simple one-click master switch into a chore:
//
//   - The master forces every feature off when it is off. It never rewrites a feature's own stored
//     choice, so flipping the master back on restores each feature to exactly what it was set to
//     before — losing someone's per-feature choices on a master flip would be a bug, not a feature.
//   - `teamSeats` is a feature OF remote access (a seat is useless without the hosting connection
//     it rides), so it sub-gates under `remoteAccess` the same way `remoteAccess` sub-gates under
//     the master — the exact `phoneAccessEnabled` → `mobilePushEnabled` → `mobilePushNeedsYou`
//     layering already used elsewhere in `shared/types.ts`.
//
// Kept free of React/Zustand so the rules are testable without a renderer (same pattern as
// `usageScope.ts` / `teamAccessView.ts`).
import type { Settings } from '@shared/types'

/**
 * One performance-costing capability that can be locked independently of the master switch.
 *
 * `remoteAccess` covers remote-access hosting ONLY. It used to drag the non-tiny dictation models
 * along with it, because both read the one legacy `isPremium` signal — but the whisper gate was
 * removed (2026-08-17: the models download once and transcribe on the user's own CPU, so there was
 * nothing to meter), and dictation no longer consults this flag at all. Do not re-widen the scope
 * without re-widening the copy; a toggle that quietly switches off more than its label says is the
 * exact dishonesty this comment exists to prevent.
 */
export type ProFeatureId = 'remoteAccess' | 'teamSeats'

/** The settings keys that each hold ONE feature's own choice, independent of the master and of
 *  every other feature's choice. */
const PRO_FEATURE_SETTINGS_KEY = {
  remoteAccess: 'proFeatureRemoteAccessEnabled',
  teamSeats: 'proFeatureTeamSeatsEnabled'
} as const satisfies Record<ProFeatureId, keyof Settings>

/** The settings this module reads — a subset of `Settings`, `Pick`ed from the real type so a
 *  rename or removal in `shared/types.ts` fails the build here instead of silently drifting. */
export type ProFeatureSettings = Pick<
  Settings,
  'proFeaturesEnabled' | (typeof PRO_FEATURE_SETTINGS_KEY)[ProFeatureId]
>

export interface ProFeatureDescriptor {
  id: ProFeatureId
  title: string
  /** What it does and what it costs when left on. The point of these toggles is speed, never
   *  payment, so the copy names the concrete cost — a standing connection, loaded memory, an open
   *  per-device socket — never an entitlement or a price. */
  description: string
}

/** Declared in the order LicenseSection renders them. Every id here must have a matching entry in
 *  `PRO_FEATURE_SETTINGS_KEY` above (enforced by the `satisfies` on that map) and is exercised by
 *  `resolveProFeatures`'s loop below, so a feature can't be declared here without being resolvable. */
export const PRO_FEATURES: readonly ProFeatureDescriptor[] = [
  {
    id: 'remoteAccess',
    title: 'Remote access hosting',
    description:
      'Hosting this machine for another device to connect to keeps a standing connection open to ' +
      'the relay while it waits for a peer. Dictation is not affected — every Whisper model is ' +
      'free and runs on this machine, whatever this switch is set to.'
  },
  {
    id: 'teamSeats',
    title: 'Team seats',
    description:
      "How many teammates can share this computer over remote access at once. Off caps it at zero, so " +
      "extra devices can't join even while remote access itself is on above — fewer connected " +
      'teammates means fewer standing per-device connections this computer has to keep open.'
  }
]

/** True when the master switch itself is on. Defensive default: an unhydrated/missing value reads
 *  as ON, because the locked state is the one that takes something away from the user (mirrors the
 *  original `unlocked()` reasoning in entitlement.ts). */
export function masterEnabled(settings: Pick<ProFeatureSettings, 'proFeaturesEnabled'>): boolean {
  return settings.proFeaturesEnabled !== false
}

/** This feature's OWN stored choice, ignoring the master and every other feature. Same defensive
 *  default as the master: a missing value reads as ON, so an existing user who saved settings
 *  before this feature shipped gets the unchanged, fully-unlocked behavior they already had. */
function ownChoice(settings: ProFeatureSettings, id: ProFeatureId): boolean {
  return settings[PRO_FEATURE_SETTINGS_KEY[id]] !== false
}

/**
 * The feature's EFFECTIVE state: whether it should actually behave as unlocked right now.
 *
 * This is the one function every consumer should call — never read a `proFeature*Enabled` setting
 * directly, or the master-switch-forces-off and teamSeats-rides-remoteAccess rules can be missed.
 */
export function featureEnabled(settings: ProFeatureSettings, id: ProFeatureId): boolean {
  if (!masterEnabled(settings)) return false
  if (id === 'teamSeats') return featureEnabled(settings, 'remoteAccess') && ownChoice(settings, id)
  return ownChoice(settings, id)
}

/** Every feature's effective state at once — what the settings UI renders each row's switch from,
 *  and what entitlement.ts resolves `isPremium`/`seats` from together. */
export function resolveProFeatures(settings: ProFeatureSettings): Record<ProFeatureId, boolean> {
  const result = {} as Record<ProFeatureId, boolean>
  for (const { id } of PRO_FEATURES) result[id] = featureEnabled(settings, id)
  return result
}

/** The settings key backing a feature's own choice — LicenseSection uses this to build its
 *  `update({ [key]: v })` patch without duplicating the id→key map. */
export function proFeatureSettingsKey(id: ProFeatureId): keyof ProFeatureSettings {
  return PRO_FEATURE_SETTINGS_KEY[id]
}
