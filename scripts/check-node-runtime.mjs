import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const NODE_RUNTIME_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0'

function parsedVersion(version) {
  // Match npm engine semantics: build metadata is acceptable, prereleases are not.
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(version)
  if (!match) return undefined
  const parts = match.slice(1, 4).map(Number)
  return parts.every(Number.isSafeInteger) ? parts : undefined
}

export function supportsNodeRuntimeVersion(version) {
  const parsed = parsedVersion(version)
  if (!parsed) return false
  const [major, minor, patch] = parsed
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2)
  if (major === 24) return minor >= 15
  return major >= 26
}

export function assertNodeRuntime(
  version = process.versions.node,
  loadBuiltin = (id) => process.getBuiltinModule?.(id)
) {
  if (!supportsNodeRuntimeVersion(version)) {
    throw new Error(`nodeterm requires Node.js ${NODE_RUNTIME_RANGE}; found ${version}`)
  }
  const sqlite = loadBuiltin('node:sqlite')
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error(
      `Node.js ${version} does not expose node:sqlite DatabaseSync; ` +
      'remove --no-experimental-sqlite or install a supported runtime'
    )
  }
  // Construction is the capability contract. A custom build can expose the name while omitting
  // its backing SQLite support; opening and closing memory-only state performs no disk write.
  const database = new sqlite.DatabaseSync(':memory:')
  database.close()
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    assertNodeRuntime()
    if (!process.argv.includes('--quiet')) {
      console.log(`Node.js ${process.versions.node} satisfies ${NODE_RUNTIME_RANGE} with node:sqlite`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
