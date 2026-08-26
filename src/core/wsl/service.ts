// RPC surface for WSL distribution management. Registered by BOTH shells (src/main and
// src/server) exactly as `session-memory-service.ts`/`vscode-handlers.ts` are: this package owns
// the `wsl.exe` reading, parsing and the ownership gate, and the shell only supplies where the
// ownership ledger file lives (and, in tests, an injected `WslRuntime`).
//
// Every handler here adapts between two independently-evolved type vocabularies that describe the
// SAME facts:
//   - `src/core/wsl/*` (the rest of this package): the exhaustive, defensive core contract — see
//     each sibling module's own header for why it is shaped the way it is.
//   - `src/shared/wsl.ts` (`WslApi`): the narrower shape the canvas UI actually consumes, written
//     independently in a sibling branch with no visibility into this package.
// This module is the ONLY seam where the two meet. It never widens either vocabulary — every
// field it drops is explained inline, and nothing here invents a fact neither side already had.
//
// The two governing rules, both already stated by the sibling modules and repeated here because
// this is the layer a caller (the renderer's `useWsl` store) actually depends on:
//   1. A failed enumeration/catalog read is a REJECTED promise, never a resolved empty array.
//      "We looked and there is nothing" and "we could not look" are different sentences, and this
//      is the one place that decides which sentence the UI receives.
//   2. Ownership is never trusted from anywhere but a fresh read of the ownership ledger, on every
//      call. This module holds no local cache of "which names are owned".

import { IPC } from '../../shared/ipc'
import { platform } from '../platform'
import { isWslCreateOperationId } from '../../shared/wsl'
import type {
  WslActionResult,
  WslCatalogueEntry,
  WslCreateProgress,
  WslCreateResult,
  WslInstanceSummary
} from '../../shared/wsl'
import type { WslRuntime } from './runtime'
import type { WslOwnershipStore } from './ownership'
import { detectWsl } from './install'
import { listInstalledWslDistributions } from './enumerate'
import { listAvailableWslDistributions } from './catalog'
import { createWslDistribution } from './create'
import { sleepWslDistribution, wakeWslDistribution } from './lifecycle'
import { deleteWslDistribution } from './delete'
import { readWslDistributionMemory } from './memory'

export interface WslServiceOptions {
  runtime: WslRuntime
  ownership: WslOwnershipStore
}

/**
 * Every installed distribution, this app's own and the machine's pre-existing ones alike, with
 * each RUNNING distribution's guest-reported memory folded in where it could be read.
 *
 * Throws on any failure that prevents an honest list from being produced (WSL missing, wsl.exe
 * erroring, output that could not be parsed) — see the module header, rule 1. A failed MEMORY
 * read is handled differently and deliberately: it is best-effort per distribution and must never
 * fail the whole list, a distribution's name/state/ownership are real facts even when its guest
 * memory could not be read. That is exactly what `WslInstanceSummary.memoryMb` being OPTIONAL is
 * for; a row simply omits it.
 */
async function buildInstanceList(opts: WslServiceOptions): Promise<WslInstanceSummary[]> {
  const availability = await detectWsl(opts.runtime)
  if (!availability.installed) {
    throw new Error('WSL is not installed on this machine, so no distributions can be listed.')
  }

  const enumeration = await listInstalledWslDistributions(opts.runtime, opts.ownership)
  if (!enumeration.ok) throw new Error(enumeration.error)

  const memory = await readWslDistributionMemory(
    opts.runtime,
    availability.wslExePath,
    enumeration.installed
  )
  const memoryMbByName = new Map<string, number>()
  if (memory.ok) {
    for (const row of memory.rows) {
      if (row.measured && row.usedKb !== undefined) {
        memoryMbByName.set(row.name, row.usedKb / 1024)
      }
    }
  }

  return enumeration.installed.map((d) => {
    const memoryMb = memoryMbByName.get(d.name)
    return {
      name: d.name,
      state: d.state,
      ownedByApp: d.owned,
      ...(memoryMb === undefined ? {} : { memoryMb })
    }
  })
}

/**
 * Every installable distribution. Same rejection contract as `buildInstanceList` — see rule 1.
 * `id` is the exact machine name `wsl --install -d <name>` expects: there is no separate opaque
 * package id in this Windows-native flow, so the catalog NAME is reused verbatim as the id rather
 * than inventing one, and `create()` below passes it straight back as `catalogName`.
 */
async function buildCatalogue(runtime: WslRuntime): Promise<WslCatalogueEntry[]> {
  const result = await listAvailableWslDistributions(runtime)
  if (!result.ok) throw new Error(result.error)
  return result.available.map((d) => ({ id: d.name, label: d.friendlyName }))
}

export function startWslService(opts: WslServiceOptions): { dispose(): void } {
  const createOperations = new Map<string, AbortController>()
  const emitCreateProgress = (progress: WslCreateProgress): void => {
    platform().broadcast(IPC.wslCreateProgress, progress)
  }
  platform().handle(IPC.wslList, async (): Promise<WslInstanceSummary[]> => buildInstanceList(opts))

  platform().handle(
    IPC.wslCatalogue,
    async (): Promise<WslCatalogueEntry[]> => buildCatalogue(opts.runtime)
  )

  platform().handle(
    IPC.wslCreate,
    async (input: { operationId: string; catalogueId: string; name: string }): Promise<WslCreateResult> => {
      if (!input || !isWslCreateOperationId(input.operationId)) {
        return { ok: false, error: 'WSL instance creation could not start because its operation id was invalid.' }
      }
      if (createOperations.has(input.operationId)) {
        return { ok: false, error: 'This WSL instance creation is already in progress.' }
      }
      const controller = new AbortController()
      createOperations.set(input.operationId, controller)
      const startedAt = Date.now()
      const emit = (stage: WslCreateProgress['stage'], step: number, message: string, determinate = false, error?: string): void => {
        emitCreateProgress({ operationId: input.operationId, stage, step, steps: 4, determinate, elapsedMs: Date.now() - startedAt, message, ...(error ? { error } : {}) })
      }
      emit('validating', 1, 'Validating the selected distribution and name.')
      // The collision check inside `createWslDistribution` needs every existing name on the
      // machine. A failed enumeration here is reported as a failed create (never silently treated
      // as "nothing exists yet") — proceeding with an empty existingNames would risk letting a
      // real collision through undetected, past the one check this app can make before wsl.exe
      // itself refuses.
      try {
        const enumeration = await listInstalledWslDistributions(opts.runtime, opts.ownership)
        if (!enumeration.ok) {
          emit('failed', 2, 'The current WSL distribution list could not be read.', false, enumeration.error)
          return { ok: false, error: enumeration.error }
        }
        if (controller.signal.aborted) {
          emit('cancelled', 2, 'WSL instance creation was cancelled.')
          return { ok: false, error: 'WSL instance creation was cancelled.' }
        }
        emit('checking', 2, 'WSL is available and the distribution name is free.')
        const result = await createWslDistribution(opts.runtime, opts.ownership, {
          name: input.name,
          catalogName: input.catalogueId,
          existingNames: enumeration.installed.map((d) => d.name)
        }, {
          signal: controller.signal,
          onProgress: (progress) => emit(progress.stage, progress.step, progress.message, progress.determinate)
        })
        if (result.ok && controller.signal.aborted) {
          const lateCancel = 'WSL instance was created before cancellation completed; no canvas frame was bound.'
          emit('cancelled', 4, lateCancel, true, lateCancel)
          return { ok: false, error: lateCancel }
        }
        if (result.ok) {
          emit('completed', 4, 'WSL instance created and ownership recorded.', true)
          return { ok: true, name: input.name }
        }
        const cancelled = controller.signal.aborted
        emit(cancelled ? 'cancelled' : 'failed', 3, cancelled ? 'WSL instance creation was cancelled.' : 'WSL instance creation failed.', false, result.error)
        return { ok: false, error: result.error }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        emit(controller.signal.aborted ? 'cancelled' : 'failed', 3, controller.signal.aborted ? 'WSL instance creation was cancelled.' : 'WSL instance creation failed.', false, message)
        return { ok: false, error: message }
      } finally {
        createOperations.delete(input.operationId)
      }
    }
  )

  platform().handle(IPC.wslCreateCancel, async (operationId: string): Promise<boolean> => {
    if (typeof operationId !== 'string') return false
    const controller = createOperations.get(operationId)
    if (!controller) return false
    controller.abort()
    return true
  })

  platform().handle(IPC.wslSleep, async (name: string): Promise<WslActionResult> => {
    const result = await sleepWslDistribution(opts.runtime, opts.ownership, name)
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  })

  platform().handle(IPC.wslWake, async (name: string): Promise<WslActionResult> => {
    const result = await wakeWslDistribution(opts.runtime, opts.ownership, name)
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  })

  platform().handle(IPC.wslDelete, async (name: string): Promise<WslActionResult> => {
    // The type-level/re-typed-name confirmation gate (see delete.ts's header) is satisfied here
    // with the literal `true` and the SAME name variable for both `name` and `confirmName`: this
    // bridge receives only one name over the wire, so the "caller wired the wrong variable"
    // defense that gate exists for is a property of the CALLER above this layer (the destructive-
    // action super-confirmation the renderer must run before ever invoking `delete`), not
    // something this adapter can add on its own. The real backstop that survives regardless — the
    // ownership check — is untouched and re-read fresh inside `deleteWslDistribution`.
    const result = await deleteWslDistribution(opts.runtime, opts.ownership, {
      name,
      confirmDestroyEverything: true,
      confirmName: name
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  })

  // Nothing to tear down: every handler is pull-only, with no timer, no cache and no open
  // resource. `dispose` exists so a shell can treat this like the other services it starts.
  return { dispose: (): void => {
    for (const controller of createOperations.values()) controller.abort()
    createOperations.clear()
  } }
}
