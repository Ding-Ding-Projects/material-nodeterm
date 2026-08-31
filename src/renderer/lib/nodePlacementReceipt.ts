import { flushSync } from 'react-dom'
import type { Dispatch, SetStateAction } from 'react'

export interface PlacementBatch<TNode, TResult> {
  nodes: TNode[]
  result: TResult
}

/**
 * Apply one React state placement and return only the verdict produced by the updater that was
 * actually evaluated. Install and recovery surfaces use this boundary before exposing a node id.
 */
export function applySynchronousPlacement<TNode, TResult>(
  setNodes: Dispatch<SetStateAction<TNode[]>>,
  append: (nodes: TNode[]) => PlacementBatch<TNode, TResult>,
  flush: (work: () => void) => void = flushSync
): TResult | undefined {
  let result: TResult | undefined
  flush(() => {
    setNodes((nodes) => {
      const batch = append(nodes)
      result = batch.result
      return batch.nodes
    })
  })
  return result
}
