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
  const found = spawnSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 })
  const shell = found.status === 0 ? found.stdout.split(/\r?\n/u).find((value) => path.isAbsolute(value.trim()))?.trim() : null
  if (!shell || !fs.existsSync(shell)) fail('PowerShell 7 pwsh.exe is unavailable for the reviewed process-local environment wrapper with ArgumentList support.')
  return { ...reviewedPowerShellWrapper(shell, candidate, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], environment, receipt), wrapper: true }
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
async function processIdentity(pid, candidate) {
  const source = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + ${pid})`,
    "if($null -eq $p){throw 'Recorded PID no longer exists'}",
    '[pscustomobject]@{pid=[int]$p.ProcessId;executable=[string]$p.ExecutablePath}|ConvertTo-Json -Compress'
  ].join(';')
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, cwd: options.repo, shell: false, timeout: 20 }, 30_000)
  const identity = JSON.parse(result.stdout)
  if (path.resolve(identity.executable).toLocaleLowerCase('en-US') !== path.resolve(candidate).toLocaleLowerCase('en-US')) fail(`PID ${pid} no longer belongs to the packaged candidate.`)
  return identity
}
async function processIdentityRecord(pid) {
  const source = ["$ErrorActionPreference='Stop'", `$p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + ${pid})`, "if($null -eq $p){throw 'Recorded PID no longer exists'}", '[pscustomobject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;creationTime=[string]$p.CreationDate;executable=[string]$p.ExecutablePath}|ConvertTo-Json -Compress'].join(';')
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`, cwd: options.repo, shell: false, timeout: 20 }, 30_000)
  const value = JSON.parse(result.stdout)
  if (!Number.isInteger(value?.pid) || !value.creationTime || !value.executable) fail('Process identity record is incomplete.')
  return value
}
async function candidateChild(launcherPid, candidate) {
  const request = Buffer.from(JSON.stringify({ launcherPid, candidate }), 'utf8').toString('base64')
  const source = [
    "$ErrorActionPreference='Stop'",
    `$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}'))|ConvertFrom-Json`,
    '$all=@(Get-CimInstance Win32_Process);$root=$all|Where-Object ProcessId -eq ([int]$r.launcherPid)|Select-Object -First 1;if($null -eq $root){throw "Launcher PID no longer exists"}',
    '$ids=New-Object System.Collections.Generic.HashSet[int];[void]$ids.Add([int]$root.ProcessId);do{$added=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)){[void]$ids.Add([int]$p.ProcessId);$added=$true}}}while($added)',
    '$want=[IO.Path]::GetFullPath([string]$r.candidate).ToLowerInvariant();$matches=@($all|Where-Object {$ids.Contains([int]$_.ProcessId) -and $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath).ToLowerInvariant() -eq $want});if($matches.Count -ne 1){throw "Expected exactly one packaged candidate descendant, found $($matches.Count)"};[pscustomobject]@{pid=[int]$matches[0].ProcessId;launcherPid=[int]$root.ProcessId}|ConvertTo-Json -Compress'
  ].join(';')
  const encoded = Buffer.from(source, 'utf16le').toString('base64')
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, cwd: options.repo, shell: false, timeout: 20 }, 30_000)
  const child = JSON.parse(result.stdout)
  if (!Number.isInteger(child.pid) || child.pid <= 0) fail('Candidate descendant proof returned an invalid PID.')
  await processIdentity(child.pid, candidate)
  return child
}
async function candidateFromWrapperReceipt(receipt, candidate, wrapperIdentity) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(receipt, 'utf8')
      if (Buffer.byteLength(raw, 'utf8') > 4096) fail('Wrapper child receipt exceeds 4 KiB.')
      const value = JSON.parse(raw)
      if (!Number.isInteger(value?.pid) || value.pid <= 0 || !Number.isInteger(value.parentPid) || !value.creationTime || typeof value.executable !== 'string' || Object.keys(value).some((key) => !['pid', 'parentPid', 'creationTime', 'executable'].includes(key))) fail('Wrapper child receipt is invalid.')
      if (value.parentPid !== wrapperIdentity.pid) fail('Wrapper child receipt does not bind to the exact launcher PID.')
      const live = await processIdentityRecord(value.pid)
      if (live.parentPid !== value.parentPid || live.creationTime !== value.creationTime || path.resolve(live.executable).toLocaleLowerCase('en-US') !== path.resolve(value.executable).toLocaleLowerCase('en-US')) fail('Wrapper child identity changed after receipt.')
      await processIdentity(value.pid, candidate)
      return { pid: value.pid }
    } catch (error) { if (error instanceof Error && !/ENOENT/u.test(error.message)) throw error; await sleep(Math.min(100, Math.max(0, deadline - Date.now()))) }
  }
  fail('PowerShell wrapper did not produce a valid packaged-candidate receipt.')
}
async function assertCdpPortUnused(port) {
  const source = `$items=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue);[pscustomobject]@{count=$items.Count}|ConvertTo-Json -Compress`
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`, cwd: options.repo, shell: false, timeout: 10 }, 15_000)
  if (JSON.parse(result.stdout).count !== 0) fail(`CDP port ${port} is already listening.`)
}
async function assertCdpListenerOwner(port, pid) {
  const source = `$items=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop);[pscustomobject]@{owners=@($items|ForEach-Object {[int]$_.OwningProcess})}|ConvertTo-Json -Compress`
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`, cwd: options.repo, shell: false, timeout: 10 }, 15_000)
  const owners = JSON.parse(result.stdout).owners ?? []
  if (!Array.isArray(owners) || owners.length !== 1 || owners[0] !== pid) fail(`CDP port ${port} is not owned exclusively by packaged PID ${pid}.`)
}
async function ownedProcessTree(root) {
  const request = Buffer.from(JSON.stringify(root), 'utf8').toString('base64')
  const source = ["$ErrorActionPreference='Stop'", `$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}'))|ConvertFrom-Json`, '$all=@(Get-CimInstance Win32_Process);$root=$all|Where-Object ProcessId -eq ([int]$r.pid)|Select-Object -First 1;if($null -eq $root){@()|ConvertTo-Json -Compress;exit 0};if([string]$root.CreationDate -ne [string]$r.creationTime -or [string]$root.ExecutablePath -ne [string]$r.executable){throw "Wrapper identity changed"}', '$ids=New-Object System.Collections.Generic.HashSet[int];[void]$ids.Add([int]$root.ProcessId);do{$added=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)){[void]$ids.Add([int]$p.ProcessId);$added=$true}}}while($added)', '@($all|Where-Object {$ids.Contains([int]$_.ProcessId)}|ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;creationTime=[string]$_.CreationDate;executable=[string]$_.ExecutablePath}})|ConvertTo-Json -Compress'].join(';')
  const result = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`, cwd: options.repo, shell: false, timeout: 20 }, 30_000)
  const tree = JSON.parse(result.stdout)
  return Array.isArray(tree) ? tree : (tree ? [tree] : [])
}
async function cleanupUnknownWrapper(desktop, wrapper) {
  const tree = await ownedProcessTree(wrapper)
  if (!tree.length) fail('Wrapper disappeared before its owned process tree could be proven absent.')
  for (const expected of [...tree].sort((a, b) => b.parentPid - a.parentPid)) {
    const live = await processIdentityRecord(expected.pid)
    if (live.parentPid !== expected.parentPid || live.creationTime !== expected.creationTime || path.resolve(live.executable).toLocaleLowerCase('en-US') !== path.resolve(expected.executable).toLocaleLowerCase('en-US')) fail('Owned wrapper process identity changed during cleanup.')
    await invoke('kill_process', { pid: expected.pid, force: true }, 20_000)
  }
  const after = await ownedProcessTree(wrapper)
  if (after.length) fail('Owned wrapper process tree remains after cleanup.')
  const close = await invoke('close_headless_desktop', { name: desktop }, 10_000)
  const desktops = await invoke('list_headless_desktops', {}, 5_000)
  if (close.closed !== true || (desktops.desktops ?? []).some((entry) => String(entry?.name ?? entry) === desktop)) fail('Owned desktop was not closed after wrapper cleanup.')
  return { attempted: true, desktop, method: 'proved-wrapper-tree-kill', desktopRemoved: true }
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
  const before = selectWindow(await invoke('list_headless_windows', { name: desktop }, 5_000), pid)
  if (before.hwnd !== hwnd) fail('Cleanup refused stale HWND.')
  await processIdentity(pid, candidate)
  await invoke('window_action', { handle: hwnd, action: 'close' }, 10_000)
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const inventory = await invoke('list_headless_windows', { name: desktop }, 5_000)
      try { selectWindow(inventory, pid) } catch (error) {
        if (hasWindowForPid(inventory, pid)) throw error
        const identity = await invoke('run_command', { command: `powershell.exe -NoProfile -NonInteractive -Command "if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){exit 9}"`, cwd: options.repo, shell: false, timeout: 10 }, 15_000)
        if (identity.returncode !== 0) fail(`PID ${pid} exit probe did not complete.`)
        const close = await invoke('close_headless_desktop', { name: desktop }, 10_000)
        const desktops = await invoke('list_headless_desktops', {}, 5_000)
        const stillPresent = (desktops.desktops ?? []).some((entry) => String(entry.name ?? entry) === desktop)
        if (stillPresent || close.closed !== true) fail(`Owned desktop ${desktop} was not closed.`)
        return { attempted: true, desktop, pid, hwnd, method: 'window_action.close', mainProcessExited: true, desktopRemoved: true }
      }
      await sleep(Math.min(250, Math.max(0, deadline - Date.now())))
    } catch (error) { throw error }
  }
  fail(`Owned PID ${pid} did not exit after its exact HWND close.`)
}
async function cleanupLaunchWithoutWindow(desktop, pid, candidate) {
  await processIdentity(pid, candidate)
  await invoke('kill_process', { pid, force: true }, 20_000)
  const close = await invoke('close_headless_desktop', { name: desktop }, 10_000)
  const desktops = await invoke('list_headless_desktops', {}, 5_000)
  if ((desktops.desktops ?? []).some((entry) => String(entry.name ?? entry) === desktop) || close.closed !== true) fail(`Owned desktop ${desktop} was not closed after launch-without-window cleanup.`)
  return { attempted: true, desktop, pid, method: 'revalidated-pid-kill-after-window-timeout', mainProcessExited: true, desktopRemoved: true }
}

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
let desktopCreated = false
try {
  options.mcp = new PersistentCheapMcpClient(mcpEndpoint)
  await options.mcp.initialize()
  options.mcp.requireTools(['create_headless_desktop', 'launch_on_headless_desktop', 'list_headless_windows', 'resize_window', 'window_action', 'run_command', 'kill_process', 'close_headless_desktop', 'list_headless_desktops'])
  const launchEnvironment = options.mcp.launchEnvironmentArgument(options.isolatedEnvironment)
  if (fs.existsSync(receiptFile)) fail('Refusing to overwrite an existing receipt.')
  fs.mkdirSync(runRoot, { recursive: true })
  const profile = path.join(runRoot, 'chromium-profile')
  for (const value of [...Object.values(isolated).filter((value) => value !== isolated.NODETERM_HOOK_SOCK), profile]) fs.mkdirSync(value, { recursive: true })
  fs.mkdirSync(path.dirname(isolated.NODETERM_HOOK_SOCK), { recursive: true })
  await requireDesktopAbsent(options.mcp, desktop)
  await assertCdpPortUnused(port)
  creationAttempted = true
  await invoke('create_headless_desktop', { name: desktop }, 10_000)
  desktopCreated = true
  const wrapperReceipt = path.join(runRoot, 'wrapper-child.json')
  requestedLaunch = launchEnvironment
    ? { command: `${quote(candidate)} --remote-debugging-port=${port} --user-data-dir=${quote(profile)}`, wrapper: false, environment: launchEnvironment }
    : shellWrappedLaunch(candidate, port, profile, options.isolatedEnvironment, wrapperReceipt)
  launch = await invoke('launch_on_headless_desktop', { name: desktop, command: requestedLaunch.command, ...(requestedLaunch.environment ?? {}) }, 60_000)
  if (!Number.isInteger(Number(launch.pid)) || Number(launch.pid) <= 0 || launch.focus_stealing !== false || launch.terminal_window !== false || launch.desktop !== desktop) fail('Launch receipt did not prove an owned non-foreground non-terminal launch.')
  wrapperIdentity = requestedLaunch.wrapper ? await processIdentityRecord(Number(launch.pid)) : null
  candidateProcess = requestedLaunch.wrapper ? { ...(await candidateFromWrapperReceipt(wrapperReceipt, candidate, wrapperIdentity)), launcherPid: Number(launch.pid), launcherCreationTime: wrapperIdentity.creationTime } : { pid: Number(launch.pid), launcherPid: Number(launch.pid) }
  window = await windowFor(desktop, candidateProcess.pid)
  const before = await nativeGeometry(window.hwnd)
  // Resize by measured non-client deltas, then prove client dimensions twice: native and CDP.
  await invoke('resize_window', { handle: window.hwnd, width: width + before.outerWidth - before.clientWidth, height: height + before.outerHeight - before.clientHeight })
  const native = await nativeGeometry(window.hwnd)
  const target = await cdpTarget(port, expectedUrl)
  await assertCdpListenerOwner(port, candidateProcess.pid)
  const renderer = await cdpClientSize(target.webSocketDebuggerUrl)
  if (native.clientWidth !== width || native.clientHeight !== height || renderer.width !== width || renderer.height !== height) fail(`Client geometry mismatch: native ${native.clientWidth}x${native.clientHeight}, renderer ${renderer.width}x${renderer.height}, requested ${width}x${height}.`)
  const boundTarget = { ...target, pid: candidateProcess.pid, targetIsolationVerified: true }
  const launchReceipt = { ok: true, desktop, pid: candidateProcess.pid, launcherPid: Number(launch.pid), wrapper: requestedLaunch.wrapper, hwnd: window.hwnd, focusStealing: false, terminalWindow: false }
  const liveReceipt = { ok: true, live: true, ...plan, launch: launchReceipt, nativeClientGeometry: native, rendererClientGeometry: renderer, cdp: boundTarget, cleanup: { attempted: false } }
  atomicJson(receiptFile, liveReceipt)
  const captureArgs = JSON.parse(fs.readFileSync(captureArgsFile, 'utf8'))
  if (!Array.isArray(captureArgs) || captureArgs.some((entry) => typeof entry !== 'string')) fail('Capture arguments must be a JSON array of strings.')
  const capture = spawnSync(process.execPath, [captureScript, ...captureArgs], { cwd: repo, env: { ...process.env, ...options.isolatedEnvironment }, encoding: 'utf8', windowsHide: true, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 })
  if (capture.error || capture.status !== 0) fail(`Capture driver failed: ${capture.error?.message ?? capture.stderr ?? 'unknown failure'}`)
  cleanup = await closeOwned(desktop, candidateProcess.pid, window.hwnd, candidate)
  const receipt = { ok: true, live: false, ...plan, launch: launchReceipt, nativeClientGeometry: native, rendererClientGeometry: renderer, cdp: boundTarget, cleanup, capture: { stdout: capture.stdout.trim() }, completedAt: new Date().toISOString() }
  atomicJson(receiptFile, receipt)
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
} catch (error) {
  if (launch && window && candidateProcess && !cleanup) { try { cleanup = await closeOwned(desktop, candidateProcess.pid, window.hwnd, candidate) } catch { /* preserve the original refusal */ } }
  if (launch && !window && candidateProcess && !cleanup) { try { cleanup = await cleanupLaunchWithoutWindow(desktop, candidateProcess.pid, candidate) } catch { /* preserve the original refusal */ } }
  if (launch && !candidateProcess && !cleanup && requestedLaunch?.wrapper && wrapperIdentity) { try { cleanup = await cleanupUnknownWrapper(desktop, wrapperIdentity) } catch { /* preserve the original refusal */ } }
  if (launch && !candidateProcess && !cleanup) { try { cleanup = await cleanupUncertainCreatedDesktop(options.mcp, desktop) } catch { /* preserve the original refusal */ } }
  if (!launch && creationAttempted && !cleanup) {
    try {
      cleanup = await cleanupUncertainCreatedDesktop(options.mcp, desktop)
    } catch { /* preserve the original refusal */ }
  }
  const receipt = { ok: false, ...plan, launch: launch ? { pid: Number(launch.pid), desktop: launch.desktop } : null, cleanup: cleanup ?? null, error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() }
  try { atomicJson(receiptFile, receipt) } catch { /* run-root evidence is best effort after a refusal */ }
  process.stderr.write(`${receipt.error}\n`)
  process.exitCode = 1
}
