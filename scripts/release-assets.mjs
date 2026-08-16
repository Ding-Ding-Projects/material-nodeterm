#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sax from 'sax'
import unzipper from 'unzipper'

const NUPKG_RE = /\.nupkg$/i
const RELEASE_LINE_RE = /^([0-9a-f]{40})\s+(\S+)\s+(\d+)$/i
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

export function requireSha256Text(text) {
  if (!/^[0-9a-f]{64}$/i.test(text)) {
    fail('SHA-256 result must contain exactly 64 hexadecimal characters and nothing else')
  }
  return text.toLowerCase()
}

function sorted(items, select = (item) => item) {
  return [...items].sort((left, right) => {
    const a = select(left)
    const b = select(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
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
  const packageId = value?.name
  const version = value?.version
  const productName = value?.build?.productName
  if (typeof packageId !== 'string' || !PACKAGE_ID_RE.test(packageId)) {
    fail(`package.json name is not a safe Squirrel package ID: ${JSON.stringify(packageId)}`)
  }
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    fail(`package.json version is not an exact semantic version: ${JSON.stringify(version)}`)
  }
  if (!safeProductName(productName)) {
    fail(`package.json build.productName is not a safe Windows product name: ${JSON.stringify(productName)}`)
  }
  return { packageId, version, productName }
}

function requireReleaseIdentity(identity) {
  if (!identity || typeof identity !== 'object') fail('expected release identity is required')
  const { packageId, version, productName } = identity
  if (typeof packageId !== 'string' || !PACKAGE_ID_RE.test(packageId)) fail('expected package ID is invalid')
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) fail('expected package version is invalid')
  if (!safeProductName(productName)) fail('expected product name is invalid')
  return { packageId, version, productName }
}

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

async function inspectPackageIdentity(file, expected) {
  let archive
  try {
    archive = await unzipper.Open.file(file)
  } catch (error) {
    fail(`could not open ${path.basename(file)} as a nupkg: ${error instanceof Error ? error.message : String(error)}`)
  }
  const unsafe = archive.files.filter((entry) => {
    const normalized = entry.path.replaceAll('\\', '/')
    return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')
  })
  if (unsafe.length > 0) fail(`${path.basename(file)} contains an unsafe archive path: ${unsafe[0].path}`)
  const nuspecs = archive.files.filter((entry) => entry.type === 'File' && /(^|\/)[^/]+\.nuspec$/i.test(entry.path.replaceAll('\\', '/')))
  if (nuspecs.length !== 1) fail(`${path.basename(file)} must contain exactly one .nuspec`)
  if (path.posix.basename(nuspecs[0].path.replaceAll('\\', '/')) !== `${expected.packageId}.nuspec`) {
    fail(`${path.basename(file)} nuspec filename must be exactly ${expected.packageId}.nuspec`)
  }
  const description = `${path.basename(file)} nuspec`
  const text = (await entryBuffer(nuspecs[0], description)).toString('utf8')
  const actual = {
    packageId: nuspecMetadataElement(text, 'id', description),
    version: nuspecMetadataElement(text, 'version', description),
    productName: nuspecMetadataElement(text, 'title', description),
  }
  for (const key of ['packageId', 'version', 'productName']) {
    if (actual[key] !== expected[key]) {
      fail(`${description} ${key} mismatch: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`)
    }
  }
  return actual
}

/** Parse and validate the Squirrel.Windows RELEASES file. */
export function parseReleases(text) {
  if (typeof text !== 'string') fail('RELEASES content must be text')
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
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
    if (!NUPKG_RE.test(name)) fail(`RELEASES line ${index + 1} does not reference a .nupkg: ${name}`)
    const folded = name.toLowerCase()
    if (names.has(folded)) fail(`RELEASES contains duplicate package entry: ${name}`)
    names.add(folded)
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

/** Collect and validate the complete, exact Squirrel.Windows release asset set. */
export async function collectReleaseAssets(directory, expectedIdentity) {
  const expected = requireReleaseIdentity(expectedIdentity)
  const root = path.resolve(directory)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    fail(`could not read Squirrel output directory ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const expectedSetupName = `${expected.productName}-Setup-${expected.version}.exe`
  const setupEntries = entries.filter((entry) => entry.name === expectedSetupName)
  if (setupEntries.length !== 1) fail(`expected exactly one ${expectedSetupName}, found ${setupEntries.length}`)
  const releaseEntries = entries.filter((entry) => entry.name === 'RELEASES')
  if (releaseEntries.length !== 1) fail(`expected exactly one RELEASES file, found ${releaseEntries.length}`)
  const packageEntries = sorted(entries.filter((entry) => NUPKG_RE.test(entry.name)), (entry) => entry.name)
  const fullName = `${expected.packageId}-${expected.version}-full.nupkg`
  const deltaName = `${expected.packageId}-${expected.version}-delta.nupkg`
  if (!packageEntries.some((entry) => entry.name === fullName)) fail(`expected exactly one ${fullName}`)
  const unexpectedPackages = packageEntries.filter((entry) => entry.name !== fullName && entry.name !== deltaName)
  if (unexpectedPackages.length > 0) fail(`unexpected package identity/version: ${unexpectedPackages.map((entry) => entry.name).join(', ')}`)

  const allowedNames = new Set([
    setupEntries[0].name,
    'RELEASES',
    ...packageEntries.map((entry) => entry.name),
  ])
  const unexpected = sorted(entries.filter((entry) => !allowedNames.has(entry.name)), (entry) => entry.name)
  if (unexpected.length > 0) {
    fail(`unexpected Squirrel output entr${unexpected.length === 1 ? 'y' : 'ies'}: ${unexpected.map((entry) => entry.name).join(', ')}`)
  }

  const setup = await regularFile(root, setupEntries[0])
  const releases = await regularFile(root, releaseEntries[0])
  const packages = []
  for (const entry of packageEntries) {
    const asset = await regularFile(root, entry)
    await inspectPackageIdentity(asset.path, expected)
    packages.push(asset)
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

  const assets = sorted([setup, releases, ...packages], (asset) => asset.name)
  return {
    paths: assets.map((asset) => asset.path),
    setup: setup.path,
    releases: releases.path,
    packages: packages.map((asset) => asset.path),
    identity: expected,
    manifest: { identity: expected, assets: assets.map(({ name, size }) => ({ name, size })) },
  }
}

async function emitGitHubOutputs(result) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) fail('GITHUB_OUTPUT is required for collect')
  if (result.paths.some((item) => /[\r\n]/.test(item)) || /[\r\n]/.test(result.setup)) {
    fail('release asset paths must not contain CR or LF')
  }
  const delimiter = `RELEASE_ASSETS_${randomUUID().replaceAll('-', '')}`
  await appendFile(outputFile, [
    `paths<<${delimiter}`,
    ...result.paths,
    delimiter,
    `setup=${result.setup}`,
    `manifest=${JSON.stringify(result.manifest)}`,
    '',
  ].join('\n'), 'utf8')
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
  if (command === 'collect') {
    if (args.length !== 2) fail('usage: release-assets.mjs collect <squirrel-output-directory> <package-json>')
    const result = await collectReleaseAssets(args[0], await readReleaseIdentity(args[1]))
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
  fail(
    'usage: release-assets.mjs assert-unsigned <Authenticode-status>\n' +
      '   or: release-assets.mjs assert-sha256-file <result-file>\n' +
      '   or: release-assets.mjs collect <squirrel-output-directory> <package-json>\n' +
      '   or: release-assets.mjs collect-local <squirrel-output-directory> <package-json> <setup-result-file>',
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release-assets: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
