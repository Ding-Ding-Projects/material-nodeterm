import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseSquirrelFixtureArgs,
  SQUIRREL_FIXTURE_HOST,
  squirrelFixtureUsage,
  startSquirrelFixtureServer,
} from './serve-squirrel-update-fixture.mjs'

const SCRIPT = resolve(fileURLToPath(new URL('.', import.meta.url)), 'serve-squirrel-update-fixture.mjs')
const SETUP = 'nodeterm-Setup-0.4.0-fixture.2.exe'
const FULL = 'node-terminal-squirrel-fixture-0.4.0-fixture2-full.nupkg'
const FULL_BYTES = Buffer.from('fixture full package with discriminating bytes\n')

function sha1(value) {
  return createHash('sha1').update(value).digest('hex')
}

function releaseLine(name, bytes, hash = sha1(bytes), size = bytes.length) {
  return `${hash.toUpperCase()} ${name} ${size}`
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'nodeterm-squirrel-feed-'))
  writeFileSync(join(root, SETUP), Buffer.from('fixture setup\n'))
  writeFileSync(join(root, FULL), FULL_BYTES)
  writeFileSync(join(root, 'RELEASES'), `${releaseLine(FULL, FULL_BYTES)}\r\n`)
  return root
}

function rawRequest(port, target, method = 'GET') {
  return new Promise((resolvePromise, reject) => {
    const outgoing = request(
      {
        host: SQUIRREL_FIXTURE_HOST,
        method,
        path: target,
        port,
        agent: false,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          resolvePromise({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode,
          })
        })
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })
}

describe('local Squirrel update fixture server', () => {
  const roots = []
  const running = []

  afterEach(async () => {
    await Promise.allSettled(running.splice(0).map((fixture) => fixture.close()))
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
  })

  async function start(root = makeFixture(), options) {
    roots.push(root)
    const fixture = await startSquirrelFixtureServer(root, options)
    running.push(fixture)
    return fixture
  }

  it('binds loopback on a collision-free ephemeral port and serves exact validated bytes', async () => {
    const fixture = await start()

    expect(fixture.host).toBe('127.0.0.1')
    expect(fixture.port).toBeGreaterThan(0)
    expect(fixture.feedURL).toBe(`http://127.0.0.1:${fixture.port}`)
    expect(fixture.assetNames).toEqual(['RELEASES', FULL])

    const releases = await rawRequest(fixture.port, '/RELEASES')
    expect(releases.status).toBe(200)
    expect(releases.body.toString('utf8')).toBe(`${releaseLine(FULL, FULL_BYTES)}\r\n`)
    expect(releases.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(releases.headers['cache-control']).toBe('no-store')
    expect(Number(releases.headers['content-length'])).toBe(releases.body.length)

    const full = await rawRequest(fixture.port, `/${FULL}`)
    expect(full.status).toBe(200)
    expect(full.body).toEqual(FULL_BYTES)
    expect(full.headers['content-type']).toBe('application/octet-stream')
    expect(Number(full.headers['content-length'])).toBe(FULL_BYTES.length)
  })

  it('gives HEAD the same asset metadata without sending response bytes', async () => {
    const fixture = await start()

    const releaseHead = await rawRequest(fixture.port, '/RELEASES', 'HEAD')
    expect(releaseHead.status).toBe(200)
    expect(releaseHead.body).toHaveLength(0)
    expect(Number(releaseHead.headers['content-length'])).toBe(Buffer.byteLength(`${releaseLine(FULL, FULL_BYTES)}\r\n`))

    const packageHead = await rawRequest(fixture.port, `/${FULL}`, 'HEAD')
    expect(packageHead.status).toBe(200)
    expect(packageHead.body).toHaveLength(0)
    expect(Number(packageHead.headers['content-length'])).toBe(FULL_BYTES.length)
  })

  it.each(['/../RELEASES', '/%2e%2e/RELEASES', '/%52ELEASES', '/RELEASES?cache=1', '//RELEASES'])(
    'does not normalize traversal-shaped or non-exact request target %s into an asset',
    async (target) => {
      const fixture = await start()
      const response = await rawRequest(fixture.port, target)
      expect(response.status).toBe(404)
      expect(response.body.toString('utf8')).toBe('Fixture asset not found.\n')
    },
  )

  it('does not expose the installer, directory, or arbitrary local files', async () => {
    const fixture = await start()
    for (const target of ['/', `/${SETUP}`, '/package.json', '/missing-full.nupkg']) {
      expect((await rawRequest(fixture.port, target)).status).toBe(404)
    }
  })

  it('rejects unsupported methods with an explicit GET/HEAD contract', async () => {
    const fixture = await start()
    const response = await rawRequest(fixture.port, '/RELEASES', 'POST')

    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET, HEAD')
    expect(response.body.toString('utf8')).toBe('Method not allowed.\n')
  })

  it('refuses malformed assets before opening a listener', async () => {
    const root = makeFixture()
    roots.push(root)
    writeFileSync(join(root, 'RELEASES'), `${releaseLine(FULL, FULL_BYTES, '0'.repeat(40))}\n`)

    await expect(startSquirrelFixtureServer(root)).rejects.toThrow('RELEASES SHA1 mismatch')
  })

  it('refuses a feed that advertises an unsupported delta instead of serving an incomplete index', async () => {
    const root = makeFixture()
    roots.push(root)
    const deltaName = 'node-terminal-squirrel-fixture-0.4.0-fixture2-delta.nupkg'
    const deltaBytes = Buffer.from('fixture delta\n')
    writeFileSync(join(root, deltaName), deltaBytes)
    writeFileSync(
      join(root, 'RELEASES'),
      `${releaseLine(FULL, FULL_BYTES)}\n${releaseLine(deltaName, deltaBytes)}\n`,
    )

    await expect(startSquirrelFixtureServer(root)).rejects.toThrow('must reference only full .nupkg files')
  })

  it('returns a deterministic service failure if a validated asset changes or disappears', async () => {
    const root = makeFixture()
    const fixture = await start(root)

    const packagePath = join(root, FULL)
    writeFileSync(packagePath, Buffer.alloc(FULL_BYTES.length, 0x78))
    const changedTime = new Date(Date.now() + 60_000)
    utimesSync(packagePath, changedTime, changedTime)
    let response = await rawRequest(fixture.port, `/${FULL}`)
    expect(response.status).toBe(503)
    expect(response.body.toString('utf8')).toBe('Fixture asset is no longer available.\n')

    unlinkSync(join(root, 'RELEASES'))
    response = await rawRequest(fixture.port, '/RELEASES')
    expect(response.status).toBe(503)
  })

  it('lets concurrent default servers coexist and refuses an explicitly occupied port', async () => {
    const first = await start()
    const second = await start()
    expect(second.port).not.toBe(first.port)

    const thirdRoot = makeFixture()
    roots.push(thirdRoot)
    await expect(startSquirrelFixtureServer(thirdRoot, { port: first.port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  })

  it('closes idempotently and becomes unreachable instead of leaving a hidden listener', async () => {
    const fixture = await start()
    const { port } = fixture
    await fixture.close()
    await fixture.close()

    await expect(rawRequest(port, '/RELEASES')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('parses bounded ports and prints standalone CLI usage', () => {
    expect(parseSquirrelFixtureArgs(['output', '--port=0'])).toEqual({
      directory: 'output',
      help: false,
      port: 0,
    })
    expect(parseSquirrelFixtureArgs(['--port', '65535', 'output'])).toEqual({
      directory: 'output',
      help: false,
      port: 65_535,
    })
    expect(() => parseSquirrelFixtureArgs(['--port', '65536'])).toThrow('0 to 65535')
    expect(() => parseSquirrelFixtureArgs(['--port', '-1'])).toThrow('0 to 65535')
    expect(() => parseSquirrelFixtureArgs(['one', 'two'])).toThrow('unexpected extra argument')
    expect(squirrelFixtureUsage()).toContain('binds 127.0.0.1 only')

    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' })
    expect(help.status, help.stderr).toBe(0)
    expect(help.stdout).toContain('Usage:')
    expect(help.stdout).toContain('collision-free ephemeral port')
  })
})
