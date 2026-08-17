import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface RootPackageMetadata {
  name: string
  version: string
  engines: { node: string }
  dependencies: Record<string, string>
  overrides?: Record<string, Record<string, string>>
}

interface LockedPackageMetadata {
  name?: string
  version?: string
  integrity?: string
  dependencies?: Record<string, string>
  engines?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

interface PackageLockMetadata {
  name: string
  version: string
  lockfileVersion: number
  packages: Record<string, LockedPackageMetadata>
}

const root = path.resolve(__dirname, '../..')
const packageMetadata = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
) as RootPackageMetadata
const packageLock = JSON.parse(
  readFileSync(path.join(root, 'package-lock.json'), 'utf8')
) as PackageLockMetadata

function releaseTuple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`Expected an exact release version, got ${version}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isAtLeast(version: string, floor: string): boolean {
  const actual = releaseTuple(version)
  const minimum = releaseTuple(floor)
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index]
  }
  return true
}

describe('production dependency contract', () => {
  it('locks the requested Monaco and WebSocket releases without changing application identity', () => {
    expect(packageMetadata).toMatchObject({
      name: 'node-terminal',
      version: '0.4.0',
      engines: { node: '^22.22.2 || ^24.15.0 || >=26.0.0' },
      dependencies: {
        'monaco-editor': '^0.56.0',
        ws: '^8.21.3'
      }
    })
    expect(packageLock).toMatchObject({
      name: packageMetadata.name,
      version: packageMetadata.version,
      lockfileVersion: 3
    })
    expect(packageLock.packages['']).toMatchObject({
      name: packageMetadata.name,
      version: packageMetadata.version,
      engines: packageMetadata.engines,
      dependencies: packageMetadata.dependencies
    })
    expect(packageLock.packages['node_modules/monaco-editor']).toMatchObject({
      version: '0.56.0',
      integrity:
        'sha512-sXboRm3BeBeLm938eaiyLMe0OxzfXIlZvbv4ir/jVgQy1zDhWjgmny0WoN45fuDKhCCQsYMbBJrv/A6jd8aCUg==',
      dependencies: {
        dompurify: '3.4.8',
        marked: '14.0.0'
      }
    })
    expect(packageLock.packages['node_modules/monaco-editor/node_modules/marked']).toMatchObject({
      version: '14.0.0',
      engines: { node: '>= 18' }
    })
    expect(packageLock.packages['node_modules/ws']).toMatchObject({
      version: '8.21.3',
      integrity:
        'sha512-201TZ/kPWxoPr/OKWjquZR1SWKXcvxdH+e1xrx89b3YbmzLMFCLfnaG1HFIgWzJOEWZ7MvpK++odZufgYR50Rw==',
      engines: { node: '>=10.0.0' },
      peerDependencies: {
        bufferutil: '^4.0.1',
        'utf-8-validate': '>=5.0.2'
      },
      peerDependenciesMeta: {
        bufferutil: { optional: true },
        'utf-8-validate': { optional: true }
      }
    })
  })

  it('replaces Monaco\'s vulnerable DOMPurify pin with the direct safe release', () => {
    expect(packageMetadata.overrides).toEqual({
      'monaco-editor': { dompurify: '$dompurify' }
    })

    const dompurifyPackages = Object.entries(packageLock.packages)
      .filter(([packagePath]) => /(^|\/)node_modules\/dompurify$/.test(packagePath))
      .map(([packagePath, metadata]) => ({ packagePath, version: metadata.version }))

    expect(dompurifyPackages).toEqual([
      { packagePath: 'node_modules/dompurify', version: '3.4.13' }
    ])
    for (const dependency of dompurifyPackages) {
      expect(dependency.version).toBeDefined()
      expect(isAtLeast(dependency.version!, '3.4.13')).toBe(true)
    }
    expect(packageLock.packages['node_modules/monaco-editor/node_modules/dompurify']).toBeUndefined()
  })
})
