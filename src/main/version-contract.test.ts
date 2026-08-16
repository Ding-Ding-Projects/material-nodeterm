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
  it('advances the stable app version from 0.3.0 to exactly 0.4.0', () => {
    expect(packageMetadata.version).toBe('0.4.0')
    expect(compareVersions(packageMetadata.version, '0.3.0')).toBe(1)
  })

  it('keeps npm lock metadata aligned with the packaged app version', () => {
    expect(packageLock.version).toBe(packageMetadata.version)
    expect(packageLock.packages['']?.version).toBe(packageMetadata.version)
  })
})
