// Pure active-canvas edge receive seam. Canvas owns React Flow objects and refs; this function owns
// the ordering-sensitive sequence after CanvasOrder accepts a peer edge: update both edge kinds,
// adopt the complete result before React's publish effect runs, then mark the workspace dirty.

import { applyEdgeMutation, isEdgeMutation } from '@shared/canvas-mutations'
import type { BridgeLink, CanvasEdgeKind, CanvasMutation } from '@shared/types'

export interface ActiveEdgeLists<T> {
  bridges: T[]
  ropes: T[]
}

interface ActiveEdgeReceiveHooks<T> {
  toLink: (edge: T) => BridgeLink
  rebuild: (kind: CanvasEdgeKind, link: BridgeLink, previous: T[]) => T
  setBridges: (edges: T[]) => void
  setRopes: (edges: T[]) => void
  adopt: (edges: ActiveEdgeLists<T>) => void
  markDirty: () => void
}

/**
 * Apply an accepted peer edge mutation to the live foreground canvas.
 *
 * Both lists are always evaluated because one edge id occupies one ordering key across bridge and
 * rope kinds: a winning kind change must evict the losing copy. Setters run only for a list whose
 * value changed, while adopt and markDirty run for every accepted edge mutation just as Canvas's
 * original inline path did. Returns null for a node mutation so a caller cannot accidentally treat
 * it as a handled edge.
 */
export function receiveActiveEdgeMutation<T>(
  current: ActiveEdgeLists<T>,
  mutation: CanvasMutation,
  hooks: ActiveEdgeReceiveHooks<T>
): ActiveEdgeLists<T> | null {
  if (!isEdgeMutation(mutation)) return null

  const bridgeInput = current.bridges.map(hooks.toLink)
  const ropeInput = current.ropes.map(hooks.toLink)
  const nextBridgeLinks = applyEdgeMutation(bridgeInput, 'bridge', mutation)
  const nextRopeLinks = applyEdgeMutation(ropeInput, 'rope', mutation)

  const bridges =
    nextBridgeLinks === bridgeInput
      ? current.bridges
      : nextBridgeLinks.map((link) => hooks.rebuild('bridge', link, current.bridges))
  const ropes =
    nextRopeLinks === ropeInput
      ? current.ropes
      : nextRopeLinks.map((link) => hooks.rebuild('rope', link, current.ropes))

  if (bridges !== current.bridges) hooks.setBridges(bridges)
  if (ropes !== current.ropes) hooks.setRopes(ropes)

  const next = { bridges, ropes }
  // Load-bearing order: adoption must precede the dirty-triggered render/persist cycle, otherwise
  // React's publish effect sees the peer change as local and counter-casts it.
  hooks.adopt(next)
  hooks.markDirty()
  return next
}
