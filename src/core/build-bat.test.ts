import { spawnSync } from 'node:child_process'
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
    // Space + apostrophe are both intentional: every root path crosses cmd and PowerShell, and
    // treating that apostrophe as PowerShell source used to produce a green build with no SHA.
    root = mkdtempSync(join(tmpdir(), "nodeterm build BAT O'Brien "))
    toolchain = join(root, 'portable-node')
    log = join(root, 'events.log')
    mkdirSync(toolchain, { recursive: true })
    mkdirSync(join(root, 'scripts'), { recursive: true })

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
      join(root, 'scripts', 'check-build-preflight.mjs'),
      [
        "import { appendFileSync } from 'node:fs'",
        "appendFileSync(process.env.BAT_TEST_LOG, 'preflight\\n')",
        "if (process.env.BAT_TEST_PREFLIGHT_FAIL === '1') process.exit(17)",
        ''
      ].join('\n')
    )

    writeFileSync(
      join(toolchain, 'npm.cmd'),
      [
        '@echo off',
        '>>"%BAT_TEST_LOG%" echo npm %*',
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
          BAT_TEST_LOG: log,
          BAT_TEST_INSTALLER: join(
            root,
            'dist',
            'squirrel-windows',
            'nodeterm-Setup-0.3.0.exe'
          ),
          SILENT: '1',
          NoDefaultCurrentDirectoryInExePath: '1',
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

  it('bootstraps Node, preflights before npm install, exports PATH, and builds', () => {
    const result = run('build.bat')

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual(['preflight', 'npm install', 'npm run build'])
    expect(existsSync(join(root, 'out', 'main', 'index.js'))).toBe(true)
    expect(result.stdout).toContain('=== Build complete. ===')
    expect(result.stdout).toContain('Silent mode - not launching nodeterm.')
  }, 30_000)

  it('runs the same ordering and verifies a real-shaped local installer set', () => {
    const result = run('build-installer.bat')
    const setup = join(root, 'dist', 'squirrel-windows', 'nodeterm-Setup-0.3.0.exe')

    expect(result.error).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(events()).toEqual(['preflight', 'npm install', 'npm run dist:win'])
    expect(statSync(setup).size).toBe(5 * 1024 * 1024)
    expect(result.stdout).toContain('=== Installer built and verified. ===')
    expect(result.stdout).toMatch(/SHA-256\s+: [0-9a-f]{64}/)
    expect(result.stdout).toMatch(/This script only builds and verifies the artifact\s+locally:/)
  }, 30_000)

  it('stops before npm when the post-bootstrap preflight refuses the machine', () => {
    const result = run('download-dependencies.bat', { BAT_TEST_PREFLIGHT_FAIL: '1' })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(17)
    expect(events()).toEqual(['preflight'])
    expect(result.stdout).toContain('[FAILED] Build preflight')
    expect(result.stdout).toContain('preflight exited with code 17')
  }, 30_000)
})
