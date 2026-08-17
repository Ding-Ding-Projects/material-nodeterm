import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  environmentForPosixShell,
  pathForPosixShell,
  pathsForPosixShellEnv,
  REAL_POSIX_SHELL,
  REAL_SHELL_TEST_TIMEOUT_MS
} from './testing/posix-shell'

interface InstallerScenario {
  systemVersion: string
  systemCapability: 'pass' | 'fail'
  extractedVersion: string
  extractedCapability: 'pass' | 'fail'
}

interface InstallerRun {
  appDir: string
  log: string
  runtimeNode: string
  runtimePresent: boolean
  status: number | null
  stderr: string
  stdout: string
  systemNode: string
  unit: string | null
}

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
)
const scratchRoots: string[] = []
const installer = resolve('scripts/install-server.sh')

function writeShim(binDir: string, name: string, body: string): void {
  const path = join(binDir, name)
  writeFileSync(path, `#!/bin/sh\nset -e\n${body.trim()}\n`, 'utf8')
  chmodSync(path, 0o755)
}

function installFixtureShims(binDir: string): void {
  writeShim(
    binDir,
    'uname',
    String.raw`
case "$1" in
  -s) printf '%s\n' Linux ;;
  -m) printf '%s\n' x86_64 ;;
  *) exit 64 ;;
esac`
  )
  writeShim(
    binDir,
    'id',
    String.raw`
case "$1" in
  -u) printf '%s\n' 1000 ;;
  -un) printf '%s\n' nodeterm-fixture ;;
  *) exit 64 ;;
esac`
  )
  writeShim(
    binDir,
    'git',
    String.raw`
printf 'git:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
if [ "$1" = clone ]; then
  destination=
  for argument in "$@"; do destination="$argument"; done
  mkdir -p "$destination/.git" "$destination/scripts"
  : > "$destination/scripts/check-node-runtime.mjs"
  printf '%s\n' '{"version":"0.3.0"}' > "$destination/package.json"
  exit 0
fi
if [ "$1" = -C ] && [ "$3" = rev-parse ]; then
  printf '%s\n' a1b2c3d
  exit 0
fi
exit 65`
  )
  writeShim(
    binDir,
    'node',
    String.raw`
printf 'system-node:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
case "$1" in
  --version|-v) printf '%s\n' "$INSTALLER_SYSTEM_VERSION" ;;
  -p) printf '%s\n' 0.3.0 ;;
  *) [ "$INSTALLER_SYSTEM_CAPABILITY" = pass ] ;;
esac`
  )
  writeShim(
    binDir,
    'npm',
    String.raw`
printf 'system-npm:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
if [ "$1" = run ] && [ "$2" = server:build ]; then
  mkdir -p "$NODETERM_APP_DIR/out/server"
  : > "$NODETERM_APP_DIR/out/server/main.cjs"
fi`
  )
  writeShim(
    binDir,
    'curl',
    String.raw`
printf 'curl:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then
    shift
    output="$1"
  fi
  shift
done
[ -n "$output" ] || exit 66
mkdir -p "$(dirname "$output")"
: > "$output"`
  )
  writeShim(
    binDir,
    'tar',
    String.raw`
printf 'tar:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
runtime=
while [ "$#" -gt 0 ]; do
  if [ "$1" = -C ]; then
    shift
    runtime="$1"
  fi
  shift
done
[ -n "$runtime" ] || exit 67
mkdir -p "$runtime/bin"
cat > "$runtime/bin/node" <<'NODE'
#!/bin/sh
printf 'runtime-node:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
case "$1" in
  --version|-v) printf '%s\n' "$INSTALLER_EXTRACTED_VERSION" ;;
  -p) printf '%s\n' 0.3.0 ;;
  *) [ "$INSTALLER_EXTRACTED_CAPABILITY" = pass ] ;;
esac
NODE
cat > "$runtime/bin/npm" <<'NPM'
#!/bin/sh
set -e
printf 'runtime-npm:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"
if [ "$1" = run ] && [ "$2" = server:build ]; then
  mkdir -p "$NODETERM_APP_DIR/out/server"
  : > "$NODETERM_APP_DIR/out/server/main.cjs"
fi
NPM
cat > "$runtime/bin/npx" <<'NPX'
#!/bin/sh
exit 0
NPX
chmod +x "$runtime/bin/node" "$runtime/bin/npm" "$runtime/bin/npx"`
  )
  writeShim(
    binDir,
    'df',
    String.raw`
printf '%s\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on'
printf '%s\n' 'fixture 1000000 0 1000000 0% /'`
  )
  writeShim(binDir, 'ldd', "printf '%s\\n' 'ldd (GNU libc) 2.39'")
  writeShim(binDir, 'systemctl', String.raw`printf 'systemctl:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"`)
  writeShim(binDir, 'loginctl', String.raw`printf 'loginctl:%s\n' "$*" >> "$INSTALLER_PROOF_LOG"`)
  for (const tool of ['make', 'gcc', 'python3', 'tmux']) writeShim(binDir, tool, 'exit 0')
}

function runInstaller(scenario: InstallerScenario): InstallerRun {
  const root = mkdtempSync(join(tmpdir(), 'nodeterm-install-server-'))
  scratchRoots.push(root)
  const binDir = join(root, 'bin')
  const home = join(root, 'home')
  const appDir = join(root, 'app')
  const dataDir = join(root, 'data')
  const proofLog = join(root, 'proof.log')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(home, { recursive: true })
  installFixtureShims(binDir)

  const env = pathsForPosixShellEnv(
    {
      ...inheritedEnv,
      HOME: home,
      INSTALLER_EXTRACTED_CAPABILITY: scenario.extractedCapability,
      INSTALLER_EXTRACTED_VERSION: scenario.extractedVersion,
      INSTALLER_PROOF_LOG: proofLog,
      INSTALLER_SYSTEM_CAPABILITY: scenario.systemCapability,
      INSTALLER_SYSTEM_VERSION: scenario.systemVersion,
      NODETERM_APP_DIR: appDir,
      NODETERM_DATA_DIR: dataDir,
      NODETERM_NODE_DIST_BASE: 'https://invalid.example/node-dist',
      NODETERM_NODE_VERSION: 'v24.15.0',
      NODETERM_NO_AUTOUPDATE: '1',
      NODETERM_REPO_URL: 'https://invalid.example/nodeterm.git'
    },
    ['HOME', 'INSTALLER_PROOF_LOG', 'NODETERM_APP_DIR', 'NODETERM_DATA_DIR']
  )
  const result = spawnSync(
    REAL_POSIX_SHELL,
    [
      '-c',
      'fixture_bin="$1"; shift; PATH="$fixture_bin:$PATH"; export PATH; ' +
        'for tool in id uname git node npm curl tar df ldd systemctl loginctl; do ' +
        'case "$(command -v "$tool")" in "$fixture_bin"/*) ;; *) exit 97 ;; esac; done; ' +
        'exec bash "$@"',
      'nodeterm-install-server-test',
      pathForPosixShell(binDir),
      pathForPosixShell(installer)
    ],
    {
      encoding: 'utf8',
      env: environmentForPosixShell(env),
      timeout: REAL_SHELL_TEST_TIMEOUT_MS
    }
  )

  const unitPath = join(home, '.config', 'systemd', 'user', 'nodeterm-server.service')
  return {
    appDir,
    log: existsSync(proofLog) ? readFileSync(proofLog, 'utf8') : '',
    runtimeNode: pathForPosixShell(join(appDir, 'runtime', 'node', 'bin', 'node')),
    runtimePresent: existsSync(join(appDir, 'runtime', 'node')),
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    systemNode: pathForPosixShell(join(binDir, 'node')),
    unit: existsSync(unitPath) ? readFileSync(unitPath, 'utf8') : null
  }
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 })
  }
})

const bashProbe = spawnSync(REAL_POSIX_SHELL, ['-c', 'command -v bash >/dev/null 2>&1'], {
  env: environmentForPosixShell(),
  stdio: 'ignore'
}).status === 0

describe.skipIf(!bashProbe)(
  'install-server under a real shell',
  { timeout: REAL_SHELL_TEST_TIMEOUT_MS },
  () => {
    it('keeps a supported system runtime for npm and the service ExecStart', () => {
      const run = runInstaller({
        extractedCapability: 'pass',
        extractedVersion: 'v24.15.0',
        systemCapability: 'pass',
        systemVersion: 'v24.15.0'
      })

      expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' })
      expect(run.log).toContain('system-npm:ci --ignore-scripts')
      expect(run.log).toContain('system-npm:run server:build')
      expect(run.log).not.toContain('runtime-npm:')
      expect(run.log).not.toContain('curl:')
      expect(run.log).not.toContain('tar:')
      expect(run.log).toContain('systemctl:--user restart nodeterm-server')
      expect(run.unit).toContain(`ExecStart=${run.systemNode} ${pathForPosixShell(run.appDir)}/out/server/main.cjs`)
    })

    it('provisions pinned Node 24.15.0 for a below-floor system runtime and uses it downstream', () => {
      const run = runInstaller({
        extractedCapability: 'pass',
        extractedVersion: 'v24.15.0',
        systemCapability: 'fail',
        systemVersion: 'v20.19.5'
      })

      expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' })
      expect(run.log).toContain(
        'curl:-fsSL https://invalid.example/node-dist/v24.15.0/node-v24.15.0-linux-x64.tar.gz -o'
      )
      expect(run.log).toContain('runtime-node:--version')
      expect(run.log).toContain('runtime-npm:ci --ignore-scripts')
      expect(run.log).toContain('runtime-npm:run server:build')
      expect(run.log).not.toContain('system-npm:')
      expect(run.log).toContain('systemctl:--user restart nodeterm-server')
      expect(run.unit).toContain(`ExecStart=${run.runtimeNode} ${pathForPosixShell(run.appDir)}/out/server/main.cjs`)
    })

    it('refuses a newly extracted supported-but-wrong Node 26 before npm or systemd', () => {
      const run = runInstaller({
        extractedCapability: 'pass',
        extractedVersion: 'v26.0.0',
        systemCapability: 'fail',
        systemVersion: 'v20.19.5'
      })

      expect(run.status).toBe(1)
      expect(run.stderr).toContain(
        'The provisioned runtime reported v26.0.0, but the requested and downloaded pin was v24.15.0'
      )
      expect(run.log).toContain('runtime-node:--version')
      expect(run.log).not.toContain('runtime-node:' + pathForPosixShell(join(run.appDir, 'scripts', 'check-node-runtime.mjs')))
      expect(run.log).not.toContain('system-npm:')
      expect(run.log).not.toContain('runtime-npm:')
      expect(run.log).not.toContain('systemctl:')
      expect(run.unit).toBeNull()
      expect(run.runtimePresent).toBe(false)
    })

    it('refuses an exact pinned runtime whose SQLite capability probe fails', () => {
      const run = runInstaller({
        extractedCapability: 'fail',
        extractedVersion: 'v24.15.0',
        systemCapability: 'fail',
        systemVersion: 'v20.19.5'
      })

      expect(run.status).toBe(1)
      expect(run.stderr).toContain(
        'does not provide the required unflagged node:sqlite DatabaseSync capability'
      )
      expect(run.log).toContain('runtime-node:--version')
      expect(run.log).toContain(
        'runtime-node:' + pathForPosixShell(join(run.appDir, 'scripts', 'check-node-runtime.mjs')) + ' --quiet'
      )
      expect(run.log).not.toContain('system-npm:')
      expect(run.log).not.toContain('runtime-npm:')
      expect(run.log).not.toContain('systemctl:')
      expect(run.unit).toBeNull()
      expect(run.runtimePresent).toBe(false)
    })
  }
)
