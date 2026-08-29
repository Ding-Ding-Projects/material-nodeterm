import { AWS_SERVICE_NODE_KIND, AWS_UNIVERSE_SCOPE, type UniverseCanvasScope } from './aws-shop'

export type AwsCatalogCategory =
  | 'Identity'
  | 'Compute'
  | 'Storage'
  | 'Networking'
  | 'Observability'
  | 'Infrastructure'
  | 'Developer tools'

export type AwsAvailability =
  | { state: 'available'; reason: string }
  | { state: 'unavailable'; reason: string; nextAction: string }

export interface AwsCatalogEntry {
  id: string
  category: AwsCatalogCategory
  label: string
  description: string
  keywords: readonly string[]
  nodeKind: typeof AWS_SERVICE_NODE_KIND
  documentationPath: string
  safeDefaults: Readonly<Record<string, string | number | boolean>>
  availability: AwsAvailability
}

export interface AwsCatalogSearchOptions {
  query?: string
  mode?: 'text' | 'regex'
  flags?: string
  category?: AwsCatalogCategory | 'all'
  includeUnavailable?: boolean
  scope?: UniverseCanvasScope
}

export interface AwsCatalogSearchResult {
  entries: AwsCatalogEntry[]
  error: string | null
  matchedCount: number
}

export function awsCatalogEntry(id: string): AwsCatalogEntry | undefined {
  return AWS_CATALOG.find((entry) => entry.id === id)
}

export function canCreateAwsCatalogEntry(entryId: string, scope: UniverseCanvasScope = AWS_UNIVERSE_SCOPE): { ok: true; entry: AwsCatalogEntry } | { ok: false; reason: string } {
  if (scope !== AWS_UNIVERSE_SCOPE) return { ok: false, reason: 'AWS catalog entries can only be created inside an AWS Universe.' }
  const entry = awsCatalogEntry(entryId)
  if (!entry) return { ok: false, reason: 'This AWS catalog entry is not in the verified local catalog.' }
  if (entry.availability.state === 'unavailable') return { ok: false, reason: entry.availability.nextAction }
  return { ok: true, entry }
}

/**
 * The baseline catalog is intentionally typed and exhaustive for the operations this lane owns.
 * The next AWS CLI model lane can append generated service entries without changing the Shop
 * scope predicate. Every entry declares why it is available, or the exact missing dependency and
 * the action that makes it available.
 */
export const AWS_CATALOG: readonly AwsCatalogEntry[] = [
  {
    id: 'aws.sts.get-caller-identity', category: 'Identity', label: 'STS: Get caller identity',
    description: 'Inspect the active AWS identity without changing resources.', keywords: ['sts', 'identity', 'account', 'caller'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.iam.list-roles', category: 'Identity', label: 'IAM: List roles',
    description: 'Browse IAM roles with an explicit region and profile selection.', keywords: ['iam', 'roles', 'identity'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.ec2.describe-instances', category: 'Compute', label: 'EC2: Describe instances',
    description: 'Inspect EC2 instances without issuing a lifecycle mutation.', keywords: ['ec2', 'compute', 'instances', 'virtual machine'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.lambda.list-functions', category: 'Compute', label: 'Lambda: List functions',
    description: 'Browse deployed Lambda functions through a typed catalog entry.', keywords: ['lambda', 'functions', 'compute'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.s3.list-buckets', category: 'Storage', label: 'S3: List buckets',
    description: 'Inspect bucket names without downloading or changing objects.', keywords: ['s3', 'storage', 'buckets'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.cloudwatch.list-metrics', category: 'Observability', label: 'CloudWatch: List metrics',
    description: 'Find metric namespaces and names for a typed monitoring view.', keywords: ['cloudwatch', 'metrics', 'monitoring'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.logs.describe-log-groups', category: 'Observability', label: 'CloudWatch Logs: Describe log groups',
    description: 'Browse log groups before opening a bounded log view.', keywords: ['logs', 'cloudwatch', 'log groups'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.vpc.describe-vpcs', category: 'Networking', label: 'VPC: Describe VPCs',
    description: 'Inspect virtual networks and their metadata.', keywords: ['vpc', 'networking', 'subnets'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.cloudformation.list-stacks', category: 'Infrastructure', label: 'CloudFormation: List stacks',
    description: 'Browse stacks before opening a typed change-set workflow.', keywords: ['cloudformation', 'stacks', 'infrastructure'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'available', reason: 'AWS catalog entry is available for a typed read-only operation.' }
  },
  {
    id: 'aws.resource-explorer.search', category: 'Developer tools', label: 'Resource Explorer: Search resources',
    description: 'Search indexed resources with bounded typed filters.', keywords: ['resource explorer', 'search', 'inventory'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'unavailable', reason: 'AWS CLI v2 model data has not been verified on this machine.', nextAction: 'Configure the bundled AWS CLI v2 dependency, then refresh the catalog.' }
  },
  {
    id: 'aws.cloud-control.list-resources', category: 'Infrastructure', label: 'Cloud Control: List resources',
    description: 'Browse supported resource types without a raw request editor.', keywords: ['cloud control', 'resources', 'typed'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'unavailable', reason: 'The installed AWS CLI model does not expose this operation yet.', nextAction: 'Refresh the verified AWS CLI model inventory.' }
  },
  {
    id: 'aws.cdk.synth', category: 'Developer tools', label: 'CDK: Synth',
    description: 'Inspect a CDK application through a selected folder and typed profile.', keywords: ['cdk', 'synth', 'developer'],
    nodeKind: AWS_SERVICE_NODE_KIND, documentationPath: 'docs/features/aws/aws-shop.md', safeDefaults: { output: 'json' },
    availability: { state: 'unavailable', reason: 'The local CDK executable has not been registered as a verified dependency.', nextAction: 'Register a detected CDK executable through the guided executable picker.' }
  }
] as const

const MAX_QUERY_LENGTH = 500
const SAFE_FLAGS = /^[dgimsuvy]*$/

/** Filter the catalog locally. Plain text is the default and invalid regex is reported openly. */
export function searchAwsCatalog(options: AwsCatalogSearchOptions = {}): AwsCatalogSearchResult {
  if (options.scope !== undefined && options.scope !== AWS_UNIVERSE_SCOPE) return { entries: [], error: 'AWS catalog entries are available only inside an AWS Universe.', matchedCount: 0 }
  const query = options.query ?? ''
  if (query.length > MAX_QUERY_LENGTH) return { entries: [], error: `Search is limited to ${MAX_QUERY_LENGTH} characters.`, matchedCount: 0 }
  const category = options.category ?? 'all'
  const includeUnavailable = options.includeUnavailable ?? true
  if (!SAFE_FLAGS.test(options.flags ?? 'i')) return { entries: [], error: 'Regex flags are not supported by the catalog search.', matchedCount: 0 }
  let matches: (entry: AwsCatalogEntry) => boolean
  if ((options.mode ?? 'text') === 'regex' && query.length > 0) {
    let regex: RegExp
    try { regex = new RegExp(query, options.flags ?? 'i') } catch (error) { return { entries: [], error: error instanceof Error ? error.message : String(error), matchedCount: 0 } }
    matches = (entry) => {
      // A global or sticky flag carries lastIndex between calls. Recreate the matcher for each
      // row so a catalog result never disappears merely because the previous row matched.
      const rowRegex = new RegExp(regex.source, regex.flags)
      return rowRegex.test(`${entry.label} ${entry.description} ${entry.keywords.join(' ')}`)
    }
  } else {
    const needle = query.trim().toLocaleLowerCase()
    matches = (entry) => needle.length === 0 || `${entry.label} ${entry.description} ${entry.keywords.join(' ')}`.toLocaleLowerCase().includes(needle)
  }
  const entries = AWS_CATALOG.filter((entry) =>
    (category === 'all' || entry.category === category) &&
    (includeUnavailable || entry.availability.state === 'available') && matches(entry)
  )
  return { entries, error: null, matchedCount: entries.length }
}
