import { spawn, spawnSync } from 'node:child_process'
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
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const describeWindows = process.platform === 'win32' ? describe : describe.skip
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_NODE_VERSION = process.versions.node

function crc32(value: Buffer): number {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: Array<{ name: string; value: Buffer }>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const crc = crc32(entry.value)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(entry.value.length, 18)
    header.writeUInt32LE(entry.value.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, entry.value)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(entry.value.length, 20)
    directory.writeUInt32LE(entry.value.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += header.length + name.length + entry.value.length
  }
  const end = Buffer.alloc(22)
  const centralSize = central.reduce((total, item) => total + item.length, 0)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

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
    mkdirSync(join(root, 'unrelated caller'), { recursive: true })
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'junction')

    for (const file of ['build.bat', 'build-installer.bat', 'download-dependencies.bat']) {
      copyFileSync(join(REPO_ROOT, file), join(root, file))
    }
    for (const file of ['check-node-version.cjs', 'release-assets.mjs']) {
      copyFileSync(join(REPO_ROOT, 'scripts', file), join(root, 'scripts', file))
    }
    writeFileSync(join(root, 'dependencies.manifest.json'), '{}\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'node-terminal',
      version: '0.4.0',
      engines: { node: '^22.22.2 || ^24.15.0 || >=26.0.0' },
      build: { productName: 'nodeterm' }
    }))
    writeFileSync(join(root, 'package-lock.json'), '{}\n')
    writeFileSync(
      join(root, 'temporary files', 'package-fixture.nupkg'),
      storedZip([{
        name: 'node-terminal.nuspec',
        value: Buffer.from(
          '<package><metadata><id>node-terminal</id><version>0.4.0</version><title>nodeterm</title></metadata></package>'
        )
      }])
    )

    writeFileSync(
      join(root, 'scripts', 'windows-installer.mjs'),
      [
        "import { existsSync } from 'node:fs'",
        "import { dirname, join, resolve } from 'node:path'",
        "import { fileURLToPath } from 'node:url'",
        "const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')",
        "if (process.env.BAT_TEST_ICON_CONTRACT_EXIT) process.exit(Number(process.env.BAT_TEST_ICON_CONTRACT_EXIT))",
        "if (process.argv[2] !== 'assert-package') process.exit(64)",
        "if (resolve(process.argv[3] ?? '') !== join(root, 'dist', 'squirrel-windows')) process.exit(65)",
        "if (resolve(process.argv[4] ?? '') !== join(root, 'dist', 'windows-icon-contract.json')) process.exit(66)",
        "if (!existsSync(join(root, 'dist', 'windows-icon-contract.json'))) process.exit(67)",
        ''
      ].join('\n')
    )

    writeFileSync(
      join(root, 'scripts', 'write-squirrel-fixture.mjs'),
      [
        "import { createHash } from 'node:crypto'",
        "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
        "import { join } from 'node:path'",
        "const out = join(process.cwd(), 'dist', 'squirrel-windows')",
        "mkdirSync(out, { recursive: true })",
        "if (process.env.BAT_TEST_REQUIRE_CLEAN_METADATA === '1' && existsSync(join(process.cwd(), 'dist', 'windows-icon-contract.json'))) process.exit(73)",
        "if (process.env.BAT_TEST_NO_DIST_OUTPUT === '1') process.exit(0)",
        "const setup = process.env.BAT_TEST_INSTALLER",
        "const setupSource = readFileSync(process.env.BAT_TEST_SETUP_SOURCE)",
        "writeFileSync(setup, Buffer.concat([setupSource, Buffer.alloc(Math.max(0, 5 * 1024 * 1024 - setupSource.length))]))",
        "const name = 'node-terminal-0.4.0-full.nupkg'",
        "const bytes = readFileSync(process.env.BAT_TEST_NUPKG_SOURCE)",
        "writeFileSync(join(out, name), bytes)",
        "let hash = createHash('sha1').update(bytes).digest('hex')",
        "let size = bytes.length",
        "let releasesName = name",
        "if (process.env.BAT_TEST_RELEASES_BAD_SHA === '1') hash = '0'.repeat(40)",
        "if (process.env.BAT_TEST_RELEASES_BAD_SIZE === '1') size += 1",
        "if (process.env.BAT_TEST_RELEASES_BAD_NAME === '1') releasesName = 'missing-full.nupkg'",
        "writeFileSync(join(out, 'RELEASES'), `${hash} ${releasesName} ${size}\\r\\n`)",
        "if (process.env.BAT_TEST_EXTRA_RELEASE_ASSET === '1') writeFileSync(join(out, 'leftover.log'), 'stale')",
        "mkdirSync(join(process.cwd(), 'dist'), { recursive: true })",
        "writeFileSync(join(process.cwd(), 'dist', 'windows-icon-contract.json'), '{}\\n')",
        ''
      ].join('\n')
    )

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
        '  if /I "%BAT_TEST_NO_BUILD_OUTPUT%"=="1" exit /b 0',
        '  if not exist "%CD%\\out\\main" mkdir "%CD%\\out\\main"',
        '  if /I not "%BAT_TEST_MISSING_BUILD_ARTIFACT%"=="main" >"%CD%\\out\\main\\index.js" echo built',
        '  if not exist "%CD%\\out\\preload" mkdir "%CD%\\out\\preload"',
        '  if /I not "%BAT_TEST_MISSING_BUILD_ARTIFACT%"=="preload" >"%CD%\\out\\preload\\index.js" echo built',
        '  if not exist "%CD%\\out\\renderer" mkdir "%CD%\\out\\renderer"',
        '  if /I not "%BAT_TEST_MISSING_BUILD_ARTIFACT%"=="renderer" >"%CD%\\out\\renderer\\index.html" echo built',
        '  if not exist "%CD%\\out\\session-host" mkdir "%CD%\\out\\session-host"',
        '  if /I not "%BAT_TEST_MISSING_BUILD_ARTIFACT%"=="session-host" >"%CD%\\out\\session-host\\host.cjs" echo built',
        ')',
        'if /I "%~1"=="run" if /I "%~2"=="dist:win" (',
        '  call node "%CD%\\scripts\\write-squirrel-fixture.mjs"',
        '  if errorlevel 1 exit /b 71',
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
      [
        '/d',
        ...(extraEnv.BAT_TEST_CMD_EXTENSIONS_OFF === '1' ? ['/e:off'] : []),
        '/s',
        '/c',
        `call "${join(root, script)}" /s`
      ],
      {
        // An unrelated caller directory makes `%~dp0` part of the behavioral contract. A `%CD%`
        // regression would now look for manifests/scripts in the wrong directory and fail.
        cwd: join(root, 'unrelated caller'),
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
          BAT_TEST_SETUP_SOURCE: process.env.ComSpec ?? join(systemRoot, 'System32', 'cmd.exe'),
          BAT_TEST_NUPKG_SOURCE: join(root, 'temporary files', 'package-fixture.nupkg'),
          BAT_TEST_INSTALLER: join(
            root,
            'dist',
            'squirrel-windows',
            'nodeterm-Setup-0.4.0.exe'
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

  it('ships every root BAT with CRLF and no bare LF bytes', () => {
    for (const file of ['build.bat', 'build-installer.bat', 'download-dependencies.bat']) {
      const bytes = readFileSync(join(REPO_ROOT, file))
      let lineFeeds = 0
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] !== 0x0a) continue
        lineFeeds += 1
        expect(bytes[index - 1], `${file} has a bare LF at byte ${index}`).toBe(0x0d)
      }
      expect(lineFeeds, `${file} must contain line breaks`).toBeGreaterThan(0)
    }
  })

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
    const url = `https://nodejs.org/dist/v${FIXTURE_NODE_VERSION}/node-v${FIXTURE_NODE_VERSION}-win-x64.zip`
    mkdirSync(fakeSystemTools, { recursive: true })
    writeFileSync(archive, archiveBytes)
    writeFileSync(
      manifest,
      `${JSON.stringify(
        {
          node: {
            version: FIXTURE_NODE_VERSION,
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
        "if (command.includes('Get-Content -Raw')) {",
        "  const data = JSON.parse(readFileSync(process.env.NODETERM_MANIFEST_FILE, 'utf8'))",
        "  const version = String(data.node?.version ?? '')",
        "  const entry = data.node?.portable?.[process.env.NODETERM_NODE_ARCH] ?? {}",
        "  const expected = `https://nodejs.org/dist/v${version}/node-v${version}-${process.env.NODETERM_NODE_ARCH}.zip`",
        "  if (!/^\\d+\\.\\d+\\.\\d+$/.test(version) || entry.url !== expected || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')) process.exit(87)",
        "  writeFileSync(process.env.NODETERM_MANIFEST_RESULT, `NODE_VERSION=${version}\\nNODE_URL=${entry.url}\\nNODE_SHA256=${entry.sha256}\\n`)",
        "  process.exit(0)",
        "}",
        "if (command.includes('Invoke-WebRequest')) {",
        "  if (process.env.NODETERM_DOWNLOAD_URL !== process.env.BAT_TEST_EXPECTED_URL) fail('download URL was not passed as data')",
        "  copyFileSync(process.env.BAT_TEST_NODE_ARCHIVE_SOURCE, process.env.NODETERM_DOWNLOAD_FILE)",
        "  appendFileSync(process.env.BAT_TEST_LOG, 'portable-download\\n')",
        "  process.exit(0)",
        "}",
        "if (command.includes('Get-AuthenticodeSignature')) {",
        "  writeFileSync(process.env.NODETERM_RESULT_FILE, process.env.BAT_TEST_AUTHENTICODE_STATUS ?? 'NotSigned')",
        "  if (process.env.BAT_TEST_SIGNATURE_PROBE_EXIT) process.exit(Number(process.env.BAT_TEST_SIGNATURE_PROBE_EXIT))",
        "  process.exit(0)",
        "}",
        "if (command.includes('[Security.Cryptography.SHA256]::Create()')) {",
        "  const digest = createHash('sha256').update(readFileSync(process.env.NODETERM_HASH_FILE)).digest('hex')",
        "  const resultFile = process.env.NODETERM_RESULT_FILE || process.env.NODETERM_HASH_RESULT",
        "  if (resultFile) {",
        "    if (process.env.BAT_TEST_FAIL_SETUP_HASH === '1') process.exit(0)",
        "    writeFileSync(resultFile, digest)",
        "    if (process.env.NODETERM_HASH_RESULT && process.env.BAT_TEST_NODE_HASH_EXIT_WITH_OUTPUT) process.exit(Number(process.env.BAT_TEST_NODE_HASH_EXIT_WITH_OUTPUT))",
        "    if (process.env.BAT_TEST_HASH_EXIT_WITH_OUTPUT) process.exit(Number(process.env.BAT_TEST_HASH_EXIT_WITH_OUTPUT))",
        "    process.exit(0)",
        "  }",
        "  fail('hash result file was not supplied')",
        "}",
        "if (command.includes('Expand-Archive')) {",
        "  const stale = join(process.env.NODETERM_ARCHIVE_DESTINATION, 'node-v99.0.0-win-x64')",
        "  mkdirSync(stale, { recursive: true })",
        "  try { linkSync(process.env.BAT_TEST_REAL_NODE, join(stale, 'node.exe')) } catch { copyFileSync(process.env.BAT_TEST_REAL_NODE, join(stale, 'node.exe')) }",
        "  if (process.env.BAT_TEST_EXPAND_NO_EXACT_NODE === '1') { appendFileSync(process.env.BAT_TEST_LOG, 'portable-expand-empty\\n'); process.exit(0) }",
        `  const extracted = join(process.env.NODETERM_ARCHIVE_DESTINATION, 'node-v${FIXTURE_NODE_VERSION}-win-x64')`,
        "  mkdirSync(extracted, { recursive: true })",
        "  try { linkSync(process.env.BAT_TEST_REAL_NODE, join(extracted, 'node.exe')) } catch { copyFileSync(process.env.BAT_TEST_REAL_NODE, join(extracted, 'node.exe')) }",
        "  copyFileSync(process.env.BAT_TEST_NPM_STUB, join(extracted, 'npm.cmd'))",
        "  appendFileSync(process.env.BAT_TEST_LOG, 'portable-expand\\n')",
        "  process.exit(0)",
        "}",
        "if (command.includes(`SetEnvironmentVariable('NODETERM_NODE_HOME'`)) {",
        "  if (!process.env.NODETERM_PERSIST_NODE_HOME?.includes(`O'Brien`)) fail('persisted Node home was not passed as data')",
        "  appendFileSync(process.env.BAT_TEST_LOG, 'portable-persist\\n')",
        "  if (process.env.BAT_TEST_PERSIST_EXIT) process.exit(Number(process.env.BAT_TEST_PERSIST_EXIT))",
        "  process.exit(0)",
        "}",
        "fail(`Unexpected PowerShell command: ${command}`)",
        ''
      ].join('\n')
    )
    return { archive, fakeSystemTools, manifest, stub, url }
  }

  function portableEnvironment(
    fixture: ReturnType<typeof installPortablePowerShellStub>,
    extra: NodeJS.ProcessEnv = {}
  ): NodeJS.ProcessEnv {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    return {
      PATH: [
        fixture.fakeSystemTools,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';'),
      NODETERM_NODE_HOME: '',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      BAT_TEST_REAL_NODE: process.execPath,
      BAT_TEST_POWERSHELL_STUB: fixture.stub,
      BAT_TEST_NODE_ARCHIVE_SOURCE: fixture.archive,
      BAT_TEST_NPM_STUB: join(toolchain, 'npm.cmd'),
      BAT_TEST_EXPECTED_URL: fixture.url,
      ...extra
    }
  }

  it('bootstraps Node, preflights before production npm ci, exports PATH, and builds', () => {
    const result = run('build.bat')

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual([
      'toolchain --silent',
      'python --silent',
      'preflight',
      'npm ci',
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

  it.each(['download-dependencies.bat', 'build.bat', 'build-installer.bat'])(
    '%s enables command extensions and rejects elevation despite poisoned cmd pseudo-variables',
    (script) => {
      const fakeWindows = installElevatedSystemPowerShell()
      const result = run(script, {
        WINDIR: fakeWindows,
        ERRORLEVEL: '0',
        RANDOM: '..\\poisoned-random',
        BAT_TEST_CMD_EXTENSIONS_OFF: '1'
      })

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(5)
      expect(events()).toEqual(['elevation-probe'])
    },
    30_000
  )

  it('uses npm install only for a checkout with no lockfile', () => {
    rmSync(join(root, 'package-lock.json'))
    const result = run('download-dependencies.bat')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual(['toolchain --silent', 'python --silent', 'preflight', 'npm install'])
  }, 30_000)

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
      'npm ci'
    ])
    expect(result.stdout).toContain('SHA-256 verified')
    expect(result.stdout).toContain("O'Brien")
    expect(result.stdout).toContain(`node-v${FIXTURE_NODE_VERSION}-win-x64`)
    expect(result.stdout).not.toContain('at "' + join(root, 'local-app-data', 'nodeterm', 'toolchain', 'node-v99.0.0-win-x64') + '"')
  }, 30_000)

  it('runs the same ordering and verifies a real-shaped local installer set', () => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const result = run('build-installer.bat', {
      PATH: [
        toolchain,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';')
    })
    const setup = join(root, 'dist', 'squirrel-windows', 'nodeterm-Setup-0.4.0.exe')

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual([
      'toolchain --silent',
      'python --silent',
      'preflight',
      'npm ci',
      'npm run dist:win'
    ])
    expect(statSync(setup).size).toBe(5 * 1024 * 1024)
    expect(result.stdout).toContain('=== Installer built and verified. ===')
    expect(result.stdout).toMatch(/SHA-256\s+: [0-9a-f]{64}/)
    expect(result.stdout).toMatch(/This script only builds and verifies the artifact\s+locally:/)
  }, 30_000)

  it('does not report a clean tree when git status fails', () => {
    try {
      linkSync(process.execPath, join(toolchain, 'git.exe'))
    } catch {
      copyFileSync(process.execPath, join(toolchain, 'git.exe'))
    }
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const result = run('build-installer.bat', {
      PATH: [
        toolchain,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';')
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('Tree state : unknown - git status failed')
    expect(result.stdout).not.toContain('Tree state : clean')
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
      'npm ci',
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
        'npm ci'
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

  it('removes stale build output before npm so a zero-output success cannot inherit it', () => {
    const stale = join(root, 'out', 'main', 'index.js')
    mkdirSync(dirname(stale), { recursive: true })
    writeFileSync(stale, 'stale')

    const result = run('build.bat', { BAT_TEST_NO_BUILD_OUTPUT: '1' })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(existsSync(stale)).toBe(false)
    expect(events().at(-1)).toBe('npm run build')
    expect(result.stdout).toContain('expected output file is missing or empty')
  }, 30_000)

  it.each(['main', 'preload', 'renderer', 'session-host'])(
    'rejects a successful npm build missing the %s runtime artifact',
    (artifact) => {
      const result = run('build.bat', { BAT_TEST_MISSING_BUILD_ARTIFACT: artifact })
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stdout).toContain('expected output file is missing or empty')
    },
    30_000
  )

  it('removes the whole stale build tree before writing a fresh artifact', () => {
    const sentinel = join(root, 'out', 'stale-sentinel.txt')
    mkdirSync(dirname(sentinel), { recursive: true })
    writeFileSync(sentinel, 'stale')

    const result = run('build.bat')

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(existsSync(sentinel)).toBe(false)
    expect(existsSync(join(root, 'out', 'main', 'index.js'))).toBe(true)
  }, 30_000)

  it('fails closed before npm when a live process prevents stale-output removal', async () => {
    const out = join(root, 'out')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'locked.txt'), 'stale')
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const keeper = spawn(
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 20'],
      { cwd: out, stdio: 'ignore', windowsHide: true }
    )
    try {
      await new Promise((resolveReady) => setTimeout(resolveReady, 150))
      const result = run('build.bat')

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stdout).toContain('could not remove the previous output')
      expect(events()).not.toContain('npm run build')
    } finally {
      if (keeper.exitCode === null) {
        keeper.kill()
        await new Promise<void>((resolveExit) => keeper.once('exit', () => resolveExit()))
      }
    }
  }, 30_000)

  it('pre-cleans stale installer assets and metadata before a fresh package', () => {
    const squirrel = join(root, 'dist', 'squirrel-windows')
    mkdirSync(squirrel, { recursive: true })
    writeFileSync(join(squirrel, 'stale-sentinel.txt'), 'stale')
    writeFileSync(join(root, 'dist', 'windows-icon-contract.json'), 'stale')

    const result = run('build-installer.bat', { BAT_TEST_REQUIRE_CLEAN_METADATA: '1' })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(existsSync(join(squirrel, 'stale-sentinel.txt'))).toBe(false)
    expect(readFileSync(join(root, 'dist', 'windows-icon-contract.json'), 'utf8')).toBe('{}\n')
  }, 30_000)

  it('fails closed before packaging when a live process prevents Squirrel output cleanup', async () => {
    const squirrel = join(root, 'dist', 'squirrel-windows')
    mkdirSync(squirrel, { recursive: true })
    writeFileSync(join(squirrel, 'locked.txt'), 'stale')
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const keeper = spawn(
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 20'],
      { cwd: squirrel, stdio: 'ignore', windowsHide: true }
    )
    try {
      await new Promise((resolveReady) => setTimeout(resolveReady, 150))
      const result = run('build-installer.bat')
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stdout).toContain('could not remove the previous output')
      expect(events()).not.toContain('npm run dist:win')
    } finally {
      if (keeper.exitCode === null) {
        keeper.kill()
        await new Promise<void>((resolveExit) => keeper.once('exit', () => resolveExit()))
      }
    }
  }, 30_000)

  it.each([
    ['BAT_TEST_RELEASES_BAD_SHA', 'SHA1 mismatch'],
    ['BAT_TEST_RELEASES_BAD_SIZE', 'size mismatch'],
    ['BAT_TEST_RELEASES_BAD_NAME', 'missing on disk'],
    ['BAT_TEST_EXTRA_RELEASE_ASSET', 'unexpected Squirrel output entry']
  ])('rejects a packaged inventory mutation through %s', (name, message) => {
    const result = run('build-installer.bat', { [name]: '1' })

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.stdout).not.toContain('=== Installer built and verified. ===')
  }, 30_000)

  it('does not reuse stale package output when npm reports success without artifacts', () => {
    const squirrel = join(root, 'dist', 'squirrel-windows')
    mkdirSync(squirrel, { recursive: true })
    writeFileSync(join(squirrel, 'nodeterm-Setup-0.4.0.exe'), 'stale')

    const result = run('build-installer.bat', { BAT_TEST_NO_DIST_OUTPUT: '1' })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain('exactly one nodeterm-Setup-0.4.0.exe')
    expect(result.stdout).not.toContain('=== Installer built and verified. ===')
  }, 30_000)

  it('accepts only exact Authenticode NotSigned through the real cmd verifier', () => {
    const { fakeSystemTools, stub } = installPortablePowerShellStub()
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const pathValue = [
      fakeSystemTools,
      join(systemRoot, 'System32'),
      systemRoot,
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
    ].join(';')
    for (const status of ['Valid', 'HashMismatch', 'UnknownError', '']) {
      const result = run('build-installer.bat', {
        PATH: pathValue,
        BAT_TEST_REAL_NODE: process.execPath,
        BAT_TEST_POWERSHELL_STUB: stub,
        BAT_TEST_AUTHENTICODE_STATUS: status
      })
      expect(result.status, `${status}\n${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stderr).toContain('expected an unsigned installer')
    }
  }, 30_000)

  it('preserves a nonzero hash-process status even if that process wrote a valid digest', () => {
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
      BAT_TEST_HASH_EXIT_WITH_OUTPUT: '47'
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(47)
    expect(result.stdout).toContain('hashing exited with code 47')
    expect(result.stdout).not.toContain('=== Installer built and verified. ===')
  }, 30_000)

  it('preserves a nonzero signature-process status even after NotSigned was written', () => {
    const { fakeSystemTools, stub } = installPortablePowerShellStub()
    const systemRoot = process.env.SystemRoot ?? 'C:\Windows'
    const result = run('build-installer.bat', {
      PATH: [
        fakeSystemTools,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';'),
      BAT_TEST_REAL_NODE: process.execPath,
      BAT_TEST_POWERSHELL_STUB: stub,
      BAT_TEST_SIGNATURE_PROBE_EXIT: '48'
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(48)
    expect(result.stdout).toContain('Authenticode inspection exited with code 48')
    expect(result.stdout).not.toContain('=== Installer built and verified. ===')
  }, 30_000)

  it('rejects a wrong but self-consistent nupkg version through the real BAT verifier', () => {
    const wrong = join(root, 'temporary files', 'wrong-version.nupkg')
    writeFileSync(wrong, storedZip([{
      name: 'node-terminal.nuspec',
      value: Buffer.from(
        '<package><metadata><id>node-terminal</id><version>0.3.0</version><title>nodeterm</title></metadata></package>'
      )
    }]))
    const result = run('build-installer.bat', { BAT_TEST_NUPKG_SOURCE: wrong })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain('version mismatch')
  }, 30_000)

  it('preserves the packaged-icon verifier failure status', () => {
    const result = run('build-installer.bat', { BAT_TEST_ICON_CONTRACT_EXIT: '45' })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(45)
    expect(result.stdout).not.toContain('=== Installer built and verified. ===')
  }, 30_000)

  it('treats a negative PATH Node exit as broken and falls back to the pinned runtime', () => {
    const fixture = installPortablePowerShellStub()
    writeFileSync(join(fixture.fakeSystemTools, 'node.cmd'), '@echo off\r\nexit /b -1\r\n')
    const result = run('download-dependencies.bat', portableEnvironment(fixture))
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('missing, broken, or outside the supported range')
    expect(events()).toContain('portable-expand')
  }, 30_000)

  it('rejects a portable hash process that writes the expected digest then exits nonzero', () => {
    const fixture = installPortablePowerShellStub()
    const result = run('download-dependencies.bat', portableEnvironment(fixture, {
      BAT_TEST_NODE_HASH_EXIT_WITH_OUTPUT: '49'
    }))
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(49)
    expect(result.stdout).toContain('hashing exited with code 49')
    expect(events()).toEqual(['portable-download'])
  }, 30_000)

  it('keeps manifest quotes and cmd metacharacters as data and performs no download', () => {
    const fixture = installPortablePowerShellStub()
    const sentinel = join(root, 'manifest-injection-ran.txt')
    const malicious = `0.0.0\" & echo injected>\"${sentinel}\" & rem \"`
    writeFileSync(fixture.manifest, JSON.stringify({
      node: {
        version: malicious,
        portable: {
          'win-x64': { url: malicious, sha256: 'a'.repeat(64) }
        }
      }
    }))
    const result = run('download-dependencies.bat', portableEnvironment(fixture))
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stdout).toContain('portable manifest entry failed validation')
    expect(existsSync(sentinel)).toBe(false)
    expect(events()).toEqual([])
  }, 30_000)

  it.each(['version', 'url', 'sha256'])(
    'rejects a portable manifest missing its exact %s before download',
    (missing) => {
      const fixture = installPortablePowerShellStub()
      const value: {
        node: {
          version?: string
          portable: Record<string, { url?: string; sha256?: string }>
        }
      } = {
        node: {
          version: FIXTURE_NODE_VERSION,
          portable: {
            'win-x64': {
              url: fixture.url,
              sha256: createHash('sha256').update(readFileSync(fixture.archive)).digest('hex')
            }
          }
        }
      }
      if (missing === 'version') delete value.node.version
      else delete value.node.portable['win-x64'][missing as 'url' | 'sha256']
      writeFileSync(fixture.manifest, JSON.stringify(value))
      const result = run('download-dependencies.bat', portableEnvironment(fixture))
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stdout).toContain('portable manifest entry failed validation')
      expect(events()).toEqual([])
    },
    30_000
  )

  it('persists the portable selection only after its exact probe and preserves persistence failure', () => {
    const fixture = installPortablePowerShellStub()
    const result = run('download-dependencies.bat', portableEnvironment(fixture, {
      BAT_TEST_PERSIST_EXIT: '50'
    }))
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(50)
    expect(events()).toEqual(['portable-download', 'portable-expand', 'portable-persist'])
    expect(result.stdout).toContain('could not persist NODETERM_NODE_HOME')
  }, 30_000)

  it('rejects an unsupported PATH Node and completes through the pinned portable runtime', () => {
    const { archive, fakeSystemTools, stub, url } = installPortablePowerShellStub()
    writeFileSync(
      join(fakeSystemTools, 'node.cmd'),
      '@echo off\r\nif /I "%~1"=="--version" echo v20.0.0\r\nexit /b 0\r\n'
    )
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const result = run('build.bat', {
      PATH: [
        fakeSystemTools,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';'),
      NODETERM_NODE_HOME: '',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      BAT_TEST_REAL_NODE: process.execPath,
      BAT_TEST_POWERSHELL_STUB: stub,
      BAT_TEST_NODE_ARCHIVE_SOURCE: archive,
      BAT_TEST_NPM_STUB: join(toolchain, 'npm.cmd'),
      BAT_TEST_EXPECTED_URL: url
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('outside the supported range')
    expect(events()).toContain('portable-expand')
    expect(events().at(-1)).toBe('npm run build')
  }, 30_000)

  it('removes the exact portable target before extraction so a stale node cannot mask an empty archive', () => {
    const { archive, fakeSystemTools, stub, url } = installPortablePowerShellStub()
    const exact = join(
      root,
      'local-app-data',
      'nodeterm',
      'toolchain',
      `node-v${FIXTURE_NODE_VERSION}-win-x64`
    )
    mkdirSync(exact, { recursive: true })
    copyFileSync(process.execPath, join(exact, 'node.exe'))
    copyFileSync(join(toolchain, 'npm.cmd'), join(exact, 'npm.cmd'))
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const result = run('download-dependencies.bat', {
      PATH: [
        fakeSystemTools,
        join(systemRoot, 'System32'),
        systemRoot,
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
      ].join(';'),
      NODETERM_NODE_HOME: '',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      BAT_TEST_REAL_NODE: process.execPath,
      BAT_TEST_POWERSHELL_STUB: stub,
      BAT_TEST_NODE_ARCHIVE_SOURCE: archive,
      BAT_TEST_NPM_STUB: join(toolchain, 'npm.cmd'),
      BAT_TEST_EXPECTED_URL: url,
      BAT_TEST_EXPAND_NO_EXACT_NODE: '1'
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stdout).toContain('did not contain the exact manifest-selected Node folder')
    expect(events()).toEqual(['portable-download', 'portable-expand-empty'])
    expect(existsSync(join(exact, 'node.exe'))).toBe(false)
  }, 30_000)

  it('fails closed before extraction when a live process prevents exact portable-target cleanup', async () => {
    const fixture = installPortablePowerShellStub()
    const exact = join(
      root,
      'local-app-data',
      'nodeterm',
      'toolchain',
      `node-v${FIXTURE_NODE_VERSION}-win-x64`
    )
    mkdirSync(exact, { recursive: true })
    writeFileSync(join(exact, 'locked.txt'), 'stale')
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const keeper = spawn(
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 20'],
      { cwd: exact, stdio: 'ignore', windowsHide: true }
    )
    try {
      await new Promise((resolveReady) => setTimeout(resolveReady, 150))
      const result = run('download-dependencies.bat', portableEnvironment(fixture))
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
      expect(result.stdout).toContain('could not remove the previous extraction')
      expect(events()).toEqual(['portable-download'])
    } finally {
      if (keeper.exitCode === null) {
        keeper.kill()
        await new Promise<void>((resolveExit) => keeper.once('exit', () => resolveExit()))
      }
    }
  }, 30_000)
})
