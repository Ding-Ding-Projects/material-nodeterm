import { describe, expect, it } from 'vitest'
import { topAppBarModeForWidth } from './TopAppBar'

describe('responsive top app bar thresholds', () => {
  it.each([
    [1280, 'wide'],
    [1279, 'compact'],
    [720, 'compact'],
    [719, 'narrow'],
    [320, 'narrow']
  ])('maps %i CSS pixels to %s mode', (width, expected) => {
    expect(topAppBarModeForWidth(width)).toBe(expected)
  })
})
