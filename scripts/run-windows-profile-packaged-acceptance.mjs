#!/usr/bin/env node

/**
 * Cheap-headless packaged Windows profile/session-host acceptance orchestrator.
 *
 * Default mode is a read-only plan: no subprocess, directory, port, window, or clipboard is
 * touched. `--execute` is the only path that invokes the Cheap Lowlevel CLI. Even then, this
 * runner never launches an app directly and never falls back to the visible desktop or a kill.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'

const require = createRequire(import.meta.url)
const {
  REQUIRED_EVIDENCE_IDS,
  createAcceptancePlan,
  parseJsonDocument,
  quoteWindowsArg,
  requireInside,
  runWithCleanupThenPromote,
  selectHeadlessWindow,
  validateCandidateProvenance,
  validateCheapInvocation,
  validateContinuity,
  validateEvidenceRecords,
  validateLaunchResult,
  validateProcessIdentity,
  validateProfileResults
} = require('./windows-profile-packaged-acceptance-core.cjs')

const parsed = parseArgs({
  strict: true,
  allowPositionals: false,
  options: {
    execute: { type: 'boolean', default: false },
    repo: { type: 'string' },
    head: { type: 'string' },
    provenance: { type: 'string' },
    cheap: { type: 'string' },
    'lowlevel-root': { type: 'string' },
    'task-root': { type: 'string' },
    'run-id': { type: 'string' },
    desktop: { type: 'string' },
    'first-port': { type: 'string' },
    'second-port': { type: 'string' },
    appdata: { type: 'string' },
    localappdata: { type: 'string' },
    'chromium-profile': { type: 'string' },
    temp: { type: 'string' },
    project: { type: 'string' },
    state: { type: 'string' },
    evidence: { type: 'string' },
    candidate: { type: 'string' },
    'session-host': { type: 'string' },
    setup: { type: 'string' },
    releases: { type: 'string' },
    nupkg: { type: 'string' },
    'app-asar': { type: 'string' },
    'packaged-node-pty': { type: 'string' },
    'out-main': { type: 'string' },
    'out-preload': { type: 'string' },
    'out-renderer': { type: 'string' },
    'out-session-host': { type: 'string' },
    'custom-dialect': { type: 'string' }
  }
})

function required(name) {
  const value = parsed.values[name]
  if (typeof value !== 'string' || value.trim() === '' || /[\0\r\n]/u.test(value)) {
    throw new Error(`--${name} is required and may not contain NUL/newlines.`)
  }
  return value
}

function absolute(name) {
  const value = required(name)
  if (!path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path.`)
  return path.resolve(value)
}

function optionalAbsolute(name, fallback) {
  const value = parsed.values[name]
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
    throw new Error(`--${name} must be an absolute path.`)
  }
  return path.resolve(candidate)
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    fs.renameSync(temporary, file)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Retain the primary error.
    }
    throw error
  }
}

function buildOptions() {
  const repoRoot = absolute('repo')
  const taskRoot = absolute('task-root')
  const runId = required('run-id')
  if (!/^[A-Za-z0-9._-]{8,64}$/u.test(runId)) {
    throw new Error('--run-id must be 8-64 letters, digits, dot, underscore, or hyphen.')
  }
  const candidate = optionalAbsolute('candidate', path.join(repoRoot, 'dist', 'win-unpacked', 'nodeterm.exe'))
  const sessionHost = optionalAbsolute(
    'session-host',
    path.join(repoRoot, 'dist', 'win-unpacked', 'resources', 'session-host', 'host.cjs')
  )
  return {
    execute: parsed.values.execute,
    repoRoot,
    expectedCommit: required('head'),
    provenance: absolute('provenance'),
    cheap: absolute('cheap'),
    lowlevelRoot: absolute('lowlevel-root'),
    taskRoot,
    runId,
    desktop: parsed.values.desktop ?? `nt-winprofiles-${runId}`,
    firstPort: required('first-port'),
    secondPort: required('second-port'),
    appData: optionalAbsolute('appdata', path.join(taskRoot, 'appdata')),
    localAppData: optionalAbsolute('localappdata', path.join(taskRoot, 'localappdata')),
    chromiumProfile: optionalAbsolute('chromium-profile', path.join(taskRoot, 'chromium-profile')),
    tempDirectory: optionalAbsolute('temp', path.join(taskRoot, 'temp')),
    projectDirectory: optionalAbsolute('project', path.join(taskRoot, 'project')),
    stateFile: optionalAbsolute('state', path.join(taskRoot, 'driver-state.json')),
    evidenceDirectory: optionalAbsolute('evidence', path.join(taskRoot, 'evidence')),
    candidate,
    sessionHost,
    setup: optionalAbsolute(
      'setup',
      path.join(repoRoot, 'dist', 'squirrel-windows', `nodeterm-Setup-${JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version}.exe`)
    ),
    releases: optionalAbsolute('releases', path.join(repoRoot, 'dist', 'squirrel-windows', 'RELEASES')),
    nupkg: parsed.values.nupkg === undefined ? undefined : absolute('nupkg'),
    appAsar: optionalAbsolute('app-asar', path.join(repoRoot, 'dist', 'win-unpacked', 'resources', 'app.asar')),
    packagedNodePty: optionalAbsolute(
      'packaged-node-pty',
      path.join(
        repoRoot,
        'dist',
        'win-unpacked',
        'resources',
        'session-host',
        'node_modules',
        'node-pty',
        'build',
        'Release',
        'conpty.node'
      )
    ),
    outMain: optionalAbsolute('out-main', path.join(repoRoot, 'out', 'main', 'index.js')),
    outPreload: optionalAbsolute('out-preload', path.join(repoRoot, 'out', 'preload', 'index.js')),
    outRenderer: optionalAbsolute('out-renderer', path.join(repoRoot, 'out', 'renderer', 'index.html')),
    outSessionHost: optionalAbsolute('out-session-host', path.join(repoRoot, 'out', 'session-host', 'host.cjs')),
    customDialect: parsed.values['custom-dialect']
  }
}

function publicPlan(plan, options) {
  return {
    schemaVersion: plan.schemaVersion,
    mode: options.execute ? 'execute' : 'plan-only',
    runId: options.runId,
    desktop: plan.desktop,
    ports: plan.ports,
    source: {
      gitHead: plan.provenance.commit,
      workingTreeDigest: plan.provenance.workingTreeDigest,
      fileCount: plan.provenance.sourceFileCount
    },
    candidate: plan.provenance.artifacts['packaged-executable'],
    buildArtifacts: Object.values(plan.provenance.artifacts),
    isolation: {
      appData: path.relative(plan.isolation.taskRoot, plan.isolation.appData).replace(/\\/gu, '/'),
      localAppData: path.relative(plan.isolation.taskRoot, plan.isolation.localAppData).replace(/\\/gu, '/'),
      chromiumProfile: path.relative(plan.isolation.taskRoot, plan.isolation.chromiumProfile).replace(/\\/gu, '/'),
      tempDirectory: path.relative(plan.isolation.taskRoot, plan.isolation.tempDirectory).replace(/\\/gu, '/'),
      projectDirectory: path.relative(plan.isolation.taskRoot, plan.isolation.projectDirectory).replace(/\\/gu, '/'),
      stateFile: path.relative(plan.isolation.taskRoot, plan.isolation.stateFile).replace(/\\/gu, '/'),
      evidenceDirectory: path.relative(plan.isolation.taskRoot, plan.evidenceDirectory).replace(/\\/gu, '/')
    },
    requiredEvidenceIds: plan.requiredEvidenceIds,
    copyPaste: {
      status: 'blocked',
      reason: 'Clipboard is not inspected or mutated in plan mode; execution remains fail-closed.'
    },
    installer: {
      status: 'blocked',
      reason: 'This route validates win-unpacked only; installer proof waits for correct PE identity and early Squirrel lifecycle handling.'
    }
  }
}

function assertCheapExecutable(file, lowlevelRoot) {
  const realRoot = fs.realpathSync(lowlevelRoot)
  if (path.basename(realRoot).toLowerCase() !== 'lowlevel-computer-use-mcp') {
    throw new Error('Cheap Lowlevel root must be the lowlevel-computer-use-mcp checkout.')
  }
  const expected = fs.realpathSync(
    path.join(realRoot, '.venv', 'Scripts', 'lowlevel-computer-use-cheap.exe')
  )
  const actual = fs.realpathSync(file)
  if (actual.toLocaleLowerCase('en-US') !== expected.toLocaleLowerCase('en-US')) {
    throw new Error('Only the checkout-owned .venv Cheap Lowlevel executable may cross the process boundary.')
  }
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => reject(new Error(`CDP port ${port} is not free: ${error.message}`)))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve))
  })
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function execute(plan, options) {
  if (process.platform !== 'win32') throw new Error('Packaged Windows acceptance can execute only on win32.')
  assertCheapExecutable(plan.cheap, options.lowlevelRoot)
  for (const target of [
    plan.isolation.appData,
    plan.isolation.localAppData,
    plan.isolation.chromiumProfile,
    plan.isolation.tempDirectory,
    plan.isolation.projectDirectory,
    plan.isolation.stateFile,
    plan.evidenceDirectory
  ]) {
    requireInside(plan.isolation.taskRoot, target, 'Task-owned execution target')
    if (fs.existsSync(target)) throw new Error(`Task-owned execution target must not pre-exist: ${target}`)
  }

  const driver = path.join(options.repoRoot, 'scripts', 'windows-profile-packaged-driver.mjs')
  if (!fs.statSync(driver).isFile()) throw new Error(`Packaged acceptance driver is missing: ${driver}`)
  const processEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      !/^(?:APPDATA|LOCALAPPDATA|TEMP|TMP|SQUIRREL_TEMP|NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|ELECTRON_.+|NODETERM_.+|NT_.+|VITE_.+)$/iu.test(name)
    )
  )
  Object.assign(processEnvironment, {
    APPDATA: plan.isolation.appData,
    LOCALAPPDATA: plan.isolation.localAppData,
    TEMP: plan.isolation.tempDirectory,
    TMP: plan.isolation.tempDirectory,
    NODE_ENV: 'production',
    NODETERM_WINDOWS_PROFILE_ACCEPTANCE_DRIVER: options.runId
  })

  const runCheap = (tool, payload, timeoutSeconds = 60) => {
    const result = spawnSync(plan.cheap, [tool, '--json', JSON.stringify(payload)], {
      cwd: options.repoRoot,
      env: processEnvironment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: (timeoutSeconds + 15) * 1000,
      maxBuffer: 64 * 1024 * 1024
    })
    return validateCheapInvocation(result, tool)
  }

  const processAlive = (pid) => {
    const script =
      "let alive=true;try{process.kill(Number(process.argv[1]),0)}catch{alive=false}" +
      "process.stdout.write(JSON.stringify({alive}))"
    const command = [process.execPath, '-e', script, String(pid)].map(quoteWindowsArg).join(' ')
    const payload = runCheap('run_command', { command, cwd: options.repoRoot, timeout: 15, shell: false }, 20)
    return parseJsonDocument(payload.stdout, `PID ${pid} liveness probe`).alive === true
  }

  const processIdentity = (pid) => {
    const script = [
      "$ErrorActionPreference='Stop'",
      `$wanted=${pid}`,
      "$p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $wanted)",
      "if($null -eq $p){[pscustomobject]@{exists=$false;pid=$wanted}|ConvertTo-Json -Compress;exit 0}",
      "[pscustomobject]@{exists=$true;pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;executable=[string]$p.ExecutablePath}|ConvertTo-Json -Compress"
    ].join(';')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const command = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`
    const payload = runCheap('run_command', { command, cwd: options.repoRoot, timeout: 20, shell: false }, 25)
    return validateProcessIdentity(
      parseJsonDocument(payload.stdout, `PID ${pid} executable identity`),
      pid,
      plan.candidate
    )
  }

  const postExactWmClose = (identity) => {
    const script = [
      "$ErrorActionPreference='Stop'",
      "Add-Type -Namespace NtAcceptance -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern bool PostMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);'",
      `$ok=[NtAcceptance.Native]::PostMessage([IntPtr]${identity.hwnd},0x0010,[IntPtr]::Zero,[IntPtr]::Zero)`,
      '[pscustomobject]@{posted=$ok}|ConvertTo-Json -Compress'
    ].join(';')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const command = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`
    const payload = runCheap('run_command', { command, cwd: options.repoRoot, timeout: 20, shell: false }, 25)
    const result = parseJsonDocument(payload.stdout, `HWND ${identity.hwnd} WM_CLOSE fallback`)
    if (result.posted !== true) throw new Error(`WM_CLOSE could not be posted to exact HWND ${identity.hwnd}.`)
  }

  const waitForExit = async (pid, label, timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!processAlive(pid)) return
      await sleep(150)
    }
    throw new Error(`${label} PID ${pid} did not exit gracefully.`)
  }

  const pollWindow = async (expectedPid, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs
    let last
    while (Date.now() < deadline) {
      const payload = runCheap('list_headless_windows', { name: plan.desktop }, 20)
      try {
        return selectHeadlessWindow(payload, expectedPid)
      } catch (error) {
        last = error
      }
      await sleep(150)
    }
    throw new Error(`No unique PID-matched packaged HWND appeared: ${last?.message ?? 'timeout'}`)
  }

  const launch = async (port, command) => {
    await assertPortFree(port)
    const started = validateLaunchResult(
      runCheap('launch_on_headless_desktop', { name: plan.desktop, command }, 30)
    )
    if (started.desktop !== plan.desktop) throw new Error('Cheap launch returned a different desktop name.')
    const window = await pollWindow(started.pid)
    const process = processIdentity(started.pid)
    return { mainPid: started.pid, hwnd: window.hwnd, port, window, process }
  }

  const invokeDriver = (phase, identity, timeout = 900) => {
    const args = [
      process.execPath,
      driver,
      '--phase',
      phase,
      '--attach',
      String(identity.port),
      '--task-root',
      plan.isolation.taskRoot,
      '--repo',
      options.repoRoot,
      '--provenance',
      plan.provenanceFile,
      '--state',
      plan.isolation.stateFile,
      '--evidence',
      plan.evidenceDirectory,
      '--project',
      plan.isolation.projectDirectory,
      '--run-id',
      options.runId,
      '--main-pid',
      String(identity.mainPid),
      '--hwnd',
      String(identity.hwnd),
      '--commit',
      plan.provenance.commit,
      '--source-digest',
      plan.provenance.workingTreeDigest,
      '--candidate',
      plan.candidate,
      '--candidate-sha256',
      plan.provenance.artifacts['packaged-executable'].sha256
    ]
    if (options.customDialect) args.push('--custom-dialect', options.customDialect)
    const command = args.map(quoteWindowsArg).join(' ')
    const result = runCheap(
      'run_command',
      { command, cwd: options.repoRoot, timeout, shell: false },
      timeout + 10
    )
    const output = parseJsonDocument(result.stdout, `Packaged CDP ${phase} driver`)
    if (output.ok !== true || output.phase !== phase) throw new Error(`Packaged CDP ${phase} driver failed.`)
    return output
  }

  for (const directory of [
    plan.isolation.appData,
    plan.isolation.localAppData,
    plan.isolation.chromiumProfile,
    plan.isolation.tempDirectory,
    plan.isolation.projectDirectory,
    plan.evidenceDirectory
  ]) {
    fs.mkdirSync(directory, { recursive: true })
  }

  const journalFile = requireInside(plan.isolation.taskRoot, path.join(plan.isolation.taskRoot, 'resource-journal.json'), 'Resource journal')
  const journal = {
    schemaVersion: 1,
    runId: options.runId,
    desktop: plan.desktop,
    sourceDigest: plan.provenance.workingTreeDigest,
    candidateSha256: plan.provenance.artifacts['packaged-executable'].sha256,
    launches: [],
    persistKeys: [],
    sessionHostPid: null
  }
  const writeJournal = () => atomicJson(journalFile, journal)
  writeJournal()

  let current
  let first
  let second
  let state

  const cleanup = async () => {
    const cleanupErrors = []
    const closeCurrent = async () => {
      if (!current || !processAlive(current.mainPid)) return
      try {
        const window = await pollWindow(current.mainPid, 5_000)
        if (window.hwnd !== current.hwnd) throw new Error('Cleanup refused a stale/reused HWND.')
        processIdentity(current.mainPid)
        try {
          invokeDriver('cleanup', current, 120)
          await waitForExit(current.mainPid, 'Packaged app during cleanup')
        } catch (driverError) {
          cleanupErrors.push(
            new Error(`CDP cleanup failed before exact-HWND fallback: ${driverError instanceof Error ? driverError.message : String(driverError)}`)
          )
          // Revalidate both process path and HWND immediately before posting the graceful close.
          const fallbackWindow = await pollWindow(current.mainPid, 5_000)
          if (fallbackWindow.hwnd !== current.hwnd) throw new Error('WM_CLOSE fallback refused a stale/reused HWND.')
          processIdentity(current.mainPid)
          postExactWmClose(current)
          await waitForExit(current.mainPid, 'Packaged app after WM_CLOSE fallback')
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    await closeCurrent()
    current = undefined

    if (fs.existsSync(plan.isolation.stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(plan.isolation.stateFile, 'utf8'))
        let hostPid = Number(state.continuity?.sessionHostPid ?? journal.sessionHostPid)
        if ((!Number.isInteger(hostPid) || hostPid <= 0) && (state.profiles?.length ?? 0) > 0) {
          const userDataDir = requireInside(
            plan.isolation.taskRoot,
            path.resolve(state.userDataDir),
            'Journaled packaged userDataDir'
          )
          const hostStateFile = requireInside(
            plan.isolation.taskRoot,
            path.join(userDataDir, 'session-host.json'),
            'Journaled session-host state'
          )
          if (!fs.existsSync(hostStateFile)) {
            throw new Error('Sessions were created but no exact session-host PID is journaled or discoverable.')
          }
          const hostState = JSON.parse(fs.readFileSync(hostStateFile, 'utf8'))
          hostPid = Number(hostState.pid)
          if (!Number.isInteger(hostPid) || hostPid <= 0) throw new Error('Journaled session-host state has an invalid PID.')
          journal.sessionHostPid = hostPid
          writeJournal()
        }
        if (Number.isInteger(hostPid) && hostPid > 0 && processAlive(hostPid)) {
          try {
            await waitForExit(hostPid, 'Task session host grace exit', 35_000)
          } catch {
            try {
              const cleanupPort = plan.ports.relaunch
              await assertPortFree(cleanupPort)
              current = await launch(cleanupPort, plan.launchCommands.relaunch)
              journal.launches.push({ phase: 'cleanup', mainPid: current.mainPid, hwnd: current.hwnd, port: current.port })
              writeJournal()
              invokeDriver('cleanup', current, 120)
              await waitForExit(current.mainPid, 'Cleanup relaunch')
              current = undefined
            } catch (error) {
              cleanupErrors.push(error)
            }
          }
        }
        if (Number.isInteger(hostPid) && hostPid > 0) {
          try {
            await waitForExit(hostPid, 'Task session host', 45_000)
          } catch (error) {
            cleanupErrors.push(error)
          }
        }
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (cleanupErrors.length) {
      throw new Error(cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)).join('\n'))
    }
  }

  return runWithCleanupThenPromote(async () => {
    first = await launch(plan.ports.initial, plan.launchCommands.initial)
    current = first
    journal.launches.push({ phase: 'initial', mainPid: first.mainPid, hwnd: first.hwnd, port: first.port })
    writeJournal()
    invokeDriver('bootstrap', first)
    await waitForExit(first.mainPid, 'Initial packaged app')
    current = undefined

    state = JSON.parse(fs.readFileSync(plan.isolation.stateFile, 'utf8'))
    journal.persistKeys = state.profiles.map((profile) => profile.nodeId)
    journal.sessionHostPid = state.continuity.sessionHostPid
    writeJournal()

    second = await launch(plan.ports.relaunch, plan.launchCommands.relaunch)
    current = second
    if (second.mainPid === first.mainPid || second.hwnd === first.hwnd) {
      throw new Error('Relaunch reused a stale main PID or HWND.')
    }
    journal.launches.push({ phase: 'reattach', mainPid: second.mainPid, hwnd: second.hwnd, port: second.port })
    writeJournal()
    invokeDriver('reattach', second)
    await waitForExit(second.mainPid, 'Relaunched packaged app')
    current = undefined

    state = JSON.parse(fs.readFileSync(plan.isolation.stateFile, 'utf8'))
    validateProfileResults(state.catalog, state.profiles)
    const continuity = validateContinuity(
      {
        mainPid: first.mainPid,
        hwnd: first.hwnd,
        sessionHostPid: state.continuity.sessionHostPid,
        sessionHostStartedAt: state.continuity.sessionHostStartedAt,
        sessionHostProtocolVersion: state.continuity.sessionHostProtocolVersion,
        terminalProcessPid: state.continuity.terminalProcessPid,
        marker: state.continuity.marker,
        tick: state.continuity.tick
      },
      state.reattached
    )
    const captures = validateEvidenceRecords(state.captures, plan.evidenceDirectory)

    const after = validateCandidateProvenance(options)
    if (
      after.workingTreeDigest !== plan.provenance.workingTreeDigest ||
      after.artifacts['packaged-executable'].sha256 !== plan.provenance.artifacts['packaged-executable'].sha256
    ) {
      throw new Error('Source/build provenance changed during packaged interaction.')
    }

    const manifest = {
      schemaVersion: 1,
      routeStatus: 'passed',
      acceptanceComplete: false,
      method: 'cheap Lowlevel MCP headless packaged Windows profile/session-host acceptance',
      runId: options.runId,
      source: {
        gitHead: plan.provenance.commit,
        workingTreeDigest: plan.provenance.workingTreeDigest,
        fileCount: plan.provenance.sourceFileCount
      },
      candidate: plan.provenance.artifacts['packaged-executable'],
      buildArtifacts: Object.values(plan.provenance.artifacts),
      desktop: plan.desktop,
      launches: journal.launches,
      profiles: state.profiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
        kind: profile.kind,
        dialect: profile.dialect,
        inputOutputVerified: profile.inputOutputVerified,
        unicodeVerified: profile.unicodeVerified,
        cwdVerified: profile.cwdVerified,
        sizeVerified: profile.sizeVerified,
        resizeVerified: profile.resizeVerified === true
      })),
      continuity,
      restart: state.restart,
      evidence: captures,
      requiredEvidenceIds: [...REQUIRED_EVIDENCE_IDS],
      copyPaste: {
        status: 'blocked',
        reason: 'Clipboard formats were not mutated; lossless all-format snapshot/restore is not available through the cheap route.'
      },
      installer: {
        status: 'blocked',
        reason: 'Installer proof is separate and remains blocked until a fresh artifact has correct PE identity and Squirrel lifecycle handling.'
      },
      blockers: ['copy-paste-lossless-clipboard-restore', 'installed-squirrel-artifact-proof']
    }
    return { manifest, profiles: manifest.profiles.length, evidence: captures.length }
  }, cleanup, (completed) => {
    // Promotion happens only after cleanup has returned successfully. A primary or cleanup failure
    // leaves staged screenshots/journal for diagnosis but can never create a green final manifest.
    const manifestFile = requireInside(
      plan.evidenceDirectory,
      path.join(plan.evidenceDirectory, 'windows-terminal-profile-packaged-payload-evidence.json'),
      'Acceptance manifest'
    )
    if (fs.existsSync(manifestFile)) throw new Error(`Refusing to overwrite acceptance manifest ${manifestFile}.`)
    atomicJson(manifestFile, completed.manifest)
    return {
      routeOk: true,
      acceptanceComplete: false,
      manifest: path.basename(manifestFile),
      profiles: completed.profiles,
      evidence: completed.evidence
    }
  })
}

try {
  const options = buildOptions()
  const plan = createAcceptancePlan(options)
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(publicPlan(plan, options), null, 2)}\n`)
  } else {
    const result = await execute(plan, options)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
}
