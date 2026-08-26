import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_MAILBOX_KEY,
  AgentMailbox,
  agentEndpointAddress,
  renderAgentMessage,
  type AgentMessageEndpoint
} from './agentMailbox'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

const sender: AgentMessageEndpoint = {
  projectId: 'project-a',
  nodeId: 'term-sender',
  title: '[Mac][DEV] Sender',
  agentId: 'codex',
  sessionId: 'thread-sender'
}
const recipient: AgentMessageEndpoint = {
  projectId: 'project-a',
  nodeId: 'term-recipient',
  title: '[Mac][DEV][SE] MCP',
  agentId: 'codex',
  sessionId: 'thread-recipient'
}

beforeEach(() => vi.restoreAllMocks())

describe('AgentMailbox', () => {
  it('persists an authenticated envelope and renders the three mandatory header lines first', () => {
    const storage = memoryStorage()
    const mailbox = new AgentMailbox(storage)
    const message = mailbox.create({
      id: 'msg-1',
      sender,
      recipient,
      subject: 'MCP-FENCE-REGRESSION',
      body: 'Bestätigt: Reproduktion vorhanden.',
      now: new Date('2026-08-11T08:42:31.000Z')
    })

    const rendered = renderAgentMessage(message).split('\n')
    expect(rendered[0]).toMatch(/^Zeitstempel: 2026-08-11 \d{2}:42:31 .+ \(UTC[+-]\d{2}:\d{2}\)$/)
    expect(rendered[1]).toBe('Absender: [Mac][DEV] Sender (nodeterm:project-a/term-sender)')
    expect(rendered[2]).toBe('Empfänger: [Mac][DEV][SE] MCP (nodeterm:project-a/term-recipient)')
    expect(rendered[3]).toBe('MCP-FENCE-REGRESSION')
    expect(rendered.at(-2)).toBe('NodeTerm-Nachrichten-ID: msg-1')
    expect(rendered.at(-1)).toContain('reply --message msg-1')
    expect(JSON.parse(storage.getItem(AGENT_MAILBOX_KEY) ?? '[]')).toHaveLength(1)
  })

  it('renders a native Loop sender without an unusable reply command', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const message = mailbox.create({
      id: 'msg-loop',
      sender: { projectId: 'project-1', nodeId: 'scheduler-1', title: 'Loop: Daily status' },
      recipient: {
        projectId: 'project-1',
        nodeId: 'term-1',
        title: 'Agent',
        agentId: 'codex'
      },
      subject: 'LOOP: Daily status',
      body: 'Check status',
      now: new Date('2026-08-11T08:00:00Z')
    })

    const rendered = renderAgentMessage(message)
    expect(rendered).toContain('Automatischer NodeTerm Loop')
    expect(rendered).not.toContain('reply --message')
  })

  it('survives recreation, queues once, and persists delivery', () => {
    const storage = memoryStorage()
    const first = new AgentMailbox(storage)
    first.create({
      id: 'msg-2',
      sender,
      recipient,
      subject: 'STATUS',
      body: 'Bitte prüfen.'
    })

    const restored = new AgentMailbox(storage)
    expect(restored.queued('project-a').map((message) => message.id)).toEqual(['msg-2'])
    restored.markDelivered('msg-2', new Date('2026-08-11T09:00:00.000Z'))

    const final = new AgentMailbox(storage)
    expect(final.get('msg-2')).toMatchObject({
      status: 'delivered',
      deliveredAt: '2026-08-11T09:00:00.000Z'
    })
    expect(final.queued()).toEqual([])
  })

  it('rejects duplicate ids, invalid endpoints and empty payloads', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    mailbox.create({
      id: 'same',
      sender,
      recipient,
      subject: 'ONE',
      body: 'first'
    })
    expect(() =>
      mailbox.create({
        id: 'same',
        sender,
        recipient,
        subject: 'TWO',
        body: 'second'
      })
    ).toThrow('duplicate message id')
    expect(() =>
      mailbox.create({
        id: 'bad id',
        sender,
        recipient,
        subject: 'X',
        body: 'Y'
      })
    ).toThrow('invalid message id')
    expect(() =>
      mailbox.create({
        id: 'empty',
        sender,
        recipient,
        subject: '',
        body: 'Y'
      })
    ).toThrow('subject')
  })

  it('uses project plus node id as the visible routable address, never the mutable title', () => {
    expect(agentEndpointAddress({ ...sender, title: 'Renamed' })).toBe('nodeterm:project-a/term-sender')
  })
})

describe('bounded queue, TTL expiry, and refusal invariants', () => {
  it('refuses a self-send at create() as a backstop', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    expect(() =>
      mailbox.create({ id: 'msg-self', sender, recipient: sender, subject: 'x', body: 'y' })
    ).toThrow(/self-send/)
  })

  it('refuses a cross-project send at create() as a backstop', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const otherProject: AgentMessageEndpoint = { ...recipient, projectId: 'project-b' }
    expect(() =>
      mailbox.create({ id: 'msg-cross', sender, recipient: otherProject, subject: 'x', body: 'y' })
    ).toThrow(/cross-project/)
  })

  it('reports the queued depth for a recipient and refuses once it is full', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const cap = 3
    for (let i = 0; i < cap; i++) {
      mailbox.create({ id: `msg-${i}`, sender, recipient, subject: 's', body: 'b' })
    }
    expect(mailbox.queuedCountFor(recipient.nodeId)).toBe(cap)
    expect(mailbox.wouldOverflowQueue(recipient.nodeId, cap)).toBe(true)
    expect(() =>
      mailbox.create({ id: 'msg-overflow', sender, recipient, subject: 's', body: 'b' })
    ).not.toThrow() // default cap (AGENT_MAILBOX_QUEUE_CAP) is far above 3
    expect(mailbox.wouldOverflowQueue(recipient.nodeId, cap)).toBe(true)
  })

  it('delivering a queued message frees a slot in its recipient queue depth', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const message = mailbox.create({ id: 'msg-a', sender, recipient, subject: 's', body: 'b' })
    expect(mailbox.queuedCountFor(recipient.nodeId)).toBe(1)
    mailbox.markDelivered(message.id)
    expect(mailbox.queuedCountFor(recipient.nodeId)).toBe(0)
  })

  it('expireStale transitions a stale queued message to expired, never deletes it', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const created = new Date('2026-01-01T00:00:00.000Z')
    const message = mailbox.create({ id: 'msg-stale', sender, recipient, subject: 's', body: 'b', now: created })
    const past = new Date(created.getTime() + 16 * 60_000)
    const expired = mailbox.expireStale(past, 15 * 60_000)
    expect(expired.map((m) => m.id)).toEqual([message.id])
    const stored = mailbox.get(message.id)
    expect(stored?.status).toBe('expired')
    expect(stored?.expiredAt).toBe(past.toISOString())
  })

  it('expireStale leaves a fresh queued message untouched', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const created = new Date('2026-01-01T00:00:00.000Z')
    const message = mailbox.create({ id: 'msg-fresh', sender, recipient, subject: 's', body: 'b', now: created })
    const soon = new Date(created.getTime() + 60_000)
    expect(mailbox.expireStale(soon, 15 * 60_000)).toEqual([])
    expect(mailbox.get(message.id)?.status).toBe('queued')
  })

  it('expireStale never touches an already-delivered message', () => {
    const mailbox = new AgentMailbox(memoryStorage())
    const created = new Date('2026-01-01T00:00:00.000Z')
    const message = mailbox.create({ id: 'msg-done', sender, recipient, subject: 's', body: 'b', now: created })
    mailbox.markDelivered(message.id, created)
    const past = new Date(created.getTime() + 16 * 60_000)
    expect(mailbox.expireStale(past, 15 * 60_000)).toEqual([])
    expect(mailbox.get(message.id)?.status).toBe('delivered')
  })

  it('an expired message round-trips through storage as a valid status', () => {
    const storage = memoryStorage()
    const mailbox = new AgentMailbox(storage)
    const created = new Date('2026-01-01T00:00:00.000Z')
    mailbox.create({ id: 'msg-rt', sender, recipient, subject: 's', body: 'b', now: created })
    mailbox.expireStale(new Date(created.getTime() + 16 * 60_000), 15 * 60_000)
    const reloaded = new AgentMailbox(storage)
    expect(reloaded.get('msg-rt')?.status).toBe('expired')
  })
})
