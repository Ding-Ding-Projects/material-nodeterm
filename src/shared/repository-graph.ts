/** Project-scoped repository graph contract. Derived graph data is machine-local and never part of
 * portable project.json. Only the user's graph intent is safe to persist in a canvas node. */

export type RepositoryGraphMode = 'code' | 'dependencies' | 'combined'
export type RepositoryGraphStatus = 'idle' | 'running' | 'ready' | 'stale' | 'partial' | 'failed' | 'unsupported' | 'cancelled'
export type RepositoryGraphNodeKind = 'file' | 'module' | 'symbol' | 'package' | 'workspace' | 'unknown'
export type RepositoryGraphEdgeKind = 'imports' | 'exports' | 'calls' | 'references' | 'inherits' | 'depends-on' | 'workspace-member' | 'unresolved'
export type RepositoryGraphConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface RepositoryGraphSourceLocation {
  path: string
  line?: number
  column?: number
}

export interface RepositoryGraphNode {
  id: string
  kind: RepositoryGraphNodeKind
  label: string
  detail?: string
  source?: RepositoryGraphSourceLocation
  packageManager?: string
  unresolved?: boolean
}

export interface RepositoryGraphEdge {
  id: string
  from: string
  to: string
  kind: RepositoryGraphEdgeKind
  confidence: RepositoryGraphConfidence
  source?: RepositoryGraphSourceLocation
  adapterId: string
  adapterVersion: string
  sourceRevision: string
  note?: string
  unresolved?: boolean
}

export interface RepositoryGraphAdapterInfo {
  id: string
  version: string
  kind: 'typescript' | 'javascript' | 'manifest' | 'lockfile'
  patterns: string[]
  available: boolean
  reason?: string
}

export interface RepositoryGraphFingerprint {
  revision: string
  files: number
  bytes: number
  contentHash: string
  generatedAt: number
}

export interface RepositoryGraphLimits {
  maxFiles: number
  maxBytes: number
  maxNodes: number
  maxEdges: number
  maxFileBytes: number
  maxDurationMs: number
}

export interface RepositoryGraphSnapshot {
  version: 1
  projectId: string
  mode: RepositoryGraphMode
  status: RepositoryGraphStatus
  rootLabel: string
  fingerprint: RepositoryGraphFingerprint
  nodes: RepositoryGraphNode[]
  edges: RepositoryGraphEdge[]
  adapters: RepositoryGraphAdapterInfo[]
  omissions: string[]
  createdAt: number
  previousFingerprint?: RepositoryGraphFingerprint
  /** Content hashes keyed by root-relative path, used to reuse unchanged file graph slices. */
  fileFingerprints?: Record<string, string>
}

export interface RepositoryGraphProgress {
  projectId: string
  operationId: string
  phase: 'discovering' | 'parsing' | 'dependencies' | 'finalizing' | 'exporting'
  completed: number
  total: number
  status: RepositoryGraphStatus
  message: string
}

export interface RepositoryGraphRefreshInput {
  projectId: string
  mode?: RepositoryGraphMode
}

export interface RepositoryGraphExportInput {
  projectId: string
  format: 'json' | 'jsonl' | 'csv' | 'tsv' | 'markdown' | 'html' | 'graphml' | 'dot'
  mode?: RepositoryGraphMode
}

export interface RepositoryGraphExportResult {
  format: RepositoryGraphExportInput['format']
  filename: string
  content: string
  sourceRevision: string
  stale: boolean
  omissions: string[]
}

export interface RepositoryGraphApi {
  inspect(projectId: string, mode?: RepositoryGraphMode): Promise<RepositoryGraphSnapshot>
  refresh(input: RepositoryGraphRefreshInput): Promise<RepositoryGraphSnapshot>
  cancel(operationId: string): Promise<boolean>
  export(input: RepositoryGraphExportInput): Promise<RepositoryGraphExportResult>
  onProgress(listener: (progress: RepositoryGraphProgress) => void): () => void
}

export interface RepositoryGraphIntent {
  version: 1
  mode: RepositoryGraphMode
  query?: string
  expandedNodeIds?: string[]
}

export const REPOSITORY_GRAPH_LIMITS: RepositoryGraphLimits = {
  maxFiles: 20_000,
  maxBytes: 128 * 1024 * 1024,
  maxNodes: 100_000,
  maxEdges: 250_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxDurationMs: 120_000
}

export const REPOSITORY_GRAPH_ADAPTERS: readonly RepositoryGraphAdapterInfo[] = [
  { id: 'typescript-semantic', version: '1', kind: 'typescript', patterns: ['*.ts', '*.tsx'], available: true },
  { id: 'javascript-semantic', version: '1', kind: 'javascript', patterns: ['*.js', '*.jsx', '*.mjs', '*.cjs'], available: true },
  { id: 'npm-manifest', version: '1', kind: 'manifest', patterns: ['package.json'], available: true },
  { id: 'npm-lockfile', version: '1', kind: 'lockfile', patterns: ['package-lock.json', 'npm-shrinkwrap.json'], available: true },
  { id: 'yarn-lockfile', version: '1', kind: 'lockfile', patterns: ['yarn.lock'], available: false, reason: 'Yarn lockfile parser is not bundled in this release.' },
  { id: 'pnpm-lockfile', version: '1', kind: 'lockfile', patterns: ['pnpm-lock.yaml'], available: false, reason: 'pnpm lockfile parser is not bundled in this release.' },
  { id: 'bun-lockfile', version: '1', kind: 'lockfile', patterns: ['bun.lock', 'bun.lockb'], available: false, reason: 'Bun lockfile parser is not bundled in this release.' },
  { id: 'python-manifest', version: '1', kind: 'manifest', patterns: ['pyproject.toml', 'requirements*.txt', 'Pipfile', 'poetry.lock', 'uv.lock'], available: false, reason: 'Python manifest parser is not bundled in this release.' },
  { id: 'cargo-manifest', version: '1', kind: 'manifest', patterns: ['Cargo.toml', 'Cargo.lock'], available: false, reason: 'Cargo manifest parser is not bundled in this release.' },
  { id: 'go-manifest', version: '1', kind: 'manifest', patterns: ['go.mod', 'go.work', 'go.sum'], available: false, reason: 'Go module parser is not bundled in this release.' },
  { id: 'maven-gradle-manifest', version: '1', kind: 'manifest', patterns: ['pom.xml', 'build.gradle', 'build.gradle.kts'], available: false, reason: 'Maven and Gradle parser is not bundled in this release.' },
  { id: 'dotnet-manifest', version: '1', kind: 'manifest', patterns: ['*.sln', '*.csproj', 'packages.lock.json', 'Directory.Packages.props'], available: false, reason: '.NET project parser is not bundled in this release.' },
  { id: 'ruby-manifest', version: '1', kind: 'manifest', patterns: ['Gemfile', 'Gemfile.lock'], available: false, reason: 'Ruby manifest parser is not bundled in this release.' },
  { id: 'composer-manifest', version: '1', kind: 'manifest', patterns: ['composer.json', 'composer.lock'], available: false, reason: 'Composer manifest parser is not bundled in this release.' },
  { id: 'dart-manifest', version: '1', kind: 'manifest', patterns: ['pubspec.yaml', 'pubspec.lock'], available: false, reason: 'Dart manifest parser is not bundled in this release.' },
  { id: 'swift-manifest', version: '1', kind: 'manifest', patterns: ['Package.swift', 'Package.resolved'], available: false, reason: 'Swift package parser is not bundled in this release.' },
  { id: 'cmake-manifest', version: '1', kind: 'manifest', patterns: ['CMakeLists.txt', 'vcpkg.json', 'conanfile.*'], available: false, reason: 'CMake, vcpkg, and Conan parser is not bundled in this release.' },
  { id: 'container-manifest', version: '1', kind: 'manifest', patterns: ['Dockerfile', 'docker-compose.yml', 'compose.yml'], available: false, reason: 'Container and Compose parser is not bundled in this release.' },
  { id: 'gitmodules-manifest', version: '1', kind: 'manifest', patterns: ['.gitmodules'], available: false, reason: '.gitmodules parser is not bundled in this release.' }
]

export function normalizeRepositoryGraphIntent(value: unknown): RepositoryGraphIntent {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const mode = raw.mode === 'dependencies' || raw.mode === 'combined' ? raw.mode : 'code'
  const expandedNodeIds = Array.isArray(raw.expandedNodeIds)
    ? raw.expandedNodeIds.filter((item): item is string => typeof item === 'string' && item.length <= 240).slice(0, 2000)
    : []
  return { version: 1, mode, query: typeof raw.query === 'string' ? raw.query.slice(0, 512) : '', expandedNodeIds }
}
