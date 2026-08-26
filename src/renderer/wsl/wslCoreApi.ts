/**
 * The narrow shape this branch needs from the sibling `src/core/wsl/` service (enumerate,
 * catalogue, create with a user-supplied name, sleep via terminate, wake, delete, auto-install
 * detection, per-distro memory). That module does not exist in THIS worktree, so this file
 * defines only what the canvas UI actually consumes and injects it — never imports from
 * `../../core/wsl/*` directly, so this branch typechecks and tests standalone.
 *
 * Assumed shape, stated once here so the report can say exactly what was assumed: `list()`
 * returns every WSL distribution currently registered on this machine (the real enumeration —
 * the same source of truth `revalidateWslBinding` must be checked against), each tagged with
 * `ownedByApp` from the core service's OWN durable, machine-local record of what it created —
 * never inferred here from a name or a shared binding. `catalogue()` returns installable
 * distributions (every flavour the machine's WSL can install, not a curated shortlist).
 * `create`/`sleep`/`wake`/`delete` each report a plain ok/error result; `delete` is expected to
 * itself refuse a distribution it does not own, as the final backstop behind the UI-side gate in
 * `@shared/wsl-binding`.
 */

export type WslInstanceState = 'running' | 'stopped'

export interface WslInstanceSummary {
  name: string
  state: WslInstanceState
  /** From the core service's own durable record — see the file header. Never derived here. */
  ownedByApp: boolean
  memoryMb?: number
}

export interface WslCatalogueEntry {
  /** Opaque id the core service resolves at create time (e.g. an app-store/distro package id). */
  id: string
  /** Human-readable name for the picker, e.g. "Ubuntu 24.04 LTS". */
  label: string
}

export type WslActionResult = { ok: true } | { ok: false; error: string }
export type WslCreateResult = { ok: true; name: string } | { ok: false; error: string }

export interface WslCoreApi {
  list(): Promise<WslInstanceSummary[]>
  catalogue(): Promise<WslCatalogueEntry[]>
  create(input: { catalogueId: string; name: string }): Promise<WslCreateResult>
  sleep(name: string): Promise<WslActionResult>
  wake(name: string): Promise<WslActionResult>
  /** Core is expected to refuse this itself when `name` is not app-owned, in addition to the UI
   *  never offering the control for one — see `canManageWslDistro`. */
  delete(name: string): Promise<WslActionResult>
}

export const WSL_UNSUPPORTED_ERROR =
  'WSL instance management is not available in this build yet.'

function unsupportedResult(): WslActionResult {
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
 *  `window.nodeTerminal.wsl` bridge once the sibling core work lands and wires it up. */
export function resolveWslApi(host?: WslApiHost): WslCoreApi {
  const w = host ?? (typeof window !== 'undefined' ? (window as unknown as WslApiHost) : undefined)
  return w?.nodeTerminal?.wsl ?? createUnsupportedWslApi()
}
