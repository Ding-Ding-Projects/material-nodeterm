import { identityPowerShell } from './gallery-process-lifecycle.mjs'
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const PROTOCOL_VERSION = '2025-03-26'

function fail(message) { throw new Error(message) }
function quoteWindows(value) {
  const text = String(value)
  if (!/[\s"]/u.test(text)) return text
  return `"${text.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`
}
export function reviewedPowerShellWrapper(shell, candidate, arguments_, environment, receipt) {
  if (!pathIsAbsolute(shell) || !pathIsAbsolute(candidate) || !pathIsAbsolute(receipt)) fail('PowerShell wrapper paths must be absolute.')
  if (!Array.isArray(arguments_) || arguments_.some((value) => typeof value !== 'string' || /[\x00-\x1f]/u.test(value))) fail('PowerShell wrapper arguments are invalid.')
  for (const [key, value] of Object.entries(environment)) if (!/^[A-Z_][A-Z0-9_]*$/u.test(key) || typeof value !== 'string' || /[\x00-\x1f]/u.test(value)) fail('PowerShell wrapper environment is invalid.')
  const request = Buffer.from(JSON.stringify({ candidate, arguments: arguments_, environment, receipt }), 'utf8').toString('base64')
  const source = [
    "$ErrorActionPreference='Stop'",
    `$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}'))|ConvertFrom-Json`,
    identityPowerShell,
    'function Save-Proof { $tmp=([string]$r.receipt)+"."+$PID+".tmp";[IO.File]::WriteAllText($tmp,($proof|ConvertTo-Json -Depth 4 -Compress),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $tmp -Destination ([string]$r.receipt) -Force }',
    '$proof=@{version=1;wrapper=(Identity (Get-CimInstance Win32_Process -Filter ("ProcessId = "+$PID) -ErrorAction Stop));child=$null;phase="starting"};Save-Proof',
    'try {',
    'foreach($p in $r.environment.psobject.Properties){Set-Item -LiteralPath ("Env:"+$p.Name) -Value ([string]$p.Value)}',
    '$psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=[string]$r.candidate;$psi.UseShellExecute=$false;foreach($p in $r.environment.psobject.Properties){$psi.Environment[$p.Name]=[string]$p.Value};foreach($a in @($r.arguments)){$null=$psi.ArgumentList.Add([string]$a)};$child=[Diagnostics.Process]::Start($psi)',
    '$proof.child=Identity (Get-CimInstance Win32_Process -Filter ("ProcessId = "+[int]$child.Id) -ErrorAction Stop);if($null -eq $proof.child){throw "Child disappeared before identity could be recorded"};$proof.phase="running";Save-Proof;$child.WaitForExit();$proof.phase="child-exited";Save-Proof',
    '} catch { $proof.phase="failed";Save-Proof }',
    '$deadline=[DateTime]::UtcNow.AddMinutes(20);while(-not [IO.File]::Exists(([string]$r.receipt)+".release") -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}'
  ].join(';')
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
  return { command: `${quoteWindows(shell)} ${args.join(' ')}`, executable: shell, arguments: args }
}
function pathIsAbsolute(value) { return typeof value === 'string' && /^(?:[A-Za-z]:\\|\\\\)/u.test(value) }
function boundedTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3_600_000) fail('MCP timeout must be an integer between 100 and 3600000 ms.')
  return timeoutMs
}

export function validateMcpEndpoint(value) {
  let url
  try { url = new URL(value) } catch { fail('MCP endpoint must be an HTTP(S) URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) fail('MCP endpoint must be an HTTP(S) URL.')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) fail('Cheap Lowlevel MCP endpoint must be loopback-only.')
  if (url.username || url.password || url.hash) fail('MCP endpoint must not contain credentials or a fragment.')
  return url.href
}

function parseResponses(text, contentType) {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) fail('MCP response exceeds 16 MiB.')
  if (!contentType.includes('text/event-stream')) {
    const payload = JSON.parse(text)
    return Array.isArray(payload) ? payload : [payload]
  }
  const responses = []
  let parts = []
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith('data:')) parts.push(line.slice(5).trimStart())
    else if (!line.trim() && parts.length) { responses.push(JSON.parse(parts.join('\n'))); parts = [] }
  }
  if (parts.length) responses.push(JSON.parse(parts.join('\n')))
  return responses
}

async function readBounded(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('MCP response exceeds 16 MiB.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

function schemaProperties(schema) {
  const params = schema?.properties?.params
  if (params && typeof params === 'object') {
    if (params.$ref && typeof params.$ref === 'string') {
      const name = params.$ref.replace(/^#\/\$defs\//u, '')
      const definition = schema?.$defs?.[name]
      if (definition?.properties && typeof definition.properties === 'object') return definition.properties
    }
    if (params.properties && typeof params.properties === 'object') return params.properties
  }
  return schema?.properties && typeof schema.properties === 'object' ? schema.properties : {}
}

export class PersistentCheapMcpClient {
  constructor(endpoint, { timeoutMs = 60_000 } = {}) {
    this.endpoint = validateMcpEndpoint(endpoint)
    this.timeoutMs = boundedTimeout(timeoutMs)
    this.sessionId = null
    this.nextId = 1
    this.tools = null
  }

  async post(payload, { allowEmpty = false, timeoutMs = this.timeoutMs } = {}) {
    timeoutMs = boundedTimeout(timeoutMs)
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL_VERSION }
    if (this.sessionId) headers['MCP-Session-Id'] = this.sessionId
    let response
    try {
      response = await fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) { fail(`MCP transport failed: ${error instanceof Error ? error.message : String(error)}`) }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (!Number.isFinite(declared) || declared > MAX_RESPONSE_BYTES) fail('MCP response exceeds 16 MiB.')
    let text
    try { text = await readBounded(response) } catch (error) { fail(`MCP returned an invalid or oversized response: ${error instanceof Error ? error.message : String(error)}`) }
    if (!response.ok) fail(`MCP returned HTTP ${response.status}: ${text.slice(0, 500)}`)
    const nextSession = response.headers.get('MCP-Session-Id')
    if (nextSession) this.sessionId = nextSession
    if (allowEmpty && !text.trim()) return []
    try { return parseResponses(text, response.headers.get('content-type') ?? '') } catch (error) { fail(`MCP returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`) }
  }

  async rpc(method, params, { timeoutMs } = {}) {
    const id = this.nextId++
    const responses = await this.post({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }, { timeoutMs })
    const response = responses.find((entry) => entry?.id === id)
    if (!response) fail(`MCP did not return response id ${id}.`)
    if (response.error) fail(`MCP ${method} failed: ${JSON.stringify(response.error)}`)
    if (!Object.hasOwn(response, 'result')) fail(`MCP ${method} response has no result.`)
    return response.result
  }

  async notify(method, params, { timeoutMs } = {}) { await this.post({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }, { allowEmpty: true, timeoutMs }) }

  async initialize() {
    await this.rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'headless-gallery', version: '1' } })
    await this.notify('notifications/initialized')
    const result = await this.rpc('tools/list', {})
    if (!Array.isArray(result?.tools)) fail('tools/list returned an invalid tool inventory.')
    this.tools = result.tools
  }

  definition(name) { return this.tools?.find((tool) => tool?.name === name) ?? null }
  requireTools(names) { for (const name of names) if (!this.definition(name)) fail(`MCP server does not expose tool: ${name}`) }
  launchEnvironmentArgument(environment) {
    const schema = this.definition('launch_on_headless_desktop')?.inputSchema
    const properties = schemaProperties(schema)
    for (const key of ['environment', 'env']) if (properties[key]) return { [key]: environment }
    return null
  }

  async call(tool, params, { timeoutMs } = {}) {
    const definition = this.definition(tool)
    if (!definition) fail(`MCP server does not expose tool: ${tool}`)
    const properties = schemaProperties(definition.inputSchema)
    const toolArguments = definition.inputSchema?.properties?.params ? { params } : params
    const result = await this.rpc('tools/call', { name: tool, arguments: toolArguments }, { timeoutMs })
    if (result?.isError) fail(`${tool} refused: MCP marked the tool result as an error.`)
    const text = (result?.content ?? []).filter((item) => item?.type === 'text' && typeof item.text === 'string').map((item) => item.text)
    if (text.length !== 1) fail(`${tool} returned an ambiguous non-JSON result.`)
    let output
    try { output = JSON.parse(text[0]) } catch { fail(`${tool} emitted invalid JSON.`) }
    if (!output || typeof output !== 'object' || output.ok !== true) fail(`${tool} refused: ${output?.error ?? 'unknown failure'}`)
    if (tool === 'run_command' && output.returncode !== 0) fail(`run_command child exited ${output.returncode}: ${output.stderr ?? ''}`)
    return output
  }
}

function desktopPresent(payload, desktop) {
  return (payload.desktops ?? []).some((entry) => String(entry?.name ?? entry) === desktop)
}

export async function requireDesktopAbsent(client, desktop) {
  const inventory = await client.call('list_headless_desktops', {}, { timeoutMs: 5_000 })
  if (desktopPresent(inventory, desktop)) fail(`Refusing an existing headless desktop name: ${desktop}.`)
}

export async function cleanupUncertainCreatedDesktop(client, desktop) {
  const outcome = { attempted: true, desktop, uncertainCreate: true, desktopRemoved: false }
  try {
    const before = await client.call('list_headless_desktops', {}, { timeoutMs: 5_000 })
    if (!desktopPresent(before, desktop)) return { ...outcome, desktopRemoved: true, method: 'post-create-probe-absent' }
    const closed = await client.call('close_headless_desktop', { name: desktop }, { timeoutMs: 10_000 })
    const after = await client.call('list_headless_desktops', {}, { timeoutMs: 5_000 })
    if (closed.closed === true && !desktopPresent(after, desktop)) return { ...outcome, desktopRemoved: true, method: 'post-create-probe-close' }
    return { ...outcome, uncertainty: 'desktop remained after close confirmation' }
  } catch (error) {
    return { ...outcome, uncertainty: error instanceof Error ? error.message : String(error) }
  }
}
