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
  fs.renameSync(temp, file)
}
function invoke(tool, payload, timeout = 45) {
  const result = spawnSync(options.cheap, [tool, '--json', JSON.stringify(payload)], { encoding: 'utf8', windowsHide: true, timeout: timeout * 1000, maxBuffer: 4 * 1024 * 1024, env: options.launchEnvironment })
  if (result.error) fail(`${tool} could not start: ${result.error.message}`)
  if (result.status !== 0) fail(`${tool} exited ${result.status}: ${result.stderr}`)
  let output
  try { output = JSON.parse(result.stdout) } catch { fail(`${tool} emitted invalid JSON.`) }
  if (output.ok !== true) fail(`${tool} refused: ${output.error ?? 'unknown failure'}`)
  if (tool === 'run_command' && output.returncode !== 0) fail(`run_command child exited ${output.returncode}: ${output.stderr ?? ''}`)
  return output
}
function selectWindow(payload, pid) {
  const matches = (payload.windows ?? []).filter((window) => Number(window.process_id) === pid && /^Chrome_WidgetWin_/u.test(String(window.class ?? '')) && Number(window.width) > 0 && Number(window.height) > 0 && String(window.title ?? '').trim())
  if (matches.length !== 1) fail(`Expected one titled Chromium window for PID ${pid}, found ${matches.length}.`)
  const window = matches[0]
  return { hwnd: Number(window.handle), className: String(window.class), title: String(window.title), outerWidth: Number(window.width), outerHeight: Number(window.height) }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
async function windowFor(desktop, pid) {
  let last
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return selectWindow(invoke('list_headless_windows', { name: desktop }, 5), pid) } catch (error) { last = error; await sleep(250) }
  }
  throw last ?? new Error('Window did not appear.')
}
function nativeGeometry(hwnd) {
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
  const result = invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, cwd: options.repo, shell: false, timeout: 20 }, 30)
  return JSON.parse(result.stdout)
}
function processIdentity(pid, candidate) {
  const source = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + ${pid})`,
    "if($null -eq $p){throw 'Recorded PID no longer exists'}",
    '[pscustomobject]@{pid=[int]$p.ProcessId;executable=[string]$p.ExecutablePath}|ConvertTo-Json -Compress'
  ].join(';')
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const result = invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, cwd: options.repo, shell: false, timeout: 20 }, 30)
  const identity = JSON.parse(result.stdout)
  if (path.resolve(identity.executable).toLocaleLowerCase('en-US') !== path.resolve(candidate).toLocaleLowerCase('en-US')) fail(`PID ${pid} no longer belongs to the packaged candidate.`)
  return identity
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
async function closeOwned(desktop, pid, hwnd, candidate) {
  const before = selectWindow(invoke('list_headless_windows', { name: desktop }, 5), pid)
  if (before.hwnd !== hwnd) fail('Cleanup refused stale HWND.')
  processIdentity(pid, candidate)
  invoke('window_action', { handle: hwnd, action: 'close' })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      selectWindow(invoke('list_headless_windows', { name: desktop }, 5), pid)
      await sleep(250)
    } catch {
      const identity = invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -Command "if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){exit 9}"`, cwd: options.repo, shell: false, timeout: 10 }, 15)
      if (identity.returncode !== 0) fail(`PID ${pid} exit probe did not complete.`)
      const close = invoke('close_headless_desktop', { name: desktop }, 10)
      const desktops = invoke('list_headless_desktops', {}, 10)
      const stillPresent = (desktops.desktops ?? []).some((entry) => String(entry.name ?? entry) === desktop)
      if (stillPresent || close.closed !== true) fail(`Owned desktop ${desktop} was not closed.`)
      return { attempted: true, desktop, pid, hwnd, method: 'window_action.close', mainProcessExited: true, desktopRemoved: true }
    }
  }
  fail(`Owned PID ${pid} did not exit after its exact HWND close.`)
}
function cleanupLaunchWithoutWindow(desktop, pid, candidate) {
  processIdentity(pid, candidate)
  invoke('kill_process', { pid, force: true }, 20)
  const close = invoke('close_headless_desktop', { name: desktop }, 10)
  const desktops = invoke('list_headless_desktops', {}, 10)
  if ((desktops.desktops ?? []).some((entry) => String(entry.name ?? entry) === desktop) || close.closed !== true) fail(`Owned desktop ${desktop} was not closed after launch-without-window cleanup.`)
  return { attempted: true, desktop, pid, method: 'revalidated-pid-kill-after-window-timeout', mainProcessExited: true, desktopRemoved: true }
}

const execute = process.argv.includes('--execute')
const candidate = absolute('--candidate')
const runRoot = absolute('--run-root')
const repo = absolute('--repo')
const provenance = absolute('--provenance')
const cheapExecutable = absolute('--cheap')
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
  launchEnvironment: { ...process.env, ...isolated, NODE_ENV: 'production', NODE_OPTIONS: '', NODE_PATH: '', ELECTRON_USER_DATA_DIR: isolated.NT_USER_DATA }
}
const build = validateCandidateProvenance({ repoRoot: repo, provenance, candidate })
const asar = build.artifacts['packaged-app-asar']
if (!asar || !asar.sha256) fail('Provenance does not bind the packaged app.asar.')

const plan = { schemaVersion: 1, route: 'cheap-lowlevel-headless', method: 'cheap Lowlevel MCP headless packaged-gallery launch', source: { gitHead: build.commit, workingTreeDigest: build.workingTreeDigest, provenanceSha256: build.provenanceSha256 }, candidate: { executable: candidate, sha256: sha256(candidate), appAsarSha256: asar.sha256 }, requestedClientGeometry: { width, height }, desktop, port, expectedUrl, receipt: receiptFile }
if (!execute) { process.stdout.write(`${JSON.stringify({ ok: true, execute: false, plan }, null, 2)}\n`); process.exit(0) }

let launch
let window
let cleanup
let desktopCreated = false
try {
  if (fs.existsSync(receiptFile)) fail('Refusing to overwrite an existing receipt.')
  fs.mkdirSync(runRoot, { recursive: true })
  const profile = path.join(runRoot, 'chromium-profile')
  for (const value of [...Object.values(isolated), profile]) fs.mkdirSync(value, { recursive: true })
  invoke('create_headless_desktop', { name: desktop })
  desktopCreated = true
  launch = invoke('launch_on_headless_desktop', { name: desktop, command: `${quote(candidate)} --remote-debugging-port=${port} --user-data-dir=${quote(profile)}` }, 60)
  if (!Number.isInteger(Number(launch.pid)) || Number(launch.pid) <= 0 || launch.focus_stealing !== false || launch.terminal_window !== false || launch.desktop !== desktop) fail('Launch receipt did not prove an owned non-foreground non-terminal launch.')
  window = await windowFor(desktop, Number(launch.pid))
  const before = nativeGeometry(window.hwnd)
  // Resize by measured non-client deltas, then prove client dimensions twice: native and CDP.
  invoke('resize_window', { handle: window.hwnd, width: width + before.outerWidth - before.clientWidth, height: height + before.outerHeight - before.clientHeight })
  const native = nativeGeometry(window.hwnd)
  const target = await cdpTarget(port, expectedUrl)
  const renderer = await cdpClientSize(target.webSocketDebuggerUrl)
  if (native.clientWidth !== width || native.clientHeight !== height || renderer.width !== width || renderer.height !== height) fail(`Client geometry mismatch: native ${native.clientWidth}x${native.clientHeight}, renderer ${renderer.width}x${renderer.height}, requested ${width}x${height}.`)
  const boundTarget = { ...target, pid: Number(launch.pid), targetIsolationVerified: true }
  const liveReceipt = { ok: true, live: true, ...plan, launch: { ok: true, desktop, pid: Number(launch.pid), hwnd: window.hwnd, focusStealing: false, terminalWindow: false }, nativeClientGeometry: native, rendererClientGeometry: renderer, cdp: boundTarget, cleanup: { attempted: false } }
  atomicJson(receiptFile, liveReceipt)
  const captureArgs = JSON.parse(fs.readFileSync(captureArgsFile, 'utf8'))
  if (!Array.isArray(captureArgs) || captureArgs.some((entry) => typeof entry !== 'string')) fail('Capture arguments must be a JSON array of strings.')
  const capture = spawnSync(process.execPath, [captureScript, ...captureArgs], { cwd: repo, env: options.launchEnvironment, encoding: 'utf8', windowsHide: true, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 })
  if (capture.error || capture.status !== 0) fail(`Capture driver failed: ${capture.error?.message ?? capture.stderr ?? 'unknown failure'}`)
  cleanup = await closeOwned(desktop, Number(launch.pid), window.hwnd, candidate)
  const receipt = { ok: true, live: false, ...plan, launch: { ok: true, desktop, pid: Number(launch.pid), hwnd: window.hwnd, focusStealing: false, terminalWindow: false }, nativeClientGeometry: native, rendererClientGeometry: renderer, cdp: boundTarget, cleanup, capture: { stdout: capture.stdout.trim() }, completedAt: new Date().toISOString() }
  atomicJson(receiptFile, receipt)
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
} catch (error) {
  if (launch && window && !cleanup) { try { cleanup = await closeOwned(desktop, Number(launch.pid), window.hwnd, candidate) } catch { /* preserve the original refusal */ } }
  if (launch && !window && !cleanup) { try { cleanup = cleanupLaunchWithoutWindow(desktop, Number(launch.pid), candidate) } catch { /* preserve the original refusal */ } }
  if (!launch && desktopCreated && !cleanup) {
    try {
      const close = invoke('close_headless_desktop', { name: desktop }, 10)
      const desktops = invoke('list_headless_desktops', {}, 10)
      if (close.closed === true && !(desktops.desktops ?? []).some((entry) => String(entry.name ?? entry) === desktop)) cleanup = { attempted: true, desktop, desktopRemoved: true }
    } catch { /* preserve the original refusal */ }
  }
  const receipt = { ok: false, ...plan, launch: launch ? { pid: Number(launch.pid), desktop: launch.desktop } : null, cleanup: cleanup ?? null, error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() }
  try { atomicJson(receiptFile, receipt) } catch { /* run-root evidence is best effort after a refusal */ }
  process.stderr.write(`${receipt.error}\n`)
  process.exitCode = 1
}
