import { describe, expect, it } from 'vitest'
import { browserPartitionFor, browserPartitionForNode } from './browser-profiles'

describe('browserPartitionForNode — a group frame is its own cookie jar', () => {
  it('an explicit profile beats the frame the node happens to sit in', () => {
    expect(browserPartitionForNode('proj', 'work', 'group-1')).toBe(
      browserPartitionFor('proj', 'work')
    )
  })

  it('two browser nodes in ONE frame share a partition; a different frame is isolated', () => {
    const a = browserPartitionForNode('proj', undefined, 'group-1')
    const b = browserPartitionForNode('proj', undefined, 'group-1')
    const other = browserPartitionForNode('proj', undefined, 'group-2')
    expect(a).toBe(b)
    expect(a).not.toBe(other)
  })

  it('no profile and no frame is the default, unpartitioned session — the pre-feature behaviour', () => {
    expect(browserPartitionForNode('proj', undefined, undefined)).toBeUndefined()
  })

  it('the same frame id in two projects never collides', () => {
    expect(browserPartitionForNode('proj-a', undefined, 'g')).not.toBe(
      browserPartitionForNode('proj-b', undefined, 'g')
    )
  })

  it('a group jar can never collide with a profile jar of the same id', () => {
    // Different namespaces: without the distinct prefix, a group called "work" and a profile
    // called "work" would silently be one logged-in identity.
    expect(browserPartitionForNode('proj', undefined, 'work')).not.toBe(
      browserPartitionFor('proj', 'work')
    )
  })

  it('a hand-edited id cannot smuggle path separators into the partition string', () => {
    const p = browserPartitionForNode('proj', undefined, '../../etc/passwd')
    expect(p).toBeDefined()
    expect(p).not.toContain('/')
    expect(p).not.toContain('..')
  })
})
