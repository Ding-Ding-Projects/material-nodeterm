// Ensure the Windows native-module toolchain exists before npm reaches electron-rebuild.
//
// Node can be installed per-user, but Visual Studio Build Tools and changes to an existing
// Visual Studio instance are machine-wide. Microsoft's quiet/passive installer modes require an
// already-elevated process; they cannot delegate through UAC. This script therefore never tries to
// manufacture elevation. It installs automatically when the caller is already elevated and exits
// with ERROR_ACCESS_DENIED otherwise, before starting either installer. That keeps /s genuinely
// prompt-free and makes the privilege boundary explicit instead of hanging behind an invisible UAC
// prompt in automation.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO_ROOT, 'dependencies.manifest.json')
const ERROR_ACCESS_DENIED = 5
const REBOOT_REQUIRED = 3010

export function defaultRun(program, args, options = {}) {
  return spawnSync(program, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
    env: options.env ?? process.env
  })
}

function resultText(result) {
  return [result?.stdout, result?.stderr]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .trim()
}

function validatedId(value, label) {
  // These values become installer argv entries. A strict closed alphabet keeps a hand-edited
  // manifest value data, never another bootstrapper option.
  if (typeof value !== 'string' || !/^Microsoft\.VisualStudio\.[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${label} is missing or is not a safe Visual Studio identifier`)
  }
  return value
}

function validatedSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} is missing or is not a SHA-256 digest`)
  }
  return value.toLowerCase()
}

function validatedBootstrapperUrl(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('visualStudioBuildTools.bootstrapper.url is not a valid URL')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'download.visualstudio.microsoft.com' ||
    !parsed.pathname.toLowerCase().endsWith('/vs_buildtools.exe')
  ) {
    throw new Error('visualStudioBuildTools.bootstrapper.url is not an official Microsoft HTTPS URL')
  }
  return parsed.href
}

function validatedArchitectureConfig(value, arch) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.componentIds)) {
    throw new Error(`visualStudioBuildTools.architectures.${arch} is missing`)
  }
  const componentIds = value.componentIds.map((id, index) =>
    validatedId(id, `visualStudioBuildTools.architectures.${arch}.componentIds[${index}]`)
  )
  const expectedLibraries = arch === 'arm64' ? ['x86', 'x64', 'arm64'] : ['x86', 'x64']
  if (
    !Array.isArray(value.libraryArchitectures) ||
    value.libraryArchitectures.length !== expectedLibraries.length ||
    !expectedLibraries.every((libraryArch) => value.libraryArchitectures.includes(libraryArch))
  ) {
    throw new Error(
      `visualStudioBuildTools.architectures.${arch}.libraryArchitectures must be ` +
        expectedLibraries.join(', ')
    )
  }
  if (componentIds.length === 0) {
    throw new Error(`visualStudioBuildTools.architectures.${arch}.componentIds is empty`)
  }
  return { componentIds, libraryArchitectures: expectedLibraries }
}

export function loadBuildToolchainManifest(path = MANIFEST, arch = process.arch) {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Windows C++ bootstrap does not support Node architecture ${arch}`)
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const config = parsed.visualStudioBuildTools
  if (!config || typeof config !== 'object') {
    throw new Error('dependencies.manifest.json has no visualStudioBuildTools entry')
  }
  return {
    workloadId: validatedId(config.workloadId, 'visualStudioBuildTools.workloadId'),
    ...validatedArchitectureConfig(config.architectures?.[arch], arch),
    bootstrapperUrl: validatedBootstrapperUrl(config.bootstrapper?.url),
    bootstrapperSha256: validatedSha256(
      config.bootstrapper?.sha256,
      'visualStudioBuildTools.bootstrapper.sha256'
    )
  }
}

function defaultProgramFilesX86() {
  return process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
}

function pathState(path, fs) {
  try {
    fs.stat(path)
    return 'present'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw new Error(`could not inspect ${path}: ${error.message}`)
  }
}

function directoryEntries(path, fs) {
  try {
    return fs.readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`could not read ${path}: ${error.message}`)
  }
}

export function spectreLibrariesPresent(toolsetPath, fs, libraryArchitectures) {
  // An empty directory can be left by an interrupted install. node-pty targets both Win32 and x64,
  // so require at least one real import/static library for each architecture before declaring the
  // toolset usable.
  return libraryArchitectures.every((arch) => {
    const entries = directoryEntries(join(toolsetPath, 'lib', 'spectre', arch), fs)
    return entries?.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.lib'))
  })
}

function defaultToolsetVersion(installationPath, fs) {
  const file = join(
    installationPath,
    'VC',
    'Auxiliary',
    'Build',
    'Microsoft.VCToolsVersion.default.txt'
  )
  try {
    const version = String(fs.readFile(file, 'utf8')).trim()
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`could not read ${file}: ${error.message}`)
  }
}

function visualStudioTools(instance, fs, requiredComponentPaths, libraryArchitectures) {
  const installationPath = instance?.installationPath
  if (typeof installationPath !== 'string' || !win32.isAbsolute(installationPath)) return null

  const msvcRoot = join(installationPath, 'VC', 'Tools', 'MSVC')
  const toolsetEntries = directoryEntries(msvcRoot, fs)
  const toolsets = toolsetEntries
    ? toolsetEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          version: entry.name,
          path: join(msvcRoot, entry.name),
          hasSpectre: spectreLibrariesPresent(
            join(msvcRoot, entry.name),
            fs,
            libraryArchitectures
          )
        }))
    : []
  const defaultVersion = defaultToolsetVersion(installationPath, fs)

  return {
    installationPath,
    installationVersion:
      typeof instance.installationVersion === 'string' ? instance.installationVersion : '0',
    displayName: instance.displayName || installationPath,
    hasRequiredComponents: requiredComponentPaths.has(installationPath.toLowerCase()),
    defaultToolsetVersion: defaultVersion,
    toolsets
  }
}

function compareVersionsNewestFirst(a, b) {
  return b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' })
}

function selectedCxxToolset(instances) {
  const candidates = instances
    .filter((instance) => instance.toolsets.length > 0)
    .map((instance) => {
      const toolset =
        instance.toolsets.find((candidate) => candidate.version === instance.defaultToolsetVersion) ??
        [...instance.toolsets].sort((a, b) => compareVersionsNewestFirst(a.version, b.version))[0]
      return { instance, toolset }
    })
    .filter(({ instance, toolset }) => instance.hasRequiredComponents && toolset.hasSpectre)
  candidates.sort(
    (a, b) =>
      compareVersionsNewestFirst(a.instance.installationVersion, b.instance.installationVersion) ||
      compareVersionsNewestFirst(a.toolset.version, b.toolset.version)
  )
  return candidates[0] ?? null
}

function writeToolchainSelection(resultFile, selection, report) {
  if (!resultFile) return true
  const installationPath = selection?.instance?.installationPath
  if (typeof installationPath !== 'string' || !win32.isAbsolute(installationPath)) {
    emitFailure(report, [
      'Dependency : selected Visual Studio 2022 installation',
      'Constraint : a compatible absolute installation path is required by node-gyp',
      'Source     : Visual Studio discovery and Spectre component validation',
      'Error      : the compatible toolset selection did not include an absolute installation path'
    ])
    return false
  }
  try {
    writeFileSync(resultFile, `${installationPath}\r\n`, 'utf8')
    return true
  } catch (error) {
    emitFailure(report, [
      'Dependency : selected Visual Studio 2022 installation handoff',
      'Constraint : the normal user process must pass the validated path to node-gyp',
      `Source     : ${resultFile}`,
      `Error      : could not write the selection result: ${error.message}`
    ])
    return false
  }
}

function discoverInstances({
  programFilesX86,
  run,
  fs,
  requiredComponentIds,
  libraryArchitectures
}) {
  const vswhere = join(
    programFilesX86,
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  )
  if (pathState(vswhere, fs) === 'missing') {
    return { vswhere, instances: [], installerPresent: false }
  }

  // Omitting -all is deliberate: vswhere then excludes incomplete/error-state instances instead
  // of letting a half-installed product satisfy the build contract.
  const baseArgs = ['-products', '*', '-format', 'json', '-utf8']
  const enumerate = (args, purpose) => {
    const result = run(vswhere, args)
    if (result?.error || result?.status !== 0) {
      const detail = result?.error?.message || resultText(result) || `exit code ${result?.status}`
      throw new Error(`vswhere could not ${purpose}: ${detail}`)
    }
    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch (error) {
      throw new Error(`vswhere returned invalid JSON while trying to ${purpose}: ${error.message}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`vswhere returned JSON that was not an array while trying to ${purpose}`)
    }
    return parsed
  }
  const raw = enumerate(baseArgs, 'enumerate Visual Studio instances')
  // Real Spectre files alone do not prove MSBuild/the Windows SDK are present. vswhere's
  // multiple -requires values use all-components semantics by default, so the workload and every
  // architecture-specific Spectre component must belong to the same installation.
  const withRequiredComponents = enumerate(
    [...baseArgs, '-requires', ...requiredComponentIds],
    `find instances containing all required components: ${requiredComponentIds.join(', ')}`
  )
  const requiredComponentPaths = new Set(
    withRequiredComponents
      .map((instance) => instance?.installationPath)
      .filter((path) => typeof path === 'string')
      .map((path) => path.toLowerCase())
  )

  return {
    vswhere,
    installerPresent: true,
    instances: raw
      // The selected node-gyp version is pinned to Visual Studio 2022 below. Older instances are
      // not safe modify targets, while Visual Studio 2026 is kept separate so the 2022 override,
      // component proof, and installation path cannot disagree.
      .filter((instance) => /^17\./.test(String(instance?.installationVersion ?? '')))
      .map((instance) =>
        visualStudioTools(instance, fs, requiredComponentPaths, libraryArchitectures)
      )
      .filter(Boolean)
      .sort((a, b) => compareVersionsNewestFirst(a.installationVersion, b.installationVersion))
  }
}

export function activeVisualStudioSpectreComplaints(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return []
  const arch = options.arch ?? process.arch
  const fs = options.fs ?? { readFile: readFileSync, readdir: readdirSync }
  const vcInstallDir = options.vcInstallDir ?? process.env.VCINSTALLDIR
  if (!vcInstallDir || !win32.isAbsolute(vcInstallDir)) {
    return ['VCINSTALLDIR does not identify the Visual Studio instance selected by the bootstrap']
  }
  const installationPath = win32.resolve(vcInstallDir, '..')
  const defaultVersion = defaultToolsetVersion(installationPath, fs)
  if (!defaultVersion) {
    return [`${installationPath} has no readable default MSVC toolset version`]
  }
  const toolsetPath = join(installationPath, 'VC', 'Tools', 'MSVC', defaultVersion)
  const libraryArchitectures = arch === 'arm64' ? ['x86', 'x64', 'arm64'] : ['x86', 'x64']
  if (!spectreLibrariesPresent(toolsetPath, fs, libraryArchitectures)) {
    return [
      `${installationPath} default toolset ${defaultVersion} has no real Spectre .lib files for ` +
        libraryArchitectures.join(', ')
    ]
  }
  return []
}

function defaultAdministratorStatus(run, systemPowerShell) {
  const script = [
    '$id=[Security.Principal.WindowsIdentity]::GetCurrent()',
    '$p=[Security.Principal.WindowsPrincipal]::new($id)',
    "if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){'elevated'}else{'standard'}"
  ].join(';')
  const result = run(systemPowerShell, [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ])
  if (result?.error || result?.status !== 0) return 'unknown'
  const answer = String(result.stdout).trim().toLowerCase()
  return answer === 'elevated' ? 'elevated' : answer === 'standard' ? 'standard' : 'unknown'
}

function successfulInstallerExit(result) {
  return !result?.error && (result?.status === 0 || result?.status === REBOOT_REQUIRED)
}

function fileSha256(path, fs) {
  return createHash('sha256').update(fs.readFile(path)).digest('hex')
}

function emitFailure(report, lines) {
  report.error('')
  report.error('[FAILED] Visual Studio C++ build toolchain')
  for (const line of lines) report.error(`  ${line}`)
}

/**
 * Install the C++ workload/Spectre libraries through injectable process and filesystem seams.
 * The seams are intentional: the test runs the complete selection/recheck behavior without ever
 * modifying the developer's real Visual Studio installation.
 */
export function ensureWindowsBuildToolchain(options = {}) {
  const platform = options.platform ?? process.platform
  const silent = options.silent ?? false
  const run = options.run ?? defaultRun
  const fs = options.fs ?? {
    mkdtemp: mkdtempSync,
    readFile: readFileSync,
    readdir: readdirSync,
    rm: rmSync,
    stat: statSync
  }
  const report = options.report ?? console
  const arch = options.arch ?? process.arch
  const programFilesX86 = options.programFilesX86 ?? defaultProgramFilesX86()
  const windowsDirectory = options.windowsDirectory ?? process.env.WINDIR ?? 'C:\\Windows'
  const systemPowerShell = join(
    windowsDirectory,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  // Elevated downloads must never land in the normal user's TEMP. A medium-integrity process can
  // replace files there after hash verification and before spawn. Program Files is administrator-
  // writable only and gives the unique staging directory a protected parent.
  const secureStagingRoot = options.secureStagingRoot ?? programFilesX86
  const nodePath = options.nodePath ?? process.execPath
  const helperPath = options.helperPath ?? fileURLToPath(import.meta.url)
  const elevatedToolchainOnly = options.elevatedToolchainOnly ?? false
  const resultFile = options.resultFile
  let config

  if (platform !== 'win32') {
    report.log('  Non-Windows host - Visual Studio build toolchain is not applicable.')
    return { code: 0, changed: false }
  }

  try {
    config = options.config ?? loadBuildToolchainManifest(options.manifestPath, arch)
    config = {
      workloadId: validatedId(config.workloadId, 'C++ workload id'),
      ...validatedArchitectureConfig(
        {
          componentIds: config.componentIds,
          libraryArchitectures: config.libraryArchitectures
        },
        arch
      ),
      bootstrapperUrl: validatedBootstrapperUrl(config.bootstrapperUrl),
      bootstrapperSha256: validatedSha256(config.bootstrapperSha256, 'bootstrapper SHA-256')
    }
  } catch (error) {
    emitFailure(report, [
      `Dependency : MSVC v143 Spectre-mitigated libraries for ${arch} Node`,
      'Constraint : safe component identifiers in dependencies.manifest.json',
      `Source     : ${options.manifestPath ?? MANIFEST}`,
      `Error      : ${error.message}`
    ])
    return { code: 1, changed: false }
  }

  let discovery
  try {
    discovery = discoverInstances({
      programFilesX86,
      run,
      fs,
      requiredComponentIds: [config.workloadId, ...config.componentIds],
      libraryArchitectures: config.libraryArchitectures
    })
  } catch (error) {
    emitFailure(report, [
      'Dependency : Visual Studio 2022 C++ build tools',
      'Constraint : installed instances must be discoverable before they can be modified safely',
      `Source     : ${join(programFilesX86, 'Microsoft Visual Studio', 'Installer')}`,
      `Error      : ${error.message}`
    ])
    return { code: 1, changed: false }
  }

  const administratorStatus =
    typeof options.administratorStatus === 'function'
      ? options.administratorStatus()
      : options.administratorStatus ?? defaultAdministratorStatus(run, systemPowerShell)
  const selectedCxx = selectedCxxToolset(discovery.instances)
  if (administratorStatus === 'elevated' && !elevatedToolchainOnly) {
    emitFailure(report, [
      'Dependency : npm project dependencies',
      'Constraint : the root bootstrap and repository lifecycle scripts must run as the normal user',
      'Source     : the current elevated command process',
      'Error      : no installer was started. Close this Administrator prompt, rerun the root build',
      '             normally, and use only its printed --elevated-toolchain-only helper command.'
    ])
    return { code: ERROR_ACCESS_DENIED, changed: false }
  }
  if (selectedCxx) {
    if (!writeToolchainSelection(resultFile, selectedCxx, report)) {
      return { code: 1, changed: false }
    }
    report.log(
      `  Found compatible Spectre-mitigated MSVC libraries in ${selectedCxx.toolset.version} at ${selectedCxx.instance.installationPath} - nothing to install.`
    )
    return { code: 0, changed: false }
  }

  if (administratorStatus !== 'elevated') {
    const reason =
      administratorStatus === 'standard'
        ? "Microsoft's quiet Visual Studio installer requires an elevated caller"
        : 'the script could not determine whether this process is elevated'
    emitFailure(report, [
      `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
      `Constraint : ${config.componentIds.join(', ')}`,
      'Source     : Microsoft Visual Studio Installer',
      `Error      : ${reason}. No installer was started, so silent mode cannot be trapped`,
      '             behind a UAC prompt. Open an Administrator Command Prompt and run only:',
      `             "${nodePath}" "${helperPath}" --silent --elevated-toolchain-only`,
      '             Then close that elevated prompt and rerun the build from a normal prompt;',
      '             npm and repository lifecycle scripts must never run as Administrator.'
    ])
    return { code: ERROR_ACCESS_DENIED, changed: false }
  }

  const uiFlag = silent ? '--quiet' : '--passive'
  let installResult
  let action

  if (discovery.instances.length > 0) {
    // Prefer the newest C++-capable instance reported by vswhere. If Visual Studio exists but has
    // no C++ tools yet, adding the workload to that instance is smaller than installing a second
    // product beside it.
    const target = selectedCxx?.instance ?? discovery.instances[0]
    const setup = join(
      programFilesX86,
      'Microsoft Visual Studio',
      'Installer',
      'setup.exe'
    )
    let setupState
    try {
      setupState = pathState(setup, fs)
    } catch (error) {
      emitFailure(report, [
        `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
        `Constraint : ${config.componentIds.join(', ')}`,
        `Source     : ${setup}`,
        `Error      : ${error.message}`
      ])
      return { code: 1, changed: false }
    }
    if (setupState === 'missing') {
      emitFailure(report, [
        `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
        `Constraint : ${config.componentIds.join(', ')}`,
        `Source     : ${setup}`,
        'Error      : Visual Studio is installed but setup.exe is missing; refusing to guess an installer'
      ])
      return { code: 1, changed: false }
    }

    // Re-adding an installed workload is idempotent. Always naming it closes the partial-instance
    // case where VC\Tools\MSVC exists but MSBuild or a Windows SDK does not.
    const addArgs = ['--add', config.workloadId, '--includeRecommended']
    for (const componentId of config.componentIds) addArgs.push('--add', componentId)
    const args = [
      'modify',
      '--installPath',
      target.installationPath,
      ...addArgs,
      uiFlag,
      '--norestart'
    ]
    report.log(`  Adding the required component to ${target.displayName}...`)
    installResult = run(setup, args)
    action = `${setup} ${args.join(' ')}`
  } else {
    // Do not execute bare winget.exe from an inherited, user-writable PATH under elevation. The
    // exact Microsoft bootstrapper is already URL/SHA-pinned, so download it with the absolute
    // inbox PowerShell and stage it beneath protected Program Files before hashing and execution.
    report.log('  Visual Studio C++ Build Tools not found. Using the SHA-pinned Microsoft bootstrapper...')
    let staging = ''
    try {
      staging = fs.mkdtemp(join(secureStagingRoot, 'nodeterm-vs-buildtools-'))
      const bootstrapper = join(staging, 'vs_BuildTools.exe')
      const downloadScript = [
        "$ProgressPreference='SilentlyContinue'",
        'Invoke-WebRequest -UseBasicParsing -Uri $env:NODETERM_VS_BOOTSTRAPPER_URL -OutFile $env:NODETERM_VS_BOOTSTRAPPER_FILE'
      ].join(';')
      const downloadResult = run(
        systemPowerShell,
        ['-NoProfile', '-NonInteractive', '-Command', downloadScript],
        {
          env: {
            ...process.env,
            NODETERM_VS_BOOTSTRAPPER_URL: config.bootstrapperUrl,
            NODETERM_VS_BOOTSTRAPPER_FILE: bootstrapper
          }
        }
      )
      if (downloadResult?.error || downloadResult?.status !== 0) {
        installResult = downloadResult
        action = `download ${config.bootstrapperUrl}`
      } else {
        const actualSha256 = fileSha256(bootstrapper, fs)
        if (actualSha256 !== config.bootstrapperSha256) {
          installResult = {
            status: 1,
            stderr:
              `downloaded Visual Studio bootstrapper hashed to ${actualSha256}; ` +
              `expected ${config.bootstrapperSha256}`
          }
          action = `verify ${config.bootstrapperUrl}`
        } else {
          report.log(`  Bootstrapper SHA-256 verified: ${actualSha256}`)
          const bootstrapperArgs = [
            '--wait',
            uiFlag,
            '--norestart',
            '--add',
            config.workloadId,
            '--includeRecommended'
          ]
          for (const componentId of config.componentIds) {
            bootstrapperArgs.push('--add', componentId)
          }
          installResult = run(bootstrapper, bootstrapperArgs)
          action = `${bootstrapper} ${bootstrapperArgs.join(' ')}`
        }
      }
    } catch (error) {
      installResult = { status: 1, error }
      action = `bootstrap ${config.bootstrapperUrl}`
    } finally {
      if (staging) fs.rm(staging, { recursive: true, force: true })
    }
  }

  if (!successfulInstallerExit(installResult)) {
    const detail = installResult?.error?.message || resultText(installResult) || `exit code ${installResult?.status}`
    emitFailure(report, [
      `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
      `Constraint : ${config.componentIds.join(', ')}`,
      'Source     : Microsoft Visual Studio Installer',
      `Error      : installer failed (${detail})`,
      `Command    : ${action}`
    ])
    return { code: installResult?.status || 1, changed: false }
  }
  if (installResult.status === REBOOT_REQUIRED) {
    // Default vswhere intentionally hides reboot-required instances, so verification cannot be
    // meaningful until after the restart. Preserve 3010 rather than laundering it into a generic
    // "instance missing" failure or continuing into npm with a not-yet-usable toolchain.
    emitFailure(report, [
      `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
      `Constraint : ${config.componentIds.join(', ')}`,
      'Source     : Microsoft Visual Studio Installer',
      'Error      : installation completed with exit code 3010; restart Windows, then rerun the',
      '             normal root build command so the component can be verified before npm'
    ])
    return { code: REBOOT_REQUIRED, changed: true }
  }

  // Installer exit 0 is not evidence that the requested files exist. Re-run the independent
  // discovery/filesystem check; this catches an ignored component id and a bootstrapper that only
  // queued work before returning.
  let after
  try {
    after = discoverInstances({
      programFilesX86,
      run,
      fs,
      requiredComponentIds: [config.workloadId, ...config.componentIds],
      libraryArchitectures: config.libraryArchitectures
    })
  } catch (error) {
    emitFailure(report, [
      `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
      `Constraint : ${config.componentIds.join(', ')}`,
      'Source     : Microsoft Visual Studio Installer',
      `Error      : installer exited successfully, but verification failed: ${error.message}`
    ])
    return { code: 1, changed: false }
  }
  const verified = selectedCxxToolset(after.instances)
  const installed =
    verified?.toolset.hasSpectre === true && verified.instance.hasRequiredComponents === true
  if (!installed) {
    emitFailure(report, [
      `Dependency : MSVC v143 ${config.libraryArchitectures.join('/')} Spectre-mitigated libraries`,
      `Constraint : ${config.componentIds.join(', ')}`,
      'Source     : Microsoft Visual Studio Installer',
      'Error      : installer exited successfully, but the C++ workload or VC\\Tools\\MSVC\\*\\lib\\spectre is still missing'
    ])
    return { code: 1, changed: false }
  }

  if (!writeToolchainSelection(resultFile, verified, report)) {
    return { code: 1, changed: false }
  }

  report.log('  Installed and verified the Spectre-mitigated MSVC libraries.')
  return { code: 0, changed: true }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && resolve(fileURLToPath(import.meta.url)).toLowerCase() === invokedPath.toLowerCase()) {
  const resultFileIndex = process.argv.indexOf('--result-file')
  const resultFile = resultFileIndex >= 0 ? process.argv[resultFileIndex + 1] : undefined
  if (resultFileIndex >= 0 && !resultFile) {
    console.error('--result-file requires a path')
    process.exitCode = 2
  } else {
    const result = ensureWindowsBuildToolchain({
      silent: process.argv.includes('--silent'),
      elevatedToolchainOnly: process.argv.includes('--elevated-toolchain-only'),
      resultFile
    })
    process.exitCode = result.code
  }
}
