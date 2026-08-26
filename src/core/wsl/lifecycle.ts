// Sleep and wake for a WSL distribution nodeterm owns.
//
// "Sleep" is `wsl --terminate`, which shuts down that distribution's instance while leaving its
// filesystem completely intact; this is the safe, reversible control for "this distribution is
// making the machine lag right now." "Wake" simply starts it again. Neither one is destructive,
// so unlike delete they need no confirmation gesture, but BOTH still refuse an unowned target:
// this app must never touch a distribution it did not create, reversible or not. A user's own
// `docker-desktop`, or a personal distribution from years before this feature existed, is exactly
// as off-limits to "sleep" as it is to "delete".

import type { WslRuntime } from './runtime'
import type { WslOwnershipStore } from './ownership'
import { detectWsl } from './install'

export type WslActionRefusalReason =
  | 'not-owned-by-app'
  | 'ownership-unknown'
  | 'wsl-unavailable'
  | 'command-failed'
  | 'confirmation-mismatch'

export type WslActionResult =
  | { ok: true }
  | { ok: false; reason: WslActionRefusalReason; error: string }

/**
 * Shared ownership gate for every mutating action in this package. Fails closed: if the ledger
 * cannot answer (a read error, not merely "not found"), this returns `false` and the caller
 * refuses. `isOwned` itself already returns `false` for both "genuinely not owned" and "could not
 * tell", so there is nothing further this function needs to distinguish, ownership is either
 * proven or the action does not happen.
 */
async function assertOwned(
  ownership: WslOwnershipStore,
  name: string
): Promise<WslActionResult | null> {
  const owned = await ownership.isOwned(name)
  if (!owned) {
    return {
      ok: false,
      reason: 'not-owned-by-app',
      error: `"${name}" was not created by nodeterm, so it cannot be managed from here. This refusal also covers the case where ownership could not be confirmed.`
    }
  }
  return null
}

export async function sleepWslDistribution(
  runtime: WslRuntime,
  ownership: WslOwnershipStore,
  name: string
): Promise<WslActionResult> {
  const refusal = await assertOwned(ownership, name)
  if (refusal) return refusal

  const availability = await detectWsl(runtime)
  if (!availability.installed) {
    return { ok: false, reason: 'wsl-unavailable', error: 'WSL is not installed on this machine.' }
  }

  const result = await runtime.execFile(availability.wslExePath, ['--terminate', name])
  if (result.error || result.exitCode !== 0) {
    return { ok: false, reason: 'command-failed', error: `wsl.exe could not stop "${name}".` }
  }
  return { ok: true }
}

export async function wakeWslDistribution(
  runtime: WslRuntime,
  ownership: WslOwnershipStore,
  name: string
): Promise<WslActionResult> {
  const refusal = await assertOwned(ownership, name)
  if (refusal) return refusal

  const availability = await detectWsl(runtime)
  if (!availability.installed) {
    return { ok: false, reason: 'wsl-unavailable', error: 'WSL is not installed on this machine.' }
  }

  // There is no dedicated "start" subcommand: running any no-op command inside the distribution
  // is what Microsoft's own tooling uses to bring it up. `true` is the smallest possible one.
  const result = await runtime.execFile(availability.wslExePath, ['-d', name, '--', 'true'])
  if (result.error || result.exitCode !== 0) {
    return { ok: false, reason: 'command-failed', error: `wsl.exe could not start "${name}".` }
  }
  return { ok: true }
}
