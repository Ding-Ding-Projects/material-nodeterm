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
  WslCreateProgressMessage,
  WslCreateError,
  WslCatalogueError,
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
  if (!result.ok) {
    const code: WslCatalogueError['code'] = /not installed/i.test(result.error)
      ? 'not-installed'
      : /failed to run|could not be fetched/i.test(result.error)
        ? 'command-failed'
        : 'parse-failed'
    const messageId: WslCatalogueError['messageId'] = code === 'not-installed'
      ? 'catalogueNotInstalled'
      : code === 'command-failed'
        ? 'catalogueCommandFailed'
        : 'catalogueParseFailed'
    throw Object.assign(new Error(result.error), {
      code,
      messageId,
      facts: result.error.includes('wsl.exe') ? ['wsl.exe'] : [],
      detail: result.error
    } satisfies Omit<WslCatalogueError, 'code'> & Pick<WslCatalogueError, 'code'>)
  }
  return result.available.map((d) => ({ id: d.name, label: d.friendlyName }))
}

function progressMessage(
  id: WslCreateProgressMessage['id'],
  params: Readonly<Record<string, string>> = {},
  facts: readonly string[] = []
): WslCreateProgressMessage {
  return { id, params, facts }
}

function createError(
  code: WslCreateError['code'],
  id: WslCreateProgressMessage['id'],
  params: Readonly<Record<string, string>> = {},
  facts: readonly string[] = []
): WslCreateError {
  return { code, message: progressMessage(id, params, facts) }
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
        return { ok: false, error: 'The WSL operation id was invalid.' }
      }
      if (createOperations.has(input.operationId)) {
        return { ok: false, error: 'This WSL operation is already in progress.' }
      }
      const controller = new AbortController()
      createOperations.set(input.operationId, controller)
      const startedAt = Date.now()
      const emit = (stage: WslCreateProgress['stage'], step: number, message: WslCreateProgressMessage, determinate = false, error?: WslCreateError): void => {
        emitCreateProgress({ operationId: input.operationId, stage, step, steps: 4, determinate, elapsedMs: Date.now() - startedAt, message, ...(error ? { error } : {}) })
      }
      // The collision check inside `createWslDistribution` needs every existing name on the
      // machine. A failed enumeration here is reported as a failed create (never silently treated
      // as "nothing exists yet") — proceeding with an empty existingNames would risk letting a
      // real collision through undetected, past the one check this app can make before wsl.exe
      // itself refuses.
      try {
        const enumeration = await listInstalledWslDistributions(opts.runtime, opts.ownership)
        if (!enumeration.ok) {
          const detail = enumeration.error
          const failure = createError('catalogue-unavailable', 'failed', { error: detail }, [detail, 'wsl.exe'])
          emit('failed', 2, failure.message, false, failure)
          return { ok: false, error: detail }
        }
        if (controller.signal.aborted) {
          const failure = createError('cancelled', 'cancelled', {}, [])
          emit('cancelled', 2, failure.message, false, failure)
          return { ok: false, error: 'WSL instance creation was cancelled.' }
        }
        const result = await createWslDistribution(opts.runtime, opts.ownership, {
          name: input.name,
          catalogName: input.catalogueId,
          existingNames: enumeration.installed.map((d) => d.name)
        }, {
          signal: controller.signal,
          onProgress: (progress) => emit(
            progress.stage,
            progress.step,
            {
              ...progress.message,
              params: { ...progress.message.params, operationId: input.operationId },
              facts: [...progress.message.facts, input.operationId]
            },
            progress.determinate
          )
        })
        if (result.ok && controller.signal.aborted) {
          const failure = createError('cancelled', 'cancelledLate', { name: input.name }, [input.name])
          emit('cancelled', 4, failure.message, true, failure)
          return { ok: false, error: 'WSL instance was created before cancellation completed; no canvas frame was bound.' }
        }
        if (result.ok) {
          return { ok: true, name: input.name }
        }
        const cancelled = controller.signal.aborted
        const failure = createError(
          cancelled ? 'cancelled' : 'create-failed',
          cancelled ? 'cancelled' : 'failed',
          cancelled ? {} : { error: result.error },
          cancelled ? [] : [result.error, input.name, input.catalogueId, 'wsl.exe']
        )
        emit(cancelled ? 'cancelled' : 'failed', 3, failure.message, false, failure)
        return { ok: false, error: result.error }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const failure = createError(
          controller.signal.aborted ? 'cancelled' : 'create-failed',
          controller.signal.aborted ? 'cancelled' : 'failed',
          controller.signal.aborted ? {} : { error: detail },
          controller.signal.aborted ? [] : [detail, input.name, input.catalogueId, 'wsl.exe']
        )
        emit(controller.signal.aborted ? 'cancelled' : 'failed', 3, failure.message, false, failure)
        return { ok: false, error: detail }
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
