import { describe, expect, it } from 'vitest'
import { graphEdgeEndpoints } from '../lib/repositoryGraphVisual'

describe('repository graph edge geometry', () => {
  it('trims a horizontal edge to the source and target rectangle borders', () => {
    const { source, target } = graphEdgeEndpoints({ x: 100, y: 100 }, { x: 300, y: 100 })
    expect(source).toEqual({ x: 172, y: 100 })
    expect(target).toEqual({ x: 228, y: 100 })
  })

  it('trims a diagonal edge at whichever rectangle side it reaches first', () => {
    const { source, target } = graphEdgeEndpoints({ x: 100, y: 100 }, { x: 200, y: 200 })
    expect(source.x).toBeCloseTo(120)
    expect(source.y).toBeCloseTo(120)
    expect(target.x).toBeCloseTo(180)
    expect(target.y).toBeCloseTo(180)
  })
})
