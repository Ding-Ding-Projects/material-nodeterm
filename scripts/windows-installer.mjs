#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'
import {
  collectReleaseAssets,
  nuspecMetadataElement,
  readReleaseIdentity as readAssetReleaseIdentity,
} from './release-assets.mjs'

const require = createRequire(import.meta.url)
// Keep Vitest/Vite and the production CLI on resedit's real CommonJS implementation.
const ResEdit = require('resedit')
const SCRIPT_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..')
const ICON_RELATIVE_PATH = 'build/icon.ico'
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]
const MAX_ICON_BYTES = 1024 * 1024
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024 * 1024
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const REPOSITORY_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

export const WINDOWS_RELEASE_IDENTITY = Object.freeze({
  packageId: 'node-terminal',
  productName: 'nodeterm',
  executableName: 'nodeterm.exe',
  executionStubName: 'nodeterm_ExecutionStub.exe',
  appUserModelId: 'com.squirrel.node-terminal.nodeterm',
})

export const SQUIRREL_SETUP_VENDOR_ICON_POLICY = Object.freeze([
  Object.freeze({
    id: 107,
    lang: 1033,
    frames: Object.freeze([
      Object.freeze({
        resourceId: 1,
        width: 32,
        height: 32,
        bitCount: 4,
        sha256: '324507bcd33928c54048fb142e9bb62bde80fa019dd00c4d3ca9ed1e06546f2e',
      }),
      Object.freeze({
        resourceId: 2,
        width: 32,
        height: 32,
        bitCount: 8,
        sha256: 'a134a35831460694ce4583e9faf788061ca7c2035436c1aba3c45128fe636153',
      }),
    ]),
  }),
  Object.freeze({
    id: 108,
    lang: 1033,
    frames: Object.freeze([
      Object.freeze({
        resourceId: 3,
        width: 32,
        height: 32,
        bitCount: 4,
        sha256: '324507bcd33928c54048fb142e9bb62bde80fa019dd00c4d3ca9ed1e06546f2e',
      }),
      Object.freeze({
        resourceId: 4,
        width: 32,
        height: 32,
        bitCount: 8,
        sha256: 'a134a35831460694ce4583e9faf788061ca7c2035436c1aba3c45128fe636153',
      }),
    ]),
  }),
])

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function digestFile(file, algorithm = 'sha256') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const details = await stat(file)
  return { bytes: details.size, digest: hash.digest('hex') }
}

function frameBytes(item) {
  if (Buffer.isBuffer(item.bytes)) return item.bytes
  const data = item.data ?? item
  if (data.isRaw()) return Buffer.from(data.bin)
  return Buffer.from(data.generate())
}

function normalizedFrame(item) {
  const data = item.data ?? item
  let width = item.width ?? data.width ?? data.bitmapInfo?.width
  let rawHeight = item.height ?? data.height ?? data.bitmapInfo?.height
  if (width === 0) width = 256
  if (rawHeight === 0) rawHeight = 256
  const height = rawHeight === width * 2 ? width : rawHeight
  const bitCount = item.bitCount || data.bitCount || data.bitmapInfo?.bitCount
  return {
    resourceId: Number(item.iconID ?? item.resourceId ?? 0),
    width,
    height,
    bitCount,
    bytes: frameBytes(item),
  }
}

function requireExpectedFrames(frames, description) {
  const normalized = frames.map(normalizedFrame).sort((left, right) => left.width - right.width)
  const sizes = normalized.map((frame) => frame.width)
  if (JSON.stringify(sizes) !== JSON.stringify(ICON_SIZES)) {
    fail(`${description} icon sizes must be exactly ${ICON_SIZES.join('/')}; got ${sizes.join('/')}`)
  }
  for (const frame of normalized) {
    if (frame.width !== frame.height) fail(`${description} ${frame.width}px icon is not square`)
    if (frame.bitCount !== 32) fail(`${description} ${frame.width}px icon must be 32-bit`)
    if (frame.bytes.length === 0) fail(`${description} ${frame.width}px icon frame is empty`)
  }
  return normalized
}

/** Parse the committed ICO and return the exact frame hashes required in packaged PEs. */
export function inspectIco(iconBytes) {
  let icon
  try {
    icon = ResEdit.Data.IconFile.from(iconBytes)
  } catch (error) {
    fail(`could not parse build/icon.ico: ${error instanceof Error ? error.message : String(error)}`)
  }
  return requireExpectedFrames(icon.icons, 'source ICO').map((frame) => ({
    width: frame.width,
    height: frame.height,
    bitCount: frame.bitCount,
    sha256: sha256(frame.bytes),
  }))
}

function peIconGroups(executableBytes, description) {
  let executable
  try {
    executable = ResEdit.NtExecutable.from(executableBytes, { ignoreCert: true })
  } catch (error) {
    fail(`${description} is not a readable Windows PE: ${error instanceof Error ? error.message : String(error)}`)
  }
  const resources = ResEdit.NtExecutableResource.from(executable)
  return ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries).map((group) => {
    const data = group.getIconItemsFromEntries(resources.entries)
    return {
      id: Number(group.id),
      lang: Number(group.lang),
      frames: data.map((frame, index) => normalizedFrame({ ...group.icons[index], data: frame })),
    }
  })
}

function requirePinnedVendorGroup(groups, policy, description) {
  const matching = groups.filter((group) => group.id === policy.id)
  if (matching.length !== 1) fail(`${description} must contain exactly one pinned Squirrel icon group ${policy.id}`)
  const group = matching[0]
  if (group.lang !== policy.lang) {
    fail(`${description} Squirrel icon group ${policy.id} language must be ${policy.lang}; got ${group.lang}`)
  }
  if (group.frames.length !== policy.frames.length) {
    fail(`${description} Squirrel icon group ${policy.id} frame count changed`)
  }
  const actual = group.frames
    .map((frame) => ({
      resourceId: frame.resourceId,
      width: frame.width,
      height: frame.height,
      bitCount: frame.bitCount,
      sha256: sha256(frame.bytes),
    }))
    .sort((left, right) => left.resourceId - right.resourceId)
  if (JSON.stringify(actual) !== JSON.stringify(policy.frames)) {
    fail(`${description} Squirrel icon group ${policy.id} does not match the pinned vendor resource inventory`)
  }
}

/**
 * Require branded group 1 byte-for-byte. App/stub PEs reject every extra group;
 * Setup permits only the pinned Squirrel vendor groups 107 and 108.
 */
export function inspectPeIconInventory(executableBytes, expectedIconBytes, description = 'executable', options = {}) {
  const kind = options.kind ?? 'application'
  if (kind !== 'application' && kind !== 'setup') fail(`unknown PE icon policy ${JSON.stringify(kind)}`)
  const expected = new Map(inspectIco(expectedIconBytes).map((frame) => [frame.width, frame.sha256]))
  const groups = peIconGroups(executableBytes, description)
  const allowedIds = kind === 'setup' ? new Set([1, 107, 108]) : new Set([1])
  const unexpected = groups.find((group) => !allowedIds.has(group.id))
  if (unexpected) fail(`${description} contains unexpected RT_GROUP_ICON resource ${unexpected.id}`)

  const primary = groups.filter((group) => group.id === 1)
  if (primary.length !== 1) fail(`${description} must contain exactly one branded RT_GROUP_ICON resource 1`)
  if (primary[0].lang !== 1033) {
    fail(`${description} branded RT_GROUP_ICON resource 1 language must be 1033; got ${primary[0].lang}`)
  }
  const frames = requireExpectedFrames(primary[0].frames, `${description} resource 1`)
  for (const frame of frames) {
    if (sha256(frame.bytes) !== expected.get(frame.width)) {
      fail(`${description} ${frame.width}px icon does not match build/icon.ico`)
    }
  }

  if (kind === 'setup') {
    for (const policy of SQUIRREL_SETUP_VENDOR_ICON_POLICY) {
      requirePinnedVendorGroup(groups, policy, description)
    }
  } else if (groups.length !== 1) {
    fail(`${description} contains an unexpected RT_GROUP_ICON resource`)
  }

  return {
    kind,
    primaryGroup: 1,
    primaryLanguage: primary[0].lang,
    frames: ICON_SIZES.length,
    auxiliaryGroups: groups.filter((group) => group.id !== 1).map((group) => group.id).sort((a, b) => a - b),
  }
}

function versionParts(value, description) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (!match) fail(`${description} must be a numeric three- or four-part version`)
  return match.slice(1).map((part) => Number(part ?? 0))
}

function fixedVersion(ms, ls) {
  return [(ms >>> 16) & 0xffff, ms & 0xffff, (ls >>> 16) & 0xffff, ls & 0xffff]
}

/** Require every PE version resource to carry exact nodeterm filename/product/version strings. */
export function inspectPeProductIdentity(executableBytes, expected, description = 'executable') {
  let executable
  try {
    executable = ResEdit.NtExecutable.from(executableBytes, { ignoreCert: true })
  } catch (error) {
    fail(`${description} is not a readable Windows PE: ${error instanceof Error ? error.message : String(error)}`)
  }
  const resources = ResEdit.NtExecutableResource.from(executable)
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  if (versions.length !== 1) fail(`${description} must contain exactly one version resource`)
  const version = versions[0]
  const releaseVersion = String(expected.version).split(/[+-]/, 1)[0]
  const expectedParts = versionParts(releaseVersion, 'package version')
  for (const [actual, label] of [
    [fixedVersion(version.fixedInfo.fileVersionMS, version.fixedInfo.fileVersionLS), 'fixed file version'],
    [fixedVersion(version.fixedInfo.productVersionMS, version.fixedInfo.productVersionLS), 'fixed product version'],
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(expectedParts)) {
      fail(`${description} ${label} does not match package version ${expected.version}`)
    }
  }
  const languages = version.getAllLanguagesForStringValues()
  if (languages.length !== 1) fail(`${description} must contain exactly one version-string language`)
  const values = version.getStringValues(languages[0])
  const exactStrings = {
    ProductName: expected.productName,
    FileDescription: expected.productName,
    OriginalFilename: expected.originalFilename,
    InternalName: expected.internalName,
  }
  for (const [key, wanted] of Object.entries(exactStrings)) {
    if (values[key] !== wanted) fail(`${description} ${key} must be ${JSON.stringify(wanted)}; got ${JSON.stringify(values[key])}`)
  }
  for (const key of ['FileVersion', 'ProductVersion']) {
    if (JSON.stringify(versionParts(values[key], `${description} ${key}`)) !== JSON.stringify(expectedParts)) {
      fail(`${description} ${key} does not match package version ${expected.version}`)
    }
  }
  return { ...exactStrings, version: expected.version, language: languages[0].lang }
}

/** Require the PE certificate table to be absent, matching the permanent unsigned policy. */
export function inspectUnsignedPe(executableBytes, description = 'executable') {
  if (executableBytes.length < 256 || executableBytes.readUInt16LE(0) !== 0x5a4d) {
    fail(`${description} is not a readable Windows PE`)
  }
  const peOffset = executableBytes.readUInt32LE(0x3c)
  if (peOffset + 24 > executableBytes.length || executableBytes.readUInt32LE(peOffset) !== 0x00004550) {
    fail(`${description} has an invalid PE header`)
  }
  const optional = peOffset + 24
  const magic = executableBytes.readUInt16LE(optional)
  const dataDirectory = magic === 0x10b ? optional + 96 : magic === 0x20b ? optional + 112 : -1
  if (dataDirectory < 0 || dataDirectory + 40 > executableBytes.length) {
    fail(`${description} has an unsupported PE optional header`)
  }
  const certificateOffset = executableBytes.readUInt32LE(dataDirectory + 32)
  const certificateSize = executableBytes.readUInt32LE(dataDirectory + 36)
  if (certificateOffset !== 0 || certificateSize !== 0) {
    fail(`${description} contains an Authenticode certificate despite the permanent unsigned policy`)
  }
  return { authenticode: 'NotSigned' }
}

export function parseGitHubRepository(value) {
  const candidate = String(value ?? '').trim()
  let repository = candidate
  const https = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?$/.exec(candidate)
  const ssh = /^(?:ssh:\/\/git@github\.com\/|git@github\.com:)([^/?#:]+)\/([^/?#]+?)(?:\.git)?$/.exec(candidate)
  if (https || ssh) repository = `${(https ?? ssh)[1]}/${(https ?? ssh)[2]}`
  const match = REPOSITORY_RE.exec(repository)
  if (!match || match[1] === '.' || match[2] === '.' || match[2].endsWith('.git')) {
    fail(`source repository must be an owner/name pair on github.com, got ${JSON.stringify(candidate)}`)
  }
  return `${match[1]}/${match[2]}`
}

export function immutableIconUrl(repository, sourceSha) {
  const parsedRepository = parseGitHubRepository(repository)
  if (!FULL_SHA_RE.test(sourceSha)) fail('source SHA must be a full lowercase 40-hex commit')
  return `https://raw.githubusercontent.com/${parsedRepository}/${sourceSha}/${ICON_RELATIVE_PATH}`
}

export function validateImmutableIconUrl(value, repository, sourceSha) {
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`installer icon URL is invalid: ${JSON.stringify(value)}`)
  }
  const expected = immutableIconUrl(repository, sourceSha)
  if (url.href !== expected || url.username || url.password || url.port || url.search || url.hash) {
    fail(`installer icon URL must be the exact immutable raw source URL ${expected}`)
  }
  return expected
}

function runGit(root, args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    fail(`git ${args.join(' ')} failed while deriving the installer icon source identity`)
  }
  return encoding ? result.stdout.trim() : Buffer.from(result.stdout)
}

export function requireCleanSourceStatus(status) {
  if (typeof status !== 'string') fail('git source status must be text')
  if (status.trim() !== '') fail('refusing to package a dirty source tree; commit every tracked and untracked source first')
}

export function resolveSourceIdentity(root = REPO_ROOT, env = process.env) {
  requireCleanSourceStatus(runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']))
  const sourceSha = runGit(root, ['rev-parse', '--verify', 'HEAD'])
  if (!FULL_SHA_RE.test(sourceSha)) fail(`git HEAD is not a full lowercase commit SHA: ${sourceSha}`)
  if (env.GITHUB_SHA && env.GITHUB_SHA !== sourceSha) {
    fail(`GITHUB_SHA does not match checked-out HEAD: expected ${sourceSha}, got ${env.GITHUB_SHA}`)
  }
  const origin = env.GITHUB_REPOSITORY || runGit(root, ['config', '--get', 'remote.origin.url'])
  return { sourceSha, repository: parseGitHubRepository(origin) }
}

export async function downloadMatchingIcon(iconUrl, expected, fetchImpl = fetch) {
  let response
  try {
    response = await fetchImpl(iconUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'image/x-icon,application/octet-stream' },
    })
  } catch (error) {
    fail(`could not download immutable installer icon: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status !== 200 || response.url !== iconUrl) {
    fail(`immutable installer icon download must return 200 without redirect; got ${response.status}`)
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_ICON_BYTES) fail('downloaded installer icon is too large')
  const downloaded = Buffer.from(await response.arrayBuffer())
  if (downloaded.length === 0 || downloaded.length > MAX_ICON_BYTES) fail('downloaded installer icon has an invalid byte size')
  if (!downloaded.equals(expected)) fail('downloaded installer icon bytes do not match the committed build/icon.ico')
  inspectIco(downloaded)
  return downloaded
}

/** Prove the generated ICO is committed at HEAD and downloadable through its immutable URL. */
export async function verifySourceIcon(root = REPO_ROOT, options = {}) {
  const { fetchImpl = fetch, env = process.env } = options
  const identity = resolveSourceIdentity(root, env)
  const iconPath = path.join(root, ...ICON_RELATIVE_PATH.split('/'))
  const local = await readFile(iconPath)
  if (local.length === 0 || local.length > MAX_ICON_BYTES) fail('build/icon.ico has an invalid byte size')
  const committed = runGit(root, ['show', `${identity.sourceSha}:${ICON_RELATIVE_PATH}`], null)
  if (!local.equals(committed)) fail('generated build/icon.ico does not exactly match the icon committed at HEAD')
  const frames = inspectIco(local)
  const iconUrl = immutableIconUrl(identity.repository, identity.sourceSha)
  await downloadMatchingIcon(iconUrl, local, fetchImpl)
  return {
    schemaVersion: 1,
    sourceSha: identity.sourceSha,
    repository: identity.repository,
    iconUrl,
    sha256: sha256(local),
    frames: frames.map((frame) => frame.width),
  }
}

export function validateIconMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Windows icon metadata must be an object')
  const { schemaVersion, sourceSha, repository, iconUrl, sha256: digest, frames } = value
  if (schemaVersion !== 1) fail('Windows icon metadata schemaVersion must be 1')
  const parsedRepository = parseGitHubRepository(repository)
  validateImmutableIconUrl(iconUrl, parsedRepository, sourceSha)
  if (!/^[0-9a-f]{64}$/.test(digest)) fail('Windows icon metadata SHA-256 must be lowercase 64-hex')
  if (JSON.stringify(frames) !== JSON.stringify(ICON_SIZES)) fail('Windows icon metadata frame inventory is invalid')
  return { schemaVersion, sourceSha, repository: parsedRepository, iconUrl, sha256: digest, frames }
}

async function writeMetadataAtomic(file, metadata) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, file)
}

export async function readReleaseIdentity(packageJsonFile) {
  const assetIdentity = await readAssetReleaseIdentity(packageJsonFile)
  let value
  try {
    value = JSON.parse(await readFile(packageJsonFile, 'utf8'))
  } catch (error) {
    fail(`could not read Windows package configuration: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (assetIdentity.packageId !== WINDOWS_RELEASE_IDENTITY.packageId) {
    fail(`package.json name must remain ${WINDOWS_RELEASE_IDENTITY.packageId}`)
  }
  if (assetIdentity.productName !== WINDOWS_RELEASE_IDENTITY.productName) {
    fail(`package.json build.productName must remain ${WINDOWS_RELEASE_IDENTITY.productName}`)
  }
  if (value?.scripts?.['dist:win'] !== 'node scripts/windows-installer.mjs build') {
    fail('package.json scripts.dist:win must use the guarded Windows installer wrapper')
  }
  if (value?.build?.appId !== 'com.nodeterm.app') {
    fail('package.json build.appId must remain com.nodeterm.app (separate from the Squirrel AppUserModelID)')
  }
  if (value?.build?.win?.icon !== ICON_RELATIVE_PATH) {
    fail(`package.json build.win.icon must remain ${ICON_RELATIVE_PATH}`)
  }
  if (
    value?.build?.win?.signExecutable !== false ||
    value?.build?.win?.forceCodeSigning !== false ||
    value?.build?.forceCodeSigning !== false
  ) {
    fail('Windows packaging must keep signExecutable:false and both forceCodeSigning flags false')
  }
  if (value?.build?.win && Object.hasOwn(value.build.win, 'signAndEditExecutable')) {
    fail('build.win.signAndEditExecutable must be omitted so icon and PE metadata editing stay enabled')
  }
  if (value?.build?.afterSign !== './scripts/windows-pe-identity.mjs') {
    fail('build.afterSign must preserve the Windows OriginalFilename identity hook')
  }
  if (value?.build?.squirrelWindows?.artifactName !== '${productName}-Setup-${version}.${ext}') {
    fail('Squirrel Setup artifactName must remain ${productName}-Setup-${version}.${ext}')
  }
  if (value?.build?.squirrelWindows && Object.hasOwn(value.build.squirrelWindows, 'iconUrl')) {
    fail('squirrelWindows.iconUrl must be supplied only by the source-SHA-locked build wrapper')
  }
  return { ...WINDOWS_RELEASE_IDENTITY, version: assetIdentity.version }
}

async function entryBuffer(entry, description, maxBytes = MAX_ARCHIVE_ENTRY_BYTES) {
  if (entry.uncompressedSize > maxBytes) fail(`${description} is too large to inspect safely`)
  const value = await entry.buffer()
  if (value.length === 0 || value.length > maxBytes) fail(`${description} has an invalid byte size`)
  return value
}

async function inspectFullPackage(file, expectedUrl, expectedIconBytes, expectedIdentity) {
  const archive = await unzipper.Open.file(file)
  const unsafe = archive.files.filter((entry) => {
    const normalized = entry.path.replaceAll('\\', '/')
    return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')
  })
  if (unsafe.length > 0) fail(`${path.basename(file)} contains an unsafe archive path: ${unsafe[0].path}`)
  const files = archive.files.filter((entry) => entry.type === 'File')
  const nuspecs = files.filter((entry) => /(^|\/)\.?[^/]+\.nuspec$/i.test(entry.path))
  if (nuspecs.length !== 1) fail(`${path.basename(file)} must contain exactly one .nuspec`)
  const nuspec = (await entryBuffer(nuspecs[0], `${path.basename(file)} nuspec`, 1024 * 1024)).toString('utf8')
  const expectedNuspec = {
    id: expectedIdentity.packageId,
    version: expectedIdentity.version,
    title: expectedIdentity.productName,
    iconUrl: expectedUrl,
  }
  for (const [name, expected] of Object.entries(expectedNuspec)) {
    if (nuspecMetadataElement(nuspec, name, `${path.basename(file)} nuspec`) !== expected) {
      fail(`${path.basename(file)} nuspec ${name} does not match ${expected}`)
    }
  }

  const normalized = files.map((entry) => ({ entry, name: entry.path.replaceAll('\\', '/') }))
  const expectedApp = `lib/net45/${expectedIdentity.executableName}`.toLowerCase()
  const expectedStub = `lib/net45/${expectedIdentity.executionStubName}`.toLowerCase()
  const app = normalized.filter(({ name }) => name.toLowerCase() === expectedApp)
  const stub = normalized.filter(({ name }) => name.toLowerCase() === expectedStub)
  if (app.length !== 1 || stub.length !== 1) {
    fail(`${path.basename(file)} must contain one ${expectedIdentity.executableName} and one ${expectedIdentity.executionStubName}`)
  }
  const appBytes = await entryBuffer(app[0].entry, `packaged ${expectedIdentity.executableName}`)
  const stubBytes = await entryBuffer(stub[0].entry, `packaged ${expectedIdentity.executionStubName}`)
  const appResourceIdentity = {
    ...expectedIdentity,
    originalFilename: expectedIdentity.executableName,
    internalName: path.parse(expectedIdentity.executableName).name,
  }
  for (const [bytes, description] of [
    [appBytes, `packaged ${expectedIdentity.executableName}`],
    [stubBytes, `packaged ${expectedIdentity.executionStubName}`],
  ]) {
    inspectPeIconInventory(bytes, expectedIconBytes, description)
    inspectPeProductIdentity(bytes, appResourceIdentity, description)
    inspectUnsignedPe(bytes, description)
  }
  return {
    app: { bytes: appBytes.length, sha256: sha256(appBytes) },
    stub: { bytes: stubBytes.length, sha256: sha256(stubBytes) },
  }
}

/** Validate the Setup/app/stub PE identity, immutable icon URL, and unsigned policy together. */
export async function assertPackagedIconContract(directory, metadataFile, root = REPO_ROOT, options = {}) {
  const metadata = validateIconMetadata(JSON.parse(await readFile(metadataFile, 'utf8')))
  const currentIdentity = options.sourceIdentity ?? resolveSourceIdentity(root)
  if (metadata.sourceSha !== currentIdentity.sourceSha || metadata.repository !== currentIdentity.repository) {
    fail('Windows icon metadata source identity does not match the checked-out source')
  }
  const releaseIdentity = await readReleaseIdentity(path.join(root, 'package.json'))
  const icon = await readFile(path.join(root, ...ICON_RELATIVE_PATH.split('/')))
  if (sha256(icon) !== metadata.sha256) fail('packaged icon metadata does not match build/icon.ico')
  inspectIco(icon)
  const collected = await collectReleaseAssets(
    directory,
    releaseIdentity.version,
    releaseIdentity.packageId,
    releaseIdentity.productName,
  )
  const fullPackages = collected.packages.filter((file) => /-full\.nupkg$/i.test(file))
  if (fullPackages.length !== 1) {
    fail(`expected exactly one full nupkg for PE identity inspection, found ${fullPackages.length}`)
  }
  const assets = {
    setup: collected.setup,
    full: fullPackages[0],
    releases: collected.releases,
    packages: collected.packages,
  }
  const setupBytes = await readFile(assets.setup)
  inspectPeIconInventory(setupBytes, icon, 'Squirrel Setup executable', { kind: 'setup' })
  inspectPeProductIdentity(
    setupBytes,
    { ...releaseIdentity, originalFilename: 'Setup.exe', internalName: 'Setup.exe' },
    'Squirrel Setup executable',
  )
  inspectUnsignedPe(setupBytes, 'Squirrel Setup executable')
  const packaged = await inspectFullPackage(assets.full, metadata.iconUrl, icon, releaseIdentity)
  const unpackedDirectory = path.join(root, 'dist', 'win-unpacked')
  for (const [fileName, expected] of [
    [releaseIdentity.executableName, packaged.app],
    [releaseIdentity.executionStubName, packaged.stub],
  ]) {
    const actual = await digestFile(path.join(unpackedDirectory, fileName), 'sha256')
    if (actual.bytes !== expected.bytes || actual.digest !== expected.sha256) {
      fail(`dist/win-unpacked/${fileName} does not exactly match the inspected full package`)
    }
  }
  return { ...assets, iconUrl: metadata.iconUrl, identity: releaseIdentity }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true,
    env: options.env ?? process.env,
  })
  if (result.error) fail(`${options.description ?? command} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    const error = new Error(`${options.description ?? command} exited with code ${result.status}`)
    error.exitCode = result.status ?? 1
    throw error
  }
}

/** Remove only the fixed generated trees whose stale contents could enter this package. */
export async function cleanWindowsPackageOutputs(root = REPO_ROOT) {
  const resolvedRoot = path.resolve(root)
  const targets = [
    path.join(resolvedRoot, 'dist', 'squirrel-windows'),
    path.join(resolvedRoot, 'dist', 'win-unpacked'),
    path.join(resolvedRoot, 'out'),
    path.join(resolvedRoot, 'dist', 'windows-icon-contract.json'),
  ]
  for (const target of targets) {
    const relative = path.relative(resolvedRoot, target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`unsafe Windows package cleanup target ${target}`)
    await rm(target, { recursive: true, force: true })
  }
  return targets
}

async function buildWindowsInstaller() {
  if (process.platform !== 'win32') fail('the Windows installer build must run on Windows')
  const metadataFile = path.join(REPO_ROOT, 'dist', 'windows-icon-contract.json')
  const squirrelOutput = path.join(REPO_ROOT, 'dist', 'squirrel-windows')
  await cleanWindowsPackageOutputs(REPO_ROOT)
  run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'check-build-preflight.mjs')], { description: 'build preflight' })
  run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'make-icon.mjs')], { description: 'icon generation' })
  const metadata = await verifySourceIcon(REPO_ROOT)
  await writeMetadataAtomic(metadataFile, metadata)
  const npmCli = process.env.npm_execpath
  if (!npmCli) fail('npm_execpath is required; invoke the Windows installer through npm run dist:win')
  run(process.execPath, [npmCli, 'run', 'build'], { description: 'application build' })
  const builderCli = require.resolve('electron-builder/cli.js')
  run(
    process.execPath,
    [
      builderCli,
      '--win',
      'squirrel',
      '--x64',
      '--publish',
      'never',
      `--config.squirrelWindows.iconUrl=${metadata.iconUrl}`,
    ],
    {
      description: 'electron-builder Squirrel packaging',
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    },
  )
  await assertPackagedIconContract(squirrelOutput, metadataFile)
}

async function main(argv) {
  const [command, ...args] = argv
  if (command === 'build' && args.length === 0) {
    await buildWindowsInstaller()
    return
  }
  if (command === 'verify-source' && args.length <= 1) {
    const result = await verifySourceIcon(args[0] ? path.resolve(args[0]) : REPO_ROOT)
    console.log(JSON.stringify(result))
    return
  }
  if (command === 'assert-package' && args.length === 2) {
    const result = await assertPackagedIconContract(path.resolve(args[0]), path.resolve(args[1]))
    console.log(`verified unsigned packaged PE identity and immutable iconUrl ${result.iconUrl}`)
    return
  }
  fail(
    'usage: windows-installer.mjs build\n' +
      '   or: windows-installer.mjs verify-source [repository-root]\n' +
      '   or: windows-installer.mjs assert-package <squirrel-output-directory> <metadata-file>',
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`windows-installer: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
  })
}
