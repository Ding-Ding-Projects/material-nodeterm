/**
 * The release workflow's auto-bump decision.
 *
 * Exercised against the pure `planReleaseVersion` rather than the workflow, because a GitHub
 * Actions job cannot be run locally — the YAML around this is verified only by review, and this
 * suite is the part that can actually be proven. Every case below is a state this repository has
 * really been in, not an invented one.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs build script, no type declarations by design
import { planReleaseVersion, highestStableVersion } from '../../scripts/release-assets.mjs'

const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

const tag = (name: string, sha: string) => ({ name, commit: { sha } })
const release = (tagName: string, sha: string) => ({ tag_name: tagName, target_commitish: sha })

describe('planReleaseVersion', () => {
  it('bumps past a tag that exists at a DIFFERENT commit — the state that blocked this repo', () => {
    // Four tags (v0.4.0–v0.4.3), no releases for them, and package.json still saying 0.4.3 while
    // main had moved 30 commits on. Reusing v0.4.3 is refused by the verifier, so the only way
    // forward is a bump — the exact wall a maintainer hit before this existed.
    const tags = [tag('v0.4.0', OTHER), tag('v0.4.1', OTHER), tag('v0.4.2', OTHER), tag('v0.4.3', OTHER)]
    const plan = planReleaseVersion('0.4.3', tags, [release('v0.3.2', OTHER)], HEAD)
    expect(plan).toMatchObject({ action: 'bump', version: '0.4.4', highest: '0.4.3' })
  })

  it('treats a tag with no release as spoken for', () => {
    // The tag alone burns the number: `gh release create` on an existing tag pointing elsewhere
    // fails. A planner that only looked at RELEASES would happily propose 0.4.1 here and die.
    const plan = planReleaseVersion('0.4.0', [tag('v0.4.1', OTHER)], [], HEAD)
    expect(plan).toMatchObject({ action: 'bump', version: '0.4.2' })
  })

  it('keeps a hand-written version that already leads — a deliberate minor is not overwritten', () => {
    const plan = planReleaseVersion('0.5.0', [tag('v0.4.3', OTHER)], [], HEAD)
    expect(plan).toMatchObject({ action: 'keep', version: '0.5.0' })
  })

  it('keeps the version when the repository has no stable tag or release at all', () => {
    expect(planReleaseVersion('0.1.0', [], [], HEAD)).toMatchObject({ action: 'keep', version: '0.1.0' })
  })

  it('is a retry — not a bump — when the highest tag already points at THIS commit', () => {
    // Re-running a publish that failed after tagging. Bumping here would strand the half-staged
    // draft under a number nobody can find.
    const plan = planReleaseVersion('0.4.3', [tag('v0.4.3', HEAD)], [release('v0.4.3', HEAD)], HEAD)
    expect(plan).toMatchObject({ action: 'retry', version: '0.4.3' })
  })

  it('refuses to call it a retry when only SOME references point at this commit', () => {
    // A tag moved, or a release was recreated against a different target: the two disagree, so the
    // state is not a clean retry and reusing the number would publish from an ambiguous base.
    const plan = planReleaseVersion('0.4.3', [tag('v0.4.3', OTHER)], [release('v0.4.3', HEAD)], HEAD)
    expect(plan).toMatchObject({ action: 'bump', version: '0.4.4' })
  })

  it('carries a two-digit patch instead of comparing versions as strings', () => {
    // '0.4.9' > '0.4.10' lexically. A string compare would bump backwards to 0.4.10 forever.
    const tags = [tag('v0.4.9', OTHER), tag('v0.4.10', OTHER)]
    expect(planReleaseVersion('0.4.9', tags, [], HEAD)).toMatchObject({ version: '0.4.11' })
  })

  it('ignores prereleases and non-version tags rather than bumping off them', () => {
    const tags = [tag('v0.4.3', OTHER), tag('v0.5.0-fixture.1', OTHER), tag('nightly', OTHER)]
    expect(planReleaseVersion('0.4.3', tags, [], HEAD)).toMatchObject({ version: '0.4.4' })
  })

  it('rejects a non-SemVer package version instead of guessing one', () => {
    expect(() => planReleaseVersion('0.4', [], [], HEAD)).toThrow()
    expect(() => planReleaseVersion('0.4.0-rc.1', [], [], HEAD)).toThrow()
  })

  it('rejects a short SHA — a truncated head must not silently miss the retry match', () => {
    expect(() => planReleaseVersion('0.4.3', [], [], 'abc1234')).toThrow()
  })
})

describe('highestStableVersion', () => {
  it('reports every commit the highest version is claimed by, from tags AND releases', () => {
    const result = highestStableVersion([tag('v1.0.0', HEAD)], [release('v1.0.0', OTHER)])
    expect(result.version).toBe('1.0.0')
    expect([...result.targets].sort()).toEqual([HEAD, OTHER].sort())
  })

  it('is null when nothing stable exists', () => {
    expect(highestStableVersion([], [])).toBeNull()
  })
})
