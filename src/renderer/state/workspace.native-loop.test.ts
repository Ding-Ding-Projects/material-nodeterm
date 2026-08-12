import { describe, expect, it } from 'vitest'
import { createNativeLoopNode, flowToNodeStates, nodeStatesToFlow } from './workspace'

describe('native Loop node', () => {
  it('creates a paused persisted scheduler', () => {
    const node = createNativeLoopNode(0, { x: 500, y: 400 })
    expect(node.type).toBe('scheduler')
    expect(node.data.title).toBe('Loop')
    expect(node.data.loopEnabled).toBe(false)
    expect(node.data.loopTargetIds).toEqual([])
  })

  it('round-trips task, cadence, run state and exact targets', () => {
    const node = createNativeLoopNode(0)
    node.data = {
      ...node.data,
      loopTask: 'Inspect the queue and report only actionable failures.',
      loopIntervalMs: 3_600_000,
      loopEnabled: true,
      loopNextRunAt: 1_800_000_000_000,
      loopLastRunAt: 1_799_996_400_000,
      loopTargetIds: ['term-agent-a', 'term-agent-b']
    }

    const [saved] = flowToNodeStates([node])
    expect(saved.kind).toBe('scheduler')
    expect(saved.loopTargetIds).toEqual(['term-agent-a', 'term-agent-b'])

    const [loaded] = nodeStatesToFlow([saved])
    expect(loaded.type).toBe('scheduler')
    expect(loaded.data).toMatchObject({
      loopTask: 'Inspect the queue and report only actionable failures.',
      loopIntervalMs: 3_600_000,
      loopEnabled: true,
      loopNextRunAt: 1_800_000_000_000,
      loopLastRunAt: 1_799_996_400_000,
      loopTargetIds: ['term-agent-a', 'term-agent-b']
    })
  })
})
