#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createReadStream, readFileSync, writeSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'
import {
  nuspecMetadataElement,
  parseReleases,
  readReleaseIdentity as readAssetReleaseIdentity,
} from './release-assets.mjs'
import { renameAtomic } from './lib/rename-atomic.mjs'

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
const IMMUTABLE_ICON_PATH_RE = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[0-9a-f]{40}\/build\/icon[.]ico$/

export const APPLICATION_BUILD_MAX_ATTEMPTS = 2
export const APPLICATION_BUILD_RETRY_DELAY_MS = 1000
export const APPLICATION_BUILD_TRANSIENT_EXIT_CODE = 0xc0000409

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

function writeDiagnostic(stream, message) {
  try {
    writeSync(stream, `${message}\n`)
  } catch {
    // The original failure remains authoritative when the diagnostic stream itself is unavailable.
  }
}

async function runStage(description, operation) {
  writeDiagnostic(1, `windows-installer: ${description} started`)
  try {
    const result = await operation()
    writeDiagnostic(1, `windows-installer: ${description} completed`)
    return result
  } catch (error) {
    writeDiagnostic(2, `windows-installer: ${description} failed: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
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

/** Paths the release version bump is allowed to touch — and nothing else. See below. */
const VERSION_BUMP_PATHS = new Set(['package.json', 'package-lock.json'])

/**
 * The paths `git status --porcelain=v1` reports as changed, or null when the tree is clean.
 *
 * Parses the porcelain v1 shape rather than eyeballing the text: an entry is `XY <path>`, and a
 * rename is `XY <old> -> <new>`, where the NEW path is the one that matters here.
 */
export function changedSourcePaths(status) {
  if (typeof status !== 'string') fail('git source status must be text')
  const lines = status.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
  if (!lines.length) return null
  return lines.map((line) => {
    // Matched, NOT `slice(3)`. Porcelain's status field is two columns and the first may be a
    // SPACE (` M path` = modified, not staged) — and the caller hands us output that has already
    // been through `.trim()`, which eats that leading space on the first line only. A fixed
    // offset therefore ate the first character of the path and produced `ackage-lock.json`,
    // which matched nothing in the allowlist and failed a release with a baffling message.
    // The old clean-check never noticed because it only asked whether the text was empty.
    const match = /^[ MADRCU?!]{1,2}\s+(.*)$/.exec(line)
    const raw = match ? match[1] : line
    const renamed = raw.split(' -> ')
    return (renamed.length > 1 ? renamed[renamed.length - 1] : raw).replace(/^"|"$/g, '')
  })
}

/**
 * True when two package manifests differ ONLY in `version`.
 *
 * The release workflow computes the version itself and writes it to the WORKING TREE without
 * committing (committing would be a push to main, which would retrigger the release — see the
 * header of .github/workflows/release.yml). That leaves package.json and package-lock.json dirty,
 * and this script used to refuse outright, which is what failed the first automatic release.
 *
 * A blanket path exemption would be wrong, though: package.json also holds the entire
 * electron-builder `build` block, so "package.json is dirty, never mind" would wave through a
 * changed appId, target list, or signing flag on a build claiming the provenance of a public
 * commit. Comparing everything EXCEPT `version` is what makes the exemption honest.
 */
export function isVersionOnlyManifestChange(committedText, workingText) {
  let committed
  let working
  try {
    committed = JSON.parse(committedText)
    working = JSON.parse(workingText)
  } catch {
    // Unparsable is not evidence of "only the version changed" — refuse rather than assume.
    return false
  }
  if (committed === null || working === null || typeof committed !== 'object' || typeof working !== 'object') {
    return false
  }
  // package-lock.json carries the version TWICE — once at the root and once as the root package's
  // own entry (`packages[""]`, lockfile v2/v3) — and `npm version` updates both. Neutralising only
  // the top-level one would read the second as an unrelated change and refuse the very bump this
  // exemption exists for.
  const strip = (value) => {
    const root = value.packages?.['']
    return JSON.stringify({
      ...value,
      version: null,
      ...(root && typeof root === 'object' ? { packages: { ...value.packages, '': { ...root, version: null } } } : {}),
    })
  }
  return strip(committed) === strip(working)
}

const NON_PACKAGED_GITLINKS = new Set(['upstream/nodeterm'])

export function requireCleanSourceStatus(status, readPair) {
  const changed = changedSourcePaths(status)
  if (changed === null) return
  // The nested canonical source is a preserved submodule used for comparison and upstream review,
  // not a package input. Its own Git worktree can stay active while this repository is packaged;
  // every product path and every untracked path remains subject to the strict dirty-tree refusal.
  const packagedChanged = changed.filter((path) => !NON_PACKAGED_GITLINKS.has(path))
  const unexpected = packagedChanged.filter((path) => !VERSION_BUMP_PATHS.has(path))
  if (unexpected.length || typeof readPair !== 'function') {
    // NAME the offending paths. Without them this refusal is unactionable on a runner whose
    // working tree you cannot inspect: it cost a whole release cycle to learn only that
    // *something* was dirty, on a build where the release version bump legitimately dirties two
    // known files and the interesting question is which OTHER file joined them.
    const offenders = unexpected.length ? unexpected : packagedChanged
    fail(
      `refusing to package a dirty source tree; commit every tracked and untracked source first (dirty: ${offenders.join(', ')})`,
    )
  }
  for (const path of packagedChanged) {
    const { committed, working } = readPair(path)
    if (!isVersionOnlyManifestChange(committed, working)) {
      fail(`refusing to package: ${path} differs from HEAD by more than its version`)
    }
  }
}

export function resolveSourceIdentity(root = REPO_ROOT, env = process.env) {
  requireCleanSourceStatus(
    runGit(root, ['status', '--porcelain=v1', '--untracked-files=all']),
    (relative) => ({
      committed: runGit(root, ['show', `HEAD:${relative}`]),
      working: readFileSync(path.join(root, relative), 'utf8'),
    }),
  )
  const sourceSha = runGit(root, ['rev-parse', '--verify', 'HEAD'])
  if (!FULL_SHA_RE.test(sourceSha)) fail(`git HEAD is not a full lowercase commit SHA: ${sourceSha}`)
  if (env.GITHUB_SHA && env.GITHUB_SHA !== sourceSha) {
    fail(`GITHUB_SHA does not match checked-out HEAD: expected ${sourceSha}, got ${env.GITHUB_SHA}`)
  }
  const origin = env.GITHUB_REPOSITORY || runGit(root, ['config', '--get', 'remote.origin.url'])
  return { sourceSha, repository: parseGitHubRepository(origin) }
}

export async function downloadMatchingIcon(iconUrl, expected, fetchImpl) {
  validateImmutableIconDownloadUrl(iconUrl)
  if (!fetchImpl) return downloadMatchingIconOverHttps(iconUrl, expected)
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

function validateImmutableIconDownloadUrl(iconUrl) {
  let url
  try {
    url = new URL(iconUrl)
  } catch {
    fail(`immutable installer icon URL is invalid: ${JSON.stringify(iconUrl)}`)
  }
  if (
    url.href !== iconUrl ||
    url.protocol !== 'https:' ||
    url.hostname !== 'raw.githubusercontent.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !IMMUTABLE_ICON_PATH_RE.test(url.pathname)
  ) {
    fail(`immutable installer icon download must use the exact HTTPS raw source URL: ${JSON.stringify(iconUrl)}`)
  }
  return url
}

function downloadMatchingIconOverHttps(iconUrl, expected) {
  const url = validateImmutableIconDownloadUrl(iconUrl)
  return new Promise((resolve, reject) => {
    let settled = false
    let request
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (error) reject(error)
      else resolve(value)
    }
    const deadline = setTimeout(() => {
      const error = new Error('immutable installer icon download timed out after 15000ms')
      finish(error)
      if (request && !request.destroyed) request.destroy(error)
    }, 15_000)
    try {
      request = httpsRequest(url, {
      method: 'GET',
      headers: { accept: 'image/x-icon,application/octet-stream' },
      }, (response) => {
      const status = response.statusCode ?? 0
      if (status !== 200) {
        response.destroy()
        finish(new Error(`immutable installer icon download must return 200 without redirect; got ${status}`))
        return
      }
      const declaredLength = response.headers['content-length']
      let expectedLength = null
      if (declaredLength !== undefined) {
        if (typeof declaredLength !== 'string') {
          response.destroy()
          finish(new Error('immutable installer icon content-length is invalid'))
          return
        }
        const parsed = Number(declaredLength)
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          response.destroy()
          finish(new Error('immutable installer icon content-length is invalid'))
          return
        }
        expectedLength = parsed
        if (parsed > MAX_ICON_BYTES) {
          response.destroy()
          finish(new Error('downloaded installer icon is too large'))
          return
        }
      }
      const chunks = []
      let total = 0
      response.on('data', (chunk) => {
        if (settled) return
        total += chunk.length
        if (total > MAX_ICON_BYTES) {
          response.destroy()
          finish(new Error('downloaded installer icon exceeded the byte bound'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (expectedLength !== null && total !== expectedLength) {
          finish(new Error(`downloaded installer icon length mismatch: declared ${expectedLength}, received ${total}`))
          return
        }
        const downloaded = Buffer.concat(chunks, total)
        if (downloaded.length === 0) {
          finish(new Error('downloaded installer icon has an invalid byte size'))
          return
        }
        if (!downloaded.equals(expected)) {
          finish(new Error('downloaded installer icon bytes do not match the committed build/icon.ico'))
          return
        }
        try {
          inspectIco(downloaded)
          finish(null, downloaded)
        } catch (error) {
          finish(error)
        }
      })
      response.on('error', (error) => finish(new Error(`immutable installer icon response failed: ${error.message}`)))
      response.on('aborted', () => finish(new Error('immutable installer icon response was aborted before completion')))
      })
    } catch (error) {
      finish(new Error(`immutable installer icon request could not start: ${error.message}`))
      return
    }
    request.setTimeout(15_000, () => {
      const error = new Error('immutable installer icon socket timed out after 15000ms')
      finish(error)
      if (!request.destroyed) request.destroy(error)
    })
    request.on('error', (error) => finish(new Error(`immutable installer icon request failed: ${error.message}`)))
    request.end()
  })
}

/**
 * Prove the generated ICO is committed at HEAD and bind it to an immutable source URL.
 *
 * A local installer build can legitimately precede a dew, so its exact HEAD does not yet exist
 * at raw.githubusercontent.com. It still proves the generated bytes equal the committed blob and
 * injects the full-SHA immutable URL. Release packaging passes requirePublishedSourceIcon so the
 * public publication route additionally proves that URL returns those exact bytes without a
 * redirect. This keeps local developer builds useful without allowing a release to publish an
 * icon URL nobody can retrieve.
 */
export async function verifySourceIcon(root = REPO_ROOT, options = {}) {
  const { fetchImpl, env = process.env, sourceIdentity, requirePublishedSourceIcon = false } = options
  const identity = sourceIdentity
    ? validateSourceIdentity(sourceIdentity)
    : await runStage('source identity resolution', () => resolveSourceIdentity(root, env))
  const iconPath = path.join(root, ...ICON_RELATIVE_PATH.split('/'))
  const local = await runStage('read generated source icon', () => readFile(iconPath))
  if (local.length === 0 || local.length > MAX_ICON_BYTES) fail('build/icon.ico has an invalid byte size')
  const committed = await runStage('read committed source icon', () => runGit(root, ['show', `${identity.sourceSha}:${ICON_RELATIVE_PATH}`], null))
  await runStage('compare generated and committed source icon', () => {
    if (!local.equals(committed)) fail('generated build/icon.ico does not exactly match the icon committed at HEAD')
  })
  const frames = await runStage('parse committed source icon', () => inspectIco(local))
  const iconUrl = immutableIconUrl(identity.repository, identity.sourceSha)
  if (requirePublishedSourceIcon) {
    await runStage('download immutable source icon', () => downloadMatchingIcon(iconUrl, local, fetchImpl))
  }
  return {
    schemaVersion: 1,
    sourceSha: identity.sourceSha,
    repository: identity.repository,
    iconUrl,
    sha256: sha256(local),
    frames: frames.map((frame) => frame.width),
  }
}

function validateSourceIdentity(identity) {
  if (!identity || typeof identity !== 'object' || !FULL_SHA_RE.test(identity.sourceSha)) {
    fail('validated installer source identity has an invalid commit SHA')
  }
  return { sourceSha: identity.sourceSha, repository: parseGitHubRepository(identity.repository) }
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

/**
 * The build records this identity before it materializes verified bundled resources. Standalone
 * post-build validation must reuse that evidence rather than treating those resources as source.
 */
export function sourceIdentityFromIconMetadata(value) {
  const metadata = validateIconMetadata(value)
  return validateSourceIdentity({ sourceSha: metadata.sourceSha, repository: metadata.repository })
}

async function writeMetadataAtomic(file, metadata) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await renameAtomic(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
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

async function regularReleaseAsset(root, entry) {
  if (!entry.isFile()) fail(`release asset must be a regular file: ${entry.name}`)
  const file = path.resolve(root, entry.name)
  const details = await stat(file)
  if (!details.isFile()) fail(`release asset must be a regular file: ${entry.name}`)
  if (details.size <= 0) fail(`release asset is empty: ${entry.name}`)
  return { name: entry.name, path: file, size: details.size }
}

async function collectWindowsReleaseAssets(directory, identity) {
  const root = path.resolve(directory)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    fail(`could not read Squirrel output directory ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const setupName = `${identity.productName}-Setup-${identity.version}.exe`
  const setupEntries = entries.filter((entry) => entry.name === setupName)
  if (setupEntries.length !== 1) fail(`expected exactly one ${setupName}, found ${setupEntries.length}`)
  const releaseEntries = entries.filter((entry) => entry.name === 'RELEASES')
  if (releaseEntries.length !== 1) fail(`expected exactly one RELEASES file, found ${releaseEntries.length}`)

  const packageEntries = entries
    .filter((entry) => /\.nupkg$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  const fullName = `${identity.packageId}-${identity.version}-full.nupkg`
  for (const entry of packageEntries) {
    if (entry.name !== fullName) {
      fail(`unexpected Squirrel package name: expected exactly ${fullName}; delta packages are not release assets`)
    }
  }
  const allowedNames = new Set([setupName, 'RELEASES', ...packageEntries.map((entry) => entry.name)])
  const unexpected = entries.filter((entry) => !allowedNames.has(entry.name)).sort((left, right) => left.name.localeCompare(right.name))
  if (unexpected.length > 0) {
    fail(`unexpected Squirrel output entr${unexpected.length === 1 ? 'y' : 'ies'}: ${unexpected.map((entry) => entry.name).join(', ')}`)
  }

  const setup = await regularReleaseAsset(root, setupEntries[0])
  const releases = await regularReleaseAsset(root, releaseEntries[0])
  const packages = []
  for (const entry of packageEntries) packages.push(await regularReleaseAsset(root, entry))
  const fullPackages = packages.filter((asset) => /-full\.nupkg$/i.test(asset.name))
  if (packages.length !== 1 || fullPackages.length !== 1 || fullPackages[0].name !== fullName) {
    fail(`expected exactly one full Squirrel package named ${fullName}`)
  }

  const releaseRows = parseReleases(await readFile(releases.path, 'utf8'))
  if (releaseRows.length !== 1 || releaseRows[0].name !== fullName) {
    fail(`RELEASES must contain exactly one row for ${fullName}; delta packages are not release assets`)
  }
  const rowsByName = new Map(releaseRows.map((row) => [row.name, row]))
  const packagesByName = new Map(packages.map((asset) => [asset.name, asset]))
  for (const row of releaseRows) {
    const asset = packagesByName.get(row.name)
    if (!asset) fail(`RELEASES references a package that is missing on disk: ${row.name}`)
    if (asset.size !== row.size) fail(`RELEASES size mismatch for ${row.name}: recorded ${row.size}, actual ${asset.size}`)
    const actualSha1 = (await digestFile(asset.path, 'sha1')).digest
    if (actualSha1 !== row.sha1) fail(`RELEASES SHA1 mismatch for ${row.name}: recorded ${row.sha1}, actual ${actualSha1}`)
  }
  for (const asset of packages) {
    if (!rowsByName.has(asset.name)) fail(`package is not listed in RELEASES: ${asset.name}`)
  }

  return { setup: setup.path, full: fullPackages[0].path, releases: releases.path, packages: packages.map((asset) => asset.path) }
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

export async function assertPackagedSharpRuntime(unpackedDirectory) {
  const nodeModules = path.join(unpackedDirectory, 'resources', 'app.asar.unpacked', 'node_modules')
  const manifest = path.join(nodeModules, 'sharp', 'package.json')
  let manifestStat
  try {
    manifestStat = await stat(manifest)
  } catch {
    fail('packaged runtime is missing node_modules/sharp/package.json')
  }
  if (!manifestStat.isFile() || manifestStat.size <= 0) {
    fail('packaged runtime has an invalid node_modules/sharp/package.json')
  }

  const nativeDirectory = path.join(nodeModules, '@img', 'sharp-win32-x64', 'lib')
  let nativeEntries
  try {
    nativeEntries = await readdir(nativeDirectory, { withFileTypes: true })
  } catch {
    fail('packaged runtime is missing @img/sharp-win32-x64/lib')
  }
  const native = nativeEntries.filter(
    (entry) => entry.isFile() && /^sharp-win32-x64(?:-[0-9.]+)?[.]node$/u.test(entry.name)
  )
  if (native.length !== 1) {
    fail(`packaged runtime must contain exactly one Sharp x64 native module; found ${native.length}`)
  }
  const nativeStat = await stat(path.join(nativeDirectory, native[0].name))
  if (nativeStat.size <= 0) fail('packaged Sharp x64 native module is empty')
  return { manifest, native: path.join(nativeDirectory, native[0].name) }
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
  const assets = await collectWindowsReleaseAssets(directory, releaseIdentity)
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
  await assertPackagedSharpRuntime(unpackedDirectory)
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

export function isTransientApplicationBuildExitCode(exitCode) {
  return Number.isInteger(exitCode) && (exitCode >>> 0) === APPLICATION_BUILD_TRANSIENT_EXIT_CODE
}

function waitForApplicationBuildRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function runApplicationBuildWithRetry({
  build,
  cleanOutput,
  waitImpl = waitForApplicationBuildRetry,
} = {}) {
  if (typeof build !== 'function') fail('application build operation is required')
  if (typeof cleanOutput !== 'function') fail('application build output cleanup is required')

  for (let attempt = 1; attempt <= APPLICATION_BUILD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await build()
      return
    } catch (error) {
      const retryable = isTransientApplicationBuildExitCode(error?.exitCode)
      if (!retryable || attempt >= APPLICATION_BUILD_MAX_ATTEMPTS) throw error

      writeDiagnostic(
        2,
        `windows-installer: application build host runtime exited with ${error.exitCode} on attempt ${attempt}/${APPLICATION_BUILD_MAX_ATTEMPTS}; retrying in ${APPLICATION_BUILD_RETRY_DELAY_MS} ms with clean out/ and a fresh process`,
      )
      await cleanOutput()
      await waitImpl(APPLICATION_BUILD_RETRY_DELAY_MS)
    }
  }
}

export async function cleanApplicationBuildOutput(root = REPO_ROOT) {
  const resolvedRoot = path.resolve(root)
  const output = path.join(resolvedRoot, 'out')
  const relative = path.relative(resolvedRoot, output)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`unsafe application build cleanup target ${output}`)
  }
  await rm(output, { recursive: true, force: true })
  return output
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

async function buildWindowsInstaller(options = {}) {
  if (process.platform !== 'win32') fail('the Windows installer build must run on Windows')
  const metadataFile = path.join(REPO_ROOT, 'dist', 'windows-icon-contract.json')
  const squirrelOutput = path.join(REPO_ROOT, 'dist', 'squirrel-windows')
  await runStage('clean Windows package outputs', () => cleanWindowsPackageOutputs(REPO_ROOT))
  // Postinstall already patches and rebuilds exactly node-pty + smart-whisper, then loads both
  // under Electron as the ABI proof. package.json therefore keeps `npmRebuild: false`; letting
  // electron-builder run its separate native scan rebuilds unrelated optional modules and discards
  // that exact-module boundary. The strict preflight remains mandatory for `npm run rebuild`; this
  // explicit mode only avoids treating an unrelated live relay as a file this packaging route
  // will replace.
  await runStage('build preflight', () => run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'check-build-preflight.mjs'), '--no-native-mutation'], { description: 'build preflight' }))
  const sourceIdentity = await runStage('source identity resolution', () => resolveSourceIdentity(REPO_ROOT))
  await runStage('pinned QEMU resource bootstrap', () => run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'ensure-qemu-resources.mjs'), '--output', path.join(REPO_ROOT, 'resources', 'qemu')], { description: 'pinned QEMU resource bootstrap' }))
  await runStage('pinned AWS CLI resource bootstrap', () => run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'ensure-aws-cli-resources.mjs'), '--output', path.join(REPO_ROOT, 'resources', 'aws-cli-v2')], { description: 'pinned AWS CLI v2 resource bootstrap' }))
  await runStage('icon generation', () => run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'make-icon.mjs')], { description: 'icon generation' }))
  const metadata = await runStage('source icon verification', () => verifySourceIcon(REPO_ROOT, {
    sourceIdentity,
    requirePublishedSourceIcon: options.requirePublishedSourceIcon === true,
  }))
  await runStage('write Windows icon contract metadata', () => writeMetadataAtomic(metadataFile, metadata))
  const npmCli = process.env.npm_execpath
  if (!npmCli) fail('npm_execpath is required; invoke the Windows installer through npm run dist:win')
  // Release packaging deliberately runs the application build only. Quality checks stay local;
  // pulling them into this publishing route makes a release depend on checks the delivery policy
  // explicitly keeps out of the publishing job. Packaging integrity remains below: the wrapper
  // still clears stale output, freezes source identity, verifies the icon/PE contract, and checks
  // the exact Squirrel asset set after electron-builder returns.
  await runStage('application build', () => runApplicationBuildWithRetry({
    build: () => run(process.execPath, [npmCli, 'run', 'build:app'], { description: 'application build' }),
    cleanOutput: () => cleanApplicationBuildOutput(REPO_ROOT),
  }))
  const builderCli = await runStage('resolve electron-builder CLI', () => require.resolve('electron-builder/cli.js'))
  await runStage('electron-builder Squirrel packaging', () => run(
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
  ))
  await runStage('packaged Windows icon contract verification', () => assertPackagedIconContract(squirrelOutput, metadataFile, REPO_ROOT, { sourceIdentity }))
}

async function main(argv) {
  const [command, ...args] = argv
  if (command === 'build' && (args.length === 0 || (args.length === 1 && args[0] === '--require-published-source-icon'))) {
    await buildWindowsInstaller({ requirePublishedSourceIcon: args[0] === '--require-published-source-icon' })
    return
  }
  if (command === 'verify-source' && args.length <= 1) {
    const result = await verifySourceIcon(args[0] ? path.resolve(args[0]) : REPO_ROOT)
    console.log(JSON.stringify(result))
    return
  }
  if (command === 'assert-package' && args.length === 2) {
    const metadataFile = path.resolve(args[1])
    const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
    const sourceIdentity = sourceIdentityFromIconMetadata(metadata)
    const result = await assertPackagedIconContract(path.resolve(args[0]), metadataFile, REPO_ROOT, { sourceIdentity })
    console.log(`verified unsigned packaged PE identity and immutable iconUrl ${result.iconUrl}`)
    return
  }
  fail(
    'usage: windows-installer.mjs build [--require-published-source-icon]\n' +
      '   or: windows-installer.mjs verify-source [repository-root]\n' +
      '   or: windows-installer.mjs assert-package <squirrel-output-directory> <metadata-file>',
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE
if (isMain) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    writeDiagnostic(2, `windows-installer: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1
  }
}
