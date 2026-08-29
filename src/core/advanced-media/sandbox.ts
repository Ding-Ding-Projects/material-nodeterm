import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const MAX_ARGS = 128
const MAX_ARG_LENGTH = 16 * 1024
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

export interface SandboxedCommandOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs: number
  maxOutputBytes?: number
  signal?: AbortSignal
  onOutput?: (kind: 'stdout' | 'stderr', bytes: number) => void
}

export interface SandboxedCommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
}

function validateArgv(argv: readonly string[]): void {
  if (argv.length === 0 || argv.length > MAX_ARGS) throw new Error('The media command needs a bounded argument vector.')
  for (const arg of argv) {
    if (!arg || arg.length > MAX_ARG_LENGTH || arg.includes('\0')) throw new Error('The media command contains an invalid argument.')
  }
  if (!/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(argv[0])) {
    throw new Error('The media command must use an absolute verified executable path.')
  }
}

function safeEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key) || value.includes('\0')) throw new Error('The media environment contains an invalid key or value.')
    env[key] = value
  }
  return env
}

/**
 * Runs a manifest-verified media executable with shell execution disabled, a private temporary
 * directory, bounded output, and a hard deadline. The renderer never supplies argv directly;
 * adapters build the vector from validated paths and options before reaching this seam.
 */
export function runSandboxedCommand(argv: readonly string[], opts: SandboxedCommandOptions): Promise<SandboxedCommandResult> {
  validateArgv(argv)
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) throw new Error('The media command timeout must be positive.')
  const requestedCap = opts.maxOutputBytes ?? MAX_OUTPUT_BYTES
  if (!Number.isFinite(requestedCap) || requestedCap <= 0) throw new Error('The media command output limit must be positive.')
  const cap = Math.min(MAX_OUTPUT_BYTES, Math.max(1, Math.floor(requestedCap)))
  const cwd = opts.cwd ?? tmpdir()
  const env = safeEnv(opts.env)

  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let timedOut = false
    let cancelled = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, opts.timeoutMs)
    const abort = (): void => {
      cancelled = true
      child.kill()
    }
    if (opts.signal?.aborted) abort()
    else opts.signal?.addEventListener('abort', abort, { once: true })
    const append = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
      outputBytes += chunk.length
      opts.onOutput?.(kind, chunk.length)
      if (outputBytes > cap) {
        child.kill()
        return
      }
      if (kind === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
    }
    child.once('error', (error) => finish(error))
    child.once('close', (code, signal) => {
      if (settled) return
      if (outputBytes > cap) return finish(new Error('The media command exceeded its output limit.'))
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      resolve({ code, signal, stdout, stderr, timedOut, cancelled })
    })
  })
}
