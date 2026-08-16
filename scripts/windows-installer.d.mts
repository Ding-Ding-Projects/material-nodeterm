export interface WindowsReleaseIdentity {
  packageId: string
  version: string
  productName: string
}

export interface WindowsSourceIdentity {
  sourceSha: string
  repository: string
}

export interface WindowsIconFrame {
  width: number
  height: number
  bitCount: number
  sha256: string
}

export function assertPackagedIconContract(
  directory: string,
  metadataFile: string,
  root?: string,
  options?: { sourceIdentity?: WindowsSourceIdentity },
): Promise<{ iconUrl: string }>

export function cleanWindowsPackageOutputs(root?: string): Promise<void>
export function downloadMatchingIcon(
  iconUrl: string,
  expected: Buffer,
  fetchImpl?: (url: string, options: RequestInit) => Promise<Response>,
): Promise<Buffer>
export function immutableIconUrl(repository: string, sourceSha: string): string
export function inspectIco(iconBytes: Buffer): WindowsIconFrame[]
export function inspectPeIconInventory(
  executableBytes: Buffer,
  expectedIconBytes: Buffer,
  description?: string,
): { group: number; languages: Array<number | string>; frames: number }
export function inspectPeProductIdentity(
  executableBytes: Buffer,
  expected: WindowsReleaseIdentity,
  description?: string,
): { productName: string; version: string; languages: number }
export function parseGitHubRepository(value: string): string
export function requireCleanSourceStatus(status: string): void
export function validateImmutableIconUrl(value: string, repository: string, sourceSha: string): string
