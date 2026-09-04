import { describe, expect, it, vi } from 'vitest'
import { mapBuiltInAgentDisplay, mapBuiltinAgentLabel } from './agentLabel'

describe('mapBuiltInAgentDisplay', () => {
  it('maps only AGENT_CONFIG labels', () => {
    const map = vi.fn((value: string) => `mapped:${value}`)
    expect(mapBuiltInAgentDisplay(map, 'claude')).toBe('mapped:Claude Code')
    expect(map).toHaveBeenCalledWith('Claude Code')
  })

  it('keeps custom labels and identifiers exact', () => {
    const map = vi.fn((value: string) => `mapped:${value}`)
    expect(mapBuiltInAgentDisplay(map, 'custom:one', 'My private helper')).toBe('My private helper')
    expect(mapBuiltInAgentDisplay(map, 'custom:one')).toBe('custom:one')
    expect(map).not.toHaveBeenCalled()
  })

  it('keeps an empty display fallback honest for an unknown id', () => {
    const map = vi.fn((value: string) => `mapped:${value}`)
    expect(mapBuiltInAgentDisplay(map, undefined, 'Agent')).toBe('Agent')
    expect(mapBuiltInAgentDisplay(map, undefined)).toBe('')
  })

  it('keeps the established alias pointed at the same implementation', () => {
    expect(mapBuiltinAgentLabel).toBe(mapBuiltInAgentDisplay)
  })
})
