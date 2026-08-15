import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { promises as fs, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { request as httpRequest } from 'http'
import path from 'path'

const TEMP_HOME_MARKER = 'nt-pairing-'

// pairing-service computes AGENT_DIR / AGENT_JSON_PATH / AUTH_KEYS_PATH from `os.homedir()` at
// MODULE LOAD time, so the redirect has to be in place before the import — hence the mock factory
// (hoisted by vitest) minting the temp home itself. `networkInterfaces` is faked too so start()
// finds a LAN IP on a CI box with none. Everything else about `os` stays real.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const home = mkdtempSync(join(actual.tmpdir(), 'nt-pairing-'))
  const homedir = (): string => home
  const networkInterfaces = (): NodeJS.Dict<import('os').NetworkInterfaceInfo[]> => ({
    eth0: [
      {
        address: '192.168.1.42',
        netmask: '255.255.255.0',
        family: 'IPv4',
        mac: '02:00:00:00:00:01',
        internal: false,
        cidr: '192.168.1.42/24'
      }
    ]
  })
  const base = (actual as unknown as { default?: typeof actual }).default ?? actual
  return {
    ...actual,
    homedir,
    networkInterfaces,
    default: { ...base, homedir, networkInterfaces }
  }
})

import os from 'os'
import {
  createPairingService,
  type PairingRelayDeps,
  type PairingServiceTestHooks
} from './pairing-service'
import { rewriteKeyComment, type DeviceEntry } from './pairing-core'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  genKeyPair,
  publicKeyToB64,
  type KeyPair
} from './remote/e2ee'

const HOME = os.homedir()
const AGENT_JSON = path.join(HOME, '.nodeterm', 'agent.json')
const AUTH_KEYS = path.join(HOME, '.ssh', 'authorized_keys')
const HOST_KEYS = genKeyPair()

const secureDeps = (
  overrides: Partial<PairingRelayDeps> = {}
): PairingRelayDeps => ({
  getSettings: () => ({ phoneAccessEnabled: false }) as ReturnType<PairingRelayDeps['getSettings']>,
  getEntitlement: () => null,
  loadHostKeyPair: async () => HOST_KEYS,
  relayEndpoint: 'wss://relay.invalid',
  apiBase: 'https://api.invalid',
  // No relay network call in this suite; hostKey is still mandatory and advertised.
  relayAllowed: () => false,
  ...overrides
})

const newService = (
  hooks: PairingServiceTestHooks = {},
  deps: PairingRelayDeps = secureDeps()
) => createPairingService(deps, hooks)

/**
 * This file deletes directories under HOME. If the `os` mock above ever breaks or is dropped,
 * HOME becomes the developer's REAL home and those deletes take out `~/.ssh` — silently, because
 * nothing else in the suite can tell the difference. Refuse to run unless HOME is demonstrably one
 * of our mkdtemp dirs. Called at module scope (so nothing runs at all) and again before the
 * afterAll wipe.
 */
function assertTempHome(): void {
  if (!path.basename(HOME).startsWith(TEMP_HOME_MARKER)) {
    throw new Error(
      `pairing-service.test refuses to run: homedir() is "${HOME}", not a ${TEMP_HOME_MARKER}* ` +
        'temp dir. The os mock is not in effect and this file would delete the real ~/.ssh.'
    )
  }
}
assertTempHome()

// Stamped exactly the way pairing minted them, so `filterAuthorizedKeys` really matches.
const KEY_A = rewriteKeyComment('ssh-ed25519 AAAAblobAAAA phone-a@ios', 'dev-a')
const KEY_B = rewriteKeyComment('ssh-ed25519 AAAAblobBBBB phone-b@ios', 'dev-b')
// Not ours: no revoke may ever touch it (a fix that "passes" by truncating the file must fail).
const KEY_OTHER = 'ssh-rsa AAAAlaptopblob jdub@laptop'

const device = (id: string, name: string): DeviceEntry => ({
  id,
  name,
  token: `agent-token-${id}`,
  pairedAt: 1_700_000_000_000,
  lastSeenAt: 0
})

/** Agent.json as the host agent leaves it: our devices plus fields we don't own. */
const seed = (): void => {
  rmSync(path.join(HOME, '.nodeterm'), { recursive: true, force: true })
  rmSync(path.join(HOME, '.ssh'), { recursive: true, force: true })
  mkdirSync(path.join(HOME, '.nodeterm'), { recursive: true, mode: 0o700 })
  mkdirSync(path.join(HOME, '.ssh'), { recursive: true, mode: 0o700 })
  writeFileSync(
    AGENT_JSON,
    JSON.stringify(
      { hostId: 'host-keep-me', devices: [device('dev-a', 'Phone A'), device('dev-b', 'Phone B')] },
      null,
      2
    ) + '\n',
    { mode: 0o600 }
  )
  writeFileSync(AUTH_KEYS, `${KEY_OTHER}\n${KEY_A}\n${KEY_B}\n`, { mode: 0o600 })
}

const authKeys = (): string => readFileSync(AUTH_KEYS, 'utf8')
const agentJson = (): Record<string, unknown> => JSON.parse(readFileSync(AGENT_JSON, 'utf8'))
const deviceIds = (): string[] =>
  ((agentJson().devices as DeviceEntry[] | undefined) ?? []).map((d) => d.id)

/**
 * Hold the first read of each watched path until EITHER a second read of that path lands (the
 * unfixed code overlaps, so both revokes see the same stale bytes and each drops only its own
 * device) OR a short timer fires (the fixed code serializes them, so the second read never
 * overlaps and the test just runs ~150ms slower). Bytes are captured BEFORE the hold, so a
 * released writer can never hand the still-waiting reader fresh content by accident — and the
 * timer means this can never hang into an opaque vitest timeout.
 */
const OVERLAP_WAIT_MS = 150
function gateReads(watched: string[]): void {
  const captured = new Map<string, number>()
  const waiters = new Map<string, Array<() => void>>()
  const realReadFile = fs.readFile
  vi.spyOn(fs, 'readFile').mockImplementation((async (p: any, ...rest: any[]) => {
    const key = String(p)
    if (!watched.includes(key)) return (realReadFile as any)(p, ...rest)
    const bytes = await (realReadFile as any)(p, ...rest)
    const n = (captured.get(key) ?? 0) + 1
    captured.set(key, n)
    if (n >= 2) {
      for (const w of waiters.get(key) ?? []) w()
      waiters.set(key, [])
    } else {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, OVERLAP_WAIT_MS)
        // Released early → drop the timer, so a killed run leaves nothing pending.
        waiters.set(key, [
          ...(waiters.get(key) ?? []),
          () => {
            clearTimeout(t)
            resolve()
          }
        ])
      })
    }
    return bytes
  }) as any)
}

/** Make only the authoritative agent.json read fail; authorized_keys remains a real file. */
function failAgentJsonReads(code?: string): ReturnType<typeof vi.spyOn> {
  const realReadFile = fs.readFile
  return vi.spyOn(fs, 'readFile').mockImplementation((async (p: any, ...rest: any[]) => {
    if (String(p) === AGENT_JSON) {
      const error = new Error(`${code ?? 'unknown'} read failure`) as NodeJS.ErrnoException
      if (code) error.code = code
      throw error
    }
    return (realReadFile as any)(p, ...rest)
  }) as any)
}

/** A key line the phone could really have sent: OpenSSH wire format the validator decodes. */
function freshEd25519Line(): string {
  const name = Buffer.from('ssh-ed25519', 'ascii')
  const len = (n: number): Buffer => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n, 0)
    return b
  }
  const blob = Buffer.concat([len(name.length), name, len(32), randomBytes(32)])
  return `ssh-ed25519 ${blob.toString('base64')} phone@ios`
}

interface HttpResponse {
  status: number
  text: string
}

/** POST raw JSON to the real one-shot listener. */
function postWire(port: number, body: unknown): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/pair',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

function sealRequest(
  hostKey: string,
  body: unknown
): { wire: { epk: string; box: string }; sharedKey: Uint8Array } {
  const eph = genKeyPair()
  const sharedKey = deriveSharedKey(hostKey, eph.secretKey)
  // Keep the peer implementation independent of pairing-envelope.ts: this is the on-wire client
  // side, not a round-trip through the helper under test.
  const box = encrypt(Uint8Array.from(Buffer.from(JSON.stringify(body), 'utf8')), sharedKey)
  return {
    wire: { epk: publicKeyToB64(eph.publicKey), box: Buffer.from(box).toString('base64') },
    sharedKey
  }
}

async function postSecure(
  port: number,
  hostKey: string,
  body: unknown
): Promise<HttpResponse & { sharedKey: Uint8Array }> {
  const { wire, sharedKey } = sealRequest(hostKey, body)
  return { ...(await postWire(port, wire)), sharedKey }
}

/**
 * Open a real HTTP request, send all but its final byte, and leave it parked in the server's
 * readBody await. `onPairRequestAccepted` is the deterministic barrier proving the socket is on
 * the server side before competing requests settle the window.
 */
function beginPartialPost(
  port: number,
  body: unknown
): { response: Promise<HttpResponse>; finish(): void } {
  const payload = JSON.stringify(body)
  let resolveResponse!: (value: HttpResponse) => void
  let rejectResponse!: (reason: unknown) => void
  const response = new Promise<HttpResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  const req = httpRequest(
    {
      host: '127.0.0.1',
      port,
      path: '/pair',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    },
    (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (text += c))
      res.on('end', () => resolveResponse({ status: res.statusCode ?? 0, text }))
    }
  )
  req.on('error', rejectResponse)
  req.write(payload.slice(0, -1))
  return {
    response,
    finish: () => req.end(payload.slice(-1))
  }
}

beforeEach(() => {
  seed()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  assertTempHome()
  rmSync(HOME, { recursive: true, force: true })
})

describe('revokeDevice', () => {
  // revokeDevice is a read-modify-write over BOTH files (agent.json, then authorized_keys) and
  // src/main/index.ts hands every `pairing:revoke-device` invoke straight to it, unserialized. Two
  // overlapping revokes each read the ORIGINAL file and filter out only their own device, so
  // whichever write lands last republishes the other's — a revoked phone keeps its SSH key line,
  // and its agent.json entry comes back WITH the bearer token for the host-agent socket.
  it('two concurrent revokes both stick (no lost update in either file)', async () => {
    gateReads([AGENT_JSON, AUTH_KEYS])
    const service = newService()

    const results = await Promise.allSettled([
      service.revokeDevice('dev-a'),
      service.revokeDevice('dev-b')
    ])

    const keys = authKeys()
    expect(keys).not.toContain('nodeterm-ios-dev-a')
    expect(keys).not.toContain('nodeterm-ios-dev-b')
    expect(keys).toContain(KEY_OTHER) // the user's own key was never in scope
    expect(deviceIds()).toEqual([])
    expect(agentJson().hostId).toBe('host-keep-me') // fields we don't own survive the rewrite
    // Neither revoke may report failure to its caller either.
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
  })

  it('a failed revoke rejects to its caller and does not block the next one', async () => {
    const service = newService()
    // First rename is agent.json's, inside the failing revoke.
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), { code: 'EXDEV' })
    )

    await expect(service.revokeDevice('dev-a')).rejects.toThrow(/EXDEV/)
    // A serializer that chains failures onto its successors would strand every later revoke.
    await service.revokeDevice('dev-b')

    const keys = authKeys()
    expect(keys).not.toContain('nodeterm-ios-dev-b')
    expect(keys).toContain('nodeterm-ios-dev-a') // the failed revoke really did fail
    expect(deviceIds()).toEqual(['dev-a'])
  })

  it.each(['EACCES', 'EIO'])(
    'does not hide a live SSH key when authorized_keys read fails with %s',
    async (code) => {
      const beforeKeys = authKeys()
      const beforeRegistry = readFileSync(AGENT_JSON, 'utf8')
      const realReadFile = fs.readFile
      const write = vi.spyOn(fs, 'writeFile')
      vi.spyOn(fs, 'readFile').mockImplementation((async (file: any, ...rest: any[]) => {
        if (String(file) === AUTH_KEYS) {
          throw Object.assign(new Error(`${code}: authorized_keys read failed`), { code })
        }
        return (realReadFile as any)(file, ...rest)
      }) as any)

      await expect(newService().revokeDevice('dev-a')).rejects.toThrow(code)

      expect(authKeys()).toBe(beforeKeys)
      expect(readFileSync(AGENT_JSON, 'utf8')).toBe(beforeRegistry)
      expect(write).not.toHaveBeenCalled()
    }
  )

  it('treats ENOENT as the only safe absent authorized_keys file', async () => {
    rmSync(AUTH_KEYS)

    await newService().revokeDevice('dev-a')

    expect(deviceIds()).toEqual(['dev-b'])
  })

  it('revokes the SSH key first, so a mid-revoke failure leaves access cut and the device retryable', async () => {
    // Order matters on partial failure. authorized_keys is full shell access; agent.json is the
    // host-agent bearer token and the visible device list. If the SSH key is removed FIRST, a
    // failure on the second step leaves the bigger capability already revoked AND the device still
    // listed — so the owner sees it and can retry. The reverse order (drop the listing first) would
    // hide a device whose SSH key is still live, with no button left to finish the job.
    const service = newService()
    const realRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).includes('agent.json')) {
        throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' })
      }
      return realRename(from, to)
    })

    await expect(service.revokeDevice('dev-a')).rejects.toThrow(/EXDEV/)

    expect(authKeys()).not.toContain('nodeterm-ios-dev-a') // SSH access really was cut
    expect(deviceIds()).toContain('dev-a') // still listed, so the owner can retry
  })

  it('a single revoke drops exactly its own device, leaving the file 0600', async () => {
    const service = newService()

    await service.revokeDevice('dev-a')

    const keys = authKeys()
    expect(keys).toBe(`${KEY_OTHER}\n${KEY_B}\n`)
    expect(deviceIds()).toEqual(['dev-b'])
    expect(agentJson().hostId).toBe('host-keep-me')
    // Windows has no owner/group/other split: fs.chmod there can only clear/set a single
    // writable bit (mapped to the read-only DOS attribute), so 0o600's owner-write bit clears
    // read-only and stat() reports 0o666, never the POSIX-exact 0o600. Both are "we asked for
    // it to be writable and not group/world-restricted in the way this platform can express".
    const expectedMode = process.platform === 'win32' ? 0o666 : 0o600
    expect(statSync(AUTH_KEYS).mode & 0o777).toBe(expectedMode)
    expect(statSync(AGENT_JSON).mode & 0o777).toBe(expectedMode)
  })
})

describe('agent.json read safety', () => {
  it('treats ENOENT, and only ENOENT, as an absent registry', async () => {
    rmSync(AGENT_JSON)

    await expect(newService().listDevices()).resolves.toEqual([])
  })

  it('preserves malformed JSON byte-for-byte instead of degrading it to an empty registry', async () => {
    const malformed = '{"devices":['
    writeFileSync(AGENT_JSON, malformed)

    await expect(newService().listDevices()).rejects.toThrow(/invalid JSON/)
    expect(readFileSync(AGENT_JSON, 'utf8')).toBe(malformed)
  })

  it.each([
    ['an array root', '[]', /JSON object/],
    ['a non-array devices field', '{"devices":{}}', /devices.*array/]
  ])('rejects %s without rewriting it', async (_label, bytes, expected) => {
    writeFileSync(AGENT_JSON, bytes)

    await expect(newService().listDevices()).rejects.toThrow(expected)
    expect(readFileSync(AGENT_JSON, 'utf8')).toBe(bytes)
  })

  it.each([
    ['EACCES', /EACCES/],
    ['EIO', /EIO/],
    [undefined, /Could not read agent\.json/]
  ])('propagates a %s read failure instead of claiming no devices', async (code, expected) => {
    failAgentJsonReads(code)

    await expect(newService().listDevices()).rejects.toThrow(expected)
    expect(deviceIds()).toEqual(['dev-a', 'dev-b'])
  })

  it('does not rewrite agent.json when a revoke hits a failed authoritative read', async () => {
    const before = readFileSync(AGENT_JSON, 'utf8')
    const write = vi.spyOn(fs, 'writeFile')
    failAgentJsonReads('EIO')

    await expect(newService().revokeDevice('dev-a')).rejects.toThrow(/EIO/)

    expect(readFileSync(AGENT_JSON, 'utf8')).toBe(before)
    expect(
      write.mock.calls.some(([file]) => String(file).includes('agent.json'))
    ).toBe(false)
    // Revocation remains fail-safe: full SSH access is cut even though the registry stays visible
    // for a later retry.
    expect(authKeys()).not.toContain('nodeterm-ios-dev-a')
  })
})

describe('secure pairing listener', () => {
  it('refuses to start instead of advertising a plaintext fallback when the host key is unavailable', async () => {
    const done = vi.fn()
    const missingProvider = createPairingService()
    await expect(missingProvider.start(done)).rejects.toThrow(/no host-key provider/)

    const lockedKey = newService(
      {},
      secureDeps({ loadHostKeyPair: async (): Promise<KeyPair> => Promise.reject(new Error('locked')) })
    )
    await expect(lockedKey.start(done)).rejects.toThrow(/host key could not be loaded/)
    expect(done).not.toHaveBeenCalled()
  })

  it('rejects plaintext and tampered envelopes without writing either credential store', async () => {
    const service = newService()
    const append = vi.spyOn(fs, 'appendFile')
    const write = vi.spyOn(fs, 'writeFile')
    try {
      const started = await service.start(() => {})
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }
      const requestBody = { token, publicKey: freshEd25519Line(), deviceName: 'New Phone' }

      const plaintext = await postWire(pairPort, requestBody)
      expect(plaintext).toEqual({ status: 400, text: 'encrypted pairing required' })

      const { wire } = sealRequest(hostKey, requestBody)
      const tampered = Uint8Array.from(Buffer.from(wire.box, 'base64'))
      tampered[tampered.length - 1] ^= 0xff
      const badMac = await postWire(pairPort, {
        ...wire,
        box: Buffer.from(tampered).toString('base64')
      })
      expect(badMac).toEqual({ status: 400, text: 'decrypt failed' })

      expect(append).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(deviceIds()).toEqual(['dev-a', 'dev-b'])
      expect(authKeys()).toBe(`${KEY_OTHER}\n${KEY_A}\n${KEY_B}\n`)
    } finally {
      service.stop()
    }
  })

  it('returns every long-lived credential only inside authenticated ciphertext', async () => {
    const done = vi.fn()
    const service = newService()
    try {
      const started = await service.start(done)
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }
      const response = await postSecure(pairPort, hostKey, {
        token,
        publicKey: freshEd25519Line(),
        deviceName: 'New Phone'
      })

      expect(response.status).toBe(200)
      const wire = JSON.parse(response.text) as Record<string, unknown>
      expect(Object.keys(wire)).toEqual(['box'])
      expect(response.text).not.toContain('agentToken')
      expect(response.text).not.toContain('deviceId')
      const plain = decrypt(
        Uint8Array.from(Buffer.from(String(wire.box), 'base64')),
        response.sharedKey
      )
      expect(plain).not.toBeNull()
      const opened = JSON.parse(Buffer.from(plain!).toString('utf8')) as {
        ok: boolean
        deviceId: string
        agentToken: string
      }
      expect(opened.ok).toBe(true)
      expect(opened.agentToken).toMatch(/^[A-Za-z0-9_-]{32}$/)
      expect(response.text).not.toContain(opened.deviceId)
      expect(response.text).not.toContain(opened.agentToken)
      expect(deviceIds()).toEqual(['dev-a', 'dev-b', opened.deviceId])
      expect(done).toHaveBeenCalledOnce()
      expect(done).toHaveBeenCalledWith({ ok: true, relay: 'dev' })
    } finally {
      service.stop()
    }
  })

  it('fails closed before either credential write when response encryption is unavailable', async () => {
    const done = vi.fn()
    const service = newService({
      sealResponse: () => {
        throw new Error('secure randomness unavailable')
      }
    })
    const append = vi.spyOn(fs, 'appendFile')
    const write = vi.spyOn(fs, 'writeFile')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const started = await service.start(done)
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }

      const response = await postSecure(pairPort, hostKey, {
        token,
        publicKey: freshEd25519Line(),
        deviceName: 'No Ciphertext Phone'
      })

      expect(response).toMatchObject({ status: 500, text: 'pairing failed' })
      expect(append).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(deviceIds()).toEqual(['dev-a', 'dev-b'])
      expect(authKeys()).toBe(`${KEY_OTHER}\n${KEY_A}\n${KEY_B}\n`)
      expect(done).toHaveBeenCalledOnce()
      expect(done).toHaveBeenCalledWith({ ok: false, reason: 'failed' })
    } finally {
      service.stop()
    }
  })

  it('preserves a malformed registry and grants no SSH key during pairing', async () => {
    const malformed = '{"devices":['
    writeFileSync(AGENT_JSON, malformed)
    const done = vi.fn()
    const append = vi.spyOn(fs, 'appendFile')
    const write = vi.spyOn(fs, 'writeFile')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = newService()
    try {
      const started = await service.start(done)
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }

      const response = await postSecure(pairPort, hostKey, {
        token,
        publicKey: freshEd25519Line(),
        deviceName: 'Unreadable Registry Phone'
      })

      expect(response).toMatchObject({ status: 500, text: 'pairing failed' })
      expect(readFileSync(AGENT_JSON, 'utf8')).toBe(malformed)
      expect(append).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(done).toHaveBeenCalledOnce()
      expect(done).toHaveBeenCalledWith({ ok: false, reason: 'failed' })
    } finally {
      service.stop()
    }
  })

  it('does not activate an SSH key when registry publication fails', async () => {
    const beforeRegistry = readFileSync(AGENT_JSON, 'utf8')
    const beforeKeys = authKeys()
    const done = vi.fn()
    const append = vi.spyOn(fs, 'appendFile')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const realRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === AGENT_JSON) {
        throw Object.assign(new Error('EXDEV: registry publish failed'), { code: 'EXDEV' })
      }
      return realRename(from, to)
    })
    const service = newService()
    try {
      const started = await service.start(done)
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }

      const response = await postSecure(pairPort, hostKey, {
        token,
        publicKey: freshEd25519Line(),
        deviceName: 'Failed Registry Phone'
      })

      expect(response).toMatchObject({ status: 500, text: 'pairing failed' })
      expect(readFileSync(AGENT_JSON, 'utf8')).toBe(beforeRegistry)
      expect(authKeys()).toBe(beforeKeys)
      expect(append).not.toHaveBeenCalled()
      expect((await fs.readdir(path.dirname(AGENT_JSON))).filter((name) => name.endsWith('.tmp'))).toEqual([])
      expect(warn).toHaveBeenCalledWith('[pairing] request failed:', expect.any(Error))
      expect(done).toHaveBeenCalledOnce()
      expect(done).toHaveBeenCalledWith({ ok: false, reason: 'failed' })
    } finally {
      service.stop()
    }
  })

  it('keeps a partially activated SSH key visible and revocable when key finalization fails', async () => {
    const done = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const realChmod = fs.chmod.bind(fs)
    const chmod = vi.spyOn(fs, 'chmod').mockImplementation(async (file, mode) => {
      if (String(file) === AUTH_KEYS && mode === 0o600) {
        throw Object.assign(new Error('EACCES: key chmod failed'), { code: 'EACCES' })
      }
      return realChmod(file, mode)
    })
    const service = newService()
    try {
      const started = await service.start(done)
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }

      const response = await postSecure(pairPort, hostKey, {
        token,
        publicKey: freshEd25519Line(),
        deviceName: 'Retryable Phone'
      })

      expect(response).toMatchObject({ status: 500, text: 'pairing failed' })
      const entry = ((agentJson().devices as DeviceEntry[]) ?? []).find(
        (candidate) => candidate.name === 'Retryable Phone'
      )
      expect(entry).toBeDefined()
      expect(response.text).not.toContain(entry!.token)
      expect(authKeys()).toContain(`nodeterm-ios-${entry!.id}`)
      expect(await service.listDevices()).toContainEqual({
        id: entry!.id,
        name: entry!.name,
        pairedAt: entry!.pairedAt,
        lastSeenAt: entry!.lastSeenAt
      })
      expect(warn).toHaveBeenCalledWith('[pairing] request failed:', expect.any(Error))
      expect(done).toHaveBeenCalledOnce()
      expect(done).toHaveBeenCalledWith({ ok: false, reason: 'failed' })

      // The failed chmod happened after append. Keep the registry until an explicit revoke can
      // remove both the possibly-live key and its bearer record.
      chmod.mockRestore()
      await service.revokeDevice(entry!.id)
      expect(deviceIds()).toEqual(['dev-a', 'dev-b'])
      expect(authKeys()).not.toContain(`nodeterm-ios-${entry!.id}`)
    } finally {
      service.stop()
    }
  })

  it('five wrong codes settle an already-accepted correct request before it can write', async () => {
    let releaseAccepted!: () => void
    const accepted = new Promise<void>((resolve) => {
      releaseAccepted = resolve
    })
    let acceptedCount = 0
    const done = vi.fn()
    const service = newService({
      onPairRequestAccepted: () => {
        acceptedCount += 1
        if (acceptedCount === 1) releaseAccepted()
      }
    })
    const append = vi.spyOn(fs, 'appendFile')
    const write = vi.spyOn(fs, 'writeFile')
    try {
      const started = await service.start(done)
      const { token, shortCode, pairPort, hostKey } = {
        ...JSON.parse(started.payload),
        shortCode: started.shortCode
      } as { token: string; shortCode: string; pairPort: number; hostKey: string }
      const correct = sealRequest(hostKey, {
        token,
        publicKey: freshEd25519Line(),
        deviceName: 'Sixth Phone'
      })
      const parked = beginPartialPost(pairPort, correct.wire)
      await accepted // the correct socket is inside handleRequest before readBody's await

      const wrongCode = shortCode === '000000' ? '000001' : '000000'
      for (let i = 0; i < 4; i += 1) {
        const wrong = await postSecure(pairPort, hostKey, {
          token: wrongCode,
          publicKey: freshEd25519Line()
        })
        expect(wrong.status).toBe(403)
      }
      const fifth = await postSecure(pairPort, hostKey, {
        token: wrongCode,
        publicKey: freshEd25519Line()
      })
      expect(fifth.status).toBe(429)

      parked.finish()
      await expect(parked.response).resolves.toEqual({
        status: 409,
        text: 'pairing window is closed'
      })
      expect(done).toHaveBeenCalledOnce()
      expect(done).toHaveBeenCalledWith({ ok: false, reason: 'attempts' })
      expect(append).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
      expect(deviceIds()).toEqual(['dev-a', 'dev-b'])
      expect(authKeys()).toBe(`${KEY_OTHER}\n${KEY_A}\n${KEY_B}\n`)
    } finally {
      service.stop()
    }
  })
})

describe('pairing POST vs revoke', () => {
  // The pairing POST mutates the same two files: it APPENDS to authorized_keys and upserts into
  // agent.json. Overlapping a revoke, an unserialized pairing either appends onto the inode the
  // revoke is about to rename over, or loses its agent.json entry to the revoke's stale read —
  // and the revoke can equally be undone by the pairing's. Both mutations must share ONE queue.
  it('a pairing landing mid-revoke keeps both changes', async () => {
    const service = newService()
    try {
      const started = await service.start(() => {})
      const { token, pairPort, hostKey } = JSON.parse(started.payload) as {
        token: string
        pairPort: number
        hostKey: string
      }
      gateReads([AGENT_JSON, AUTH_KEYS])

      const [response] = await Promise.all([
        postSecure(pairPort, hostKey, {
          token,
          publicKey: freshEd25519Line(),
          deviceName: 'New Phone'
        }),
        service.revokeDevice('dev-a')
      ])

      expect(response.status).toBe(200)
      const wire = JSON.parse(response.text) as { box: string }
      const plain = decrypt(Uint8Array.from(Buffer.from(wire.box, 'base64')), response.sharedKey)
      expect(plain).not.toBeNull()
      const { deviceId } = JSON.parse(Buffer.from(plain!).toString('utf8')) as { deviceId: string }
      const keys = authKeys()
      expect(keys).not.toContain('nodeterm-ios-dev-a') // the revoke stuck
      expect(keys).toContain(`nodeterm-ios-${deviceId}`) // …and so did the pairing
      expect(keys).toContain(KEY_OTHER)
      expect(deviceIds()).toEqual(['dev-b', deviceId])
    } finally {
      service.stop()
    }
  })
})
