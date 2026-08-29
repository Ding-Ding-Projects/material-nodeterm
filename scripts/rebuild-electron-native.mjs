#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(scriptPath), '..')

export const ELECTRON_NATIVE_MODULES = Object.freeze(['node-pty', 'smart-whisper'])
export const MAX_REBUILD_ATTEMPTS = 3
export const RETRY_BACKOFF_BASE_MS = 1000

const DIAGNOSTIC_TAIL_LIMIT = 256 * 1024

const ABI_PROBE_SOURCE = String.raw`
const pty = require('node-pty')
if (typeof pty.spawn !== 'function') {
  throw new Error('node-pty loaded without its spawn export')
}
require('smart-whisper')
process.stdout.write('[native-rebuild] Electron ABI probe loaded node-pty and smart-whisper.\n')
`

export function createNativeRebuildInvocation({
  buildPath,
  electronVersion,
  electronRebuildCli = path.join(path.dirname(require.resolve('@electron/rebuild')), 'cli.js')
}) {
  if (!path.isAbsolute(buildPath)) {
    throw new Error(`Native rebuild path must be absolute: ${buildPath}`)
  }
  if (typeof electronVersion !== 'string' || electronVersion.trim() === '') {
    throw new Error('Installed Electron version is unavailable.')
  }

  return {
    command: process.execPath,
    args: [
      electronRebuildCli,
      '--force',
      '--sequential',
      '--only',
      ELECTRON_NATIVE_MODULES.join(','),
      '--version',
      electronVersion,
      '--module-dir',
      buildPath
    ]
  }
}

function installedElectronVersion() {
  return require('electron/package.json').version
}

function installedElectronExecutable() {
  return require('electron')
}

export function runElectronAbiProbe({
  buildPath,
  electronExecutable = installedElectronExecutable(),
  spawnImpl = spawn
}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(electronExecutable, ['-e', ABI_PROBE_SOURCE], {
      cwd: buildPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      windowsHide: true
    })

    child.once('error', (error) => {
      reject(new Error(`Could not start the Electron ABI probe: ${error.message}`, { cause: error }))
    })
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Electron ABI probe ended from signal ${signal}.`))
        return
      }
      if (code !== 0) {
        reject(new Error(`Electron ABI probe exited with code ${code ?? 'unknown'}.`))
        return
      }
      resolve()
    })
  })
}

function appendDiagnosticTail(current, chunk) {
  const next = current + chunk
  return next.length <= DIAGNOSTIC_TAIL_LIMIT
    ? next
    : next.slice(next.length - DIAGNOSTIC_TAIL_LIMIT)
}

export function isTransientMsbuildRuntimeFailure(output) {
  if (!/(?:MSBuild|Microsoft\.Build|\bMSB(?:4018|4093)\b)/i.test(output)) return false
  return (
    /System\.InvalidProgramException/i.test(output) ||
    (/System\.AccessViolationException/i.test(output) &&
      /(?:Compiled)?RegexRunner\.(?:Go|Scan)/i.test(output)) ||
    /Microsoft\.Build\.CPPTasks\.[A-Za-z0-9_]+[\s\S]{0,500}does not have an implementation/i.test(
      output
    ) ||
    (/\bMSB4018\b/i.test(output) &&
      /["']CL["'] task failed unexpectedly/i.test(output) &&
      /System\.MissingMethodException/i.test(output) &&
      /System\.IO\.StreamWriter\.\.ctor\(System\.String,\s*Boolean,\s*System\.Text\.Encoding\)/i.test(output)) ||
    (/\bMSB4093\b/i.test(output) &&
      /["']TLogReadFiles["'] parameter of the ["']CL["'] task cannot be written/i.test(output) &&
      /does not have a ["']set["'] accessor/i.test(output)) ||
    (/\bMSB4093\b/i.test(output) &&
      /["']ContentFiles["'] parameter of the ["']GenerateDesktopDeployRecipe["'] task cannot be written/i.test(output) &&
      /does not have a ["']set["'] accessor/i.test(output))
  )
}

export function retryBackoffMs(failedAttempt) {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new Error(`Failed rebuild attempt must be a positive integer: ${failedAttempt}`)
  }
  return RETRY_BACKOFF_BASE_MS * 2 ** (failedAttempt - 1)
}

function waitForRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function runNativeRebuildAttempt({
  buildPath,
  electronVersion,
  spawnImpl = spawn
}) {
  const invocation = createNativeRebuildInvocation({ buildPath, electronVersion })

  return new Promise((resolve, reject) => {
    const child = spawnImpl(invocation.command, invocation.args, {
      cwd: buildPath,
      env: {
        ...process.env,
        MSBUILDDISABLENODEREUSE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let output = ''

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output = appendDiagnosticTail(output, chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      output = appendDiagnosticTail(output, chunk.toString())
    })
    child.once('error', (error) => {
      reject(new Error(`Could not start electron-rebuild: ${error.message}`, { cause: error }))
    })
    child.once('exit', (code, signal) => {
      resolve({ code, signal, output })
    })
  })
}

export async function rebuildElectronNativeModules({
  buildPath = repoRoot,
  electronVersion = installedElectronVersion(),
  runAttemptImpl = runNativeRebuildAttempt,
  probeImpl = runElectronAbiProbe,
  waitImpl = waitForRetry
} = {}) {
  process.stdout.write(
    `[native-rebuild] Rebuilding only ${ELECTRON_NATIVE_MODULES.join(', ')} for Electron ${electronVersion}.\n`
  )

  for (let attempt = 1; attempt <= MAX_REBUILD_ATTEMPTS; attempt += 1) {
    const result = await runAttemptImpl({ buildPath, electronVersion, attempt })
    if (result.code === 0 && !result.signal) break

    const retryable = isTransientMsbuildRuntimeFailure(result.output)
    if (retryable && attempt < MAX_REBUILD_ATTEMPTS) {
      const delayMs = retryBackoffMs(attempt)
      process.stderr.write(
        `[native-rebuild] MSBuild runtime failed transiently on attempt ${attempt}/${MAX_REBUILD_ATTEMPTS}; retrying in ${delayMs} ms with a fresh process.\n`
      )
      await waitImpl(delayMs)
      continue
    }

    if (result.signal) {
      throw new Error(`electron-rebuild ended from signal ${result.signal}.`)
    }
    throw new Error(`electron-rebuild exited with code ${result.code ?? 'unknown'}.`)
  }

  await probeImpl({ buildPath })
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  rebuildElectronNativeModules().catch((error) => {
    process.stderr.write(
      `[native-rebuild] ERROR: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}
