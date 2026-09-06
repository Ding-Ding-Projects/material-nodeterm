import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PersistentCheapMcpClient, cleanupUncertainCreatedDesktop, requireDesktopAbsent, reviewedPowerShellWrapper, validateMcpEndpoint } from './lib/cheap-mcp-transport.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runner = path.join(repo, 'scripts', 'run-headless-gallery.mjs')

describe('run-headless-gallery CLI boundaries', () => {
  it('rejects a relative candidate before it can create a run root or launch a process', () => {
    const result = spawnSync(process.execPath, [
      runner, '--candidate', 'relative.exe', '--run-root', 'C:\\Temp\\gallery-run', '--repo', repo,
      '--provenance', 'C:\\missing.json', '--cheap', 'C:\\missing.exe', '--desktop', 'gallery-test',
      '--port', '9939', '--width', '640', '--height', '540'
    ], { encoding: 'utf8', windowsHide: true })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--candidate must be absolute.')
  })

  it('keeps one MCP session for initialization, inventory, and tool calls while accepting SSE', async () => {
    const calls = []
    const server = http.createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        const payload = JSON.parse(raw)
        calls.push({ payload, session: request.headers['mcp-session-id'] })
        if (payload.method === 'notifications/initialized') {
          response.writeHead(202, { 'mcp-session-id': 'fixture-session' })
          response.end()
          return
        }
        const result = payload.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: {} }
          : payload.method === 'tools/list'
            ? { tools: [{
                name: 'launch_on_headless_desktop',
                inputSchema: {
                  type: 'object',
                  properties: { params: { $ref: '#/$defs/Launch' } },
                  $defs: { Launch: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, environment: { type: 'object' } } } }
                }
              }] }
            : { content: [{ type: 'text', text: JSON.stringify({ ok: true, pid: 71 }) }], isError: false }
        const body = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result })
        response.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'fixture-session' })
        response.end(`event: message\ndata: ${body}\n\n`)
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const client = new PersistentCheapMcpClient(`http://127.0.0.1:${server.address().port}/mcp`, { timeoutMs: 5_000 })
      await client.initialize()
      client.requireTools(['launch_on_headless_desktop'])
      expect(client.launchEnvironmentArgument({ APPDATA: 'C:\\isolated' })).toEqual({ environment: { APPDATA: 'C:\\isolated' } })
      await client.call('launch_on_headless_desktop', { name: 'fixture', command: 'fixture.exe', environment: { APPDATA: 'C:\\isolated' } })
      expect(calls.map((entry) => entry.payload.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
      expect(calls.slice(1).every((entry) => entry.session === 'fixture-session')).toBe(true)
      expect(calls.at(-1).payload.params.arguments).toEqual({ params: { name: 'fixture', command: 'fixture.exe', environment: { APPDATA: 'C:\\isolated' } } })
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('rejects unsafe endpoints and tool errors, while allowing a reviewed shell wrapper when launch lacks an environment field', async () => {
    expect(() => validateMcpEndpoint('http://example.invalid/mcp')).toThrow(/loopback-only/)
    const server = http.createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        const payload = JSON.parse(raw)
        if (payload.method === 'notifications/initialized') {
          response.writeHead(202, { 'mcp-session-id': 'fixture-session' })
          response.end()
          return
        }
        const result = payload.method === 'initialize' ? {} : payload.method === 'tools/list'
          ? { tools: [{ name: 'launch_on_headless_desktop', inputSchema: { type: 'object', properties: { params: { type: 'object', properties: { command: { type: 'string' } } } } } }, { name: 'refuse', inputSchema: { type: 'object', properties: {} } }, { name: 'is-error', inputSchema: { type: 'object', properties: {} } }] }
          : { content: [{ type: 'text', text: JSON.stringify(payload.params?.name === 'is-error' ? { ok: true } : { ok: false, error: 'fixture refusal' }) }], isError: payload.params?.name === 'is-error' }
        const body = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result })
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' })
        response.end(body)
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const client = new PersistentCheapMcpClient(`http://127.0.0.1:${server.address().port}/mcp`)
      await client.initialize()
      expect(client.launchEnvironmentArgument({ APPDATA: 'C:\\isolated' })).toBeNull()
      await expect(client.call('refuse', {})).rejects.toThrow(/fixture refusal/)
      await expect(client.call('is-error', {})).rejects.toThrow(/marked the tool result as an error/)
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('cleans a newly created desktop when the create response is malformed', async () => {
    let desktopExists = false
    const calls = []
    const server = http.createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        const payload = JSON.parse(raw)
        calls.push({ method: payload.method, tool: payload.params?.name, session: request.headers['mcp-session-id'] })
        if (payload.method === 'notifications/initialized') { response.writeHead(202, { 'mcp-session-id': 'fixture-session' }); response.end(); return }
        if (payload.method === 'tools/call' && payload.params.name === 'create_headless_desktop') {
          desktopExists = true
          response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' })
          response.end('{')
          return
        }
        let result
        if (payload.method === 'initialize') result = {}
        else if (payload.method === 'tools/list') result = { tools: ['create_headless_desktop', 'list_headless_desktops', 'close_headless_desktop'].map((name) => ({ name, inputSchema: { type: 'object', properties: { params: { type: 'object' } } } })) }
        else if (payload.params.name === 'list_headless_desktops') result = { content: [{ type: 'text', text: JSON.stringify({ ok: true, desktops: desktopExists ? [{ name: 'fresh-gallery' }] : [] }) }], isError: false }
        else { desktopExists = false; result = { content: [{ type: 'text', text: JSON.stringify({ ok: true, closed: true }) }], isError: false } }
        const body = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result })
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' })
        response.end(body)
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const client = new PersistentCheapMcpClient(`http://127.0.0.1:${server.address().port}/mcp`)
      await client.initialize()
      await requireDesktopAbsent(client, 'fresh-gallery')
      await expect(client.call('create_headless_desktop', { name: 'fresh-gallery' }, { timeoutMs: 1_000 })).rejects.toThrow(/invalid JSON/)
      await expect(cleanupUncertainCreatedDesktop(client, 'fresh-gallery')).resolves.toMatchObject({ attempted: true, desktopRemoved: true, method: 'post-create-probe-close' })
      expect(calls.filter((entry) => entry.tool === 'list_headless_desktops').every((entry) => entry.session === 'fixture-session')).toBe(true)
      expect(desktopExists).toBe(false)
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('aborts a hung tool request at its explicit override while preserving the MCP session', async () => {
    let toolSession = null
    const server = http.createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        const payload = JSON.parse(raw)
        if (payload.method === 'notifications/initialized') { response.writeHead(202, { 'mcp-session-id': 'fixture-session' }); response.end(); return }
        if (payload.method === 'tools/call') { toolSession = request.headers['mcp-session-id']; setTimeout(() => { if (!response.writableEnded) response.end() }, 1_000); return }
        const result = payload.method === 'initialize' ? {} : { tools: [{ name: 'hang', inputSchema: { type: 'object', properties: {} } }] }
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }))
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const client = new PersistentCheapMcpClient(`http://127.0.0.1:${server.address().port}/mcp`, { timeoutMs: 5_000 })
      await client.initialize()
      const started = Date.now()
      await expect(client.call('hang', {}, { timeoutMs: 150 })).rejects.toThrow(/transport failed/)
      expect(Date.now() - started).toBeLessThan(750)
      expect(toolSession).toBe('fixture-session')
      expect(client.sessionId).toBe('fixture-session')
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('runs a harmless process-local PowerShell wrapper with exact isolated environment and argv', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-wrapper-'))
    const result = path.join(root, 'result.txt')
    const receipt = path.join(root, 'child.json')
    const childScriptFile = path.join(root, 'child.ps1')
    const found = spawnSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true })
    const powershell = found.stdout.split(/\r?\n/u).find((value) => path.isAbsolute(value.trim()))?.trim()
    expect(powershell).toBeTruthy()
    fs.writeFileSync(childScriptFile, '[IO.File]::WriteAllText($env:RESULT,($env:APPDATA+"|"+$env:NODE_OPTIONS+"|"+($args -join ",")))', 'utf8')
    try {
      const wrapper = reviewedPowerShellWrapper(powershell, powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', childScriptFile, 'first value', "O'Hara", '雪', ''], { APPDATA: 'C:\\isolated-appdata', NODE_OPTIONS: '', NODE_PATH: '', RESULT: result }, receipt)
      const launched = spawnSync(wrapper.executable, wrapper.arguments, { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
      expect(launched.status).toBe(0)
      await expect.poll(() => fs.existsSync(receipt), { timeout: 5_000 }).toBe(true)
      await expect.poll(() => fs.existsSync(result), { timeout: 5_000 }).toBe(true)
      expect(JSON.parse(fs.readFileSync(receipt, 'utf8'))).toMatchObject({ pid: expect.any(Number), parentPid: expect.any(Number), creationTime: expect.any(String), executable: powershell })
      expect(fs.readFileSync(result, 'utf8')).toBe("C:\\isolated-appdata||first value,O'Hara,雪,")
      expect(() => reviewedPowerShellWrapper(powershell, powershell, [], { APPDATA: 'C:\\bad\u0000value' }, receipt)).toThrow(/environment/)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
