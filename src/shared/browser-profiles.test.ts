import { describe, expect, it } from 'vitest'
import { browserPartitionFor, findBrowserProfile } from './browser-profiles'
import type { BrowserProfile } from './types'

describe('browserPartitionFor', () => {
  it('returns undefined (default, unpartitioned session) when no profile is set', () => {
    expect(browserPartitionFor('proj-a', undefined)).toBeUndefined()
  })

  it('derives the SAME partition for the same project + profile (shared cookies/storage)', () => {
    const a = browserPartitionFor('proj-a', 'profile-1')
    const b = browserPartitionFor('proj-a', 'profile-1')
    expect(a).toBeDefined()
    expect(a).toBe(b)
  })

  it('derives DIFFERENT partitions for different profiles in the same project (isolated)', () => {
    const a = browserPartitionFor('proj-a', 'profile-1')
    const b = browserPartitionFor('proj-a', 'profile-2')
    expect(a).not.toBe(b)
  })

  it('derives DIFFERENT partitions for the same profile id in different projects', () => {
    // Profile ids are only unique within one project's list — two projects both minting
    // "profile-1" must not collide into one shared Electron partition.
    const a = browserPartitionFor('proj-a', 'profile-1')
    const b = browserPartitionFor('proj-b', 'profile-1')
    expect(a).not.toBe(b)
  })

  it('always carries the persist: prefix so the partition is a real persistent session', () => {
    const p = browserPartitionFor('proj-a', 'profile-1')
    expect(p).toMatch(/^persist:/)
  })

  it('still derives a stable partition for a dangling profile id (removed from the list)', () => {
    // Removing a profile's NAME from Project.browserProfiles must never silently merge that
    // node's session back into the shared default one.
    const a = browserPartitionFor('proj-a', 'profile-1')
    const b = browserPartitionFor('proj-a', 'profile-1')
    expect(a).toBeDefined()
    expect(a).toBe(b)
  })

  it('sanitizes ids so a hand-edited project.json cannot break out of the partition string', () => {
    const p = browserPartitionFor('proj/a', '../../etc')
    expect(p).toBeDefined()
    expect(p).not.toMatch(/[./]/)
  })

  it('falls back to a fixed placeholder rather than an empty component for an empty project id', () => {
    const p = browserPartitionFor('', 'profile-1')
    expect(p).toBe('persist:browser-profile-x-profile-1')
  })
})

describe('findBrowserProfile', () => {
  const profiles: BrowserProfile[] = [
    { id: 'a', name: 'Work', color: '#0a84ff' },
    { id: 'b', name: 'Personal', color: '#ff9f0a' }
  ]

  it('finds a profile by id', () => {
    expect(findBrowserProfile(profiles, 'b')?.name).toBe('Personal')
  })

  it('returns undefined for no id', () => {
    expect(findBrowserProfile(profiles, undefined)).toBeUndefined()
  })

  it('returns undefined for a dangling id', () => {
    expect(findBrowserProfile(profiles, 'nonexistent')).toBeUndefined()
  })

  it('returns undefined when the list itself is absent', () => {
    expect(findBrowserProfile(undefined, 'a')).toBeUndefined()
  })
})
