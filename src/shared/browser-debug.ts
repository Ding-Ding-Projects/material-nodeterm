/**
 * Shared contract for the isolated debugging browser node.
 *
 * The project file carries only intent: an http(s) start URL, a validated proxy endpoint,
 * and a user-facing label. The profile directory, child-process handle, debugging port, and
 * target websocket are machine-local runtime state and must never cross a project or peer
 * boundary. Keeping the pure validators here lets the desktop shell and a future Server Edition
 * adapter make the same safety decision without importing Electron.
 */

import { normalizeAddress } from './browserUrl'

export const DEBUG_BROWSER_SCHEMES = ['http', 'https', 'socks4', 'socks5'] as const
export type DebugBrowserProxyScheme = (typeof DEBUG_BROWSER_SCHEMES)[number]

export interface DebugBrowserProxy {
  scheme: DebugBrowserProxyScheme
  host: string
  port: number
}

/** Git-shared safe intent. No profile paths, process ids, local ports, cookies, or credentials. */
export interface DebugBrowserSpec {
  version: 1
  label: string
  startUrl: string
  proxy?: DebugBrowserProxy
}

/** Machine-local runtime binding. Never serialize this into a project file or peer mutation. */
export interface DebugBrowserBinding {
  profileDir: string
  endpoint: string
  /** Runtime-only process identity, intentionally absent from the portable/project shape. */
  processId?: number
}

export type DebugBrowserSessionState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

export interface DebugBrowserSessionSummary {
  sessionId: string
  state: DebugBrowserSessionState
  startUrl: string
  proxy?: DebugBrowserProxy
  endpoint?: string
  error?: string
}

export interface DebugBrowserExecutable {
  id: 'chrome' | 'edge' | 'chromium'
  label: string
  path: string
}

export type DebugBrowserSessionResult =
  | { ok: true; session: DebugBrowserSessionSummary }
  | { ok: false; error: string }

export type DebugBrowserInspectionResult =
  | { ok: true; session: DebugBrowserSessionSummary; target: DebugBrowserCdpTarget }
  | { ok: false; error: string }

const MAX_LABEL_LENGTH = 160
const MAX_URL_LENGTH = 2048
const MAX_HOST_LENGTH = 253

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isControlFree(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

function isSafeHost(host: string): boolean {
  const value = host.trim()
  if (!value || value.length > MAX_HOST_LENGTH || !isControlFree(value)) return false
  if (/[\\/@?#%]/.test(value)) return false
  if (value.startsWith('[') || value.endsWith(']')) {
    // IPv6 must be bracketed in the proxy-server URI. Keep validation conservative and avoid
    // accepting zone ids or malformed empty segments.
    if (!value.startsWith('[') || !value.endsWith(']') || value.length < 4) return false
    return /^[0-9a-f:]+$/i.test(value.slice(1, -1))
  }
  if (value.includes(':')) return false
  if (value === 'localhost') return true
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
  }
  // DNS names are deliberately ASCII here. Internationalized hosts can be entered after an
  // explicit IDNA conversion, but the launch URI itself must remain deterministic and bounded.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)) return false
  if (value.includes('..') || value.split('.').some((part) => part.length > 63)) return false
  return true
}

export function isDebugBrowserProxyScheme(value: unknown): value is DebugBrowserProxyScheme {
  return typeof value === 'string' && (DEBUG_BROWSER_SCHEMES as readonly string[]).includes(value)
}

export function normalizeDebugBrowserProxy(value: unknown): DebugBrowserProxy | undefined {
  if (!isRecord(value) || !isDebugBrowserProxyScheme(value.scheme) || typeof value.host !== 'string') {
    return undefined
  }
  const host = value.host.trim().toLowerCase()
  const port = value.port
  if (!isSafeHost(host) || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined
  }
  return { scheme: value.scheme, host, port }
}

/** Normalize a start URL without ever allowing a file, script, data, or custom scheme. */
export function normalizeDebugBrowserUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return undefined
  const normalized = normalizeAddress(value)
  if (!normalized || normalized.length > MAX_URL_LENGTH) return undefined
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Rebuild a spec from untrusted project data, dropping malformed optional data. */
export function normalizeDebugBrowserSpec(value: unknown): DebugBrowserSpec | undefined {
  if (!isRecord(value)) return undefined
  const startUrl = normalizeDebugBrowserUrl(value.startUrl)
  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (value.version !== 1 || !startUrl || !label || label.length > MAX_LABEL_LENGTH || !isControlFree(label)) {
    return undefined
  }
  const proxy = value.proxy === undefined ? undefined : normalizeDebugBrowserProxy(value.proxy)
  if (value.proxy !== undefined && !proxy) return undefined
  return { version: 1, label, startUrl, ...(proxy ? { proxy } : {}) }
}

/**
 * Construct the only arguments the debug browser may receive. Callers cannot append arbitrary
 * flags. A fresh profile is mandatory, and CDP is bound to loopback on every launch.
 */
export function buildDebugBrowserLaunchArgs(
  spec: DebugBrowserSpec,
  profileDir: string,
  port: number
): string[] {
  const normalized = normalizeDebugBrowserSpec(spec)
  if (!normalized) throw new Error('Invalid isolated debugging browser specification')
  if (!profileDir || typeof profileDir !== 'string' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid isolated debugging browser runtime binding')
  }
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-features=msEdgeFirstRunExperience,msEdgeSignin,msEdgeSync'
  ]
  if (normalized.proxy) {
    const host = normalized.proxy.host.startsWith('[')
      ? normalized.proxy.host
      : normalized.proxy.host
    args.push(`--proxy-server=${normalized.proxy.scheme}://${host}:${normalized.proxy.port}`)
  }
  args.push(normalized.startUrl)
  return args
}

function isLoopbackHost(value: string): boolean {
  const host = value.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

/** CDP endpoints are accepted only over loopback HTTP, with no userinfo or nonstandard host. */
export function isLoopbackCdpEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512 || !isControlFree(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && isLoopbackHost(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

/** Validate a machine-local binding before it is written to the local workspace index. */
export function normalizeDebugBrowserBinding(value: unknown): DebugBrowserBinding | undefined {
  if (!isRecord(value) || typeof value.profileDir !== 'string' || !isLoopbackCdpEndpoint(value.endpoint)) {
    return undefined
  }
  if (!value.profileDir || value.profileDir.length > 4096 || !isControlFree(value.profileDir)) return undefined
  const processId = value.processId
  return {
    profileDir: value.profileDir,
    endpoint: value.endpoint,
    ...(typeof processId === 'number' && Number.isInteger(processId) && processId > 0 ? { processId } : {})
  }
}

export interface DebugBrowserCdpTarget {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

/**
 * Require one and only one page target, matching the exact expected URL and a loopback websocket.
 * A convenient `.find()` is not sufficient because an unrelated target can still expose user
 * state from a contaminated profile.
 */
export function validateDebugBrowserTargetList(
  targets: unknown,
  expectedUrl: string
): DebugBrowserCdpTarget | undefined {
  if (!Array.isArray(targets) || targets.length !== 1 || typeof expectedUrl !== 'string') return undefined
  const raw = targets[0]
  if (!isRecord(raw) || raw.type !== 'page' || typeof raw.url !== 'string' || typeof raw.webSocketDebuggerUrl !== 'string') {
    return undefined
  }
  let actual: URL
  let expected: URL
  try {
    actual = new URL(raw.url)
    expected = new URL(expectedUrl)
  } catch {
    return undefined
  }
  if (actual.href !== expected.href) return undefined
  let websocket: URL
  try {
    websocket = new URL(raw.webSocketDebuggerUrl)
  } catch {
    return undefined
  }
  if ((websocket.protocol !== 'ws:' && websocket.protocol !== 'wss:') || !isLoopbackHost(websocket.hostname)) {
    return undefined
  }
  return { type: 'page', url: actual.href, webSocketDebuggerUrl: websocket.href }
}

export function debugBrowserProxyLabel(proxy: DebugBrowserProxy | undefined): string {
  return proxy ? `${proxy.scheme}://${proxy.host}:${proxy.port}` : 'Direct connection'
}
