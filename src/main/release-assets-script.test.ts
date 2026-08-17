import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../scripts/release-assets.mjs')
const SETUP = 'nodeterm-Setup-0.3.0.exe'
const FULL = 'node-terminal-0.3.0-full.nupkg'
const DELTA = 'node-terminal-0.3.0-delta.nupkg'
const TAG = 'v0.3.0-ci.123'
const SHA = 'a'.repeat(40)
const SETUP_BYTES = Buffer.from('setup executable\n')
const FULL_BYTES = Buffer.from('full package\n')
const DELTA_BYTES = Buffer.from('delta package\n')

type Assets = Array<{ name: string; size: number }>
type AssetManifest = { assets: Assets }

function sha1(value: Buffer): string {
  return createHash('sha1').update(value).digest('hex')
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
    output = join(root, 'github-output.txt')
    writeFileSync(join(root, SETUP), SETUP_BYTES)
    writeFileSync(join(root, FULL), FULL_BYTES)
    writeFileSync(join(root, DELTA), DELTA_BYTES)
    writeFileSync(join(root, 'RELEASES'), validReleases())
    writeFileSync(output, '')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function collect() {
    return spawnSync(process.execPath, [SCRIPT, 'collect', root], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output },
    })
  }

  function collectSuccessfully(): { manifest: AssetManifest; paths: string[]; setup: string } {
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
    remote: { isDraft: boolean; assets: Assets },
    manifest: AssetManifest,
    state: 'draft' | 'published',
    comparison: 'exact' | 'names-only',
  ) {
    const remoteFile = join(root, 'remote.json')
    writeFileSync(remoteFile, JSON.stringify({ tagName: TAG, targetCommitish: SHA, ...remote }))
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
      assets: [
        { name: 'RELEASES', size: Buffer.byteLength(validReleases()) },
        { name: DELTA, size: DELTA_BYTES.length },
        { name: FULL, size: FULL_BYTES.length },
        { name: SETUP, size: SETUP_BYTES.length },
      ],
    })
  })

  it('requires GITHUB_OUTPUT instead of claiming outputs were emitted', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'collect', root], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' },
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('GITHUB_OUTPUT is required')
  })

  it.each([
    ['missing setup', () => unlinkSync(join(root, SETUP)), 'exactly one *-Setup-*.exe'],
    [
      'duplicate setup',
      () => writeFileSync(join(root, 'other-Setup-0.3.0.exe'), SETUP_BYTES),
      'exactly one *-Setup-*.exe',
    ],
    ['missing RELEASES', () => unlinkSync(join(root, 'RELEASES')), 'exactly one RELEASES'],
    [
      'missing full package',
      () => {
        unlinkSync(join(root, FULL))
        writeFileSync(join(root, 'RELEASES'), `${releasesLine(DELTA, DELTA_BYTES)}\n`)
      },
      'at least one *-full.nupkg',
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
    expect(result.stderr).toContain('package is not listed in RELEASES: orphan-delta.nupkg')
  })

  it('verifies an exact draft asset inventory', () => {
    const { manifest } = collectSuccessfully()
    const result = verify({ isDraft: true, assets: manifest.assets }, manifest, 'draft', 'exact')
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`verified ${manifest.assets.length} draft release assets (exact)`)
  })

  it('rejects the wrong draft/published state', () => {
    const { manifest } = collectSuccessfully()
    const result = verify({ isDraft: false, assets: manifest.assets }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected draft, got published')
  })

  it.each([
    ['missing', (assets: Assets) => assets.slice(1), 'missing: RELEASES'],
    [
      'extra',
      (assets: Assets) => [...assets, { name: 'surprise.nupkg', size: 1 }],
      'extra: surprise.nupkg',
    ],
    [
      'duplicate',
      (assets: Assets) => [...assets, { ...assets[0] }],
      `duplicate asset: RELEASES`,
    ],
  ])('rejects a remote inventory with a %s asset', (_name, mutate, message) => {
    const { manifest } = collectSuccessfully()
    const result = verify({ isDraft: true, assets: mutate(manifest.assets) }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(message)
  })

  it('rejects a remote size mismatch in exact mode', () => {
    const { manifest } = collectSuccessfully()
    const changed = manifest.assets.map((asset, index) => (index === 0 ? { ...asset, size: asset.size + 1 } : asset))
    const result = verify({ isDraft: true, assets: changed }, manifest, 'draft', 'exact')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('size mismatch for RELEASES')
  })

  it('requires exact sizes even for an already-published retry', () => {
    const { manifest } = collectSuccessfully()
    const changedSizes = manifest.assets.map((asset) => ({ ...asset, size: asset.size + 100 }))

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
      JSON.stringify({ isDraft: false, tagName: 'v-other', targetCommitish: SHA, assets: manifest.assets }),
    )
    let result = spawnSync(process.execPath, [SCRIPT, 'verify', remoteFile, 'published', 'exact'], {
      encoding: 'utf8',
      env,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('remote release tag mismatch')

    writeFileSync(
      remoteFile,
      JSON.stringify({ isDraft: false, tagName: TAG, targetCommitish: 'b'.repeat(40), assets: manifest.assets }),
    )
    result = spawnSync(process.execPath, [SCRIPT, 'verify', remoteFile, 'published', 'exact'], {
      encoding: 'utf8',
      env,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('remote release target mismatch')
  })
})
