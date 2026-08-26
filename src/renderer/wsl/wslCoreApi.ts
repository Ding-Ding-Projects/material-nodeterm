/**
 * The narrow shape this canvas UI needs from the sibling `src/core/wsl/` service (enumerate,
 * catalogue, create with a user-supplied name, sleep via terminate, wake, delete, auto-install
 * detection, per-distro memory), bridged over IPC/RPC by `src/core/wsl/service.ts` and exposed at
 * `window.nodeTerminal.wsl`.
 *
 * Types are re-exported from `@shared/wsl` — the single place both the core service and this
 * renderer consumer agree on what crosses the boundary — rather than declared here a second time,
 * so the two can never drift apart. `resolveWslApi` reads `window.nodeTerminal.wsl` and never
 * imports from `../../core/wsl/*` directly, so this module still typechecks and tests standalone
 * of the core package's own (much larger, more defensive) internal contract.
 *
 * `list()` returns every WSL distribution currently registered on this machine (the real
 * enumeration — the same source of truth `revalidateWslBinding` must be checked against), each
 * tagged with `ownedByApp` from the core service's OWN durable, machine-local record of what it
 * created — never inferred here from a name. `catalogue()` returns installable distributions
 * (every flavour the machine's WSL can install, not a curated shortlist). `create`/`sleep`/
 * `wake`/`delete` each report a plain ok/error result; `delete` is expected to itself refuse a
 * distribution it does not own, as the final backstop behind the UI-side gate in
 * `@shared/wsl-binding`.
 */

export type {
  WslInstanceState,
  WslInstanceSummary,
  WslCatalogueEntry,
  WslActionResult,
  WslCreateResult,
  WslApi as WslCoreApi
} from '@shared/wsl'

import type { WslApi as WslCoreApi } from '@shared/wsl'

export const WSL_UNSUPPORTED_ERROR =
  'WSL instance management is not available in this build yet.'

function unsupportedResult(): { ok: false; error: string } {
  return { ok: false, error: WSL_UNSUPPORTED_ERROR }
}

/** Every method fails closed and honestly — never a silent no-op, never a fabricated success. */
export function createUnsupportedWslApi(): WslCoreApi {
  return {
    list: async () => [],
    catalogue: async () => [],
    create: async () => ({ ok: false, error: WSL_UNSUPPORTED_ERROR }),
    sleep: async () => unsupportedResult(),
    wake: async () => unsupportedResult(),
    delete: async () => unsupportedResult()
  }
}

interface WslApiHost {
  nodeTerminal?: { wsl?: WslCoreApi }
}

/** Injectable for tests; production call sites use the zero-arg overload, which reads the real
 *  `window.nodeTerminal.wsl` bridge. */
export function resolveWslApi(host?: WslApiHost): WslCoreApi {
  const w = host ?? (typeof window !== 'undefined' ? (window as unknown as WslApiHost) : undefined)
  return w?.nodeTerminal?.wsl ?? createUnsupportedWslApi()
}
