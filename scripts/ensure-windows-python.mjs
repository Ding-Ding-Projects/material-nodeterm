// Ensure node-gyp has a supported 64-bit Python before npm starts dependency lifecycle scripts.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO_ROOT, 'dependencies.manifest.json')
const ERROR_ACCESS_DENIED = 5
const REBOOT_REQUIRED = 3010
const MINIMUM_MINOR = 10
const MAXIMUM_MINOR = 14

export function defaultRun(program, args, options = {}) {
  return spawnSync(program, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    env: options.env ?? process.env,
    timeout: options.timeout
  })
}

function resultText(result) {
  return [result?.stdout, result?.stderr]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .trim()
}

function validatedVersion(value) {
  if (typeof value !== 'string' || !/^3\.\d+\.\d+$/.test(value)) {
    throw new Error('python.version is missing or is not an exact Python 3 version')
  }
  const minor = Number(value.split('.')[1])
  if (minor < MINIMUM_MINOR || minor > MAXIMUM_MINOR) {
    throw new Error(`python.version must be supported by this tree (3.${MINIMUM_MINOR}-3.${MAXIMUM_MINOR})`)
  }
  return value
}

function validatedPackageId(value) {
  if (typeof value !== 'string' || !/^Python\.Python\.3\.\d+$/.test(value)) {
    throw new Error('python.winget.packageId is missing or unsafe')
  }
  return value
}

function validatedSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} is missing or is not a SHA-256 digest`)
  }
  return value.toLowerCase()
}

function validatedInstallerUrl(value, version, arch) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`python.windows.${arch}.url is not a valid URL`)
  }
  const suffix = arch === 'arm64' ? 'arm64' : 'amd64'
  const expectedPath = `/ftp/python/${version}/python-${version}-${suffix}.exe`
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'www.python.org' ||
    parsed.pathname.toLowerCase() !== expectedPath.toLowerCase()
  ) {
    throw new Error(`python.windows.${arch}.url is not the pinned official Python installer`)
  }
  return parsed.href
}

export function loadPythonManifest(path = MANIFEST, arch = process.arch) {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Windows Python bootstrap does not support Node architecture ${arch}`)
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const config = parsed.python
  if (!config || typeof config !== 'object') {
    throw new Error('dependencies.manifest.json has no python entry')
  }
  const version = validatedVersion(config.version)
  const installer = config.windows?.[arch]
  return {
    version,
    arch,
    wingetPackageId: validatedPackageId(config.winget?.packageId),
    installerUrl: validatedInstallerUrl(installer?.url, version, arch),
    installerSha256: validatedSha256(installer?.sha256, `python.windows.${arch}.sha256`)
  }
}

function defaultAdministratorStatus(run) {
  const script = [
    '$id=[Security.Principal.WindowsIdentity]::GetCurrent()',
    '$p=[Security.Principal.WindowsPrincipal]::new($id)',
    "if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){'elevated'}else{'standard'}"
  ].join(';')
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  if (result?.error || result?.status !== 0) return 'unknown'
  const answer = String(result.stdout).trim().toLowerCase()
  return answer === 'elevated' ? 'elevated' : answer === 'standard' ? 'standard' : 'unknown'
}

function pathPresent(path, fs) {
  try {
    fs.stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw new Error(`could not inspect ${path}: ${error.message}`)
  }
}

function supportedPython(program, prefixArgs, run, arch, expectedVersion = '', environment = process.env) {
  const probe = [
    'import json,platform,sys',
    "print(json.dumps({'executable':sys.executable,'major':sys.version_info[0],'minor':sys.version_info[1],'micro':sys.version_info[2],'bits':64 if sys.maxsize > 2**32 else 32,'machine':platform.machine().lower()}))"
  ].join(';')
  // Python Install Manager launch aliases auto-install by default when no runtime exists. A probe
  // must remain a probe: disable that behavior and bound it so /s cannot unexpectedly install or
  // hang before the pinned winget/SHA path gets control.
  const result = run(program, [...prefixArgs, '-I', '-B', '-c', probe], {
    env: { ...environment, PYTHON_MANAGER_AUTOMATIC_INSTALL: 'false' },
    timeout: 15_000
  })
  if (result?.error || result?.status !== 0) return null
  let answer
  try {
    answer = JSON.parse(String(result.stdout).trim())
  } catch {
    return null
  }
  const expectedParts = expectedVersion ? expectedVersion.split('.').map(Number) : null
  const expectedMachines = arch === 'arm64' ? ['arm64', 'aarch64'] : ['amd64', 'x86_64']
  if (
    answer?.major !== 3 ||
    !Number.isInteger(answer?.minor) ||
    answer.minor < MINIMUM_MINOR ||
    answer.minor > MAXIMUM_MINOR ||
    answer.bits !== 64 ||
    !expectedMachines.includes(answer.machine) ||
    (expectedParts &&
      (answer.major !== expectedParts[0] ||
        answer.minor !== expectedParts[1] ||
        answer.micro !== expectedParts[2])) ||
    typeof answer.executable !== 'string' ||
    !win32.isAbsolute(answer.executable)
  ) {
    return null
  }
  return answer.executable
}

function findSupportedPython(candidates, run, arch, environment) {
  const seen = new Set()
  for (const candidate of candidates) {
    const key = `${candidate.program.toLowerCase()}\0${candidate.prefixArgs.join('\0')}`
    if (seen.has(key)) continue
    seen.add(key)
    const executable = supportedPython(
      candidate.program,
      candidate.prefixArgs,
      run,
      arch,
      '',
      environment
    )
    if (executable) return executable
  }
  return null
}

function fileSha256(path, fs) {
  return createHash('sha256').update(fs.readFile(path)).digest('hex')
}

function successfulInstallerExit(result) {
  return !result?.error && (result?.status === 0 || result?.status === REBOOT_REQUIRED)
}

function emitFailure(report, lines) {
  report.error('')
  report.error('[FAILED] Python runtime for native builds')
  for (const line of lines) report.error(`  ${line}`)
}

function installerOptions(target) {
  return [
    '/quiet',
    'InstallAllUsers=0',
    `TargetDir=${target}`,
    'Include_launcher=0',
    'InstallLauncherAllUsers=0',
    'AssociateFiles=0',
    'Shortcuts=0',
    'PrependPath=0',
    'AppendPath=0',
    'Include_doc=0',
    'Include_test=0',
    'Include_tcltk=0',
    'Include_dev=1',
    'Include_exe=1',
    'Include_lib=1',
    'Include_pip=1',
    'Include_tools=1'
  ]
}

export function ensureWindowsPython(options = {}) {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const run = options.run ?? defaultRun
  const fs = options.fs ?? {
    mkdtemp: mkdtempSync,
    readFile: readFileSync,
    rm: rmSync,
    stat: statSync
  }
  const report = options.report ?? console
  const arch = options.arch ?? process.arch
  const localAppData = options.localAppData ?? environment.LOCALAPPDATA
  if (platform !== 'win32') return { code: 0, changed: false, pythonPath: '' }

  let config
  try {
    config = options.config ?? loadPythonManifest(options.manifestPath, arch)
    config = {
      version: validatedVersion(config.version),
      arch,
      wingetPackageId: validatedPackageId(config.wingetPackageId),
      installerUrl: validatedInstallerUrl(config.installerUrl, config.version, arch),
      installerSha256: validatedSha256(config.installerSha256, 'Python installer SHA-256')
    }
    if (
      typeof localAppData !== 'string' ||
      !win32.isAbsolute(localAppData) ||
      localAppData.includes('"')
    ) {
      throw new Error('LOCALAPPDATA is missing or is not an absolute Windows path')
    }
  } catch (error) {
    emitFailure(report, [
      'Dependency : supported 64-bit Python for node-gyp',
      `Source     : ${options.manifestPath ?? MANIFEST}`,
      `Error      : ${error.message}`
    ])
    return { code: 1, changed: false, pythonPath: '' }
  }

  const administratorStatus =
    typeof options.administratorStatus === 'function'
      ? options.administratorStatus()
      : options.administratorStatus ?? defaultAdministratorStatus(run)
  if (administratorStatus === 'elevated') {
    emitFailure(report, [
      'Dependency : npm project dependencies',
      'Constraint : per-user Python and repository lifecycle scripts must run as the normal user',
      'Source     : the current elevated command process',
      'Error      : close this Administrator prompt and rerun the root build command normally'
    ])
    return { code: ERROR_ACCESS_DENIED, changed: false, pythonPath: '' }
  }
  if (administratorStatus !== 'standard') {
    emitFailure(report, [
      'Dependency : supported 64-bit Python for node-gyp',
      'Constraint : the bootstrap must prove it is running under the normal user token',
      'Error      : could not determine whether this process is elevated; no installer was started'
    ])
    return { code: ERROR_ACCESS_DENIED, changed: false, pythonPath: '' }
  }

  const target = join(localAppData, 'nodeterm', 'toolchain', `python-${config.version}-${arch}`)
  const targetPython = join(target, 'python.exe')
  // Never launch bare py.exe/python.exe while probing. Current Windows aliases can install a
  // runtime or open Store UI, so a read-only probe would violate /s before the pinned path gets
  // control. Reuse only an explicit absolute interpreter outside WindowsApps or our pinned target.
  const explicitPython = environment.PYTHON ?? ''
  const defaultCandidates = [
    ...(win32.isAbsolute(explicitPython) && !/[\\/]WindowsApps[\\/]/i.test(explicitPython)
      ? [{ program: explicitPython, prefixArgs: [] }]
      : []),
    { program: targetPython, prefixArgs: [] }
  ]
  const candidates = options.pythonCandidates ?? defaultCandidates
  const existing = findSupportedPython(candidates, run, arch, environment)
  if (existing) {
    report.log(`  Found supported Python at ${existing} - nothing to install.`)
    return { code: 0, changed: false, pythonPath: existing }
  }

  const directOptions = installerOptions(target)
  const overrideOptions = directOptions
    .map((value) => (value.startsWith('TargetDir=') ? `TargetDir="${target}"` : value))
    .join(' ')
  const wingetArgs = [
    'install',
    '--id',
    config.wingetPackageId,
    '--exact',
    '--version',
    config.version,
    '--source',
    'winget',
    '--architecture',
    arch,
    '--scope',
    'user',
    '--silent',
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity',
    '--override',
    overrideOptions
  ]
  report.log('  Supported Python was not found. Trying the manifest-selected per-user winget package...')
  const wingetResult = run('winget.exe', wingetArgs)
  let installResult = wingetResult
  let action = `winget.exe ${wingetArgs.join(' ')}`

  if (!successfulInstallerExit(wingetResult)) {
    const why =
      wingetResult?.error?.message || resultText(wingetResult) || `exit code ${wingetResult?.status}`
    report.log(`  winget was unavailable or failed (${why}) - using the SHA-pinned Python installer.`)
    let staging = ''
    try {
      staging = fs.mkdtemp(join(tmpdir(), 'nodeterm-python-'))
      const installer = join(staging, `python-${config.version}-${arch}.exe`)
      const downloadScript = [
        "$ProgressPreference='SilentlyContinue'",
        'Invoke-WebRequest -UseBasicParsing -Uri $env:NODETERM_PYTHON_INSTALLER_URL -OutFile $env:NODETERM_PYTHON_INSTALLER_FILE'
      ].join(';')
      const downloadResult = run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', downloadScript],
        {
          env: {
            ...environment,
            NODETERM_PYTHON_INSTALLER_URL: config.installerUrl,
            NODETERM_PYTHON_INSTALLER_FILE: installer
          }
        }
      )
      if (downloadResult?.error || downloadResult?.status !== 0) {
        installResult = downloadResult
        action = `download ${config.installerUrl}`
      } else {
        const actualSha256 = fileSha256(installer, fs)
        if (actualSha256 !== config.installerSha256) {
          installResult = {
            status: 1,
            stderr:
              `downloaded Python installer hashed to ${actualSha256}; ` +
              `expected ${config.installerSha256}`
          }
          action = `verify ${config.installerUrl}`
        } else {
          report.log(`  Python installer SHA-256 verified: ${actualSha256}`)
          installResult = run(installer, directOptions)
          action = `${installer} ${directOptions.join(' ')}`
        }
      }
    } catch (error) {
      installResult = { status: 1, error }
      action = `bootstrap ${config.installerUrl}`
    } finally {
      if (staging) fs.rm(staging, { recursive: true, force: true })
    }
  }

  if (!successfulInstallerExit(installResult)) {
    const detail =
      installResult?.error?.message || resultText(installResult) || `exit code ${installResult?.status}`
    emitFailure(report, [
      'Dependency : supported 64-bit Python for node-gyp',
      `Constraint : Python ${config.version}, per-user ${arch} installation`,
      'Source     : Python Software Foundation',
      `Error      : installer failed (${detail})`,
      `Command    : ${action}`
    ])
    return { code: installResult?.status || 1, changed: false, pythonPath: '' }
  }
  if (installResult.status === REBOOT_REQUIRED) {
    emitFailure(report, [
      'Dependency : supported 64-bit Python for node-gyp',
      `Constraint : Python ${config.version}, per-user ${arch} installation`,
      'Error      : installation completed with exit code 3010; restart Windows and rerun the build'
    ])
    return { code: REBOOT_REQUIRED, changed: true, pythonPath: '' }
  }

  // Exit zero is not evidence that the exact requested interpreter is usable. Probe the pinned
  // target in isolated mode, and export that absolute executable to node-gyp through PYTHON.
  let installed = null
  try {
    if (pathPresent(targetPython, fs)) {
      installed = supportedPython(targetPython, [], run, arch, config.version, environment)
    }
  } catch (error) {
    emitFailure(report, [
      'Dependency : supported 64-bit Python for node-gyp',
      `Source     : ${targetPython}`,
      `Error      : installer exited successfully, but verification failed: ${error.message}`
    ])
    return { code: 1, changed: false, pythonPath: '' }
  }
  if (!installed) {
    emitFailure(report, [
      'Dependency : supported 64-bit Python for node-gyp',
      `Constraint : Python ${config.version}, per-user ${arch} installation`,
      `Source     : ${targetPython}`,
      'Error      : installer exited successfully, but the pinned interpreter did not pass its probe'
    ])
    return { code: 1, changed: false, pythonPath: '' }
  }
  report.log(`  Installed and verified Python at ${installed}.`)
  return { code: 0, changed: true, pythonPath: installed }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && resolve(fileURLToPath(import.meta.url)).toLowerCase() === invokedPath.toLowerCase()) {
  const resultIndex = process.argv.indexOf('--result-file')
  const resultFile = resultIndex >= 0 ? process.argv[resultIndex + 1] : ''
  const result = ensureWindowsPython()
  if (result.code === 0) {
    try {
      if (!resultFile || !win32.isAbsolute(resultFile)) {
        throw new Error('--result-file must name an absolute Windows path')
      }
      writeFileSync(resultFile, `${result.pythonPath}\r\n`, 'utf8')
    } catch (error) {
      emitFailure(console, [
        'Dependency : PYTHON environment handoff',
        `Error      : ${error.message}`
      ])
      process.exitCode = 1
    }
  }
  if (process.exitCode !== 1) process.exitCode = result.code
}
