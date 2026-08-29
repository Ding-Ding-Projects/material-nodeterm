import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The executable stays native ESM; this behavior suite exercises its public helpers.
import {
  LABEL_KEYS,
  REPO_ROOT,
  HELPER_LIMITS,
  SERVER_LIMITS,
  assertExactNameAbsent,
  assertNoRunResidue,
  assertDaemonIdentity,
  assertOwnedLabels,
  assertResourceIdentity,
  assertRuntimePolicy,
  assertSafeDockerArgs,
  buildDockerEnvironment,
  buildProbeInvocation,
  buildServerCreateArgs,
  buildServerInvocation,
  isMissingResourceDiagnostic,
  labelsFor,
  makeIdempotentCleanup,
  parseArgs,
  validateJournalShape,
  validateDockerEndpoint
} from '../../scripts/test-docker-host.mjs'

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000'
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567'

describe('Docker host smoke safety policy', () => {
  it('derives its repository root from the script location', () => {
    const expected = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    expect(REPO_ROOT).toBe(expected)
  })

  it('accepts local and SSH daemon transports but rejects network API transports', () => {
    expect(validateDockerEndpoint('unix:///var/run/docker.sock')).toBe('unix:///var/run/docker.sock')
    expect(validateDockerEndpoint('npipe:////./pipe/docker_engine')).toBe('npipe:////./pipe/docker_engine')
    expect(validateDockerEndpoint('ssh://docker@example.test')).toBe('ssh://docker@example.test')

    for (const endpoint of [
      'tcp://127.0.0.1:2375',
      'http://example.test',
      'https://example.test',
      'ssh://user:secret@example.test',
      'ssh://docker@example.test/another/path',
      'ssh://',
      'ssh://docker@example.test?context=wrong',
      'ssh://docker@example.test#wrong',
      'unix://relative.sock',
      'npipe://bad',
      "ssh://docker@example.test\n--option"
    ]) {
      expect(() => validateDockerEndpoint(endpoint)).toThrow()
    }
  })

  it('refuses legacy image adoption, option injection, duplicates, and unknown flags', () => {
    expect(() => parseArgs(['--image', '--privileged'])).toThrow(/no longer supported/)
    expect(() => parseArgs(['--no-build'])).toThrow(/no longer supported/)
    expect(() => parseArgs(['--docker-host', 'ssh://one', '--docker-host', 'ssh://two'])).toThrow(/duplicate/)
    expect(() => parseArgs(['--docker-host', '--unexpected'])).toThrow(/requires a value/)
    expect(() => parseArgs(['--cleanup-run', 'not-a-uuid'])).toThrow(/UUID/)
    expect(() => parseArgs(['--cleanup-run', RUN_ID, '--docker-host', 'ssh://one'])).toThrow(/recorded/)
    expect(() => parseArgs(['--unexpected'])).toThrow(/unknown option/)
  })

  it('pins the selected endpoint by stripping inherited context and builder controls', () => {
    const env = buildDockerEnvironment({
      KEEP_ME: 'yes',
      DOCKER_HOST: 'tcp://wrong',
      DOCKER_CONTEXT: 'wrong',
      BUILDX_BUILDER: 'wrong',
      BUILDKIT_HOST: 'tcp://wrong',
      DOCKER_TLS_VERIFY: '1',
      DOCKER_CERT_PATH: '/wrong',
      DOCKER_SSH_COMMAND: 'unsafe-wrapper'
    })

    expect(env.KEEP_ME).toBe('yes')
    expect(env.DOCKER_BUILDKIT).toBe('1')
    for (const key of [
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'BUILDX_BUILDER',
      'BUILDKIT_HOST',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
      'DOCKER_SSH_COMMAND'
    ]) {
      expect(env).not.toHaveProperty(key)
    }
  })

  it('turns a shared-name adoption attempt red before creation', () => {
    expect(() => assertExactNameAbsent('volume', 'shared-data', { name: 'shared-data' })).toThrow(/refusing to adopt/)
    expect(() => assertExactNameAbsent('volume', 'fresh-data', null)).not.toThrow()
  })

  it('requires every ownership label to match before cleanup', () => {
    const expected = labelsFor(RUN_ID, 'server-first', SOURCE_SHA)
    expect(expected).toEqual({
      [LABEL_KEYS.run]: RUN_ID,
      [LABEL_KEYS.role]: 'server-first',
      [LABEL_KEYS.source]: SOURCE_SHA,
      [LABEL_KEYS.repo]: 'material-nodeterm'
    })
    expect(() => assertOwnedLabels(expected, expected, 'candidate')).not.toThrow()
    for (const key of Object.values(LABEL_KEYS)) {
      const missing = { ...expected }
      delete missing[key]
      expect(() => assertOwnedLabels(expected, missing, 'candidate')).toThrow(/does not match/)
      expect(() => assertOwnedLabels(expected, { ...expected, [key]: 'wrong' }, 'candidate')).toThrow(/does not match/)
    }
  })

  it('builds a private, bounded server without a host port or credential value in argv', () => {
    const secret = 'never-appear-in-argv'
    const labels = labelsFor(RUN_ID, 'server-first', SOURCE_SHA)
    const args = buildServerCreateArgs('candidate', 'candidate-data', 'candidate-image', labels)

    expect(args).toContain('none')
    expect(args).toContain('no-new-privileges=true')
    expect(args).toContain('ALL')
    expect(args).toContain('2g')
    expect(args).toContain('256')
    expect(args).not.toContain('-p')
    expect(args).not.toContain('--publish')
    expect(args.join(' ')).not.toContain(secret)
    expect(args.slice(args.indexOf('--env'), args.indexOf('--env') + 2)).toEqual([
      '--env',
      'NODETERM_SERVER_PASSWORD'
    ])
    expect(() => assertSafeDockerArgs(args, [secret])).not.toThrow()
    for (const publish of ['-P', '-p', '-p8443:8443', '-p=8443:8443', '--publish', '--publish=8443']) {
      expect(() => assertSafeDockerArgs(['run', publish, 'image'])).toThrow(/unsafe Docker argument/)
    }
    expect(() => assertSafeDockerArgs(['run', '--privileged=true', 'image'])).toThrow(/unsafe Docker argument/)
    expect(() => assertSafeDockerArgs(['run', '--env', secret, 'image'], [secret])).toThrow(/credential material/)

    const serverInvocation = buildServerInvocation('candidate', 'candidate-data', 'candidate-image', labels, secret)
    expect(serverInvocation.args.join(' ')).not.toContain(secret)
    expect(serverInvocation.env).toEqual({ NODETERM_SERVER_PASSWORD: secret })
    const probeInvocation = buildProbeInvocation('container-id', secret)
    expect(probeInvocation.args.join(' ')).not.toContain(secret)
    expect(JSON.parse(probeInvocation.input)).toEqual({ password: secret, expectSuccess: true })
  })

  it('keeps helper and server resource ceilings distinct', () => {
    expect(HELPER_LIMITS).toEqual(expect.arrayContaining([
      '--cpus', '1', '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '128'
    ]))
    expect(SERVER_LIMITS).toEqual(expect.arrayContaining([
      '--cpus', '2', '--memory', '2g', '--memory-swap', '2g', '--pids-limit', '256'
    ]))
    expect(HELPER_LIMITS).toEqual(expect.arrayContaining([
      '--security-opt', 'no-new-privileges=true', '--cap-drop', 'ALL'
    ]))
    expect(SERVER_LIMITS).toEqual(expect.arrayContaining([
      '--security-opt', 'no-new-privileges=true', '--cap-drop', 'ALL'
    ]))

    const serverPolicy = {
      PortBindings: {},
      NetworkMode: 'none',
      NanoCpus: 2_000_000_000,
      Memory: 2 * 1024 ** 3,
      MemorySwap: 2 * 1024 ** 3,
      PidsLimit: 256,
      SecurityOpt: ['no-new-privileges=true'],
      CapDrop: ['ALL'],
      CapAdd: ['CAP_CHOWN', 'CAP_DAC_OVERRIDE', 'CAP_FOWNER', 'CAP_SETGID', 'CAP_SETUID'],
      Privileged: false,
      Binds: ['nodeterm-smoke-' + RUN_ID + '-data:/data']
    }
    expect(() => assertRuntimePolicy('server-first', serverPolicy, RUN_ID)).not.toThrow()
    expect(() => assertRuntimePolicy('server-first', {
      ...serverPolicy,
      PortBindings: { '8443/tcp': [{ HostPort: '8443' }] }
    }, RUN_ID)).toThrow(/published a host port/)
    expect(() => assertRuntimePolicy('server-first', {
      ...serverPolicy,
      CapAdd: [...serverPolicy.CapAdd, 'CAP_SYS_ADMIN']
    }, RUN_ID)).toThrow(/capability allowlist/)
  })

  it('matches the exact capability sets returned by Docker inspect for every helper role', () => {
    const helperPolicy = {
      PortBindings: {},
      NetworkMode: 'none',
      NanoCpus: 1_000_000_000,
      Memory: 512 * 1024 ** 2,
      MemorySwap: 512 * 1024 ** 2,
      PidsLimit: 128,
      SecurityOpt: ['no-new-privileges=true'],
      CapDrop: ['ALL'],
      Privileged: false
    }
    const rootCaps = ['CAP_CHOWN', 'CAP_DAC_OVERRIDE', 'CAP_FOWNER']
    const migrationCaps = [...rootCaps, 'CAP_SETGID', 'CAP_SETUID']
    const dataBind = 'nodeterm-smoke-' + RUN_ID + '-data:/data'
    const outsideBind = 'nodeterm-smoke-' + RUN_ID + '-outside:/outside'

    expect(() => assertRuntimePolicy('seed-legacy', {
      ...helperPolicy,
      CapAdd: rootCaps,
      Binds: [dataBind, outsideBind]
    }, RUN_ID)).not.toThrow()
    expect(() => assertRuntimePolicy('verify-migration', {
      ...helperPolicy,
      CapAdd: migrationCaps,
      Binds: [dataBind, outsideBind]
    }, RUN_ID)).not.toThrow()
    expect(() => assertRuntimePolicy('seed-mixed', {
      ...helperPolicy,
      CapAdd: rootCaps,
      Binds: [dataBind]
    }, RUN_ID)).not.toThrow()
    expect(() => assertRuntimePolicy('seed-legacy', {
      ...helperPolicy,
      CapAdd: [...rootCaps, 'CAP_SYS_ADMIN'],
      Binds: [dataBind, outsideBind]
    }, RUN_ID)).toThrow(/capability allowlist/)
  })

  it('makes cleanup residue part of the verdict', () => {
    expect(() => assertNoRunResidue({ containers: [], volumes: [], images: [] })).not.toThrow()
    for (const kind of ['containers', 'volumes', 'images']) {
      const residue = { containers: [], volumes: [], images: [], [kind]: [kind + '-id'] }
      expect(() => assertNoRunResidue(residue)).toThrow(/cleanup residue/)
    }
  })

  it('runs signal/finally cleanup at most once and preserves a cleanup failure', () => {
    let calls = 0
    const cleanup = makeIdempotentCleanup(() => { calls += 1 })
    cleanup()
    cleanup()
    expect(calls).toBe(1)

    const failure = new Error('cleanup failed')
    let failedCalls = 0
    const failedCleanup = makeIdempotentCleanup(() => { failedCalls += 1; throw failure })
    expect(failedCleanup).toThrow(failure)
    expect(failedCleanup).toThrow(failure)
    expect(failedCalls).toBe(1)
  })

  it('fails closed on journal, daemon, and immutable resource identity drift', () => {
    const journal = {
      version: 1,
      runId: RUN_ID,
      endpoint: 'ssh://docker@example.test',
      sourceSha: SOURCE_SHA,
      phase: 'ready',
      daemonId: 'daemon-id',
      resources: []
    }
    expect(validateJournalShape({ ...journal }, RUN_ID)).toMatchObject(journal)
    expect(() => validateJournalShape({ ...journal, daemonId: null }, RUN_ID)).toThrow(/daemon identity/)
    expect(() => validateJournalShape({ ...journal, resources: null }, RUN_ID)).toThrow(/invalid shape/)
    expect(() => assertDaemonIdentity('daemon-id', 'daemon-id')).not.toThrow()
    expect(() => assertDaemonIdentity('daemon-id', 'another-daemon')).toThrow(/identity changed/)
    for (const kind of ['container', 'volume', 'image']) {
      expect(() => assertResourceIdentity(kind, 'recorded-id', 'recorded-id')).not.toThrow()
      expect(() => assertResourceIdentity(kind, 'recorded-id', 'replacement-id')).toThrow(/identity changed/)
    }
  })

  it('recognizes only exact Docker missing-resource diagnostics', () => {
    for (const message of [
      'Error response from daemon: No such container: missing',
      'Error response from daemon: No such image: missing',
      'Error response from daemon: get missing: no such volume'
    ]) {
      expect(isMissingResourceDiagnostic(message)).toBe(true)
    }
    expect(isMissingResourceDiagnostic('credential helper executable not found')).toBe(false)
    expect(isMissingResourceDiagnostic('SSH host not found')).toBe(false)
  })
})
