// Phone-pairing service (main process) — the host side of the nodeterm iOS "scan a QR" flow.
//
// start() mints a one-time token, opens a single-shot LAN HTTP listener on a random port, and
// returns the JSON payload (for the renderer to render as a QR) plus whether SSH looks reachable.
// The phone scans the QR, generates an Ed25519 keypair on-device, and seals {token, publicKey}
// into the advertised host key's mandatory {epk,box} envelope before POSTing it to /pair. On a
// token match we append the key to ~/.ssh/authorized_keys and return the new bearer credentials
// only inside an authenticated response box. The private key never leaves the phone; the only
// secret in the QR is the single-use token.
//
// Pure bits (payload build, key validation, LAN-IPv4 pick) live in `pairing-core.ts` so they're
// unit-tested without spinning up a server.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { connect as netConnect } from 'net'
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import {
  buildPairingPayload,
  filterAuthorizedKeys,
  isValidEd25519PublicKey,
  normalizeAuthorizedKeysLine,
  normalizeDeviceName,
  pickLanIPv4,
  readDevices,
  removeDevice,
  rewriteKeyComment,
  toPublicDevices,
  upsertDevice,
  type DeviceEntry,
  type PublicDevice,
  type RelayPairingBlock
} from './pairing-core'
import type {
  DeviceRevokeResult,
  DeviceRevokeServerOutcome,
  PairingDoneResult,
  Settings
} from '../shared/types'
import { publicKeyToB64, deriveSharedKey, encrypt, decrypt, type KeyPair } from './remote/e2ee'
import { hostIdFromPublicKeyB64 } from './remote/relay-id'
import { getDeviceId } from '../core/device-id'
import { renameAtomic, sweepStaleTempFiles, tempNameFor } from '../core/fs-atomic'
import { openPairingEnvelope, sealPairingResponse } from './pairing-envelope'
import { withPairingRegistryLock } from './pairing-registry-lock'

const execFileAsync = promisify(execFile)

/**
 * Host-identity and optional relay dependencies injected into the pairing service. The host-key
 * provider is mandatory because it authenticates and encrypts the LAN exchange. When phone access
 * is enabled, a successful LAN pair also provisions the phone for the relay (a device token + the
 * host's relay identity), so it can reach this Mac from anywhere. Injected (not imported) so
 * `pairing-core` stays pure and this stays testable. A relay mint failure still degrades to LAN-only;
 * a missing host-key provider refuses to start.
 */
export interface PairingRelayDeps {
  getSettings(): Settings
  getEntitlement(): string | null
  loadHostKeyPair(): Promise<KeyPair>
  /** The relay WebSocket endpoint advertised to the phone. */
  relayEndpoint: string
  /** The API base for the /v1/relay/device mint. */
  apiBase: string
  /** Dev gate: never hit the prod relay/API from an unpackaged build (mirrors host-service). */
  relayAllowed(): boolean
}

interface RelayDeviceResponse {
  deviceToken: string
  hostId: string
  exp: number
}

/** Mint a relay device token so a freshly-paired phone can reach this host over the relay. */
async function mintRelayDevice(
  apiBase: string,
  body: {
    entitlement: string | null
    deviceId: string
    hostPublicKeyB64: string
    label?: string
    /** The phone's previous device token, relayed from the pair request: the backend's C2
     *  proof-of-possession demands it for FREE-tier re-registration — without it every free
     *  re-pair 403'd into a silent LAN-only pairing (the desktop can never hold this token
     *  itself; only the phone can supply it). */
    priorDeviceToken?: string
  }
): Promise<RelayDeviceResponse | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${apiBase}/v1/relay/device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        body.entitlement
          ? // hostDeviceId rides the ENTITLED mint too: without it the row lands with
            // hostDev=null and the backend's same-desktop C2 allowance can never match a
            // later free re-pair from this same machine (decoded live from a reauth log).
            { ...body, hostDeviceId: getDeviceId() }
          : {
              deviceId: body.deviceId,
              hostDeviceId: getDeviceId(),
              hostPublicKeyB64: body.hostPublicKeyB64,
              label: body.label,
              priorDeviceToken: body.priorDeviceToken
            }
      ),
      signal: ctrl.signal
    })
    if (!res.ok) return null
    const json = (await res.json().catch(() => ({}))) as Partial<RelayDeviceResponse>
    if (!json.deviceToken) return null
    return { deviceToken: json.deviceToken, hostId: json.hostId ?? '', exp: json.exp ?? 0 }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** How long a revoke waits for the backend before calling it unreachable. */
const REVOKE_TIMEOUT_MS = 8000

/**
 * Take a paired phone's Pro entitlement back. Until this existed, Remove was purely local — the
 * peer key was unpinned and the socket cut, while the server kept minting Pro for that phone
 * forever.
 *
 * Three outcomes, because two cannot tell the truth here:
 *  - 'ok'      the route answered 204. It is deliberately idempotent and reveals nothing about
 *              WHICH of its four cases applied (revoked it / unknown device / the row carries a
 *              'free:'/'apple:' id so there was nothing of ours on it / already revoked) — all
 *              four mean the phone holds no entitlement of ours, which is what we asked for.
 *  - 'failed'  we asked and were refused (403 = someone else's row, 401 = the token did not
 *              verify) or could not reach the server. The caller must NOT report a clean removal.
 *  - 'skipped' we did not ask, and that is a normal state: a free-tier desktop holds no
 *              entitlement to sign the request with (and has no Pro of ours on that phone to
 *              reclaim), or there is no device (and so no row) to name at all.
 *
 * `relayDeviceId` is phone-supplied, unvalidated text, so it rides the JSON body — never a URL.
 */
export async function revokeRelayDevice(
  apiBase: string,
  relayDeviceId: string,
  entitlement: string | null
): Promise<DeviceRevokeServerOutcome> {
  // Authorization for anything that moves a license is the signed entitlement, never a deviceId.
  if (!entitlement || !relayDeviceId || !apiBase) return 'skipped'
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REVOKE_TIMEOUT_MS)
  try {
    const res = await fetch(`${apiBase}/v1/relay/device/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: relayDeviceId, entitlement }),
      signal: ctrl.signal
    })
    return res.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Compute this host's relay reachability block WITHOUT any network call (just the already-loaded
 * host key → hostId), so the QR renders instantly. Returns null (LAN-only) when phone access is
 * off or blocked in dev.
 */
async function buildRelayContext(
  deps: PairingRelayDeps,
  hostKeys: KeyPair
): Promise<{ block: RelayPairingBlock; entitlement: string | null } | null> {
  if (!deps.relayAllowed()) return null
  if (!deps.getSettings().phoneAccessEnabled) return null
  const entitlement = deps.getEntitlement() // null on free tier → mint by deviceId
  const hostPublicKeyB64 = publicKeyToB64(hostKeys.publicKey)
  return {
    block: {
      hostId: hostIdFromPublicKeyB64(hostPublicKeyB64),
      hostPublicKeyB64,
      relayEndpoint: deps.relayEndpoint
    },
    entitlement
  }
}

/** How long the listener waits for the phone before giving up. 10 minutes, not 2: the QR can
 *  now be gated behind enabling Remote Login first, and a field report showed a user scanning a
 *  long-expired QR — a wider window plus the UI's explicit timeout state beats a tight one. */
const PAIR_TIMEOUT_MS = 10 * 60 * 1000
/** Probe timeout for the "is sshd listening on :22?" check. */
const SSH_PROBE_MS = 500
/** Reject oversized POST bodies (a public key line is well under this). */
const MAX_BODY_BYTES = 64 * 1024

/** Wrong codes tolerated before the pairing window closes itself. Five is enough for a
 *  mistyped digit and nowhere near enough to walk 10^6. */
const SHORT_CODE_MAX_ATTEMPTS = 5
const PAIRING_ATTEMPT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface PairingStartResult {
  /** Correlation UUID supplied by the renderer and echoed by completion events. */
  attemptId: string
  /** The single-line JSON to encode into the QR. */
  payload: string
  /** Compatibility credential accepted only inside an authenticated envelope. Same listener and
   *  ten-minute window, but attempt-capped because six digits is small. */
  shortCode: string
  /** Where to type it — the LAN address and port the listener is on. */
  manualHost: string
  /** True when 127.0.0.1:22 accepted a connection — sshd is (probably) running. */
  sshOpen: boolean
  /** What the QR on screen will mint: 'ok' = carries a relay block, 'dev' = unpackaged build
   *  (relayAllowed() off — the QR is LAN-only regardless of the toggle), 'off' = toggle off.
   *  Known at start, so the UI can warn BESIDE the QR instead of after the pairing. */
  relayPlan: 'ok' | 'dev' | 'off'
}

/** Fired once when pairing finishes; re-exported for main-side callers and tests. */
export type PairingDone = PairingDoneResult
type PairingDonePayload = Omit<PairingDoneResult, 'attemptId'>

export interface PairingService {
  /** Begin pairing; resolves once the listener is up. `onDone` fires exactly once later. */
  start(
    onDone: (result: PairingDone) => void,
    requestedAttemptId?: string
  ): Promise<PairingStartResult>
  /** Cancel the named attempt (or any active attempt for trusted main-side callers/tests). */
  stop(attemptId?: string): void
  /** All paired devices (token stripped) from ~/.nodeterm/agent.json. */
  listDevices(): Promise<PublicDevice[]>
  /**
   * Revoke a device: drop its agent.json entry, delete its authorized_keys line, AND take its Pro
   * entitlement back on the relay backend. The two legs are reported separately — see
   * `DeviceRevokeResult`; this never throws, because a failure the caller cannot see is exactly
   * how the server leg went missing in the first place.
   */
  revokeDevice(id: string): Promise<DeviceRevokeResult>
  /** Live re-probe of sshd (127.0.0.1:22), for the Remote Login warning's auto-clear. */
  probeSsh(): Promise<boolean>
}

/** ~/.nodeterm holds the host-agent config (agent.json). Created 0700 if missing. */
const AGENT_DIR = path.join(os.homedir(), '.nodeterm')
const AGENT_JSON_PATH = path.join(AGENT_DIR, 'agent.json')
const AUTH_KEYS_PATH = path.join(os.homedir(), '.ssh', 'authorized_keys')

/**
 * Read + parse ~/.nodeterm/agent.json. Only ENOENT proves absence: malformed bytes, a wrong root
 * shape, and read failures must propagate so a caller can never overwrite an unreadable registry
 * with a newly-created "empty" one.
 */
async function readAgentJson(): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await fs.readFile(AGENT_JSON_PATH, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') return {}
    throw new Error(`Could not read agent.json${code ? ` (${code})` : ''}.`, { cause: error })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('agent.json contains invalid JSON.', { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('agent.json must contain a JSON object.')
  }
  const obj = parsed as Record<string, unknown>
  if ('devices' in obj && !Array.isArray(obj.devices)) {
    throw new Error('agent.json "devices" must be an array when present.')
  }
  return obj
}

/** Detect the machine's display name (macOS ComputerName, else hostname). */
async function computerName(): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('scutil', ['--get', 'ComputerName'])
      const name = stdout.trim()
      if (name) return name
    } catch {
      // fall through to hostname
    }
  }
  return os.hostname()
}

/** Quick TCP probe of 127.0.0.1:22 to guess whether Remote Login (sshd) is on. */
function probeSsh(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (open: boolean): void => {
      if (done) return
      done = true
      try {
        sock.destroy()
      } catch {
        // ignore
      }
      resolve(open)
    }
    const sock = netConnect({ host: '127.0.0.1', port: 22 })
    sock.setTimeout(SSH_PROBE_MS)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
  })
}

/**
 * Append an already-normalized public-key line to ~/.ssh/authorized_keys with the right
 * permissions. The caller stamps the attributable `nodeterm-ios-<deviceId>` comment via
 * `rewriteKeyComment` before this point.
 */
async function appendAuthorizedKey(
  keyLine: string,
  afterBytesAppended?: () => void | Promise<void>
): Promise<void> {
  const sshDir = path.join(os.homedir(), '.ssh')
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 })
  await fs.chmod(sshDir, 0o700).catch(() => {})
  // Guard against a file that doesn't end in a newline (would concatenate onto the last key).
  let prefix = ''
  try {
    const existing = await fs.readFile(AUTH_KEYS_PATH, 'utf8')
    if (existing.length > 0 && !existing.endsWith('\n')) prefix = '\n'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT') {
      // An unreadable existing file may end without a newline. Appending blindly can splice the
      // new key into the prior line, corrupting both while the UI claims pairing merely failed.
      throw new Error(`Could not read authorized_keys${code ? ` (${code})` : ''}.`, {
        cause: error
      })
    }
    // Confirmed absent — appendFile creates it.
  }
  await fs.appendFile(AUTH_KEYS_PATH, prefix + normalizeAuthorizedKeysLine(keyLine) + '\n')
  await afterBytesAppended?.()
  await fs.chmod(AUTH_KEYS_PATH, 0o600)
}

/** Read the whole request body (capped), rejecting oversized payloads. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** @internal A deterministic barrier for the accepted-socket race test. */
export interface PairingServiceTestHooks {
  onPairRequestAccepted?(): void
  /** Barrier after registry publication and before the ownership recheck / SSH grant. */
  afterDevicePersisted?(): void | Promise<void>
  /** Barrier after SSH bytes append and before chmod / the cancellation rollback. */
  afterAuthorizedKeyAppended?(): void | Promise<void>
  sealResponse?(
    response: Record<string, unknown>,
    sharedKey: Uint8Array
  ): { box: string }
}

interface PairingAttempt {
  /** Renderer-generated UUID used to target stop and correlate delayed completion events. */
  id: string
  /** Synchronous latch: once true, no request belonging to this attempt may reach a write. */
  settled: boolean
  /** Completion/cancellation is separate from settlement while the winning request persists. */
  done: boolean
  server: Server | null
  timer: ReturnType<typeof setTimeout> | null
  onDone: ((result: PairingDone) => void) | null
}

/**
 * A request may proceed before settlement, while the request that synchronously claimed the
 * attempt may finish only until cancellation/completion. Keeping this policy in one guard makes
 * every accepted-socket gate fail together under mutation instead of accidentally testing one of
 * several redundant checks.
 */
function attemptAllowsRequest(attempt: PairingAttempt, ownsClaim = false): boolean {
  return !attempt.done && (ownsClaim || !attempt.settled)
}

export function createPairingService(
  relayDeps?: PairingRelayDeps,
  testHooks: PairingServiceTestHooks = {}
): PairingService {
  let activeAttempt: PairingAttempt | null = null

  /**
   * Serializes every mutation of agent.json / authorized_keys. The promise chain provides fair
   * ordering inside this process; the exclusive agent.json.lock covers the authoritative read and
   * the complete two-file transaction across desktop processes. Every external agent.json writer
   * must use that same lock before its read or atomic rename alone can still publish a stale copy.
   * The revoke case is the dangerous one: the loser's stale read republishes the device the winner
   * just revoked, key line and agent token both, so a revoked phone silently keeps access.
   */
  let mutateChain: Promise<void> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const runLocked = (): Promise<T> => withPairingRegistryLock(AGENT_JSON_PATH, fn)
    // Both arms run `fn`: one mutation failing must not cancel the ones queued behind it…
    const run = mutateChain.then(runLocked, runLocked)
    // …nor surface on them, while the caller still sees ITS OWN failure.
    mutateChain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Write agent.json atomically (0600), creating ~/.nodeterm (0700) if needed.
   *
   * Lives INSIDE the factory, below `serialize`, so no code path outside this closure can reach
   * it unchained — the same by-construction guarantee as GitHubControlStore's private write().
   * Overlapping entry points (the pairing POST, renderer revokes) are ordered by the in-process
   * chain and cross-process lock. `tempNameFor` still supplies UUID entropy so PID namespaces,
   * workers, PID reuse, and crash litter cannot share a staging path. The rename itself retries a
   * transient Windows sharing-violation error — see
   * src/core/fs-atomic.ts.
   * Overlapping entry points (the pairing POST, renderer revokes) are ordered by the chain; the
   * per-call temp name (`tempNameFor`: pid + module counter + UUID) covers the writers the chain
   * cannot see — the host agent is a separate PROCESS writing this same ~/.nodeterm, a second
   * service instance in THIS process, and a crash between tmp-write and rename.
   */
  async function writeAgentJson(obj: Record<string, unknown>): Promise<void> {
    await fs.mkdir(AGENT_DIR, { recursive: true, mode: 0o700 })
    await fs.chmod(AGENT_DIR, 0o700).catch(() => {})
    await sweepStaleTempFiles(AGENT_JSON_PATH)
    const tmp = tempNameFor(AGENT_JSON_PATH)
    try {
      await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
      await fs.chmod(tmp, 0o600).catch(() => {})
      await renameAtomic(tmp, AGENT_JSON_PATH)
    } catch (e) {
      // A unique name never self-heals the way the fixed one did (the next write just reused it),
      // and here a leaked temp IS a leaked credential: only this cleanup — or a later sweep after
      // the age grace and an owner pid no longer visible here mark it abandoned — will collect it.
      // The error propagates.
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    await fs.chmod(AGENT_JSON_PATH, 0o600).catch(() => {})
  }

  /** Persist a device into agent.json, preserving all other fields the host agent wrote. */
  async function persistDevice(entry: DeviceEntry): Promise<void> {
    const obj = await readAgentJson()
    const devices = upsertDevice(readDevices(obj), entry)
    await writeAgentJson({ ...obj, devices })
  }

  /**
   * Delete every authorized_keys line stamped for `deviceId`, rewriting the file atomically
   * (0600). In the closure below `serialize` for the same by-construction reason as
   * writeAgentJson; the per-call temp name covers the chain-invisible writers and the crash
   * window — a spliced line is a key sshd rejects, i.e. the keys that were supposed to SURVIVE
   * the revoke stop working. No orphan sweep here (unlike agent.json): these are PUBLIC keys, so
   * a stray temp is litter rather than a credential. The rename itself now retries a transient
   * Windows sharing-violation error — see src/core/fs-atomic.ts.
   */
  async function removeAuthorizedKeysForDevice(deviceId: string): Promise<void> {
    let content: string
    try {
      content = await fs.readFile(AUTH_KEYS_PATH, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') return // confirmed absent → nothing to revoke
      // "Could not check" is not "no key": continuing would hide the registry entry while an
      // unreadable authorized_keys file may still contain a live full-shell credential.
      throw new Error(`Could not read authorized_keys${code ? ` (${code})` : ''}.`, {
        cause: error
      })
    }
    const next = filterAuthorizedKeys(content, deviceId)
    if (next === content) return
    const tmp = tempNameFor(AUTH_KEYS_PATH)
    try {
      await fs.writeFile(tmp, next, { mode: 0o600 })
      await fs.chmod(tmp, 0o600).catch(() => {})
      await renameAtomic(tmp, AUTH_KEYS_PATH)
    } catch (e) {
      // A unique name never self-heals the way the fixed one did (the next write just reused it),
      // so a failed write has to remove its own temp — otherwise every failed revoke leaves
      // another orphan copy of the user's key file in ~/.ssh forever. The error still propagates.
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
    await fs.chmod(AUTH_KEYS_PATH, 0o600).catch(() => {})
  }

  const closeAttemptResources = (attempt: PairingAttempt): void => {
    if (attempt.timer) {
      clearTimeout(attempt.timer)
      attempt.timer = null
    }
    if (attempt.server) {
      attempt.server.close()
      attempt.server = null
    }
  }

  /** Cancel without notifying the renderer (stop/new start), but poison every accepted request. */
  const cancelAttempt = (attempt: PairingAttempt): void => {
    if (attempt.done) return
    attempt.settled = true
    attempt.done = true
    attempt.onDone = null
    closeAttemptResources(attempt)
    if (activeAttempt === attempt) activeAttempt = null
  }

  /** Fire this attempt's completion callback exactly once, then tear its own resources down. */
  const finishAttempt = (attempt: PairingAttempt, result: PairingDonePayload): void => {
    if (attempt.done) return
    attempt.settled = true
    attempt.done = true
    const cb = attempt.onDone
    attempt.onDone = null
    closeAttemptResources(attempt)
    if (activeAttempt === attempt) activeAttempt = null
    cb?.({ ...result, attemptId: attempt.id })
  }

  /**
   * Claim the single success path synchronously, before its first persistence await. Closing the
   * listener stops new sockets; the settled bit is what stops sockets HTTP already accepted.
   */
  const claimAttempt = (attempt: PairingAttempt): boolean => {
    if (!attemptAllowsRequest(attempt)) return false
    attempt.settled = true
    closeAttemptResources(attempt)
    return true
  }

  const start = async (
    onDone: (result: PairingDone) => void,
    requestedAttemptId?: string
  ): Promise<PairingStartResult> => {
    const attemptId = requestedAttemptId ?? randomUUID()
    // IPC callers control this value. Reject malformed or reusable-looking identifiers before
    // touching the active listener so an invalid renderer request cannot cancel valid pairing.
    if (!PAIRING_ATTEMPT_ID_RE.test(attemptId)) {
      throw new Error('Pairing attempt ID must be a cryptographic UUID.')
    }
    // A prior in-flight pairing is cancelled silently (no onDone) before starting a new one.
    if (activeAttempt) cancelAttempt(activeAttempt)
    const attempt: PairingAttempt = {
      id: attemptId,
      settled: false,
      done: false,
      server: null,
      timer: null,
      onDone
    }
    activeAttempt = attempt

    const host = pickLanIPv4(os.networkInterfaces())
    if (!host) {
      cancelAttempt(attempt)
      throw new Error("Couldn't detect a LAN IP address — connect to Wi-Fi and try again.")
    }
    // The QR's hostKey authenticates and encrypts the entire LAN exchange. Without a loadable host
    // identity no client can build the mandatory sealed request or authenticate returned bearer
    // credentials, so fail before constructing the payload or binding any port.
    if (!relayDeps) {
      cancelAttempt(attempt)
      throw new Error('Secure pairing is unavailable — this build has no host-key provider.')
    }
    const deps = relayDeps
    let hostKeys: KeyPair
    try {
      hostKeys = await deps.loadHostKeyPair()
    } catch {
      cancelAttempt(attempt)
      throw new Error(
        'Secure pairing is unavailable because this machine\'s host key could not be loaded.'
      )
    }
    if (attempt.done || activeAttempt !== attempt) {
      throw new Error('Pairing start was cancelled.')
    }
    const hostKey = publicKeyToB64(hostKeys.publicKey)
    let name: string
    let sshOpen: boolean
    let relayCtx: { block: RelayPairingBlock; entitlement: string | null } | null
    try {
      ;[name, sshOpen, relayCtx] = await Promise.all([
        computerName(),
        probeSsh(),
        buildRelayContext(deps, hostKeys)
      ])
    } catch (err) {
      cancelAttempt(attempt)
      throw err
    }
    if (attempt.done || activeAttempt !== attempt) {
      throw new Error('Pairing start was cancelled.')
    }
    const token = randomBytes(24).toString('base64url')
    // A SHORT compatibility code beside the full-entropy token the QR carries. It is accepted only
    // inside an authenticated envelope; there is no plaintext manual/browser path.
    //
    // Six digits is 10^6, which is brute-forceable in minutes over a LAN if nothing stops it —
    // so the short path is attempt-capped below (SHORT_CODE_MAX_ATTEMPTS) and dies with the
    // listener's existing ten-minute window. The cap, not the length, is what makes this safe;
    // without it this would be the weakest way into the machine.
    const shortCode = String(randomInt(0, 1_000_000)).padStart(6, '0')
    let shortAttempts = 0
    const user = os.userInfo().username

    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      void handleRequest(req, res)
    })
    attempt.server = srv

    // Bind a random high port on all interfaces (0.0.0.0) so the phone on the LAN can reach it.
    try {
      await new Promise<void>((resolve, reject) => {
        srv.once('error', reject)
        srv.listen(0, '0.0.0.0', () => {
          srv.removeListener('error', reject)
          resolve()
        })
      })
    } catch (err) {
      cancelAttempt(attempt)
      throw err
    }
    if (attempt.done || activeAttempt !== attempt) {
      closeAttemptResources(attempt)
      throw new Error('Pairing start was cancelled.')
    }

    const addr = srv.address()
    const pairPort = typeof addr === 'object' && addr ? addr.port : 0
    const payload = buildPairingPayload({
      host,
      port: 22,
      user,
      token,
      pairPort,
      name,
      hostKey,
      relay: relayCtx?.block
    })

    // Give up after ten minutes with a timeout result.
    attempt.timer = setTimeout(
      () => finishAttempt(attempt, { ok: false, reason: 'timeout' }),
      PAIR_TIMEOUT_MS
    )
    attempt.timer.unref?.()

    // The phone reads /pair responses off a raw TCP socket (ATS blocks URLSession for bare-IP
    // HTTP) and takes everything after the header block as the body, so every response must be
    // framed with an explicit Content-Length — otherwise Node chunks the HTTP/1.1 response and
    // the chunk-framing bytes corrupt the body on the phone.
    const send = (res: ServerResponse, code: number, body = '', type?: string): void => {
      if (res.destroyed || res.headersSent) return
      const headers: Record<string, string | number> = { 'Content-Length': Buffer.byteLength(body) }
      if (type) headers['Content-Type'] = type
      // Keep the listener usable by an authenticated cross-origin client that implements the same
      // mandatory encrypted envelope. Server Edition does not expose this desktop-host capability.
      //
      // Why `*` is not a hole here: CORS is not the access control. The host-key-authenticated box
      // protects the one-time token and request, and the listener exists for ten minutes and stops
      // at the first success. Restricting an origin would not authenticate a client or a device.
      headers['Access-Control-Allow-Origin'] = '*'
      res.writeHead(code, headers).end(body)
    }

    /** Drain the body so an accepted keep-alive socket cannot remain parked after settlement. */
    const rejectSettled = (req: IncomingMessage, res: ServerResponse): void => {
      req.resume()
      send(res, 409, 'pairing window is closed')
    }

    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      // server.close() stops new connections but does NOT cancel sockets HTTP already accepted.
      // This check is deliberately before readBody's first await (and before route handling); the
      // second check below catches a request parked inside readBody when another request settled.
      if (!attemptAllowsRequest(attempt)) {
        rejectSettled(req, res)
        return
      }
      // An authenticated browser client sends a preflight before a cross-origin JSON POST.
      if (req.method === 'OPTIONS' && req.url === '/pair') {
        const headers: Record<string, string | number> = {
          'Content-Length': 0,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': 600
        }
        res.writeHead(204, headers).end()
        return
      }
      if (req.method !== 'POST' || req.url !== '/pair') {
        send(res, 404)
        return
      }
      testHooks.onPairRequestAccepted?.()
      try {
        const raw = await readBody(req)
        if (!attemptAllowsRequest(attempt)) {
          rejectSettled(req, res)
          return
        }
        let outer: unknown
        try {
          outer = JSON.parse(raw)
        } catch {
          send(res, 400, 'bad json')
          return
        }
        const opened = openPairingEnvelope(outer, hostKeys)
        if (!opened.ok) {
          send(res, 400, opened.reason)
          return
        }
        const { body, sharedKey } = opened
        // Either credential opens the pairing: the QR's full token, or the six-digit code the
        // user typed. Compared in constant time — a short code is exactly the case where a
        // byte-at-a-time timing oracle would turn 10^6 guesses into 60.
        const supplied = typeof body.token === 'string' ? body.token : ''
        const eq = (a: string, b: string): boolean => {
          const ab = Buffer.from(a)
          const bb = Buffer.from(b)
          return ab.length === bb.length && timingSafeEqual(ab, bb)
        }
        const byToken = eq(supplied, token)
        const byShort = !byToken && eq(supplied, shortCode)

        if (byShort) {
          shortAttempts += 1
        } else if (!byToken) {
          // A wrong value counts against the short-code budget too. Otherwise the cap is trivially
          // sidestepped: guess six digits, and if it fails claim you were attempting the long
          // token instead.
          shortAttempts += 1
        }

        if (!byToken && !byShort) {
          if (shortAttempts >= SHORT_CODE_MAX_ATTEMPTS) {
            // Stop the whole listener rather than just refusing this request. A pairing window
            // that keeps answering after five wrong codes is a window someone is working on.
            // Latch BEFORE responding/closing: accepted sockets can otherwise cross their
            // readBody await after server.close() and successfully write with the right token.
            attempt.settled = true
            send(res, 429, 'too many attempts — press Pair again for a fresh code')
            finishAttempt(attempt, { ok: false, reason: 'attempts' })
            return
          }
          send(res, 403, 'bad token')
          return
        }
        const publicKey = typeof body.publicKey === 'string' ? body.publicKey.trim() : ''
        if (!isValidEd25519PublicKey(publicKey)) {
          send(res, 400, 'unexpected key type')
          return
        }
        // The winner claims the attempt synchronously. Two correct requests that finish parsing
        // together cannot both cross the first persistence await, and a request already accepted
        // before the fifth wrong code cannot wake later and become the winner.
        if (!claimAttempt(attempt)) {
          rejectSettled(req, res)
          return
        }
        // Mint a device identity: the deviceId stamps the key line (attributable + revocable);
        // the agentToken is the phone's bearer for the host-agent WebSocket (stored in its Keychain).
        const deviceId = randomUUID()
        const agentToken = randomBytes(24).toString('base64url')
        const name = normalizeDeviceName(body.deviceName)
        // The phone's OWN id — the key the relay backend stores its device row under, and the
        // only one it would recognize in a later revoke. Resolved here rather than at the mint
        // below so the registry entry can carry it; the fallback (phone sent none ⇒ our id) is
        // unchanged, and the mint still reads this same value.
        const phoneDeviceId =
          typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : deviceId
        // Provision relay access for the phone when enabled + Pro. Any failure ⇒ LAN-only: we
        // never fail the pairing over a relay hiccup (the phone still got its SSH key installed).
        let relayFields: { relay?: RelayPairingBlock; relayDeviceToken?: string } = {}
        if (relayCtx) {
          const minted = await mintRelayDevice(relayDeps!.apiBase, {
            entitlement: relayCtx.entitlement,
            deviceId: phoneDeviceId,
            hostPublicKeyB64: relayCtx.block.hostPublicKeyB64,
            label: name,
            priorDeviceToken:
              typeof body.priorDeviceToken === 'string' ? body.priorDeviceToken : undefined
          })
          if (minted?.deviceToken) {
            relayFields = {
              relay: { ...relayCtx.block, hostId: minted.hostId || relayCtx.block.hostId },
              relayDeviceToken: minted.deviceToken
            }
          }
        }
        if (!attemptAllowsRequest(attempt, true)) {
          rejectSettled(req, res)
          return
        }
        // Seal BEFORE any filesystem write. If encryption/randomness is unavailable, no SSH key
        // or bearer record is installed for a client that can never receive its credentials.
        const responseObj = { ok: true, deviceId, agentToken, ...relayFields }
        const sealedResponse = (testHooks.sealResponse ?? sealPairingResponse)(responseObj, sharedKey)
        // One unit, and queued behind any in-flight revoke. Publish the registry FIRST, then grant
        // SSH. If the registry write fails, no live key exists. If key append/chmod fails after a
        // partial append, the device remains visible and revocable; rolling the registry back
        // would turn that potentially-live key into the untracked credential this order prevents.
        await serialize(async () => {
          await persistDevice({
            id: deviceId,
            name,
            token: agentToken,
            pairedAt: Date.now(),
            lastSeenAt: 0,
            relayDeviceId: phoneDeviceId
          })
          await testHooks.afterDevicePersisted?.()
          // stop() and a superseding start poison this attempt synchronously. Re-check after the
          // registry await: a canceled winner may leave its bearer record visible/revocable, but
          // it must never activate an SSH key for a phone that will receive no response box.
          if (!attemptAllowsRequest(attempt, true)) return
          let keyAppendStarted = false
          try {
            // Set before entering the helper: appendFile can partially write and still reject.
            // Cancellation cleanup therefore inspects/removes the attributable line after any
            // activation error, not only after a fully successful append/chmod sequence.
            keyAppendStarted = true
            await appendAuthorizedKey(
              rewriteKeyComment(publicKey, deviceId),
              testHooks.afterAuthorizedKeyAppended
            )
          } finally {
            // Cancellation can land while append/chmod is awaiting I/O. Remove the attributable
            // key before the old request is rejected, including when chmod itself rejects after the
            // append. Keep the registry row so an I/O failure stays visible/retryable through Revoke.
            if (keyAppendStarted && !attemptAllowsRequest(attempt, true)) {
              await removeAuthorizedKeysForDevice(deviceId)
            }
          }
        })
        if (!attemptAllowsRequest(attempt, true)) {
          rejectSettled(req, res)
          return
        }
        send(res, 200, JSON.stringify(sealedResponse), 'application/json')
        finishAttempt(attempt, {
          ok: true,
          relay: relayCtx
            ? relayFields.relayDeviceToken
              ? 'ok'
              : 'failed'
            : !deps.relayAllowed()
              ? 'dev'
              : 'off'
        })
      } catch (err) {
        if (attempt.done) {
          rejectSettled(req, res)
          return
        }
        send(res, 500, 'pairing failed')
        console.warn('[pairing] request failed:', err)
        // A winning request owns the now-closed attempt. If it cannot seal or persist, report a
        // failed completion rather than leaving the renderer waiting on a listener that is gone.
        if (attempt.settled) finishAttempt(attempt, { ok: false, reason: 'failed' })
      }
    }

    return {
      attemptId,
      payload,
      shortCode,
      manualHost: `${host}:${pairPort}`,
      sshOpen,
      relayPlan: relayCtx ? 'ok' : !deps.relayAllowed() ? 'dev' : 'off'
    }
  }

  const stop = (attemptId?: string): void => {
    if (activeAttempt && (attemptId === undefined || activeAttempt.id === attemptId)) {
      cancelAttempt(activeAttempt)
    }
  }

  const listDevices = async (): Promise<PublicDevice[]> => {
    return toPublicDevices(readDevices(await readAgentJson()))
  }

  // One unit: agent.json and authorized_keys must not be revoked half-way by an interleaving writer.
  //
  // authorized_keys goes FIRST, and the order is load-bearing on partial failure. That file is full
  // shell access; agent.json holds the host-agent bearer token and the device the UI lists. If the
  // second step fails, revoking the SSH key first leaves the BIGGER capability already gone and the
  // device still listed — visible to its owner, with the Revoke button still there to finish the
  // job. The reverse order fails the other way: the device disappears from the list while its key
  // is still live, so the owner believes it revoked and has no way left to retry.
  //
  // The relay device id is read BEFORE either write and kept even when the local leg fails: the
  // entitlement is what authorizes the server leg, not the local write's success, and a phone the
  // user asked to remove should stop being minted Pro either way.
  const revokeDevice = async (id: string): Promise<DeviceRevokeResult> => {
    const { local, relayId, found } = await serialize(async () => {
      let entry: DeviceEntry | undefined
      try {
        entry = readDevices(await readAgentJson()).find((d) => d.id === id)
      } catch (err) {
        // The key is the larger capability. Keep going so an authoritative registry read failure
        // cannot leave SSH access live; the second read below still refuses to rewrite the record.
        console.warn('[pairing] could not read device registry before revoke:', err)
      }
      const relayId = entry?.relayDeviceId
      const found = !!entry
      try {
        await removeAuthorizedKeysForDevice(id)
        const obj = await readAgentJson()
        const devices = removeDevice(readDevices(obj), id)
        await writeAgentJson({ ...obj, devices })
        return { local: true, relayId, found }
      } catch (err) {
        // Reported, not thrown: `local:false` is what the UI turns into "try again", and the
        // server leg below is still worth running. The detail belongs in the log.
        console.warn('[pairing] local revoke failed:', err)
        return { local: false, relayId, found }
      }
    })
    // A device paired before `relayDeviceId` was recorded still falls back to OUR id — which is
    // not a guess. `id` is the per-pairing `randomUUID()` above, and when the phone sent no id of
    // its own the mint sent exactly this value as the row's `deviceId` (see `phoneDeviceId`), so
    // the row really is keyed on it. It is NOT this desktop's machine id (`getDeviceId()`), which
    // is never a key in `relay_devices` — it lives only in the non-key `host_device_id` column,
    // and /v1/relay/host-token writes no row at all — so this cannot reach the desktop's own
    // registration. Nor can it reach a stranger's: the route authorizes by the row's licenseId /
    // hostDeviceId and answers 403 otherwise, and 204 (no write) for a row carrying a
    // 'free:'/'apple:' id — which is what keeps an Apple purchase bridged to this desktop safe.
    //
    // RESIDUAL LEAK, deliberately not closed here: a pre-Task-12 pairing where the phone DID send
    // its own id (every iOS build since 2026-07-10 does) has a row keyed by a value we never
    // recorded, and the backend's 204 reveals nothing — so this reports 'ok' having asked about a
    // row that is not that phone's, and the phone keeps Pro. The desktop cannot name that row at
    // all; re-pairing the phone records its id (the phone's id is stable and the mint upserts on
    // it), after which a removal revokes for real. Closing it properly needs a
    // server-side "devices for this host" read, which does not exist yet.
    //
    // Deliberately OUTSIDE the mutation chain: this is a network round trip, and holding the
    // agent.json/authorized_keys queue open for it would stall a concurrent pairing POST behind
    // an unreachable backend. No local state depends on the answer.
    const server = found
      ? await revokeRelayDevice(
          relayDeps?.apiBase ?? '',
          relayId ?? id,
          relayDeps?.getEntitlement() ?? null
        )
      : 'skipped'
    return { local, server }
  }

  return { start, stop, listDevices, revokeDevice, probeSsh }
}
