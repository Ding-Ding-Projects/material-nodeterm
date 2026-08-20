import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const core = require('../../scripts/windows-profile-packaged-acceptance-core.cjs') as {
  REQUIRED_EVIDENCE_IDS: readonly string[]
  buildProfileProbe: (profile: unknown, catalog: unknown[], options: unknown) => any
  createBuildProvenance: (options: Record<string, unknown>) => any
  createSourceSnapshot: (repo: string, head: string, options?: Record<string, unknown>) => any
  quoteWindowsArg: (value: string) => string
  runWithCleanup: <T>(work: () => Promise<T>, cleanup: (error?: Error) => Promise<void>) => Promise<T>
  runWithCleanupThenPromote: <T, R>(
    work: () => Promise<T>,
    cleanup: (error?: Error) => Promise<void>,
    promote: (value: T) => R | Promise<R>
  ) => Promise<R>
  selectHeadlessWindow: (payload: unknown, pid: number) => any
  sha256File: (file: string) => string
  validateCandidateProvenance: (options: Record<string, unknown>) => any
  validateCdpTargets: (targets: unknown[], options?: Record<string, unknown>) => any
  validateContinuity: (before: unknown, after: unknown) => any
  validateEvidenceRecords: (records: unknown[], directory: string, options?: Record<string, unknown>) => any
  validateCheapInvocation: (result: unknown, tool: string) => any
  validateIsolation: (options: Record<string, unknown>) => any
  validateProcessIdentity: (payload: unknown, pid: number, executable: string) => any
  validateProfileCatalog: (catalog: unknown[]) => unknown[]
  validateProfileResults: (catalog: unknown[], results: unknown[]) => unknown
}

const HEAD = '0123456789abcdef0123456789abcdef01234567'
const tempRoots: string[] = []

function write(file: string, value: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value)
}

function fixture(realAsar = false) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-win-profile-acceptance-'))
  tempRoots.push(repoRoot)
  write(path.join(repoRoot, '.git', 'HEAD'), `${HEAD}\n`)
  write(path.join(repoRoot, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  write(path.join(repoRoot, 'src', 'main', 'index.ts'), 'export const source = 1\n')
  write(path.join(repoRoot, 'src', 'session-host', 'host.ts'), 'export const host = 1\n')
  write(path.join(repoRoot, 'scripts', 'build.mjs'), 'export {}\n')
  write(path.join(repoRoot, 'build', 'icon.ico'), Buffer.from('icon'))
  write(path.join(repoRoot, 'resources', 'licenses', 'notice.txt'), 'notice\n')

  const capturedAtMs = Date.now() - 20_000
  const sourceSnapshot = core.createSourceSnapshot(repoRoot, HEAD, { capturedAtMs })
  const artifacts: Record<string, string> = {
    outMain: path.join(repoRoot, 'out', 'main', 'index.js'),
    outPreload: path.join(repoRoot, 'out', 'preload', 'index.js'),
    outRenderer: path.join(repoRoot, 'out', 'renderer', 'index.html'),
    outSessionHost: path.join(repoRoot, 'out', 'session-host', 'host.cjs'),
    candidate: path.join(repoRoot, 'dist', 'win-unpacked', 'nodeterm.exe'),
    appAsar: path.join(repoRoot, 'dist', 'win-unpacked', 'resources', 'app.asar'),
    sessionHost: path.join(repoRoot, 'dist', 'win-unpacked', 'resources', 'session-host', 'host.cjs'),
    packagedNodePty: path.join(
      repoRoot,
      'dist',
      'win-unpacked',
      'resources',
      'session-host',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'conpty.node'
    ),
    setup: path.join(repoRoot, 'dist', 'squirrel-windows', 'nodeterm-Setup-1.2.3.exe'),
    releases: path.join(repoRoot, 'dist', 'squirrel-windows', 'RELEASES'),
    nupkg: path.join(repoRoot, 'dist', 'squirrel-windows', 'nodeterm-1.2.3-full.nupkg')
  }
  Object.entries(artifacts).forEach(([role, file], index) =>
    write(file, role === 'setup' ? Buffer.alloc(5 * 1024 * 1024, index + 1) : Buffer.from(`${role}:${index}`))
  )
  // These outputs must be byte-for-byte copies across their packaging boundaries.
  write(artifacts.sessionHost, fs.readFileSync(artifacts.outSessionHost))
  const sourceNodePty = path.join(repoRoot, 'node_modules', 'node-pty', 'build', 'Release', 'conpty.node')
  write(sourceNodePty, fs.readFileSync(artifacts.packagedNodePty))
  const asarEntries = ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']
  const listAsarFiles = () => [
    '/out/main',
    '/out/main/index.js',
    '/out/preload',
    '/out/preload/index.js',
    '/out/renderer',
    '/out/renderer/index.html'
  ]
  const extractAsarFile = (_file: string, entry: string) => fs.readFileSync(path.join(repoRoot, ...entry.split('/')))
  if (realAsar) {
    const stage = path.join(repoRoot, 'asar-stage')
    for (const entry of asarEntries) write(path.join(stage, ...entry.split('/')), fs.readFileSync(path.join(repoRoot, ...entry.split('/'))))
    const script =
      "require('@electron/asar').createPackage(process.argv[1],process.argv[2])" +
      ".then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})"
    const packed = spawnSync(process.execPath, ['-e', script, stage, artifacts.appAsar], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000
    })
    if (packed.status !== 0) throw new Error(`Could not create fixture app.asar: ${packed.stderr}`)
  }

  const buildOptions = {
    repoRoot,
    expectedCommit: HEAD,
    sourceSnapshot,
    minimumSetupBytes: 1,
    sourceNodePty,
    listAsarFiles,
    extractAsarFile,
    ...artifacts,
    recordedAtMs: capturedAtMs + 10_000
  }
  const provenance = core.createBuildProvenance(buildOptions)
  const taskRoot = path.join(repoRoot, 'acceptance-task')
  const provenanceFile = path.join(taskRoot, 'build-provenance.json')
  write(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`)
  const validationOptions = {
    repoRoot,
    expectedCommit: HEAD,
    provenance: provenanceFile,
    minimumSetupBytes: 1,
    sourceNodePty,
    listAsarFiles,
    extractAsarFile,
    ...artifacts
  }
  return { repoRoot, capturedAtMs, sourceSnapshot, artifacts, provenanceFile, taskRoot, validationOptions, buildOptions }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of tempRoots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      throw new Error(`Refusing to remove non-temp test fixture ${resolved}`)
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

describe('dirty working-tree build provenance', () => {
  it('binds HEAD plus every frozen source/build byte to the packaged executable hash', () => {
    const f = fixture(true)
    const validated = core.validateCandidateProvenance(f.validationOptions)
    expect(validated.commit).toBe(HEAD)
    expect(validated.workingTreeDigest).toBe(f.sourceSnapshot.workingTreeDigest)
    expect(validated.artifacts['packaged-executable'].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(validated.artifacts['out-main'].sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('turns red when one snapshotted byte changes', () => {
    const f = fixture()
    write(path.join(f.repoRoot, 'src', 'main', 'index.ts'), 'export const source = 2\n')
    expect(() => core.validateCandidateProvenance(f.validationOptions)).toThrow(/changed:src\/main\/index\.ts/)
  })

  it('turns red when a shipping path is added or removed', () => {
    const added = fixture()
    write(path.join(added.repoRoot, 'scripts', 'new-build-step.mjs'), 'export {}\n')
    expect(() => core.validateCandidateProvenance(added.validationOptions)).toThrow(/added:scripts\/new-build-step\.mjs/)

    const removed = fixture()
    fs.rmSync(path.join(removed.repoRoot, 'resources', 'licenses', 'notice.txt'))
    expect(() => core.validateCandidateProvenance(removed.validationOptions)).toThrow(/removed:resources\/licenses\/notice\.txt/)
  })

  it('turns red when checkout HEAD changes even if shipping bytes do not', () => {
    const f = fixture()
    write(path.join(f.repoRoot, '.git', 'HEAD'), '89abcdef0123456789abcdef0123456789abcdef\n')
    expect(() => core.validateCandidateProvenance(f.validationOptions)).toThrow(/does not match checkout HEAD/)
  })

  it('rejects a changed artifact hash and an out binary older than the frozen snapshot', () => {
    const changed = fixture()
    write(changed.artifacts.candidate, 'different executable')
    expect(() => core.validateCandidateProvenance(changed.validationOptions)).toThrow(/no longer matches/)

    const stale = fixture()
    const beforeSnapshot = new Date(stale.sourceSnapshot.capturedAtMs - 1_000)
    fs.utimesSync(stale.artifacts.outMain, beforeSnapshot, beforeSnapshot)
    expect(() => core.validateCandidateProvenance(stale.validationOptions)).toThrow(/out-main predates/)
  })

  it('rejects an app.asar payload or packaged native binding that differs from its build input', () => {
    const asarMismatch = fixture()
    expect(() =>
      core.createBuildProvenance({
        ...asarMismatch.buildOptions,
        extractAsarFile: () => Buffer.from('wrong packaged bytes')
      })
    ).toThrow(/does not match the local build output/)

    const nativeMismatch = fixture()
    write(nativeMismatch.artifacts.packagedNodePty, 'wrong native binding')
    expect(() => core.createBuildProvenance(nativeMismatch.buildOptions)).toThrow(/does not match the rebuilt source binding/)
  })

  it('categorizes a malformed or in-progress app.asar without leaking a raw parser RangeError', () => {
    const f = fixture()
    const { listAsarFiles: _list, extractAsarFile: _extract, ...options } = f.validationOptions
    expect(() => core.validateCandidateProvenance(options)).toThrow(/app\.asar is malformed or still being written/)
  })
})

describe('task ownership and dynamic UI identity', () => {
  it('keeps the orchestrator in zero-write, zero-Cheap-subprocess plan mode without --execute', () => {
    const f = fixture(true)
    const lowlevelRoot = path.join(f.taskRoot, 'lowlevel-computer-use-mcp')
    const cheap = path.join(lowlevelRoot, '.venv', 'Scripts', 'lowlevel-computer-use-cheap.exe')
    const invocationMarker = path.join(f.taskRoot, 'cheap-was-invoked.txt')
    write(cheap, `this is deliberately not executable; touching ${invocationMarker} would fail the test`)
    const runner = path.resolve(process.cwd(), 'scripts', 'run-windows-profile-packaged-acceptance.mjs')
    const result = spawnSync(
      process.execPath,
      [
        runner,
        '--repo',
        f.repoRoot,
        '--head',
        HEAD,
        '--provenance',
        f.provenanceFile,
        '--cheap',
        cheap,
        '--lowlevel-root',
        lowlevelRoot,
        '--task-root',
        f.taskRoot,
        '--run-id',
        'dry-plan-1234',
        '--first-port',
        '19411',
        '--second-port',
        '19412'
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'plan-only',
      runId: 'dry-plan-1234',
      copyPaste: { status: 'blocked' },
      installer: { status: 'blocked' }
    })
    expect(fs.existsSync(invocationMarker)).toBe(false)
    for (const name of ['appdata', 'localappdata', 'chromium-profile', 'temp', 'project', 'driver-state.json', 'evidence']) {
      expect(fs.existsSync(path.join(f.taskRoot, name))).toBe(false)
    }
  })

  it('keeps all mutable application paths below the exact task root', () => {
    const root = path.join(os.tmpdir(), 'nt-owner-fixture')
    expect(
      core.validateIsolation({
        taskRoot: root,
        appData: path.join(root, 'appdata'),
        localAppData: path.join(root, 'localappdata'),
        chromiumProfile: path.join(root, 'chromium'),
        tempDirectory: path.join(root, 'temp'),
        projectDirectory: path.join(root, 'project'),
        stateFile: path.join(root, 'state.json')
      })
    ).toMatchObject({ taskRoot: path.resolve(root) })
    expect(() =>
      core.validateIsolation({
        taskRoot: root,
        appData: path.join(root, 'appdata'),
        localAppData: path.join(root, 'localappdata'),
        chromiumProfile: path.join(root, 'chromium'),
        tempDirectory: path.join(root, 'temp'),
        projectDirectory: path.join(root, 'project'),
        stateFile: path.join(root, '..', 'escaped.json')
      })
    ).toThrow(/must stay inside/)
  })

  it('rejects stale, ambiguous, or non-Chromium PID/HWND matches', () => {
    // The fixture carries a title because the real application window has one. Without it this
    // fixture was describing a window the app never produces, which is how the selector shipped
    // with a filter that could not tell the app window from its own same-PID helper.
    const good = {
      handle: 101,
      process_id: 44,
      class: 'Chrome_WidgetWin_1',
      width: 1000,
      height: 700,
      title: 'nodeterm',
    }
    expect(core.selectHeadlessWindow({ ok: true, windows: [good] }, 44)).toMatchObject({ hwnd: 101, pid: 44 })
    expect(() => core.selectHeadlessWindow({ ok: true, windows: [good] }, 45)).toThrow(/found 0/)
    expect(() => core.selectHeadlessWindow({ ok: true, windows: [good, { ...good, handle: 102 }] }, 44)).toThrow(
      /found 2/
    )
    expect(() =>
      core.selectHeadlessWindow({ ok: true, windows: [{ ...good, class: 'Notepad' }] }, 44)
    ).toThrow(/found 0/)

    // The case that actually happened, transcribed from a real headless enumeration of this app's
    // packaged build: one PID, thirteen top-level windows, and TWO that pass on class and size —
    // the app window, and a same-PID Chrome_WidgetWin_0 at 1440x753 with no title. Before the
    // title requirement this threw "found 2" and every acceptance run died at launch.
    const helper = { handle: 102, process_id: 44, class: 'Chrome_WidgetWin_0', width: 1440, height: 753, title: '' }
    expect(core.selectHeadlessWindow({ ok: true, windows: [good, helper] }, 44)).toMatchObject({
      hwnd: 101,
      title: 'nodeterm',
    })
    // Order must not decide it. A filter that took the first match would pass the line above and
    // still drive the wrong window whenever the enumeration came back the other way round.
    expect(core.selectHeadlessWindow({ ok: true, windows: [helper, good] }, 44)).toMatchObject({ hwnd: 101 })
    // Whitespace is not a title.
    expect(() =>
      core.selectHeadlessWindow({ ok: true, windows: [{ ...good, title: '   ' }] }, 44)
    ).toThrow(/found 0/)
    // Two genuinely titled windows stay a loud failure rather than a coin toss.
    expect(() =>
      core.selectHeadlessWindow({ ok: true, windows: [good, { ...helper, title: 'nodeterm' }] }, 44)
    ).toThrow(/found 2/)

    const candidate = path.resolve('C:\\artifact path\\nodeterm.exe')
    expect(core.validateProcessIdentity({ exists: true, pid: 44, executable: candidate, parentPid: 1 }, 44, candidate)).toMatchObject({
      pid: 44,
      executable: candidate
    })
    expect(() => core.validateProcessIdentity({ exists: true, pid: 45, executable: candidate }, 44, candidate)).toThrow(
      /stale PID/
    )
    expect(() =>
      core.validateProcessIdentity({ exists: true, pid: 44, executable: path.resolve('C:\\other.exe') }, 44, candidate)
    ).toThrow(/not the packaged candidate/)
  })

  it('accepts exactly one packaged file target and rejects wrong or multiple targets', () => {
    const expected = 'C:\\Program Files\\nodeterm\\resources\\app.asar\\out\\renderer\\index.html'
    const target = {
      id: 'page-1',
      type: 'page',
      url: 'file:///C:/Program%20Files/nodeterm/resources/app.asar/out/renderer/index.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9411/devtools/page/page-1'
    }
    expect(core.validateCdpTargets([target], { expectedRendererFile: expected, expectedPort: 9411 })).toMatchObject({ id: 'page-1' })
    expect(() => core.validateCdpTargets([{ ...target, url: 'https://example.test/' }])).toThrow(/must use file:/)
    expect(() => core.validateCdpTargets([{ ...target, url: 'file:///C:/tmp/index.html' }])).toThrow(
      /not the packaged renderer/
    )
    expect(() =>
      core.validateCdpTargets(
        [{ ...target, url: 'file:///C:/other/resources/app.asar/out/renderer/index.html' }],
        { expectedRendererFile: expected }
      )
    ).toThrow(/exact candidate renderer/)
    expect(() =>
      core.validateCdpTargets([{ ...target, webSocketDebuggerUrl: 'wss://127.0.0.1:9411/devtools/page/page-1' }], {
        expectedRendererFile: expected,
        expectedPort: 9411
      })
    ).toThrow(/unencrypted ws/)
    expect(() =>
      core.validateCdpTargets([{ ...target, webSocketDebuggerUrl: 'ws://localhost:9411/devtools/page/page-1' }], {
        expectedRendererFile: expected,
        expectedPort: 9411
      })
    ).toThrow(/127\.0\.0\.1/)
    expect(() =>
      core.validateCdpTargets([{ ...target, webSocketDebuggerUrl: 'ws://127.0.0.1:9511/devtools/page/page-1' }], {
        expectedRendererFile: expected,
        expectedPort: 9411
      })
    ).toThrow(/stale\/wrong port/)
    expect(() => core.validateCdpTargets([target, { ...target, id: 'page-2' }])).toThrow(/found 2/)
  })
})

// A real, decodable PNG — validateEvidenceRecords re-parses IHDR/IDAT/IEND with real per-chunk
// CRC-32 verification, an inflate of the pixel data, and a "not a uniform/blank surface" check
// (see decodeAcceptancePng), so a signature-only stub with zeroed CRC bytes and non-deflated
// filler no longer passes. Minimum accepted size is exactly 1000x700 (below that is "blank");
// every scanline uses PNG filter type 0 ("None") over an RGBA (color type 6) gradient keyed by
// `fill` so distinct calls decode to genuinely distinct, non-uniform pixel data.
function png(fill: number) {
  const width = 1_000
  const height = 700
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const raw = Buffer.alloc((stride + 1) * height)
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (stride + 1)
    raw[rowStart] = 0 // filter type "None"
    for (let column = 0; column < stride; column += 1) {
      raw[rowStart + 1 + column] = (fill + row + column) & 0xff
    }
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type: string, data: Buffer) => {
    const value = Buffer.alloc(12 + data.length)
    value.writeUInt32BE(data.length, 0)
    value.write(type, 4, 'ascii')
    data.copy(value, 8)
    value.writeUInt32BE(zlib.crc32(value.subarray(4, 8 + data.length)), 8 + data.length)
    return value
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // color type: truecolor with alpha (RGBA)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

describe('evidence promotion guards', () => {
  it('requires every exact id and distinct PNG bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-profile-evidence-'))
    tempRoots.push(root)
    // A record's `bytes`/`sha256` are the CAPTURER's claim, verified against the file's real bytes
    // by validateEvidenceRecords — they are not derived by the function itself. Compute them the
    // same way a real capture harness would, or the very first (honest, distinct) fixture trips
    // the "changed after capture" guard before the byte-identical check under test ever runs.
    const records = core.REQUIRED_EVIDENCE_IDS.map((id, index) => {
      const file = path.join(root, `${id}.png`)
      write(file, png(index + 1))
      return { id, file, bytes: fs.statSync(file).size, sha256: core.sha256File(file) }
    })
    expect(core.validateEvidenceRecords(records, root)).toHaveLength(core.REQUIRED_EVIDENCE_IDS.length)

    // Overwriting the bytes on disk without updating the claim would report "changed after
    // capture" instead of the byte-identical collision this asserts — refresh the claim to match
    // the (now duplicate) real content so the collision check is what actually fires.
    write(records[1].file, fs.readFileSync(records[0].file))
    records[1].bytes = fs.statSync(records[1].file).size
    records[1].sha256 = core.sha256File(records[1].file)
    expect(() => core.validateEvidenceRecords(records, root)).toThrow(/byte-identical/)
  })

  it('turns red on duplicate or missing evidence ids', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-profile-evidence-'))
    tempRoots.push(root)
    const records = core.REQUIRED_EVIDENCE_IDS.map((id, index) => {
      const file = path.join(root, `${id}.png`)
      write(file, png(index + 1))
      return { id, file, bytes: fs.statSync(file).size, sha256: core.sha256File(file) }
    })
    expect(() => core.validateEvidenceRecords([...records, records[0]], root)).toThrow(/Duplicate evidence id/)
    expect(() => core.validateEvidenceRecords(records.slice(1), root)).toThrow(/Missing required evidence id/)
  })
})

describe('profile probe literal encoding', () => {
  const hostileId = "wsl:Distro space &|<>^%!'$`"
  const hostile = { id: hostileId, label: 'Hostile fixture', kind: 'wsl', available: true }

  // buildProfileProbe never interpolates the raw profile id into generated command text at
  // all — only a SHA-256 tag derived from it (`profileTag`) reaches the marker/parse-tag
  // strings, and the whole POSIX probe script is base64-encoded and piped through `sh` rather
  // than embedded with `sh -lc` + escaping. That is a stronger guarantee than quoting the id
  // (there is nothing for &|<>^%!'$` to break out of, because the id is never shell syntax or
  // parse-tag text in the first place) — see the "Profile IDs deliberately support WSL
  // distribution names…" comment on buildProfileProbe. Assert the real mechanism.
  it('keeps hostile WSL profile-id metacharacters out of the generated command entirely', () => {
    const probe = core.buildProfileProbe(hostile, [hostile], { token: 'safe-token' })
    expect(probe.dialect).toBe('wsl')
    const match = probe.command.match(/^printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d \| sh\r$/)
    expect(match).not.toBeNull()
    expect(probe.command).not.toContain(hostileId)
    expect(probe.marker).not.toContain(hostileId)
    const decoded = Buffer.from(match![1], 'base64').toString('utf8')
    expect(decoded).not.toContain(hostileId)
    expect(decoded).toContain('wslpath -w "$PWD"')
    expect(decoded).toContain(`'${probe.marker}'`)
    expect(decoded).toContain(`'${probe.unicode}'`)
  })

  it('keeps a hostile cmd profile id out of its base64-encoded PowerShell child', () => {
    const cmdProfile = { ...hostile, id: `cmd:${hostileId}`, kind: 'cmd' }
    const probe = core.buildProfileProbe(cmdProfile, [cmdProfile], { token: 'safe-token' })
    const match = probe.command.match(/-EncodedCommand ([A-Za-z0-9+/=]+)\r$/)
    expect(match).not.toBeNull()
    expect(probe.command).not.toContain(cmdProfile.id)
    const decoded = Buffer.from(match![1], 'base64').toString('utf16le')
    expect(decoded).not.toContain(cmdProfile.id)
    expect(decoded).toContain('[Console]::OutputEncoding')
    expect(decoded).toContain(`'${probe.marker}'`)
  })

  it('rejects private spawn material or duplicate public ids in the renderer catalog', () => {
    expect(() => core.validateProfileCatalog([{ ...hostile, executable: 'pwsh.exe' }])).toThrow(/leaked private field/)
    expect(() => core.validateProfileCatalog([hostile, { ...hostile }])).toThrow(/Duplicate/)
  })

  it('requires every available profile to prove visible label, I/O, Unicode, cwd, size, and live resize', () => {
    const result = {
      id: hostile.id,
      labelVerified: true,
      inputOutputVerified: true,
      unicodeVerified: true,
      cwdVerified: true,
      sizeVerified: true,
      resizeVerified: true
    }
    expect(core.validateProfileResults([hostile], [result])).toEqual([hostile.id])
    expect(() => core.validateProfileResults([hostile], [{ ...result, resizeVerified: false }])).toThrow(/live PTY resize/)
  })
})

describe('Cheap process boundary and Windows argv', () => {
  it('quotes executable paths, embedded quotes, and trailing backslashes as one Windows argument', () => {
    expect(core.quoteWindowsArg('C:\\Program Files\\nodeterm.exe')).toBe('"C:\\Program Files\\nodeterm.exe"')
    expect(core.quoteWindowsArg('plain')).toBe('plain')
    expect(core.quoteWindowsArg('C:\\path with space\\')).toBe('"C:\\path with space\\\\"')
    expect(core.quoteWindowsArg('say "hello"')).toBe('"say \\"hello\\""')
  })

  it('rejects CLI exit-zero tool failures, malformed output, timeout exits, and child failures', () => {
    expect(core.validateCheapInvocation({ status: 0, stdout: '{"ok":true}', stderr: '' }, 'list_headless_windows')).toMatchObject({
      ok: true
    })
    expect(() => core.validateCheapInvocation({ status: 0, stdout: '{"ok":false,"error":"blocked"}' }, 'screenshot')).toThrow(
      /blocked/
    )
    expect(() => core.validateCheapInvocation({ status: 0, stdout: 'not json' }, 'screenshot')).toThrow(/malformed JSON/)
    expect(() => core.validateCheapInvocation({ status: 9, stdout: '', stderr: 'timed out' }, 'run_command')).toThrow(/exited 9/)
    expect(() =>
      core.validateCheapInvocation(
        { status: 0, stdout: '{"ok":true,"returncode":3,"stderr":"child failed"}' },
        'run_command'
      )
    ).toThrow(/child exited 3/)
  })
})

describe('session-host continuity and cleanup precedence', () => {
  const before = {
    mainPid: 100,
    hwnd: 1000,
    sessionHostPid: 200,
    sessionHostStartedAt: '2026-08-16T00:00:00.000Z',
    sessionHostProtocolVersion: '1',
    terminalProcessPid: 300,
    marker: 'NT_CONTINUITY:fixture',
    tick: 4
  }
  const after = {
    ...before,
    mainPid: 101,
    hwnd: 1001,
    tick: 8,
    screen: 'NT_CONTINUITY:fixture:PID=300:TICK=8'
  }

  it('requires new UI identity, the same host/process identity, reconstructed screen, and a newer tick', () => {
    expect(core.validateContinuity(before, after)).toMatchObject({ sessionHostPid: 200, terminalProcessPid: 300 })
    expect(() => core.validateContinuity(before, { ...after, mainPid: before.mainPid })).toThrow(/main-process PID/)
    expect(() => core.validateContinuity(before, { ...after, hwnd: before.hwnd })).toThrow(/old HWND/)
    expect(() => core.validateContinuity(before, { ...after, sessionHostPid: 201 })).toThrow(/host PID changed/)
    expect(() => core.validateContinuity(before, { ...after, terminalProcessPid: 301 })).toThrow(/process PID changed/)
    expect(() => core.validateContinuity(before, { ...after, screen: 'old output only' })).toThrow(/does not contain/)
    expect(() => core.validateContinuity(before, { ...after, tick: 4 })).toThrow(/newer live output/)
  })

  it('preserves the primary failure while appending cleanup failure details', async () => {
    const primary = new Error('primary acceptance failure')
    await expect(
      core.runWithCleanup(
        async () => {
          throw primary
        },
        async () => {
          throw new Error('cleanup failure')
        }
      )
    ).rejects.toThrow(/primary acceptance failure\nCleanup also failed: cleanup failure/)

    await expect(
      core.runWithCleanup(async () => 'ok', async () => {
        throw new Error('cleanup-only failure')
      })
    ).rejects.toThrow(/cleanup-only failure/)
  })

  it('never promotes final evidence until cleanup has succeeded', async () => {
    const promote = vi.fn((value: string) => `promoted:${value}`)
    await expect(
      core.runWithCleanupThenPromote(
        async () => 'staged',
        async () => {
          throw new Error('cleanup stopped promotion')
        },
        promote
      )
    ).rejects.toThrow(/cleanup stopped promotion/)
    expect(promote).not.toHaveBeenCalled()

    await expect(core.runWithCleanupThenPromote(async () => 'staged', async () => {}, promote)).resolves.toBe(
      'promoted:staged'
    )
    expect(promote).toHaveBeenCalledOnce()
  })
})
