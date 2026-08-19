/**
 * Detecting a usable local Java runtime, for the Java-compatibility check `version-resolve.ts`
 * already has the pure half of (`checkJavaCompatibility`). This file supplies the other half:
 * which `java` this machine actually has, and what major version it reports.
 *
 * Two pieces, kept apart on purpose so the one worth unit-testing (parsing) never needs a real
 * process:
 *
 *  - `parseJavaMajorVersion` — pure. `java -version` (and the newer `--version`) print to STDERR,
 *    and the quoted version string has had two shapes in the wild: the pre-Java-9 scheme
 *    (`java version "1.8.0_301"`, major is the SECOND dotted component) and Java 9+
 *    (`openjdk version "17.0.2" 2022-01-18` or a bare `"21"`, major is the FIRST). Anything else
 *    returns `null` rather than a guess — a wrong major fed into `checkJavaCompatibility` would
 *    produce a confidently WRONG verdict, which is worse than an honestly unknown one.
 *  - `detectInstalledJava` — resolves an executable (PATH, then `JAVA_HOME`, via the same
 *    subprocess-free `findExecutableSync` GUI apps already use to find `git`/`code`/`ssh`) and
 *    verifies it the way `vscode-detect.ts` verifies VS Code: by actually running it, never by a
 *    path merely existing.
 *
 * DELIBERATELY NOT DONE HERE: scanning `Program Files\Java\*` / `/usr/lib/jvm/*` for an install
 * nothing put on PATH or JAVA_HOME. Every mainstream Java distribution's installer offers to set
 * one of those two, so this covers the common case honestly; a JDK installed with both declined is
 * reported as "no Java could be detected", not silently found by guessing at a version-numbered
 * directory name. See docs/minecraft-server-manager.md.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import unzipper from 'unzipper'
import { findExecutableSync } from '../exec-path'
import { renameAtomic } from '../fs-atomic'

const execFileP = promisify(execFile)

export function parseJavaMajorVersion(output: string): number | null {
  const m = output.match(/version\s+"([^"]+)"/)
  if (!m) return null
  const v = m[1]
  const legacy = v.match(/^1\.(\d+)(?:[._].*)?$/)
  if (legacy) return Number(legacy[1])
  const modern = v.match(/^(\d+)/)
  return modern ? Number(modern[1]) : null
}

function javaHomeCandidate(): string | null {
  const home = process.env.JAVA_HOME
  if (!home) return null
  return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
}

/** Subprocess-free — a PATH/JAVA_HOME walk with an access check, same as every other executable
 *  lookup in this codebase. Never spawns, so it is safe to call from the main thread. */
export function resolveJavaExecutable(managedCandidates: string[] = []): string | null {
  const home = javaHomeCandidate()
  return findExecutableSync('java', [...managedCandidates, ...(home ? [home] : [])])
}

export interface JavaProbe {
  path: string | null
  major: number | null
}

/** Injected so `detectInstalledJava` never needs a real process in a test. Production runs
 *  `<javaPath> -version` and reads BOTH streams: `-version`'s banner is on stderr for every
 *  distribution measured, but a stray ancient JVM or a shell wrapper writing to stdout should
 *  still parse rather than reporting "no Java" for a Java that is plainly right there. */
export type RunJavaVersion = (javaPath: string) => Promise<string>

const defaultRunJavaVersion: RunJavaVersion = async (javaPath) => {
  try {
    const { stderr, stdout } = await execFileP(javaPath, ['-version'], {
      timeout: 8000,
      windowsHide: true
    })
    return `${stderr}\n${stdout}`
  } catch (e) {
    // A nonzero exit (some antique or misconfigured JVMs) can still carry the version banner on
    // one of the streams — Node attaches both to the thrown error. Read them rather than treating
    // any nonzero exit as "no Java at all".
    const err = e as { stderr?: string; stdout?: string }
    return `${err.stderr ?? ''}\n${err.stdout ?? ''}`
  }
}

export async function detectInstalledJava(
  resolve: () => string | null = resolveJavaExecutable,
  run: RunJavaVersion = defaultRunJavaVersion
): Promise<JavaProbe> {
  const javaPath = resolve()
  if (!javaPath) return { path: null, major: null }
  const output = await run(javaPath)
  return { path: javaPath, major: parseJavaMajorVersion(output) }
}

const ADOPTIUM_API = 'https://api.adoptium.net'

interface AdoptiumAsset {
  binary?: {
    package?: { checksum?: string; link?: string; name?: string }
  }
}

export interface EnsureJavaOptions {
  userDataDir: string
  requiredMajor: number
  fetchJson?: (url: string) => Promise<unknown>
  fetchBinary?: (url: string) => Promise<Response>
  detect?: () => Promise<JavaProbe>
}

function runtimePlatform(): { os: string; arch: string; executable: string } {
  if (process.platform !== 'win32') {
    throw new Error('Automatic Java installation is currently available on Windows only.')
  }
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) throw new Error(`Automatic Java installation does not support ${process.arch}.`)
  return { os: 'windows', arch, executable: 'java.exe' }
}

function safeZipEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[A-Za-z]:/.test(normalized) &&
    normalized.split('/').every((part) => part !== '..')
  )
}

async function findManagedJava(root: string, executable: string): Promise<string | null> {
  const marker = path.join(root, 'runtime.json')
  try {
    const parsed = JSON.parse(await readFile(marker, 'utf-8')) as { javaPath?: unknown }
    if (typeof parsed.javaPath !== 'string') return null
    const candidate = path.resolve(root, parsed.javaPath)
    if (!candidate.startsWith(`${path.resolve(root)}${path.sep}`)) return null
    await access(candidate)
    return candidate
  } catch {
    return null
  }
}

/** Obtain the exact Java major the selected Minecraft server needs. The runtime is private to
 * nodeterm's app-data directory: no administrator rights, PATH mutation, installer prompt, or
 * machine-wide toolchain change. Adoptium supplies both the archive URL and SHA-256; neither a
 * filename nor a successful HTTP response is accepted as integrity evidence. */
export async function ensureJavaRuntime(opts: EnsureJavaOptions): Promise<JavaProbe> {
  const platform = runtimePlatform()
  const root = path.join(opts.userDataDir, 'runtimes', 'java', String(opts.requiredMajor), `${platform.os}-${platform.arch}`)
  const cached = await findManagedJava(root, platform.executable)
  const detect = opts.detect ?? (() => detectInstalledJava(() => resolveJavaExecutable(cached ? [cached] : [])))
  const existing = await detect()
  if (existing.path && existing.major !== null && existing.major >= opts.requiredMajor) return existing

  const fetchJson = opts.fetchJson ?? (async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Java metadata download failed (HTTP ${response.status}).`)
    return response.json()
  })
  const fetchBinary = opts.fetchBinary ?? ((url: string) => fetch(url))
  const metadataUrl = `${ADOPTIUM_API}/v3/assets/latest/${opts.requiredMajor}/hotspot?architecture=${platform.arch}&image_type=jre&os=${platform.os}&vendor=eclipse`
  const metadata = await fetchJson(metadataUrl)
  const asset = Array.isArray(metadata) ? (metadata[0] as AdoptiumAsset | undefined) : undefined
  const pkg = asset?.binary?.package
  if (!pkg?.link || !pkg.checksum || !/^[a-f0-9]{64}$/i.test(pkg.checksum)) {
    throw new Error(`Adoptium did not publish a usable Java ${opts.requiredMajor} runtime and checksum for this machine.`)
  }
  const downloadUrl = new URL(pkg.link)
  if (downloadUrl.protocol !== 'https:') throw new Error('The Java runtime download is not HTTPS; refusing it.')

  const parent = path.dirname(root)
  const staging = `${root}.install-${process.pid}-${Date.now()}`
  const archive = `${staging}.zip`
  await mkdir(parent, { recursive: true })
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    const response = await fetchBinary(downloadUrl.toString())
    if (!response.ok || !response.body) throw new Error(`Java runtime download failed (HTTP ${response.status}).`)
    const hash = createHash('sha256')
    const file = createWriteStream(archive, { flags: 'wx', mode: 0o600 })
    const reader = response.body.getReader()
    await pipeline(
      async function* () {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          hash.update(value)
          yield Buffer.from(value)
        }
      },
      file
    )
    if (hash.digest('hex').toLowerCase() !== pkg.checksum.toLowerCase()) {
      throw new Error('The Java runtime did not match Adoptium’s published SHA-256 checksum.')
    }
    const directory = await unzipper.Open.file(archive)
    if (directory.files.some((entry) => !safeZipEntry(entry.path))) {
      throw new Error('The Java runtime archive contains an unsafe path; refusing it.')
    }
    await directory.extract({ path: staging })
    const javaEntry = directory.files.find((entry) => entry.path.replace(/\\/g, '/').endsWith('/bin/java.exe'))
    if (!javaEntry) throw new Error('The Java runtime archive does not contain bin/java.exe.')
    const javaPath = path.join(staging, ...javaEntry.path.replace(/\\/g, '/').split('/'))
    await access(javaPath)
    const relativeJavaPath = path.relative(staging, javaPath)
    await writeFile(path.join(staging, 'runtime.json'), JSON.stringify({ javaPath: relativeJavaPath }, null, 2), 'utf-8')
    await rm(root, { recursive: true, force: true })
    // renameAtomic, not a bare rename: Defender/the indexer briefly opening `root` right after we
    // just cleared it is exactly the transient case the retry exists for on Windows.
    await renameAtomic(staging, root)
    const installedPath = path.join(root, relativeJavaPath)
    const installed = await detectInstalledJava(() => installedPath)
    if (installed.major === null || installed.major < opts.requiredMajor) {
      await rm(root, { recursive: true, force: true })
      throw new Error(`The downloaded Java runtime did not report Java ${opts.requiredMajor} or newer.`)
    }
    return installed
  } finally {
    await rm(archive, { force: true }).catch(() => {})
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}
