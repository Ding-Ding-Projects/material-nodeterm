import { DIM_SUM_CATALOG, type DimSumDish } from './catalog'

/**
 * The dim-sum surprise's dice roll. Deliberately module-level (not React state): the "at most
 * once per launch" guarantee has to survive a remount of the surprise's own component (e.g. a
 * hot-reload in dev, or a future refactor that mounts/unmounts it), so the coin only ever gets
 * flipped once for the life of the process, no matter how many times the caller asks.
 */
let rolledThisLaunch = false

/**
 * Decide whether THIS launch shows the surprise, and if so, which dish. A fresh draw every call
 * — the FIRST call in a launch is the only one that can return non-null; every call after it
 * (from a remount, a second window, whatever) returns `null` immediately, without consuming
 * another random draw. `random` is an injectable seam (defaults to `Math.random`) purely so the
 * decision is unit-testable without depending on global RNG state.
 */
export function rollDimSumForLaunch(random: () => number = Math.random): DimSumDish | null {
  if (rolledThisLaunch) return null
  rolledThisLaunch = true
  if (DIM_SUM_CATALOG.length === 0) return null
  if (random() >= 0.1) return null
  const idx = Math.min(Math.floor(random() * DIM_SUM_CATALOG.length), DIM_SUM_CATALOG.length - 1)
  return DIM_SUM_CATALOG[idx]
}

/** Tests / Storybook-style harnesses only: forget the "already rolled" latch. */
export function resetDimSumRollForTests(): void {
  rolledThisLaunch = false
}
