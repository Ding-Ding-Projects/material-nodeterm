#!/usr/bin/env node
/**
 * Launch one packaged desktop candidate on an owned hidden desktop and write a
 * receipt that another capture driver can consume.  It deliberately captures
 * nothing and promotes nothing: this is the provenance and isolation seam.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { OwnedProcessLedger, processInventoryScript, processProbeScript, listenerProbeScript, sameIdentity, validIdentity } from './lib/gallery-process-lifecycle.mjs'
import { renameAtomicSync } from './lib/rename-atomic.mjs'
import { PersistentCheapMcpClient, cleanupUncertainCreatedDesktop, requireDesktopAbsent, reviewedPowerShellWrapper, validateMcpEndpoint } from './lib/cheap-mcp-transport.mjs'

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { validateCandidateProvenance } = require('./windows-profile-packaged-acceptance-core.cjs')

function fail(message) { throw new Error(message) }
function arg(name, fallback) { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) fail(`Missing ${name}.`); return value }
function integer(name, min = 1) { const value = Number(required(name)); if (!Number.isInteger(value) || value < min) fail(`${name} must be an integer >= ${min}.`); return value }
function absolute(name) { const raw = required(name); if (!path.isAbsolute(raw)) fail(`${name} must be absolute.`); return path.resolve(raw) }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function quote(value) {
  const text = String(value)
  if (!/[\s"]/u.test(text)) return text
  return `"${text.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`
}
function atomicJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameAtomicSync(temp, file)
}
async function invoke(tool, payload, timeoutMs = 45_000) { return options.mcp.call(tool, payload, { timeoutMs }) }
function selectWindow(payload, pid) {
  const matches = (payload.windows ?? []).filter((window) => Number(window.process_id) === pid && /^Chrome_WidgetWin_/u.test(String(window.class ?? '')) && Number(window.width) > 0 && Number(window.height) > 0 && String(window.title ?? '').trim())
  if (matches.length !== 1) fail(`Expected one titled Chromium window for PID ${pid}, found ${matches.length}.`)
  const window = matches[0]
  return { hwnd: Number(window.handle), className: String(window.class), title: String(window.title), outerWidth: Number(window.width), outerHeight: Number(window.height) }
}
function shellWrappedLaunch(candidate, port, profile, environment, receipt) {
  const shell = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
  if (!fs.existsSync(shell)) fail('Trusted Program Files PowerShell 7 executable is unavailable.')
  return { ...reviewedPowerShellWrapper(shell, candidate, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], environment, receipt), wrapper: true, sha256: sha256(shell) }
}
function hasWindowForPid(payload, pid) { return (payload.windows ?? []).some((window) => Number(window.process_id) === pid) }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
async function windowFor(desktop, pid) {
  let last
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { return selectWindow(await invoke('list_headless_windows', { name: desktop }, 5_000), pid) } catch (error) { last = error; await sleep(Math.min(250, Math.max(0, deadline - Date.now()))) }
  }
  throw last ?? new Error('Window did not appear.')
}
async function nativeGeometry(hwnd) {
  const source = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -Namespace GalleryNative -Name Win32 -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT lpRect); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect); public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }\'',
    `$h=[IntPtr]${hwnd}`,
    '$c=New-Object GalleryNative.Win32+RECT; $w=New-Object GalleryNative.Win32+RECT',
    'if(-not [GalleryNative.Win32]::GetClientRect($h,[ref]$c)){throw "GetClientRect failed"}',
    'if(-not [GalleryNative.Win32]::GetWindowRect($h,[ref]$w)){throw "GetWindowRect failed"}',
    '[pscustomobject]@{clientWidth=$c.Right-$c.Left;clientHeight=$c.Bottom-$c.Top;outerWidth=$w.Right-$w.Left;outerHeight=$w.Bottom-$w.Top}|ConvertTo-Json -Compress'
  ].join(';')
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, cwd: options.repo, shell: false, timeout: 20 }, 30_000)
  return JSON.parse(result.stdout)
}
async function powershellJson(source) {
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = await invoke('run_command', { command: `${quote(shell)} -NoProfile -NonInteractive -EncodedCommand ${encoded}`, cwd: options.repo, shell: false, timeout: 20 }, 30_000)
  return JSON.parse(result.stdout)
}
async function processIdentityRecord(pid) { return (await powershellJson(processProbeScript(pid))).process }
async function inventoryProcesses() { return (await powershellJson(processInventoryScript)).processes }
async function revalidateCandidate() {
  if (!candidateProcess || !sameIdentity(candidateProcess, await processIdentityRecord(candidateProcess.pid))) fail('Candidate process identity changed; retained.')
}
async function wrapperReceiptRecord(receipt, requireChild = true) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(receipt)
      if (!stat.isFile() || stat.size > 4096) fail('Wrapper receipt exceeds 4 KiB or is not a regular file.')
      const value = JSON.parse(fs.readFileSync(receipt, 'utf8'))
      if (value.version !== 1 || !validIdentity(value.wrapper)) fail('Wrapper identity receipt is invalid.')
      if (path.resolve(value.wrapper.executable).toLowerCase() !== path.resolve(requestedLaunch.executable).toLowerCase()) fail('Wrapper executable identity mismatch.')
      if (!sameIdentity(value.wrapper, await processIdentityRecord(value.wrapper.pid))) fail('Wrapper identity changed; retained.')
      wrapperIdentity = value.wrapper
      if (!ledger) ledger = new OwnedProcessLedger(wrapperIdentity, (state) => atomicJson(path.join(runRoot, 'owned-processes.json'), state))
      ledger.observe(await inventoryProcesses())
      if (value.child !== null) {
        if (!validIdentity(value.child) || value.child.parentPid !== wrapperIdentity.pid || path.resolve(value.child.executable).toLowerCase() !== candidate.toLowerCase()) fail('Candidate receipt identity is invalid.')
        if (!ledger.records.some((record) => sameIdentity(record, value.child))) fail('Candidate identity is not in the exact wrapper tree.')
        candidateProcess = value.child
      }
      if (!requireChild || candidateProcess) return value
      if (value.phase === 'failed' || value.phase === 'child-exited') fail('Wrapper child failed or exited before launch proof.')
    } catch (error) { if (!/ENOENT/u.test(error.message)) throw error }
    await sleep(100)
  }
  fail('PowerShell wrapper did not produce a complete launch receipt; ownership remains unknown.')
}
async function assertCdpPortUnused(port) {
  const result = await powershellJson(listenerProbeScript(port))
  if (!Array.isArray(result.owners) || result.owners.length !== 0) fail(`CDP port ${port} is already listening or its probe is invalid.`)
}
async function assertCdpListenerOwner(port, pid) {
  await revalidateCandidate()
  const { owners } = await powershellJson(listenerProbeScript(port))
  if (!Array.isArray(owners) || owners.length !== 1 || owners[0] !== pid) fail(`CDP port ${port} is not owned exclusively by packaged PID ${pid}.`)
  await revalidateCandidate()
}
async function cleanupOwnedLaunch() {
  if (!ledger) await wrapperReceiptRecord(wrapperReceipt, false)
  ledger.observe(await inventoryProcesses())
  if (window && candidateProcess) {
    await revalidateCandidate()
    const before = selectWindow(await invoke('list_headless_windows', { name: desktop }, 5_000), candidateProcess.pid)
    if (before.hwnd !== window.hwnd) fail('Cleanup refused stale HWND.')
    await revalidateCandidate()
    await invoke('window_action', { handle: window.hwnd, action: 'close' }, 10_000)
    await sleep(500)
  }
  const result = await ledger.terminate({ inventory: inventoryProcesses, probe: processIdentityRecord, kill: (pid) => invoke('kill_process', { pid, force: true }, 20_000) })
  const remainingWindows = await invoke('list_headless_windows', { name: desktop }, 5_000)
  if (!Array.isArray(remainingWindows.windows) || remainingWindows.windows.length) fail('Windows remain on owned desktop; retained.')
  const close = await invoke('close_headless_desktop', { name: desktop }, 10_000)
  const desktops = await invoke('list_headless_desktops', {}, 5_000)
  if (close.closed !== true || !Array.isArray(desktops.desktops) || desktops.desktops.some((entry) => String(entry?.name ?? entry) === desktop)) fail('Owned desktop removal was not proven.')
  return { attempted: true, desktop, ...result, desktopRemoved: true, method: 'recorded-identity-child-first' }
}
async function cdpTarget(port, expectedUrl) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) })
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 128 * 1024) throw new Error('CDP list response refused.')
      const body = await response.text()
      if (Buffer.byteLength(body, 'utf8') > 128 * 1024) throw new Error('CDP list response exceeded bound.')
      const targets = JSON.parse(body)
      // The complete target list must be exactly one page, never merely contain one useful page.
      if (Array.isArray(targets) && targets.length === 1 && targets[0]?.type === 'page' && targets[0]?.url === expectedUrl) {
        const socket = new URL(String(targets[0].webSocketDebuggerUrl ?? ''))
        if (socket.protocol === 'ws:' && socket.hostname === '127.0.0.1' && Number(socket.port) === port) return { count: 1, id: String(targets[0].id), url: expectedUrl, webSocketDebuggerUrl: socket.href }
      }
    } catch { /* bounded retry while Electron starts */ }
    await sleep(250)
  }
  fail('CDP isolation failed: the complete target array was not exactly one expected loopback page.')
}
async function cdpClientSize(socketUrl) {
  const socket = new WebSocket(socketUrl)
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP geometry query timed out.')), 10_000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'JSON.stringify({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})', returnByValue: true } })))
    socket.addEventListener('message', (event) => { try { const data = JSON.parse(event.data); if (data.id === 1) { clearTimeout(timer); resolve(JSON.parse(data.result.result.value)) } } catch (error) { clearTimeout(timer); reject(error) } })
    socket.addEventListener('error', (error) => { clearTimeout(timer); reject(error) })
  })
  socket.close()
  return result
}
function gitHead() { return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: options.repo, encoding: 'utf8', windowsHide: true }).stdout.trim() }

const execute = process.argv.includes('--execute')
const candidate = absolute('--candidate')
const runRoot = absolute('--run-root')
const repo = absolute('--repo')
const provenance = absolute('--provenance')
const cheapExecutable = absolute('--cheap')
const mcpEndpoint = validateMcpEndpoint(arg('--mcp-endpoint') ?? 'http://127.0.0.1:8765/mcp')
const expectedUrl = arg('--expected-url') ?? pathToFileURL(path.join(path.dirname(candidate), 'resources', 'app.asar', 'out', 'renderer', 'index.html')).href
const desktop = required('--desktop')
const port = integer('--port', 1024)
const width = integer('--width')
const height = integer('--height')
const receiptFile = path.join(runRoot, 'headless-gallery-launch-receipt.json')
const captureScript = arg('--capture-script') ? absolute('--capture-script') : null
const captureArgsFile = arg('--capture-args-json') ? absolute('--capture-args-json') : null
if (!fs.statSync(candidate).isFile()) fail(`Candidate is not a file: ${candidate}`)
if (!fs.statSync(cheapExecutable).isFile()) fail(`Cheap executable is not a file: ${cheapExecutable}`)
if (!fs.statSync(provenance).isFile()) fail(`Build provenance is not a file: ${provenance}`)
if (path.resolve(runRoot).startsWith(repo + path.sep)) fail('--run-root must be an absolute directory outside the repository.')
if (execute && (!captureScript || !captureArgsFile)) fail('--execute requires --capture-script and --capture-args-json.')
if (captureScript && !fs.statSync(captureScript).isFile()) fail('Capture script is not a file.')
if (captureArgsFile && !fs.statSync(captureArgsFile).isFile()) fail('Capture argument JSON is not a file.')
const isolated = Object.fromEntries([
  ['APPDATA', path.join(runRoot, 'appdata')], ['LOCALAPPDATA', path.join(runRoot, 'localappdata')],
  ['USERPROFILE', path.join(runRoot, 'userprofile')], ['HOME', path.join(runRoot, 'home')],
  ['TEMP', path.join(runRoot, 'temp')], ['TMP', path.join(runRoot, 'temp')],
  ['NT_USER_DATA', path.join(runRoot, 'nt-user-data')], ['NODETERM_HOOK_SOCK', path.join(runRoot, 'hooks', 'nodeterm.sock')]
])
const options = {
  repo, cheap: cheapExecutable,
  isolatedEnvironment: { ...isolated, NODE_ENV: 'production', NODE_OPTIONS: '', NODE_PATH: '', ELECTRON_USER_DATA_DIR: isolated.NT_USER_DATA },
  mcp: null
}
const build = validateCandidateProvenance({ repoRoot: repo, provenance, candidate })
const asar = build.artifacts['packaged-app-asar']
if (!asar || !asar.sha256) fail('Provenance does not bind the packaged app.asar.')

const plan = { schemaVersion: 1, route: 'cheap-lowlevel-headless', method: 'persistent cheap Lowlevel MCP headless packaged-gallery launch', source: { gitHead: build.commit, workingTreeDigest: build.workingTreeDigest, provenanceSha256: build.provenanceSha256 }, candidate: { executable: candidate, sha256: sha256(candidate), appAsarSha256: asar.sha256 }, requestedClientGeometry: { width, height }, desktop, port, expectedUrl, mcpEndpoint, receipt: receiptFile }
if (!execute) { process.stdout.write(`${JSON.stringify({ ok: true, execute: false, plan }, null, 2)}\n`); process.exit(0) }

let launch
let window
let cleanup
let candidateProcess
let requestedLaunch
let wrapperIdentity
let creationAttempted = false
let launchAttempted = false
let ledger
const wrapperReceipt = path.join(runRoot, 'wrapper-child.json')
try {
  options.mcp = new PersistentCheapMcpClient(mcpEndpoint)
  await options.mcp.initialize()
  options.mcp.requireTools(['create_headless_desktop', 'launch_on_headless_desktop', 'list_headless_windows', 'resize_window', 'window_action', 'run_command', 'kill_process', 'close_headless_desktop', 'list_headless_desktops'])
  if (fs.existsSync(receiptFile)) fail('Refusing to overwrite an existing receipt.')
  fs.mkdirSync(runRoot, { recursive: true })
  const profile = path.join(runRoot, 'chromium-profile')
  for (const value of [...Object.values(isolated).filter((value) => value !== isolated.NODETERM_HOOK_SOCK), profile]) fs.mkdirSync(value, { recursive: true })
  fs.mkdirSync(path.dirname(isolated.NODETERM_HOOK_SOCK), { recursive: true })
  await requireDesktopAbsent(options.mcp, desktop)
  await assertCdpPortUnused(port)
  creationAttempted = true
  await invoke('create_headless_desktop', { name: desktop }, 10_000)
  requestedLaunch = shellWrappedLaunch(candidate, port, profile, options.isolatedEnvironment, wrapperReceipt)
  plan.wrapper = { executable: requestedLaunch.executable, sha256: requestedLaunch.sha256, receipt: wrapperReceipt }
  if (fs.existsSync(wrapperReceipt)) fail('Refusing an existing wrapper receipt.')
  atomicJson(path.join(runRoot, 'launch-intent.json'), plan)
  launchAttempted = true
  launch = await invoke('launch_on_headless_desktop', { name: desktop, command: requestedLaunch.command }, 60_000)
  await wrapperReceiptRecord(wrapperReceipt)
  if (Number(launch.pid) !== wrapperIdentity.pid || launch.focus_stealing !== false || launch.terminal_window !== false || launch.desktop !== desktop) fail('Launch receipt did not prove an owned non-foreground non-terminal launch.')
  await revalidateCandidate()
  window = await windowFor(desktop, candidateProcess.pid)
  const before = await nativeGeometry(window.hwnd)
  // Resize by measured non-client deltas, then prove client dimensions twice: native and CDP.
  await revalidateCandidate()
  await invoke('resize_window', { handle: window.hwnd, width: width + before.outerWidth - before.clientWidth, height: height + before.outerHeight - before.clientHeight })
  const native = await nativeGeometry(window.hwnd)
  const target = await cdpTarget(port, expectedUrl)
  await assertCdpListenerOwner(port, candidateProcess.pid)
  const renderer = await cdpClientSize(target.webSocketDebuggerUrl)
  if (native.clientWidth !== width || native.clientHeight !== height || renderer.width !== width || renderer.height !== height) fail(`Client geometry mismatch: native ${native.clientWidth}x${native.clientHeight}, renderer ${renderer.width}x${renderer.height}, requested ${width}x${height}.`)
  const boundTarget = { ...target, pid: candidateProcess.pid, targetIsolationVerified: true }
  const launchReceipt = { ok: true, desktop, pid: candidateProcess.pid, launcherPid: Number(launch.pid), wrapper: requestedLaunch.wrapper, process: candidateProcess, wrapperProcess: wrapperIdentity, hwnd: window.hwnd, focusStealing: false, terminalWindow: false }
  const liveReceipt = { ok: true, live: true, ...plan, launch: launchReceipt, nativeClientGeometry: native, rendererClientGeometry: renderer, cdp: boundTarget, cleanup: { attempted: false } }
  atomicJson(receiptFile, liveReceipt)
  const captureArgs = JSON.parse(fs.readFileSync(captureArgsFile, 'utf8'))
  if (!Array.isArray(captureArgs) || captureArgs.some((entry) => typeof entry !== 'string')) fail('Capture arguments must be a JSON array of strings.')
  await assertCdpListenerOwner(port, candidateProcess.pid)
  const currentTarget = await cdpTarget(port, expectedUrl)
  if (currentTarget.id !== target.id || currentTarget.webSocketDebuggerUrl !== target.webSocketDebuggerUrl) fail('CDP target changed before capture.')
  ledger.observe(await inventoryProcesses())
  await revalidateCandidate()
  const capture = spawnSync(process.execPath, [captureScript, ...captureArgs], { cwd: repo, env: { ...process.env, ...options.isolatedEnvironment }, encoding: 'utf8', windowsHide: true, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 })
  if (capture.error || capture.status !== 0) fail(`Capture driver failed: ${capture.error?.message ?? capture.stderr ?? 'unknown failure'}`)
  cleanup = await cleanupOwnedLaunch()
  const receipt = { ok: true, live: false, ...plan, launch: launchReceipt, nativeClientGeometry: native, rendererClientGeometry: renderer, cdp: boundTarget, cleanup, capture: { stdout: capture.stdout.trim() }, completedAt: new Date().toISOString() }
  atomicJson(receiptFile, receipt)
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
} catch (error) {
  if (launchAttempted && !cleanup) {
    try { cleanup = await cleanupOwnedLaunch() }
    catch (cleanupError) { cleanup = { attempted: true, desktopRemoved: false, processesExited: false, retained: true, error: cleanupError.message, ledger: ledger ? { root: ledger.root, processes: ledger.records } : null } }
  }
  if (!launchAttempted && creationAttempted && !cleanup) cleanup = await cleanupUncertainCreatedDesktop(options.mcp, desktop)
  const receipt = { ok: false, ...plan, launch: launch ? { pid: Number(launch.pid), desktop: launch.desktop } : null, cleanup: cleanup ?? null, error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() }
  try { atomicJson(receiptFile, receipt) } catch { /* run-root evidence is best effort after a refusal */ }
  process.stderr.write(`${receipt.error}\n`)
  process.exitCode = 1
}
