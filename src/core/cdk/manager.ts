import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  CDK_MAX_ASSET_BYTES,
  CDK_MAX_ASSETS,
  CDK_MAX_OUTPUT_BYTES,
  CDK_MAX_SCAN_FILES,
  CDK_TOOLKIT_VERSION,
  isCdkReviewedChange,
  type CdkApi,
  type CdkAsset,
  type CdkCommandResult,
  type CdkDependencyStatus,
  type CdkDetectedProject,
  type CdkEvent,
  type CdkLanguage,
  type CdkOperation,
  type CdkStatus,
  type CdkTrustReview
} from '../../shared/cdk'

const UNSAFE_APP = /[;&|><`$\r\n]/
const MANIFEST_NAMES = ['cdk.json', 'package.json', 'requirements.txt', 'pyproject.toml', 'pom.xml']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.java', '.cs', '.fs'])

function cdkEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'Path', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec',
    'NODE_PATH', 'AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_CONFIG_FILE',
    'AWS_SHARED_CREDENTIALS_FILE', 'CDK_DEFAULT_ACCOUNT', 'CDK_DEFAULT_REGION'
  ])
  const env: NodeJS.ProcessEnv = { CI: '1', CDK_DISABLE_VERSION_CHECK: '1' }
  for (const [key, value] of Object.entries(process.env)) if (allowed.has(key) && value !== undefined) env[key] = value
  return env
}

export interface CdkManagerOptions {
  now?: () => number
  spawnFn?: typeof spawn
}

interface ProjectSnapshot {
  detected: CdkDetectedProject
  trust: CdkTrustReview
  dependencies: CdkDependencyStatus
}

function trimOutput(state: { text: string; bytes: number; truncated: boolean }, chunk: Buffer | string): void {
  const value = Buffer.from(chunk)
  if (state.bytes >= CDK_MAX_OUTPUT_BYTES) {
    state.truncated = true
    return
  }
  const remaining = CDK_MAX_OUTPUT_BYTES - state.bytes
  state.text += value.subarray(0, remaining).toString('utf8')
  state.bytes += Math.min(value.length, remaining)
  if (value.length > remaining) state.truncated = true
}

async function fileIfReadable(folder: string, name: string): Promise<string | null> {
  try {
    const target = path.join(folder, name)
    const info = await stat(target)
    return info.isFile() ? target : null
  } catch {
    return null
  }
}

async function readJson(folder: string, name: string): Promise<Record<string, unknown> | null> {
  const target = await fileIfReadable(folder, name)
  if (!target) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(target, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function languageFrom(entrypoint: string | null, files: string[]): { language: CdkLanguage; environment: CdkDetectedProject['environment'] } {
  const value = (entrypoint ?? '').toLowerCase()
  if (value.includes('python') || value.includes('.py') || files.includes('requirements.txt') || files.includes('pyproject.toml')) return { language: 'python', environment: 'python' }
  if (value.includes('dotnet') || value.includes('.cs') || files.some((f) => f.endsWith('.csproj'))) return { language: 'csharp', environment: 'dotnet' }
  if (value.includes('java') || value.includes('.java') || files.includes('pom.xml')) return { language: 'java', environment: 'java' }
  if (value.includes('.ts') || value.includes('ts-node')) return { language: 'typescript', environment: 'node' }
  if (value.includes('.js') || value.includes('node')) return { language: 'javascript', environment: 'node' }
  return { language: 'unknown', environment: 'unknown' }
}

function packageVersion(pkg: Record<string, unknown> | null): string | null {
  const version = pkg?.version
  return typeof version === 'string' && version.length <= 64 ? version : null
}

function versionFromPackageJson(pkg: Record<string, unknown> | null): string | null {
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg?.[field]
    if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
      const value = (deps as Record<string, unknown>)['aws-cdk-lib']
      if (typeof value === 'string') return value
    }
  }
  return null
}

async function discoverFiles(folder: string): Promise<string[]> {
  const names: string[] = []
  const queue = ['']
  while (queue.length && names.length < CDK_MAX_SCAN_FILES) {
    const relative = queue.pop()!
    let entries
    try {
      entries = await readdir(path.join(folder, relative), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'cdk.out') continue
      const child = relative ? path.join(relative, entry.name) : entry.name
      if (entry.isDirectory()) queue.push(child)
      else names.push(child)
      if (names.length >= CDK_MAX_SCAN_FILES) break
    }
  }
  return names.sort()
}

function fileCategory(name: string): 'manifest' | 'source' | 'generated' | 'unknown' {
  if (MANIFEST_NAMES.includes(path.basename(name)) || path.basename(name).endsWith('.csproj')) return 'manifest'
  if (name.startsWith(`cdk.out${path.sep}`) || name.startsWith('cdk.out/')) return 'generated'
  if (SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase())) return 'source'
  return 'unknown'
}

async function inspectProject(folder: string, now: () => number): Promise<ProjectSnapshot> {
  if (!path.isAbsolute(folder) || folder.includes('\0')) throw new Error('Choose an absolute project folder.')
  const info = await stat(folder).catch(() => null)
  if (!info?.isDirectory()) throw new Error('The selected project folder does not exist or is not a directory.')
  const cdk = await readJson(folder, 'cdk.json')
  if (!cdk) throw new Error('No cdk.json was found in the selected folder. Choose the CDK project root.')
  const pkg = await readJson(folder, 'package.json')
  const files = await discoverFiles(folder)
  const manifestFiles = files.filter((f) => MANIFEST_NAMES.includes(path.basename(f)) || path.basename(f).endsWith('.csproj'))
  const entrypoint = typeof cdk.app === 'string' ? cdk.app : null
  const dialect = languageFrom(entrypoint, manifestFiles)
  const appName = typeof pkg?.name === 'string' && pkg.name.length <= 120 ? pkg.name : path.basename(folder)
  const localToolkit = await readJson(folder, path.join('node_modules', 'aws-cdk', 'package.json'))
  const cdkVersion = packageVersion(localToolkit) ?? versionFromPackageJson(pkg)
  const findings: string[] = []
  if (!entrypoint) findings.push('cdk.json does not declare an app entrypoint.')
  if (entrypoint && UNSAFE_APP.test(entrypoint)) findings.push('The app entrypoint contains shell metacharacters and cannot be executed by this manager.')
  if (files.length >= CDK_MAX_SCAN_FILES) findings.push(`The source review reached its ${CDK_MAX_SCAN_FILES}-file bound; narrow the project before running it.`)
  if (!manifestFiles.some((f) => path.basename(f) === 'package.json' || path.basename(f) === 'requirements.txt' || path.basename(f) === 'pom.xml' || path.basename(f).endsWith('.csproj'))) {
    findings.push('No supported application dependency manifest was found.')
  }
  const reviewedFiles: CdkTrustReview['files'] = []
  for (const name of manifestFiles.slice(0, CDK_MAX_SCAN_FILES)) {
    try {
      const bytes = await readFile(path.join(folder, name))
      reviewedFiles.push({ path: name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), category: fileCategory(name) })
    } catch {
      reviewedFiles.push({ path: name, bytes: 0, sha256: null, category: fileCategory(name) })
      findings.push(`Could not read ${name}; trust review is incomplete.`)
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ folder, entrypoint, files: reviewedFiles, findings })).digest('hex')
  const trust: CdkTrustReview = { folder, fingerprint, files: reviewedFiles, findings, safe: findings.length === 0, reviewedAt: now() }
  const runtimeName = dialect.environment === 'node' ? 'node' : dialect.environment
  const runtimeVersion = dialect.environment === 'node' ? process.version : null
  const runtimeVerified = dialect.environment === 'node'
  const dependencies: CdkDependencyStatus = {
    toolkit: { required: CDK_TOOLKIT_VERSION, installed: cdkVersion, verified: cdkVersion === CDK_TOOLKIT_VERSION },
    runtime: { name: runtimeName, version: runtimeVersion, verified: runtimeVerified },
    applicationDependencies: { manifest: manifestFiles[0] ?? null, installed: manifestFiles.length > 0, verified: manifestFiles.length > 0 }
  }
  const detected: CdkDetectedProject = { folder, appName, language: dialect.language, environment: dialect.environment, entrypoint, manifestFiles, cdkVersion, cdkInstalled: Boolean(localToolkit), detectedAt: now() }
  return { detected, trust, dependencies }
}

async function scanAssets(folder: string): Promise<CdkAsset[]> {
  const root = path.join(folder, 'cdk.out')
  const found: CdkAsset[] = []
  const queue = ['']
  while (queue.length && found.length < CDK_MAX_ASSETS) {
    const rel = queue.pop()!
    let entries
    try { entries = await readdir(path.join(root, rel), { withFileTypes: true }) } catch { break }
    for (const entry of entries) {
      const child = rel ? path.join(rel, entry.name) : entry.name
      if (entry.isDirectory()) queue.push(child)
      else {
        const full = path.join(root, child)
        const info = await stat(full).catch(() => null)
        if (!info || info.size > CDK_MAX_ASSET_BYTES) continue
        const bytes = await readFile(full)
        found.push({ path: child, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
      }
      if (found.length >= CDK_MAX_ASSETS) break
    }
  }
  return found
}

export class CdkManager implements CdkApi {
  private readonly now: () => number
  private readonly spawnFn: typeof spawn
  private readonly states = new Map<string, CdkStatus>()
  private readonly listeners = new Set<(event: CdkEvent) => void>()
  private readonly children = new Map<string, ChildProcess>()
  private readonly cancelRequested = new Set<string>()

  constructor(opts: CdkManagerOptions = {}) {
    this.now = opts.now ?? Date.now
    this.spawnFn = opts.spawnFn ?? spawn
  }

  private emit(folder: string, status: CdkStatus, operation?: CdkOperation): void {
    this.states.set(folder, status)
    const event: CdkEvent = { kind: 'status', status, ...(operation ? { operation } : {}) }
    for (const listener of this.listeners) listener(event)
  }

  async inspect(folder: string): Promise<CdkStatus> {
    const current: CdkStatus = { phase: 'inspecting', folder, detected: null, trust: null, dependencies: null, lastResult: null, updatedAt: this.now() }
    this.emit(folder, current)
    try {
      const snapshot = await inspectProject(folder, this.now)
      const status: CdkStatus = { phase: snapshot.trust.safe ? 'ready' : 'error', folder, detected: snapshot.detected, trust: snapshot.trust, dependencies: snapshot.dependencies, lastResult: null, updatedAt: this.now() }
      this.emit(folder, status)
      return status
    } catch (error) {
      const status: CdkStatus = { ...current, phase: 'error', lastResult: { operation: 'synth', ok: false, exitCode: null, output: '', truncated: false, durationMs: 0, assets: [], error: error instanceof Error ? error.message : String(error) }, updatedAt: this.now() }
      this.emit(folder, status)
      return status
    }
  }

  async status(folder?: string): Promise<CdkStatus> {
    if (folder && this.states.has(folder)) return this.states.get(folder)!
    if (folder) return this.inspect(folder)
    return { phase: 'unconfigured', folder: null, detected: null, trust: null, dependencies: null, lastResult: null, updatedAt: this.now() }
  }

  async bootstrap(folder: string): Promise<CdkCommandResult> {
    const status = await this.inspect(folder)
    const started = this.now()
    if (!status.detected || !status.trust?.safe) return { operation: 'bootstrap', ok: false, exitCode: null, output: '', truncated: false, durationMs: this.now() - started, assets: [], error: 'Bootstrap is disabled until the project trust review is safe.' }
    return this.run(folder, 'bootstrap', ['install', '--save-dev', `aws-cdk@${CDK_TOOLKIT_VERSION}`, '--ignore-scripts'])
  }

  synth(folder: string, review: Parameters<CdkApi['synth']>[1]): Promise<CdkCommandResult> { return this.runReviewed(folder, 'synth', review, ['synth', '--no-color']) }
  diff(folder: string, review: Parameters<CdkApi['diff']>[1]): Promise<CdkCommandResult> { return this.runReviewed(folder, 'diff', review, ['diff', '--no-color']) }
  deploy(folder: string, review: Parameters<CdkApi['deploy']>[1]): Promise<CdkCommandResult> { return this.runReviewed(folder, 'deploy', review, ['deploy', '--require-approval', 'never', '--no-color']) }
  destroy(folder: string, review: Parameters<CdkApi['destroy']>[1]): Promise<CdkCommandResult> { return this.runReviewed(folder, 'destroy', review, ['destroy', '--force', '--no-color']) }
  async cancel(folder: string): Promise<boolean> {
    const child = this.children.get(folder)
    if (!child) return false
    this.cancelRequested.add(folder)
    child.kill()
    return true
  }

  private async runReviewed(folder: string, operation: Exclude<CdkOperation, 'bootstrap'>, review: Parameters<CdkApi['synth']>[1], args: string[]): Promise<CdkCommandResult> {
    const status = await this.inspect(folder)
    if (!isCdkReviewedChange(review) || review.folder !== folder || review.operation !== operation || !status.trust || review.trustFingerprint !== status.trust.fingerprint || !status.trust.safe) {
      return { operation, ok: false, exitCode: null, output: '', truncated: false, durationMs: 0, assets: [], error: 'This operation needs a current, acknowledged trust review for the selected project.' }
    }
    return this.run(folder, operation, args)
  }

  private async run(folder: string, operation: CdkOperation, args: string[]): Promise<CdkCommandResult> {
    const started = this.now()
    const status = this.states.get(folder)
    const activePhase: Record<CdkOperation, CdkStatus['phase']> = {
      bootstrap: 'bootstrapping',
      synth: 'synthesizing',
      diff: 'diffing',
      deploy: 'deploying',
      destroy: 'destroying'
    }
    if (status) this.emit(folder, { ...status, phase: activePhase[operation], updatedAt: this.now() }, operation)
    if (operation !== 'bootstrap' && !status?.detected?.cdkInstalled) return { operation, ok: false, exitCode: null, output: '', truncated: false, durationMs: this.now() - started, assets: [], error: 'The verified local CDK CLI is not installed. Run Bootstrap first.' }
    const executable = operation === 'bootstrap'
      ? (process.platform === 'win32' ? 'npm.cmd' : 'npm')
      : process.execPath
    const commandArgs = operation === 'bootstrap'
      ? args
      : [path.join(folder, 'node_modules', 'aws-cdk', 'bin', 'cdk'), ...args]
    const output = { text: '', bytes: 0, truncated: false }
    const result = await new Promise<CdkCommandResult>((resolve) => {
      let child: ChildProcess
      try { child = this.spawnFn(executable, commandArgs, { cwd: folder, shell: false, windowsHide: true, env: cdkEnvironment() }) } catch (error) {
        resolve({ operation, ok: false, exitCode: null, output: '', truncated: false, durationMs: this.now() - started, assets: [], error: error instanceof Error ? error.message : String(error) })
        return
      }
      this.children.set(folder, child)
      child.stdout?.on('data', (chunk) => trimOutput(output, chunk))
      child.stderr?.on('data', (chunk) => trimOutput(output, chunk))
      child.once('error', (error) => {
        this.children.delete(folder)
        this.cancelRequested.delete(folder)
        resolve({ operation, ok: false, exitCode: null, output: output.text, truncated: output.truncated, durationMs: this.now() - started, assets: [], error: error.message })
      })
      child.once('close', async (code) => {
        const assets = operation === 'synth' || operation === 'diff' ? await scanAssets(folder) : []
        const cancelled = this.cancelRequested.delete(folder)
        this.children.delete(folder)
        resolve({ operation, ok: code === 0 && !cancelled, exitCode: code, output: output.text, truncated: output.truncated, durationMs: this.now() - started, assets, error: code === 0 && !cancelled ? null : cancelled ? 'CDK operation was cancelled by the user.' : `CDK ${operation} exited with code ${code ?? 'unknown'}.` })
      })
    })
    const latest = operation === 'bootstrap' && result.ok ? await inspectProject(folder, this.now).catch(() => null) : null
    const next: CdkStatus = {
      ...(this.states.get(folder) ?? { phase: 'ready', folder, detected: null, trust: null, dependencies: null, lastResult: null, updatedAt: this.now() }),
      ...(latest ? { detected: latest.detected, trust: latest.trust, dependencies: latest.dependencies } : {}),
      phase: result.ok ? 'completed' : 'error',
      lastResult: result,
      updatedAt: this.now()
    }
    this.emit(folder, next, operation)
    return result
  }

  onEvent(listener: (event: CdkEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
}
