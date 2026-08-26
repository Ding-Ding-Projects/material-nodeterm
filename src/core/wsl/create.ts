// Creating a new WSL distribution: `wsl --install -d <catalogName> -n <name>` (installing a
// catalog distribution under a chosen local name) or, for an ownership-only wrapper of an already
// existing distribution, simply recording it.
//
// This module owns the one moment ownership begins: on success, and only on success, the new
// name is written into the ownership ledger. Every later mutation (sleep, wake, delete) checks
// that ledger before touching anything, so a create that "succeeds" without a persisted ownership
// record would leave nodeterm's own distribution behaving, from the app's point of view, exactly
// like a stranger's, unable to ever be put to sleep or deleted through this app again.

import type { WslRuntime } from './runtime'
import { WSL_INSTALL_TIMEOUT_MS } from './runtime'
import type { WslOwnershipStore } from './ownership'
import { validateWslDistributionName, type WslNameValidation } from './name'
import { detectWsl } from './install'

export type WslCreateResult =
  | { ok: true }
  | { ok: false; error: string; validation?: WslNameValidation }

export interface WslCreateRequest {
  /** The local name the new distribution will be created under, and the name every later
   *  operation in this package addresses it by. */
  name: string
  /** The catalog distribution to install (one of `WslOnlineDistribution.name` from `catalog.ts`),
   *  for example "Ubuntu" or "Debian". */
  catalogName: string
  /** Every distribution name currently on the machine, used for the collision check. */
  existingNames: readonly string[]
}

export async function createWslDistribution(
  runtime: WslRuntime,
  ownership: WslOwnershipStore,
  request: WslCreateRequest
): Promise<WslCreateResult> {
  const validation = validateWslDistributionName(request.name, request.existingNames)
  if (!validation.ok) {
    return { ok: false, error: validation.message, validation }
  }
  if (request.catalogName.length === 0) {
    return { ok: false, error: 'Choose which Linux distribution to install.' }
  }

  const availability = await detectWsl(runtime)
  if (!availability.installed) {
    return { ok: false, error: 'WSL is not installed on this machine, so nothing can be created.' }
  }

  const result = await runtime.execFile(
    availability.wslExePath,
    ['--install', '--distribution', request.catalogName, '--name', request.name, '--no-launch'],
    { timeoutMs: WSL_INSTALL_TIMEOUT_MS }
  )
  if (result.error || result.exitCode !== 0) {
    return {
      ok: false,
      error: `wsl.exe could not create "${request.name}" from "${request.catalogName}".`
    }
  }

  // The distribution now genuinely exists. Recording ownership is not optional bookkeeping: it is
  // the only thing that will ever let this app sleep, wake, or delete what it just created. A
  // failure here must be reported as a failed create even though wsl.exe already did its part,
  // because an unrecorded distribution is functionally orphaned from this app's point of view.
  try {
    await ownership.record(request.name)
  } catch {
    return {
      ok: false,
      error:
        `"${request.name}" was created, but nodeterm could not record that it owns it, so it ` +
        'will not be manageable from here until this is retried.'
    }
  }

  return { ok: true }
}
