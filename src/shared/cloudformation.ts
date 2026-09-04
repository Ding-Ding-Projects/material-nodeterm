export const CLOUDFORMATION_CAPABILITIES = [
  'CAPABILITY_IAM',
  'CAPABILITY_NAMED_IAM',
  'CAPABILITY_AUTO_EXPAND'
] as const

export type CloudFormationCapability = (typeof CLOUDFORMATION_CAPABILITIES)[number]
export type CloudFormationChangeSetType = 'CREATE' | 'UPDATE'

export interface CloudFormationPortableBlueprint {
  schemaVersion: 1
  stackName: string
  changeSetType: CloudFormationChangeSetType
  parameterKeys: string[]
  capabilities: CloudFormationCapability[]
}

export interface CloudFormationStatus {
  available: boolean
  version: string | null
  origin: 'bundled' | 'path' | null
  profiles: string[]
  regions: string[]
  unavailableReason: string | null
}

export interface CloudFormationStackSummary {
  stackId: string
  stackName: string
  status: string
  statusReason?: string
  updatedAt?: string
}

export interface CloudFormationTemplateParameter {
  key: string
  description?: string
  defaultValue?: string
  noEcho: boolean
}

export interface CloudFormationTemplateInspection {
  description?: string
  parameters: CloudFormationTemplateParameter[]
  capabilities: CloudFormationCapability[]
  capabilityReason?: string
}

export interface CloudFormationParameterValue {
  key: string
  value?: string
  usePreviousValue?: boolean
}

export interface CloudFormationChange {
  action: 'Add' | 'Modify' | 'Remove' | 'Import' | 'Dynamic' | 'Unknown'
  logicalResourceId: string
  resourceType: string
  replacement: 'True' | 'False' | 'Conditional' | 'Unknown'
  scope: string[]
  details: string[]
}

export interface CloudFormationChangeSetPreview {
  changeSetId: string
  changeSetName: string
  stackId: string
  stackName: string
  status: string
  executionStatus: string
  statusReason?: string
  createdAt?: string
  changes: CloudFormationChange[]
}

export interface CloudFormationScopeInput {
  profile: string
  region: string
}

export interface CloudFormationTemplateInput extends CloudFormationScopeInput {
  templatePath: string
}

export interface CloudFormationPreviewInput extends CloudFormationTemplateInput {
  requestId: string
  stackName: string
  changeSetName: string
  changeSetType: CloudFormationChangeSetType
  parameters: CloudFormationParameterValue[]
  capabilities: CloudFormationCapability[]
}

export interface CloudFormationApi {
  status(): Promise<CloudFormationStatus>
  listStacks(input: CloudFormationScopeInput): Promise<CloudFormationStackSummary[]>
  inspectTemplate(input: CloudFormationTemplateInput): Promise<CloudFormationTemplateInspection>
  previewChangeSet(input: CloudFormationPreviewInput): Promise<CloudFormationChangeSetPreview>
  cancelPreview(requestId: string): Promise<boolean>
}

export const CLOUDFORMATION_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'ca-west-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-north-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'us-gov-east-1',
  'us-gov-west-1',
  'cn-north-1',
  'cn-northwest-1'
] as const

const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$/
const SAFE_REGION = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/
const SAFE_STACK = /^[A-Za-z][A-Za-z0-9-]{0,127}$/
const SAFE_PARAMETER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

function visible(value: unknown, label: string, max: number): string {
  const text = String(value ?? '').trim()
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is invalid.`)
  return text
}

export function validateCloudFormationScope(input: CloudFormationScopeInput): CloudFormationScopeInput {
  const profile = visible(input.profile, 'AWS profile', 128)
  const region = visible(input.region, 'AWS region', 32)
  if (!SAFE_PROFILE.test(profile)) throw new Error('Choose a valid AWS profile from the detected profile list.')
  if (!SAFE_REGION.test(region)) throw new Error('Choose a valid AWS region from the region list.')
  return { profile, region }
}

export function validateCloudFormationPreviewInput(input: CloudFormationPreviewInput): CloudFormationPreviewInput {
  const scope = validateCloudFormationScope(input)
  const requestId = visible(input.requestId, 'Preview request id', 160)
  const templatePath = visible(input.templatePath, 'Template path', 4096)
  const stackName = visible(input.stackName, 'Stack name', 128)
  const changeSetName = visible(input.changeSetName, 'Change-set name', 128)
  if (!SAFE_STACK.test(stackName)) throw new Error('Stack names start with a letter and contain only letters, numbers, and hyphens.')
  if (!SAFE_STACK.test(changeSetName)) throw new Error('Change-set names start with a letter and contain only letters, numbers, and hyphens.')
  if (input.changeSetType !== 'CREATE' && input.changeSetType !== 'UPDATE') throw new Error('Choose Create or Update for the change-set type.')
  if (!Array.isArray(input.parameters) || input.parameters.length > 200) throw new Error('The parameter list is too large.')
  const parameters = input.parameters.map((item) => {
    const key = visible(item.key, 'Parameter key', 255)
    if (!SAFE_PARAMETER.test(key)) throw new Error(`Parameter key ${key} is invalid.`)
    if (item.usePreviousValue) return { key, usePreviousValue: true }
    const value = String(item.value ?? '')
    if (value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Parameter ${key} has an invalid value.`)
    return { key, value }
  })
  const capabilities = [...new Set(input.capabilities)].filter((item): item is CloudFormationCapability =>
    (CLOUDFORMATION_CAPABILITIES as readonly string[]).includes(item)
  )
  return { ...scope, requestId, templatePath, stackName, changeSetName, changeSetType: input.changeSetType, parameters, capabilities }
}

export function portableCloudFormationBlueprint(input: Pick<CloudFormationPreviewInput, 'stackName' | 'changeSetType' | 'parameters' | 'capabilities'>): CloudFormationPortableBlueprint {
  const stackName = visible(input.stackName, 'Stack name', 128)
  if (!SAFE_STACK.test(stackName)) throw new Error('Stack name is invalid.')
  return {
    schemaVersion: 1,
    stackName,
    changeSetType: input.changeSetType,
    parameterKeys: [...new Set(input.parameters.map((item) => visible(item.key, 'Parameter key', 255)))].sort(),
    capabilities: [...new Set(input.capabilities)].filter((item): item is CloudFormationCapability =>
      (CLOUDFORMATION_CAPABILITIES as readonly string[]).includes(item)
    )
  }
}


/* ------------------------------------------------------------------------------------------- *
 * Legacy CloudFormation manager contracts (core/cloudformation/service.ts).
 *
 * Restored verbatim from its origin commit (7a36b264d, "feat(integrations): add CloudFormation
 * manager"), overwritten by a later commit's unrelated portable-blueprint schema above. Three
 * colliding interfaces renamed with a Legacy prefix (CloudFormationStackSummary,
 * CloudFormationChange, CloudFormationApi -- all different shapes from the interfaces of the
 * same name above). The duplicate CloudFormationCapability type alias was dropped: both versions
 * are structurally identical ('CAPABILITY_IAM' | 'CAPABILITY_NAMED_IAM' | 'CAPABILITY_AUTO_EXPAND'),
 * so this block reuses the declaration above instead of redeclaring it. Nothing outside
 * src/core/cloudformation/service.ts currently imports this block.
 * ------------------------------------------------------------------------------------------- */

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

export interface CloudFormationLegacyStackSummary {
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

export interface CloudFormationLegacyChange {
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
  changes: CloudFormationLegacyChange[]
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
  stack: CloudFormationLegacyStackSummary | null
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

export interface CloudFormationLegacyApi {
  status(): Promise<CloudFormationCliStatus>
  profiles(): Promise<CloudFormationProfile[]>
  regions(): Promise<string[]>
  stacks(input: { profile: string; region: string; includeDeleted?: boolean }): Promise<CloudFormationLegacyStackSummary[]>
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

export function changeSetHasDestructiveChanges(changes: CloudFormationLegacyChange[]): boolean {
  return changes.some((change) => change.action === 'Remove' || change.replacement === 'True')
}
