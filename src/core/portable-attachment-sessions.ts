import { randomUUID } from 'node:crypto'

export interface PortableAttachmentSession {
  id: string
  owner: string
  name: string
  quotaBytes: number
  receivedBytes: number
  expiresAt: number
  state: 'open' | 'committed' | 'rolled-back'
}

export interface PortableAttachmentSessionManagerOptions {
  now?: () => number
  defaultQuotaBytes?: number
  maxSessions?: number
  maxSessionTtlMs?: number
}

const DEFAULT_QUOTA = 512 * 1024 * 1024
const DEFAULT_TTL = 30 * 60 * 1000

/** Host-owned attachment upload ledger. Bytes remain in the caller's staging store; this manager
 * owns quotas, expiry, ownership, serialized append, and commit/rollback state only. */
export class PortableAttachmentSessionManager {
  private readonly sessions = new Map<string, { record: PortableAttachmentSession; chain: Promise<void> }>()
  private readonly now: () => number
  private readonly defaultQuota: number
  private readonly maxSessions: number
  private readonly maxTtl: number

  constructor(options: PortableAttachmentSessionManagerOptions = {}) {
    this.now = options.now ?? Date.now
    this.defaultQuota = options.defaultQuotaBytes ?? DEFAULT_QUOTA
    this.maxSessions = options.maxSessions ?? 10_000
    this.maxTtl = options.maxSessionTtlMs ?? DEFAULT_TTL
  }

  create(owner: string, name: string, options: { quotaBytes?: number; ttlMs?: number } = {}): PortableAttachmentSession {
    if (typeof owner !== 'string' || owner.length === 0 || owner.length > 256) throw new Error('Attachment owner is invalid.')
    if (typeof name !== 'string' || name.length === 0 || name.length > 512 || name.includes('\0') || /[\\/]/.test(name)) throw new Error('Attachment name is invalid.')
    if (this.sessions.size >= this.maxSessions) throw new Error('Attachment session quota is exhausted.')
    const quotaBytes = options.quotaBytes ?? this.defaultQuota
    const ttlMs = options.ttlMs ?? this.maxTtl
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0 || quotaBytes > this.defaultQuota ||
        !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > this.maxTtl) throw new Error('Attachment session limits are invalid.')
    const record: PortableAttachmentSession = {
      id: randomUUID(),
      owner,
      name,
      quotaBytes,
      receivedBytes: 0,
      expiresAt: this.now() + ttlMs,
      state: 'open'
    }
    this.sessions.set(record.id, { record, chain: Promise.resolve() })
    return { ...record }
  }

  get(id: string, owner: string): PortableAttachmentSession | null {
    const item = this.sessions.get(id)
    if (!item || item.record.owner !== owner) return null
    if (item.record.state === 'open' && item.record.expiresAt <= this.now()) {
      item.record.state = 'rolled-back'
    }
    return { ...item.record }
  }

  async append(id: string, owner: string, bytes: Uint8Array): Promise<PortableAttachmentSession> {
    const item = this.sessions.get(id)
    if (!item || item.record.owner !== owner) throw new Error('Attachment session is not owned by this caller.')
    const chunk = Buffer.from(bytes)
    if (chunk.length === 0) return this.requireOpen(item.record)
    let result!: PortableAttachmentSession
    const operation = item.chain.then(async () => {
      const open = this.requireOpen(item.record)
      if (open.receivedBytes + chunk.length > open.quotaBytes) throw new Error('Attachment session quota would be exceeded.')
      open.receivedBytes += chunk.length
      result = { ...open }
    })
    item.chain = operation.catch(() => {})
    await operation
    return result
  }

  async commit(id: string, owner: string): Promise<PortableAttachmentSession> {
    const item = this.sessions.get(id)
    if (!item || item.record.owner !== owner) throw new Error('Attachment session is not owned by this caller.')
    await item.chain
    const open = this.requireOpen(item.record)
    open.state = 'committed'
    return { ...open }
  }

  async rollback(id: string, owner: string): Promise<boolean> {
    const item = this.sessions.get(id)
    if (!item || item.record.owner !== owner) return false
    await item.chain
    if (item.record.state === 'committed') return false
    item.record.state = 'rolled-back'
    return true
  }

  reap(now = this.now()): number {
    let count = 0
    for (const [id, item] of this.sessions) {
      if (item.record.state === 'open' && item.record.expiresAt <= now) {
        item.record.state = 'rolled-back'
        count++
      }
      if (item.record.state === 'rolled-back') this.sessions.delete(id)
    }
    return count
  }

  private requireOpen(record: PortableAttachmentSession): PortableAttachmentSession {
    if (record.state !== 'open' || record.expiresAt <= this.now()) {
      record.state = 'rolled-back'
      throw new Error('Attachment session is expired or closed.')
    }
    return record
  }
}
