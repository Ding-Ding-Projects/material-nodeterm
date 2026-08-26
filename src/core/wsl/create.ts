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
import type { WslCreateProgress, WslCreateProgressMessage } from '../../shared/wsl'

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

export interface WslCreateOptions {
  signal?: AbortSignal
  onProgress?: (progress: Pick<WslCreateProgress, 'stage' | 'step' | 'steps' | 'determinate' | 'message'>) => void
}

export async function createWslDistribution(
  runtime: WslRuntime,
  ownership: WslOwnershipStore,
  request: WslCreateRequest,
  options: WslCreateOptions = {}
): Promise<WslCreateResult> {
  const progress = (stage: WslCreateProgress['stage'], step: number, message: WslCreateProgressMessage, determinate = false): void =>
    options.onProgress?.({ stage, step, steps: 4, determinate, message })
  progress('validating', 1, { id: 'validating', params: {}, facts: [] })
  const validation = validateWslDistributionName(request.name, request.existingNames)
  if (!validation.ok) {
    return { ok: false, error: validation.message, validation }
  }
  if (request.catalogName.length === 0) {
    return { ok: false, error: 'Choose which Linux distribution to install.' }
  }

  if (options.signal?.aborted) return { ok: false, error: 'WSL instance creation was cancelled.' }
  progress('checking', 2, { id: 'checking', params: {}, facts: [] })
  const availability = await detectWsl(runtime)
  if (options.signal?.aborted) return { ok: false, error: 'WSL instance creation was cancelled.' }
  if (!availability.installed) {
    return { ok: false, error: 'WSL is not installed on this machine, so nothing can be created.' }
  }

  progress('installing', 3, {
    id: 'installing',
    params: { name: request.name, catalogue: request.catalogName },
    facts: [request.name, request.catalogName, 'wsl.exe']
  })
  const result = await runtime.execFile(
    availability.wslExePath,
    ['--install', '--distribution', request.catalogName, '--name', request.name, '--no-launch'],
    { timeoutMs: WSL_INSTALL_TIMEOUT_MS, signal: options.signal }
  )
  if (options.signal?.aborted) return { ok: false, error: 'WSL instance creation was cancelled.' }
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
    progress('recording', 4, {
      id: 'recording',
      params: { name: request.name },
      facts: [request.name]
    })
    await ownership.record(request.name)
  } catch {
    return {
      ok: false,
      error:
        `"${request.name}" was created, but nodeterm could not record that it owns it, so it ` +
        'will not be manageable from here until this is retried.'
    }
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      error:
        `WSL instance "${request.name}" was created before cancellation completed; no canvas frame was bound.`
    }
  }
  progress('completed', 4, {
    id: 'completed',
    params: { name: request.name },
    facts: [request.name]
  }, true)
  return { ok: true }
}
