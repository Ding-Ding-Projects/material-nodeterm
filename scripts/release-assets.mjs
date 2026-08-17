import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sax from 'sax'
import { Open } from 'unzipper'

const NUPKG_RE = /\.nupkg$/i
const FULL_NUPKG_RE = /-full\.nupkg$/i
const RELEASE_LINE_RE = /^([0-9a-f]{40})\s+(\S+)\s+(\d+)$/i
const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const PACKAGE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

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

/** Validate a digest result file without accepting whitespace, inherited text, or partial output. */
export function requireSha256Text(text) {
  if (!/^[0-9a-f]{64}$/i.test(text)) {
    fail('SHA-256 result must contain exactly 64 hexadecimal characters and nothing else')
  }
  return text.toLowerCase()
}

function stableVersionParts(version, description) {
  const match = STABLE_VERSION_RE.exec(version)
  if (!match) fail(`${description} must be an exact stable major.minor.patch SemVer, got ${JSON.stringify(version)}`)
  return match.slice(1).map((part) => BigInt(part))
}

function compareStableVersions(left, right) {
  const a = stableVersionParts(left, 'stable version')
  const b = stableVersionParts(right, 'stable version')
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1
    if (a[index] > b[index]) return 1
  }
  return 0
}

function flattenGitHubPages(pages, description) {
  if (!Array.isArray(pages)) fail(`${description} response must be an array`)
  const nested = pages.every(Array.isArray)
  const flat = pages.every((entry) => !Array.isArray(entry))
  if (!nested && !flat) fail(`${description} response must not mix pages and objects`)
  return nested ? pages.flat() : pages
}

/** Require a new stable version, except for an exact same-tag/same-commit retry. */
export function requireStableVersionAdvance(candidate, tagPages, releasePages, expectedTarget) {
  stableVersionParts(candidate, 'candidate version')
  if (!/^[0-9a-f]{40}$/i.test(expectedTarget)) fail('expected release target must be a full commit SHA')
  const tags = flattenGitHubPages(tagPages, 'GitHub tags')
  const releases = flattenGitHubPages(releasePages, 'GitHub releases')
  let highest = null
  const candidateTargets = []

  for (const [index, tag] of tags.entries()) {
    if (tag == null || typeof tag !== 'object' || Array.isArray(tag)) {
      fail(`GitHub tag ${index + 1} must be an object`)
    }
    const name = tag.name
    if (typeof name !== 'string' || !name.startsWith('v') || !STABLE_VERSION_RE.test(name.slice(1))) continue
    const target = tag.commit?.sha
    if (typeof target !== 'string') fail(`stable tag ${name} must expose commit.sha`)
    const version = name.slice(1)
    if (highest == null || compareStableVersions(version, highest) > 0) highest = version
    if (version === candidate) candidateTargets.push(target)
  }

  for (const [index, release] of releases.entries()) {
    if (release == null || typeof release !== 'object' || Array.isArray(release)) {
      fail(`GitHub release ${index + 1} must be an object`)
    }
    const tag = release.tag_name ?? release.tagName
    if (typeof tag !== 'string' || !tag.startsWith('v') || !STABLE_VERSION_RE.test(tag.slice(1))) continue
    const target = release.target_commitish ?? release.targetCommitish
    if (typeof target !== 'string') fail(`stable release ${tag} must expose target_commitish`)
    const version = tag.slice(1)
    if (highest == null || compareStableVersions(version, highest) > 0) highest = version
    if (version === candidate) candidateTargets.push(target)
  }

  if (highest == null || compareStableVersions(candidate, highest) > 0) {
    return { kind: 'advance', highest }
  }
  if (
    candidate === highest &&
    candidateTargets.length > 0 &&
    candidateTargets.every((target) => target === expectedTarget)
  ) {
    return { kind: 'retry', highest }
  }
  if (candidate === highest) {
    fail(`stable tag v${candidate} already targets a different commit; exact retry refused`)
  }
  fail(`candidate version ${candidate} must be newer than highest stable version ${highest}`)
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
    const foldedName = name.toLowerCase()
    if (names.has(foldedName)) fail(`RELEASES contains duplicate package entry: ${name}`)
    names.add(foldedName)

    const size = Number(sizeRaw)
    if (!Number.isSafeInteger(size) || size <= 0) {
      fail(`RELEASES line ${index + 1} has an invalid package size: ${sizeRaw}`)
    }

    return { name, size, sha1: sha1.toLowerCase() }
  })
}

async function sha1File(file) {
  return hashFile(file, 'sha1')
}

async function sha256File(file) {
  return hashFile(file, 'sha256')
}

async function hashFile(file, algorithm) {
  const hash = createHash(algorithm)
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

function safeProductName(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 100 &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(value) &&
    !/[ .]$/.test(value) &&
    value !== '.' &&
    value !== '..'
}

/** Read the exact package identity which every Squirrel artifact must carry. */
export async function readReleaseIdentity(packageJsonFile) {
  let value
  try {
    value = JSON.parse(await readFile(path.resolve(packageJsonFile), 'utf8'))
  } catch (error) {
    fail(`could not read release identity from package.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  return requireReleaseIdentity(value?.version, value?.name, value?.build?.productName)
}

function requireReleaseIdentity(versionOrIdentity, packageId, productName) {
  const identity = versionOrIdentity && typeof versionOrIdentity === 'object'
    ? versionOrIdentity
    : { version: versionOrIdentity, packageId, productName }
  const version = identity.version
  packageId = identity.packageId
  productName = identity.productName
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    fail(`expected package version must be an exact semantic version, got ${JSON.stringify(version)}`)
  }
  if (typeof packageId !== 'string' || !PACKAGE_ID_RE.test(packageId)) {
    fail(`expected Squirrel package id is invalid: ${JSON.stringify(packageId)}`)
  }
  if (!safeProductName(productName)) {
    fail(`expected product name must be a safe non-empty Windows filename component, got ${JSON.stringify(productName)}`)
  }
  return { version, packageId, productName }
}

/** Parse only direct package/metadata children; comments and duplicate lookalikes cannot satisfy it. */
export function parseNuspecMetadata(nuspec, description = 'nuspec') {
  if (typeof nuspec !== 'string') fail(`${description} must be UTF-8 XML text`)
  const parser = sax.parser(true, { xmlns: true, trim: false, normalize: false })
  const stack = []
  const values = new Map()
  let parseError = null
  let packageRoots = 0
  let metadataNodes = 0
  parser.ondoctype = () => { parseError = new Error('DOCTYPE is not allowed') }
  parser.onopentag = (node) => {
    const local = node.local
    stack.push(local)
    if (stack.length === 1) {
      if (local !== 'package') parseError = new Error('root element must be package')
      packageRoots += 1
      return
    }
    if (stack.length === 2 && local === 'metadata' && stack[0] === 'package') {
      metadataNodes += 1
      return
    }
    if (stack.length > 3 && stack[0] === 'package' && stack[1] === 'metadata' && values.has(stack[2])) {
      parseError = new Error(`metadata <${stack[2]}> must contain text only`)
    }
    if (stack.length === 3 && stack[0] === 'package' && stack[1] === 'metadata') {
      if (values.has(local)) parseError = new Error(`duplicate metadata <${local}>`)
      else values.set(local, '')
    }
  }
  const appendText = (text) => {
    if (stack.length === 3 && stack[0] === 'package' && stack[1] === 'metadata' && values.has(stack[2])) {
      values.set(stack[2], values.get(stack[2]) + text)
    }
  }
  parser.ontext = appendText
  parser.oncdata = appendText
  parser.onclosetag = () => { stack.pop() }
  parser.onerror = (error) => { parseError = error }
  try {
    parser.write(nuspec).close()
  } catch (error) {
    parseError = error
  }
  if (parseError) fail(`${description} is not safe, well-formed nuspec XML: ${parseError.message}`)
  if (packageRoots !== 1 || metadataNodes !== 1) {
    fail(`${description} must contain exactly one direct package metadata element`)
  }
  return new Map([...values].map(([name, value]) => [name, value.trim()]))
}

export function nuspecMetadataElement(nuspec, name, description = 'nuspec') {
  const metadata = parseNuspecMetadata(nuspec, description)
  if (!metadata.has(name) || metadata.get(name) === '') {
    fail(`${description} must contain exactly one non-empty metadata <${name}>`)
  }
  return metadata.get(name)
}

async function entryBuffer(entry, description, maxBytes = 1024 * 1024) {
  if (Number(entry.uncompressedSize) > maxBytes) fail(`${description} is too large to inspect safely`)
  const value = await entry.buffer()
  if (value.length === 0 || value.length > maxBytes) fail(`${description} has an invalid byte size`)
  return value
}

async function inspectPackageIdentity(asset, expected) {
  let archive
  try {
    archive = await Open.file(asset.path)
  } catch (error) {
    fail(`could not open ${asset.name} as a nupkg: ${error instanceof Error ? error.message : String(error)}`)
  }

  const unsafe = archive.files.filter((entry) => {
    const normalized = entry.path.replaceAll('\\', '/')
    return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')
  })
  if (unsafe.length > 0) fail(`${asset.name} contains an unsafe archive path: ${unsafe[0].path}`)
  const nuspecEntries = archive.files.filter((entry) =>
    entry.type === 'File' && /(^|\/)[^/]+\.nuspec$/i.test(entry.path.replaceAll('\\', '/')),
  )
  if (nuspecEntries.length !== 1) {
    fail(`${asset.name} must contain exactly one .nuspec, found ${nuspecEntries.length}`)
  }
  const nuspec = nuspecEntries[0]
  const expectedNuspecName = `${expected.packageId}.nuspec`
  if (path.posix.basename(nuspec.path.replaceAll('\\', '/')) !== expectedNuspecName) {
    fail(`${asset.name} nuspec name mismatch: expected ${expectedNuspecName}, got ${nuspec.path}`)
  }
  const description = `${asset.name} nuspec`
  const text = (await entryBuffer(nuspec, description)).toString('utf8')
  const actualId = nuspecMetadataElement(text, 'id', description)
  const actualVersion = nuspecMetadataElement(text, 'version', description)
  const actualTitle = nuspecMetadataElement(text, 'title', description)
  if (actualId !== expected.packageId) {
    fail(`${asset.name} package id mismatch: expected ${expected.packageId}, got ${actualId}`)
  }
  if (actualVersion !== expected.version) {
    fail(`${asset.name} internal version mismatch: expected ${expected.version}, got ${actualVersion}`)
  }
  if (actualTitle !== expected.productName) {
    fail(`${asset.name} product title mismatch: expected ${expected.productName}, got ${actualTitle}`)
  }
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
export async function collectReleaseAssets(directory, expectedVersion, expectedPackageId, expectedProductName) {
  const expected = requireReleaseIdentity(expectedVersion, expectedPackageId, expectedProductName)
  const root = path.resolve(directory)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    fail(`could not read Squirrel output directory ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const expectedSetupName = `${expected.productName}-Setup-${expected.version}.exe`
  const setupEntries = entries.filter((entry) => entry.name === expectedSetupName)
  if (setupEntries.length !== 1) {
    fail(`expected exactly one ${expectedSetupName}, found ${setupEntries.length}`)
  }

  const releaseEntries = entries.filter((entry) => entry.name === 'RELEASES')
  if (releaseEntries.length !== 1) {
    fail(`expected exactly one RELEASES file, found ${releaseEntries.length}`)
  }

  const packageEntries = sorted(
    entries.filter((entry) => NUPKG_RE.test(entry.name)),
    (entry) => entry.name,
  )
  const expectedFullName = `${expected.packageId}-${expected.version}-full.nupkg`
  const expectedDeltaName = `${expected.packageId}-${expected.version}-delta.nupkg`
  const allowedPackageNames = new Set([expectedFullName, expectedDeltaName])

  for (const entry of packageEntries) {
    if (!allowedPackageNames.has(entry.name)) {
      fail(
        `unexpected Squirrel package name: expected ${expectedFullName}` +
          ` and optional ${expectedDeltaName}, got ${entry.name}`,
      )
    }
  }

  const allowedNames = new Set([expectedSetupName, 'RELEASES', ...packageEntries.map((entry) => entry.name)])
  const unexpectedEntries = sorted(entries.filter((entry) => !allowedNames.has(entry.name)), (entry) => entry.name)
  if (unexpectedEntries.length > 0) {
    fail(
      `unexpected Squirrel output entr${unexpectedEntries.length === 1 ? 'y' : 'ies'}: ` +
        unexpectedEntries.map((entry) => entry.name).join(', '),
    )
  }

  const setup = await regularFile(root, setupEntries[0])
  const releases = await regularFile(root, releaseEntries[0])
  const packages = []
  for (const entry of packageEntries) {
    const asset = await regularFile(root, entry)
    await inspectPackageIdentity(asset, expected)
    packages.push(asset)
  }

  if (setup.name !== expectedSetupName) {
    fail(`Setup identity/version mismatch: expected ${expectedSetupName}, got ${setup.name}`)
  }
  const fullPackages = packages.filter((asset) => FULL_NUPKG_RE.test(asset.name))
  if (fullPackages.length !== 1 || fullPackages[0].name !== expectedFullName) {
    fail(`expected exactly one full Squirrel package named ${expectedFullName}`)
  }

  if (setup.name !== expectedSetupName) {
    fail(`Setup identity/version mismatch: expected ${expectedSetupName}, got ${setup.name}`)
  }
  for (const asset of packages) {
    if (!allowedPackageNames.has(asset.name)) {
      fail(
        `unexpected Squirrel package name: expected ${expectedFullName}` +
          ` and optional ${expectedDeltaName}, got ${asset.name}`,
      )
    }
  }
  if (!packages.some((asset) => asset.name === expectedFullName)) {
    fail(`expected exactly one full Squirrel package named ${expectedFullName}`)
  }

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

  await requireFullPackageIdentity(packagesByName.get(expectedFullName), expected)

  const assets = sorted([setup, releases, ...packages], (asset) => asset.name)
  const manifestAssets = []
  for (const asset of assets) {
    manifestAssets.push({ name: asset.name, size: asset.size, sha256: await sha256File(asset.path) })
  }
  const manifest = {
    version: expected.version,
    packageId: expected.packageId,
    productName: expected.productName,
    assets: manifestAssets,
  }
  return {
    paths: assets.map((asset) => asset.path),
    setup: setup.path,
    releases: releases.path,
    packages: packages.map((asset) => asset.path),
    identity: expected,
    manifest,
  }
}

function validateExpectedManifest(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.assets)) {
    fail('expected release asset manifest must contain an assets array')
  }
  const identity = requireReleaseIdentity(value.version, value.packageId, value.productName)
  if (value.assets.length === 0) fail('expected release asset manifest assets must not be empty')
  const names = new Set()
  const assets = sorted(
    value.assets.map((asset, index) => {
      if (asset == null || typeof asset !== 'object' || Array.isArray(asset)) {
        fail(`expected manifest asset ${index + 1} must be an object`)
      }
      const { name, size, sha256 } = asset
      if (typeof name !== 'string' || name.length === 0 || /[\r\n]/.test(name)) {
        fail(`expected manifest asset ${index + 1} has an invalid name`)
      }
      if (names.has(name)) fail(`expected manifest contains duplicate asset: ${name}`)
      names.add(name)
      if (!Number.isSafeInteger(size) || size <= 0) {
        fail(`expected manifest asset ${name} has an invalid size`)
      }
      if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
        fail(`expected manifest asset ${name} has an invalid SHA-256`)
      }
      return { name, size, sha256 }
    }),
    (asset) => asset.name,
  )
  return { ...identity, assets }
}

function validateRemoteAssets(value) {
  if (!Array.isArray(value)) fail('remote release JSON must contain an assets array')
  const names = new Set()
  return sorted(
    value.map((asset, index) => {
      if (asset == null || typeof asset !== 'object' || Array.isArray(asset)) {
        fail(`remote release asset ${index + 1} must be an object`)
      }
      const { name, size, digest } = asset
      if (typeof name !== 'string' || name.length === 0 || /[\r\n]/.test(name)) {
        fail(`remote release asset ${index + 1} has an invalid name`)
      }
      if (names.has(name)) fail(`remote release contains duplicate asset: ${name}`)
      names.add(name)
      if (!Number.isSafeInteger(size) || size <= 0) {
        fail(`remote release asset ${name} has an invalid size`)
      }
      if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
        fail(`remote release asset ${name} must expose an exact sha256 digest`)
      }
      return { name, size, sha256: digest.slice('sha256:'.length) }
    }),
    (asset) => asset.name,
  )
}

/** Verify a `gh release view --json isDraft,isPrerelease,assets` result against a local manifest. */
export function verifyRemoteRelease(release, expectedManifest, expectedState, comparison = 'exact', identity = {}) {
  if (expectedState !== 'draft' && expectedState !== 'published') {
    fail(`release state must be draft or published, got ${JSON.stringify(expectedState)}`)
  }
  if (comparison !== 'exact') fail(`release comparison must be exact, got ${JSON.stringify(comparison)}`)
  if (release == null || typeof release !== 'object' || Array.isArray(release)) {
    fail('remote release JSON must be an object')
  }
  if (typeof release.isDraft !== 'boolean') fail('remote release JSON must contain boolean isDraft')
  if (typeof release.isPrerelease !== 'boolean') fail('remote release JSON must contain boolean isPrerelease')
  if (release.isPrerelease !== false) fail('remote release must be explicitly non-prerelease')
  if (typeof identity.tag !== 'string' || identity.tag.length === 0) fail('expected release tag is required')
  if (!/^[0-9a-f]{40}$/i.test(identity.target)) fail('expected release target must be a full commit SHA')
  if (release.tagName !== identity.tag) {
    fail(
      `remote release tag mismatch: expected ${JSON.stringify(identity.tag)}, got ${JSON.stringify(release.tagName)}`,
    )
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

  const expectedManifestValue = validateExpectedManifest(expectedManifest)
  const expected = expectedManifestValue.assets
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

  const expectedByName = new Map(expected.map((asset) => [asset.name, asset]))
  for (const asset of actual) {
    const expectedAsset = expectedByName.get(asset.name)
    if (asset.size !== expectedAsset.size) {
      fail(`remote release asset size mismatch for ${asset.name}: expected ${expectedAsset.size}, got ${asset.size}`)
    }
    if (asset.sha256 !== expectedAsset.sha256) {
      fail(`remote release asset SHA-256 mismatch for ${asset.name}: expected ${expectedAsset.sha256}, got ${asset.sha256}`)
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

  if (command === 'assert-sha256-file') {
    if (args.length !== 1) fail('usage: release-assets.mjs assert-sha256-file <result-file>')
    requireSha256Text(await readFile(args[0], 'utf8'))
    return
  }

  if (command === 'assert-version') {
    if (args.length !== 4) {
      fail(
        'usage: release-assets.mjs assert-version <candidate-version> <tags-json-file> <releases-json-file> <expected-sha>',
      )
    }
    const [candidate, tagsFile, releasesFile, expectedTarget] = args
    const tags = parseJson(await readFile(tagsFile, 'utf8'), 'GitHub tags file')
    const releases = parseJson(await readFile(releasesFile, 'utf8'), 'GitHub releases file')
    const result = requireStableVersionAdvance(candidate, tags, releases, expectedTarget)
    console.log(
      result.kind === 'retry'
        ? `verified exact retry of stable v${candidate} at ${expectedTarget}`
        : `verified stable version advance to v${candidate}`,
    )
    return
  }

  if (command === 'collect') {
    if (args.length < 3 || args.length > 4) {
      fail(
        'usage: release-assets.mjs collect <expected-version> <expected-package-id> <expected-product-name> [squirrel-output-directory]',
      )
    }
    const result = await collectReleaseAssets(args[3] ?? 'dist/squirrel-windows', args[0], args[1], args[2])
    await emitGitHubOutputs(result)
    console.log(`validated ${result.manifest.assets.length} Squirrel release assets`)
    return
  }

  if (command === 'collect-local') {
    if (args.length !== 3) {
      fail('usage: release-assets.mjs collect-local <squirrel-output-directory> <package-json> <setup-result-file>')
    }
    const result = await collectReleaseAssets(args[0], await readReleaseIdentity(args[1]))
    if (/\r|\n/.test(result.setup)) fail('setup path must not contain CR or LF')
    await writeFile(args[2], result.setup, { encoding: 'utf8', flag: 'wx' })
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
      '   or: release-assets.mjs assert-sha256-file <result-file>\n' +
      '   or: release-assets.mjs assert-version <candidate-version> <tags-json-file> <releases-json-file> <expected-sha>\n' +
      '   or: release-assets.mjs collect <expected-version> <expected-package-id> <expected-product-name> [squirrel-output-directory]\n' +
      '   or: release-assets.mjs collect-local <squirrel-output-directory> <package-json> <setup-result-file>\n' +
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
