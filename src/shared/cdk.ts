/** Shared CDK manager contract.  Project files carry only this safe intent; local paths, review
 * tokens, command output, credentials and generated templates stay on the current machine. */

export const CDK_SCHEMA_VERSION = 1 as const
export const CDK_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
export const CDK_MAX_PROJECT_FILE_BYTES = 256 * 1024

export interface CdkPortableBlueprint {
  schemaVersion: typeof CDK_SCHEMA_VERSION
  appIntent: string
  stackNames: string[]
  contextKeys: string[]
  omitLocalBinding: true
}

export interface CdkStatus {
  available: boolean
  version: string | null
  executable: string | null
  reason: string | null
}

export interface CdkProjectFileSummary {
  name: string
  kind: 'cdk-config' | 'package-manifest' | 'dependency-manifest' | 'context' | 'other'
  bytes: number
}

export interface CdkProjectScript {
  name: string
  command: string
}

export interface CdkTrustReview {
  reviewToken: string
  projectPath: string
  cdkConfigPath: string
  appCommand: string
  contextKeys: string[]
  files: CdkProjectFileSummary[]
  scripts: CdkProjectScript[]
  dependencyNames: string[]
  warnings: string[]
  reviewed: boolean
}

export interface CdkProjectInput {
  projectPath: string
}

export interface CdkTrustInput extends CdkProjectInput {
  reviewToken: string
}

export interface CdkOperationInput extends CdkTrustInput {
  requestId: string
  stackNames: string[]
  /** Machine-local AWS binding selected through the shared AWS resource manager. */
  awsProfile?: string
  awsRegion?: string
}

export interface CdkSynthesisResult {
  requestId: string
  projectPath: string
  stackNames: string[]
  templateNames: string[]
  stdout: string
  stderr: string
  durationMs: number
}

export interface CdkDiffChange {
  stackName: string
  action: 'add' | 'modify' | 'remove' | 'replace' | 'unknown'
  logicalId: string
  resourceType: string
}

export interface CdkDiffResult {
  requestId: string
  projectPath: string
  stackNames: string[]
  text: string
  changes: CdkDiffChange[]
  requiresConfirmation: boolean
  reviewToken: string
  durationMs: number
}

export interface CdkDeployResult {
  requestId: string
  projectPath: string
  stackNames: string[]
  stdout: string
  stderr: string
  outputs: Record<string, Record<string, string>>
  durationMs: number
}

export interface CdkApi {
  status(): Promise<CdkStatus>
  inspectProject(input: CdkProjectInput): Promise<CdkTrustReview>
  approveTrust(input: CdkTrustInput): Promise<CdkTrustReview>
  synth(input: CdkOperationInput): Promise<CdkSynthesisResult>
  diff(input: CdkOperationInput): Promise<CdkDiffResult>
  deploy(input: CdkOperationInput & { diffReviewToken: string }): Promise<CdkDeployResult>
  cancel(requestId: string): Promise<boolean>
}

const SAFE_STACK = /^[A-Za-z][A-Za-z0-9-]{0,127}$/
const SAFE_REQUEST = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/
const SAFE_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/

function text(value: unknown, label: string, max: number): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} is invalid.`)
  }
  return result
}

export function validateCdkProjectInput(input: CdkProjectInput): CdkProjectInput {
  return { projectPath: text(input.projectPath, 'CDK project folder', 4096) }
}

export function validateCdkOperationInput(input: CdkOperationInput): CdkOperationInput {
  const project = validateCdkProjectInput(input)
  const reviewToken = text(input.reviewToken, 'Trust review token', 160)
  const requestId = text(input.requestId, 'CDK request id', 160)
  if (!SAFE_REQUEST.test(requestId)) throw new Error('The CDK request id is invalid.')
  if (!Array.isArray(input.stackNames) || input.stackNames.length > 200) {
    throw new Error('The selected CDK stack list is too large.')
  }
  const stackNames = [...new Set(input.stackNames.map((name) => text(name, 'CDK stack name', 128)))]
  if (stackNames.some((name) => !SAFE_STACK.test(name))) {
    throw new Error('Choose stacks from the synthesized stack list.')
  }
  const awsProfile = input.awsProfile === undefined ? undefined : text(input.awsProfile, 'AWS profile', 128)
  const awsRegion = input.awsRegion === undefined ? undefined : text(input.awsRegion, 'AWS region', 64)
  if (awsProfile !== undefined && !SAFE_PROFILE.test(awsProfile)) throw new Error('Choose the AWS profile from the shared local binding.')
  if (awsRegion !== undefined && !SAFE_REGION.test(awsRegion)) throw new Error('Choose the AWS region from the shared local binding.')
  return { ...project, reviewToken, requestId, stackNames, ...(awsProfile ? { awsProfile } : {}), ...(awsRegion ? { awsRegion } : {}) }
}

export function makeCdkPortableBlueprint(input: {
  appIntent: string
  stackNames: string[]
  contextKeys: string[]
}): CdkPortableBlueprint {
  const appIntent = text(input.appIntent, 'CDK app intent', 512)
  const stackNames = [...new Set(input.stackNames.map((name) => text(name, 'CDK stack name', 128)))]
  if (stackNames.some((name) => !SAFE_STACK.test(name))) throw new Error('The CDK stack name is invalid.')
  const contextKeys = [...new Set(input.contextKeys.map((key) => text(key, 'CDK context key', 256)))]
  return { schemaVersion: CDK_SCHEMA_VERSION, appIntent, stackNames, contextKeys, omitLocalBinding: true }
}

export function normalizeCdkPortableBlueprint(value: unknown): CdkPortableBlueprint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== CDK_SCHEMA_VERSION || raw.omitLocalBinding !== true) return undefined
  if (!Array.isArray(raw.stackNames) || !Array.isArray(raw.contextKeys)) return undefined
  if (typeof raw.appIntent !== 'string' || raw.stackNames.some((item) => typeof item !== 'string') || raw.contextKeys.some((item) => typeof item !== 'string')) return undefined
  try {
    return makeCdkPortableBlueprint({
      appIntent: raw.appIntent,
      stackNames: raw.stackNames,
      contextKeys: raw.contextKeys
    })
  } catch {
    return undefined
  }
}


/* ------------------------------------------------------------------------------------------- *
 * Legacy CDK manager contracts (core/cdk/manager.ts, register-ipc.ts).
 *
 * Restored verbatim from its origin commit (44570a92a, "feat(cdk): add review-first CDK
 * manager"), overwritten by a later commit's unrelated CDK portable-blueprint schema above. Four
 * colliding names renamed with a Legacy prefix: CDK_MAX_OUTPUT_BYTES (different value),
 * CdkTrustReview, CdkStatus, and CdkApi (all different shapes from the interfaces of the same
 * name above). Nothing outside src/core/cdk/manager.ts and register-ipc.ts currently imports
 * this block.
 * ------------------------------------------------------------------------------------------- */

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
export const CDK_LEGACY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
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

export interface CdkLegacyTrustReview {
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

export interface CdkLegacyStatus {
  phase: CdkPhase
  folder: string | null
  detected: CdkDetectedProject | null
  trust: CdkLegacyTrustReview | null
  dependencies: CdkDependencyStatus | null
  lastResult: CdkCommandResult | null
  updatedAt: number
}

export interface CdkEvent {
  kind: 'status' | 'output'
  status: CdkLegacyStatus
  operation?: CdkOperation
}

export interface CdkLegacyApi {
  inspect(folder: string): Promise<CdkLegacyStatus>
  status(folder?: string): Promise<CdkLegacyStatus>
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
