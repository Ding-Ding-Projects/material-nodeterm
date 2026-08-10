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
