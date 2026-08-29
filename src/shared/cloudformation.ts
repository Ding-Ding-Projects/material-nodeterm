/**
 * CloudFormation manager contract.  The renderer only receives structured values from this
 * interface; it never builds an AWS CLI command or accepts a free-form command string.  The core
 * implementation owns the allowlisted AWS CLI invocation and treats every response as untrusted
 * JSON before returning it here.
 */

export type CloudFormationStackStatus =
  | 'CREATE_IN_PROGRESS'
  | 'CREATE_FAILED'
  | 'CREATE_COMPLETE'
  | 'UPDATE_IN_PROGRESS'
  | 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'
  | 'UPDATE_COMPLETE'
  | 'UPDATE_FAILED'
  | 'UPDATE_ROLLBACK_IN_PROGRESS'
  | 'UPDATE_ROLLBACK_FAILED'
  | 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'
  | 'UPDATE_ROLLBACK_COMPLETE'
  | 'DELETE_IN_PROGRESS'
  | 'DELETE_FAILED'
  | 'DELETE_COMPLETE'
  | 'REVIEW_IN_PROGRESS'
  | 'IMPORT_IN_PROGRESS'
  | 'IMPORT_COMPLETE'
  | 'IMPORT_ROLLBACK_IN_PROGRESS'
  | 'IMPORT_ROLLBACK_FAILED'
  | 'IMPORT_ROLLBACK_COMPLETE'
  | string

export interface CloudFormationCliStatus {
  available: boolean
  executable: string | null
  version: string | null
  reason: string | null
  checkedAt: number
}

export interface CloudFormationProfile {
  name: string
  source: 'config' | 'credentials' | 'sso' | 'unknown'
  accountId: string | null
  arn: string | null
  region: string | null
}

export interface CloudFormationStackSummary {
  stackName: string
  stackId: string
  status: CloudFormationStackStatus
  statusReason: string | null
  creationTime: string | null
  lastUpdatedTime: string | null
  description: string | null
  terminationProtection: boolean | null
}

export interface CloudFormationParameter {
  parameterKey: string
  parameterValue: string
  usePreviousValue?: boolean
  resolvedValue?: string | null
}

export interface CloudFormationTag {
  key: string
  value: string
}

export type CloudFormationCapability =
  | 'CAPABILITY_IAM'
  | 'CAPABILITY_NAMED_IAM'
  | 'CAPABILITY_AUTO_EXPAND'

export interface CloudFormationTemplateInfo {
  valid: boolean
  format: 'json' | 'yaml' | 'unknown'
  description: string | null
  parameters: Array<{
    key: string
    type: string
    description: string | null
    defaultValue: string | null
    required: boolean
  }>
  capabilities: CloudFormationCapability[]
  warnings: string[]
  error: string | null
}

export type ChangeAction = 'Add' | 'Modify' | 'Remove' | 'Import' | 'Dynamic'

export interface CloudFormationChange {
  action: ChangeAction
  logicalResourceId: string
  physicalResourceId: string | null
  resourceType: string
  replacement: 'True' | 'False' | 'Conditional' | null
  details: string[]
}

export interface CloudFormationChangeSet {
  id: string
  arn: string | null
  name: string
  stackName: string
  status: string
  statusReason: string | null
  executionStatus: string
  changes: CloudFormationChange[]
  iamWarnings: string[]
  destructive: boolean
  fetchedAt: number
}

export interface CloudFormationStackEvent {
  eventId: string
  stackName: string
  logicalResourceId: string | null
  physicalResourceId: string | null
  resourceType: string | null
  status: string
  statusReason: string | null
  timestamp: string
}

export interface CloudFormationWaitResult {
  waiter: 'stack-create-complete' | 'stack-update-complete' | 'stack-delete-complete'
  status: 'success' | 'failed' | 'timed-out'
  stack: CloudFormationStackSummary | null
  events: CloudFormationStackEvent[]
  error: string | null
}

export interface CloudFormationValidateInput {
  profile: string
  region: string
  templateBody: string
}

export interface CloudFormationChangeSetInput extends CloudFormationValidateInput {
  stackName: string
  changeSetName: string
  changeSetType: 'CREATE' | 'UPDATE'
  parameters: CloudFormationParameter[]
  capabilities: CloudFormationCapability[]
  tags: CloudFormationTag[]
  description?: string
}

export interface CloudFormationApi {
  status(): Promise<CloudFormationCliStatus>
  profiles(): Promise<CloudFormationProfile[]>
  regions(): Promise<string[]>
  stacks(input: { profile: string; region: string; includeDeleted?: boolean }): Promise<CloudFormationStackSummary[]>
  validate(input: CloudFormationValidateInput): Promise<CloudFormationTemplateInfo>
  createChangeSet(input: CloudFormationChangeSetInput): Promise<CloudFormationChangeSet>
  describeChangeSet(input: { profile: string; region: string; stackName: string; changeSetName: string }): Promise<CloudFormationChangeSet>
  executeChangeSet(input: { profile: string; region: string; stackName: string; changeSetName: string }): Promise<void>
  events(input: { profile: string; region: string; stackName: string; nextToken?: string }): Promise<{ events: CloudFormationStackEvent[]; nextToken: string | null }>
  wait(input: { profile: string; region: string; stackName: string; waiter: CloudFormationWaitResult['waiter']; timeoutMs?: number }): Promise<CloudFormationWaitResult>
}

const NAME_RE = /^[a-zA-Z][-a-zA-Z0-9]{0,127}$/
const REGION_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/

export function isValidCloudFormationStackName(value: string): boolean {
  return NAME_RE.test(value.trim())
}

export function isValidCloudFormationRegion(value: string): boolean {
  return REGION_RE.test(value.trim())
}

export function normalizeCloudFormationParameters(value: CloudFormationParameter[]): CloudFormationParameter[] {
  return value
    .filter((p) => typeof p.parameterKey === 'string' && p.parameterKey.trim().length > 0)
    .map((p) => ({
      parameterKey: p.parameterKey.trim(),
      parameterValue: String(p.parameterValue ?? ''),
      ...(p.usePreviousValue ? { usePreviousValue: true } : {}),
      ...(p.resolvedValue === undefined ? {} : { resolvedValue: p.resolvedValue })
    }))
}

export function normalizeCloudFormationTags(value: CloudFormationTag[]): CloudFormationTag[] {
  return value
    .filter((t) => typeof t.key === 'string' && t.key.trim().length > 0)
    .map((t) => ({ key: t.key.trim(), value: String(t.value ?? '') }))
}

export function changeSetHasDestructiveChanges(changes: CloudFormationChange[]): boolean {
  return changes.some((change) => change.action === 'Remove' || change.replacement === 'True')
}
