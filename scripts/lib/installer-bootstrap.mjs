import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm as removeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * A newly written executable can be momentarily held by Windows scanning or indexing before a
 * process can acquire its executable handle. These are the only pre-start errors we retry.
 */
export const TRANSIENT_INSTALLER_START_CODES = new Set(['EACCES', 'EPERM', 'EBUSY'])

/** Five total launch attempts, bounded to 1.85 seconds of waiting. */
export const INSTALLER_START_RETRY_DELAYS_MS = Object.freeze([100, 250, 500, 1000])

/** Cleanup uses a shorter bounded retry, but never replaces an earlier launch failure. */
export const INSTALLER_CLEANUP_RETRY_DELAYS_MS = Object.freeze([50, 100, 250])

function codeOf(error) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startOnce(executable, args, spawnImpl) {
  return new Promise((resolve) => {
    let started = false
    let startError
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let child
    try {
      child = spawnImpl(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    } catch (error) {
      finish({ kind: 'spawn-error', started: false, error })
      return
    }

    child.once('spawn', () => { started = true })
    child.once('error', (error) => {
      startError = error
      if (!started) finish({ kind: 'spawn-error', started: false, error })
    })
    child.once('close', (code, signal) => {
      if (startError) {
        finish({ kind: started ? 'child-error' : 'spawn-error', started, error: startError })
      } else {
        finish({ kind: 'exit', started, code, signal })
      }
    })
  })
}

/**
 * Start a fixed installer argv through a bounded retry policy. Child failures after `spawn` are
 * terminal because the installer may already have changed the output directory.
 */
export async function spawnInstallerWithRetry(executable, args, options = {}) {
  const spawnImpl = options.spawn ?? nodeSpawn
  const sleep = options.sleep ?? wait
  const retryDelaysMs = options.retryDelaysMs ?? INSTALLER_START_RETRY_DELAYS_MS

  for (let attempt = 0; ; attempt += 1) {
    const result = await startOnce(executable, args, spawnImpl)
    if (result.kind === 'exit') return result
    if (
      result.kind === 'spawn-error' &&
      !result.started &&
      TRANSIENT_INSTALLER_START_CODES.has(codeOf(result.error)) &&
      attempt < retryDelaysMs.length
    ) {
      await sleep(retryDelaysMs[attempt])
      continue
    }
    throw result.error ?? new Error('Installer could not start.')
  }
}

/** Remove only a path that its caller has already proven it created exclusively. */
export async function removeOwnedInstallerWithRetry(file, options = {}) {
  const rmImpl = options.rm ?? removeFile
  const sleep = options.sleep ?? wait
  const retryDelaysMs = options.retryDelaysMs ?? INSTALLER_CLEANUP_RETRY_DELAYS_MS

  for (let attempt = 0; ; attempt += 1) {
    try {
      await rmImpl(file, { force: true })
      return
    } catch (error) {
      if (!TRANSIENT_INSTALLER_START_CODES.has(codeOf(error)) || attempt >= retryDelaysMs.length) {
        throw error
      }
      await sleep(retryDelaysMs[attempt])
    }
  }
}

/** Resolve the archive extractor bundled by the declared packaging dependency, never PATH. */
export function resolveBundledSevenZip(root, options = {}) {
  const exists = options.exists ?? existsSync
  const extractor = path.join(root, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe')
  if (!exists(extractor)) {
    throw new Error(`The bundled 7-Zip extractor is missing after dependency installation: ${extractor}`)
  }
  return extractor
}

/**
 * Extract a verified installer archive without executing the downloaded installer itself.
 * The bundled extractor receives only fixed 7-Zip arguments and a caller-validated output path.
 */
export async function extractInstallerArchive(root, archive, output, options = {}) {
  const extractor = resolveBundledSevenZip(root, options)
  const result = await spawnInstallerWithRetry(extractor, ['x', '-y', `-o${output}`, archive], options)
  if (result.code !== 0) {
    throw new Error(`Bundled 7-Zip extraction exited with code ${result.code ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}.`)
  }
  return result
}
