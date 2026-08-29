import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import type { WindowsTerminalProfile, WindowsTerminalProfileKind } from '../shared/types'

const COMMAND_TIMEOUT_MS = 5_000
const COMMAND_MAX_BUFFER = 1024 * 1024
const SAFE_BARE_EXECUTABLE = /^[A-Za-z0-9_.+-]+$/
const WSL_PROFILE_PREFIX = 'wsl:'
const MAX_WSL_DISTRIBUTION_NAME = 256
// Raw WSL output may echo distro names, executable argv, and translated paths. Only fixed values
// in this set may cross the core boundary; a regex-shaped token such as a private `E_SECRET`
// directory is otherwise indistinguishable from a real HRESULT identifier.
const PUBLIC_WSL_FAILURE_CODES = new Set(['WSL_E_DISTRO_NOT_FOUND', 'E_FAIL'])
const PUBLIC_PROCESS_FAILURE_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EIO',
  'EINVAL',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOMEM',
  'ENOTDIR',
  'EPERM',
  'EPIPE',
  'ETIMEDOUT'
])
export const WSL_LAUNCH_CWD_GUARD = [
  'if ! cd "$1" 2>/dev/null; then',
  "  printf '%s\\n' 'nodeterm: WSL working directory became unavailable; choose another directory.' >&2",
  '  exit 125',
  'fi',
  'if [ -z "${SHELL:-}" ]; then',
  "  printf '%s\\n' 'nodeterm: WSL default shell is unavailable; choose another profile.' >&2",
  '  exit 126',
  'fi',
  'exec "$SHELL"'
].join('\n')

export type { WindowsTerminalProfileKind } from '../shared/types'

/** Renderer-safe shared shape; launch material remains in ResolvedWindowsTerminalProfile. */
export type WindowsTerminalProfileDescriptor = WindowsTerminalProfile

export interface WindowsTerminalProfileResolveRequest {
  profileId: string
  cwd: string
  customExecutable?: string
}

/** Trusted, core-only launch material. It must never be persisted or sent over the renderer API. */
export interface ResolvedWindowsTerminalProfile {
  profileId: string
  label: string
  kind: WindowsTerminalProfileKind
  shell: string
  shellArgs: string[]
  cwd: string
}

export interface WindowsTerminalProfileResolver {
  resolveForSpawn(
    request: WindowsTerminalProfileResolveRequest
  ): Promise<ResolvedWindowsTerminalProfile>
}

export type WindowsTerminalProfileErrorCode =
  | 'unsupported-platform'
  | 'malformed-profile-id'
  | 'profile-unavailable'
  | 'custom-required'
  | 'custom-invalid'
  | 'wsl-enumeration-failed'
  | 'wsl-distro-missing'
  | 'wsl-cwd-invalid'
  | 'wsl-cwd-translation-failed'
  | 'wsl-cwd-output-invalid'

export class WindowsTerminalProfileError extends Error {
  readonly code: WindowsTerminalProfileErrorCode
  readonly profileId: string

  constructor(code: WindowsTerminalProfileErrorCode, profileId: string, message: string) {
    super(message)
    this.name = 'WindowsTerminalProfileError'
    this.code = code
    this.profileId = profileId
  }
}

/**
 * Result of inspecting a candidate path.
 *
 * `missing` is evidence: only ENOENT/ENOTDIR may produce it. `unknown` preserves every
 * permission, I/O, and classification failure so callers never turn "could not inspect" into
 * "does not exist". Detection may still use a different candidate that was independently proven.
 */
export type WindowsTerminalPathKind = 'file' | 'directory' | 'missing' | 'unknown'

export function windowsTerminalPathErrorKind(
  error: unknown
): Extract<WindowsTerminalPathKind, 'missing' | 'unknown'> {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown'
}

export interface WindowsTerminalCommandResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number | null
  error?: Error
}

export interface WindowsTerminalExecutableLookup {
  path: string | null
  /** At least one candidate could not be inspected; absence is therefore unproven. */
  unknownProbe: boolean
  /** At least one candidate existed but was not a file (for example, a PATH directory). */
  nonFileProbe: boolean
}

/** Injectable operating-system boundary used to keep profile tests deterministic. */
export interface WindowsTerminalProfileRuntime {
  platform: NodeJS.Platform
  env: Readonly<NodeJS.ProcessEnv>
  findExecutable(
    command: string,
    fallbacks: readonly string[]
  ): Promise<WindowsTerminalExecutableLookup>
  pathKind(candidate: string): Promise<WindowsTerminalPathKind>
  execFile(file: string, args: readonly string[]): Promise<WindowsTerminalCommandResult>
}

export interface WindowsTerminalProfileServiceOptions {
  runtime?: WindowsTerminalProfileRuntime
  /** Machine-local settings getter. Its value is validated but never returned by list/refresh. */
  getCustomExecutable?: () => unknown
}

interface ExecutableCandidate {
  shell: string
  label: string
  kind: Exclude<WindowsTerminalProfileKind, 'auto' | 'custom' | 'wsl'>
  shellArgs: string[]
}

interface CandidateResult {
  candidate: ExecutableCandidate | null
  reason: string
}

interface WslEnumeration {
  wslExe: string | null
  distributions: string[]
  unavailableReason?: string
  publicUnavailableReason?: string
}

interface DetectionSnapshot {
  profiles: WindowsTerminalProfileDescriptor[]
}

function buffer(value: Buffer | string | undefined): Buffer {
  if (Buffer.isBuffer(value)) return value
  return Buffer.from(value ?? '', 'utf8')
}

function windowsCommandCandidateNames(command: string, env: Readonly<NodeJS.ProcessEnv>): string[] {
  if (/\.[^./\\]+$/.test(command)) return [command]
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)
  return [...new Set([command, ...extensions.map((extension) => command + extension)])]
}

/**
 * Evidence-carrying Windows PATH walk. Unlike the generic legacy helper, this keeps an
 * uninspectable candidate distinct from a missing one and skips directories instead of letting an
 * early `PATH\pwsh` directory hide a later `pwsh.exe` file.
 */
export async function findWindowsTerminalExecutable(
  command: string,
  fallbacks: readonly string[],
  env: Readonly<NodeJS.ProcessEnv>,
  pathKind: (candidate: string) => Promise<WindowsTerminalPathKind>
): Promise<WindowsTerminalExecutableLookup> {
  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (candidate: string) => {
    const folded = candidate.toLocaleLowerCase('en-US')
    if (seen.has(folded)) return
    seen.add(folded)
    candidates.push(candidate)
  }

  const names = windowsCommandCandidateNames(command, env)
  for (const rawDirectory of (env.PATH ?? '').split(';')) {
    if (!rawDirectory) continue
    const directory =
      rawDirectory.length >= 2 && rawDirectory.startsWith('"') && rawDirectory.endsWith('"')
        ? rawDirectory.slice(1, -1)
        : rawDirectory
    // A relative PATH entry would make executable selection depend on whichever cwd node-pty
    // later uses (including a project directory). Trusted profile resolution accepts only a
    // machine-absolute discovery result.
    if (!directory || !path.win32.isAbsolute(directory)) continue
    for (const name of names) add(path.win32.join(directory, name))
  }
  for (const fallback of fallbacks) add(fallback)

  let unknownProbe = false
  let nonFileProbe = false
  for (const candidate of candidates) {
    const kind = await pathKind(candidate)
    if (kind === 'file') return { path: candidate, unknownProbe, nonFileProbe }
    if (kind === 'unknown') unknownProbe = true
    else if (kind === 'directory') nonFileProbe = true
  }
  return { path: null, unknownProbe, nonFileProbe }
}

function defaultRuntime(): WindowsTerminalProfileRuntime {
  const runtime: WindowsTerminalProfileRuntime = {
    platform: process.platform,
    env: process.env,
    findExecutable: (command, fallbacks) =>
      findWindowsTerminalExecutable(command, fallbacks, process.env, runtime.pathKind),
    pathKind: async (candidate) => {
      try {
        const stat = await fs.stat(candidate)
        if (stat.isFile()) return 'file'
        if (stat.isDirectory()) return 'directory'
        return 'unknown'
      } catch (error) {
        return windowsTerminalPathErrorKind(error)
      }
    },
    execFile: (file, args) =>
      new Promise((resolve) => {
        execFile(
          file,
          [...args],
          {
            encoding: 'buffer',
            windowsHide: true,
            timeout: COMMAND_TIMEOUT_MS,
            maxBuffer: COMMAND_MAX_BUFFER
          },
          (error, stdout, stderr) => {
            const errorCode: unknown = error ? (error as { code?: unknown }).code : undefined
            const exitCode = error ? (typeof errorCode === 'number' ? errorCode : null) : 0
            resolve({
              stdout: buffer(stdout),
              stderr: buffer(stderr),
              exitCode,
              ...(error ? { error } : {})
            })
          }
        )
      })
  }
  return runtime
}

function fixedUnavailable(
  id: Exclude<string, `wsl:${string}`>,
  label: string,
  kind: WindowsTerminalProfileKind,
  reason: string
): WindowsTerminalProfileDescriptor {
  return { id, label, kind, available: false, unavailableReason: reason }
}

function printable(value: string, maxLength = 300): string {
  const safe = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (safe.length <= maxLength) return safe
  return `${safe.slice(0, maxLength - 1)}…`
}

/**
 * WSL's Windows-side commands normally emit UTF-16LE (often without a BOM), while a Linux
 * executable invoked through WSL commonly emits UTF-8. Decode both without deleting decoded
 * interior NULs, which could otherwise turn hostile/malformed data into a different name.
 */
function decodeWslOutput(raw: Buffer): string {
  if (raw.length === 0) return ''

  let encoding: 'utf16le' | 'utf8' = 'utf8'
  let start = 0
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    encoding = 'utf16le'
    start = 2
  } else if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    start = 3
  } else {
    let oddNuls = 0
    let oddBytes = 0
    for (let i = 1; i < raw.length; i += 2) {
      oddBytes++
      if (raw[i] === 0) oddNuls++
    }
    const hasUtf16LineEnding = raw.includes(Buffer.from([0x0d, 0x00, 0x0a, 0x00]))
    if (hasUtf16LineEnding || (oddBytes > 0 && oddNuls / oddBytes >= 0.3)) {
      encoding = 'utf16le'
    }
  }

  const body = raw.subarray(start)
  if (encoding === 'utf16le' && body.length % 2 !== 0) {
    throw new Error('WSL returned truncated UTF-16 output')
  }
  const decoded = body.toString(encoding).replace(/^\uFEFF/, '')
  if (decoded.includes('\uFFFD')) throw new Error('WSL returned malformed text output')
  if (decoded.includes('\u0000')) throw new Error('WSL returned a NUL character in text output')
  return decoded
}

function commandFailureText(result: WindowsTerminalCommandResult): string[] {
  const decoded: string[] = []
  for (const raw of [result.stdout, result.stderr]) {
    if (raw.length === 0) continue
    try {
      const value = decodeWslOutput(raw)
      if (value) decoded.push(value)
    } catch {
      // Malformed diagnostics cannot be trusted even for internal classification.
    }
  }
  if (result.error?.message) decoded.push(result.error.message)
  return decoded
}

/**
 * Extract only stable diagnostic identifiers. Raw execFile text commonly repeats the executable
 * and full argv, so echoing it through a rejected PTY-create IPC would disclose launch material
 * that the public profile API deliberately withholds.
 */
function stableWslFailureCodes(result: WindowsTerminalCommandResult): string[] {
  const codes: string[] = []
  for (const text of commandFailureText(result)) {
    // Keep only the terminal identifier, never the preceding `Wsl/...` hierarchy. Apart from
    // being unnecessary to act on, that hierarchy is syntactically indistinguishable from a
    // Linux path such as `/mnt/c/Wsl/Private/E_SECRET`; returning it could disclose cwd segments.
    codes.push(
      ...(text.match(
        /\b(?:WSL_E_[A-Z0-9_]+|HCS_E_[A-Z0-9_]+|ERROR_[A-Z0-9_]+|E_[A-Z0-9_]+|0x[0-9A-F]+)\b/gi
      ) ?? [])
    )
  }
  return [
    ...new Set(
      codes
        .map((code) => code.toLocaleUpperCase('en-US'))
        .filter((code) => PUBLIC_WSL_FAILURE_CODES.has(code))
    )
  ]
}

function commandFailureDetail(result: WindowsTerminalCommandResult): string {
  const decoded = stableWslFailureCodes(result).map((code) => `WSL error ${code}`)
  if (result.error) {
    const code: unknown = (result.error as { code?: unknown }).code
    if (typeof code === 'string') {
      const normalizedCode = code.toLocaleUpperCase('en-US')
      if (PUBLIC_PROCESS_FAILURE_CODES.has(normalizedCode)) {
        decoded.push(`process error ${normalizedCode}`)
      } else if (result.exitCode === null) {
        decoded.push('the command could not be started or timed out')
      }
    } else if (result.exitCode === null) {
      decoded.push('the command could not be started or timed out')
    }
  }
  if (result.exitCode !== null && result.exitCode !== 0)
    decoded.push(`exit code ${result.exitCode}`)
  return [...new Set(decoded)].join(' — ') || 'the command failed without diagnostic output'
}

function commandReportsMissingWslDistribution(result: WindowsTerminalCommandResult): boolean {
  return commandFailureText(result).some((text) =>
    /WSL_E_DISTRO_NOT_FOUND|no distribution with the supplied name/i.test(text)
  )
}

function parseWslDistributions(raw: Buffer): string[] {
  const decoded = decodeWslOutput(raw)
  if (!decoded) return []

  const distributions: string[] = []
  const seenCaseInsensitive = new Set<string>()
  for (const line of decoded.split(/\r\n|\n|\r/)) {
    if (line === '') continue
    if (line.trim() !== line)
      throw new Error('WSL returned a distribution name with outer whitespace')
    if (line.length > MAX_WSL_DISTRIBUTION_NAME) {
      throw new Error('WSL returned an overlong distribution name')
    }
    if (/[\u0000-\u001f\u007f]/.test(line)) {
      throw new Error('WSL returned a distribution name containing a control character')
    }
    const folded = line.toLocaleLowerCase('en-US')
    if (seenCaseInsensitive.has(folded)) {
      throw new Error('WSL returned duplicate distribution names')
    }
    seenCaseInsensitive.add(folded)
    distributions.push(line)
  }
  return distributions
}

function parseLinuxCwd(raw: Buffer): string {
  const decoded = decodeWslOutput(raw)
  const lines = decoded.split(/\r\n|\n|\r/).filter((line) => line !== '')
  if (lines.length !== 1) throw new Error('wslpath did not return exactly one path')
  const [linuxPath] = lines
  if (!linuxPath.startsWith('/') || /[\u0000-\u001f\u007f]/.test(linuxPath)) {
    throw new Error('wslpath did not return an absolute Linux path')
  }
  return linuxPath
}

function validWslDistributionName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_WSL_DISTRIBUTION_NAME &&
    name.trim() === name &&
    !/[\u0000-\u001f\u007f]/.test(name)
  )
}

export class WindowsTerminalProfileService implements WindowsTerminalProfileResolver {
  private cachedDetection: Promise<DetectionSnapshot> | null = null
  private readonly runtime: WindowsTerminalProfileRuntime
  private readonly getCustomExecutable: () => unknown

  constructor(options: WindowsTerminalProfileServiceOptions = {}) {
    this.runtime = options.runtime ?? defaultRuntime()
    this.getCustomExecutable = options.getCustomExecutable ?? (() => undefined)
  }

  async list(): Promise<WindowsTerminalProfileDescriptor[]> {
    if (!this.cachedDetection) this.cachedDetection = this.detectAll()
    const active = this.cachedDetection
    try {
      const snapshot = await active
      return this.withCurrentCustomProfile(snapshot.profiles)
    } catch (error) {
      if (this.cachedDetection === active) this.cachedDetection = null
      throw error
    }
  }

  async refresh(customExecutableOverride?: unknown): Promise<WindowsTerminalProfileDescriptor[]> {
    const hasCustomExecutableOverride = arguments.length > 0
    const refreshed = this.detectAll()
    this.cachedDetection = refreshed
    try {
      const snapshot = await refreshed
      return this.withCurrentCustomProfile(
        snapshot.profiles,
        hasCustomExecutableOverride,
        customExecutableOverride
      )
    } catch (error) {
      if (this.cachedDetection === refreshed) this.cachedDetection = null
      throw error
    }
  }

  async resolveForSpawn(
    request: WindowsTerminalProfileResolveRequest
  ): Promise<ResolvedWindowsTerminalProfile> {
    const untrustedProfileId: unknown = (request as { profileId?: unknown } | null)?.profileId
    if (typeof untrustedProfileId !== 'string') {
      throw new WindowsTerminalProfileError(
        'malformed-profile-id',
        '',
        'The Windows terminal profile ID is malformed. Refresh terminal profiles and choose a valid profile.'
      )
    }
    this.assertWindows(request.profileId)

    switch (request.profileId) {
      case 'auto': {
        const pwsh = await this.pwshCandidate()
        const windowsPowerShell = pwsh.candidate ? null : await this.windowsPowerShellCandidate()
        const cmd =
          pwsh.candidate || windowsPowerShell?.candidate ? null : await this.cmdCandidate()
        const candidate = pwsh.candidate ?? windowsPowerShell?.candidate ?? cmd?.candidate ?? null
        if (!candidate) {
          throw new WindowsTerminalProfileError(
            'profile-unavailable',
            request.profileId,
            `No automatic Windows shell is available. ${[
              pwsh.reason,
              windowsPowerShell?.reason,
              cmd?.reason
            ]
              .filter(Boolean)
              .join(' ')}`
          )
        }
        return this.resolved(request, candidate)
      }
      case 'pwsh':
        return this.resolveExplicitCandidate(request, await this.pwshCandidate(), 'PowerShell 7')
      case 'windows-powershell':
        return this.resolveExplicitCandidate(
          request,
          await this.windowsPowerShellCandidate(),
          'Windows PowerShell'
        )
      case 'cmd':
        return this.resolveExplicitCandidate(request, await this.cmdCandidate(), 'Command Prompt')
      case 'git-bash':
        return this.resolveExplicitCandidate(request, await this.gitBashCandidate(), 'Git Bash')
      case 'custom':
        return this.resolveCustom(request)
      default:
        if (request.profileId.startsWith(WSL_PROFILE_PREFIX)) return this.resolveWsl(request)
        throw new WindowsTerminalProfileError(
          'malformed-profile-id',
          request.profileId,
          `Unknown Windows terminal profile “${printable(request.profileId, 120)}”. Refresh terminal profiles and choose a valid profile.`
        )
    }
  }

  private assertWindows(profileId: string): void {
    if (this.runtime.platform !== 'win32') {
      throw new WindowsTerminalProfileError(
        'unsupported-platform',
        profileId,
        'Windows terminal profiles are available only in the Windows desktop app.'
      )
    }
  }

  private resolved(
    request: WindowsTerminalProfileResolveRequest,
    candidate: ExecutableCandidate
  ): ResolvedWindowsTerminalProfile {
    return {
      profileId: request.profileId,
      label: candidate.label,
      kind: candidate.kind,
      shell: candidate.shell,
      shellArgs: [...candidate.shellArgs],
      cwd: request.cwd
    }
  }

  private resolveExplicitCandidate(
    request: WindowsTerminalProfileResolveRequest,
    result: CandidateResult,
    label: string
  ): ResolvedWindowsTerminalProfile {
    if (!result.candidate) {
      throw new WindowsTerminalProfileError(
        'profile-unavailable',
        request.profileId,
        `${label} is unavailable. ${result.reason}`
      )
    }
    return this.resolved(request, result.candidate)
  }

  private async detectAll(): Promise<DetectionSnapshot> {
    const unsupportedReason =
      'Windows terminal profiles are available only in the Windows desktop app.'
    if (this.runtime.platform !== 'win32') {
      return {
        profiles: [
          fixedUnavailable('auto', 'Automatic', 'auto', unsupportedReason),
          fixedUnavailable('pwsh', 'PowerShell 7', 'pwsh', unsupportedReason),
          fixedUnavailable(
            'windows-powershell',
            'Windows PowerShell',
            'windows-powershell',
            unsupportedReason
          ),
          fixedUnavailable('cmd', 'Command Prompt', 'cmd', unsupportedReason),
          fixedUnavailable('git-bash', 'Git Bash', 'git-bash', unsupportedReason)
        ]
      }
    }

    const [pwsh, windowsPowerShell, cmd, gitBash, wsl] = await Promise.all([
      this.pwshCandidate(),
      this.windowsPowerShellCandidate(),
      this.cmdCandidate(),
      this.gitBashCandidate(),
      this.enumerateWsl()
    ])
    const automatic = pwsh.candidate ?? windowsPowerShell.candidate ?? cmd.candidate

    const profiles: WindowsTerminalProfileDescriptor[] = [
      automatic
        ? {
            id: 'auto',
            label: `Automatic (${automatic.label})`,
            kind: 'auto',
            available: true
          }
        : fixedUnavailable(
            'auto',
            'Automatic',
            'auto',
            [pwsh.reason, windowsPowerShell.reason, cmd.reason].filter(Boolean).join(' ')
          ),
      this.descriptor('pwsh', 'PowerShell 7', 'pwsh', pwsh),
      this.descriptor(
        'windows-powershell',
        'Windows PowerShell',
        'windows-powershell',
        windowsPowerShell
      ),
      this.descriptor('cmd', 'Command Prompt', 'cmd', cmd),
      this.descriptor('git-bash', 'Git Bash', 'git-bash', gitBash),
      ...(wsl.distributions.length > 0
        ? wsl.distributions.map((distribution): WindowsTerminalProfileDescriptor => ({
            id: `${WSL_PROFILE_PREFIX}${distribution}`,
            label: `WSL: ${distribution}`,
            kind: 'wsl',
            available: true
          }))
        : [
            fixedUnavailable(
              'wsl:',
              'WSL distributions',
              'wsl',
              wsl.publicUnavailableReason ||
                'WSL is installed, but no distributions are registered.'
            )
          ])
    ]

    return { profiles }
  }

  private async withCurrentCustomProfile(
    detected: readonly WindowsTerminalProfileDescriptor[],
    hasConfiguredOverride = false,
    configuredOverride?: unknown
  ): Promise<WindowsTerminalProfileDescriptor[]> {
    if (this.runtime.platform !== 'win32') {
      return [
        ...detected.map((profile) => ({ ...profile })),
        fixedUnavailable(
          'custom',
          'Custom executable',
          'custom',
          'Windows terminal profiles are available only in the Windows desktop app.'
        )
      ]
    }

    let configured: unknown
    try {
      configured = hasConfiguredOverride ? configuredOverride : this.getCustomExecutable()
    } catch {
      return [
        ...detected.map((profile) => ({ ...profile })),
        fixedUnavailable(
          'custom',
          'Custom executable',
          'custom',
          'The configured custom executable could not be read from machine-local settings.'
        )
      ]
    }
    const reason = await this.customUnavailableReason(configured)
    return [
      ...detected.map((profile) => ({ ...profile })),
      reason
        ? fixedUnavailable('custom', 'Custom executable', 'custom', reason)
        : {
            id: 'custom',
            label: 'Custom executable',
            kind: 'custom',
            available: true
          }
    ]
  }

  private async customUnavailableReason(configured: unknown): Promise<string | null> {
    if (configured === undefined || configured === null || configured === '') {
      return 'No custom executable is configured.'
    }
    if (typeof configured !== 'string') {
      return 'The configured custom executable is not a string.'
    }
    if (configured.trim() !== configured || /[\u0000-\u001f\u007f"]/.test(configured)) {
      return 'The configured custom executable contains quoting, control characters, or outer whitespace.'
    }
    if (path.win32.isAbsolute(configured)) {
      const kind = await this.runtime.pathKind(configured)
      if (kind === 'file') return null
      if (kind === 'directory') return 'The configured custom executable is a directory.'
      return kind === 'missing'
        ? 'The configured custom executable does not exist.'
        : 'The configured custom executable could not be inspected. Check file access, then refresh terminal profiles.'
    }
    if (!SAFE_BARE_EXECUTABLE.test(configured)) {
      return 'The configured custom executable is not a safe bare name or absolute Windows path.'
    }
    let lookup: WindowsTerminalExecutableLookup
    try {
      lookup = await this.runtime.findExecutable(configured, [])
    } catch {
      return 'The configured custom executable could not be detected on PATH. Refresh terminal profiles to try again.'
    }
    const resolved = lookup.path
    if (!resolved)
      return lookup.unknownProbe
        ? 'The configured custom executable availability on PATH could not be verified. Check file access, then refresh terminal profiles.'
        : lookup.nonFileProbe
          ? 'The configured custom executable name resolves only to a directory, not an executable file.'
          : 'The configured custom executable was not found on PATH.'
    const kind = await this.runtime.pathKind(resolved)
    if (kind !== 'file')
      return kind === 'unknown'
        ? 'The configured custom executable found on PATH could not be inspected. Check file access, then refresh terminal profiles.'
        : kind === 'directory'
          ? 'The configured custom executable name resolves only to a directory, not an executable file.'
          : 'The configured custom executable was not found on PATH.'
    return null
  }

  private descriptor(
    id: string,
    label: string,
    kind: WindowsTerminalProfileKind,
    result: CandidateResult
  ): WindowsTerminalProfileDescriptor {
    return result.candidate
      ? { id, label, kind, available: true }
      : { id, label, kind, available: false, unavailableReason: result.reason }
  }

  private async checkedCandidate(
    command: string,
    fallbacks: readonly string[],
    label: string,
    kind: ExecutableCandidate['kind'],
    shellArgs: readonly string[] = [],
    preferFallbacks = false
  ): Promise<CandidateResult> {
    let found: string | null
    let unknownPathProbe = false
    let nonFilePathProbe = false
    try {
      found = null
      if (preferFallbacks) {
        for (const candidate of fallbacks) {
          const kind = await this.runtime.pathKind(candidate)
          if (kind === 'file') {
            found = candidate
            break
          }
          if (kind === 'unknown') unknownPathProbe = true
          else if (kind === 'directory') nonFilePathProbe = true
        }
      }
      if (!found) {
        const lookup = await this.runtime.findExecutable(command, preferFallbacks ? [] : fallbacks)
        found = lookup.path
        unknownPathProbe ||= lookup.unknownProbe
        nonFilePathProbe ||= lookup.nonFileProbe
      }
    } catch {
      return {
        candidate: null,
        // Catalog reasons cross the desktop bridge. Do not echo a filesystem exception here: it
        // commonly embeds the discovered executable path, which is core-private profile data.
        reason: `${label} detection failed. Refresh terminal profiles to try again.`
      }
    }
    if (!found)
      return {
        candidate: null,
        reason: unknownPathProbe
          ? `${label} executable availability could not be verified. Check file access, then refresh terminal profiles.`
          : nonFilePathProbe
            ? `${label} detection found only directories where executable files were expected.`
            : `${label} executable was not found.`
      }
    const foundKind = await this.runtime.pathKind(found)
    if (foundKind !== 'file') {
      if (foundKind === 'unknown' || unknownPathProbe) {
        return {
          candidate: null,
          reason: `${label} executable availability could not be verified. Check file access, then refresh terminal profiles.`
        }
      }
      return {
        candidate: null,
        reason: `${label} executable is not an accessible file.`
      }
    }
    return {
      candidate: { shell: found, label, kind, shellArgs: [...shellArgs] },
      reason: ''
    }
  }

  private pwshCandidate(): Promise<CandidateResult> {
    const roots = new Set(
      [
        this.runtime.env.ProgramFiles,
        this.runtime.env.ProgramW6432,
        this.runtime.env.ProgramFiles ? undefined : 'C:\\Program Files'
      ].filter((value): value is string => Boolean(value))
    )
    return this.checkedCandidate(
      'pwsh',
      [...roots].map((root) => path.win32.join(root, 'PowerShell', '7', 'pwsh.exe')),
      'PowerShell 7',
      'pwsh',
      [],
      true
    )
  }

  private windowsPowerShellCandidate(): Promise<CandidateResult> {
    const systemRoot = this.runtime.env.SystemRoot || this.runtime.env.WINDIR || 'C:\\Windows'
    return this.checkedCandidate(
      'powershell',
      [path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
      'Windows PowerShell',
      'windows-powershell',
      [],
      true
    )
  }

  private async cmdCandidate(): Promise<CandidateResult> {
    const comspec = this.runtime.env.COMSPEC
    let invalidComspecReason = ''
    if (comspec) {
      if (
        comspec.trim() !== comspec ||
        /[\u0000-\u001f\u007f"]/.test(comspec) ||
        (!path.win32.isAbsolute(comspec) && !SAFE_BARE_EXECUTABLE.test(comspec))
      ) {
        invalidComspecReason = 'COMSPEC is not a valid executable path.'
      } else if (path.win32.isAbsolute(comspec)) {
        const kind = await this.runtime.pathKind(comspec)
        if (kind === 'file') {
          return {
            candidate: {
              shell: comspec,
              label: 'Command Prompt',
              kind: 'cmd',
              shellArgs: []
            },
            reason: ''
          }
        }
        invalidComspecReason =
          kind === 'unknown'
            ? 'The configured COMSPEC executable could not be inspected.'
            : 'The configured COMSPEC executable was not found.'
      } else {
        const fromPath = await this.checkedCandidate(comspec, [], 'COMSPEC', 'cmd')
        if (fromPath.candidate) {
          return {
            ...fromPath,
            candidate: { ...fromPath.candidate, label: 'Command Prompt' }
          }
        }
        invalidComspecReason = fromPath.reason
      }
    }

    const systemRoot = this.runtime.env.SystemRoot || this.runtime.env.WINDIR || 'C:\\Windows'
    const cmd = await this.checkedCandidate(
      'cmd',
      [path.win32.join(systemRoot, 'System32', 'cmd.exe')],
      'Command Prompt',
      'cmd',
      [],
      true
    )
    if (!cmd.candidate && invalidComspecReason) {
      cmd.reason = `${invalidComspecReason} ${cmd.reason}`
    }
    return cmd
  }

  private async gitBashCandidate(): Promise<CandidateResult> {
    const env = this.runtime.env
    const gitRoots = new Set<string>()
    let unknownPathProbe = false
    let nonFilePathProbe = false
    for (const command of ['git-bash', 'git']) {
      let lookup: WindowsTerminalExecutableLookup
      try {
        lookup = await this.runtime.findExecutable(command, [])
      } catch {
        unknownPathProbe = true
        continue
      }
      unknownPathProbe ||= lookup.unknownProbe
      nonFilePathProbe ||= lookup.nonFileProbe
      const hit = lookup.path
      if (!hit) continue
      gitRoots.add(this.gitRootFromExecutable(hit))
    }
    const machineRoots = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']]
    if (!env.ProgramFiles && !env.ProgramW6432) machineRoots.push('C:\\Program Files')
    for (const root of machineRoots) {
      if (root) gitRoots.add(path.win32.join(root, 'Git'))
    }
    const localAppData =
      env.LOCALAPPDATA ||
      (env.USERPROFILE ? path.win32.join(env.USERPROFILE, 'AppData', 'Local') : undefined)
    if (localAppData) {
      gitRoots.add(path.win32.join(localAppData, 'Programs', 'Git'))
    }
    for (const root of gitRoots) {
      for (const relative of [
        ['bin', 'bash.exe'],
        ['usr', 'bin', 'bash.exe']
      ]) {
        const candidate = path.win32.join(root, ...relative)
        const kind = await this.runtime.pathKind(candidate)
        if (kind === 'file') {
          return {
            candidate: {
              shell: candidate,
              label: 'Git Bash',
              kind: 'git-bash',
              shellArgs: ['--login', '-i']
            },
            reason: ''
          }
        }
        if (kind === 'unknown') unknownPathProbe = true
        else if (kind === 'directory') nonFilePathProbe = true
      }
    }
    return {
      candidate: null,
      reason: unknownPathProbe
        ? 'Git Bash executable availability could not be verified. Check file access, then refresh terminal profiles.'
        : nonFilePathProbe
          ? 'Git Bash detection found only directories where executable files were expected.'
          : 'Git Bash executable was not found.'
    }
  }

  private gitRootFromExecutable(executable: string): string {
    let root = path.win32.dirname(executable)
    const parts = root.split(/[\\/]/)
    const folded = parts.map((part) => part.toLocaleLowerCase('en-US'))
    const suffixLengths = [
      ['cmd'],
      ['bin'],
      ['usr', 'bin'],
      ['mingw32', 'bin'],
      ['mingw64', 'bin'],
      ['mingw32', 'libexec', 'git-core'],
      ['mingw64', 'libexec', 'git-core']
    ]
      .filter(
        (suffix) =>
          suffix.length <= folded.length &&
          suffix.every((part, index) => folded[folded.length - suffix.length + index] === part)
      )
      .map((suffix) => suffix.length)
    const suffixLength = Math.max(0, ...suffixLengths)
    for (let index = 0; index < suffixLength; index++) root = path.win32.dirname(root)
    return root
  }

  private async wslExecutable(): Promise<CandidateResult> {
    const systemRoot = this.runtime.env.SystemRoot || this.runtime.env.WINDIR || 'C:\\Windows'
    return this.checkedCandidate(
      'wsl',
      [path.win32.join(systemRoot, 'System32', 'wsl.exe')],
      'WSL',
      'cmd',
      [],
      true
    )
  }

  private async enumerateWsl(): Promise<WslEnumeration> {
    const executable = await this.wslExecutable()
    if (!executable.candidate) {
      return {
        wslExe: null,
        distributions: [],
        unavailableReason: executable.reason,
        publicUnavailableReason: 'WSL is not installed or its system executable is unavailable.'
      }
    }
    const wslExe = executable.candidate.shell
    let result: WindowsTerminalCommandResult
    try {
      result = await this.runtime.execFile(wslExe, ['--list', '--quiet'])
    } catch {
      return {
        wslExe,
        distributions: [],
        unavailableReason:
          'WSL distribution detection failed because the command could not be started.',
        publicUnavailableReason: 'WSL distribution detection failed. Refresh profiles to try again.'
      }
    }
    if (result.exitCode !== 0 || result.error) {
      return {
        wslExe,
        distributions: [],
        unavailableReason: `WSL distribution detection failed: ${commandFailureDetail(result)}`,
        publicUnavailableReason: this.publicWslDetectionFailure(result)
      }
    }
    try {
      return { wslExe, distributions: parseWslDistributions(result.stdout) }
    } catch (error) {
      return {
        wslExe,
        distributions: [],
        unavailableReason: `WSL distribution detection failed: ${printable(
          error instanceof Error ? error.message : String(error)
        )}`,
        publicUnavailableReason:
          'WSL returned malformed distribution data. Refresh profiles to try again.'
      }
    }
  }

  private publicWslDetectionFailure(result: WindowsTerminalCommandResult): string {
    const detail = commandFailureDetail(result)
    const stableCode = detail.match(
      /\b(?:WSL_E_[A-Z0-9_]+|HCS_E_[A-Z0-9_]+|ERROR_[A-Z0-9_]+|E_[A-Z0-9_]+|0x[0-9A-F]+)\b/i
    )?.[0]
    return stableCode
      ? `WSL distribution detection failed (${stableCode}). Refresh profiles to try again.`
      : 'WSL distribution detection failed. Refresh profiles to try again.'
  }

  private async resolveWsl(
    request: WindowsTerminalProfileResolveRequest
  ): Promise<ResolvedWindowsTerminalProfile> {
    const distribution = request.profileId.slice(WSL_PROFILE_PREFIX.length)
    if (!validWslDistributionName(distribution)) {
      throw new WindowsTerminalProfileError(
        'malformed-profile-id',
        request.profileId,
        `Malformed WSL terminal profile “${printable(request.profileId, 120)}”. Refresh terminal profiles and choose an installed distribution.`
      )
    }

    const enumeration = await this.enumerateWsl()
    if (!enumeration.wslExe || enumeration.unavailableReason) {
      throw new WindowsTerminalProfileError(
        'wsl-enumeration-failed',
        request.profileId,
        enumeration.unavailableReason || 'WSL is unavailable.'
      )
    }
    if (!enumeration.distributions.includes(distribution)) {
      throw new WindowsTerminalProfileError(
        'wsl-distro-missing',
        request.profileId,
        `WSL distribution “${printable(distribution, 120)}” is no longer installed. Refresh terminal profiles or choose another profile.`
      )
    }

    if (typeof request.cwd !== 'string' || !path.win32.isAbsolute(request.cwd)) {
      throw new WindowsTerminalProfileError(
        'wsl-cwd-invalid',
        request.profileId,
        `WSL profile “${printable(distribution, 120)}” cannot use the requested directory because it is not an existing absolute Windows directory.`
      )
    }
    const cwdKind = await this.runtime.pathKind(request.cwd)
    if (cwdKind !== 'directory') {
      throw new WindowsTerminalProfileError(
        'wsl-cwd-invalid',
        request.profileId,
        cwdKind === 'unknown'
          ? `WSL profile “${printable(distribution, 120)}” could not verify the requested Windows directory. Check directory access and try again.`
          : `WSL profile “${printable(distribution, 120)}” cannot use the requested directory because it is not an existing absolute Windows directory.`
      )
    }

    let translation: WindowsTerminalCommandResult
    try {
      translation = await this.runtime.execFile(enumeration.wslExe, [
        '-d',
        distribution,
        '--exec',
        // Direct execvpe lookup inside the exact selected distribution: standard distros normally
        // install /usr/bin/wslpath, while appliance distros such as docker-desktop expose /bin/wslpath.
        // The program name is a core constant (not profile/user input) and no shell is involved.
        'wslpath',
        '-a',
        '-u',
        request.cwd
      ])
    } catch {
      throw new WindowsTerminalProfileError(
        'wsl-cwd-translation-failed',
        request.profileId,
        `WSL profile “${printable(distribution, 120)}” could not start working-directory translation. No fallback shell was opened.`
      )
    }
    if (translation.exitCode !== 0 || translation.error) {
      const detail = commandFailureDetail(translation)
      if (commandReportsMissingWslDistribution(translation)) {
        throw new WindowsTerminalProfileError(
          'wsl-distro-missing',
          request.profileId,
          `WSL distribution “${printable(distribution, 120)}” was removed before its working directory could be translated. Refresh terminal profiles or choose another profile.`
        )
      }
      throw new WindowsTerminalProfileError(
        'wsl-cwd-translation-failed',
        request.profileId,
        `WSL profile “${printable(distribution, 120)}” could not translate the requested Windows directory to a Linux working directory: ${detail}. No fallback shell was opened.`
      )
    }

    let linuxCwd: string
    try {
      linuxCwd = parseLinuxCwd(translation.stdout)
    } catch (error) {
      throw new WindowsTerminalProfileError(
        'wsl-cwd-output-invalid',
        request.profileId,
        `WSL profile “${printable(distribution, 120)}” returned an invalid working directory: ${printable(
          error instanceof Error ? error.message : String(error)
        )}. No fallback shell was opened.`
      )
    }

    return {
      profileId: request.profileId,
      label: `WSL: ${distribution}`,
      kind: 'wsl',
      shell: enumeration.wslExe,
      // WSL currently logs a failed `--cd` but still launches in `/` with exit code 0. Retain the
      // documented structured `--cd` launch shape, then independently chdir inside the exact
      // distro before replacing the guard with its configured default shell. The Linux cwd is a
      // positional argv value, never interpolated into the constant script.
      shellArgs: [
        '-d',
        distribution,
        '--cd',
        linuxCwd,
        '--exec',
        '/bin/sh',
        '-c',
        WSL_LAUNCH_CWD_GUARD,
        'nodeterm-wsl',
        linuxCwd
      ],
      cwd: request.cwd
    }
  }

  private async resolveCustom(
    request: WindowsTerminalProfileResolveRequest
  ): Promise<ResolvedWindowsTerminalProfile> {
    const configured = request.customExecutable
    if (configured === undefined || configured === '') {
      throw new WindowsTerminalProfileError(
        'custom-required',
        request.profileId,
        'The custom terminal profile needs an executable. Choose an executable in Settings → Shell.'
      )
    }
    if (
      typeof configured !== 'string' ||
      configured.trim() !== configured ||
      /[\u0000-\u001f\u007f"]/.test(configured)
    ) {
      throw new WindowsTerminalProfileError(
        'custom-invalid',
        request.profileId,
        'The custom terminal executable must be an unquoted executable name or absolute Windows path, without arguments.'
      )
    }

    let shell: string | null = null
    if (path.win32.isAbsolute(configured)) {
      const kind = await this.runtime.pathKind(configured)
      if (kind !== 'file') {
        throw new WindowsTerminalProfileError(
          'custom-invalid',
          request.profileId,
          kind === 'directory'
            ? 'The configured custom terminal path is a directory, not an executable.'
            : kind === 'missing'
              ? 'The configured custom terminal executable does not exist.'
              : 'The configured custom terminal executable could not be inspected. Check file access and try again.'
        )
      }
      shell = configured
    } else if (SAFE_BARE_EXECUTABLE.test(configured)) {
      let lookup: WindowsTerminalExecutableLookup
      try {
        lookup = await this.runtime.findExecutable(configured, [])
      } catch {
        throw new WindowsTerminalProfileError(
          'custom-invalid',
          request.profileId,
          'The configured custom terminal executable could not be detected on PATH. Check file access and try again.'
        )
      }
      const resolved = lookup.path
      const kind = resolved ? await this.runtime.pathKind(resolved) : 'missing'
      if (resolved && kind === 'file') shell = resolved
      if (!shell) {
        throw new WindowsTerminalProfileError(
          'custom-invalid',
          request.profileId,
          kind === 'unknown' || lookup.unknownProbe
            ? 'The configured custom terminal executable found on PATH could not be inspected. Check file access and try again.'
            : kind === 'directory' || lookup.nonFileProbe
              ? 'The configured custom terminal executable name resolves only to a directory, not an executable file.'
              : 'The configured custom terminal executable was not found on PATH.'
        )
      }
    } else {
      throw new WindowsTerminalProfileError(
        'custom-invalid',
        request.profileId,
        'The custom terminal executable must be a safe bare executable name or an absolute Windows path. Command-line arguments are not accepted.'
      )
    }

    return {
      profileId: request.profileId,
      label: `Custom: ${path.win32.basename(shell)}`,
      kind: 'custom',
      shell,
      shellArgs: [],
      cwd: request.cwd
    }
  }
}
