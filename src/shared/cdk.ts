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

export interface CdkTrustReview {
  reviewToken: string
  projectPath: string
  cdkConfigPath: string
  appCommand: string
  contextKeys: string[]
  files: CdkProjectFileSummary[]
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
  return { ...project, reviewToken, requestId, stackNames }
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
