import type { AgentId } from '@shared/agents/config'

export const AGENT_MAILBOX_KEY = 'nodeterm.agentMailbox.v1'
export const AGENT_MAILBOX_CAP = 500
/** How long a QUEUED message may sit before it is expired rather than silently dropped. Ported
 *  from upstream's deliver-on-idle design ('feat/messaging-bounded-queue'): a message the recipient
 *  never went idle for (busy forever, node gone, app restarted and never reopened) must eventually
 *  become a visible, checkable fact instead of aging out of the AGENT_MAILBOX_CAP ring unseen. */
export const AGENT_MESSAGE_TTL_MS = 15 * 60_000
/** Bounded per-recipient queue depth — the fan-in half of the bound. Without this a single stuck
 *  recipient could accept an unlimited number of queued sends before the TTL sweep ever runs. */
export const AGENT_MAILBOX_QUEUE_CAP = 20

export type AgentMessageStatus = 'queued' | 'delivered' | 'expired'

export interface AgentMessageEndpoint {
  projectId: string
  nodeId: string
  title: string
  agentId?: AgentId
  sessionId?: string
}

export interface AgentMessage {
  id: string
  conversationId: string
  replyTo?: string
  createdAt: string
  timestamp: string
  sender: AgentMessageEndpoint
  recipient: AgentMessageEndpoint
  subject: string
  body: string
  status: AgentMessageStatus
  deliveredAt?: string
  expiredAt?: string
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CreateAgentMessageInput {
  id: string
  conversationId?: string
  replyTo?: string
  sender: AgentMessageEndpoint
  recipient: AgentMessageEndpoint
  subject: string
  body: string
  now?: Date
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function validEndpoint(value: unknown): value is AgentMessageEndpoint {
  if (!value || typeof value !== 'object') return false
  const endpoint = value as Partial<AgentMessageEndpoint>
  return (
    typeof endpoint.projectId === 'string' &&
    SAFE_ID.test(endpoint.projectId) &&
    typeof endpoint.nodeId === 'string' &&
    SAFE_ID.test(endpoint.nodeId) &&
    typeof endpoint.title === 'string' &&
    !!oneLine(endpoint.title)
  )
}

function validMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<AgentMessage>
  return (
    typeof message.id === 'string' &&
    SAFE_ID.test(message.id) &&
    typeof message.conversationId === 'string' &&
    SAFE_ID.test(message.conversationId) &&
    typeof message.createdAt === 'string' &&
    typeof message.timestamp === 'string' &&
    validEndpoint(message.sender) &&
    validEndpoint(message.recipient) &&
    typeof message.subject === 'string' &&
    typeof message.body === 'string' &&
    (message.status === 'queued' || message.status === 'delivered' || message.status === 'expired')
  )
}

function offsetString(date: Date): string {
  const total = -date.getTimezoneOffset()
  const sign = total >= 0 ? '+' : '-'
  const abs = Math.abs(total)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** Human timestamp required by the shared inter-agent protocol. */
export function agentMessageTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const zone = pick('timeZoneName') || 'LOCAL'
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')} ${zone} (UTC${offsetString(date)})`
}

export function agentEndpointAddress(endpoint: AgentMessageEndpoint): string {
  return `nodeterm:${endpoint.projectId}/${endpoint.nodeId}`
}

export function renderAgentMessage(message: AgentMessage): string {
  const senderTitle = oneLine(message.sender.title)
  const recipientTitle = oneLine(message.recipient.title)
  const lines = [
    `Zeitstempel: ${message.timestamp}`,
    `Absender: ${senderTitle} (${agentEndpointAddress(message.sender)})`,
    `Empfänger: ${recipientTitle} (${agentEndpointAddress(message.recipient)})`,
    message.subject,
    '',
    message.body.trim(),
    '',
    `NodeTerm-Nachrichten-ID: ${message.id}`
  ]
  if (message.sender.agentId) {
    lines.push(`Antwort: NodeTerm-Canvas-Tool reply --message ${message.id} --text "<Antwort>"`)
  } else {
    lines.push('Automatischer NodeTerm Loop — keine Antwort an den Absender erforderlich.')
  }
  return lines.join('\n')
}

export class AgentMailbox {
  private messages: AgentMessage[]

  constructor(private readonly storage: StorageLike) {
    this.messages = this.load()
  }

  private load(): AgentMessage[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(AGENT_MAILBOX_KEY) ?? '[]') as unknown
      return Array.isArray(parsed) ? parsed.filter(validMessage).slice(-AGENT_MAILBOX_CAP) : []
    } catch {
      return []
    }
  }

  private save(): void {
    this.messages = this.messages.slice(-AGENT_MAILBOX_CAP)
    this.storage.setItem(AGENT_MAILBOX_KEY, JSON.stringify(this.messages))
  }

  /** Queued (not yet delivered/expired) messages addressed to this node, regardless of project —
   *  the bound `create()` enforces before ever accepting a new one. */
  queuedCountFor(nodeId: string): number {
    return this.messages.filter((message) => message.status === 'queued' && message.recipient.nodeId === nodeId).length
  }

  /** Would accepting one more queued message for `nodeId` exceed the bounded queue? Pure query —
   *  callers (the decider) use this BEFORE create() so a refusal never has to unwind a create. */
  wouldOverflowQueue(nodeId: string, cap = AGENT_MAILBOX_QUEUE_CAP): boolean {
    return this.queuedCountFor(nodeId) >= cap
  }

  /**
   * Transition every QUEUED message older than `ttlMs` (default AGENT_MESSAGE_TTL_MS) into
   * `expired`, at `now`. Never deletes — an expired message stays a checkable fact via `status()`
   * / `get()`, which is the whole point of a TTL that replaces a silent drop. Returns the messages
   * that expired in this call, for a caller that wants to notify a sender.
   */
  expireStale(now = new Date(), ttlMs = AGENT_MESSAGE_TTL_MS): AgentMessage[] {
    const cutoff = now.getTime() - ttlMs
    const expired: AgentMessage[] = []
    this.messages = this.messages.map((message) => {
      if (message.status !== 'queued') return message
      const createdAt = Date.parse(message.createdAt)
      if (!Number.isFinite(createdAt) || createdAt > cutoff) return message
      const next: AgentMessage = { ...message, status: 'expired', expiredAt: now.toISOString() }
      expired.push(next)
      return next
    })
    if (expired.length > 0) this.save()
    return expired
  }

  create(input: CreateAgentMessageInput): AgentMessage {
    if (!SAFE_ID.test(input.id)) throw new Error('invalid message id')
    if (this.messages.some((message) => message.id === input.id)) throw new Error('duplicate message id')
    if (!validEndpoint(input.sender) || !validEndpoint(input.recipient)) throw new Error('invalid message endpoint')
    if (input.sender.projectId === input.recipient.projectId && input.sender.nodeId === input.recipient.nodeId) {
      throw new Error('self-send refused')
    }
    if (input.sender.projectId !== input.recipient.projectId) throw new Error('cross-project send refused')
    if (this.wouldOverflowQueue(input.recipient.nodeId)) throw new Error('recipient queue is full')
    const subject = oneLine(input.subject)
    const body = input.body.trim()
    if (!subject || subject.length > 200) throw new Error('subject must contain 1-200 characters')
    if (!body || body.length > 32_000) throw new Error('message must contain 1-32000 characters')
    const now = input.now ?? new Date()
    const message: AgentMessage = {
      id: input.id,
      conversationId: input.conversationId ?? input.id,
      replyTo: input.replyTo,
      createdAt: now.toISOString(),
      timestamp: agentMessageTimestamp(now),
      sender: { ...input.sender, title: oneLine(input.sender.title) },
      recipient: { ...input.recipient, title: oneLine(input.recipient.title) },
      subject,
      body,
      status: 'queued'
    }
    this.messages.push(message)
    this.save()
    return message
  }

  get(id: string): AgentMessage | undefined {
    return this.messages.find((message) => message.id === id)
  }

  queued(projectId?: string): AgentMessage[] {
    return this.messages.filter(
      (message) => message.status === 'queued' && (!projectId || message.recipient.projectId === projectId)
    )
  }

  markDelivered(id: string, now = new Date()): AgentMessage | undefined {
    const index = this.messages.findIndex((message) => message.id === id)
    if (index < 0) return undefined
    const current = this.messages[index]
    if (current.status === 'delivered') return current
    const delivered = {
      ...current,
      status: 'delivered' as const,
      deliveredAt: now.toISOString()
    }
    this.messages[index] = delivered
    this.save()
    return delivered
  }
}

let defaultMailbox: AgentMailbox | undefined

export function agentMailbox(): AgentMailbox {
  if (!defaultMailbox) defaultMailbox = new AgentMailbox(localStorage)
  return defaultMailbox
}

export function resetAgentMailboxForTests(): void {
  defaultMailbox = undefined
}
