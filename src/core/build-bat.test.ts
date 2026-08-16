import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const describeWindows = process.platform === 'win32' ? describe : describe.skip
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * These scripts are a shipped interface, so the test runs the real batch programs under cmd.exe.
 * The only fakes are their expensive leaves (npm and the preflight): this keeps ordering, CALL
 * environment propagation, silent mode, artifact verification, and cmd parsing real without
 * replacing this checkout's node_modules or spending minutes compiling an installer per unit run.
 */
describeWindows('fresh-machine Windows batch entry points', () => {
  let root = ''
  let toolchain = ''
  let log = ''

  beforeEach(() => {
    // Spaces, apostrophe, delayed-expansion and cmd metacharacters are intentional: every root
    // path crosses cmd and PowerShell, and treating any of it as source must not split a command.
    root = mkdtempSync(join(tmpdir(), "nodeterm build BAT ! & (O'Brien) "))
    toolchain = join(root, 'portable-node')
    log = join(root, 'events.log')
    mkdirSync(toolchain, { recursive: true })
    mkdirSync(join(root, 'scripts'), { recursive: true })
    mkdirSync(join(root, 'temporary files'), { recursive: true })

    for (const file of ['build.bat', 'build-installer.bat', 'download-dependencies.bat']) {
      copyFileSync(join(REPO_ROOT, file), join(root, file))
    }
    writeFileSync(join(root, 'dependencies.manifest.json'), '{}\n')
    writeFileSync(join(root, 'package.json'), '{"name":"bat-fixture","version":"0.0.0"}\n')

    // A hard link makes a genuine Node runtime available without copying a large executable.
    // Temp and the checkout are normally on the same drive; copy is the portable fallback.
    try {
      linkSync(process.execPath, join(toolchain, 'node.exe'))
    } catch {
      copyFileSync(process.execPath, join(toolchain, 'node.exe'))
    }

    writeFileSync(
      join(root, 'scripts', 'ensure-windows-build-toolchain.mjs'),
      [
        "import { appendFileSync } from 'node:fs'",
        "appendFileSync(process.env.BAT_TEST_LOG, `toolchain ${process.argv.slice(2).join(' ')}\\n`)",
        "if (process.env.BAT_TEST_TOOLCHAIN_FAIL === '1') process.exit(19)",
        ''
      ].join('\n')
    )

    writeFileSync(
      join(root, 'scripts', 'check-build-preflight.mjs'),
      [
        "import { appendFileSync } from 'node:fs'",
        "appendFileSync(process.env.BAT_TEST_LOG, 'preflight\\n')",
        "if (process.env.BAT_TEST_PREFLIGHT_FAIL === '1') process.exit(17)",
        ''
      ].join('\n')
    )

    writeFileSync(
      join(root, 'scripts', 'ensure-windows-python.mjs'),
      [
        "import { appendFileSync, writeFileSync } from 'node:fs'",
        "appendFileSync(process.env.BAT_TEST_LOG, `python${process.argv.includes('--silent') ? ' --silent' : ''}\\n`)",
        "if (process.env.BAT_TEST_PYTHON_FAIL === '1') process.exit(23)",
        "const resultIndex = process.argv.indexOf('--result-file')",
        "if (resultIndex < 0 || !process.argv[resultIndex + 1]) process.exit(24)",
        "writeFileSync(process.argv[resultIndex + 1], `${process.execPath}\\r\\n`)",
        ''
      ].join('\n')
    )

    writeFileSync(
      join(toolchain, 'npm.cmd'),
      [
        '@echo off',
        '>>"%BAT_TEST_LOG%" echo npm %*',
        'if not exist "%PYTHON%" exit /b 31',
        'if /I not "%NODE_GYP_FORCE_PYTHON%"=="%PYTHON%" exit /b 32',
        'if /I not "%npm_config_python%"=="%PYTHON%" exit /b 33',
        'if /I "%~1"=="install" if defined BAT_TEST_NPM_EXIT exit /b %BAT_TEST_NPM_EXIT%',
        'if /I "%~1"=="ci" if defined BAT_TEST_NPM_EXIT exit /b %BAT_TEST_NPM_EXIT%',
        'if /I "%~1"=="run" if /I "%~2"=="build" if defined BAT_TEST_BUILD_EXIT exit /b %BAT_TEST_BUILD_EXIT%',
        'if /I "%~1"=="run" if /I "%~2"=="dist:win" if defined BAT_TEST_DIST_EXIT exit /b %BAT_TEST_DIST_EXIT%',
        'if /I "%~1"=="run" if /I "%~2"=="build" (',
        '  if not exist "%CD%\\out\\main" mkdir "%CD%\\out\\main"',
        '  >"%CD%\\out\\main\\index.js" echo built',
        ')',
        'if /I "%~1"=="run" if /I "%~2"=="dist:win" (',
        '  if not exist "%CD%\\dist\\squirrel-windows" mkdir "%CD%\\dist\\squirrel-windows"',
        '  powershell -NoProfile -Command "$h=[IO.File]::OpenWrite($env:BAT_TEST_INSTALLER); $h.SetLength(5242880); $h.Dispose()"',
        '  >"%CD%\\dist\\squirrel-windows\\RELEASES" echo release-index',
        '  >"%CD%\\dist\\squirrel-windows\\nodeterm-0.3.0-full.nupkg" echo package',
        ')',
        'exit /b 0',
        ''
      ].join('\r\n')
    )
  })

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  function run(script: string, extraEnv: NodeJS.ProcessEnv = {}) {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    // Deliberately omit the real Node/npm locations. The only route to npm after CALL returns is
    // download-dependencies.bat exporting the portable toolchain PATH out of its SETLOCAL scope.
    const basePath = [
      join(systemRoot, 'System32'),
      systemRoot,
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
    ].join(';')

    return spawnSync(
      process.env.ComSpec ?? join(systemRoot, 'System32', 'cmd.exe'),
      ['/d', '/s', '/c', `call "${join(root, script)}" /s`],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        // cmd.exe does not use the C-runtime backslash escaping Node applies by default; without
        // verbatim arguments the inner quotes around the absolute batch path become literal `\"`.
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PATH: basePath,
          NODETERM_NODE_HOME: toolchain,
          LOCALAPPDATA: join(root, 'local-app-data'),
          TEMP: join(root, 'temporary files'),
          BAT_TEST_LOG: log,
          BAT_TEST_INSTALLER: join(
            root,
            'dist',
            'squirrel-windows',
            'nodeterm-Setup-0.3.0.exe'
          ),
          SILENT: '1',
          NoDefaultCurrentDirectoryInExePath: '1',
          NODE_GYP_FORCE_PYTHON: 'C:\\poisoned\\missing-python.exe',
          npm_config_python: 'C:\\poisoned\\missing-python.exe',
          ...extraEnv
        }
      }
    )
  }

  function events(): string[] {
    return existsSync(log)
      ? readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean)
      : []
  }

  function installElevatedSystemPowerShell() {
    const fakeWindows = join(root, 'fake Windows')
    const powershellDir = join(
      fakeWindows,
      'System32',
      'WindowsPowerShell',
      'v1.0'
    )
    const source = join(root, 'elevated-token-stub.cs')
    mkdirSync(powershellDir, { recursive: true })
    writeFileSync(
      source,
      'using System; using System.IO; public static class Program { public static int Main() { File.AppendAllText(Environment.GetEnvironmentVariable("BAT_TEST_LOG"), "elevation-probe\\n"); return 86; } }\n'
    )
    const windowsRoot = process.env.WINDIR ?? 'C:\\Windows'
    const compiler = [
      join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      join(windowsRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
    ].find(existsSync)
    if (!compiler) throw new Error('Windows .NET Framework C# compiler is unavailable')
    const compile = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        `/out:${join(powershellDir, 'powershell.exe')}`,
        source
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    if (compile.status !== 0) {
      throw new Error(`could not compile elevation fixture: ${compile.stdout}\n${compile.stderr}`)
    }
    return fakeWindows
  }

  function installPortablePowerShellStub() {
    const fakeSystemTools = join(root, 'fake system tools')
    const archive = join(root, 'portable Node fixture.zip')
    const stub = join(root, 'powershell-stub.mjs')
    const manifest = join(root, 'dependencies.manifest.json')
    const archiveBytes = Buffer.from('portable Node archive fixture\n')
    const url = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip'
    mkdirSync(fakeSystemTools, { recursive: true })
    writeFileSync(archive, archiveBytes)
    writeFileSync(
      manifest,
      `${JSON.stringify(
        {
          node: {
            version: '24.19.0',
            portable: {
              'win-x64': {
                url,
                sha256: createHash('sha256').update(archiveBytes).digest('hex')
              }
            }
          }
        },
        null,
        2
      )}\n`
    )
    const forwarderSource = join(root, 'powershell-forwarder.cs')
    writeFileSync(
      forwarderSource,
      [
        'using System;',
        'using System.Diagnostics;',
        'using System.Text;',
        'public static class Program {',
        '  public static int Main(string[] args) {',
        '    string node = Environment.GetEnvironmentVariable("BAT_TEST_REAL_NODE");',
        '    string stub = Environment.GetEnvironmentVariable("BAT_TEST_POWERSHELL_STUB");',
        '    string payload = Convert.ToBase64String(Encoding.UTF8.GetBytes(string.Join("\\0", args)));',
        '    ProcessStartInfo start = new ProcessStartInfo();',
        '    start.FileName = node;',
        '    start.Arguments = "\\\"" + stub.Replace("\\\"", "\\\\\\\"") + "\\\"";',
        '    start.UseShellExecute = false;',
        '    start.EnvironmentVariables["BAT_TEST_POWERSHELL_ARGS"] = payload;',
        '    Process child = Process.Start(start);',
        '    child.WaitForExit();',
        '    return child.ExitCode;',
        '  }',
        '}',
        ''
      ].join('\n')
    )
    const windowsRoot = process.env.WINDIR ?? 'C:\\Windows'
    const compiler = [
      join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      join(windowsRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
    ].find(existsSync)
    if (!compiler) throw new Error('Windows .NET Framework C# compiler is unavailable')
    const compile = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        `/out:${join(fakeSystemTools, 'powershell.exe')}`,
        forwarderSource
      ],
      { encoding: 'utf8', windowsHide: true }
    )
    if (compile.status !== 0) {
      throw new Error(`could not compile PowerShell fixture: ${compile.stdout}\n${compile.stderr}`)
    }
    // Make `where winget` deterministic even on hosts that happen to expose App Installer in a
    // system location. A Node executable named winget exits nonzero on the unknown `install` file,
    // exercising the supported package-manager-failure route without batch-to-batch tail calls.
    try {
      linkSync(process.execPath, join(fakeSystemTools, 'winget.exe'))
    } catch {
      copyFileSync(process.execPath, join(fakeSystemTools, 'winget.exe'))
    }
    writeFileSync(
      stub,
      [
        "import { appendFileSync, copyFileSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
        "import { createHash } from 'node:crypto'",
        "import { join } from 'node:path'",
        "const forwardedArgs = Buffer.from(process.env.BAT_TEST_POWERSHELL_ARGS ?? '', 'base64').toString('utf8').split('\\0')",
        "const commandIndex = forwardedArgs.findIndex((arg) => arg.toLowerCase() === '-command')",
        "const command = commandIndex >= 0 ? forwardedArgs[commandIndex + 1] ?? '' : ''",
        "const fail = (message) => { console.error(message); process.exit(87) }",
        "const forbidden = [process.env.BAT_TEST_FORBIDDEN_POWERSHELL_LITERAL, process.env.BAT_TEST_FORBIDDEN_URL].filter(Boolean)",
        "if (forbidden.some((value) => command.includes(value))) fail(`PowerShell source interpolation: ${command}`)",
        "if (command.includes('[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()')) { console.log('1'); process.exit(0) }",
        "if (command.includes(`GetEnvironmentVariable('NODETERM_NODE_HOME'`)) process.exit(0)",
        "if (command.includes('$h=[IO.File]::OpenWrite')) {",
        "  writeFileSync(process.env.BAT_TEST_INSTALLER, Buffer.alloc(5 * 1024 * 1024))",
        "  process.exit(0)",
        "}",
        "if (command.includes('Get-Content -Raw')) {",
        "  const data = JSON.parse(readFileSync(process.env.NODETERM_MANIFEST_FILE, 'utf8'))",
        "  if (command.includes('$m.node.version')) { console.log(data.node.version); process.exit(0) }",
        "  const entry = data.node.portable[process.env.NODETERM_NODE_ARCH]",
        "  console.log(command.includes('$e.sha256') ? entry.sha256 : entry.url)",
        "  process.exit(0)",
        "}",
        "if (command.includes('NODETERM_EXPECTED_VERSION')) {",
        "  const expected = `https://nodejs.org/dist/v${process.env.NODETERM_EXPECTED_VERSION}/node-v${process.env.NODETERM_EXPECTED_VERSION}-${process.env.NODETERM_NODE_ARCH}.zip`",
        "  if (process.env.NODETERM_DOWNLOAD_URL !== expected) fail('portable manifest URL validation received the wrong data')",
        "  if (!/^[a-f0-9]{64}$/i.test(process.env.NODETERM_EXPECTED_SHA256 ?? '')) fail('portable manifest SHA validation received the wrong data')",
        "  process.exit(0)",
        "}",
        "if (command.includes('Invoke-WebRequest')) {",
        "  if (process.env.NODETERM_DOWNLOAD_URL !== process.env.BAT_TEST_EXPECTED_URL) fail('download URL was not passed as data')",
        "  copyFileSync(process.env.BAT_TEST_NODE_ARCHIVE_SOURCE, process.env.NODETERM_DOWNLOAD_FILE)",
        "  appendFileSync(process.env.BAT_TEST_LOG, 'portable-download\\n')",
        "  process.exit(0)",
        "}",
        "if (command.includes('[Security.Cryptography.SHA256]::Create()')) {",
        "  if (process.env.BAT_TEST_FAIL_SETUP_HASH === '1') process.exit(0)",
        "  console.log(createHash('sha256').update(readFileSync(process.env.NODETERM_HASH_FILE)).digest('hex'))",
        "  process.exit(0)",
        "}",
        "if (command.includes('Expand-Archive')) {",
        "  const stale = join(process.env.NODETERM_ARCHIVE_DESTINATION, 'node-v99.0.0-win-x64')",
        "  mkdirSync(stale, { recursive: true })",
        "  try { linkSync(process.env.BAT_TEST_REAL_NODE, join(stale, 'node.exe')) } catch { copyFileSync(process.env.BAT_TEST_REAL_NODE, join(stale, 'node.exe')) }",
        "  const extracted = join(process.env.NODETERM_ARCHIVE_DESTINATION, 'node-v24.19.0-win-x64')",
        "  mkdirSync(extracted, { recursive: true })",
        "  try { linkSync(process.env.BAT_TEST_REAL_NODE, join(extracted, 'node.exe')) } catch { copyFileSync(process.env.BAT_TEST_REAL_NODE, join(extracted, 'node.exe')) }",
        "  copyFileSync(process.env.BAT_TEST_NPM_STUB, join(extracted, 'npm.cmd'))",
        "  appendFileSync(process.env.BAT_TEST_LOG, 'portable-expand\\n')",
        "  process.exit(0)",
        "}",
        "if (command.includes(`SetEnvironmentVariable('NODETERM_NODE_HOME'`)) {",
        "  if (!process.env.NODETERM_PERSIST_NODE_HOME?.includes(`O'Brien`)) fail('persisted Node home was not passed as data')",
        "  appendFileSync(process.env.BAT_TEST_LOG, 'portable-persist\\n')",
        "  process.exit(0)",
        "}",
        "fail(`Unexpected PowerShell command: ${command}`)",
        ''
      ].join('\n')
    )
    return { archive, fakeSystemTools, stub, url }
  }

  it('bootstraps Node, preflights before npm install, exports PATH, and builds', () => {
    const result = run('build.bat')

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual([
      'toolchain --silent',
      'python --silent',
      'preflight',
      'npm install',
      'npm run build'
    ])
    expect(existsSync(join(root, 'out', 'main', 'index.js'))).toBe(true)
    expect(result.stdout).toContain('=== Build complete. ===')
    expect(result.stdout).toContain('Silent mode - not launching nodeterm.')
  }, 30_000)

  it.each(['download-dependencies.bat', 'build.bat', 'build-installer.bat'])(
    '%s refuses an elevated root before Node, winget, downloads, or npm',
    (script) => {
      const fakeWindows = installElevatedSystemPowerShell()
      const result = run(script, { WINDIR: fakeWindows })

      expect(result.error).toBeUndefined()
      expect(result.status, `${result.stdout}\n${result.stderr}\nevents=${JSON.stringify(events())}`).toBe(5)
      expect(events()).toEqual(['elevation-probe'])
      expect(result.stdout).toContain('never run the root')
      expect(result.stdout).toContain('only the printed toolchain helper may be elevated')
    },
    30_000
  )

  it('forces portable Node bootstrap without treating apostrophe-bearing paths as PowerShell source', () => {
    const { archive, fakeSystemTools, stub, url } = installPortablePowerShellStub()
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const basePath = [
      fakeSystemTools,
      join(systemRoot, 'System32'),
      systemRoot,
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
    ].join(';')
    const result = run('download-dependencies.bat', {
      PATH: basePath,
      NODETERM_NODE_HOME: '',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      BAT_TEST_REAL_NODE: process.execPath,
      BAT_TEST_POWERSHELL_STUB: stub,
      BAT_TEST_NODE_ARCHIVE_SOURCE: archive,
      BAT_TEST_NPM_STUB: join(toolchain, 'npm.cmd'),
      BAT_TEST_EXPECTED_URL: url,
      BAT_TEST_FORBIDDEN_POWERSHELL_LITERAL: root,
      BAT_TEST_FORBIDDEN_URL: url
    })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual([
      'portable-download',
      'portable-expand',
      'portable-persist',
      'toolchain --silent',
      'python --silent',
      'preflight',
      'npm install'
    ])
    expect(result.stdout).toContain('SHA-256 verified')
    expect(result.stdout).toContain("O'Brien")
    expect(result.stdout).toContain('node-v24.19.0-win-x64')
    expect(result.stdout).not.toContain('at "' + join(root, 'local-app-data', 'nodeterm', 'toolchain', 'node-v99.0.0-win-x64') + '"')
  }, 30_000)

  it('runs the same ordering and verifies a real-shaped local installer set', () => {
    const result = run('build-installer.bat')
    const setup = join(root, 'dist', 'squirrel-windows', 'nodeterm-Setup-0.3.0.exe')

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual([
      'toolchain --silent',
      'python --silent',
      'preflight',
      'npm install',
      'npm run dist:win'
    ])
    expect(statSync(setup).size).toBe(5 * 1024 * 1024)
    expect(result.stdout).toContain('=== Installer built and verified. ===')
    expect(result.stdout).toMatch(/SHA-256\s+: [0-9a-f]{64}/)
    expect(result.stdout).toMatch(/This script only builds and verifies the artifact\s+locally:/)
  }, 30_000)

  it('rejects an inherited digest when hashing the installer returns no result', () => {
    const { fakeSystemTools, stub } = installPortablePowerShellStub()
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const result = run('build-installer.bat', {
      PATH: [
        fakeSystemTools,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';'),
      BAT_TEST_REAL_NODE: process.execPath,
      BAT_TEST_POWERSHELL_STUB: stub,
      BAT_TEST_FAIL_SETUP_HASH: '1',
      SETUP_SHA256: 'inherited-garbage'
    })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(events()).toEqual([
      'toolchain --silent',
      'python --silent',
      'preflight',
      'npm install',
      'npm run dist:win'
    ])
    expect(result.stdout).toContain('PowerShell returned no digest')
    expect(result.stdout).not.toContain('SHA-256          : inherited-garbage')
  }, 30_000)

  it('stops before npm when the post-bootstrap preflight refuses the machine', () => {
    const result = run('download-dependencies.bat', { BAT_TEST_PREFLIGHT_FAIL: '1' })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(17)
    expect(events()).toEqual(['toolchain --silent', 'python --silent', 'preflight'])
    expect(result.stdout).toContain('[FAILED] Build preflight')
    expect(result.stdout).toContain('preflight exited with code 17')
  }, 30_000)

  it('stops before preflight and npm when the Python bootstrap fails', () => {
    const result = run('download-dependencies.bat', { BAT_TEST_PYTHON_FAIL: '1' })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(23)
    expect(events()).toEqual(['toolchain --silent', 'python --silent'])
  }, 30_000)

  it.each(['download-dependencies.bat', 'build.bat', 'build-installer.bat'])(
    '%s preserves the toolchain failure code and stops before preflight/npm',
    (script) => {
      const result = run(script, { BAT_TEST_TOOLCHAIN_FAIL: '1' })

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(19)
      expect(events()).toEqual(['toolchain --silent'])
      if (script !== 'download-dependencies.bat') {
        expect(result.stdout).toContain('download-dependencies.bat exited with code 19')
      }
    },
    30_000
  )

  it.each(['download-dependencies.bat', 'build.bat', 'build-installer.bat'])(
    '%s preserves npm dependency failure status',
    (script) => {
      const result = run(script, { BAT_TEST_NPM_EXIT: '42' })

      expect(result.error).toBeUndefined()
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(42)
      expect(events()).toEqual([
        'toolchain --silent',
        'python --silent',
        'preflight',
        'npm install'
      ])
      expect(result.stdout).toContain('npm exited with code 42')
    },
    30_000
  )

  it('preserves the build command failure status', () => {
    const result = run('build.bat', { BAT_TEST_BUILD_EXIT: '43' })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(43)
    expect(events().at(-1)).toBe('npm run build')
  }, 30_000)

  it('preserves the installer packaging failure status', () => {
    const result = run('build-installer.bat', { BAT_TEST_DIST_EXIT: '44' })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(44)
    expect(events().at(-1)).toBe('npm run dist:win')
  }, 30_000)
})
