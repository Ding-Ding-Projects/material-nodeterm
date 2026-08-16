import type { DatabaseSync } from 'node:sqlite'

export const NODE_SQLITE_RUNTIME_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0'

interface NodeSqliteModule {
  DatabaseSync: typeof DatabaseSync
}

type BuiltinModuleLoader = (id: string) => unknown

function parsedVersion(version: string): [major: number, minor: number, patch: number] | undefined {
  // npm's engine range excludes prereleases by default. Accept build metadata, but reject a
  // prerelease so the executable preflight cannot claim support that `npm ci` itself disallows.
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(version)
  if (!match) return undefined
  const parts = match.slice(1, 4).map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part))) return undefined
  return parts as [number, number, number]
}

/**
 * node:sqlite was added in 22.5, but it still required --experimental-sqlite through 22.12.
 * The installed dependency graph sets the stricter supported floors below and excludes Node 23/25.
 */
export function supportsNodeRuntimeVersion(version: string): boolean {
  const parsed = parsedVersion(version)
  if (!parsed) return false
  const [major, minor, patch] = parsed
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2)
  if (major === 24) return minor >= 15
  return major >= 26
}

function defaultBuiltinModuleLoader(id: string): unknown {
  const getter = (process as NodeJS.Process & {
    getBuiltinModule?: (moduleId: string) => unknown
  }).getBuiltinModule
  return typeof getter === 'function' ? getter.call(process, id) : undefined
}

/**
 * Fail before either shell starts its services when the runtime cannot supply the OS-backed
 * SQLite lock used by cross-process mirror publication. Version and capability are both checked:
 * an otherwise-supported Node launched with --no-experimental-sqlite must fail just as clearly.
 */
export function loadNodeSqlite(
  version = process.versions.node,
  loadBuiltin: BuiltinModuleLoader = defaultBuiltinModuleLoader
): NodeSqliteModule {
  if (!supportsNodeRuntimeVersion(version)) {
    throw new Error(
      `nodeterm requires Node.js ${NODE_SQLITE_RUNTIME_RANGE}; found ${version}. ` +
      'The agent-status mirror needs unflagged node:sqlite support.'
    )
  }
  const sqlite = loadBuiltin('node:sqlite')
  if (
    !sqlite ||
    typeof sqlite !== 'object' ||
    typeof (sqlite as Partial<NodeSqliteModule>).DatabaseSync !== 'function'
  ) {
    throw new Error(
      `Node.js ${version} does not expose node:sqlite DatabaseSync. ` +
      'Remove --no-experimental-sqlite or install a supported Node.js runtime.'
    )
  }
  return sqlite as NodeSqliteModule
}

export function assertSupportedNodeRuntime(): void {
  const { DatabaseSync } = loadNodeSqlite()
  const database = new DatabaseSync(':memory:')
  database.close()
}
