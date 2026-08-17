#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SETUP_RE = /^.+-Setup-.+\.exe$/i
const NUPKG_RE = /\.nupkg$/i
const FULL_NUPKG_RE = /-full\.nupkg$/i
const RELEASE_LINE_RE = /^([0-9a-f]{40})\s+(\S+)\s+(\d+)$/i

function fail(message) {
  throw new Error(message)
}

/** Accept only PowerShell's unambiguous Authenticode status for an unsigned file. */
export function requireUnsignedAuthenticode(status) {
  if (status !== 'NotSigned') {
    fail(`expected an unsigned installer, but Authenticode reported ${JSON.stringify(status)}`)
  }
  return status
}

/** Refuse to reuse or publish a tag unless it resolves to this run's exact commit. */
export function requireReleaseTarget(actual, expected) {
  if (!/^[0-9a-f]{40}$/i.test(actual) || !/^[0-9a-f]{40}$/i.test(expected) || actual !== expected) {
    fail(`release tag target mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  return actual
}

function sorted(items, select = (item) => item) {
  return [...items].sort((left, right) => {
    const a = select(left)
    const b = select(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

function parseJson(raw, description) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`${description} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Parse and validate the Squirrel.Windows RELEASES file. */
export function parseReleases(text) {
  if (typeof text !== 'string') fail('RELEASES content must be text')

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) fail('RELEASES is empty')

  const names = new Set()
  return lines.map((line, index) => {
    const match = RELEASE_LINE_RE.exec(line)
    if (!match) {
      fail(`RELEASES line ${index + 1} must contain a 40-hex SHA1, package name, and byte size`)
    }

    const [, sha1, name, sizeRaw] = match
    if (path.basename(name) !== name || name === '.' || name === '..' || /[\\/\r\n]/.test(name)) {
      fail(`RELEASES line ${index + 1} contains an unsafe package name: ${JSON.stringify(name)}`)
    }
    if (!NUPKG_RE.test(name)) {
      fail(`RELEASES line ${index + 1} does not reference a .nupkg: ${name}`)
    }
    if (names.has(name)) fail(`RELEASES contains duplicate package entry: ${name}`)
    names.add(name)

    const size = Number(sizeRaw)
    if (!Number.isSafeInteger(size) || size <= 0) {
      fail(`RELEASES line ${index + 1} has an invalid package size: ${sizeRaw}`)
    }

    return { name, size, sha1: sha1.toLowerCase() }
  })
}

async function sha1File(file) {
  const hash = createHash('sha1')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function regularFile(directory, entry) {
  if (!entry.isFile()) fail(`release asset must be a regular file: ${entry.name}`)
  const file = path.resolve(directory, entry.name)
  const info = await stat(file)
  if (!info.isFile()) fail(`release asset must be a regular file: ${entry.name}`)
  if (info.size <= 0) fail(`release asset is empty: ${entry.name}`)
  return { name: entry.name, path: file, size: info.size }
}

/** Collect and validate the complete Squirrel.Windows release asset set. */
export async function collectReleaseAssets(directory) {
  const root = path.resolve(directory)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    fail(`could not read Squirrel output directory ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const setupEntries = entries.filter((entry) => SETUP_RE.test(entry.name))
  if (setupEntries.length !== 1) {
    fail(`expected exactly one *-Setup-*.exe, found ${setupEntries.length}`)
  }

  const releaseEntries = entries.filter((entry) => entry.name === 'RELEASES')
  if (releaseEntries.length !== 1) {
    fail(`expected exactly one RELEASES file, found ${releaseEntries.length}`)
  }

  const packageEntries = sorted(
    entries.filter((entry) => NUPKG_RE.test(entry.name)),
    (entry) => entry.name,
  )
  const fullPackages = packageEntries.filter((entry) => FULL_NUPKG_RE.test(entry.name))
  if (fullPackages.length === 0) fail('expected at least one *-full.nupkg')

  const setup = await regularFile(root, setupEntries[0])
  const releases = await regularFile(root, releaseEntries[0])
  const packages = []
  for (const entry of packageEntries) packages.push(await regularFile(root, entry))

  const releaseRows = parseReleases(await readFile(releases.path, 'utf8'))
  const rowsByName = new Map(releaseRows.map((row) => [row.name, row]))
  const packagesByName = new Map(packages.map((asset) => [asset.name, asset]))

  for (const row of releaseRows) {
    const asset = packagesByName.get(row.name)
    if (!asset) fail(`RELEASES references a package that is missing on disk: ${row.name}`)
    if (asset.size !== row.size) {
      fail(`RELEASES size mismatch for ${row.name}: recorded ${row.size}, actual ${asset.size}`)
    }
    const actualSha1 = await sha1File(asset.path)
    if (actualSha1 !== row.sha1) {
      fail(`RELEASES SHA1 mismatch for ${row.name}: recorded ${row.sha1}, actual ${actualSha1}`)
    }
  }

  for (const asset of packages) {
    if (!rowsByName.has(asset.name)) fail(`package is not listed in RELEASES: ${asset.name}`)
  }

  const assets = sorted([setup, releases, ...packages], (asset) => asset.name)
  const manifest = { assets: assets.map(({ name, size }) => ({ name, size })) }
  return {
    paths: assets.map((asset) => asset.path),
    setup: setup.path,
    manifest,
  }
}

function validateExpectedManifest(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.assets)) {
    fail('expected release asset manifest must contain an assets array')
  }
  if (value.assets.length === 0) fail('expected release asset manifest assets must not be empty')
  const names = new Set()
  return sorted(
    value.assets.map((asset, index) => {
      if (asset == null || typeof asset !== 'object' || Array.isArray(asset)) {
        fail(`expected manifest asset ${index + 1} must be an object`)
      }
      const { name, size } = asset
      if (typeof name !== 'string' || name.length === 0 || /[\r\n]/.test(name)) {
        fail(`expected manifest asset ${index + 1} has an invalid name`)
      }
      if (names.has(name)) fail(`expected manifest contains duplicate asset: ${name}`)
      names.add(name)
      if (!Number.isSafeInteger(size) || size <= 0) {
        fail(`expected manifest asset ${name} has an invalid size`)
      }
      return { name, size }
    }),
    (asset) => asset.name,
  )
}

function validateRemoteAssets(value) {
  if (!Array.isArray(value)) fail('remote release JSON must contain an assets array')
  const names = new Set()
  return sorted(
    value.map((asset, index) => {
      if (asset == null || typeof asset !== 'object' || Array.isArray(asset)) {
        fail(`remote release asset ${index + 1} must be an object`)
      }
      const { name, size } = asset
      if (typeof name !== 'string' || name.length === 0 || /[\r\n]/.test(name)) {
        fail(`remote release asset ${index + 1} has an invalid name`)
      }
      if (names.has(name)) fail(`remote release contains duplicate asset: ${name}`)
      names.add(name)
      if (!Number.isSafeInteger(size) || size <= 0) {
        fail(`remote release asset ${name} has an invalid size`)
      }
      return { name, size }
    }),
    (asset) => asset.name,
  )
}

/** Verify a `gh release view --json isDraft,assets` result against a local manifest. */
export function verifyRemoteRelease(release, expectedManifest, expectedState, comparison = 'exact', identity = {}) {
  if (expectedState !== 'draft' && expectedState !== 'published') {
    fail(`release state must be draft or published, got ${JSON.stringify(expectedState)}`)
  }
  if (comparison !== 'exact') fail(`release comparison must be exact, got ${JSON.stringify(comparison)}`)
  if (release == null || typeof release !== 'object' || Array.isArray(release)) {
    fail('remote release JSON must be an object')
  }
  if (typeof release.isDraft !== 'boolean') fail('remote release JSON must contain boolean isDraft')
  if (typeof identity.tag !== 'string' || identity.tag.length === 0) fail('expected release tag is required')
  if (!/^[0-9a-f]{40}$/i.test(identity.target)) fail('expected release target must be a full commit SHA')
  if (release.tagName !== identity.tag) {
    fail(`remote release tag mismatch: expected ${JSON.stringify(identity.tag)}, got ${JSON.stringify(release.tagName)}`)
  }
  if (release.targetCommitish !== identity.target) {
    fail(
      `remote release target mismatch: expected ${JSON.stringify(identity.target)}, ` +
        `got ${JSON.stringify(release.targetCommitish)}`,
    )
  }

  const shouldBeDraft = expectedState === 'draft'
  if (release.isDraft !== shouldBeDraft) {
    fail(`remote release state mismatch: expected ${expectedState}, got ${release.isDraft ? 'draft' : 'published'}`)
  }

  const expected = validateExpectedManifest(expectedManifest)
  const actual = validateRemoteAssets(release.assets)
  const expectedNames = expected.map((asset) => asset.name)
  const actualNames = actual.map((asset) => asset.name)
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    const missing = expectedNames.filter((name) => !actualNames.includes(name))
    const extra = actualNames.filter((name) => !expectedNames.includes(name))
    fail(
      `remote release asset names do not match manifest` +
        `${missing.length ? `; missing: ${missing.join(', ')}` : ''}` +
        `${extra.length ? `; extra: ${extra.join(', ')}` : ''}`,
    )
  }

  const expectedByName = new Map(expected.map((asset) => [asset.name, asset.size]))
  for (const asset of actual) {
    const expectedSize = expectedByName.get(asset.name)
    if (asset.size !== expectedSize) {
      fail(`remote release asset size mismatch for ${asset.name}: expected ${expectedSize}, got ${asset.size}`)
    }
  }

  return { state: expectedState, comparison, assets: actual.length }
}

async function emitGitHubOutputs(result) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) fail('GITHUB_OUTPUT is required for collect')
  if (result.paths.some((item) => /[\r\n]/.test(item)) || /[\r\n]/.test(result.setup)) {
    fail('release asset paths must not contain CR or LF')
  }

  const delimiter = `RELEASE_ASSETS_${randomUUID().replaceAll('-', '')}`
  const block = [
    `paths<<${delimiter}`,
    ...result.paths,
    delimiter,
    `setup=${result.setup}`,
    `manifest=${JSON.stringify(result.manifest)}`,
    '',
  ].join('\n')
  await appendFile(outputFile, block, 'utf8')
}

async function main(argv) {
  const [command, ...args] = argv
  if (command === 'assert-unsigned') {
    if (args.length !== 1) fail('usage: release-assets.mjs assert-unsigned <Authenticode-status>')
    requireUnsignedAuthenticode(args[0])
    console.log('verified Authenticode status NotSigned')
    return
  }

  if (command === 'assert-target') {
    if (args.length !== 2) fail('usage: release-assets.mjs assert-target <actual-sha> <expected-sha>')
    requireReleaseTarget(args[0], args[1])
    console.log(`verified release tag target ${args[0]}`)
    return
  }

  if (command === 'collect') {
    if (args.length > 1) fail('usage: release-assets.mjs collect [squirrel-output-directory]')
    const result = await collectReleaseAssets(args[0] ?? 'dist/squirrel-windows')
    await emitGitHubOutputs(result)
    console.log(`validated ${result.manifest.assets.length} Squirrel release assets`)
    return
  }

  if (command === 'verify') {
    if (args.length !== 3) {
      fail('usage: release-assets.mjs verify <remote-json-file> <draft|published> exact')
    }
    const [remoteFile, expectedState, comparison] = args
    const manifestRaw = process.env.RELEASE_ASSET_MANIFEST
    if (!manifestRaw) fail('RELEASE_ASSET_MANIFEST is required for verify')
    const releaseTag = process.env.RELEASE_TAG
    if (!releaseTag) fail('RELEASE_TAG is required for verify')
    const releaseTarget = process.env.GITHUB_SHA
    if (!releaseTarget) fail('GITHUB_SHA is required for verify')
    const manifest = parseJson(manifestRaw, 'RELEASE_ASSET_MANIFEST')
    const release = parseJson(await readFile(remoteFile, 'utf8'), 'remote release file')
    const result = verifyRemoteRelease(release, manifest, expectedState, comparison, {
      tag: releaseTag,
      target: releaseTarget,
    })
    console.log(`verified ${result.assets} ${result.state} release assets (${result.comparison})`)
    return
  }

  fail(
    'usage: release-assets.mjs assert-target <actual-sha> <expected-sha>\n' +
      '   or: release-assets.mjs assert-unsigned <Authenticode-status>\n' +
      '   or: release-assets.mjs collect [squirrel-output-directory]\n' +
      '   or: release-assets.mjs verify <remote-json-file> <draft|published> exact',
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release-assets: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
