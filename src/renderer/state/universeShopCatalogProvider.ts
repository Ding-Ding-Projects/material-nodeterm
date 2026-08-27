import {
  NODE_CATALOG,
  getNodeCatalogEntry,
  nodeCatalogAvailability,
  type NodeCatalogAvailabilityContext,
  type NodeCatalogEntry
} from '@shared/node-catalog'
import {
  registerUniverseShopCatalog,
  type ShopCatalogEntry,
  type SpecialUniverseScope,
  type UniverseShopCatalogProvider
} from '../../core/universe-shop'

/**
 * The Shop is a deliberately smaller surface than the root catalog. Keeping these ids explicit
 * prevents a newly added general or provider row from silently appearing inside the wrong
 * universe. A new catalog lane must opt its row into the appropriate Shop in the same change.
 */
export const MULTIVERSE_SHOP_CATALOG_ENTRY_IDS = [
  'terminal',
  'sticky',
  'editor',
  'browser',
  'authenticator',
  'multiverse-portal'
] as const

export const AWS_SHOP_CATALOG_ENTRY_IDS = [
  'aws-identity',
  'aws-resource-explorer',
  'aws-cloud-control',
  'aws-s3',
  'aws-ec2',
  'aws-iam',
  'aws-sts',
  'aws-lambda',
  'aws-cloudwatch',
  'aws-logs',
  'aws-cloudformation',
  'aws-cdk',
  'aws-ecr',
  'aws-ecs',
  'aws-eks',
  'aws-rds',
  'aws-databases',
  'aws-vpc',
  'aws-route53',
  'aws-cost',
  'aws-service'
] as const

const MULTIVERSE_IDS = new Set<string>(MULTIVERSE_SHOP_CATALOG_ENTRY_IDS)
const AWS_IDS = new Set<string>(AWS_SHOP_CATALOG_ENTRY_IDS)

export interface UniverseShopCatalogRuntime {
  /** Session and project facts only. Shop ownership facts come from the clicked Shop. */
  context: Omit<
    NodeCatalogAvailabilityContext,
    'universeScope' | 'universeId' | 'universeDepth' | 'hasShopNode' | 'parentCanvasId'
  >
  create: (
    entry: NodeCatalogEntry,
    context: { canvasId: string; scope: SpecialUniverseScope; depth: number; creationEventId: string }
  ) => void
}

let runtime: UniverseShopCatalogRuntime | null = null

export function setUniverseShopCatalogRuntime(next: UniverseShopCatalogRuntime | null): void {
  runtime = next
}

function scopesForEntry(entry: NodeCatalogEntry): readonly SpecialUniverseScope[] {
  const scopes: SpecialUniverseScope[] = []
  if (MULTIVERSE_IDS.has(entry.id)) scopes.push('multiverse')
  if (AWS_IDS.has(entry.id)) scopes.push('aws-universe')
  return scopes
}

function keyFor(entry: NodeCatalogEntry, kind: 'label' | 'description'): string {
  return `nodeCatalog.entry.${entry.id.replaceAll(':', '.')}.${kind}`
}

function availabilityFor(entry: NodeCatalogEntry, scope: SpecialUniverseScope): {
  available: boolean
  reason?: string
} {
  if (!runtime) {
    return {
      available: false,
      reason: 'The unified Node Catalog creation coordinator is unavailable in this build.'
    }
  }
  return nodeCatalogAvailability(entry, {
    ...runtime.context,
    universeScope: scope,
    universeDepth: 1,
    hasShopNode: true
  })
}

function toShopEntry(entry: NodeCatalogEntry): ShopCatalogEntry | null {
  const scopes = scopesForEntry(entry)
  if (!scopes.length) return null
  const states = scopes.map((scope) => availabilityFor(entry, scope))
  const unavailable = states.find((state) => !state.available)
  return {
    id: entry.id,
    labelKey: keyFor(entry, 'label'),
    descriptionKey: keyFor(entry, 'description'),
    keywords: [...entry.keywords],
    scopes,
    ...(entry.maxUniverseDepth !== undefined
      ? { maxDepthExclusive: entry.maxUniverseDepth }
      : {}),
    docsPath: entry.documentationPath,
    nodeKind: entry.nodeKind ?? 'planned',
    available: !unavailable,
    ...(unavailable?.reason ? { disabledReason: unavailable.reason } : {})
  }
}

export const UNIVERSE_SHOP_CATALOG_PROVIDER: UniverseShopCatalogProvider = {
  list(): readonly ShopCatalogEntry[] {
    return NODE_CATALOG.map(toShopEntry).filter((entry): entry is ShopCatalogEntry => entry !== null)
  },
  create(entry, context): void {
    if (!runtime) throw new Error('The unified Node Catalog creation coordinator is unavailable in this build.')
    const source = getNodeCatalogEntry(entry.id)
    if (!source || !scopesForEntry(source).includes(context.scope)) {
      throw new Error('This catalog entry does not belong to the selected universe Shop.')
    }
    const availability = nodeCatalogAvailability(source, {
      ...runtime.context,
      universeScope: context.scope,
      universeId: context.canvasId,
      universeDepth: context.depth,
      hasShopNode: true
    })
    if (!availability.available) {
      throw new Error(availability.reason ?? 'This catalog entry is unavailable in the selected universe Shop.')
    }
    runtime.create(source, context)
  }
}

// The provider object is stable for the life of the renderer. Canvas only swaps its live runtime
// callback, so Shop nodes never retain a stale project or placement closure.
registerUniverseShopCatalog(UNIVERSE_SHOP_CATALOG_PROVIDER)
