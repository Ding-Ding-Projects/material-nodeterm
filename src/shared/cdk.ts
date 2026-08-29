/**
 * AWS Cloud Development Kit manager contract. This file intentionally contains only portable
 * data types and pure validation helpers. The executable boundary lives in src/core/cdk and is
 * deliberately limited to the locally discovered CDK CLI, never an arbitrary shell command.
 */

export type CdkLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'csharp' | 'unknown'
export type CdkEnvironment = 'node' | 'python' | 'java' | 'dotnet' | 'unknown'
export type CdkOperation = 'bootstrap' | 'synth' | 'diff' | 'deploy' | 'destroy'
export type CdkPhase =
  | 'unconfigured'
  | 'inspecting'
  | 'ready'
  | 'bootstrapping'
  | 'synthesizing'
  | 'diffing'
  | 'deploying'
  | 'destroying'
  | 'completed'
  | 'error'

export const CDK_TOOLKIT_VERSION = '2.176.0'
export const CDK_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
export const CDK_MAX_ASSETS = 2_000
export const CDK_MAX_ASSET_BYTES = 16 * 1024 * 1024
export const CDK_MAX_SCAN_FILES = 2_000

export interface CdkDetectedProject {
  folder: string
  appName: string
  language: CdkLanguage
  environment: CdkEnvironment
  entrypoint: string | null
  manifestFiles: string[]
  cdkVersion: string | null
  cdkInstalled: boolean
  detectedAt: number
}

export interface CdkFileReview {
  path: string
  bytes: number
  sha256: string | null
  category: 'manifest' | 'source' | 'generated' | 'unknown'
}

export interface CdkTrustReview {
  folder: string
  fingerprint: string
  files: CdkFileReview[]
  findings: string[]
  /** True only when the review found no unsafe command construction or unreadable evidence. */
  safe: boolean
  reviewedAt: number
}

export interface CdkReviewedChange {
  operation: Exclude<CdkOperation, 'bootstrap'>
  folder: string
  trustFingerprint: string
  acknowledged: boolean
  reviewedAt: number
}

export interface CdkDependencyStatus {
  toolkit: { required: string; installed: string | null; verified: boolean }
  runtime: { name: string; version: string | null; verified: boolean }
  applicationDependencies: { manifest: string | null; installed: boolean; verified: boolean }
}

export interface CdkAsset {
  path: string
  bytes: number
  sha256: string
}

export interface CdkCommandResult {
  operation: CdkOperation
  ok: boolean
  exitCode: number | null
  output: string
  truncated: boolean
  durationMs: number
  assets: CdkAsset[]
  error: string | null
}

export interface CdkStatus {
  phase: CdkPhase
  folder: string | null
  detected: CdkDetectedProject | null
  trust: CdkTrustReview | null
  dependencies: CdkDependencyStatus | null
  lastResult: CdkCommandResult | null
  updatedAt: number
}

export interface CdkEvent {
  kind: 'status' | 'output'
  status: CdkStatus
  operation?: CdkOperation
}

export interface CdkApi {
  inspect(folder: string): Promise<CdkStatus>
  status(folder?: string): Promise<CdkStatus>
  bootstrap(folder: string): Promise<CdkCommandResult>
  synth(folder: string, review: CdkReviewedChange): Promise<CdkCommandResult>
  diff(folder: string, review: CdkReviewedChange): Promise<CdkCommandResult>
  deploy(folder: string, review: CdkReviewedChange): Promise<CdkCommandResult>
  destroy(folder: string, review: CdkReviewedChange): Promise<CdkCommandResult>
  cancel(folder: string): Promise<boolean>
  onEvent(listener: (event: CdkEvent) => void): () => void
}

export function isCdkOperation(value: unknown): value is CdkOperation {
  return value === 'bootstrap' || value === 'synth' || value === 'diff' || value === 'deploy' || value === 'destroy'
}

export function isCdkReviewedChange(value: unknown): value is CdkReviewedChange {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    (row.operation === 'synth' || row.operation === 'diff' || row.operation === 'deploy' || row.operation === 'destroy') &&
    typeof row.folder === 'string' &&
    row.folder.length > 0 &&
    typeof row.trustFingerprint === 'string' &&
    /^[a-f0-9]{64}$/i.test(row.trustFingerprint) &&
    row.acknowledged === true &&
    typeof row.reviewedAt === 'number' &&
    Number.isFinite(row.reviewedAt)
  )
}
