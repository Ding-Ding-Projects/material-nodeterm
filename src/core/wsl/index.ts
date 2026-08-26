// Public surface of the Electron-free WSL manager core. Every mutating operation exported here
// (create, sleep, wake, delete) is gated on the ownership ledger in `ownership.ts`: this app may
// only ever act on a distribution it itself created. Enumeration is read-only and may report the
// user's own pre-existing distributions too (docker-desktop and the like), clearly marked
// `owned: false`, so the layer above has enough context to show what already exists without ever
// being able to accidentally offer a mutating action on it.

export type { WslRuntime, WslCommandResult, WslExecOptions } from './runtime'
export { defaultWslRuntime, WSL_COMMAND_TIMEOUT_MS, WSL_INSTALL_TIMEOUT_MS } from './runtime'

export type { WslOwnershipStore, WslOwnershipRecord } from './ownership'
export { fileWslOwnershipStore, inMemoryWslOwnershipStore } from './ownership'

export type { WslDistribution, WslDistributionState } from './list'
export { parseWslVerboseList } from './list'

export type { WslInstalledDistribution, WslEnumerationResult } from './enumerate'
export { listInstalledWslDistributions, wslNameCollides } from './enumerate'

export type { WslOnlineDistribution, WslCatalogResult } from './catalog'
export { parseWslOnlineList, listAvailableWslDistributions } from './catalog'

export type { WslNameRefusalReason, WslNameValidation } from './name'
export { validateWslDistributionName } from './name'

export type { WslCreateRequest, WslCreateResult } from './create'
export { createWslDistribution } from './create'

export type { WslActionRefusalReason, WslActionResult } from './lifecycle'
export { sleepWslDistribution, wakeWslDistribution } from './lifecycle'

export type { WslDeleteIntent } from './delete'
export { deleteWslDistribution } from './delete'

export type { WslAvailability, WslInstallOutcome } from './install'
export { detectWsl, installWsl } from './install'

export type { WslDistributionMemory, WslMemoryReport } from './memory'
export { readWslDistributionMemory } from './memory'
