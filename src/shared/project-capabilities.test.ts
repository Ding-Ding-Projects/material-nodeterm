import { describe, it, expect } from 'vitest'
import {
  PROJECT_CAPABILITIES,
  PROJECT_CAPABILITY_COPY,
  projectCapabilityFlagInFile,
  readProjectCapabilities,
  projectCapabilityFields
} from './project-capabilities'

describe('projectCapabilityFlagInFile is STRICT — never a grant check', () => {
  it('true enables the flag', () => {
    expect(projectCapabilityFlagInFile({ agentBrowserControl: true }, 'agentBrowserControl')).toBe(
      true
    )
  })

  it.each([undefined, false, null, 0, 1, 'true', 'yes', {}, [], 'false'])(
    'everything else is OFF (%j) — project.json is hostile input, not a truthiness exercise',
    (v) => {
      expect(
        projectCapabilityFlagInFile({ agentBrowserControl: v } as never, 'agentBrowserControl')
      ).toBe(false)
    }
  )

  it('an absent project is off, never a throw', () => {
    expect(projectCapabilityFlagInFile(undefined, 'agentBrowserControl')).toBe(false)
    expect(projectCapabilityFlagInFile(null, 'agentBrowserControl')).toBe(false)
  })

  it('a prototype-inherited true does not count — own properties only', () => {
    const proto = { agentBrowserControl: true }
    const p = Object.create(proto)
    expect(projectCapabilityFlagInFile(p, 'agentBrowserControl')).toBe(false)
  })
})

describe('readProjectCapabilities normalises whatever the file carried', () => {
  it('keeps only literal true, and only known keys', () => {
    expect(readProjectCapabilities({ agentBrowserControl: 'true', nope: true })).toEqual({})
    expect(readProjectCapabilities({ agentBrowserControl: true })).toEqual({
      agentBrowserControl: true
    })
    expect(readProjectCapabilities({ agentBrowserControl: true, nope: true })).toEqual({
      agentBrowserControl: true
    })
  })

  it('survives a non-object file', () => {
    expect(readProjectCapabilities(null)).toEqual({})
    expect(readProjectCapabilities('x')).toEqual({})
    expect(readProjectCapabilities(undefined)).toEqual({})
  })

  it('ignores a prototype-inherited true — own properties only', () => {
    const proto = { agentBrowserControl: true }
    const f = Object.create(proto)
    expect(readProjectCapabilities(f)).toEqual({})
  })
})

describe('projectCapabilityFields — the spread projectToFile uses', () => {
  it('omits an off capability entirely (no bytes, no git churn) and survives null', () => {
    expect(projectCapabilityFields({ agentBrowserControl: false })).toEqual({})
    expect(projectCapabilityFields(null)).toEqual({})
    expect(projectCapabilityFields({ agentBrowserControl: true })).toEqual({
      agentBrowserControl: true
    })
  })
})

describe('every capability has copy, and the copy says what travels', () => {
  it.each(PROJECT_CAPABILITIES)('%s has label, description and cloneWarning', (cap) => {
    const c = PROJECT_CAPABILITY_COPY[cap]
    expect(c.label.length).toBeGreaterThan(0)
    expect(c.description.length).toBeGreaterThan(0)
    // Same wording class as the tab menu's bypassPermissions title: the two git-shared grants
    // read alike.
    expect(c.cloneWarning).toContain('.nodeterm/project.json')
  })
})
