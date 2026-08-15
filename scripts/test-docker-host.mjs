#!/usr/bin/env node
// Real container smoke for the Server Edition image. This intentionally lives outside `npm test`:
// it needs a running Docker daemon and performs a full image build unless --no-build is supplied.
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const valueAfter = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : argv[index + 1]
}

const stamp = `${process.pid}-${Date.now().toString(36)}`
const explicitImage = valueAfter('--image', undefined)
const shouldBuild = !argv.includes('--no-build')
if (argv.includes('--image') && !explicitImage) throw new Error('--image requires a tag')
if (!shouldBuild && !explicitImage) throw new Error('--no-build requires --image <existing-tag>')
const image = explicitImage || `nodeterm-server:smoke-${stamp}`
const removeImageWhenDone = !explicitImage
const container = `nodeterm-docker-smoke-${stamp}`
const volume = `${container}-data`
const outsideVolume = `${container}-outside`
const firstPassword = crypto.randomBytes(24).toString('base64url')
const replacementPassword = crypto.randomBytes(24).toString('base64url')

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    env: options.env || process.env
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`docker ${args.join(' ')} exited ${result.status}${detail ? `\n${detail}` : ''}`)
  }
  return result
}

function output(args) {
  return docker(args).stdout.trim()
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitHealthy() {
  let last = 'missing'
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = docker(
      ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', container],
      { allowFailure: true }
    )
    last = result.status === 0 ? result.stdout.trim() : 'missing'
    if (last === 'healthy') return
    if (last === 'unhealthy' || last === 'exited' || last === 'dead') {
      throw new Error(`container became ${last}\n${output(['logs', container])}`)
    }
    await delay(1_000)
  }
  throw new Error(`container did not become healthy (last state: ${last})`)
}

function publishedPort() {
  const line = output(['port', container, '8443/tcp']).split(/\r?\n/)[0]
  const match = line.match(/:(\d+)$/)
  if (!match) throw new Error(`could not parse published port from ${JSON.stringify(line)}`)
  return Number(match[1])
}

async function login(port, password) {
  return fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
    redirect: 'manual'
  })
}

function start(password) {
  const env = { ...process.env, NODETERM_SERVER_PASSWORD: password }
  docker([
    'run', '-d', '--name', container,
    '-p', '127.0.0.1::8443',
    '-e', 'NODETERM_SERVER_PASSWORD',
    '-v', `${volume}:/data`,
    image
  ], { env })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertLocalDaemon() {
  const endpoint = process.env.DOCKER_HOST || output(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  assert(/^(?:unix|npipe):\/\//.test(endpoint), `Docker host smoke requires a local daemon socket, got ${JSON.stringify(endpoint)}`)
}

let containerCreated = false
let volumeCreated = false
let outsideVolumeCreated = false
let imageCreated = false

try {
  docker(['info'])
  assertLocalDaemon()
  if (shouldBuild) {
    docker(['build', '--progress=plain', '-t', image, '.'], { capture: false })
    imageCreated = true
  }

  docker(['volume', 'create', volume])
  volumeCreated = true
  docker(['volume', 'create', outsideVolume])
  outsideVolumeCreated = true

  // Reproduce an upgrade from the original root-running image, and put a second root-owned mount
  // at an operator-controlled data-dir value. The entrypoint must migrate literal /data only.
  docker([
    'run', '--rm', '--user', '0', '--entrypoint', 'sh',
    '-v', `${volume}:/data`,
    '-v', `${outsideVolume}:/outside`,
    image,
    '-c', "printf '%s\n' legacy-root-seed > /data/legacy-root-seed; printf '%s\n' do-not-chown > /outside/sentinel; chown -R 0:0 /data /outside"
  ])
  docker([
    'run', '--rm',
    '-e', 'NODETERM_DATA_DIR=/outside',
    '-v', `${volume}:/data`,
    '-v', `${outsideVolume}:/outside`,
    image,
    'sh', '-c',
    "test \"$(id -u)\" = 1000 && test \"$(stat -c %u /data/legacy-root-seed)\" = 1000 && test \"$(stat -c %u /outside/sentinel)\" = 0"
  ])
  // A partially migrated volume has a node-owned mount root but can still contain an unreadable
  // root-owned descendant. Seed that exact shape after the full-volume migration probe.
  docker([
    'run', '--rm', '--user', '0', '--entrypoint', 'sh',
    '-v', `${volume}:/data`,
    image,
    '-c', "printf '%s\n' mixed-root-seed > /data/mixed-root-seed; chmod 600 /data/mixed-root-seed; chown 0:0 /data/mixed-root-seed"
  ])

  start(firstPassword)
  containerCreated = true
  await waitHealthy()

  const port = publishedPort()
  const loginPage = await fetch(`http://127.0.0.1:${port}/login`)
  assert(loginPage.status === 200, `/login returned ${loginPage.status}`)
  assert((await loginPage.text()).includes('Sign in'), '/login did not render the auth page')

  const pid1Uid = output(['exec', '--user', '1000:1000', container, 'sh', '-c', "awk '/^Uid:/{print $2}' /proc/1/status"])
  assert(pid1Uid === '1000', `PID 1 is uid ${pid1Uid}, expected unprivileged uid 1000`)
  const configuredEnv = JSON.parse(output(['inspect', '--format', '{{json .Config.Env}}', container]))
  assert(configuredEnv.includes('HOME=/home/node'), 'container HOME is not /home/node')
  assert(configuredEnv.includes('NODETERM_DATA_DIR=/data'), 'container data dir is not /data')
  docker(['exec', '--user', '1000:1000', container, 'sh', '-c', 'test -s /app/out/server/main.cjs && test -s /app/out/renderer/index.html'])
  docker(['exec', '--user', '1000:1000', container, 'node', '-e', "require('node-pty'); import('smart-whisper')"])
  docker(['exec', '--user', '1000:1000', container, 'grep', '-qx', 'legacy-root-seed', '/data/legacy-root-seed'])
  docker(['exec', '--user', '1000:1000', container, 'grep', '-qx', 'mixed-root-seed', '/data/mixed-root-seed'])

  const signedIn = await login(port, firstPassword)
  assert(signedIn.status === 303 && signedIn.headers.get('location') === '/', 'first-boot password did not authenticate')
  const sessionCookie = signedIn.headers.get('set-cookie')?.split(';', 1)[0]
  assert(sessionCookie, 'login did not set a session cookie')
  const renderer = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: sessionCookie } })
  assert(renderer.status === 200, `authenticated renderer returned ${renderer.status}`)
  const rendererHtml = await renderer.text()
  assert(rendererHtml.includes('<div id="root">'), 'authenticated root did not return the renderer HTML')
  const assetPaths = [...rendererHtml.matchAll(/(?:src|href)="([^"?#]*\/assets\/[^"?#]+)"/g)].map((match) => match[1])
  const scriptPaths = assetPaths.filter((assetPath) => assetPath.endsWith('.js'))
  assert(scriptPaths.length > 0, 'renderer HTML did not reference a hashed JavaScript asset')
  for (const assetPath of assetPaths) {
    const asset = await fetch(new URL(assetPath, `http://127.0.0.1:${port}/`), { headers: { cookie: sessionCookie } })
    assert(asset.status === 200, `renderer asset ${assetPath} returned ${asset.status}`)
    assert((await asset.arrayBuffer()).byteLength > 0, `renderer asset ${assetPath} was empty`)
  }

  docker(['exec', '--user', '1000:1000', container, 'sh', '-c', "printf '%s\n' docker-smoke-persisted > /data/docker-smoke-marker"])
  const authOwner = output(['exec', '--user', '1000:1000', container, 'stat', '-c', '%u:%g', '/data/auth.json'])
  assert(authOwner === '1000:1000', `auth.json owner is ${authOwner}, expected 1000:1000`)

  docker(['stop', '--time', '10', container])
  const exitCode = output(['inspect', '--format', '{{.State.ExitCode}}', container])
  assert(exitCode === '0', `graceful stop exited ${exitCode}`)
  assert(output(['logs', container]).includes('Received SIGTERM, shutting down'), 'SIGTERM shutdown was not observed in logs')

  docker(['start', container])
  await waitHealthy()
  docker(['exec', '--user', '1000:1000', container, 'grep', '-qx', 'docker-smoke-persisted', '/data/docker-smoke-marker'])
  const afterRestart = await login(publishedPort(), firstPassword)
  assert(afterRestart.status === 303 && afterRestart.headers.get('location') === '/', 'password did not survive restart')

  docker(['rm', '-f', container])
  containerCreated = false
  start(replacementPassword)
  containerCreated = true
  await waitHealthy()

  const recreatedPort = publishedPort()
  docker(['exec', '--user', '1000:1000', container, 'grep', '-qx', 'docker-smoke-persisted', '/data/docker-smoke-marker'])
  const oldStillWorks = await login(recreatedPort, firstPassword)
  assert(oldStillWorks.status === 303 && oldStillWorks.headers.get('location') === '/', 'auth state did not survive container recreation')
  const replacementIgnored = await login(recreatedPort, replacementPassword)
  assert(
    replacementIgnored.status === 303 && replacementIgnored.headers.get('location') === '/login?error=1',
    'NODETERM_SERVER_PASSWORD overwrote an existing account'
  )

  console.log(`Docker host smoke passed: image=${image} login=200 pid1_uid=1000 persistence=restart+recreate native_addons=ok`)
} finally {
  if (containerCreated) docker(['rm', '-f', container], { allowFailure: true })
  if (volumeCreated) docker(['volume', 'rm', volume], { allowFailure: true })
  if (outsideVolumeCreated) docker(['volume', 'rm', outsideVolume], { allowFailure: true })
  if (removeImageWhenDone && imageCreated) docker(['image', 'rm', image], { allowFailure: true })
}
