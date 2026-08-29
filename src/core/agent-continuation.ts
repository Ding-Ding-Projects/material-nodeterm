import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './fs-atomic'
import { platform } from './platform'
import type {
  AgentContinuationApi,
  AgentContinuationEvent,
  AgentContinuationPacket,
  AgentContinuationPreview,
  AgentContinuationResult
} from '../shared/agent-continuation'

const KEY_VERSION = 1
const FILE_VERSION = 1
const MAX_PACKETS = 256
const MAX_NODE_ID = 160
const MAX_SESSION_ID = 160
const MAX_SUMMARY = 320
const MAX_PREVIEW = 1600
const KEY_BYTES = 32
const NONCE_BYTES = 12
const KEY_FILE = 'agent-continuation-key.json'
const PACKET_FILE = 'agent-continuation-packets.json'
const AAD_PREFIX = 'nodeterm-agent-continuation-v1|'
const CONTINUATION_WARNING =
  'Review the recovered summary before continuing. Earlier side effects may already exist.'
const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

interface EncryptedRecord {
  version: 1
  nodeId: string
  nonce: string
  ciphertext: string
  tag: string
}

interface PacketFile {
  version: 1
  records: EncryptedRecord[]
}

interface ContinueDeps {
  /** True only after a provider-start event for this exact node/session was observed. */
  providerReady(nodeId: string, sessionId: string): boolean
  /** Deliver only after the user explicitly activated Continue in the review surface. */
  deliver(nodeId: string, sessionId: string, text: string): Promise<boolean>
}

function text(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : fallback
}

function validId(value: unknown, re: RegExp): value is string {
  return typeof value === 'string' && re.test(value)
}

/** Remove common bearer/credential-shaped values before a summary can be persisted or rendered. */
export function redactContinuationText(value: string, max: number): string {
  return text(
    value
      .replace(/(?:bearer|token|password|passwd|secret|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
      .replace(/(?:^|\s)(?:[A-Za-z]:\\|\/)(?:[^\s]*)(?=\s|$)/g, ' [path redacted] '),
    max,
    'The provider reported progress before the session became unavailable.'
  )
}

/**
 * Distil only Codex rollout event envelopes. Message bodies, tool arguments, and tool results are
 * intentionally ignored. The callback is fed from the provider transcript tail, never PTY output.
 */
export function parseCodexContinuationEvents(
  nodeId: string,
  sessionId: string,
  lines: string[]
): AgentContinuationEvent[] {
  if (!validId(nodeId, NODE_ID_RE) || !validId(sessionId, SESSION_ID_RE)) return []
  const out: AgentContinuationEvent[] = []
  for (const line of lines) {
    let record: { type?: unknown; payload?: { type?: unknown; role?: unknown } }
    try {
      record = JSON.parse(line) as typeof record
    } catch {
      continue
    }
    if (record.type === 'session_meta') {
      out.push({ nodeId, provider: 'codex', sessionId, phase: 'provider-start', summary: 'Codex provider session started.' })
    } else if (record.type === 'event_msg' && record.payload?.type === 'task_started') {
      out.push({ nodeId, provider: 'codex', sessionId, phase: 'turn-start', summary: 'Codex started a new turn.' })
    } else if (record.type === 'event_msg' && (record.payload?.type === 'task_complete' || record.payload?.type === 'turn_aborted')) {
      out.push({ nodeId, provider: 'codex', sessionId, phase: 'turn-stop', summary: 'Codex stopped before the next turn.' })
    } else if (record.type === 'response_item' && record.payload?.type === 'message') {
      out.push({
        nodeId,
        provider: 'codex',
        sessionId,
        phase: 'progress',
        summary: record.payload.role === 'user' ? 'Codex received a user turn.' : 'Codex produced provider progress.'
      })
    }
  }
  return out
}

function keyAad(nodeId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}${nodeId}`, 'utf8')
}

function packetPreview(packet: AgentContinuationPacket): AgentContinuationPreview {
  return {
    nodeId: packet.nodeId,
    provider: packet.provider,
    sessionId: packet.sessionId,
    summary: packet.summary,
    preview: packet.preview,
    warning: packet.warning,
    updatedAt: packet.updatedAt,
    acknowledged: packet.acknowledgedAt !== null
  }
}

function continuationPrompt(packet: AgentContinuationPacket): string {
  return [
    'Continue the interrupted Codex turn after reviewing the recovered state.',
    `Summary: ${packet.summary}`,
    `Preview: ${packet.preview}`,
    packet.warning
  ].join('\n')
}

class AgentContinuationStore {
  private chain: Promise<void> = Promise.resolve()

  private readonly root: string

  constructor(root = platform().userDataDir) {
    this.root = join(root, 'agent-continuation')
  }

  private async key(): Promise<Buffer> {
    const p = platform()
    if (typeof p.sealSecret !== 'function' || typeof p.unsealSecret !== 'function') {
      throw new Error('Agent continuation requires OS-backed secret storage.')
    }
    await fs.mkdir(this.root, { recursive: true })
    const file = join(this.root, KEY_FILE)
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { version?: unknown; keyEnc?: unknown }
      if (parsed.version !== KEY_VERSION || typeof parsed.keyEnc !== 'string') throw new Error('Agent continuation key is malformed.')
      const clear = p.unsealSecret(Buffer.from(parsed.keyEnc, 'base64'))
      if (clear.byteLength !== KEY_BYTES) throw new Error('Agent continuation key is invalid.')
      return clear
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const clear = randomBytes(KEY_BYTES)
    const body = {
      version: KEY_VERSION,
      keyEnc: p.sealSecret(clear).toString('base64')
    }
    await writeFileAtomic(file, `${JSON.stringify(body)}\n`, { mode: 0o600 })
    return clear
  }

  private async readFile(): Promise<Map<string, AgentContinuationPacket>> {
    let parsed: PacketFile
    try {
      parsed = JSON.parse(await fs.readFile(join(this.root, PACKET_FILE), 'utf8')) as PacketFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw error
    }
    if (parsed.version !== FILE_VERSION || !Array.isArray(parsed.records) || parsed.records.length > MAX_PACKETS) {
      throw new Error('Agent continuation packet file is malformed.')
    }
    const key = await this.key()
    const out = new Map<string, AgentContinuationPacket>()
    for (const record of parsed.records) {
      if (!record || record.version !== FILE_VERSION || !validId(record.nodeId, NODE_ID_RE)) throw new Error('Agent continuation record is malformed.')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'))
      decipher.setAAD(keyAad(record.nodeId))
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
      const clear = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()])
      const packet = JSON.parse(clear.toString('utf8')) as AgentContinuationPacket
      if (
        packet.version !== 1 ||
        packet.nodeId !== record.nodeId ||
        packet.provider !== 'codex' ||
        !validId(packet.nodeId, NODE_ID_RE) ||
        !validId(packet.sessionId, SESSION_ID_RE) ||
        typeof packet.summary !== 'string' || packet.summary.length > MAX_SUMMARY ||
        typeof packet.preview !== 'string' || packet.preview.length > MAX_PREVIEW ||
        packet.warning !== CONTINUATION_WARNING ||
        !Number.isSafeInteger(packet.createdAt) || !Number.isSafeInteger(packet.updatedAt) ||
        (packet.acknowledgedAt !== null && !Number.isSafeInteger(packet.acknowledgedAt))
      ) throw new Error('Agent continuation packet is invalid.')
      out.set(packet.nodeId, packet)
    }
    return out
  }

  private async writeFile(records: Map<string, AgentContinuationPacket>): Promise<void> {
    if (records.size > MAX_PACKETS) throw new Error('Too many agent continuation packets.')
    await fs.mkdir(this.root, { recursive: true })
    const key = await this.key()
    const encrypted: EncryptedRecord[] = []
    for (const packet of records.values()) {
      const nonce = randomBytes(NONCE_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(keyAad(packet.nodeId))
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(packet), 'utf8'), cipher.final()])
      encrypted.push({
        version: FILE_VERSION,
        nodeId: packet.nodeId,
        nonce: nonce.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        tag: cipher.getAuthTag().toString('base64')
      })
    }
    await writeFileAtomic(join(this.root, PACKET_FILE), `${JSON.stringify({ version: FILE_VERSION, records: encrypted })}\n`, { mode: 0o600 })
  }

  async all(): Promise<Map<string, AgentContinuationPacket>> {
    return this.readFile()
  }

  async update(nodeId: string, mutate: (current: AgentContinuationPacket | undefined) => AgentContinuationPacket | undefined): Promise<void> {
    const run = this.chain.then(async () => {
      const records = await this.readFile()
      const next = mutate(records.get(nodeId))
      if (next) records.set(nodeId, next)
      else records.delete(nodeId)
      await this.writeFile(records)
    })
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }
}

export interface AgentContinuationService extends AgentContinuationApi {
  observe(event: AgentContinuationEvent): void
  hydrate(): Promise<void>
}

export function createAgentContinuationService(store = new AgentContinuationStore()): AgentContinuationService {
  const listeners = new Set<(packets: AgentContinuationPreview[]) => void>()
  const receiptWaiters = new Map<string, Set<() => void>>()
  // Keep a monotonic receipt sequence per exact node/session. Delivery can resolve immediately
  // after the provider has already emitted its next-turn event, so a waiter registered afterwards
  // must still see that receipt. The sequence is scoped by the same key as the waiter, preventing
  // another node or session from satisfying the clear condition.
  const receiptSequences = new Map<string, number>()
  const retries = new Map<string, Promise<AgentContinuationResult>>()

  const notify = async (): Promise<void> => {
    let packets: AgentContinuationPreview[] = []
    try {
      packets = [...(await store.all()).values()].map(packetPreview)
    } catch {
      packets = []
    }
    for (const listener of listeners) listener(packets)
  }

  const observe = (event: AgentContinuationEvent): void => {
    if (
      event.provider !== 'codex' ||
      !validId(event.nodeId, NODE_ID_RE) ||
      !validId(event.sessionId, SESSION_ID_RE)
    ) return
    if (event.phase === 'provider-start') {
      return
    }
    if (event.phase === 'turn-start') {
      const key = `${event.nodeId}|${event.sessionId}`
      receiptSequences.set(key, (receiptSequences.get(key) ?? 0) + 1)
      for (const resolve of receiptWaiters.get(key) ?? []) resolve()
      receiptWaiters.delete(key)
    }
    if (event.phase === 'provider-end') return
    const now = Date.now()
    void store.update(event.nodeId, (current) => {
      const createdAt = current?.createdAt ?? now
      return {
        version: 1,
        nodeId: event.nodeId,
        provider: 'codex',
        sessionId: event.sessionId,
        summary: redactContinuationText(event.summary, MAX_SUMMARY),
        preview: redactContinuationText(event.preview ?? event.summary, MAX_PREVIEW),
        warning: CONTINUATION_WARNING,
        createdAt,
        updatedAt: now,
        acknowledgedAt: current?.acknowledgedAt ?? null
      }
    }).then(() => notify()).catch(() => undefined)
  }

  const waitForReceipt = (nodeId: string, sessionId: string, sinceSequence: number): Promise<boolean> => {
    const key = `${nodeId}|${sessionId}`
    if ((receiptSequences.get(key) ?? 0) > sinceSequence) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        receiptWaiters.get(key)?.delete(onReceipt)
        resolve(false)
      }, 15_000)
      const onReceipt = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const set = receiptWaiters.get(key) ?? new Set<() => void>()
      set.add(onReceipt)
      receiptWaiters.set(key, set)
    })
  }

  const service: AgentContinuationService = {
    async summary() {
      try {
        return [...(await store.all()).values()].map(packetPreview).sort((a, b) => b.updatedAt - a.updatedAt)
      } catch {
        return []
      }
    },
    async preview(nodeId) {
      if (!validId(nodeId, NODE_ID_RE)) return null
      try {
        const packets = await store.all()
        const packet = packets.get(nodeId)
        return packet ? packetPreview(packet) : null
      } catch {
        return null
      }
    },
    async ack(nodeId) {
      if (!validId(nodeId, NODE_ID_RE)) return false
      let changed = false
      try {
        await store.update(nodeId, (current) => {
          if (!current || current.acknowledgedAt !== null) return current
          changed = true
          return { ...current, acknowledgedAt: Date.now(), updatedAt: Date.now() }
        })
      } catch {
        return false
      }
      if (changed) await notify()
      return changed
    },
    async discard(nodeId) {
      if (!validId(nodeId, NODE_ID_RE)) return false
      let changed = false
      try {
        await store.update(nodeId, (current) => {
          changed = Boolean(current)
          return undefined
        })
      } catch {
        return false
      }
      if (changed) await notify()
      return changed
    },
    async continue(nodeId) {
      if (!validId(nodeId, NODE_ID_RE)) return { ok: false, reason: 'invalid' }
      const existing = retries.get(nodeId)
      if (existing) return existing
      const run = (async (): Promise<AgentContinuationResult> => {
        let packet: AgentContinuationPacket | undefined
        try {
          packet = (await store.all()).get(nodeId)
        } catch {
          return { ok: false, reason: 'unavailable' }
        }
        if (!packet) return { ok: false, reason: 'not-found' }
        const deps = (service as AgentContinuationService & { _deps?: ContinueDeps })._deps
        if (!deps?.providerReady(nodeId, packet.sessionId)) return { ok: false, reason: 'provider-not-ready' }
        const receiptBeforeDelivery = receiptSequences.get(`${nodeId}|${packet.sessionId}`) ?? 0
        if (!(await deps.deliver(nodeId, packet.sessionId, continuationPrompt(packet)))) {
          return { ok: false, reason: 'delivery-failed' }
        }
        if (!(await waitForReceipt(nodeId, packet.sessionId, receiptBeforeDelivery))) {
          return { ok: false, reason: 'receipt-timeout' }
        }
        try {
          await store.update(nodeId, () => undefined)
        } catch {
          return { ok: false, reason: 'unavailable' }
        }
        await notify()
        return { ok: true, packet: packetPreview(packet) }
      })().finally(() => retries.delete(nodeId))
      retries.set(nodeId, run)
      return run
    },
    onUpdate(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    observe,
    async hydrate() {
      await notify()
    }
  }
  return service
}

export function attachAgentContinuationDeps(service: AgentContinuationService, deps: ContinueDeps): void {
  Object.defineProperty(service, '_deps', { value: deps, configurable: true })
}
