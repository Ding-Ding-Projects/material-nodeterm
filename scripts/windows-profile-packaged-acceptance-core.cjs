'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const zlib = require('node:zlib')

const REQUIRED_EVIDENCE_IDS = Object.freeze([
  'windows-terminal-profile-picker',
  'windows-terminal-profile-terminal',
  'windows-terminal-profile-unavailable',
  'windows-terminal-profile-restart-warning',
  'windows-terminal-profile-reattached'
])

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MIN_SETUP_BYTES = 5 * 1024 * 1024
const MIN_CAPTURE_BYTES = 6_000
const DESKTOP_PREFIX = 'nt-winprofiles-'
const SOURCE_ROOTS = Object.freeze(['src', 'scripts', 'build', 'resources'])
const SOURCE_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'dependencies.manifest.json',
  'electron.vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'vitest.config.ts',
  'build-installer.bat'
])
const REQUIRED_ARTIFACT_ROLES = Object.freeze([
  'out-main',
  'out-preload',
  'out-renderer',
  'out-session-host',
  'packaged-executable',
  'packaged-app-asar',
  'packaged-session-host',
  'packaged-node-pty-conpty',
  'squirrel-setup',
  'squirrel-releases',
  'squirrel-full-nupkg'
])

function fail(message) {
  throw new Error(message)
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string.`)
  if (/[\0\r\n]/.test(value)) fail(`${label} contains a forbidden NUL or newline.`)
  return value
}

function canonical(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')
}

function isInside(parent, child) {
  const root = canonical(parent)
  const target = canonical(child)
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function requireInside(parent, child, label, allowEqual = false) {
  const root = canonical(parent)
  const target = canonical(child)
  if (!isInside(root, target) || (!allowEqual && root === target)) {
    fail(`${label} must stay inside ${path.resolve(parent)}.`)
  }
  return path.resolve(child)
}

function requireAbsolute(value, label) {
  nonEmptyString(value, label)
  if (!path.isAbsolute(value)) fail(`${label} must be an absolute path.`)
  return path.resolve(value)
}

function requireFile(value, label) {
  const file = requireAbsolute(value, label)
  let stat
  try {
    stat = fs.statSync(file)
  } catch (error) {
    fail(`${label} is missing at ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stat.isFile()) fail(`${label} is not a file: ${file}`)
  return { path: file, stat }
}

function requireDirectory(value, label) {
  const directory = requireAbsolute(value, label)
  let stat
  try {
    stat = fs.statSync(directory)
  } catch (error) {
    fail(`${label} is missing at ${directory}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stat.isDirectory()) fail(`${label} is not a directory: ${directory}`)
  return directory
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytes === 0) break
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function sourceFiles(repoRoot) {
  const root = requireDirectory(repoRoot, 'Repository root')
  const files = []
  const visit = (candidate) => {
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink()) fail(`Shipping input may not be a symbolic link: ${candidate}`)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(candidate, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        visit(path.join(candidate, entry.name))
      }
      return
    }
    if (!stat.isFile()) fail(`Shipping input must be a regular file: ${candidate}`)
    files.push(candidate)
  }
  for (const relative of SOURCE_ROOTS) {
    const candidate = path.join(root, relative)
    if (fs.existsSync(candidate)) visit(candidate)
  }
  for (const relative of SOURCE_FILES) {
    const candidate = path.join(root, relative)
    if (fs.existsSync(candidate)) visit(candidate)
  }
  if (files.length === 0) fail('No shipping/build inputs were found for the source snapshot.')
  return files.sort((left, right) => {
    const a = path.relative(root, left).replace(/\\/g, '/')
    const b = path.relative(root, right).replace(/\\/g, '/')
    return a.localeCompare(b)
  })
}

function digestSourceRecords(records) {
  const hash = crypto.createHash('sha256')
  for (const record of records) {
    hash.update(record.path, 'utf8')
    hash.update('\0', 'utf8')
    hash.update(String(record.bytes), 'utf8')
    hash.update('\0', 'utf8')
    hash.update(record.sha256, 'ascii')
    hash.update('\n', 'utf8')
  }
  return hash.digest('hex')
}

function readGitHead(repoRoot) {
  const dotGit = path.join(repoRoot, '.git')
  let gitDirectory = dotGit
  const dotGitStat = fs.statSync(dotGit)
  if (dotGitStat.isFile()) {
    const pointer = fs.readFileSync(dotGit, 'utf8').trim()
    const match = pointer.match(/^gitdir:\s*(.+)$/i)
    if (!match) fail(`Malformed linked-worktree .git file at ${dotGit}.`)
    gitDirectory = path.resolve(repoRoot, match[1])
  } else if (!dotGitStat.isDirectory()) {
    fail(`${dotGit} is neither a Git directory nor a linked-worktree pointer.`)
  }
  const headValue = fs.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim()
  if (/^[0-9a-f]{40}$/i.test(headValue)) return headValue.toLowerCase()
  const match = headValue.match(/^ref:\s*(refs\/.+)$/i)
  if (!match || match[1].includes('..') || path.isAbsolute(match[1])) fail('Git HEAD is malformed.')
  const ref = match[1].replace(/\\/g, '/')
  const candidates = [gitDirectory]
  const commonDirFile = path.join(gitDirectory, 'commondir')
  if (fs.existsSync(commonDirFile)) {
    candidates.push(path.resolve(gitDirectory, fs.readFileSync(commonDirFile, 'utf8').trim()))
  }
  for (const candidate of candidates) {
    const loose = path.join(candidate, ...ref.split('/'))
    if (fs.existsSync(loose)) {
      const value = fs.readFileSync(loose, 'utf8').trim()
      if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase()
      fail(`Git ref ${ref} is not a full commit SHA.`)
    }
    const packed = path.join(candidate, 'packed-refs')
    if (!fs.existsSync(packed)) continue
    for (const line of fs.readFileSync(packed, 'utf8').split(/\r?\n/u)) {
      const packedMatch = line.match(/^([0-9a-f]{40})\s+(.+)$/i)
      if (packedMatch?.[2] === ref) return packedMatch[1].toLowerCase()
    }
  }
  fail(`Git HEAD ref ${ref} could not be resolved.`)
}

function createSourceSnapshot(repoRoot, head, options = {}) {
  const root = requireDirectory(repoRoot, 'Repository root')
  const gitHead = validateCommit(head)
  const actualHead = validateCommit(options.actualHead ?? readGitHead(root))
  if (actualHead !== gitHead) fail(`Requested source HEAD ${gitHead} does not match checkout HEAD ${actualHead}.`)
  const capturedAtMs = options.capturedAtMs ?? Date.now()
  if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs <= 0) {
    fail('Source snapshot capturedAtMs must be a positive integer.')
  }
  const files = sourceFiles(root).map((file) => {
    const stat = fs.statSync(file)
    return {
      path: path.relative(root, file).replace(/\\/g, '/'),
      bytes: stat.size,
      sha256: sha256File(file)
    }
  })
  return {
    schemaVersion: 1,
    gitHead,
    capturedAt: new Date(capturedAtMs).toISOString(),
    capturedAtMs,
    workingTreeDigest: digestSourceRecords(files),
    files
  }
}

function validateSourceSnapshot(repoRoot, snapshot, options = {}) {
  if (!snapshot || snapshot.schemaVersion !== 1) fail('Source snapshot schemaVersion must be 1.')
  const expectedHead = validateCommit(snapshot.gitHead)
  if (options.expectedCommit && validateCommit(options.expectedCommit) !== expectedHead) {
    fail(`Source snapshot HEAD ${expectedHead} does not match expected commit ${options.expectedCommit}.`)
  }
  if (!Number.isSafeInteger(snapshot.capturedAtMs) || snapshot.capturedAtMs <= 0) {
    fail('Source snapshot has an invalid capturedAtMs.')
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    fail('Source snapshot has no file records.')
  }
  const expectedDigest = nonEmptyString(snapshot.workingTreeDigest, 'Source working-tree digest').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(expectedDigest)) fail('Source working-tree digest must be SHA-256 hex.')
  const seenPaths = new Set()
  const expectedFiles = snapshot.files.map((record) => {
    const pathname = nonEmptyString(record?.path, 'Source snapshot path').replace(/\\/g, '/')
    if (path.isAbsolute(pathname) || pathname === '..' || pathname.startsWith('../') || pathname.includes('/../')) {
      fail(`Source snapshot path must be repository-relative: ${pathname}`)
    }
    if (seenPaths.has(pathname)) fail(`Duplicate source snapshot path ${pathname}.`)
    seenPaths.add(pathname)
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0) fail(`Source snapshot bytes are invalid for ${pathname}.`)
    const sha256 = nonEmptyString(record.sha256, `Source snapshot SHA for ${pathname}`).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sha256)) fail(`Source snapshot SHA is invalid for ${pathname}.`)
    return { path: pathname, bytes: record.bytes, sha256 }
  })
  if (digestSourceRecords(expectedFiles) !== expectedDigest) {
    fail('Source snapshot file records do not match its working-tree digest.')
  }
  const actual = createSourceSnapshot(repoRoot, expectedHead, { capturedAtMs: snapshot.capturedAtMs })
  if (actual.workingTreeDigest !== expectedDigest) {
    const expectedPaths = new Map(expectedFiles.map((record) => [record.path, record]))
    const actualPaths = new Map(actual.files.map((record) => [record.path, record]))
    const changed = []
    for (const pathname of new Set([...expectedPaths.keys(), ...actualPaths.keys()])) {
      const before = expectedPaths.get(pathname)
      const after = actualPaths.get(pathname)
      if (!before) changed.push(`added:${pathname}`)
      else if (!after) changed.push(`removed:${pathname}`)
      else if (before.bytes !== after.bytes || before.sha256 !== after.sha256) changed.push(`changed:${pathname}`)
    }
    fail(`Shipping/build inputs changed after the frozen source snapshot: ${changed.slice(0, 12).join(', ') || 'digest mismatch'}.`)
  }
  return actual
}

function artifactRecord(file, repoRoot) {
  const { path: absolute, stat } = requireFile(file, 'Artifact')
  const relative = path.relative(repoRoot, absolute)
  return {
    file: relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : path.basename(absolute),
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256File(absolute)
  }
}

function newestShippingInput(repoRoot) {
  const roots = [
    path.join(repoRoot, 'src'),
    path.join(repoRoot, 'build')
  ]
  const singles = [
    'package.json',
    'package-lock.json',
    'electron.vite.config.ts',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsconfig.web.json'
  ].map((name) => path.join(repoRoot, name))
  let newest = { path: '', mtimeMs: 0 }
  const consider = (candidate) => {
    let stat
    try {
      stat = fs.statSync(candidate)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        consider(path.join(candidate, entry.name))
      }
      return
    }
    if (stat.isFile() && stat.mtimeMs > newest.mtimeMs) newest = { path: candidate, mtimeMs: stat.mtimeMs }
  }
  for (const root of roots) consider(root)
  for (const single of singles) consider(single)
  if (!newest.path) fail('No shipping source inputs were found for freshness validation.')
  return newest
}

function validateCommit(value) {
  const commit = nonEmptyString(value, 'Expected commit').trim().toLocaleLowerCase('en-US')
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('Expected commit must be a full 40-character Git SHA.')
  return commit
}

function validateDesktopName(value) {
  const desktop = nonEmptyString(value, 'Headless desktop name').trim()
  if (!desktop.startsWith(DESKTOP_PREFIX)) {
    fail(`Headless desktop name must begin with ${DESKTOP_PREFIX}.`)
  }
  if (!/^[A-Za-z0-9._-]{20,80}$/.test(desktop)) {
    fail('Headless desktop name must be 20-80 characters using only letters, digits, dot, underscore, or hyphen.')
  }
  return desktop
}

function validatePort(value, label) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail(`${label} must be an integer from 1024 through 65535.`)
  }
  return port
}

function quoteWindowsArg(value) {
  const text = nonEmptyString(String(value), 'Command argument')
  // CreateProcessW receives one mutable command line. Apply the documented CommandLineToArgvW
  // quoting rule so paths ending in backslashes and paths containing quotes remain one argument.
  if (!/[\s"]/u.test(text)) return text
  let quoted = '"'
  let slashes = 0
  for (const character of text) {
    if (character === '\\') {
      slashes += 1
    } else if (character === '"') {
      quoted += '\\'.repeat(slashes * 2 + 1) + '"'
      slashes = 0
    } else {
      quoted += '\\'.repeat(slashes) + character
      slashes = 0
    }
  }
  return quoted + '\\'.repeat(slashes * 2) + '"'
}

function buildPackagedLaunchCommand(candidate, port, chromiumProfile) {
  const executable = requireAbsolute(candidate, 'Packaged executable')
  const debugPort = validatePort(port, 'CDP port')
  const profile = requireAbsolute(chromiumProfile, 'Chromium profile directory')
  return [
    quoteWindowsArg(executable),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${quoteWindowsArg(profile)}`
  ].join(' ')
}

function expectedArtifactPaths(options) {
  const repoRoot = requireDirectory(options.repoRoot, 'Repository root')
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const version = nonEmptyString(packageJson.version, 'package.json version')
  const winRoot = path.join(repoRoot, 'dist', 'win-unpacked')
  const squirrelRoot = path.join(repoRoot, 'dist', 'squirrel-windows')
  const paths = {
    'out-main': options.outMain ?? path.join(repoRoot, 'out', 'main', 'index.js'),
    'out-preload': options.outPreload ?? path.join(repoRoot, 'out', 'preload', 'index.js'),
    'out-renderer': options.outRenderer ?? path.join(repoRoot, 'out', 'renderer', 'index.html'),
    'out-session-host': options.outSessionHost ?? path.join(repoRoot, 'out', 'session-host', 'host.cjs'),
    'packaged-executable': options.candidate ?? path.join(winRoot, 'nodeterm.exe'),
    'packaged-app-asar': options.appAsar ?? path.join(winRoot, 'resources', 'app.asar'),
    'packaged-session-host': options.sessionHost ?? path.join(winRoot, 'resources', 'session-host', 'host.cjs'),
    'packaged-node-pty-conpty':
      options.packagedNodePty ??
      path.join(
        winRoot,
        'resources',
        'session-host',
        'node_modules',
        'node-pty',
        'build',
        'Release',
        'conpty.node'
      ),
    'squirrel-setup': options.setup ?? path.join(squirrelRoot, `nodeterm-Setup-${version}.exe`),
    'squirrel-releases': options.releases ?? path.join(squirrelRoot, 'RELEASES'),
    'squirrel-full-nupkg': options.nupkg
  }
  if (!paths['squirrel-full-nupkg']) {
    const packages = fs.existsSync(squirrelRoot)
      ? fs.readdirSync(squirrelRoot)
          .filter((name) => name.toLowerCase().endsWith('-full.nupkg'))
          .map((name) => path.join(squirrelRoot, name))
      : []
    if (packages.length !== 1) {
      fail(`Expected exactly one Squirrel full .nupkg in ${squirrelRoot}; found ${packages.length}.`)
    }
    paths['squirrel-full-nupkg'] = packages[0]
  }
  return { repoRoot, version, winRoot, squirrelRoot, paths }
}

function validateArtifactLayout(options, layout) {
  const records = {}
  for (const role of REQUIRED_ARTIFACT_ROLES) {
    records[role] = requireFile(layout.paths[role], `Build artifact ${role}`)
  }
  const exactCandidate = path.join(layout.winRoot, 'nodeterm.exe')
  if (canonical(records['packaged-executable'].path) !== canonical(exactCandidate)) {
    fail('Packaged executable must be exactly dist/win-unpacked/nodeterm.exe.')
  }
  requireInside(path.join(layout.winRoot, 'resources'), records['packaged-app-asar'].path, 'Packaged app.asar')
  requireInside(
    path.join(layout.winRoot, 'resources', 'session-host'),
    records['packaged-session-host'].path,
    'Packaged session host'
  )
  requireInside(
    path.join(layout.winRoot, 'resources', 'session-host', 'node_modules', 'node-pty'),
    records['packaged-node-pty-conpty'].path,
    'Packaged node-pty ConPTY binding'
  )
  requireInside(layout.squirrelRoot, records['squirrel-setup'].path, 'Squirrel setup executable')
  requireInside(layout.squirrelRoot, records['squirrel-releases'].path, 'Squirrel RELEASES index')
  requireInside(layout.squirrelRoot, records['squirrel-full-nupkg'].path, 'Squirrel full package')
  const setupName = `nodeterm-Setup-${layout.version}.exe`.toLowerCase()
  if (path.basename(records['squirrel-setup'].path).toLowerCase() !== setupName) {
    fail(`Squirrel setup executable must be named nodeterm-Setup-${layout.version}.exe.`)
  }
  if (records['squirrel-setup'].stat.size < (options.minimumSetupBytes ?? MIN_SETUP_BYTES)) {
    fail(`Squirrel setup executable is only ${records['squirrel-setup'].stat.size} bytes.`)
  }
  if (path.basename(records['squirrel-releases'].path) !== 'RELEASES') {
    fail('Squirrel RELEASES index must be named RELEASES.')
  }
  if (!path.basename(records['squirrel-full-nupkg'].path).toLowerCase().endsWith('-full.nupkg')) {
    fail('Squirrel package must be the full .nupkg, not a delta package.')
  }
  const updateConfig = path.join(layout.winRoot, 'resources', 'app-update.yml')
  if (fs.existsSync(updateConfig)) {
    fail(
      `Packaged automatic-update configuration exists at ${updateConfig}; acceptance cannot risk downloading or installing an update.`
    )
  }
  return records
}

function regularFilesBelow(root) {
  const files = []
  const visit = (candidate) => {
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink()) fail(`Build output may not be a symbolic link: ${candidate}`)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(candidate).sort()) visit(path.join(candidate, entry))
      return
    }
    if (!stat.isFile()) fail(`Build output must be a regular file: ${candidate}`)
    files.push(candidate)
  }
  visit(root)
  return files
}

function bufferSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function validatePackagedContents(options, layout, records) {
  const asar = options.asarApi ?? require('@electron/asar')
  const listAsarFiles = options.listAsarFiles ?? ((file) => asar.listPackage(file))
  const extractAsarFile =
    options.extractAsarFile ?? ((file, entry) => asar.extractFile(file, entry.replace(/\//g, path.sep)))
  const outRoot = path.join(layout.repoRoot, 'out')
  const localFiles = regularFilesBelow(outRoot)
    .map((file) => path.relative(layout.repoRoot, file).replace(/\\/g, '/'))
    .filter((relative) => !relative.startsWith('out/session-host/'))
    .sort()
  let rawPackagedEntries
  try {
    rawPackagedEntries = listAsarFiles(records['packaged-app-asar'].path)
  } catch (error) {
    fail(
      `Packaged app.asar is malformed or still being written: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  if (!Array.isArray(rawPackagedEntries)) fail('Packaged app.asar listing did not return an array.')
  const packagedEntries = rawPackagedEntries
    .map((entry) => String(entry).replace(/^[/\\]+/u, '').replace(/\\/g, '/'))
    .filter((entry) => entry.startsWith('out/') && !entry.startsWith('out/session-host/'))
    .sort()
  if (new Set(packagedEntries).size !== packagedEntries.length) fail('Packaged app.asar contains duplicate out entries.')
  const expectedEntries = new Set(localFiles)
  for (const file of localFiles) {
    let directory = path.posix.dirname(file)
    while (directory !== 'out' && directory.startsWith('out/')) {
      expectedEntries.add(directory)
      directory = path.posix.dirname(directory)
    }
  }
  const expectedEntryList = [...expectedEntries].sort()
  if (
    expectedEntryList.length !== packagedEntries.length ||
    expectedEntryList.some((entry, index) => entry !== packagedEntries[index])
  ) {
    fail('Packaged app.asar out entries do not exactly match the frozen local out tree.')
  }
  const outRecords = []
  for (const relative of localFiles) {
    const local = fs.readFileSync(path.join(layout.repoRoot, ...relative.split('/')))
    let packaged
    try {
      packaged = Buffer.from(extractAsarFile(records['packaged-app-asar'].path, relative))
    } catch (error) {
      fail(
        `Packaged app.asar entry ${relative} is unreadable or still being written: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    const localSha = bufferSha256(local)
    const packagedSha = bufferSha256(packaged)
    if (local.length !== packaged.length || localSha !== packagedSha) {
      fail(`Packaged app.asar entry ${relative} does not match the local build output.`)
    }
    outRecords.push({ path: relative, bytes: local.length, sha256: localSha })
  }
  const localHostSha = sha256File(records['out-session-host'].path)
  const packagedHostSha = sha256File(records['packaged-session-host'].path)
  if (localHostSha !== packagedHostSha) fail('Packaged session host does not match out/session-host/host.cjs.')
  const sourceNodePty = requireFile(
    options.sourceNodePty ??
      path.join(layout.repoRoot, 'node_modules', 'node-pty', 'build', 'Release', 'conpty.node'),
    'Source node-pty ConPTY binding'
  )
  const sourceNodePtySha = sha256File(sourceNodePty.path)
  const packagedNodePtySha = sha256File(records['packaged-node-pty-conpty'].path)
  if (sourceNodePtySha !== packagedNodePtySha) {
    fail('Packaged node-pty ConPTY binding does not match the rebuilt source binding.')
  }
  return {
    asarOutFiles: outRecords.length,
    outTreeDigest: digestSourceRecords(outRecords),
    sessionHostSha256: localHostSha,
    nodePtyConptySha256: sourceNodePtySha
  }
}

function createBuildProvenance(options) {
  const layout = expectedArtifactPaths(options)
  const source = validateSourceSnapshot(layout.repoRoot, options.sourceSnapshot, {
    expectedCommit: options.expectedCommit
  })
  const records = validateArtifactLayout(options, layout)
  const packagedContent = validatePackagedContents(options, layout, records)
  const artifacts = []
  for (const role of REQUIRED_ARTIFACT_ROLES) {
    const artifact = records[role]
    if (artifact.stat.mtimeMs < source.capturedAtMs) {
      fail(`${role} predates the frozen source snapshot; rebuild it before sealing provenance.`)
    }
    artifacts.push({ role, ...artifactRecord(artifact.path, layout.repoRoot) })
  }
  return {
    schemaVersion: 1,
    platform: 'win32',
    arch: 'x64',
    version: layout.version,
    source,
    packagedContent,
    recordedAt: new Date(options.recordedAtMs ?? Date.now()).toISOString(),
    artifacts
  }
}

function validateCandidateProvenance(options) {
  const layout = expectedArtifactPaths(options)
  const provenanceFile = requireFile(options.provenance, 'Build provenance manifest').path
  const manifest = parseJsonDocument(fs.readFileSync(provenanceFile, 'utf8'), 'Build provenance manifest')
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.arch !== 'x64') {
    fail('Build provenance must be schema 1 for win32/x64.')
  }
  if (manifest.version !== layout.version) {
    fail(`Build provenance version ${manifest.version} does not match package ${layout.version}.`)
  }
  const source = validateSourceSnapshot(layout.repoRoot, manifest.source, {
    expectedCommit: options.expectedCommit
  })
  const records = validateArtifactLayout(options, layout)
  const packagedContent = validatePackagedContents(options, layout, records)
  if (JSON.stringify(manifest.packagedContent) !== JSON.stringify(packagedContent)) {
    fail('Packaged-content provenance no longer matches app.asar/session-host/node-pty outputs.')
  }
  if (!Array.isArray(manifest.artifacts)) fail('Build provenance has no artifact records.')
  const byRole = new Map()
  for (const record of manifest.artifacts) {
    const role = nonEmptyString(record?.role, 'Build provenance artifact role')
    if (byRole.has(role)) fail(`Duplicate build provenance role ${role}.`)
    byRole.set(role, record)
  }
  const artifacts = {}
  for (const role of REQUIRED_ARTIFACT_ROLES) {
    const expected = byRole.get(role)
    if (!expected) fail(`Build provenance is missing ${role}.`)
    const actualFile = records[role]
    const relative = path.relative(layout.repoRoot, actualFile.path).replace(/\\/g, '/')
    const actual = { role, ...artifactRecord(actualFile.path, layout.repoRoot) }
    if (expected.file !== relative || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
      fail(`Build artifact ${role} no longer matches its frozen provenance.`)
    }
    if (actualFile.stat.mtimeMs < source.capturedAtMs) {
      fail(`Build artifact ${role} predates the frozen source snapshot.`)
    }
    artifacts[role] = actual
  }
  for (const role of byRole.keys()) {
    if (!REQUIRED_ARTIFACT_ROLES.includes(role)) fail(`Unexpected build provenance role ${role}.`)
  }
  return {
    commit: source.gitHead,
    workingTreeDigest: source.workingTreeDigest,
    sourceFileCount: source.files.length,
    packagedContent,
    version: layout.version,
    provenanceSha256: sha256File(provenanceFile),
    artifacts
  }
}

function validateIsolation(options) {
  const taskRoot = requireAbsolute(options.taskRoot, 'Task root')
  const appData = requireInside(taskRoot, requireAbsolute(options.appData, 'APPDATA'), 'APPDATA')
  const localAppData = requireInside(
    taskRoot,
    requireAbsolute(options.localAppData, 'LOCALAPPDATA'),
    'LOCALAPPDATA'
  )
  const chromiumProfile = requireInside(
    taskRoot,
    requireAbsolute(options.chromiumProfile, 'Chromium profile'),
    'Chromium profile'
  )
  const projectDirectory = requireInside(
    taskRoot,
    requireAbsolute(options.projectDirectory, 'Acceptance project directory'),
    'Acceptance project directory'
  )
  const stateFile = requireInside(
    taskRoot,
    requireAbsolute(options.stateFile, 'Acceptance state file'),
    'Acceptance state file'
  )
  const tempDirectory = requireInside(
    taskRoot,
    requireAbsolute(options.tempDirectory, 'TEMP directory'),
    'TEMP directory'
  )
  if (
    new Set([
      canonical(appData),
      canonical(localAppData),
      canonical(chromiumProfile),
      canonical(projectDirectory),
      canonical(tempDirectory)
    ]).size !== 5
  ) {
    fail('APPDATA, LOCALAPPDATA, Chromium profile, project, and TEMP directories must be distinct.')
  }
  return { taskRoot, appData, localAppData, chromiumProfile, projectDirectory, stateFile, tempDirectory }
}

function createAcceptancePlan(options) {
  const desktop = validateDesktopName(options.desktop)
  const firstPort = validatePort(options.firstPort, 'Initial CDP port')
  const secondPort = validatePort(options.secondPort, 'Relaunch CDP port')
  if (firstPort === secondPort) fail('Initial and relaunch CDP ports must be distinct.')
  const isolation = validateIsolation(options)
  const provenance = validateCandidateProvenance(options)
  const cheap = requireFile(options.cheap, 'Cheap Lowlevel CLI').path
  const evidenceDirectory = requireInside(
    isolation.taskRoot,
    requireAbsolute(options.evidenceDirectory, 'Evidence directory'),
    'Evidence directory'
  )
  const provenanceFile = requireInside(
    isolation.taskRoot,
    requireAbsolute(options.provenance, 'Build provenance manifest'),
    'Build provenance manifest'
  )
  const candidate = requireAbsolute(options.candidate, 'Packaged executable')
  return {
    schemaVersion: 1,
    dryRun: options.execute !== true,
    desktop,
    ports: { initial: firstPort, relaunch: secondPort },
    isolation,
    evidenceDirectory,
    provenanceFile,
    cheap,
    candidate,
    launchCommands: {
      initial: buildPackagedLaunchCommand(candidate, firstPort, isolation.chromiumProfile),
      relaunch: buildPackagedLaunchCommand(candidate, secondPort, isolation.chromiumProfile)
    },
    requiredEvidenceIds: [...REQUIRED_EVIDENCE_IDS],
    provenance
  }
}

function parseJsonDocument(text, label) {
  const raw = String(text ?? '').trim()
  if (!raw) fail(`${label} returned no JSON.`)
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`${label} returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validateCheapInvocation(processResult, tool) {
  if (processResult.error) {
    fail(`Cheap Lowlevel ${tool} could not start: ${processResult.error.message ?? String(processResult.error)}`)
  }
  if (processResult.signal) fail(`Cheap Lowlevel ${tool} ended from signal ${processResult.signal}.`)
  if (processResult.status !== 0) {
    fail(`Cheap Lowlevel ${tool} exited ${processResult.status}: ${String(processResult.stderr ?? '').trim()}`)
  }
  const payload = parseJsonDocument(processResult.stdout, `Cheap Lowlevel ${tool}`)
  if (payload.ok !== true) fail(`Cheap Lowlevel ${tool} failed: ${payload.error ?? JSON.stringify(payload)}`)
  if (tool === 'run_command' && payload.returncode !== 0) {
    fail(`Cheap Lowlevel run_command child exited ${payload.returncode}: ${payload.stderr ?? ''}`)
  }
  return payload
}

function validateLaunchResult(payload) {
  if (!payload || payload.ok !== true) fail('Headless launch did not return ok=true.')
  const pid = Number(payload.pid)
  if (!Number.isInteger(pid) || pid <= 0) fail('Headless launch returned an invalid PID.')
  if (payload.focus_stealing !== false) fail('Headless launch did not prove focus_stealing=false.')
  if (payload.terminal_window !== false) fail('Headless launch unexpectedly used a terminal window.')
  return { pid, desktop: nonEmptyString(payload.desktop, 'Returned desktop name') }
}

function selectHeadlessWindow(payload, expectedPid) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.windows)) {
    fail('Headless window enumeration returned an invalid payload.')
  }
  const pid = Number(expectedPid)
  // A NON-EMPTY TITLE is the discriminator, and leaving it out made this refuse every real run.
  //
  // Measured on this app's packaged build, one PID, on a headless desktop: 13 top-level windows,
  // of which TWO passed the class-and-size filter alone —
  //
  //   Chrome_WidgetWin_1   1416x908   title "nodeterm"   <- the application window
  //   Chrome_WidgetWin_0   1440x753   title ""           <- a same-PID helper
  //
  // The helper is not zero-sized, so the size floor cannot separate them, and it shares the class
  // prefix. Size and class together are simply not enough. The repository's own recorded lesson
  // says so in as many words — resolve by title AND class, never by index or by size — and this
  // filter predated that note by asking for neither.
  //
  // Titles are still not trusted to IDENTIFY the window: an exact match on "nodeterm" would break
  // the moment somebody renames the app, which this product explicitly lets a user do. Emptiness
  // is the honest test, because a window with no title is not the one a person is looking at. If a
  // future Electron gives the helper a title, two will match again and the count check below fails
  // LOUDLY rather than silently driving the wrong window.
  const matches = payload.windows.filter((window) => {
    const className = String(window.class ?? '')
    return (
      Number(window.process_id) === pid &&
      /^Chrome_WidgetWin_/u.test(className) &&
      Number(window.width) > 0 &&
      Number(window.height) > 0 &&
      String(window.title ?? '').trim() !== ''
    )
  })
  if (matches.length !== 1) {
    fail(`Expected exactly one PID ${pid} titled Chromium HWND; found ${matches.length}.`)
  }
  const handle = Number(matches[0].handle)
  if (!Number.isSafeInteger(handle) || handle <= 0) fail('Headless window returned an invalid HWND.')
  return {
    hwnd: handle,
    pid,
    className: String(matches[0].class),
    title: String(matches[0].title ?? ''),
    width: Number(matches[0].width),
    height: Number(matches[0].height)
  }
}

function validateProcessIdentity(payload, expectedPid, expectedExecutable) {
  if (!payload || payload.exists !== true) fail(`Expected process ${expectedPid} does not exist.`)
  const pid = Number(payload.pid)
  if (!Number.isInteger(pid) || pid <= 0 || pid !== Number(expectedPid)) {
    fail(`Process identity returned stale PID ${payload.pid}; expected ${expectedPid}.`)
  }
  const executable = requireAbsolute(payload.executable, `Executable path for PID ${pid}`)
  const expected = requireAbsolute(expectedExecutable, 'Expected packaged executable')
  if (canonical(executable) !== canonical(expected)) {
    fail(`PID ${pid} belongs to ${executable}, not the packaged candidate.`)
  }
  return { pid, executable, parentPid: Number(payload.parentPid) || null }
}

function validateCdpTargets(targets, options = {}) {
  if (!Array.isArray(targets)) fail('CDP /json/list response must be an array.')
  const pages = targets.filter((target) => target?.type === 'page' && !String(target.url ?? '').startsWith('devtools://'))
  if (pages.length !== 1) fail(`Expected exactly one non-devtools CDP page; found ${pages.length}.`)
  const page = pages[0]
  const url = new URL(nonEmptyString(page.url, 'CDP page URL'))
  if (url.protocol !== 'file:') fail(`Packaged renderer must use file:, received ${url.protocol}`)
  const pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/').toLocaleLowerCase('en-US')
  if (!pathname.endsWith('/out/renderer/index.html')) {
    fail(`CDP page is not the packaged renderer index: ${url.href}`)
  }
  if (options.expectedRendererFile) {
    const expected = canonical(requireAbsolute(options.expectedRendererFile, 'Expected packaged renderer file'))
    const actual = canonical(fileURLToPath(url))
    if (actual !== expected) {
      fail(`CDP page target does not match the exact candidate renderer: ${url.href}`)
    }
  }
  const webSocketDebuggerUrl = nonEmptyString(page.webSocketDebuggerUrl, 'CDP WebSocket URL')
  const socketUrl = new URL(webSocketDebuggerUrl)
  if (socketUrl.protocol !== 'ws:') fail('CDP debugger URL must use local unencrypted ws:.')
  if (socketUrl.hostname !== '127.0.0.1') fail('CDP debugger URL must be bound to 127.0.0.1.')
  if (options.expectedPort !== undefined && Number(socketUrl.port) !== validatePort(options.expectedPort, 'Expected CDP port')) {
    fail(`CDP debugger URL uses stale/wrong port ${socketUrl.port}.`)
  }
  return { id: String(page.id ?? ''), url: url.href, webSocketDebuggerUrl }
}

function validateContinuity(before, after) {
  const beforeMain = Number(before.mainPid)
  const afterMain = Number(after.mainPid)
  if (!Number.isInteger(beforeMain) || !Number.isInteger(afterMain) || beforeMain <= 0 || afterMain <= 0) {
    fail('Continuity evidence contains an invalid main-process PID.')
  }
  if (beforeMain === afterMain) fail('Relaunch reused the old main-process PID; the app was not proven closed.')
  const beforeHwnd = Number(before.hwnd)
  const afterHwnd = Number(after.hwnd)
  if (!Number.isSafeInteger(beforeHwnd) || !Number.isSafeInteger(afterHwnd) || beforeHwnd <= 0 || afterHwnd <= 0) {
    fail('Continuity evidence contains an invalid HWND.')
  }
  if (beforeHwnd === afterHwnd) fail('Relaunch reused the old HWND; dynamic re-enumeration was not proven.')
  const hostPid = Number(before.sessionHostPid)
  if (!Number.isInteger(hostPid) || hostPid <= 0 || Number(after.sessionHostPid) !== hostPid) {
    fail('Persistent session-host PID changed across app relaunch.')
  }
  const startedAt = nonEmptyString(before.sessionHostStartedAt, 'Session-host startedAt')
  if (after.sessionHostStartedAt !== startedAt) fail('Persistent session-host startedAt changed across app relaunch.')
  const protocolVersion = nonEmptyString(
    String(before.sessionHostProtocolVersion ?? ''),
    'Session-host protocol version'
  )
  if (String(after.sessionHostProtocolVersion ?? '') !== protocolVersion) {
    fail('Persistent session-host protocol version changed across app relaunch.')
  }
  const processPid = Number(before.terminalProcessPid)
  if (!Number.isInteger(processPid) || processPid <= 0 || Number(after.terminalProcessPid) !== processPid) {
    fail('Long-lived terminal process PID changed across app relaunch.')
  }
  const marker = nonEmptyString(before.marker, 'Continuity marker')
  if (after.marker !== marker || !String(after.screen ?? '').includes(marker)) {
    fail('Reattached screen does not contain the original continuity marker.')
  }
  if (Number(after.tick) <= Number(before.tick)) fail('Reattached session did not produce newer live output.')
  return { sessionHostPid: hostPid, terminalProcessPid: processPid, marker }
}

let crcTable
function pngCrc32(buffer) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      return value >>> 0
    })
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

function decodeAcceptancePng(png, id) {
  let offset = PNG_SIGNATURE.length
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let ended = false
  const compressed = []
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const crcStart = dataStart + length
    const end = crcStart + 4
    const type = png.subarray(typeStart, dataStart).toString('ascii')
    if (end > png.length) fail(`Evidence ${id} has a truncated PNG ${type} chunk.`)
    const expectedCrc = png.readUInt32BE(crcStart)
    const actualCrc = pngCrc32(png.subarray(typeStart, crcStart))
    if (actualCrc !== expectedCrc) fail(`Evidence ${id} has an invalid PNG ${type} CRC.`)
    const data = png.subarray(dataStart, crcStart)
    if (type === 'IHDR') {
      if (length !== 13 || width !== 0 || offset !== PNG_SIGNATURE.length) {
        fail(`Evidence ${id} has an invalid PNG IHDR.`)
      }
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        fail(`Evidence ${id} uses unsupported PNG compression, filtering, or interlacing.`)
      }
    } else if (type === 'IDAT') {
      compressed.push(data)
    } else if (type === 'IEND') {
      if (length !== 0) fail(`Evidence ${id} has an invalid PNG IEND.`)
      ended = true
      offset = end
      break
    }
    offset = end
  }
  if (!ended || offset !== png.length || width < 1_000 || height < 700 || compressed.length === 0) {
    fail(`Evidence ${id} is blank, truncated, or below the required 1000x700 rendered surface.`)
  }
  if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType)) {
    fail(`Evidence ${id} uses unsupported PNG bit depth/color type ${bitDepth}/${colorType}.`)
  }
  const bytesPerPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  const stride = width * bytesPerPixel
  let filtered
  try {
    filtered = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height })
  } catch (error) {
    fail(`Evidence ${id} has undecodable PNG image data: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (filtered.length !== (stride + 1) * height) fail(`Evidence ${id} has the wrong decoded PNG byte count.`)
  const pixels = Buffer.allocUnsafe(stride * height)
  let inputOffset = 0
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[inputOffset]
    inputOffset += 1
    if (filter > 4) fail(`Evidence ${id} has an invalid PNG row filter ${filter}.`)
    const rowOffset = row * stride
    for (let column = 0; column < stride; column += 1) {
      const raw = filtered[inputOffset]
      inputOffset += 1
      const left = column >= bytesPerPixel ? pixels[rowOffset + column - bytesPerPixel] : 0
      const above = row > 0 ? pixels[rowOffset - stride + column] : 0
      const upperLeft = row > 0 && column >= bytesPerPixel ? pixels[rowOffset - stride + column - bytesPerPixel] : 0
      const predictor =
        filter === 0 ? 0 :
          filter === 1 ? left :
            filter === 2 ? above :
              filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft)
      pixels[rowOffset + column] = (raw + predictor) & 0xff
    }
  }
  const distinct = new Set()
  const step = Math.max(1, Math.floor(pixels.length / 250_000))
  for (let index = 0; index < pixels.length && distinct.size < 8; index += step) distinct.add(pixels[index])
  if (distinct.size < 2) fail(`Evidence ${id} decodes to a uniform/blank rendered surface.`)
  return { width, height }
}

function validateEvidenceRecords(records, evidenceDirectory, options = {}) {
  if (!Array.isArray(records)) fail('Evidence records must be an array.')
  const required = options.requiredIds ?? REQUIRED_EVIDENCE_IDS
  const byId = new Map()
  for (const record of records) {
    const id = nonEmptyString(record?.id, 'Evidence id')
    if (byId.has(id)) fail(`Duplicate evidence id: ${id}`)
    byId.set(id, record)
  }
  for (const id of required) if (!byId.has(id)) fail(`Missing required evidence id: ${id}`)
  const output = []
  for (const id of required) {
    const record = byId.get(id)
    const file = requireInside(
      requireAbsolute(evidenceDirectory, 'Evidence directory'),
      requireAbsolute(record.file, `Evidence file ${id}`),
      `Evidence file ${id}`
    )
    const { stat } = requireFile(file, `Evidence file ${id}`)
    const minimumBytes = options.minimumCaptureBytes ?? MIN_CAPTURE_BYTES
    if (stat.size < minimumBytes) fail(`Evidence ${id} is too small/blank at ${stat.size} bytes.`)
    const png = fs.readFileSync(file)
    if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) fail(`Evidence ${id} is not a PNG.`)
    const actualSha256 = sha256File(file)
    if (Number(record.bytes) !== stat.size) fail(`Evidence ${id} byte count changed after capture.`)
    if (String(record.sha256 ?? '').toLocaleLowerCase('en-US') !== actualSha256) {
      fail(`Evidence ${id} SHA-256 changed after capture.`)
    }
    const { width, height } = decodeAcceptancePng(png, id)
    output.push({ id, file: path.basename(file), bytes: stat.size, width, height, sha256: actualSha256 })
  }
  if (new Set(output.map((record) => record.sha256)).size !== output.length) {
    fail('Two required evidence captures are byte-identical; at least one surface was not proven.')
  }
  return output
}

function validateProfileCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) fail('Windows terminal profile catalog must be non-empty.')
  const ids = new Set()
  const allowedKinds = new Set(['auto', 'pwsh', 'windows-powershell', 'cmd', 'git-bash', 'wsl', 'custom'])
  const publicKeys = new Set(['id', 'label', 'kind', 'available', 'unavailableReason'])
  for (const profile of catalog) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('Profile entries must be objects.')
    for (const key of Object.keys(profile)) {
      if (!publicKeys.has(key)) fail(`Public profile ${profile.id ?? '<unknown>'} leaked private field ${key}.`)
    }
    const id = nonEmptyString(profile.id, 'Profile id')
    nonEmptyString(profile.label, `Profile label for ${id}`)
    if (ids.has(id)) fail(`Duplicate Windows terminal profile id ${id}.`)
    ids.add(id)
    const kind = nonEmptyString(profile.kind, `Profile kind for ${id}`)
    if (!allowedKinds.has(kind)) fail(`Unsupported profile kind ${kind} for ${id}.`)
    if (typeof profile.available !== 'boolean') fail(`Profile ${id} must have a boolean available field.`)
    if (!profile.available) nonEmptyString(profile.unavailableReason, `Unavailable reason for ${id}`)
  }
  return catalog
}

function dialectForProfile(profile, catalog, customDialect) {
  validateProfileCatalog(catalog)
  const id = nonEmptyString(profile?.id, 'Profile id')
  const kind = nonEmptyString(profile?.kind, `Profile kind for ${id}`)
  if (kind === 'pwsh' || kind === 'windows-powershell') return 'powershell'
  if (kind === 'cmd') return 'cmd'
  if (kind === 'git-bash') return 'git-bash'
  if (kind === 'wsl') return 'wsl'
  if (kind === 'custom') {
    if (['powershell', 'cmd', 'git-bash'].includes(customDialect)) return customDialect
    fail(
      `Custom profile ${id} is available but no trusted command dialect was supplied; use powershell, cmd, or git-bash.`
    )
  }
  if (kind === 'auto') {
    const candidates = ['pwsh', 'windows-powershell', 'cmd']
    const concrete = candidates
      .map((candidateId) => catalog.find((candidate) => candidate.id === candidateId))
      .find((candidate) => candidate?.available)
    if (!concrete) fail('Auto is available but no concrete pwsh, Windows PowerShell, or cmd profile is available.')
    return dialectForProfile(concrete, catalog, customDialect)
  }
  fail(`Unsupported profile kind ${kind} for ${id}.`)
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function powershellSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function powershellProbeScript(marker, unicode, cwdPrefix, cwdSuffix, sizePrefix) {
  return [
    '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)',
    `Write-Output ${powershellSingleQuote(marker)}`,
    `Write-Output ${powershellSingleQuote(unicode)}`,
    `$ntcwd=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))`,
    `Write-Output (${powershellSingleQuote(cwdPrefix)} + $ntcwd + ${powershellSingleQuote(cwdSuffix)})`,
    `$nts=$Host.UI.RawUI.WindowSize; Write-Output (${powershellSingleQuote(sizePrefix)} + $nts.Width + 'x' + $nts.Height)`
  ].join('; ')
}

function buildProfileProbe(profile, catalog, options) {
  const dialect = dialectForProfile(profile, catalog, options.customDialect)
  const token = nonEmptyString(options.token, 'Probe token')
  // Profile IDs deliberately support WSL distribution names with spaces and punctuation. Keep
  // them out of command syntax *and* out of parse tags: terminal soft-wraps used to make a spaced
  // ID fail size parsing, while whitespace-compacting the cwd made "Project A" equal "ProjectA".
  const profileTag = crypto.createHash('sha256').update(String(profile.id), 'utf8').digest('hex').slice(0, 16)
  const tokenTag = crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12)
  const marker = `NT_PROFILE_OK:${profileTag}:${tokenTag}`
  const unicode = `NT_PROFILE_UNICODE:${profileTag}:雪λ`
  const cwdPrefix = `NT_PROFILE_CWD:${profileTag}:`
  const cwdSuffix = ':END'
  const sizePrefix = `NT_PROFILE_SIZE:${profileTag}:`
  let command
  if (dialect === 'powershell') {
    const encoded = Buffer.from(
      powershellProbeScript(marker, unicode, cwdPrefix, cwdSuffix, sizePrefix),
      'utf16le'
    ).toString('base64')
    // Invoke the profile's own PowerShell executable. The visible input contains only the encoded
    // script, so merely echoing the command cannot masquerade as successful probe output.
    command = `& (Get-Process -Id $PID).Path -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}\r`
  } else if (dialect === 'cmd') {
    // The profile itself is still cmd/ConPTY. An encoded PowerShell child produces deterministic
    // Unicode/cwd/size output without letting a WSL-derived profile id become cmd metasyntax.
    const encoded = Buffer.from(
      powershellProbeScript(marker, unicode, cwdPrefix, cwdSuffix, sizePrefix),
      'utf16le'
    ).toString('base64')
    command = `@powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}\r`
  } else {
    const cwdExpression = dialect === 'wsl' ? 'wslpath -w "$PWD"' : 'pwd -W'
    const script =
      `printf '%s\\n' ${shellSingleQuote(marker)}; ` +
      `printf '%s\\n' ${shellSingleQuote(unicode)}; ` +
      `ntcwd="$(${cwdExpression})"; ` +
      `ntcwdhex=$(printf '%s' "$ntcwd" | od -An -tx1 | tr -d ' \\n'); ` +
      `printf '%s%s%s\\n' ${shellSingleQuote(cwdPrefix)} "$ntcwdhex" ${shellSingleQuote(cwdSuffix)}; ` +
      `set -- $(stty size); printf '%s%sx%s\\n' ${shellSingleQuote(sizePrefix)} "$2" "$1"`
    const encoded = Buffer.from(script, 'utf8').toString('base64')
    command = `printf '%s' ${shellSingleQuote(encoded)} | base64 -d | sh\r`
  }
  return {
    dialect,
    marker,
    unicode,
    cwdPrefix,
    cwdSuffix,
    cwdEncoding: dialect === 'powershell' || dialect === 'cmd' ? 'base64' : 'hex',
    sizePrefix,
    command
  }
}

function normalizeProbeScreen(value) {
  // Only tags are compacted. Cwd bytes are decoded separately below, so a literal space in a path
  // remains data rather than becoming equivalent to no space.
  return String(value).replace(/\s+/gu, '')
}

function decodeProbeCwd(probe, screen) {
  const compact = normalizeProbeScreen(screen)
  const prefix = nonEmptyString(probe?.cwdPrefix, 'Probe cwd prefix')
  const suffix = nonEmptyString(probe?.cwdSuffix, 'Probe cwd suffix')
  const start = compact.lastIndexOf(prefix)
  if (start < 0) fail('Profile probe output is missing its cwd tag.')
  const encodedStart = start + prefix.length
  const end = compact.indexOf(suffix, encodedStart)
  if (end < 0) fail('Profile probe output is missing its cwd terminator.')
  const encoded = compact.slice(encodedStart, end)
  let bytes
  if (probe.cwdEncoding === 'base64') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
      fail('Profile probe cwd is not canonical base64.')
    }
    bytes = Buffer.from(encoded, 'base64')
  } else if (probe.cwdEncoding === 'hex') {
    if (!/^(?:[0-9a-fA-F]{2})+$/u.test(encoded)) fail('Profile probe cwd is not even-length hexadecimal.')
    bytes = Buffer.from(encoded, 'hex')
  } else {
    fail(`Unsupported profile probe cwd encoding ${probe.cwdEncoding}.`)
  }
  const cwd = bytes.toString('utf8')
  if (cwd.includes('\uFFFD') || /[\0\r\n]/u.test(cwd)) fail('Profile probe cwd is not a single valid UTF-8 path.')
  return cwd
}

function comparableWindowsPath(value) {
  const candidate = nonEmptyString(value, 'Windows cwd')
  if (!path.win32.isAbsolute(candidate)) fail(`Windows cwd is not absolute: ${candidate}`)
  return path.win32.normalize(candidate).replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US')
}

function parseProfileProbeOutput(probe, screen, expectedCwd) {
  const compact = normalizeProbeScreen(screen)
  const marker = nonEmptyString(probe?.marker, 'Probe marker')
  const unicode = nonEmptyString(probe?.unicode, 'Probe Unicode marker')
  const sizePrefix = nonEmptyString(probe?.sizePrefix, 'Probe size prefix')
  const sizeStart = compact.lastIndexOf(sizePrefix)
  const sizeMatch = sizeStart < 0 ? null : compact.slice(sizeStart + sizePrefix.length).match(/^(\d+)x(\d+)/u)
  const cwd = decodeProbeCwd(probe, screen)
  return {
    markerVerified: compact.includes(marker),
    unicodeVerified: compact.includes(unicode),
    cwd,
    cwdVerified: comparableWindowsPath(cwd) === comparableWindowsPath(expectedCwd),
    sizeVerified: Boolean(sizeMatch && Number(sizeMatch[1]) > 0 && Number(sizeMatch[2]) > 0),
    size: sizeMatch ? { cols: Number(sizeMatch[1]), rows: Number(sizeMatch[2]) } : null
  }
}

function validateProfileResults(catalog, results) {
  validateProfileCatalog(catalog)
  if (!Array.isArray(results)) fail('Profile results must be an array.')
  const expected = catalog.filter((profile) => profile?.available === true).map((profile) => String(profile.id))
  const actual = new Map()
  for (const result of results) {
    const id = nonEmptyString(result?.id, 'Profile result id')
    if (actual.has(id)) fail(`Duplicate packaged profile result for ${id}.`)
    actual.set(id, result)
  }
  for (const id of expected) {
    const result = actual.get(id)
    if (!result) fail(`Available profile ${id} was not exercised in the packaged app.`)
    if (result.labelVerified !== true) fail(`Available profile ${id} did not verify its visible label.`)
    if (result.inputOutputVerified !== true) fail(`Available profile ${id} did not verify input/output.`)
    if (result.unicodeVerified !== true) fail(`Available profile ${id} did not verify Unicode.`)
    if (result.cwdVerified !== true) fail(`Available profile ${id} did not verify cwd.`)
    if (result.sizeVerified !== true) fail(`Available profile ${id} did not report a PTY size.`)
    if (result.resizeVerified !== true) fail(`Available profile ${id} did not verify a live PTY resize.`)
  }
  for (const id of actual.keys()) {
    if (!expected.includes(id)) fail(`Packaged result ${id} does not correspond to an available profile.`)
  }
  return expected
}

function journaledNodeIds(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('Acceptance state journal must be an object.')
  const pending = state.pendingNodeIds ?? []
  const profiles = state.profiles ?? []
  if (!Array.isArray(pending) || !Array.isArray(profiles)) fail('Acceptance node journals must be arrays.')
  const ids = []
  const seen = new Set()
  const add = (value, label) => {
    const id = nonEmptyString(value, label)
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  pending.forEach((id, index) => add(id, `Pending node id ${index}`))
  profiles.forEach((profile, index) => add(profile?.nodeId, `Completed profile node id ${index}`))
  return ids
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Close one exact journaled UI identity without ever forgetting a process that may still be live.
 * The orchestrator injects its Cheap-route probes/actions; this pure state machine is unit-tested
 * against partial primary failure, fallback failure, and PID/HWND reuse refusal.
 */
async function closeTrackedIdentity(identity, actions) {
  if (!identity) return { current: null, errors: [], primaryAttempted: false, fallbackAttempted: false }
  if (!actions || typeof actions.isAlive !== 'function' || typeof actions.primary !== 'function' || typeof actions.fallback !== 'function') {
    fail('Tracked-close actions are incomplete.')
  }
  const errors = []
  let primaryAttempted = false
  let fallbackAttempted = false
  const alive = async (stage) => {
    try {
      return (await actions.isAlive(identity)) === true
    } catch (error) {
      errors.push(new Error(`${stage} liveness probe failed: ${errorMessage(error)}`))
      return true
    }
  }
  if (!(await alive('Initial'))) return { current: null, errors, primaryAttempted, fallbackAttempted }
  primaryAttempted = true
  try {
    await actions.primary(identity)
  } catch (error) {
    errors.push(new Error(`Primary graceful close failed: ${errorMessage(error)}`))
  }
  if (await alive('Post-primary')) {
    fallbackAttempted = true
    try {
      await actions.fallback(identity)
    } catch (error) {
      errors.push(new Error(`Exact-HWND fallback failed: ${errorMessage(error)}`))
    }
  }
  if (await alive('Final')) {
    errors.push(new Error(`Journaled packaged process PID ${identity.mainPid} remains alive after cleanup.`))
    return { current: identity, errors, primaryAttempted, fallbackAttempted }
  }
  return { current: null, errors, primaryAttempted, fallbackAttempted }
}

async function runWithCleanup(work, cleanup) {
  let primaryError
  try {
    return await work()
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await cleanup(primaryError)
    } catch (cleanupError) {
      if (primaryError) {
        primaryError.message = `${primaryError.message}\nCleanup also failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`
      } else {
        throw cleanupError
      }
    }
  }
}

async function runWithCleanupThenPromote(work, cleanup, promote) {
  const value = await runWithCleanup(work, cleanup)
  return promote(value)
}

module.exports = {
  DESKTOP_PREFIX,
  MIN_CAPTURE_BYTES,
  MIN_SETUP_BYTES,
  REQUIRED_ARTIFACT_ROLES,
  REQUIRED_EVIDENCE_IDS,
  SOURCE_FILES,
  SOURCE_ROOTS,
  artifactRecord,
  buildPackagedLaunchCommand,
  buildProfileProbe,
  canonical,
  closeTrackedIdentity,
  createBuildProvenance,
  createAcceptancePlan,
  createSourceSnapshot,
  digestSourceRecords,
  expectedArtifactPaths,
  isInside,
  journaledNodeIds,
  newestShippingInput,
  parseJsonDocument,
  parseProfileProbeOutput,
  quoteWindowsArg,
  readGitHead,
  requireInside,
  runWithCleanup,
  runWithCleanupThenPromote,
  selectHeadlessWindow,
  sha256File,
  validateCandidateProvenance,
  validateCdpTargets,
  validateCheapInvocation,
  validateContinuity,
  validateDesktopName,
  validateEvidenceRecords,
  validateIsolation,
  validateLaunchResult,
  validatePort,
  validateProcessIdentity,
  validateProfileResults,
  validateProfileCatalog,
  validateSourceSnapshot,
  dialectForProfile
}
