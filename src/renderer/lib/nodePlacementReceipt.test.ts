import { describe, expect, it } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import { applySynchronousPlacement } from './nodePlacementReceipt'

describe('applySynchronousPlacement', () => {
  it('returns the updater verdict only after the supplied flush commits the placement', () => {
    let nodes = ['occupied']
    let queued: ((current: string[]) => string[]) | undefined
    const setNodes: Dispatch<SetStateAction<string[]>> = (action) => {
      queued = typeof action === 'function' ? action : () => action
    }
    const flush = (work: () => void): void => {
      work()
      if (queued) nodes = queued(nodes)
    }

    const result = applySynchronousPlacement(
      setNodes,
      (current) => ({ nodes: current, result: { ok: false, reason: 'late collision' } }),
      flush
    )

    expect(result).toEqual({ ok: false, reason: 'late collision' })
    expect(nodes).toEqual(['occupied'])
  })

  it('returns undefined rather than inventing success when no updater was acknowledged', () => {
    const setNodes: Dispatch<SetStateAction<string[]>> = () => {}
    const result = applySynchronousPlacement(
      setNodes,
      (nodes) => ({ nodes: [...nodes, 'terminal'], result: { ok: true, nodeId: 'terminal' } }),
      (work) => work()
    )
    expect(result).toBeUndefined()
  })
})
