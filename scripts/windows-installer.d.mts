export interface WindowsReleaseIdentity {
  packageId: 'node-terminal'
  productName: 'nodeterm'
  executableName: 'nodeterm.exe'
  executionStubName: 'nodeterm_ExecutionStub.exe'
  appUserModelId: 'com.squirrel.node-terminal.nodeterm'
  version?: string
}

export interface PeResourceIdentity extends WindowsReleaseIdentity {
  version: string
  originalFilename: string
  internalName: string
}

export interface WindowsSourceIdentity {
  sourceSha: string
  repository: string
}

export interface IconFrameInventory {
  width: number
  height: number
  bitCount: number
  sha256: string
}

export interface WindowsIconFrame extends IconFrameInventory {}

export interface WindowsIconMetadata extends WindowsSourceIdentity {
  schemaVersion: 1
  iconUrl: string
  sha256: string
  frames: number[]
}

export const WINDOWS_RELEASE_IDENTITY: Readonly<WindowsReleaseIdentity>
export const SQUIRREL_SETUP_VENDOR_ICON_POLICY: ReadonlyArray<Readonly<{
  id: 107 | 108
  lang: 1033
  frames: ReadonlyArray<Readonly<IconFrameInventory & { resourceId: number }>>
}>>

export function inspectIco(iconBytes: Uint8Array): WindowsIconFrame[]
export function inspectPeIconInventory(
  executableBytes: Uint8Array,
  expectedIconBytes: Uint8Array,
  description?: string,
  options?: { kind?: 'application' | 'setup' },
): {
  kind: 'application' | 'setup'
  primaryGroup: 1
  primaryLanguage: 1033
  frames: number
  auxiliaryGroups: number[]
}
export function inspectPeProductIdentity(
  executableBytes: Uint8Array,
  expected: PeResourceIdentity,
  description?: string,
): Record<string, string | number>
export function inspectUnsignedPe(executableBytes: Uint8Array, description?: string): { authenticode: 'NotSigned' }
export function parseGitHubRepository(value: unknown): string
export function immutableIconUrl(repository: string, sourceSha: string): string
export function validateImmutableIconUrl(value: string, repository: string, sourceSha: string): string
/** The changed paths in `git status --porcelain=v1` output, or null when the tree is clean. */
export function changedSourcePaths(status: string): string[] | null
/** True when two package manifests are byte-identical apart from their `version`. */
export function isVersionOnlyManifestChange(committedText: string, workingText: string): boolean
/**
 * `readPair` is required to tolerate a dirty package.json/package-lock.json: without it, ANY dirty
 * path refuses. It supplies the committed and working text so the difference can be proven to be
 * the release version bump and nothing else.
 */
export function requireCleanSourceStatus(
  status: string,
  readPair?: (relativePath: string) => { committed: string; working: string },
): void
export function resolveSourceIdentity(root?: string, env?: NodeJS.ProcessEnv): WindowsSourceIdentity
export function downloadMatchingIcon(
  iconUrl: string,
  expected: Uint8Array,
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>,
): Promise<Buffer>
export function verifySourceIcon(
  root?: string,
  options?: { fetchImpl?: (input: string, init: RequestInit) => Promise<Response>; env?: NodeJS.ProcessEnv },
): Promise<WindowsIconMetadata>
export function validateIconMetadata(value: unknown): WindowsIconMetadata
export function readReleaseIdentity(packageJsonFile: string): Promise<WindowsReleaseIdentity & { version: string }>
export function cleanWindowsPackageOutputs(root?: string): Promise<string[]>
export function assertPackagedIconContract(
  directory: string,
  metadataFile: string,
  root?: string,
  options?: { sourceIdentity?: WindowsSourceIdentity },
): Promise<{
  setup: string
  full: string
  releases: string
  packages: string[]
  iconUrl: string
  identity: WindowsReleaseIdentity & { version: string }
}>
