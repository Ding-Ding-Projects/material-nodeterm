#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SQUIRREL_FIXTURE_HOST = '127.0.0.1'

const DEFAULT_DIRECTORY = 'dist/squirrel-windows'
const SETUP_RE = /^.+-Setup-.+\.exe$/i
const PACKAGE_RE = /\.nupkg$/i
const FULL_PACKAGE_RE = /-full\.nupkg$/i
const RELEASE_LINE_RE = /^([0-9a-f]{40})\s+(\S+)\s+(\d+)$/i

export function squirrelFixtureUsage() {
  return [
    'Usage:',
    '  node scripts/serve-squirrel-update-fixture.mjs [squirrel-output-directory] [--port <0-65535>]',
    '  node scripts/serve-squirrel-update-fixture.mjs --help',
    '',
    `The directory defaults to ${DEFAULT_DIRECTORY}. The server binds ${SQUIRREL_FIXTURE_HOST} only.`,
    'Port 0 (the default) asks the OS for a collision-free ephemeral port.',
  ].join('\n')
}

function parsePort(value) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`fixture port must be an integer from 0 to 65535, got ${JSON.stringify(value)}`)
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`fixture port must be an integer from 0 to 65535, got ${JSON.stringify(value)}`)
  }
  return port
}

export function parseSquirrelFixtureArgs(argv) {
  let directory = DEFAULT_DIRECTORY
  let directorySeen = false
  let port = 0

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true, directory, port }
    if (argument === '--port') {
      if (index + 1 >= argv.length) throw new Error('--port requires a value')
      port = parsePort(argv[index + 1])
      index += 1
      continue
    }
    if (argument.startsWith('--port=')) {
      port = parsePort(argument.slice('--port='.length))
      continue
    }
    if (argument.startsWith('-')) throw new Error(`unknown option: ${argument}`)
    if (directorySeen) throw new Error(`unexpected extra argument: ${argument}`)
    directory = argument
    directorySeen = true
  }

  return { help: false, directory, port }
}

function parseFixtureReleases(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) throw new Error('RELEASES is empty')

  const names = new Set()
  return lines.map((line, index) => {
    const match = RELEASE_LINE_RE.exec(line)
    if (!match) {
      throw new Error(`RELEASES line ${index + 1} must contain a 40-hex SHA1, package name, and byte size`)
    }
    const [, sha1, name, sizeRaw] = match
    if (path.basename(name) !== name || name === '.' || name === '..' || /[\\/\r\n]/.test(name)) {
      throw new Error(`RELEASES line ${index + 1} contains an unsafe package name: ${JSON.stringify(name)}`)
    }
    if (!FULL_PACKAGE_RE.test(name)) {
      throw new Error(`fixture RELEASES must reference only full .nupkg files; unsupported entry: ${name}`)
    }
    if (names.has(name)) throw new Error(`RELEASES contains duplicate package entry: ${name}`)
    names.add(name)
    const size = Number(sizeRaw)
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`RELEASES line ${index + 1} has an invalid package size: ${sizeRaw}`)
    }
    return { name, sha1: sha1.toLowerCase(), size }
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

async function fixtureFile(root, entry) {
  if (!entry.isFile()) throw new Error(`fixture asset must be a regular file: ${entry.name}`)
  const file = path.resolve(root, entry.name)
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`fixture asset must be a regular file: ${entry.name}`)
  if (info.size <= 0) throw new Error(`fixture asset is empty: ${entry.name}`)
  return { mtimeMs: info.mtimeMs, name: entry.name, path: file, size: info.size }
}

async function prepareFixture(directory) {
  const root = path.resolve(directory)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    throw new Error(`could not read Squirrel fixture directory ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const setups = entries.filter((entry) => SETUP_RE.test(entry.name))
  if (setups.length !== 1) throw new Error(`expected exactly one *-Setup-*.exe, found ${setups.length}`)
  await fixtureFile(root, setups[0])

  const releaseEntries = entries.filter((entry) => entry.name === 'RELEASES')
  if (releaseEntries.length !== 1) throw new Error(`expected exactly one RELEASES file, found ${releaseEntries.length}`)
  const releaseFile = await fixtureFile(root, releaseEntries[0])
  const releaseBytes = await readFile(releaseFile.path)
  const rows = parseFixtureReleases(releaseBytes.toString('utf8'))

  const packageEntries = entries.filter((entry) => PACKAGE_RE.test(entry.name))
  if (packageEntries.length === 0) throw new Error('expected at least one *-full.nupkg')
  const packages = []
  for (const entry of packageEntries) packages.push(await fixtureFile(root, entry))
  const rowsByName = new Map(rows.map((row) => [row.name, row]))
  const packagesByName = new Map(packages.map((asset) => [asset.name, asset]))
  for (const row of rows) {
    const asset = packagesByName.get(row.name)
    if (!asset) throw new Error(`RELEASES references a package that is missing on disk: ${row.name}`)
    if (asset.size !== row.size) {
      throw new Error(`RELEASES size mismatch for ${row.name}: recorded ${row.size}, actual ${asset.size}`)
    }
    const actualSha1 = await sha1File(asset.path)
    if (actualSha1 !== row.sha1) {
      throw new Error(`RELEASES SHA1 mismatch for ${row.name}: recorded ${row.sha1}, actual ${actualSha1}`)
    }
  }
  for (const asset of packages) {
    if (!rowsByName.has(asset.name)) throw new Error(`package is not listed in RELEASES: ${asset.name}`)
  }

  const assets = new Map()
  assets.set('/RELEASES', {
    name: 'RELEASES',
    path: releaseFile.path,
    size: releaseBytes.length,
    mtimeMs: releaseFile.mtimeMs,
    contentType: 'text/plain; charset=utf-8',
  })

  for (const row of rows) {
    const packageAsset = packagesByName.get(row.name)
    assets.set(`/${row.name}`, {
      name: row.name,
      path: packageAsset.path,
      size: row.size,
      mtimeMs: packageAsset.mtimeMs,
      contentType: 'application/octet-stream',
    })
  }

  return { root, assets }
}

function sendText(request, response, statusCode, text, extraHeaders = {}) {
  const body = Buffer.from(text, 'utf8')
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  if (request.method === 'HEAD') response.end()
  else response.end(body)
}

async function serveRequest(fixture, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(request, response, 405, 'Method not allowed.\n', { Allow: 'GET, HEAD' })
    return
  }

  // Match the raw origin-form request target instead of URL-normalizing it. Normalization could
  // turn an encoded or dot-segment traversal probe into a valid asset route.
  const asset = typeof request.url === 'string' ? fixture.assets.get(request.url) : undefined
  if (!asset) {
    sendText(request, response, 404, 'Fixture asset not found.\n')
    return
  }

  try {
    const current = await stat(asset.path)
    if (!current.isFile() || current.size !== asset.size || current.mtimeMs !== asset.mtimeMs) {
      throw new Error('asset changed after validation')
    }
  } catch {
    sendText(request, response, 503, 'Fixture asset is no longer available.\n')
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': asset.size,
    'Content-Type': asset.contentType,
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }

  const stream = createReadStream(asset.path, { start: 0, end: asset.size - 1 })
  stream.on('error', () => response.destroy())
  stream.pipe(response)
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: SQUIRREL_FIXTURE_HOST, port, exclusive: true })
  })
}

/** Validate a Squirrel asset directory, then expose its update feed on IPv4 loopback only. */
export async function startSquirrelFixtureServer(directory = DEFAULT_DIRECTORY, options = {}) {
  const port = options.port === undefined ? 0 : parsePort(String(options.port))
  const fixture = await prepareFixture(directory)
  const server = createServer((request, response) => {
    void serveRequest(fixture, request, response).catch(() => {
      if (!response.headersSent) sendText(request, response, 500, 'Fixture request failed.\n')
      else response.destroy()
    })
  })
  server.keepAliveTimeout = 1_000

  try {
    await listen(server, port)
  } catch (error) {
    server.close()
    throw error
  }

  const address = server.address()
  if (!address || typeof address === 'string' || address.address !== SQUIRREL_FIXTURE_HOST) {
    server.close()
    throw new Error('fixture server did not bind the required IPv4 loopback address')
  }

  let closed = false
  return {
    feedURL: `http://${SQUIRREL_FIXTURE_HOST}:${address.port}`,
    host: address.address,
    port: address.port,
    assetNames: [...fixture.assets.values()].map((asset) => asset.name),
    server,
    close() {
      if (closed) return Promise.resolve()
      closed = true
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeIdleConnections?.()
      })
    },
  }
}

async function main(argv) {
  const parsed = parseSquirrelFixtureArgs(argv)
  if (parsed.help) {
    console.log(squirrelFixtureUsage())
    return
  }

  const fixture = await startSquirrelFixtureServer(parsed.directory, { port: parsed.port })
  console.log(`Validated Squirrel fixture assets in ${path.resolve(parsed.directory)}`)
  console.log(`Squirrel fixture feed: ${fixture.feedURL}`)
  console.log(`PowerShell: $env:NODETERM_SQUIRREL_FIXTURE_URL='${fixture.feedURL}'`)
  console.log('Press Ctrl+C to stop.')

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await fixture.close()
  }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Squirrel fixture server failed: ${error instanceof Error ? error.message : String(error)}`)
    console.error(squirrelFixtureUsage())
    process.exitCode = 1
  })
}
