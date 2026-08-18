import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'

export const REPO_PREFIX_ENV = 'NT_WIRED_REPO_PREFIX'

/**
 * Environment for an app instance that may install managed hooks at boot.
 *
 * `NT_USER_DATA` only moves Electron's profile. The hook and agent-instruction installers use
 * `os.homedir()` plus XDG/agent-specific roots, so all of those inputs must describe the same
 * disposable home. In particular, Node on Windows consults USERPROFILE rather than HOME.
 */
export function isolatedAppEnv({
  baseEnv = process.env,
  home,
  userData,
  platform = process.platform,
}) {
  const path = platform === 'win32' ? win32 : posix
  const root = path.parse(home).root
  const homeDrive = platform === 'win32' ? root.replace(/[\\/]+$/, '') : ''
  const homePath = platform === 'win32' ? home.slice(homeDrive.length) || path.sep : home

  const env = {
    ...baseEnv,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: homeDrive,
    HOMEPATH: homePath,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TEMP: join(home, '.tmp'),
    TMP: join(home, '.tmp'),
    TMPDIR: join(home, '.tmp'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: join(home, '.runtime'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    GROK_HOME: join(home, '.grok'),
    KIMI_CODE_HOME: join(home, '.kimi-code'),
    NT_MULTI: '1',
    NT_USER_DATA: userData,
    // A live wiring gate has no reason to call the production telemetry endpoints.
    DO_NOT_TRACK: '1',
    NODETERM_TELEMETRY_DISABLED: '1',
  }
  // A parent dev shell can point these at a live renderer, API, or relay. The wiring gate must
  // exercise the built local app without inheriting an external control plane.
  delete env.ELECTRON_RENDERER_URL
  delete env.NODETERM_API_BASE
  delete env.NODETERM_RELAY_URL
  return env
}

export function createAppSandbox({
  baseEnv = process.env,
  tempDir = tmpdir(),
  platform = process.platform,
} = {}) {
  const root = mkdtempSync(join(tempDir, 'nt-wired-'))
  const home = join(root, 'home')
  const userData = join(root, 'user-data')
  const env = isolatedAppEnv({ baseEnv, home, userData, platform })
  for (const dir of [
    home,
    userData,
    env.APPDATA,
    env.LOCALAPPDATA,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_STATE_HOME,
    env.XDG_RUNTIME_DIR,
    env.TEMP,
  ]) {
    if (dir) mkdirSync(dir, { recursive: true })
  }
  return {
    root,
    home,
    userData,
    env,
  }
}

/** Exact real-home files that app bootstrap is allowed to merge or replace. */
export function managedConfigTargets({
  home = homedir(),
  env = process.env,
  platform = process.platform,
} = {}) {
  const path = platform === 'win32' ? win32 : posix
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const xdgConfig = xdg && path.isAbsolute(xdg) ? xdg : join(home, '.config')
  const grok = env.GROK_HOME?.trim()
  const grokHome = grok && path.isAbsolute(grok) ? grok : join(home, '.grok')
  const hookDir = join(home, '.nodeterm', 'agent-hooks')
  const sharedModeDir = join(home, '.nodeterm', 'shared')

  return [...new Set([
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'skills', 'get-linked-context', 'SKILL.md'),
    join(home, '.claude', 'skills', 'manage-nodeterm-canvas', 'SKILL.md'),
    join(home, '.codex', 'hooks.json'),
    join(home, '.codex', 'config.toml'),
    join(home, '.codex', 'AGENTS.md'),
    join(home, '.gemini', 'settings.json'),
    join(home, '.gemini', 'GEMINI.md'),
    join(grokHome, 'hooks', 'nodeterm-status.json'),
    join(xdgConfig, 'opencode', 'plugins', 'nodeterm-status.js'),
    join(xdgConfig, 'opencode', 'AGENTS.md'),
    ...[
      'kids-mode.json',
      'kids-mode.credential.json',
      'school-mode.json',
      'school-mode.credential.json',
    ].map((name) => join(sharedModeDir, name)),
    ...['claude.sh', 'codex.sh', 'gemini.sh', 'grok.sh'].map((name) =>
      join(hookDir, name),
    ),
  ])].sort()
}

function fingerprint(target) {
  try {
    const stat = lstatSync(target)
    if (stat.isDirectory()) {
      return `directory:${stat.mode}:${stat.size}:${stat.mtimeMs}`
    }
    const bytes = readFileSync(target)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const link = stat.isSymbolicLink() ? `:${readlinkSync(target)}` : ''
    return `file:${stat.mode}:${bytes.length}:${digest}${link}`
  } catch (error) {
    if (error?.code === 'ENOENT') return 'absent'
    // A failed read is not evidence that the target is absent. Refuse to launch when the
    // sentinel cannot establish a before-value instead of making an unverifiable safety claim.
    throw new Error(`could not fingerprint managed config ${target}: ${error.message}`, {
      cause: error,
    })
  }
}


/**
 * The subset of `managedConfigTargets` that a real boot is expected to CREATE.
 *
 * These are two different questions and they were being answered by one list. `managedConfigTargets`
 * is an allowlist — "files app bootstrap is ALLOWED to merge or replace" — and the capture harness
 * fingerprints it to prove the operator's real home came back unchanged, where `absent` is a
 * perfectly good fingerprint. The wiring gate reads the same list as "files boot MUST have written"
 * and fails on `absent`.
 *
 * That held until `ad3354e0` added the four shared School/Kids records to the allowlist for the
 * capture harness. Boot does not write those, by design: `core/shared-record-watch.ts` exists
 * precisely because the shared directory may be ABSENT at boot and has to become watchable as it
 * appears, and a record is written when a mode is first set. So the addition was correct for the
 * question it was asked and silently made the other question wrong — the wiring gate went red on
 * four files that are supposed to be missing.
 *
 * Anything a boot genuinely must produce belongs here. Anything boot may merely touch belongs in
 * `managedConfigTargets` and nowhere else.
 */
export function bootCreatedConfigTargets(options = {}) {
  const home = options.home ?? homedir()
  // Built with the same `join` managedConfigTargets uses, so the comparison is exact. Do NOT
  // rebuild these with a platform-selected path module: managedConfigTargets accepts a `platform`
  // option but only consults it for isAbsolute, joining with the default separator regardless — so
  // a posix-joined needle never matches a win32-joined haystack, and the filter silently drops
  // nothing while looking correct.
  const sharedModeRecords = new Set(
    [
      'kids-mode.json',
      'kids-mode.credential.json',
      'school-mode.json',
      'school-mode.credential.json',
    ].map((name) => join(home, '.nodeterm', 'shared', name)),
  )
  return managedConfigTargets(options).filter((target) => !sharedModeRecords.has(target))
}
export function captureManagedConfigSentinel(options = {}) {
  return Object.fromEntries(
    managedConfigTargets(options).map((target) => [target, fingerprint(target)]),
  )
}

export function changedManagedConfigTargets(before, after) {
  const targets = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...targets].filter((target) => before[target] !== after[target]).sort()
}

export function assertManagedConfigUnchanged(before, after) {
  const changed = changedManagedConfigTargets(before, after)
  if (changed.length) {
    throw new Error(
      `managed config changed while the wiring gate ran:\n${changed.map((p) => `  - ${p}`).join('\n')}`,
    )
  }
}

export function repoPrefix(root, platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix
  return root.endsWith(path.sep) ? root : `${root}${path.sep}`
}

/**
 * PowerShell source shared by production and the inert fixture gate.
 *
 * `processQuery` is overridden only by the gate so it can supply PSCustomObjects without ever
 * touching CIM or Stop-Process. The predicate and env-delivered needle are otherwise identical.
 */
export function repoElectronPidPowerShell(
  processQuery = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`,
) {
  return `
$repoPrefix = [Environment]::GetEnvironmentVariable('${REPO_PREFIX_ENV}')
if ([String]::IsNullOrWhiteSpace($repoPrefix)) { throw '${REPO_PREFIX_ENV} is empty' }
$processes = @(${processQuery})
$processes |
  Where-Object {
    $_.Name -eq 'electron.exe' -and
    $null -ne $_.CommandLine -and
    ([string]$_.CommandLine).IndexOf($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } |
  ForEach-Object { [Console]::Out.WriteLine([string]$_.ProcessId) }
`
}

/** PIDs of Electron processes whose command line literally contains THIS repo directory. */
export function repoElectronPids({
  root,
  platform = process.platform,
  processQuery,
  extraEnv = {},
  run = execFileSync,
} = {}) {
  if (platform !== 'win32') return []
  if (!root) throw new Error('repoElectronPids requires a repo root')

  const stdout = run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', repoElectronPidPowerShell(processQuery)],
    {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...extraEnv,
        [REPO_PREFIX_ENV]: repoPrefix(root, platform),
      },
    },
  )

  const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (lines.some((line) => !/^\d+$/.test(line))) {
    throw new Error(`PowerShell returned a non-PID row: ${JSON.stringify(lines)}`)
  }
  return lines.map(Number)
}
