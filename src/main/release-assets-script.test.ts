import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../scripts/release-assets.mjs')
const SETUP = 'nodeterm-Setup-0.4.0.exe'
const FULL = 'node-terminal-0.4.0-full.nupkg'
const DELTA = 'node-terminal-0.4.0-delta.nupkg'
const TAG = 'v0.4.0'
const SHA = 'a'.repeat(40)
const SETUP_BYTES = Buffer.from('setup executable\n')

type ManifestAsset = { name: string; size: number; sha256: string }
type RemoteAsset = { name: string; size: number; digest?: string; sha256?: string }
type Assets = Array<RemoteAsset>
type AssetManifest = {
  version: string
  packageId: string
  productName: string
  assets: ManifestAsset[]
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build the smallest standards-compliant stored ZIP so Chuts exercise real nupkg parsing. */
function storedZip(entries: Array<{ name: string; value: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const checksum = crc32(entry.value)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.value.length, 18)
    local.writeUInt32LE(entry.value.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, entry.value)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.value.length, 20)
    central.writeUInt32LE(entry.value.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centrals.push(central, name)
    localOffset += local.length + name.length + entry.value.length
  }

  const centralBytes = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...locals, centralBytes, end])
}

function fullPackage(
  version = '0.4.0',
  packageId = 'node-terminal',
  productName = 'nodeterm',
  internalId = packageId,
): Buffer {
  return storedZip([
    {
      name: `${packageId}.nuspec`,
      value: Buffer.from(
        `<?xml version="1.0"?><package><metadata><id>${internalId}</id><version>${version}</version><title>${productName}</title></metadata></package>`,
      ),
    },
  ])
}

const FULL_BYTES = fullPackage()
const DELTA_BYTES = fullPackage()

function sha1(value: Buffer): string {
  return createHash('sha1').update(value).digest('hex')
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function remoteAssets(assets: ManifestAsset[]): Assets {
  return assets.map(({ name, size, sha256: digest }) => ({
    name,
    size,
    digest: `sha256:${digest}`,
  }))
}

function releasesLine(name: string, value: Buffer, size = value.length, hash = sha1(value)): string {
  return `${hash.toUpperCase()} ${name} ${size}`
}

function validReleases(): string {
  return `${releasesLine(FULL, FULL_BYTES)}\r\n${releasesLine(DELTA, DELTA_BYTES)}\r\n`
}

function parseOutputs(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = raw.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const heredoc = /^([^=]+)<<(.+)$/.exec(lines[index])
    if (heredoc) {
      const [, key, delimiter] = heredoc
      const values: string[] = []
      index += 1
      while (index < lines.length && lines[index] !== delimiter) {
        values.push(lines[index])
        index += 1
      }
      result[key] = values.join('\n')
      continue
    }
    const pair = /^([^=]+)=(.*)$/.exec(lines[index])
    if (pair) result[pair[1]] = pair[2]
  }
  return result
}

describe('release-assets helper CLI', () => {
  let root: string
  let output: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nodeterm-release-assets-'))
    output = `${root}-github-output.txt`
    writeFileSync(join(root, SETUP), SETUP_BYTES)
    writeFileSync(join(root, FULL), FULL_BYTES)
    writeFileSync(join(root, DELTA), DELTA_BYTES)
    writeFileSync(join(root, 'RELEASES'), validReleases())
    writeFileSync(output, '')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(output, { force: true })
    rmSync(`${root}-junction-target`, { recursive: true, force: true })
  })

  function collect(version = '0.4.0', packageId = 'node-terminal', productName = 'nodeterm') {
    return spawnSync(process.execPath, [SCRIPT, 'collect', version, packageId, productName, root], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    })
  }

  function collectSuccessfully(): {
    manifest: AssetManifest
    paths: string[]
    setup: string
  } {
    const result = collect()
    expect(result.status, result.stderr).toBe(0)
    const values = parseOutputs(readFileSync(output, 'utf8'))
    return {
      manifest: JSON.parse(values.manifest) as AssetManifest,
      paths: values.paths.split('\n'),
      setup: values.setup,
    }
  }

  function verify(
    remote: { isDraft: boolean; isPrerelease?: boolean; assets: Assets },
    manifest: AssetManifest,
    state: 'draft' | 'published',
    comparison: 'exact' | 'names-only',
  ) {
    const remoteFile = join(root, 'remote.json')
    writeFileSync(
      remoteFile,
      JSON.stringify({
        tagName: TAG,
        targetCommitish: SHA,
        isPrerelease: false,
        ...remote,
      }),
    )
    return spawnSync(process.execPath, [SCRIPT, 'verify', remoteFile, state, comparison], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_ASSET_MANIFEST: JSON.stringify(manifest),
        RELEASE_TAG: TAG,
        GITHUB_SHA: SHA,
      },
    })
  }

  it.each(['Valid', 'HashMismatch', 'NotTrusted', 'UnknownError', ''])(
    'rejects Authenticode status %j instead of confusing it with unsigned',
    (status) => {
      const result = spawnSync(process.execPath, [SCRIPT, 'assert-unsigned', status], { encoding: 'utf8' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('expected an unsigned installer')
    },
  )

  it('accepts only the exact Authenticode NotSigned status', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'assert-unsigned', 'NotSigned'], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  })

  it('accepts only the exact full commit behind a release tag', () => {
    let result = spawnSync(process.execPath, [SCRIPT, 'assert-target', SHA, SHA], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)

    result = spawnSync(process.execPath, [SCRIPT, 'assert-target', 'b'.repeat(40), SHA], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('release tag target mismatch')

    result = spawnSync(process.execPath, [SCRIPT, 'assert-target', 'main', SHA], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
  })

  it('allows only a higher stable version or an exact same-tag/same-commit retry', () => {
    const tagsFile = join(root, 'tags.json')
    const releasesFile = join(root, 'releases.json')
    const run = (version: string, releases: unknown, tags: unknown = [], expectedSha = SHA) => {
      writeFileSync(tagsFile, JSON.stringify(tags))
      writeFileSync(releasesFile, JSON.stringify(releases))
      return spawnSync(process.execPath, [SCRIPT, 'assert-version', version, tagsFile, releasesFile, expectedSha], {
        encoding: 'utf8',
      })
    }

    let result = run('0.4.0', [[{ tag_name: 'v0.3.9', target_commitish: 'b'.repeat(40) }]])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('version advance')

    result = run('0.4.0', [[{ tag_name: TAG, target_commitish: SHA }]])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('exact retry')

    result = run('0.4.0', [[{ tag_name: TAG, target_commitish: 'b'.repeat(40) }]])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('different commit')

    result = run('0.4.0', [[{ tag_name: 'v0.5.0', target_commitish: 'b'.repeat(40) }]])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('newer than highest stable version 0.5.0')

    result = run('0.4.0-beta.1', [])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('exact stable major.minor.patch SemVer')

    result = run('0.4.0', [], [[{ name: 'v0.5.0', commit: { sha: 'b'.repeat(40) } }]])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('newer than highest stable version 0.5.0')

    result = run('0.4.0', [], [[{ name: TAG, commit: { sha: SHA } }]])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('exact retry')
  })

  it('ignores non-stable channel tags but never ignores an occupied stable tag', () => {
    const tagsFile = join(root, 'tags.json')
    const releasesFile = join(root, 'releases.json')
    writeFileSync(tagsFile, '[]')
    writeFileSync(
      releasesFile,
      JSON.stringify([
        [
          { tag_name: 'v99.0.0-ci.1', target_commitish: 'b'.repeat(40) },
          { tag_name: 'not-a-version', target_commitish: 'b'.repeat(40) },
        ],
      ]),
    )
    let result = spawnSync(process.execPath, [SCRIPT, 'assert-version', '0.4.0', tagsFile, releasesFile, SHA], {
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)

    writeFileSync(
      releasesFile,
      JSON.stringify([
        [
          {
            tag_name: 'v0.4.0',
            target_commitish: 'b'.repeat(40),
            prerelease: true,
          },
        ],
      ]),
    )
    result = spawnSync(process.execPath, [SCRIPT, 'assert-version', '0.4.0', tagsFile, releasesFile, SHA], {
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('different commit')
  })

  it('collects every required Squirrel asset and emits deterministic GitHub outputs', () => {
    const collected = collectSuccessfully()

    expect(collected.setup).toBe(resolve(root, SETUP))
    expect(collected.paths).toEqual([
      resolve(root, 'RELEASES'),
      resolve(root, DELTA),
      resolve(root, FULL),
      resolve(root, SETUP),
    ])
    expect(collected.manifest).toEqual({
      version: '0.4.0',
      packageId: 'node-terminal',
      productName: 'nodeterm',
      assets: [
        {
          name: 'RELEASES',
          size: Buffer.byteLength(validReleases()),
          sha256: sha256(Buffer.from(validReleases())),
        },
        { name: DELTA, size: DELTA_BYTES.length, sha256: sha256(DELTA_BYTES) },
        { name: FULL, size: FULL_BYTES.length, sha256: sha256(FULL_BYTES) },
        { name: SETUP, size: SETUP_BYTES.length, sha256: sha256(SETUP_BYTES) },
      ],
    })
  })

  it('writes only the exact validated Setup path for local BAT consumption', () => {
    const packageJson = `${root}-package.json`
    const resultFile = `${root}-setup-result.txt`
    writeFileSync(
      packageJson,
      JSON.stringify({ name: 'node-terminal', version: '0.4.0', build: { productName: 'nodeterm' } }),
    )
    try {
      const result = spawnSync(process.execPath, [SCRIPT, 'collect-local', root, packageJson, resultFile], {
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(resultFile, 'utf8')).toBe(resolve(root, SETUP))
    } finally {
      rmSync(packageJson, { force: true })
      rmSync(resultFile, { force: true })
    }
  })

  it.each([
    ['unrelated file', () => writeFileSync(join(root, 'leftover.txt'), 'stale')],
    ['unrelated directory', () => mkdirSync(join(root, 'leftover-dir'))],
    [
      'unrelated junction',
      () => {
        const target = `${root}-junction-target`
        mkdirSync(target)
        symlinkSync(target, join(root, 'leftover-link'), process.platform === 'win32' ? 'junction' : 'dir')
      },
    ],
  ])('rejects an %s instead of silently omitting it', (_name, mutate) => {
    mutate()
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unexpected Squirrel output entr')
  })

  it('requires semantic nuspec metadata and rejects archive traversal', () => {
    const commentedLookalike = storedZip([
      {
        name: 'node-terminal.nuspec',
        value: Buffer.from(
          '<?xml version="1.0"?><package><!-- <metadata><id>node-terminal</id><version>0.4.0</version><title>nodeterm</title></metadata> --><metadata><id>node-terminal</id><version>0.4.0</version></metadata></package>',
        ),
      },
    ])
    writeFileSync(join(root, FULL), commentedLookalike)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, commentedLookalike)}\n${releasesLine(DELTA, DELTA_BYTES)}\n`,
    )
    let result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('non-empty metadata <title>')

    const traversal = storedZip([
      {
        name: '../node-terminal.nuspec',
        value: Buffer.from(
          '<?xml version="1.0"?><package><metadata><id>node-terminal</id><version>0.4.0</version><title>nodeterm</title></metadata></package>',
        ),
      },
    ])
    writeFileSync(join(root, FULL), traversal)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, traversal)}\n${releasesLine(DELTA, DELTA_BYTES)}\n`,
    )
    result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unsafe archive path')
  })

  it('validates every package identity, including the optional delta', () => {
    const wrongDelta = fullPackage('0.3.0')
    writeFileSync(join(root, DELTA), wrongDelta)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, FULL_BYTES)}\n${releasesLine(DELTA, wrongDelta)}\n`,
    )
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('internal version mismatch')
  })

  it('accepts only exact one-line SHA-256 result text', () => {
    const digestFile = `${root}-digest.txt`
    try {
      writeFileSync(digestFile, 'a'.repeat(64))
      let result = spawnSync(process.execPath, [SCRIPT, 'assert-sha256-file', digestFile], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)

      for (const value of [`${'a'.repeat(64)}\n`, '', 'not-a-digest', `prefix${'a'.repeat(64)}`]) {
        writeFileSync(digestFile, value)
        result = spawnSync(process.execPath, [SCRIPT, 'assert-sha256-file', digestFile], { encoding: 'utf8' })
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('exactly 64 hexadecimal')
      }
    } finally {
      rmSync(digestFile, { force: true })
    }
  })

  it('requires GITHUB_OUTPUT instead of claiming outputs were emitted', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'collect', '0.4.0', 'node-terminal', 'nodeterm', root],
      {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
      },
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('GITHUB_OUTPUT is required')
  })

  it.each([
    ['missing setup', () => unlinkSync(join(root, SETUP)), `exactly one ${SETUP}`],
    [
      'duplicate setup',
      () => writeFileSync(join(root, 'other-Setup-0.3.0.exe'), SETUP_BYTES),
      'unexpected Squirrel output entry',
    ],
    ['missing RELEASES', () => unlinkSync(join(root, 'RELEASES')), 'exactly one RELEASES'],
    [
      'missing full package',
      () => {
        // A delta can supplement the complete set, but it never replaces the required full package.
        unlinkSync(join(root, FULL))
        writeFileSync(join(root, 'RELEASES'), `${releasesLine(DELTA, DELTA_BYTES)}\n`)
      },
      `exactly one full Squirrel package named ${FULL}`,
    ],
  ])('rejects $0', (_name, mutate, message) => {
    mutate()
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it.each([
    ['setup', SETUP],
    ['RELEASES', 'RELEASES'],
    ['package', FULL],
  ])('rejects an empty %s asset', (_name, file) => {
    writeFileSync(join(root, file), '')
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`release asset is empty: ${file}`)
  })

  it('rejects a package referenced by RELEASES but missing on disk', () => {
    unlinkSync(join(root, DELTA))
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`missing on disk: ${DELTA}`)
  })

  it('rejects malformed and duplicate RELEASES entries', () => {
    writeFileSync(join(root, 'RELEASES'), 'this is not a RELEASES entry\n')
    let result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('40-hex SHA1')

    writeFileSync(join(root, 'RELEASES'), `${releasesLine(FULL, FULL_BYTES)}\n${releasesLine(FULL, FULL_BYTES)}\n`)
    unlinkSync(join(root, DELTA))
    result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`duplicate package entry: ${FULL}`)
  })

  it('rejects a RELEASES SHA1 mismatch', () => {
    const badHash = '0'.repeat(40)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, FULL_BYTES, FULL_BYTES.length, badHash)}\n${releasesLine(DELTA, DELTA_BYTES)}\n`,
    )
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`SHA1 mismatch for ${FULL}`)
  })

  it('rejects a RELEASES byte-size mismatch', () => {
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, FULL_BYTES, FULL_BYTES.length + 1)}\n${releasesLine(DELTA, DELTA_BYTES)}\n`,
    )
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`size mismatch for ${FULL}`)
  })

  it('rejects an unmanifested package instead of silently uploading it', () => {
    writeFileSync(join(root, 'orphan-delta.nupkg'), Buffer.from('orphan'))
    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('unexpected Squirrel package name')
  })

  it('rejects a self-consistent stale Squirrel set instead of publishing it under the candidate tag', () => {
    const staleFull = 'node-terminal-0.3.0-full.nupkg'
    const staleDelta = 'node-terminal-0.3.0-delta.nupkg'
    const staleFullBytes = fullPackage('0.3.0')
    renameSync(join(root, SETUP), join(root, 'nodeterm-Setup-0.3.0.exe'))
    unlinkSync(join(root, FULL))
    writeFileSync(join(root, staleFull), staleFullBytes)
    renameSync(join(root, DELTA), join(root, staleDelta))
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(staleFull, staleFullBytes)}\n${releasesLine(staleDelta, DELTA_BYTES)}\n`,
    )

    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`exactly one ${SETUP}`)
  })

  it('rejects a Setup for the wrong product even when its version is current', () => {
    renameSync(join(root, SETUP), join(root, 'other-product-Setup-0.4.0.exe'))

    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`exactly one ${SETUP}`)
  })

  it.each([
    ['version', fullPackage('0.3.0'), 'internal version mismatch'],
    ['package id', fullPackage('0.4.0', 'node-terminal', 'nodeterm', 'other-package'), 'package id mismatch'],
    ['product title', fullPackage('0.4.0', 'node-terminal', 'other-product'), 'product title mismatch'],
  ])('rejects a full package whose internal %s does not match the release identity', (_field, value, message) => {
    writeFileSync(join(root, FULL), value)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releasesLine(FULL, value)}\n${releasesLine(DELTA, DELTA_BYTES)}\n`,
    )

    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('rejects a renamed extra full package even when RELEASES describes its bytes exactly', () => {
    const extraName = 'node-terminal-0.4.0-copy-full.nupkg'
    writeFileSync(join(root, extraName), FULL_BYTES)
    writeFileSync(
      join(root, 'RELEASES'),
      `${validReleases()}${releasesLine(extraName, FULL_BYTES)}\n`,
    )

    const result = collect()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`unexpected Squirrel package name`)
  })

  it('verifies an exact draft asset inventory', () => {
    const { manifest } = collectSuccessfully()
    const result = verify({ isDraft: true, assets: remoteAssets(manifest.assets) }, manifest, 'draft', 'exact')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`verified ${manifest.assets.length} draft release assets (exact)`)
  })

  it('rejects the wrong draft/published state', () => {
    const { manifest } = collectSuccessfully()
    const result = verify({ isDraft: false, assets: remoteAssets(manifest.assets) }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected draft, got published')
  })

  it('requires every draft, retry, and published proof to be explicitly non-prerelease', () => {
    const { manifest } = collectSuccessfully()

    let result = verify(
      { isDraft: false, isPrerelease: true, assets: remoteAssets(manifest.assets) },
      manifest,
      'published',
      'exact',
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('explicitly non-prerelease')

    const remoteFile = join(root, 'remote.json')
    writeFileSync(
      remoteFile,
      JSON.stringify({
        isDraft: false,
        tagName: TAG,
        targetCommitish: SHA,
        assets: remoteAssets(manifest.assets),
      }),
    )
    result = spawnSync(process.execPath, [SCRIPT, 'verify', remoteFile, 'published', 'exact'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_ASSET_MANIFEST: JSON.stringify(manifest),
        RELEASE_TAG: TAG,
        GITHUB_SHA: SHA,
      },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('boolean isPrerelease')
  })

  it.each([
    ['missing', (assets: Assets) => assets.slice(1), 'missing: RELEASES'],
    [
      'extra',
      (assets: Assets) => [...assets, { name: 'surprise.nupkg', size: 1, digest: `sha256:${'0'.repeat(64)}` }],
      'extra: surprise.nupkg',
    ],
    ['duplicate', (assets: Assets) => [...assets, { ...assets[0] }], `duplicate asset: RELEASES`],
  ])('rejects a remote inventory with a %s asset', (_name, mutate, message) => {
    const { manifest } = collectSuccessfully()
    const result = verify(
      { isDraft: true, assets: mutate(remoteAssets(manifest.assets)) },
      manifest,
      'draft',
      'exact',
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('rejects a remote size mismatch in exact mode', () => {
    const { manifest } = collectSuccessfully()
    const changed = remoteAssets(manifest.assets).map((asset, index) =>
      index === 0 ? { ...asset, size: asset.size + 1 } : asset,
    )
    const result = verify({ isDraft: true, assets: changed }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('size mismatch for RELEASES')
  })

  it('requires GitHub SHA-256 digests and rejects same-size asset substitution', () => {
    const { manifest } = collectSuccessfully()
    const withoutDigest = remoteAssets(manifest.assets).map((asset, index) =>
      index === 0 ? { name: asset.name, size: asset.size } : asset,
    )
    let result = verify({ isDraft: true, assets: withoutDigest }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must expose an exact sha256 digest')

    const substituted = remoteAssets(manifest.assets).map((asset, index) =>
      index === 0 ? { ...asset, digest: `sha256:${'0'.repeat(64)}` } : asset,
    )
    result = verify({ isDraft: true, assets: substituted }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('SHA-256 mismatch for RELEASES')
  })

  it('requires exact sizes even for an already-published retry', () => {
    const { manifest } = collectSuccessfully()
    const changedSizes = remoteAssets(manifest.assets).map((asset) => ({
      ...asset,
      size: asset.size + 100,
    }))

    let result = verify({ isDraft: false, assets: changedSizes }, manifest, 'published', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('size mismatch')

    result = verify({ isDraft: false, assets: changedSizes }, manifest, 'published', 'names-only')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('comparison must be exact')
  })

  it('rejects remote release metadata for another tag or commit', () => {
    const { manifest } = collectSuccessfully()
    const remoteFile = join(root, 'remote.json')
    const env = {
      ...process.env,
      RELEASE_ASSET_MANIFEST: JSON.stringify(manifest),
      RELEASE_TAG: TAG,
      GITHUB_SHA: SHA,
    }

    writeFileSync(
      remoteFile,
      JSON.stringify({
        isDraft: false,
        isPrerelease: false,
        tagName: 'v-other',
        targetCommitish: SHA,
        assets: remoteAssets(manifest.assets),
      }),
    )
    let result = spawnSync(process.execPath, [SCRIPT, 'verify', remoteFile, 'published', 'exact'], {
      encoding: 'utf8',
      env,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('remote release tag mismatch')

    writeFileSync(
      remoteFile,
      JSON.stringify({
        isDraft: false,
        isPrerelease: false,
        tagName: TAG,
        targetCommitish: 'b'.repeat(40),
        assets: remoteAssets(manifest.assets),
      }),
    )
    result = spawnSync(process.execPath, [SCRIPT, 'verify', remoteFile, 'published', 'exact'], {
      encoding: 'utf8',
      env,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('remote release target mismatch')
  })
})
