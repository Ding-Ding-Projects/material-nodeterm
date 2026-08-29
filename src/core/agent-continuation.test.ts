import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentContinuationService, parseCodexContinuationEvents, redactContinuationText } from './agent-continuation'
import { initPlatform, resetPlatformForTests, type CorePlatform } from './platform'

function platformFor(dir: string): CorePlatform {
  return {
    userDataDir: dir,
    appVersion: 'test',
    isPackaged: false,
    handle: vi.fn(),
    on: vi.fn(),
    handleWithSender: vi.fn(),
    onWithSender: vi.fn(),
    sendTo: vi.fn(),
    broadcast: vi.fn(),
    clientIds: () => [],
    openExternal: vi.fn(async () => undefined),
    sealSecret: (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xa5)),
    unsealSecret: (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xa5))
  }
}

async function waitForPacket(service: ReturnType<typeof createAgentContinuationService>): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if ((await service.summary()).length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('continuation packet did not persist')
}

describe('agent continuation packets', () => {
  let dir = ''

  it('redacts credentials and paths before the bounded preview is persisted', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    const service = createAgentContinuationService()
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'progress',
      summary: 'tool progress',
      preview: 'token=secret-value C:\\Users\\owner\\private.txt'
    })
    await waitForPacket(service)
    const packet = await service.preview('node-1')
    expect(packet?.preview).not.toContain('secret-value')
    expect(packet?.preview).not.toContain('C:\\Users\\owner')
    const files = await fs.readdir(join(dir, 'agent-continuation'))
    expect(files).toContain('agent-continuation-key.json')
    expect(files).toContain('agent-continuation-packets.json')
    const raw = await fs.readFile(join(dir, 'agent-continuation', 'agent-continuation-packets.json'), 'utf8')
    expect(raw).not.toContain('tool progress')
  })

  it('keeps one packet per node, acknowledges without clearing, and serializes continue', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    let ready = false
    let delivered = 0
    const service = createAgentContinuationService()
    Object.defineProperty(service, '_deps', {
      value: {
        providerReady: () => ready,
        deliver: async () => {
          delivered += 1
          setTimeout(() => service.observe({
            nodeId: 'node-1',
            provider: 'codex',
            sessionId: 'session-1',
            phase: 'turn-start',
            summary: 'next turn received'
          }), 0)
          return true
        }
      },
      configurable: true
    })
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'turn-stop',
      summary: 'interrupted turn'
    })
    await waitForPacket(service)
    expect(await service.ack('node-1')).toBe(true)
    expect(await service.preview('node-1')).not.toBeNull()
    const notReady = await service.continue('node-1')
    expect(notReady.ok).toBe(false)
    if (!notReady.ok) expect(notReady.reason).toBe('provider-not-ready')
    ready = true
    const [first, second] = await Promise.all([service.continue('node-1'), service.continue('node-1')])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(delivered).toBe(1)
    expect(await service.preview('node-1')).toBeNull()
  })

  it('rejects malformed private text without ever exposing the original value', () => {
    const result = redactContinuationText('password=hunter2 /tmp/private', 40)
    expect(result).not.toContain('hunter2')
    expect(result.length).toBeLessThanOrEqual(40)
  })

  it('does not accept a packet from another provider', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    const service = createAgentContinuationService()
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'progress',
      summary: 'valid'
    })
    await waitForPacket(service)
    expect(await service.preview('node-2')).toBeNull()
  })

  it('distils Codex transcript envelopes without copying message bodies or tool arguments', () => {
    const events = parseCodexContinuationEvents('node-1', 'session-1', [
      JSON.stringify({ type: 'session_meta', payload: { session_id: 'session-1' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', text: 'private body' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', result: 'private result' } })
    ])
    expect(events.map((event) => event.phase)).toEqual(['provider-start', 'turn-start', 'progress', 'turn-stop'])
    expect(JSON.stringify(events)).not.toContain('private body')
    expect(JSON.stringify(events)).not.toContain('private result')
  })

  it('retains the packet when delivery fails', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    const service = createAgentContinuationService()
    Object.defineProperty(service, '_deps', {
      value: {
        providerReady: () => true,
        deliver: async () => false
      },
      configurable: true
    })
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'turn-stop',
      summary: 'delivery failure'
    })
    await waitForPacket(service)

    await expect(service.continue('node-1')).resolves.toEqual({ ok: false, reason: 'delivery-failed' })
    expect(await service.preview('node-1')).not.toBeNull()
  })

  it('retains the packet when the next-turn receipt times out', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    const service = createAgentContinuationService()
    let deliveryStarted = 0
    Object.defineProperty(service, '_deps', {
      value: {
        providerReady: () => true,
        deliver: async () => {
          deliveryStarted += 1
          return true
        }
      },
      configurable: true
    })
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'turn-stop',
      summary: 'receipt timeout'
    })
    await vi.waitFor(async () => expect((await service.summary()).length).toBe(1))
    vi.useFakeTimers()

    const pending = service.continue('node-1')
    await vi.waitFor(() => expect(deliveryStarted).toBe(1))
    await vi.advanceTimersByTimeAsync(15_001)
    await expect(pending).resolves.toEqual({ ok: false, reason: 'receipt-timeout' })
    expect(await service.preview('node-1')).not.toBeNull()
  })

  it('does not let another node or session satisfy the receipt, then clears on the exact receipt', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    let deliveryCount = 0
    const service = createAgentContinuationService()
    Object.defineProperty(service, '_deps', {
      value: {
        providerReady: () => true,
        deliver: async () => {
          deliveryCount += 1
          return true
        }
      },
      configurable: true
    })
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'turn-stop',
      summary: 'exact receipt'
    })
    await vi.waitFor(async () => expect((await service.summary()).length).toBe(1))
    vi.useFakeTimers()

    const pending = service.continue('node-1')
    await vi.waitFor(() => expect(deliveryCount).toBe(1))
    service.observe({
      nodeId: 'node-2',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'turn-start',
      summary: 'wrong node'
    })
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-2',
      phase: 'turn-start',
      summary: 'wrong session'
    })
    await vi.advanceTimersByTimeAsync(15_001)
    await expect(pending).resolves.toEqual({ ok: false, reason: 'receipt-timeout' })
    expect(await service.preview('node-1')).not.toBeNull()

    const retry = service.continue('node-1')
    await vi.waitFor(() => expect(deliveryCount).toBe(2))
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'turn-start',
      summary: 'right receipt'
    })
    await expect(retry).resolves.toMatchObject({ ok: true })
    expect(deliveryCount).toBe(2)
    expect(await service.preview('node-1')).toBeNull()
  })

  it('rejects a node-id tamper through the packet record authentication binding', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nodeterm-continuation-'))
    initPlatform(platformFor(dir))
    const service = createAgentContinuationService()
    service.observe({
      nodeId: 'node-1',
      provider: 'codex',
      sessionId: 'session-1',
      phase: 'progress',
      summary: 'authenticated packet'
    })
    await waitForPacket(service)
    const packetPath = join(dir, 'agent-continuation', 'agent-continuation-packets.json')
    const parsed = JSON.parse(await fs.readFile(packetPath, 'utf8')) as {
      version: number
      records: Array<{ nodeId: string }>
    }
    parsed.records[0].nodeId = 'node-2'
    await fs.writeFile(packetPath, `${JSON.stringify(parsed)}\n`)

    expect(await service.preview('node-1')).toBeNull()
    expect(await service.summary()).toEqual([])
  })

  afterEach(() => {
    vi.useRealTimers()
    resetPlatformForTests()
  })
})
