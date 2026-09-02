import { describe, expect, it, vi } from 'vitest'
import { mapBuiltinAgentLabel } from './agentLabel'

describe('mapBuiltinAgentLabel', () => {
  it('maps only AGENT_CONFIG labels', () => {
    const map = vi.fn((value: string) => `mapped:${value}`)
    expect(mapBuiltinAgentLabel(map, 'claude')).toBe('mapped:Claude Code')
    expect(map).toHaveBeenCalledWith('Claude Code')
  })

  it('keeps custom labels and identifiers exact', () => {
    const map = vi.fn((value: string) => `mapped:${value}`)
    expect(mapBuiltinAgentLabel(map, 'custom:one', 'My private helper')).toBe('My private helper')
    expect(mapBuiltinAgentLabel(map, 'custom:one')).toBe('custom:one')
    expect(map).not.toHaveBeenCalled()
  })

  it('keeps an empty display fallback honest for an unknown id', () => {
    const map = vi.fn((value: string) => `mapped:${value}`)
    expect(mapBuiltinAgentLabel(map, undefined, 'Agent')).toBe('Agent')
    expect(mapBuiltinAgentLabel(map, undefined)).toBe('')
  })
})
