import type { CanvasNodeState } from '../shared/types'
import {
  AWS_UNIVERSE_SCOPE,
  canCreateInUniverse,
  repairUniverseShops,
  type UniverseCanvasInput,
  type UniverseShopRepairResult
} from '../shared/aws-shop'
import { canCreateAwsCatalogEntry } from '../shared/aws-catalog'

export interface AwsUniverseImportResult extends UniverseShopRepairResult {
  /** Import remains a pure in-memory operation. Callers may display these records in a notification. */
  sideEffects: readonly []
}

/**
 * Import boundary for AWS child canvases. It repairs missing, duplicate, moved, or malformed Shop
 * nodes before any caller stages project data. No provider, filesystem, process, or credential
 * operation is reachable from this function.
 */
export function repairAwsUniverseImport(
  canvases: readonly UniverseCanvasInput[],
  nodes: readonly CanvasNodeState[]
): AwsUniverseImportResult {
  const repaired = repairUniverseShops(canvases, nodes)
  return { ...repaired, sideEffects: [] }
}

/** Core creation boundary shared by archive import and future AWS operation coordinators. */
export function canCreateAwsUniverseNode(kind: string, universeId: string): { ok: true } | { ok: false; reason: string } {
  if (!universeId) return { ok: false, reason: 'AWS Universe identity is required before creating a node.' }
  return canCreateInUniverse(AWS_UNIVERSE_SCOPE, kind)
}

/** Validate the complete typed creation request, including catalog membership and availability. */
export function canCreateAwsBlueprint(entryId: string, universeId: string): { ok: true } | { ok: false; reason: string } {
  if (!universeId) return { ok: false, reason: 'AWS Universe identity is required before creating a blueprint.' }
  return canCreateAwsCatalogEntry(entryId)
}
