// Shared types for the WSL distribution-management bridge. No Node/Electron imports — safe for
// the renderer, and the single place both the core service (src/core/wsl/service.ts) and the
// renderer consumer (src/renderer/wsl/wslCoreApi.ts) agree on what crosses the IPC/RPC boundary.
//
// These shapes are DELIBERATELY narrower than the full `src/core/wsl/*` package's own types
// (WslInstalledDistribution, WslCreateRequest, WslDeleteIntent, …): they are what the canvas UI
// actually consumes, adapted from core's more defensive internal contract at the service layer.
// See `src/core/wsl/service.ts`'s header comment for exactly which fields are dropped and why.

export type WslInstanceState = 'running' | 'stopped'

export interface WslInstanceSummary {
  name: string
  state: WslInstanceState
  /** From the core service's own durable ownership ledger, re-read fresh on every enumeration —
   *  never inferred from a name, a prefix, or anything persisted in a shared project file. */
  ownedByApp: boolean
  memoryMb?: number
}

export interface WslCatalogueEntry {
  /** The exact machine name `wsl --install -d <name>` expects — Windows' own catalog has no
   *  separate opaque package id, so the catalog NAME is reused verbatim as the create-time id. */
  id: string
  /** Human-readable name for the picker, e.g. "Ubuntu 24.04 LTS". */
  label: string
}

export type WslActionResult = { ok: true } | { ok: false; error: string }
export type WslCreateResult = { ok: true; name: string } | { ok: false; error: string }

export interface WslApi {
  /** Every installed distribution on this machine, this app's own and pre-existing ones alike.
   *  REJECTS (never resolves to an empty array) when the machine could not actually be read —
   *  WSL missing, wsl.exe erroring, output that could not be parsed. "We looked and there is
   *  nothing" and "we could not look" are different facts, and a caller (see
   *  `src/renderer/state/wsl.ts`) must be able to tell them apart. */
  list(): Promise<WslInstanceSummary[]>
  /** Every distribution `wsl --install -d <name>` could install. Rejects on the same terms as
   *  `list()` — a failed catalog read must never resolve to an empty, healthy-looking list. */
  catalogue(): Promise<WslCatalogueEntry[]>
  create(input: { catalogueId: string; name: string }): Promise<WslCreateResult>
  sleep(name: string): Promise<WslActionResult>
  wake(name: string): Promise<WslActionResult>
  /** The core service refuses this itself when `name` is not app-owned, in addition to the UI
   *  never offering the control for one. */
  delete(name: string): Promise<WslActionResult>
}
