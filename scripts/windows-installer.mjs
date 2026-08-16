#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ResEdit from 'resedit'
import unzipper from 'unzipper'
import {
  collectReleaseAssets,
  nuspecMetadataElement,
  readReleaseIdentity,
} from './release-assets.mjs'

const require = createRequire(import.meta.url)
const SCRIPT_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..')
const ICON_RELATIVE_PATH = 'build/icon.ico'
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]
const MAX_ICON_BYTES = 1024 * 1024
const FULL_SHA_RE = /^[0-9a-f]{40}$/
const REPOSITORY_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function frameBytes(item) {
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
  return { width, height, bitCount, bytes: frameBytes(item) }
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
  const frames = requireExpectedFrames(icon.icons, 'source ICO')
  return frames.map((frame) => ({
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
      id: group.id,
      lang: group.lang,
      frames: data.map((frame, index) => ({ ...group.icons[index], data: frame })),
    }
  })
}

/** Require PE resource group 1 to match every source ICO frame byte-for-byte. */
export function inspectPeIconInventory(executableBytes, expectedIconBytes, description = 'executable') {
  const expected = new Map(inspectIco(expectedIconBytes).map((frame) => [frame.width, frame.sha256]))
  const groups = peIconGroups(executableBytes, description)
  if (groups.length === 0) fail(`${description} is missing branded RT_GROUP_ICON resource 1`)
  if (groups.some((group) => Number(group.id) !== 1)) {
    fail(`${description} contains an unexpected RT_GROUP_ICON resource`)
  }
  for (const group of groups) {
    const frames = requireExpectedFrames(group.frames, `${description} resource 1 language ${group.lang}`)
    for (const frame of frames) {
      const actual = sha256(frame.bytes)
      if (actual !== expected.get(frame.width)) {
        fail(`${description} ${frame.width}px icon does not match build/icon.ico`)
      }
    }
  }
  return { group: 1, languages: groups.map((group) => group.lang), frames: ICON_SIZES.length }
}

function versionParts(value, description) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (!match) fail(`${description} must be a numeric three- or four-part version`)
  return match.slice(1).map((part) => Number(part ?? 0))
}

function fixedVersion(ms, ls) {
  return [(ms >>> 16) & 0xffff, ms & 0xffff, (ls >>> 16) & 0xffff, ls & 0xffff]
}

/** Require every PE version resource to agree with the package version and product name. */
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
  const expectedParts = versionParts(expected.version.split(/[+-]/, 1)[0], 'package version')
  for (const [actual, label] of [
    [fixedVersion(version.fixedInfo.fileVersionMS, version.fixedInfo.fileVersionLS), 'fixed file version'],
    [fixedVersion(version.fixedInfo.productVersionMS, version.fixedInfo.productVersionLS), 'fixed product version'],
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(expectedParts)) {
      fail(`${description} ${label} does not match package version ${expected.version}`)
    }
  }
  const languages = version.getAllLanguagesForStringValues()
  if (languages.length === 0) fail(`${description} version resource has no string values`)
  for (const language of languages) {
    const values = version.getStringValues(language)
    if (values.ProductName !== expected.productName || values.FileDescription !== expected.productName) {
      fail(`${description} ProductName/FileDescription does not match ${expected.productName}`)
    }
    for (const key of ['FileVersion', 'ProductVersion']) {
      if (JSON.stringify(versionParts(values[key], `${description} ${key}`)) !== JSON.stringify(expectedParts)) {
        fail(`${description} ${key} does not match package version ${expected.version}`)
      }
    }
  }
  return { productName: expected.productName, version: expected.version, languages: languages.length }
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

export function requireCleanSourceStatus(status) {
  if (typeof status !== 'string') fail('git source status must be text')
  if (status.trim() !== '') fail('refusing to package a dirty source tree; commit every tracked and untracked source first')
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

async function entryBuffer(entry, description, maxBytes = 512 * 1024 * 1024) {
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
  const nuspecs = files.filter((entry) => /(^|\/)\.?.+\.nuspec$/i.test(entry.path))
  if (nuspecs.length !== 1) fail(`${path.basename(file)} must contain exactly one .nuspec`)
  const nuspec = (await entryBuffer(nuspecs[0], `${path.basename(file)} nuspec`, 1024 * 1024)).toString('utf8')
  if (nuspecMetadataElement(nuspec, 'iconUrl', `${path.basename(file)} nuspec`) !== expectedUrl) {
    fail(`${path.basename(file)} nuspec iconUrl does not match the immutable source URL`)
  }

  const normalized = files.map((entry) => ({ entry, name: entry.path.replaceAll('\\', '/') }))
  const expectedApp = `lib/net45/${expectedIdentity.productName}.exe`.toLowerCase()
  const expectedStub = `lib/net45/${expectedIdentity.productName}_ExecutionStub.exe`.toLowerCase()
  const app = normalized.filter(({ name }) => name.toLowerCase() === expectedApp)
  const stub = normalized.filter(({ name }) => name.toLowerCase() === expectedStub)
  if (app.length !== 1 || stub.length !== 1) {
    fail(`${path.basename(file)} must contain one nodeterm.exe and one nodeterm_ExecutionStub.exe`)
  }
  const appBytes = await entryBuffer(app[0].entry, `packaged ${expectedIdentity.productName}.exe`)
  const stubBytes = await entryBuffer(stub[0].entry, `packaged ${expectedIdentity.productName}_ExecutionStub.exe`)
  inspectPeIconInventory(appBytes, expectedIconBytes, `packaged ${expectedIdentity.productName}.exe`)
  inspectPeProductIdentity(appBytes, expectedIdentity, `packaged ${expectedIdentity.productName}.exe`)
  inspectPeIconInventory(
    stubBytes,
    expectedIconBytes,
    `packaged ${expectedIdentity.productName}_ExecutionStub.exe`,
  )
  inspectPeProductIdentity(stubBytes, expectedIdentity, `packaged ${expectedIdentity.productName}_ExecutionStub.exe`)
}

/** Validate the embedded icon URL and the Setup/app/stub PE icon resources before publication. */
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
  const assets = await collectReleaseAssets(directory, releaseIdentity)
  const setupBytes = await readFile(assets.setup)
  inspectPeIconInventory(setupBytes, icon, 'Squirrel Setup executable')
  inspectPeProductIdentity(setupBytes, releaseIdentity, 'Squirrel Setup executable')
  const full = assets.packages.filter((file) => /-full\.nupkg$/i.test(file))
  if (full.length !== 1) fail(`expected exactly one full nupkg for icon inspection, found ${full.length}`)
  await inspectFullPackage(full[0], metadata.iconUrl, icon, releaseIdentity)
  return { setup: assets.setup, full: full[0], iconUrl: metadata.iconUrl }
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

/** Remove every generated tree whose stale contents could enter a Windows installer. */
export async function cleanWindowsPackageOutputs(root = REPO_ROOT) {
  const targets = [
    path.join(root, 'dist', 'squirrel-windows'),
    path.join(root, 'out'),
    path.join(root, 'dist', 'windows-icon-contract.json'),
  ]
  for (const target of targets) await rm(target, { recursive: true, force: true })
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
    console.log(`verified packaged icon resources and immutable iconUrl ${result.iconUrl}`)
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
