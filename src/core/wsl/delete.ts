// Deleting a WSL distribution: `wsl --unregister`.
//
// This is IRREVERSIBLE and destroys the entire filesystem of that distribution, every file, every
// package, everything the user or any process inside it ever wrote. There is no undo, no trash,
// no recovery short of restoring from a backup that this app never took. It must never be
// reachable without deliberate, explicit intent, and it must never touch a distribution nodeterm
// did not create, full stop.
//
// The gate has three independent layers, and all three are required, not merely one for show:
//
//   1. A TYPE-LEVEL literal. `WslDeleteIntent.confirmDestroyEverything` is typed as the literal
//      `true`, not `boolean`. Code that has not deliberately written `confirmDestroyEverything:
//      true` cannot even compile a call to this function; there is no way to "accidentally" pass
//      a computed `false` through a variable of type `boolean` and have TypeScript accept it.
//   2. A RE-TYPED NAME. The caller must supply `name` a second time as `confirmName`, and the two
//      must match exactly (case-sensitive). This is the same friction as typing a resource's name
//      to confirm a destructive action in any other tool: it exists to catch a caller that wired
//      the wrong variable into the request, not to catch a determined bad actor.
//   3. An OWNERSHIP CHECK, re-read at call time rather than trusted from an earlier snapshot. A
//      distribution nodeterm did not create is refused unconditionally, however the first two
//      conditions were satisfied. This is the layer that specifically exists because of real
//      distributions on real machines (docker-desktop, a user's own Ubuntu) that this app must
//      never be able to reach with a mistaken or spoofed intent object.

import type { WslRuntime } from './runtime'
import type { WslOwnershipStore } from './ownership'
import { detectWsl } from './install'
import type { WslActionResult } from './lifecycle'

export interface WslDeleteIntent {
  name: string
  /** Must be the literal `true`. See the module header: this is a type-level gate, not a runtime
   *  toggle a caller can compute its way past. */
  confirmDestroyEverything: true
  /** Must equal `name` exactly. Catches a caller that wired the wrong name into the request. */
  confirmName: string
}

export async function deleteWslDistribution(
  runtime: WslRuntime,
  ownership: WslOwnershipStore,
  intent: WslDeleteIntent
): Promise<WslActionResult> {
  if (intent.confirmName !== intent.name) {
    return {
      ok: false,
      reason: 'confirmation-mismatch',
      error: 'The confirmation name did not match. Nothing was deleted.'
    }
  }

  const owned = await ownership.isOwned(intent.name)
  if (!owned) {
    return {
      ok: false,
      reason: 'not-owned-by-app',
      error: `"${intent.name}" was not created by nodeterm, so it cannot be deleted from here. This refusal also covers the case where ownership could not be confirmed.`
    }
  }

  const availability = await detectWsl(runtime)
  if (!availability.installed) {
    return { ok: false, reason: 'wsl-unavailable', error: 'WSL is not installed on this machine.' }
  }

  const result = await runtime.execFile(availability.wslExePath, ['--unregister', intent.name])
  if (result.error || result.exitCode !== 0) {
    return { ok: false, reason: 'command-failed', error: `wsl.exe could not delete "${intent.name}".` }
  }

  // The distribution and its entire filesystem are gone. Forgetting the ledger entry is cleanup,
  // not part of the safety contract, so its own failure does not turn a successful delete into a
  // reported failure, there is nothing left to protect by keeping a stale ownership record around,
  // and the ledger's own corrupt-file handling already refuses to guess at a safe rewrite.
  try {
    await ownership.forget(intent.name)
  } catch {
    // Deliberately swallowed. See comment above.
  }

  return { ok: true }
}
