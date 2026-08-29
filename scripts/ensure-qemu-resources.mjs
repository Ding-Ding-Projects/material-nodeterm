#!/usr/bin/env node
/*
 * Prepare the pinned QEMU payload used by the Linux ISO VM node.
 *
 * The installer and checksum document are fetched only from the allowlisted canonical HTTPS
 * origin. Downloads are streamed with both Content-Length and hard byte limits. Extraction happens
 * in a fresh, no-reparse staging directory; only the two validated PE executables are published.
 * Runtime never downloads or searches PATH.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'dependencies.manifest.json'), 'utf8'))
const qemu = manifest.qemu
const MAX_INSTALLER_BYTES = 256 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 64 * 1024
const EXPECTED = ['qemu-system-x86_64.exe', 'qemu-img.exe']
const ALLOWED_HOST = 'qemu.weilnetz.de'

function fail(message) { throw new Error(message) }
function safeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../') && !normalized.includes('\0')
}
function inside(base, candidate) {
  const b = path.resolve(base)
  const c = path.resolve(candidate)
  return c === b || c.startsWith(b + path.sep)
}
async function noReparse(target) {
  const resolved = path.resolve(target)
  const parsed = path.parse(resolved)
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  let current = parsed.root
  for (const part of parts) {
    current = path.join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) fail(`QEMU staging refuses a symbolic link at ${current}.`)
      const actual = await realpath(current)
      if (actual.toLowerCase() !== path.normalize(current).toLowerCase()) fail(`QEMU staging refuses a reparse point at ${current}.`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}
async function fileExists(target) {
  try { return (await lstat(target)).isFile() } catch { return false }
}
async function pathExists(target) {
  try { await lstat(target); return true } catch { return false }
}
function assertUrl(value, label) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || url.username || url.password || url.port) {
    fail(`${label} must be HTTPS on ${ALLOWED_HOST} without credentials.`)
  }
  return url
}
async function streamedDownload(url, destination, limit, label) {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok || !response.body) fail(`${label} returned HTTP ${response.status}.`)
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > limit) fail(`${label} Content-Length exceeds the ${limit}-byte limit.`)
  const handle = await import('node:fs/promises').then((fs) => fs.open(destination, 'wx', 0o600))
  let total = 0
  const hash = createHash('sha512')
  const reader = response.body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const bytes = Buffer.from(chunk.value)
      total += bytes.byteLength
      if (total > limit) fail(`${label} exceeded the ${limit}-byte hard limit while streaming.`)
      hash.update(bytes)
      await handle.write(bytes)
    }
  } finally {
    await reader.cancel().catch(() => {})
    await handle.close()
  }
  return { bytes: total, sha512: hash.digest('hex') }
}
function checksumFromDocument(text, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = new RegExp(`^\\s*([0-9a-f]{128})\\s+[* ]?${escaped}\\s*$`, 'im').exec(text)
  return line ? { sha512: line[1].toLowerCase(), filename } : null
}
async function runVersion(executable, expected, label) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 5000)
    child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk.toString('utf8')).slice(-4096) })
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-4096) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      const output = (stdout + '\n' + stderr).trim()
      if (timedOut) reject(new Error(`${label} version probe timed out.`))
      else if (code !== 0 || !output.includes(String(expected))) reject(new Error(`${label} reported an unexpected version: ${output.slice(0, 300)}`))
      else resolve(output)
    })
  })
}
async function verifyPe(file, label) {
  const handle = await import('node:fs/promises').then((fs) => fs.open(file, 'r'))
  try {
    const header = Buffer.alloc(64)
    await handle.read(header, 0, 64, 0)
    if (header.toString('ascii', 0, 2) !== 'MZ') fail(`${label} is not a PE executable (missing MZ).`)
    const offset = header.readUInt32LE(0x3c)
    const signature = Buffer.alloc(4)
    await handle.read(signature, 0, 4, offset)
    if (signature.toString('ascii') !== 'PE\0\0') fail(`${label} is not a PE executable (missing PE signature).`)
  } finally { await handle.close() }
}
async function walkFiles(rootDir) {
  const files = []
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      const info = await lstat(target)
      if (info.isSymbolicLink()) fail(`QEMU installer produced a symbolic link: ${target}`)
      if (info.isDirectory()) await visit(target)
      else if (info.isFile()) files.push(target)
      else fail(`QEMU installer produced an unsupported payload entry: ${target}`)
    }
  }
  await visit(rootDir)
  return files
}
async function sha256(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}
async function renameRetry(from, to) {
  let last
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await rename(from, to); return } catch (error) {
      last = error
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
  throw last
}

if (process.platform !== 'win32') fail('The pinned QEMU resource bootstrap currently supports Windows x64 only.')
if (!qemu || qemu.version !== '10.1.0' || typeof qemu.source !== 'string' || typeof qemu.checksumSource !== 'string' || !/^[0-9a-f]{128}$/i.test(qemu.sha512)) {
  fail('dependencies.manifest.json has no valid pinned QEMU source and SHA-512 entry.')
}
if (qemu.platform !== 'windows-x64' || !Array.isArray(qemu.payload) || qemu.payload.length !== EXPECTED.length ||
  EXPECTED.some((name) => !qemu.payload.some((entry) => entry?.path === `qemu/${name}` && entry.required === true))) fail('The QEMU manifest payload is incomplete.')
const sourceUrl = assertUrl(qemu.source, 'QEMU installer URL')
const checksumUrl = assertUrl(qemu.checksumSource, 'QEMU checksum URL')
const outputArg = process.argv.indexOf('--output')
const output = path.resolve(outputArg >= 0 && process.argv[outputArg + 1] ? process.argv[outputArg + 1] : path.join(root, 'resources', 'qemu'))
if (!inside(root, output)) fail('QEMU output must remain inside this checkout.')
await noReparse(output)
await mkdir(path.dirname(output), { recursive: true })
await noReparse(path.dirname(output))

const existingManifest = path.join(output, 'manifest.json')
let existingValid = false
try {
  const current = JSON.parse(await readFile(existingManifest, 'utf8'))
  existingValid = current.version === qemu.version && Array.isArray(current.files) && current.files.length === EXPECTED.length &&
    new Set(current.files.map((entry) => entry.path)).size === EXPECTED.length && EXPECTED.every((name) => current.files.some((entry) => entry.path === name))
  if (existingValid) {
    for (const entry of current.files) {
      if (!safeRelative(entry.path) || !EXPECTED.includes(entry.path)) { existingValid = false; break }
      const target = path.join(output, entry.path)
      if (!inside(output, target) || !(await fileExists(target)) || await sha256(target) !== entry.sha256) { existingValid = false; break }
      await verifyPe(target, entry.path)
      await runVersion(target, qemu.version, entry.path)
    }
  }
} catch { existingValid = false }
if (existingValid) {
  console.log(`QEMU ${qemu.version} payload already present and reverified. ${qemu.installerSizeDisclosure}.`)
  process.exit(0)
}

const stage = await mkdtemp(path.join(path.dirname(output), '.qemu-staging-'))
const installer = path.join(stage, 'qemu-setup.exe')
try {
  const checksumPart = path.join(stage, 'qemu.sha512')
  await streamedDownload(checksumUrl, checksumPart, MAX_CHECKSUM_BYTES, 'QEMU checksum document')
  const checksumText = await readFile(checksumPart, 'utf8')
  const installerName = path.basename(sourceUrl.pathname)
  const published = checksumFromDocument(checksumText, installerName)
  if (!published || published.sha512 !== qemu.sha512.toLowerCase()) fail(`QEMU checksum document does not bind the expected installer ${installerName} to the manifest SHA-512.`)
  const downloaded = await streamedDownload(sourceUrl, installer, MAX_INSTALLER_BYTES, 'QEMU installer')
  if (downloaded.sha512.toLowerCase() !== qemu.sha512.toLowerCase()) fail(`QEMU installer SHA-512 mismatch: expected ${qemu.sha512}, actual ${downloaded.sha512}.`)
  await chmod(installer, 0o700)
  const extraction = path.join(stage, 'install')
  await mkdir(extraction, { recursive: true })
  await noReparse(extraction)
  await new Promise((resolve, reject) => {
    const child = spawn(installer, ['/S', `/D=${extraction}`], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 5 * 60 * 1000)
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-8192) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); timedOut ? reject(new Error('QEMU installer exceeded the extraction timeout.')) : code === 0 ? resolve() : reject(new Error(`QEMU installer exited with code ${code}: ${stderr}`)) })
  })
  const files = await walkFiles(extraction)
  const byName = new Map(files.map((file) => [path.basename(file).toLowerCase(), file]))
  const selected = EXPECTED.map((name) => byName.get(name.toLowerCase()))
  if (selected.some((file) => !file)) fail('QEMU installer did not produce both required executables.')
  const payloadDir = path.join(stage, 'payload')
  await mkdir(payloadDir, { recursive: true })
  const readme = path.join(output, 'README.md')
  if (await fileExists(readme)) await copyFile(readme, path.join(payloadDir, 'README.md'))
  const records = []
  for (let i = 0; i < EXPECTED.length; i++) {
    const target = path.join(payloadDir, EXPECTED[i])
    await import('node:fs/promises').then((fs) => fs.copyFile(selected[i], target))
    await verifyPe(target, EXPECTED[i])
    const version = await runVersion(target, qemu.version, EXPECTED[i])
    records.push({ path: EXPECTED[i], bytes: (await stat(target)).size, sha256: await sha256(target), version: version.split('\n')[0] })
  }
  const payloadManifest = { schemaVersion: 1, version: qemu.version, sourceRevision: qemu.sourceRevision, license: qemu.license, notices: qemu.notices, installer: { url: sourceUrl.href, sha512: qemu.sha512, bytes: downloaded.bytes }, files: records }
  await writeFile(path.join(payloadDir, 'manifest.json.tmp'), JSON.stringify(payloadManifest, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(path.join(payloadDir, 'manifest.json.tmp'), path.join(payloadDir, 'manifest.json'))
  await noReparse(payloadDir)
  const backup = `${output}.${process.pid}.previous`
  await rm(backup, { recursive: true, force: true })
  if (await pathExists(output)) await renameRetry(output, backup)
  await renameRetry(payloadDir, output)
  await rm(backup, { recursive: true, force: true })
  console.log(`QEMU ${qemu.version} verified, PE-checked, version-checked, and published with per-file SHA-256 records. ${qemu.installerSizeDisclosure}.`)
} finally {
  await rm(stage, { recursive: true, force: true }).catch(() => {})
}
