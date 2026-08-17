import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions } from './squirrel-updater'

interface PackageMetadata {
  version: string
}

interface PackageLockMetadata extends PackageMetadata {
  packages: Record<string, PackageMetadata>
}

const root = path.resolve(__dirname, '../..')
const packageMetadata = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
) as PackageMetadata
const packageLock = JSON.parse(
  readFileSync(path.join(root, 'package-lock.json'), 'utf8')
) as PackageLockMetadata

describe('packaged application version contract', () => {
  // Deliberately an ORDERING assertion, not an equality one. This began as
  // `expect(version).toBe('0.4.0')`, which can pass for exactly one release and then fails
  // forever — so the second person to see it red just bumps the literal, and the check has
  // taught nobody anything. What the release policy actually requires is that the packaged
  // version has ADVANCED past the last stable published before the Squirrel updater landed,
  // because an installed 0.3.0 cannot discover a package that does not outrank it.
  it('keeps the packaged app version ahead of the 0.3.0 Squirrel migration baseline', () => {
    expect(compareVersions(packageMetadata.version, '0.3.0')).toBe(1)
    // …and it is a real stable version, not a prerelease that would ship as one.
    expect(packageMetadata.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('keeps npm lock metadata aligned with the packaged app version', () => {
    expect(packageLock.version).toBe(packageMetadata.version)
    expect(packageLock.packages['']?.version).toBe(packageMetadata.version)
  })
})
