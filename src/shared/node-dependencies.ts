/**
 * Shared contract for dependencies used by node features.
 *
 * This module is intentionally platform-free. The manifest is immutable application data, while
 * the lifecycle implementation lives in src/core/node-dependencies and is only reachable through
 * the privileged CorePlatform IPC boundary. Paths and installation records never cross into a
 * project file or the renderer as an implicit readiness claim.
 */

export type NodeDependencyPlatform = 'win32' | 'linux'
export type NodeDependencyArchitecture = 'x64' | 'arm64'

export type NodeDependencyArchiveFormat = 'zip' | 'tar.gz' | 'tar.xz' | 'msi' | 'binary'
export type NodeDependencyInstallMode = 'bundled' | 'portable' | 'user-scoped'

export type NodeDependencyState =
  | 'missing'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'repairing'
  | 'cancelled'
  | 'failed'
  | 'unavailable'

export interface NodeDependencyHealthProbe {
  kind: 'file' | 'executable-version'
  /** Relative path inside the published installation, never an absolute user-provided path. */
  relativePath: string
  /** Fixed arguments for executable-version probes. No shell is ever involved. */
  args?: readonly string[]
  /** Exact expected output, when the probe is an executable-version probe. */
  expectedVersion?: string
  /** Expected leading version token when the executable appends build/runtime details. */
  expectedVersionPrefix?: string
}

export interface NodeDependencyRepairStrategy {
  kind: 'reinstall-from-cache-or-source'
  /** Explains the repair trigger to a caller without exposing machine paths. */
  description: string
}

export interface NodeDependencyLicense {
  spdx: string
  redistributable: boolean
  notice?: string
}

export interface NodeDependencyManifestEntry {
  id: string
  version: string
  platform: NodeDependencyPlatform
  architecture: NodeDependencyArchitecture
  /** Canonical upstream URL. It must be HTTPS and is never supplied by a user. */
  source: string
  sha256: string
  /** Relative path in packaged resources when a bundled artifact exists. */
  bundledSource: string | null
  archiveFormat: NodeDependencyArchiveFormat
  /** Paths expected after extraction, relative to the archive root. */
  expectedFiles: readonly string[]
  unpackedSizeBytes: number
  license: NodeDependencyLicense
  installMode: NodeDependencyInstallMode
  healthProbe: NodeDependencyHealthProbe
  repairStrategy: NodeDependencyRepairStrategy
}

export interface NodeDependencyInstallRecord {
  schemaVersion: 1
  id: string
  version: string
  platform: NodeDependencyPlatform
  architecture: NodeDependencyArchitecture
  state: NodeDependencyState
  archiveSha256: string | null
  /** Machine-local paths. These records are stored only below CorePlatform.userDataDir. */
  installPath: string | null
  executablePath: string | null
  updatedAt: number
  error: string | null
  resume: NodeDependencyResumeMetadata | null
  /** Which verified immutable archive supplied the published payload. */
  archiveSource?: 'bundled' | 'verified-cache' | 'verified-download' | null
}

export interface NodeDependencyModelInventoryEntry {
  service: string
  versions: readonly string[]
  modelFileCount: number
}

export interface NodeDependencyDetails {
  dependency: NodeDependencyAvailability
  version: string | null
  versionOutput: string | null
  archiveSource: NodeDependencyInstallRecord['archiveSource']
  models: readonly NodeDependencyModelInventoryEntry[]
  modelCount: number
  inventoryComplete: boolean
  inventoryError: string | null
}

export interface NodeDependencyResumeMetadata {
  operationId: string
  phase: NodeDependencyState
  completedBytes: number
  totalBytes: number | null
  canResume: boolean
}

export interface NodeDependencyProgress {
  operationId: string
  id: string
  state: NodeDependencyState
  completedBytes: number
  totalBytes: number | null
  message: string
}

export interface NodeDependencyAvailability {
  manifest: NodeDependencyManifestEntry
  record: NodeDependencyInstallRecord | null
  state: NodeDependencyState
  available: boolean
  executablePath: string | null
  /** Exact, actionable reason when available is false. */
  disabledReason: string | null
  resume: NodeDependencyResumeMetadata | null
}

export interface NodeDependencyInstallResult {
  ok: boolean
  operationId: string | null
  dependency: NodeDependencyAvailability
  error: string | null
}

export interface NodeDependenciesApi {
  catalog(): Promise<NodeDependencyAvailability[]>
  status(id: string): Promise<NodeDependencyAvailability>
  details(id: string): Promise<NodeDependencyDetails>
  install(id: string): Promise<NodeDependencyInstallResult>
  cancel(operationId: string): Promise<boolean>
  repair(id: string): Promise<NodeDependencyInstallResult>
  reconcile(): Promise<NodeDependencyAvailability[]>
  onState(listener: (value: NodeDependencyAvailability) => void): () => void
  onProgress(listener: (value: NodeDependencyProgress) => void): () => void
}

const NODE_SOURCE_X64 = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip'
const NODE_SOURCE_ARM64 = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-arm64.zip'
const AWS_CLI_VERSION = '2.36.32'
const AWS_CLI_SOURCE_X64 = `https://awscli.amazonaws.com/AWSCLIV2-User-${AWS_CLI_VERSION}.msi`

/**
 * The first shared node-feature dependency. New catalog entries add rows here, never free-form
 * URLs. The values mirror dependencies.manifest.json and are intentionally explicit so a build
 * can audit the dependency contract without reading a machine-local file.
 */
export const NODE_DEPENDENCY_MANIFEST: readonly NodeDependencyManifestEntry[] = [
  {
    id: 'aws-cli-v2',
    version: AWS_CLI_VERSION,
    platform: 'win32',
    architecture: 'x64',
    source: AWS_CLI_SOURCE_X64,
    sha256: 'bc695531b7fd83490e02741777dfda109cfab7fd9bef85fa1d5db21684cbaee2',
    bundledSource: `node-dependencies/aws-cli-v2/AWSCLIV2-User-${AWS_CLI_VERSION}.msi`,
    archiveFormat: 'msi',
    expectedFiles: ['aws.exe', 'awscli/data/ac.index'],
    unpackedSizeBytes: 260_000_000,
    license: {
      spdx: 'Apache-2.0',
      redistributable: true,
      notice: 'AWS CLI v2 includes third-party components; retain the license and notice files shipped by AWS.'
    },
    installMode: 'bundled',
    healthProbe: {
      kind: 'executable-version',
      relativePath: 'aws.exe',
      args: ['--version'],
      expectedVersionPrefix: `aws-cli/${AWS_CLI_VERSION}`
    },
    repairStrategy: {
      kind: 'reinstall-from-cache-or-source',
      description: 'Reverify the bundled or cached AWS MSI, then republish a fresh app-local payload.'
    }
  },
  {
    id: 'node-runtime',
    version: '24.19.0',
    platform: 'win32',
    architecture: 'x64',
    source: NODE_SOURCE_X64,
    sha256: '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73',
    bundledSource: null,
    archiveFormat: 'zip',
    expectedFiles: ['node.exe', 'npm.cmd'],
    unpackedSizeBytes: 110_000_000,
    license: {
      spdx: 'MIT',
      redistributable: true,
      notice: 'Node.js includes third-party components; see its bundled LICENSE files.'
    },
    installMode: 'portable',
    healthProbe: {
      kind: 'executable-version',
      relativePath: 'node.exe',
      args: ['--version'],
      expectedVersion: 'v24.19.0'
    },
    repairStrategy: {
      kind: 'reinstall-from-cache-or-source',
      description: 'Reverify the cached archive, then republish a fresh user-scoped installation.'
    }
  },
  {
    id: 'node-runtime',
    version: '24.19.0',
    platform: 'win32',
    architecture: 'arm64',
    source: NODE_SOURCE_ARM64,
    sha256: '8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f',
    bundledSource: null,
    archiveFormat: 'zip',
    expectedFiles: ['node.exe', 'npm.cmd'],
    unpackedSizeBytes: 110_000_000,
    license: {
      spdx: 'MIT',
      redistributable: true,
      notice: 'Node.js includes third-party components; see its bundled LICENSE files.'
    },
    installMode: 'portable',
    healthProbe: {
      kind: 'executable-version',
      relativePath: 'node.exe',
      args: ['--version'],
      expectedVersion: 'v24.19.0'
    },
    repairStrategy: {
      kind: 'reinstall-from-cache-or-source',
      description: 'Reverify the cached archive, then republish a fresh user-scoped installation.'
    }
  }
]

export function dependencyManifestFor(
  platform: NodeDependencyPlatform,
  architecture: NodeDependencyArchitecture
): NodeDependencyManifestEntry[] {
  return NODE_DEPENDENCY_MANIFEST.filter(
    (entry) => entry.platform === platform && entry.architecture === architecture
  ).map((entry) => ({ ...entry, expectedFiles: [...entry.expectedFiles] }))
}

export function dependencyManifestEntry(
  id: string,
  platform: NodeDependencyPlatform,
  architecture: NodeDependencyArchitecture
): NodeDependencyManifestEntry | null {
  return (
    dependencyManifestFor(platform, architecture).find((entry) => entry.id === id) ?? null
  )
}
