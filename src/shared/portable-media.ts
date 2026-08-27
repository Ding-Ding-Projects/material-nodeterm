/** Typed contract between the renderer picker and the privileged portable-media host. */

export type PortableMediaKind = 'image' | 'audio' | 'video'
export type PortableMediaDecision = 'include' | 'omit' | 'locate-later'

export interface PortableMediaCandidate {
  assetId: string
  kind: PortableMediaKind
  label: string
  sourceName: string
  decision: PortableMediaDecision
  projectOwned: boolean
  includeEnabled: boolean
  includeDisabledReason?: string
  reason?: string
}

export interface PortableMediaDecisionRecord {
  assetId: string
  decision: PortableMediaDecision
}

export interface PortableMediaExportPlan {
  preparationId: string
  decisions: PortableMediaDecisionRecord[]
}

export interface PortableMediaPrepareInput {
  projectId: string
  projectRoot?: string
  sourcePaths: string[]
}

export type PortableMediaPreparationResult =
  | { ok: true; preparationId: string; candidates: PortableMediaCandidate[] }
  | { ok: false; error: string }

export interface PortableMediaApi {
  /** Inspect selected local paths in the privileged host. Returned candidates contain no path. */
  prepare(input: PortableMediaPrepareInput): Promise<PortableMediaPreparationResult>
  /** Release an unused preparation after the decision surface is cancelled. */
  discard(preparationId: string): Promise<boolean>
}
