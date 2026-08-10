import os from 'os'

export const BROWSER_USE_MAX_FRAME_BYTES = 8 * 1024 * 1024

export interface BrowserDebuggerLike {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown>
  on(
    event: 'message',
    listener: (
      event: unknown,
      method: string,
      params: Record<string, unknown>,
      sessionId?: string
    ) => void
  ): void
  removeListener(
    event: 'message',
    listener: (
      event: unknown,
      method: string,
      params: Record<string, unknown>,
      sessionId?: string
    ) => void
  ): void
}

export interface BrowserContentsLike {
  id: number
  debugger: BrowserDebuggerLike
  focus(): void
  getTitle(): string
  getURL(): string
  isDestroyed(): boolean
}

export interface BrowserGuestRegistration {
  contents: BrowserContentsLike
  nodeId: string
  ownerNodeId?: string
}

interface BrowserUseParams {
  session_id?: unknown
  turn_id?: unknown
  tabId?: unknown
  target?: unknown
  method?: unknown
  commandParams?: unknown
  name?: unknown
}

export interface BrowserUseNotification {
  jsonrpc: '2.0'
  method: string
  params: unknown
}

export class NativeFrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const messages: unknown[] = []
    while (this.buffer.length >= 4) {
      const length = readNativeUInt32(this.buffer, 0)
      if (length > BROWSER_USE_MAX_FRAME_BYTES)
        throw new Error('browser-use frame exceeds limit')
      if (this.buffer.length < length + 4) break
      const frame = this.buffer.subarray(4, length + 4)
      this.buffer = this.buffer.subarray(length + 4)
      messages.push(JSON.parse(frame.toString('utf8')))
    }
    return messages
  }
}

export function encodeNativeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  if (payload.length > BROWSER_USE_MAX_FRAME_BYTES)
    throw new Error('browser-use frame exceeds limit')
  const frame = Buffer.allocUnsafe(payload.length + 4)
  writeNativeUInt32(frame, payload.length, 0)
  payload.copy(frame, 4)
  return frame
}

function readNativeUInt32(buffer: Buffer, offset: number): number {
  return os.endianness() === 'LE'
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset)
}

function writeNativeUInt32(
  buffer: Buffer,
  value: number,
  offset: number
): void {
  if (os.endianness() === 'LE') buffer.writeUInt32LE(value, offset)
  else buffer.writeUInt32BE(value, offset)
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Missing required ${label}`)
  return value
}

function requiredTabId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new Error('Invalid browser tabId')
  return value as number
}

/**
 * Session-scoped bridge from the bundled Codex Browser client to Electron webview guests.
 * A browser node is visible only to the agent node that created it. Session-to-node resolution
 * is injected from the same hook identity map used by linked context and canvas control.
 */
export class NodeTermBrowserUseRouter {
  private readonly guests = new Map<number, BrowserGuestRegistration>()
  private readonly debuggerListeners = new Map<
    number,
    Parameters<BrowserDebuggerLike['on']>[1]
  >()
  private readonly targetSessions = new Map<number, Map<string, string>>()

  constructor(
    private readonly nodeIdForSession: (
      sessionId: string
    ) => string | undefined,
    private readonly notify: (
      sessionId: string,
      notification: BrowserUseNotification
    ) => void
  ) {}

  register(registration: BrowserGuestRegistration): void {
    this.guests.set(registration.contents.id, registration)
  }

  unregister(webContentsId: number): void {
    const registration = this.guests.get(webContentsId)
    if (registration) this.detachDebugger(registration.contents)
    this.guests.delete(webContentsId)
    this.targetSessions.delete(webContentsId)
  }

  async dispatch(method: string, rawParams: unknown): Promise<unknown> {
    const params = object(rawParams) as BrowserUseParams
    if (method === 'ping') return 'pong'
    if (method === 'turnEnded') return null

    const sessionId = requiredString(params.session_id, 'browser session_id')
    switch (method) {
      case 'focusTab':
        this.requireTab(sessionId, requiredTabId(params.tabId)).contents.focus()
        return null
      case 'getInfo':
        this.requireNodeId(sessionId)
        return {
          apiSupportOverrides: {
            'BrowserUser.claimTab': true,
            'Tab.markDeliverable': true,
            'Tab.markHandoff': true,
            'Tabs.finalize': true
          },
          capabilities: { browser: [], tab: [] },
          metadata: { codexSessionId: sessionId },
          name: 'NodeTerm Browser',
          type: 'iab',
          version: '1.0.0'
        }
      case 'getTabs':
      case 'getUserTabs':
        return this.tabsForSession(sessionId)
      case 'claimUserTab':
        return this.serialize(
          this.requireTab(sessionId, requiredTabId(params.tabId)),
          true
        )
      case 'attach':
        this.attachDebugger(
          sessionId,
          this.requireTab(sessionId, requiredTabId(params.tabId)).contents
        )
        return null
      case 'detach':
        this.detachDebugger(
          this.requireTab(sessionId, requiredTabId(params.tabId)).contents
        )
        return null
      case 'attachTarget':
        return this.attachTarget(sessionId, params)
      case 'detachTarget':
        return this.detachTarget(sessionId, params)
      case 'executeCdp':
        return this.executeCdp(sessionId, params)
      case 'moveMouse':
      case 'allowDownload':
      case 'finalizeTabs':
      case 'markTab':
      case 'nameSession':
        this.requireNodeId(sessionId)
        return null
      case 'createTab':
        throw new Error(
          'Open a NodeTerm browser node with canvas-control open-browser first'
        )
      default:
        throw new Error(`No handler registered for method: ${method}`)
    }
  }

  private tabsForSession(sessionId: string): Array<Record<string, unknown>> {
    const nodeId = this.requireNodeId(sessionId)
    const tabs = [...this.guests.values()].filter(
      (guest) => guest.ownerNodeId === nodeId && !guest.contents.isDestroyed()
    )
    return tabs.map((guest, index) => this.serialize(guest, index === 0))
  }

  private serialize(
    guest: BrowserGuestRegistration,
    active: boolean
  ): Record<string, unknown> {
    return {
      active,
      id: guest.contents.id,
      title: guest.contents.getTitle(),
      url: guest.contents.getURL()
    }
  }

  private requireNodeId(sessionId: string): string {
    const nodeId = this.nodeIdForSession(sessionId)
    if (!nodeId)
      throw new Error('Browser session is not mapped to a NodeTerm agent node')
    return nodeId
  }

  private requireAnyTab(tabId: number): BrowserGuestRegistration {
    const guest = this.guests.get(tabId)
    if (!guest || guest.contents.isDestroyed())
      throw new Error(`Unknown browser tab: ${tabId}`)
    return guest
  }

  private requireTab(
    sessionId: string,
    tabId: number
  ): BrowserGuestRegistration {
    const nodeId = this.requireNodeId(sessionId)
    const guest = this.requireAnyTab(tabId)
    if (guest.ownerNodeId !== nodeId)
      throw new Error(`Unknown browser tab: ${tabId}`)
    return guest
  }

  private attachDebugger(
    sessionId: string,
    contents: BrowserContentsLike
  ): void {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    if (this.debuggerListeners.has(contents.id)) return
    const listener: Parameters<BrowserDebuggerLike['on']>[1] = (
      _event,
      method,
      params,
      cdpSessionId
    ) => {
      this.notify(sessionId, {
        jsonrpc: '2.0',
        method: 'onCDPEvent',
        params: {
          method,
          params,
          source: {
            tabId: contents.id,
            ...(cdpSessionId ? { sessionId: cdpSessionId } : {})
          }
        }
      })
    }
    contents.debugger.on('message', listener)
    this.debuggerListeners.set(contents.id, listener)
  }

  private detachDebugger(contents: BrowserContentsLike): void {
    const listener = this.debuggerListeners.get(contents.id)
    if (listener) contents.debugger.removeListener('message', listener)
    this.debuggerListeners.delete(contents.id)
    if (contents.debugger.isAttached()) contents.debugger.detach()
  }

  private async executeCdp(
    sessionId: string,
    params: BrowserUseParams
  ): Promise<unknown> {
    const target = object(params.target)
    const tabId = requiredTabId(target.tabId)
    const guest = this.requireTab(sessionId, tabId)
    const method = requiredString(params.method, 'CDP method')
    const commandParams = object(params.commandParams)
    this.attachDebugger(sessionId, guest.contents)
    let cdpSessionId =
      typeof target.sessionId === 'string' ? target.sessionId : undefined
    if (!cdpSessionId && typeof target.targetId === 'string') {
      cdpSessionId = this.targetSessions.get(tabId)?.get(target.targetId)
    }
    return guest.contents.debugger.sendCommand(
      method,
      commandParams,
      cdpSessionId
    )
  }

  private async attachTarget(
    sessionId: string,
    params: BrowserUseParams
  ): Promise<null> {
    const tabId = requiredTabId(params.tabId)
    const targetId = requiredString(
      (params as Record<string, unknown>).targetId,
      'targetId'
    )
    const guest = this.requireTab(sessionId, tabId)
    this.attachDebugger(sessionId, guest.contents)
    const response = object(
      await guest.contents.debugger.sendCommand('Target.attachToTarget', {
        flatten: true,
        targetId
      })
    )
    if (typeof response.sessionId === 'string') {
      const targets =
        this.targetSessions.get(tabId) ?? new Map<string, string>()
      targets.set(targetId, response.sessionId)
      this.targetSessions.set(tabId, targets)
    }
    return null
  }

  private async detachTarget(
    sessionId: string,
    params: BrowserUseParams
  ): Promise<null> {
    const tabId = requiredTabId(params.tabId)
    const targetId = requiredString(
      (params as Record<string, unknown>).targetId,
      'targetId'
    )
    const guest = this.requireTab(sessionId, tabId)
    const targets = this.targetSessions.get(tabId)
    const cdpSessionId = targets?.get(targetId)
    if (cdpSessionId) {
      await guest.contents.debugger.sendCommand('Target.detachFromTarget', {
        sessionId: cdpSessionId
      })
      targets?.delete(targetId)
    }
    return null
  }
}
