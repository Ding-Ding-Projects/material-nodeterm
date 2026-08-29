#!/usr/bin/env node
// Real container smoke for the Server Edition image. This intentionally lives outside npm test:
// it needs a running Docker daemon and performs a full image build.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
export const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const JOURNAL_ROOT = path.join(os.tmpdir(), 'nodeterm-docker-smoke')
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
const BUILD_TIMEOUT_MS = 20 * 60_000
const OVERALL_TIMEOUT_MS = 35 * 60_000
const HEALTH_TIMEOUT_MS = 90_000
const LABEL_PREFIX = 'dev.nodeterm.smoke'

export const LABEL_KEYS = Object.freeze({
  run: LABEL_PREFIX + '.run',
  role: LABEL_PREFIX + '.role',
  source: LABEL_PREFIX + '.source',
  repo: LABEL_PREFIX + '.repo'
})

export const SERVER_LIMITS = Object.freeze([
  '--cpus', '2',
  '--memory', '2g',
  '--memory-swap', '2g',
  '--pids-limit', '256',
  '--security-opt', 'no-new-privileges=true',
  '--cap-drop', 'ALL',
  '--cap-add', 'CHOWN',
  '--cap-add', 'DAC_OVERRIDE',
  '--cap-add', 'FOWNER',
  '--cap-add', 'SETGID',
  '--cap-add', 'SETUID'
])

export const HELPER_LIMITS = Object.freeze([
  '--cpus', '1',
  '--memory', '512m',
  '--memory-swap', '512m',
  '--pids-limit', '128',
  '--security-opt', 'no-new-privileges=true',
  '--cap-drop', 'ALL'
])

const ROOT_HELPER_CAPS = Object.freeze([
  '--cap-add', 'CHOWN',
  '--cap-add', 'DAC_OVERRIDE',
  '--cap-add', 'FOWNER'
])

const PROBE_SCRIPT = [
  "'use strict'",
  "const fs = require('node:fs')",
  "const input = JSON.parse(fs.readFileSync(0, 'utf8'))",
  "const base = 'http://127.0.0.1:8443'",
  "const request = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) })",
  'const run = async () => {',
  "  const loginPage = await request(base + '/login')",
  "  if (loginPage.status !== 200 || !(await loginPage.text()).includes('Sign in')) throw new Error('login page check failed')",
  "  const login = await request(base + '/auth/login', {",
  "    method: 'POST',",
  "    headers: { 'content-type': 'application/x-www-form-urlencoded' },",
  "    body: new URLSearchParams({ password: input.password }),",
  "    redirect: 'manual'",
  '  })',
  "  const location = login.headers.get('location')",
  '  if (!input.expectSuccess) {',
  "    if (login.status !== 303 || location !== '/login?error=1') throw new Error('unexpected rejected-login result')",
  "    process.stdout.write(JSON.stringify({ loginPage: 200, login: 303, rejected: true }))",
  '    return',
  '  }',
  "  if (login.status !== 303 || location !== '/') throw new Error('login failed')",
  "  const cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0]",
  "  if (!cookie) throw new Error('login did not set a session cookie')",
  "  const renderer = await request(base + '/', { headers: { cookie } })",
  "  if (renderer.status !== 200) throw new Error('renderer request failed')",
  '  const html = await renderer.text()',
  "  if (!html.includes('<div id=\"root\">')) throw new Error('renderer root is missing')",
  "  const assets = [...html.matchAll(/(?:src|href)=\"([^\"?#]*\\/assets\\/[^\"?#]+)\"/g)].map((match) => match[1])",
  "  if (!assets.some((asset) => asset.endsWith('.js'))) throw new Error('renderer JavaScript asset is missing')",
  '  for (const assetPath of assets) {',
  "    const asset = await request(new URL(assetPath, base + '/'), { headers: { cookie } })",
  "    if (asset.status !== 200 || (await asset.arrayBuffer()).byteLength === 0) throw new Error('renderer asset check failed')",
  '  }',
  '  process.stdout.write(JSON.stringify({ loginPage: 200, login: 303, renderer: 200, assets: assets.length }))',
  '}',
  "run().catch((error) => { process.stderr.write(String(error && error.message || error)); process.exitCode = 1 })"
].join('\n')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function flagValue(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(flag + ' requires a value')
  return value
}

export function parseArgs(argv) {
  const parsed = {
    dockerHost: undefined,
    cleanupRun: undefined,
    help: false
  }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (seen.has(flag)) throw new Error('duplicate option: ' + flag)
    seen.add(flag)
    if (flag === '--docker-host') {
      parsed.dockerHost = flagValue(argv, index, flag)
      index += 1
    } else if (flag === '--cleanup-run') {
      parsed.cleanupRun = flagValue(argv, index, flag)
      index += 1
    } else if (flag === '--help' || flag === '-h') {
      parsed.help = true
    } else if (flag === '--image' || flag === '--no-build') {
      throw new Error(flag + ' is no longer supported because a smoke run may not adopt or overwrite an operator image')
    } else {
      throw new Error('unknown option: ' + flag)
    }
  }
  if (parsed.cleanupRun && parsed.dockerHost) {
    throw new Error('--cleanup-run uses the endpoint recorded in its recovery journal')
  }
  if (parsed.cleanupRun && !isRunId(parsed.cleanupRun)) {
    throw new Error('--cleanup-run requires a UUID run id')
  }
  return parsed
}

function hasUnsafeEndpointText(value) {
  return typeof value !== 'string' || value.length > 2048 || /[\0\r\n\t ]/.test(value)
}

export function validateDockerEndpoint(value) {
  if (hasUnsafeEndpointText(value)) throw new Error('Docker endpoint contains unsafe characters')
  if (value.startsWith('unix://')) {
    if (!/^unix:\/\/\/[^?#]+$/.test(value)) throw new Error('Docker unix endpoint must use an absolute socket path')
    return value
  }
  if (value.startsWith('npipe://')) {
    if (!/^npipe:\/{4}[^/?#]+\/pipe\/[A-Za-z0-9_.-]+$/i.test(value)) {
      throw new Error('Docker named-pipe endpoint is invalid')
    }
    return value
  }
  if (value.startsWith('ssh://')) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new Error('Docker SSH endpoint is invalid')
    }
    if (parsed.protocol !== 'ssh:' || !parsed.hostname || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Docker SSH endpoint must not contain a password, query, or fragment')
    }
    if (parsed.pathname && parsed.pathname !== '/') throw new Error('Docker SSH endpoint must not contain a path')
    return value
  }
  throw new Error('Docker host smoke permits only unix://, npipe://, or ssh:// endpoints')
}

function isRunId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function labelsFor(runId, role, sourceSha) {
  assert(isRunId(runId), 'run id must be a cryptographic UUID')
  assert(/^[0-9a-f]{40}$/i.test(sourceSha), 'source SHA must be a full Git object id')
  return {
    [LABEL_KEYS.run]: runId,
    [LABEL_KEYS.role]: role,
    [LABEL_KEYS.source]: sourceSha.toLowerCase(),
    [LABEL_KEYS.repo]: 'material-nodeterm'
  }
}

function labelArgs(labels) {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', key + '=' + value])
}

export function assertOwnedLabels(expected, actual, description) {
  for (const [key, value] of Object.entries(expected)) {
    if (!actual || actual[key] !== value) {
      throw new Error('cleanup refused for ' + description + ': ownership label ' + key + ' does not match')
    }
  }
}

export function assertExactNameAbsent(kind, name, existing) {
  if (existing) throw new Error(kind + ' name already exists; refusing to adopt it: ' + name)
}

export function assertNoRunResidue(residue) {
  const remaining = Object.entries(residue)
    .filter(([, values]) => values.length > 0)
    .map(([kind, values]) => kind + '=' + values.join(','))
  if (remaining.length > 0) throw new Error('run-labelled cleanup residue remains: ' + remaining.join(' '))
}

export function assertSafeDockerArgs(args, secrets = []) {
  for (const arg of args) {
    if (
      arg === '-P' || arg === '-p' || /^-p(?:=|.)/.test(arg) ||
      arg === '--publish' || arg === '--publish-all' || arg.startsWith('--publish=') ||
      arg === '--privileged' || arg.startsWith('--privileged=')
    ) {
      throw new Error('unsafe Docker argument refused: ' + arg)
    }
    for (const secret of secrets) {
      if (secret && arg.includes(secret)) throw new Error('credential material must not travel in Docker arguments')
    }
  }
}

export function makeIdempotentCleanup(cleanup) {
  let state = 'idle'
  let failure
  return () => {
    if (state === 'done') return
    if (state === 'failed') throw failure
    if (state === 'running') return
    state = 'running'
    try {
      cleanup()
      state = 'done'
    } catch (error) {
      failure = error
      state = 'failed'
      throw error
    }
  }
}

export function assertRuntimePolicy(role, hostConfig, runId) {
  const kind = role.startsWith('server-') ? 'server' : 'helper'
  const expected = kind === 'server'
    ? { nanoCpus: 2_000_000_000, memory: 2 * 1024 ** 3, pids: 256 }
    : { nanoCpus: 1_000_000_000, memory: 512 * 1024 ** 2, pids: 128 }
  const portBindings = hostConfig && hostConfig.PortBindings
  assert(!portBindings || Object.keys(portBindings).length === 0, kind + ' container published a host port')
  assert(hostConfig && hostConfig.NetworkMode === 'none', kind + ' container did not use network=none')
  assert(hostConfig.NanoCpus === expected.nanoCpus, kind + ' container CPU limit was not applied')
  assert(hostConfig.Memory === expected.memory, kind + ' container memory limit was not applied')
  assert(hostConfig.MemorySwap === expected.memory, kind + ' container swap limit was not applied')
  assert(hostConfig.PidsLimit === expected.pids, kind + ' container PID limit was not applied')
  assert(hostConfig.Privileged === false, kind + ' container is privileged')
  assert((hostConfig.SecurityOpt || []).some((value) => /^no-new-privileges(?:(?:=|:)true)?$/.test(value)), kind + ' container lacks no-new-privileges')
  assert((hostConfig.CapDrop || []).some((capability) => capability.toUpperCase() === 'ALL'), kind + ' container did not drop capabilities')
  const fullCaps = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID']
  const rootCaps = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER']
  const expectedCaps = role === 'seed-legacy' || role === 'seed-mixed' ? rootCaps : fullCaps
  const inspectedCaps = (hostConfig.CapAdd || []).map((capability) => {
    assert(typeof capability === 'string', kind + ' container reported an invalid capability')
    // The Engine canonicalizes CLI inputs such as CHOWN to CAP_CHOWN in inspect output.
    return capability.toUpperCase().replace(/^CAP_/, '')
  })
  assert(
    JSON.stringify(inspectedCaps.sort()) === JSON.stringify([...expectedCaps].sort()),
    kind + ' container capability allowlist does not match its role'
  )
  const prefix = 'nodeterm-smoke-' + runId
  const expectedBinds = role === 'seed-legacy' || role === 'verify-migration'
    ? [prefix + '-data:/data', prefix + '-outside:/outside']
    : [prefix + '-data:/data']
  assert(
    JSON.stringify([...(hostConfig.Binds || [])].sort()) === JSON.stringify(expectedBinds.sort()),
    kind + ' container mounts do not match its owned volumes'
  )
}

export function assertDaemonIdentity(expected, current) {
  assert(expected && current === expected, 'selected Docker daemon identity changed')
}

export function assertResourceIdentity(kind, recorded, current) {
  assert(recorded && current === recorded, kind + ' immutable identity changed')
}

export function buildDockerEnvironment(baseEnv) {
  const env = { ...baseEnv }
  for (const name of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'BUILDX_BUILDER',
    'BUILDKIT_HOST',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'DOCKER_SSH_COMMAND'
  ]) {
    delete env[name]
  }
  env.DOCKER_BUILDKIT = '1'
  return env
}

function sanitized(text, secrets) {
  let result = String(text || '')
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[redacted]')
  }
  return result.slice(-4_000)
}

class DockerClient {
  constructor(endpoint, env, deadline, interrupted) {
    this.endpoint = endpoint
    this.env = env
    this.deadline = deadline
    this.interrupted = interrupted
  }

  run(args, options = {}) {
    if (!options.cleanup && this.interrupted()) throw new Error('smoke interrupted')
    const remaining = this.deadline - Date.now()
    if (remaining <= 0 && !options.cleanup) throw new Error('Docker host smoke exceeded its overall deadline')
    const requestedTimeout = options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS
    const timeout = options.cleanup ? requestedTimeout : Math.max(1, Math.min(requestedTimeout, remaining))
    const secrets = options.secrets || []
    assertSafeDockerArgs(args, secrets)
    const result = spawnSync('docker', ['--host', this.endpoint, ...args], {
      cwd: options.cwd || REPO_ROOT,
      encoding: 'utf8',
      input: options.input,
      stdio: options.capture === false ? 'inherit' : 'pipe',
      env: { ...this.env, ...(options.env || {}) },
      timeout,
      windowsHide: true
    })
    if (result.error && !options.allowFailure) {
      if (result.error.code === 'ETIMEDOUT') throw new Error('Docker command exceeded its bounded timeout')
      throw result.error
    }
    if (result.status !== 0 && !options.allowFailure) {
      const detail = sanitized([result.stdout, result.stderr].filter(Boolean).join('\n').trim(), secrets)
      throw new Error('Docker command exited ' + result.status + (detail ? '\n' + detail : ''))
    }
    if (!options.cleanup && this.interrupted()) throw new Error('smoke interrupted')
    return result
  }

  output(args, options = {}) {
    return this.run(args, options).stdout.trim()
  }
}

function rawCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    env: options.env || process.env,
    timeout: options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS,
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(command + ' exited ' + result.status + (detail ? '\n' + detail.slice(-4_000) : ''))
  }
  return result.stdout.trim()
}

function resolveEndpoint(parsed) {
  if (parsed.dockerHost) return validateDockerEndpoint(parsed.dockerHost)
  if (process.env.DOCKER_HOST) return validateDockerEndpoint(process.env.DOCKER_HOST)
  const inspectEnv = { ...process.env }
  delete inspectEnv.DOCKER_HOST
  const endpoint = rawCommand(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { env: inspectEnv }
  )
  return validateDockerEndpoint(endpoint)
}

function journalPath(runId) {
  return path.join(JOURNAL_ROOT, runId + '.json')
}

function artifactPath(runId, suffix) {
  return path.join(JOURNAL_ROOT, runId + '-' + suffix)
}

function saveJournal(journal) {
  fs.mkdirSync(JOURNAL_ROOT, { recursive: true, mode: 0o700 })
  fs.writeFileSync(journal.path, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 })
}

export function validateJournalShape(parsed, runId) {
  if (
    !parsed || parsed.version !== 1 || parsed.runId !== runId ||
    !Array.isArray(parsed.resources) || !['initializing', 'ready'].includes(parsed.phase) ||
    !/^[0-9a-f]{40}$/i.test(parsed.sourceSha || '')
  ) {
    throw new Error('recovery journal has an invalid shape')
  }
  if (parsed.phase === 'ready' && !parsed.daemonId) {
    throw new Error('ready recovery journal is missing its daemon identity')
  }
  parsed.endpoint = validateDockerEndpoint(parsed.endpoint)
  return parsed
}

function loadJournal(runId) {
  const target = journalPath(runId)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch (error) {
    throw new Error('could not read recovery journal for run ' + runId + ': ' + error.message)
  }
  validateJournalShape(parsed, runId)
  parsed.path = target
  return parsed
}

function removeLocalArtifact(target) {
  try {
    fs.rmSync(target, { force: true })
  } catch {
    // A retained journal still names the artifact, so cleanup can be retried safely.
  }
}

function makeResource(kind, role, name, runId) {
  const suffix = role.replace(/[^a-z0-9-]/gi, '-')
  return {
    kind,
    role,
    name,
    created: false,
    removed: false,
    id: null,
    identity: null,
    artifact: kind === 'container'
      ? artifactPath(runId, suffix + '.cid')
      : kind === 'image'
        ? artifactPath(runId, suffix + '.iid')
        : null
  }
}

function resourceFor(journal, role) {
  const resource = journal.resources.find((candidate) => candidate.role === role)
  assert(resource, 'journal is missing resource role ' + role)
  return resource
}

function resourceLabels(journal, resource) {
  return labelsFor(journal.runId, resource.role, journal.sourceSha)
}

function parseLabels(value) {
  const parsed = JSON.parse(value || '{}')
  return parsed && typeof parsed === 'object' ? parsed : {}
}

export function isMissingResourceDiagnostic(stderr) {
  return /no such (?:object|container|image|volume)/i.test(String(stderr || ''))
}

function missingInspect(result) {
  return isMissingResourceDiagnostic(result.stderr)
}

function inspectContainer(client, name, cleanup = false) {
  const result = client.run(
    ['container', 'inspect', '--format', '{{.Id}}\t{{.Image}}\t{{json .Config.Labels}}\t{{.Name}}', name],
    { allowFailure: true, cleanup }
  )
  if (result.status !== 0) {
    if (missingInspect(result)) return null
    throw new Error('could not inspect container ' + name + ': ' + sanitized(result.stderr, []))
  }
  const [id, imageId, labels, actualName] = result.stdout.trim().split('\t')
  return { id, imageId, labels: parseLabels(labels), name: actualName.replace(/^\//, '') }
}

function inspectImage(client, name, cleanup = false) {
  const result = client.run(
    ['image', 'inspect', '--format', '{{.Id}}\t{{json .Config.Labels}}', name],
    { allowFailure: true, cleanup }
  )
  if (result.status !== 0) {
    if (missingInspect(result)) return null
    throw new Error('could not inspect image ' + name + ': ' + sanitized(result.stderr, []))
  }
  const [id, labels] = result.stdout.trim().split('\t')
  return { id, labels: parseLabels(labels) }
}

function volumeIdentity(info) {
  const stable = {
    Name: info.Name,
    Driver: info.Driver,
    Scope: info.Scope,
    Mountpoint: info.Mountpoint,
    CreatedAt: info.CreatedAt
  }
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function inspectVolume(client, name, cleanup = false) {
  const result = client.run(
    ['volume', 'inspect', '--format', '{{json .}}', name],
    { allowFailure: true, cleanup }
  )
  if (result.status !== 0) {
    if (missingInspect(result)) return null
    throw new Error('could not inspect volume ' + name + ': ' + sanitized(result.stderr, []))
  }
  const info = JSON.parse(result.stdout.trim())
  return {
    name: info.Name,
    labels: info.Labels || {},
    identity: volumeIdentity(info)
  }
}

function readArtifactId(resource) {
  if (!resource.artifact) return null
  try {
    const id = fs.readFileSync(resource.artifact, 'utf8').trim()
    return /^sha256:[0-9a-f]{64}$/i.test(id) || /^[0-9a-f]{64}$/i.test(id) ? id : null
  } catch {
    return null
  }
}

function preflightResource(client, resource) {
  const existing = resource.kind === 'container'
    ? inspectContainer(client, resource.name)
    : resource.kind === 'volume'
      ? inspectVolume(client, resource.name)
      : inspectImage(client, resource.name)
  assertExactNameAbsent(resource.kind, resource.name, existing)
}

function recordContainer(client, journal, resource, imageId) {
  const artifactId = readArtifactId(resource)
  const info = inspectContainer(client, resource.name)
  assert(info, 'created container disappeared before it could be recorded')
  assert(artifactId && info.id === artifactId, 'container id does not match its immutable cidfile')
  assert(info.imageId === imageId, 'container does not use the image id built for this run')
  assertOwnedLabels(resourceLabels(journal, resource), info.labels, 'container ' + resource.name)
  const hostConfig = JSON.parse(client.output([
    'container', 'inspect', '--format', '{{json .HostConfig}}', info.id
  ]))
  assertRuntimePolicy(resource.role, hostConfig, journal.runId)
  resource.id = info.id
  resource.created = true
  saveJournal(journal)
}

function createContainer(client, journal, role, imageId, args, options = {}) {
  const resource = resourceFor(journal, role)
  removeLocalArtifact(resource.artifact)
  client.run(
    [
      'container', 'create',
      '--cidfile', resource.artifact,
      '--name', resource.name,
      ...labelArgs(resourceLabels(journal, resource)),
      ...args
    ],
    options
  )
  recordContainer(client, journal, resource, imageId)
  return resource
}

function runHelper(client, journal, role, imageId, args) {
  const resource = createContainer(client, journal, role, imageId, args)
  client.run(['container', 'start', '--attach', resource.id], { timeoutMs: 2 * 60_000 })
  const exitCode = client.output(['container', 'inspect', '--format', '{{.State.ExitCode}}', resource.id])
  assert(exitCode === '0', 'helper ' + role + ' exited ' + exitCode)
  removeResource(client, journal, resource)
}

function createVolume(client, journal, role) {
  const resource = resourceFor(journal, role)
  const output = client.output([
    'volume', 'create',
    ...labelArgs(resourceLabels(journal, resource)),
    resource.name
  ])
  assert(output === resource.name, 'Docker returned an unexpected volume name')
  const info = inspectVolume(client, resource.name)
  assert(info && info.name === resource.name, 'created volume disappeared before it could be recorded')
  assertOwnedLabels(resourceLabels(journal, resource), info.labels, 'volume ' + resource.name)
  resource.identity = info.identity
  resource.created = true
  saveJournal(journal)
}

function buildImage(client, journal) {
  const resource = resourceFor(journal, 'image')
  removeLocalArtifact(resource.artifact)
  client.run(
    [
      'build',
      '--builder', 'default',
      '--load',
      '--progress=plain',
      '--iidfile', resource.artifact,
      ...labelArgs(resourceLabels(journal, resource)),
      '-t', resource.name,
      '.'
    ],
    { capture: false, cwd: REPO_ROOT, timeoutMs: BUILD_TIMEOUT_MS }
  )
  const artifactId = readArtifactId(resource)
  const info = inspectImage(client, resource.name)
  assert(info && artifactId && info.id === artifactId, 'built image does not match its immutable iidfile')
  assertOwnedLabels(resourceLabels(journal, resource), info.labels, 'image ' + resource.name)
  resource.id = info.id
  resource.created = true
  saveJournal(journal)
  return resource
}

export function buildServerCreateArgs(name, volume, image, labels) {
  return [
    '--name', name,
    ...labelArgs(labels),
    '--network', 'none',
    '--restart', 'no',
    ...SERVER_LIMITS,
    '--env', 'NODETERM_SERVER_PASSWORD',
    '--volume', volume + ':/data',
    image
  ]
}

export function buildServerInvocation(name, volume, image, labels, password) {
  const args = buildServerCreateArgs(name, volume, image, labels)
  assertSafeDockerArgs(args, [password])
  return { args, env: { NODETERM_SERVER_PASSWORD: password } }
}

function startServer(client, journal, role, imageResource, volume, password) {
  const resource = resourceFor(journal, role)
  const invocation = buildServerInvocation(
    resource.name,
    volume,
    imageResource.name,
    resourceLabels(journal, resource),
    password
  )
  // createContainer adds the name and labels itself, so retain only the runtime part here.
  const runtimeStart = invocation.args.indexOf('--network')
  createContainer(
    client,
    journal,
    role,
    imageResource.id,
    invocation.args.slice(runtimeStart),
    {
      env: invocation.env,
      secrets: [password]
    }
  )
  client.run(['container', 'start', resource.id])
  return resource
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitHealthy(client, resource) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let last = 'missing'
  while (Date.now() < deadline) {
    const result = client.run(
      ['container', 'inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', resource.id],
      { allowFailure: true, timeoutMs: 10_000 }
    )
    last = result.status === 0 ? result.stdout.trim() : 'missing'
    if (last === 'healthy') return
    if (last === 'unhealthy' || last === 'exited' || last === 'dead') {
      const logs = client.output(['container', 'logs', '--tail', '200', resource.id], { timeoutMs: 10_000 })
      throw new Error('server container became ' + last + (logs ? '\n' + logs : ''))
    }
    await delay(1_000)
  }
  throw new Error('server container did not become healthy (last state: ' + last + ')')
}

function probeServer(client, resource, password, expectSuccess = true) {
  const invocation = buildProbeInvocation(resource.id, password, expectSuccess)
  const result = client.run(
    invocation.args,
    {
      input: invocation.input,
      secrets: [password],
      timeoutMs: 45_000
    }
  )
  const parsed = JSON.parse(result.stdout.trim())
  assert(parsed.loginPage === 200 && parsed.login === 303, 'in-container auth probe returned an invalid result')
  if (expectSuccess) assert(parsed.renderer === 200 && parsed.assets > 0, 'in-container renderer probe returned an invalid result')
  else assert(parsed.rejected === true, 'in-container rejected-login probe returned an invalid result')
  return parsed
}

export function buildProbeInvocation(containerId, password, expectSuccess = true) {
  const args = ['container', 'exec', '--interactive', '--user', '1000:1000', containerId, 'node', '-e', PROBE_SCRIPT]
  assertSafeDockerArgs(args, [password])
  return { args, input: JSON.stringify({ password, expectSuccess }) }
}

function residueFor(client, journal, cleanup = false) {
  const filter = 'label=' + LABEL_KEYS.run + '=' + journal.runId
  const list = (args) => {
    const output = client.output(args, { cleanup })
    return output ? [...new Set(output.split(/\r?\n/).filter(Boolean))] : []
  }
  return {
    containers: list(['container', 'ls', '--all', '--quiet', '--filter', filter]),
    volumes: list(['volume', 'ls', '--quiet', '--filter', filter]),
    images: list(['image', 'ls', '--all', '--quiet', '--filter', filter])
  }
}

function requireDaemonIdentity(client, journal, cleanup = false) {
  assert(journal.daemonId, 'cleanup refused because the recovery journal has no daemon identity')
  const current = client.output(['info', '--format', '{{.ID}}'], { cleanup, timeoutMs: 15_000 })
  assertDaemonIdentity(journal.daemonId, current)
}

function removeResource(client, journal, resource) {
  if (resource.removed) return
  const expectedLabels = resourceLabels(journal, resource)
  if (resource.kind === 'container') {
    const current = inspectContainer(client, resource.name, true)
    if (!current) {
      if (resource.created) throw new Error('cleanup could not verify container because it disappeared: ' + resource.name)
      return
    }
    const recordedId = resource.id || readArtifactId(resource)
    assertResourceIdentity('container', recordedId, current.id)
    assertOwnedLabels(expectedLabels, current.labels, 'container ' + resource.name)
    client.run(['container', 'rm', '--force', current.id], { cleanup: true })
  } else if (resource.kind === 'volume') {
    const current = inspectVolume(client, resource.name, true)
    if (!current) {
      if (resource.created) throw new Error('cleanup could not verify volume because it disappeared: ' + resource.name)
      return
    }
    assertResourceIdentity('volume', resource.identity, current.identity)
    assertOwnedLabels(expectedLabels, current.labels, 'volume ' + resource.name)
    client.run(['volume', 'rm', resource.name], { cleanup: true })
  } else {
    const current = inspectImage(client, resource.name, true)
    if (!current) {
      if (resource.created) throw new Error('cleanup could not verify image because it disappeared: ' + resource.name)
      return
    }
    const recordedId = resource.id || readArtifactId(resource)
    assertResourceIdentity('image', recordedId, current.id)
    assertOwnedLabels(expectedLabels, current.labels, 'image ' + resource.name)
    client.run(['image', 'rm', current.id], { cleanup: true })
  }
  resource.removed = true
  saveJournal(journal)
  if (resource.artifact) removeLocalArtifact(resource.artifact)
}

function cleanupResources(client, journal) {
  const errors = []
  if (!journal.daemonId && journal.phase === 'initializing') {
    removeLocalArtifact(journal.path)
    return
  }
  try {
    requireDaemonIdentity(client, journal, true)
  } catch (error) {
    throw new Error('cleanup failed; recovery journal retained at ' + journal.path + '\n' + error.message)
  }
  const ordered = [
    ...journal.resources.filter((resource) => resource.kind === 'container').reverse(),
    ...journal.resources.filter((resource) => resource.kind === 'volume').reverse(),
    ...journal.resources.filter((resource) => resource.kind === 'image').reverse()
  ]
  for (const resource of ordered) {
    try {
      removeResource(client, journal, resource)
    } catch (error) {
      errors.push(error.message)
    }
  }
  try {
    assertNoRunResidue(residueFor(client, journal, true))
  } catch (error) {
    errors.push(error.message)
  }
  if (errors.length > 0) {
    throw new Error('cleanup failed; recovery journal retained at ' + journal.path + '\n' + errors.join('\n'))
  }
  removeLocalArtifact(journal.path)
}

function createJournal(runId, endpoint, sourceSha) {
  const prefix = 'nodeterm-smoke-' + runId
  const journal = {
    version: 1,
    runId,
    endpoint,
    sourceSha,
    daemonId: null,
    phase: 'initializing',
    createdAt: new Date().toISOString(),
    path: journalPath(runId),
    resources: [
      makeResource('image', 'image', 'nodeterm-server:smoke-' + runId, runId),
      makeResource('volume', 'data-volume', prefix + '-data', runId),
      makeResource('volume', 'outside-volume', prefix + '-outside', runId),
      makeResource('container', 'seed-legacy', prefix + '-seed-legacy', runId),
      makeResource('container', 'verify-migration', prefix + '-verify-migration', runId),
      makeResource('container', 'seed-mixed', prefix + '-seed-mixed', runId),
      makeResource('container', 'server-first', prefix + '-server-first', runId),
      makeResource('container', 'server-recreated', prefix + '-server-recreated', runId)
    ]
  }
  saveJournal(journal)
  return journal
}

function gitSourceSha() {
  const sha = rawCommand('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })
  assert(/^[0-9a-f]{40}$/i.test(sha), 'could not resolve a full source commit')
  const dirty = rawCommand('git', ['status', '--porcelain'], { cwd: REPO_ROOT })
  assert(!dirty, 'refusing to build a smoke image from a dirty tracked worktree')
  return sha.toLowerCase()
}

async function runSmoke(parsed) {
  const runId = crypto.randomUUID()
  const endpoint = resolveEndpoint(parsed)
  const sourceSha = gitSourceSha()
  const journal = createJournal(runId, endpoint, sourceSha)
  let interrupted = false
  const env = buildDockerEnvironment(process.env)
  const client = new DockerClient(endpoint, env, Date.now() + OVERALL_TIMEOUT_MS, () => interrupted)

  const cleanup = makeIdempotentCleanup(() => cleanupResources(client, journal))
  const onSignal = () => {
    interrupted = true
    try {
      cleanup()
    } catch (error) {
      process.stderr.write(error.message + '\n')
    }
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('SIGHUP', onSignal)

  let primaryError
  let successSummary
  try {
    client.run(['version', '--format', '{{.Server.Version}}'])
    journal.daemonId = client.output(['info', '--format', '{{.ID}}'], { timeoutMs: 15_000 })
    assert(journal.daemonId, 'Docker daemon did not report an identity')
    journal.phase = 'ready'
    saveJournal(journal)
    assertNoRunResidue(residueFor(client, journal))
    for (const resource of journal.resources) preflightResource(client, resource)

    const image = buildImage(client, journal)
    const dataVolume = resourceFor(journal, 'data-volume')
    const outsideVolume = resourceFor(journal, 'outside-volume')
    createVolume(client, journal, 'data-volume')
    createVolume(client, journal, 'outside-volume')

    runHelper(client, journal, 'seed-legacy', image.id, [
      '--network', 'none',
      ...HELPER_LIMITS,
      ...ROOT_HELPER_CAPS,
      '--user', '0',
      '--entrypoint', 'sh',
      '--volume', dataVolume.name + ':/data',
      '--volume', outsideVolume.name + ':/outside',
      image.name,
      '-c',
      "printf '%s\\n' legacy-root-seed > /data/legacy-root-seed; printf '%s\\n' do-not-chown > /outside/sentinel; chown -R 0:0 /data /outside"
    ])

    runHelper(client, journal, 'verify-migration', image.id, [
      '--network', 'none',
      ...HELPER_LIMITS,
      ...ROOT_HELPER_CAPS,
      '--cap-add', 'SETGID',
      '--cap-add', 'SETUID',
      '--env', 'NODETERM_DATA_DIR=/outside',
      '--volume', dataVolume.name + ':/data',
      '--volume', outsideVolume.name + ':/outside',
      image.name,
      'sh', '-c',
      "test \"$(id -u)\" = 1000 && test \"$(stat -c %u /data/legacy-root-seed)\" = 1000 && test \"$(stat -c %u /outside/sentinel)\" = 0"
    ])

    runHelper(client, journal, 'seed-mixed', image.id, [
      '--network', 'none',
      ...HELPER_LIMITS,
      ...ROOT_HELPER_CAPS,
      '--user', '0',
      '--entrypoint', 'sh',
      '--volume', dataVolume.name + ':/data',
      image.name,
      '-c',
      "printf '%s\\n' mixed-root-seed > /data/mixed-root-seed; chmod 600 /data/mixed-root-seed; chown 0:0 /data/mixed-root-seed"
    ])

    const firstPassword = crypto.randomBytes(32).toString('base64url')
    const replacementPassword = crypto.randomBytes(32).toString('base64url')
    const firstServer = startServer(client, journal, 'server-first', image, dataVolume.name, firstPassword)
    await waitHealthy(client, firstServer)
    const firstProbe = probeServer(client, firstServer, firstPassword)

    assert(
      client.output(['container', 'exec', '--user', '1000:1000', firstServer.id, 'sh', '-c', "awk '/^Uid:/{print $2}' /proc/1/status"]) === '1000',
      'PID 1 is not uid 1000'
    )
    client.run([
      'container', 'exec', '--user', '1000:1000', firstServer.id,
      'sh', '-c',
      'test "$HOME" = /home/node && test "$NODETERM_DATA_DIR" = /data && test -s /app/out/server/main.cjs && test -s /app/out/renderer/index.html'
    ])
    client.run(['container', 'exec', '--user', '1000:1000', firstServer.id, 'node', '-e', "require('node-pty'); import('smart-whisper')"])
    client.run(['container', 'exec', '--user', '1000:1000', firstServer.id, 'grep', '-qx', 'legacy-root-seed', '/data/legacy-root-seed'])
    client.run(['container', 'exec', '--user', '1000:1000', firstServer.id, 'grep', '-qx', 'mixed-root-seed', '/data/mixed-root-seed'])
    client.run([
      'container', 'exec', '--user', '1000:1000', firstServer.id,
      'sh', '-c', "printf '%s\\n' docker-smoke-persisted > /data/docker-smoke-marker"
    ])
    assert(
      client.output(['container', 'exec', '--user', '1000:1000', firstServer.id, 'stat', '-c', '%u:%g', '/data/auth.json']) === '1000:1000',
      'auth.json is not owned by uid/gid 1000'
    )

    client.run(['container', 'stop', '--time', '10', firstServer.id], { timeoutMs: 30_000 })
    assert(client.output(['container', 'inspect', '--format', '{{.State.ExitCode}}', firstServer.id]) === '0', 'graceful stop did not exit zero')
    assert(
      client.output(['container', 'logs', '--tail', '200', firstServer.id]).includes('Received SIGTERM, shutting down'),
      'SIGTERM shutdown was not observed in logs'
    )
    client.run(['container', 'start', firstServer.id])
    await waitHealthy(client, firstServer)
    client.run(['container', 'exec', '--user', '1000:1000', firstServer.id, 'grep', '-qx', 'docker-smoke-persisted', '/data/docker-smoke-marker'])
    probeServer(client, firstServer, firstPassword)

    removeResource(client, journal, firstServer)
    const recreated = startServer(client, journal, 'server-recreated', image, dataVolume.name, replacementPassword)
    await waitHealthy(client, recreated)
    client.run(['container', 'exec', '--user', '1000:1000', recreated.id, 'grep', '-qx', 'docker-smoke-persisted', '/data/docker-smoke-marker'])
    probeServer(client, recreated, firstPassword)
    probeServer(client, recreated, replacementPassword, false)

    successSummary =
      'Docker host smoke passed: run=' + runId +
      ' source=' + sourceSha +
      ' login=' + firstProbe.login +
      ' pid1_uid=1000 persistence=restart+recreate native_addons=ok'
  } catch (error) {
    primaryError = error
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    process.removeListener('SIGHUP', onSignal)
    try {
      cleanup()
    } catch (cleanupError) {
      primaryError = primaryError
        ? new Error(primaryError.message + '\n' + cleanupError.message)
        : cleanupError
    }
  }
  if (primaryError) throw primaryError
  console.log(successSummary)
}

function recoverRun(parsed) {
  const journal = loadJournal(parsed.cleanupRun)
  const env = buildDockerEnvironment(process.env)
  const client = new DockerClient(journal.endpoint, env, Date.now() + 10 * 60_000, () => false)
  cleanupResources(client, journal)
  console.log('Docker smoke recovery cleanup passed: run=' + journal.runId)
}

function printHelp() {
  console.log([
    'Usage: node scripts/test-docker-host.mjs [options]',
    '',
    '  --docker-host <endpoint>   Use an explicit unix://, npipe://, or ssh:// daemon.',
    '  --cleanup-run <uuid>       Clean a prior run using its recovery journal.',
    '  --help                     Show this help.',
    '',
    'The smoke always builds a unique labelled image and never publishes a host port.',
    'SSH endpoints use the account SSH configuration and its persistent host-key inventory.'
  ].join('\n'))
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    printHelp()
    return
  }
  if (parsed.cleanupRun) {
    recoverRun(parsed)
    return
  }
  await runSmoke(parsed)
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(String(error && error.message || error) + '\n')
    process.exitCode = 1
  })
}
