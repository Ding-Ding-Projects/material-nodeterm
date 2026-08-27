import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IpcMain } from 'electron'
import { findExecutableSync } from '../../core/exec-path'
import { IPC } from '../../shared/ipc'
import {
  CDK_MAX_OUTPUT_BYTES,
  CDK_MAX_PROJECT_FILE_BYTES,
  validateCdkOperationInput,
  validateCdkProjectInput,
  type CdkApi,
  type CdkDeployResult,
  type CdkDiffChange,
  type CdkDiffResult,
  type CdkOperationInput,
  type CdkProjectFileSummary,
  type CdkProjectScript,
  type CdkProjectInput,
  type CdkSynthesisResult,
  type CdkStatus,
  type CdkTrustInput,
  type CdkTrustReview
} from '../../shared/cdk'

const COMMAND_TIMEOUT_MS = 15 * 60_000
const REVIEW_TIMEOUT_MS = 30 * 60 * 1000

interface CommandResult {
  stdout: string
  stderr: string
}

interface TrustRecord {
  projectPath: string
  appCommand: string
  expiresAt: number
  reviewed: boolean
}

interface DiffReviewRecord {
  projectPath: string
  stackNames: string[]
  awsProfile?: string
  awsRegion?: string
  expiresAt: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseJson(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${label} returned malformed JSON.`)
  }
}

function safeProjectPath(value: string): string {
  const raw = validateCdkProjectInput({ projectPath: value }).projectPath
  if (!isAbsolute(raw)) throw new Error('Choose a local CDK project folder with the Browse control.')
  return resolve(raw)
}

function parseDiffChanges(text: string): CdkDiffChange[] {
  const changes: CdkDiffChange[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/).slice(0, 10_000)) {
    const match = line.match(/^\s*([+\-~])\s+([^\s]+)\s+([^\s]+)(?:\s+([^\s]+))?/)
    if (!match) continue
    const action = match[1] === '+' ? 'add' : match[1] === '-' ? 'remove' : 'modify'
    const resourceType = match[2]
    const logicalId = match[3]
    const stackName = match[4] || 'Selected stack'
    const key = `${stackName}:${logicalId}:${action}`
    if (seen.has(key)) continue
    seen.add(key)
    changes.push({ stackName, action, logicalId, resourceType })
  }
  return changes.slice(0, 2000)
}

export class CdkManager implements CdkApi {
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly trust = new Map<string, TrustRecord>()
  private readonly diffReviews = new Map<string, DiffReviewRecord>()
  private readonly cdkPath: string | null

  constructor(resourcesPath: string, userDataPath: string) {
    const executable = process.platform === 'win32' ? 'cdk.cmd' : 'cdk'
    this.cdkPath = findExecutableSync('cdk', [
      join(resourcesPath, 'aws-cdk', executable),
      join(userDataPath, 'tools', 'aws-cdk', 'current', executable),
      join(resourcesPath, 'aws-cdk', process.platform === 'win32' ? 'cdk.exe' : 'cdk'),
      join(userDataPath, 'tools', 'aws-cdk', 'current', process.platform === 'win32' ? 'cdk.exe' : 'cdk')
    ])
  }

  private async run(args: string[], cwd: string, requestId?: string, aws?: { profile?: string; region?: string }): Promise<CommandResult> {
    if (!this.cdkPath) throw new Error('The AWS CDK CLI is unavailable. Install or repair the bundled CDK tool, then retry.')
    return await new Promise<CommandResult>((resolvePromise, reject) => {
      const isCmdShim = process.platform === 'win32' && this.cdkPath!.toLowerCase().endsWith('.cmd')
      const executable = isCmdShim ? (process.env.ComSpec || 'cmd.exe') : this.cdkPath as string
      const commandArgs = isCmdShim
        ? ['/d', '/s', '/c', [`"${this.cdkPath}"`, ...args.map((arg) => `"${arg.replace(/"/g, '""')}"`)].join(' ')]
        : args
      const child = spawn(executable, commandArgs, {
        cwd,
        env: {
          ...process.env,
          ...(aws?.profile ? { AWS_PROFILE: aws.profile } : {}),
          ...(aws?.region ? { AWS_REGION: aws.region, AWS_DEFAULT_REGION: aws.region } : {})
        },
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      if (requestId) this.active.set(requestId, child)
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (requestId && this.active.get(requestId) === child) this.active.delete(requestId)
        if (error) reject(error)
        else resolvePromise({ stdout, stderr })
      }
      const append = (current: string, chunk: Buffer): string => {
        bytes += chunk.length
        if (bytes > CDK_MAX_OUTPUT_BYTES) {
          child.kill()
          finish(new Error('CDK output exceeded the bounded limit. Narrow the selected stacks and retry.'))
          return current
        }
        return current + chunk.toString('utf8')
      }
      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
      child.once('error', (error) => finish(error))
      child.once('close', (code, signal) => {
        if (code === 0) finish()
        else finish(new Error(signal ? `CDK operation was cancelled (${signal}).` : (stderr.trim() || `CDK exited with code ${code}.`)))
      })
      const timer = setTimeout(() => {
        child.kill()
        finish(new Error('CDK did not finish before the bounded operation timeout. Check the project and AWS access, then retry.'))
      }, COMMAND_TIMEOUT_MS)
    })
  }

  private getTrust(input: CdkOperationInput): TrustRecord {
    const projectPath = safeProjectPath(input.projectPath)
    const record = this.trust.get(input.reviewToken)
    if (!record || record.expiresAt < Date.now() || record.projectPath !== projectPath || !record.reviewed) {
      throw new Error('Review this CDK project and approve its trust notice before running an operation.')
    }
    return record
  }

  async status(): Promise<CdkStatus> {
    if (!this.cdkPath) return {
      available: false,
      version: null,
      executable: null,
      reason: 'The AWS CDK CLI is unavailable. Install or repair the bundled CDK tool, then retry.'
    }
    try {
      const result = await this.run(['--version'], process.cwd())
      return { available: true, version: (result.stdout || result.stderr).trim() || null, executable: basename(this.cdkPath), reason: null }
    } catch (error) {
      return { available: false, version: null, executable: basename(this.cdkPath), reason: error instanceof Error ? error.message : 'The CDK version could not be read.' }
    }
  }

  async inspectProject(input: CdkProjectInput): Promise<CdkTrustReview> {
    const projectPath = safeProjectPath(input.projectPath)
    const info = await stat(projectPath).catch(() => null)
    if (!info?.isDirectory()) throw new Error('Choose a CDK project folder, not a file or an unavailable folder.')
    const configPath = join(projectPath, 'cdk.json')
    const configInfo = await stat(configPath).catch(() => null)
    if (!configInfo?.isFile() || configInfo.size > CDK_MAX_PROJECT_FILE_BYTES) {
      throw new Error('The selected folder has no bounded cdk.json. Choose the folder containing the CDK app.')
    }
    const config = parseJson(await readFile(configPath, 'utf8'), 'cdk.json')
    const appCommand = asText(config.app).trim()
    if (appCommand.length > 4096) throw new Error('The CDK app command exceeds the bounded trust-review limit.')
    const context = asRecord(config.context)
    const files: CdkProjectFileSummary[] = [{ name: 'cdk.json', kind: 'cdk-config', bytes: configInfo.size }]
    const scripts: CdkProjectScript[] = []
    const dependencyNames: string[] = []
    const known: Array<[string, CdkProjectFileSummary['kind']]> = [
      ['package.json', 'package-manifest'],
      ['package-lock.json', 'dependency-manifest'],
      ['yarn.lock', 'dependency-manifest'],
      ['pnpm-lock.yaml', 'dependency-manifest'],
      ['requirements.txt', 'dependency-manifest'],
      ['Pipfile', 'dependency-manifest'],
      ['cdk.context.json', 'context']
    ]
    for (const [name, kind] of known) {
      const item = await stat(join(projectPath, name)).catch(() => null)
      if (item?.isFile() && item.size <= CDK_MAX_PROJECT_FILE_BYTES) files.push({ name, kind, bytes: item.size })
    }
    const packageInfo = files.find((file) => file.name === 'package.json')
    if (packageInfo) {
      const packageJson = parseJson(await readFile(join(projectPath, 'package.json'), 'utf8'), 'package.json')
      const rawScripts = asRecord(packageJson.scripts)
      for (const [name, command] of Object.entries(rawScripts).slice(0, 100)) {
        if (typeof command === 'string' && command.length <= 4096) scripts.push({ name, command })
      }
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const dependencies = asRecord(packageJson[key])
        dependencyNames.push(...Object.keys(dependencies).slice(0, 500))
      }
    }
    const warnings: string[] = []
    if (!appCommand) warnings.push('cdk.json does not declare an app command. CDK cannot synthesize this folder until it is repaired.')
    else warnings.push('Synth and deploy run the project app command from this folder after you approve this trust review.')
    if (files.some((file) => file.kind === 'package-manifest' || file.kind === 'dependency-manifest')) {
      warnings.push('Project dependency and lifecycle files are present. Review the listed scripts and dependency names before allowing local code execution.')
    }
    const reviewToken = randomUUID()
    this.trust.set(reviewToken, { projectPath, appCommand, expiresAt: Date.now() + REVIEW_TIMEOUT_MS, reviewed: false })
    return { reviewToken, projectPath, cdkConfigPath: configPath, appCommand, contextKeys: Object.keys(context).slice(0, 500).sort(), files, scripts, dependencyNames: [...new Set(dependencyNames)].sort().slice(0, 1000), warnings, reviewed: false }
  }

  async approveTrust(input: CdkTrustInput): Promise<CdkTrustReview> {
    const projectPath = safeProjectPath(input.projectPath)
    const record = this.trust.get(input.reviewToken)
    if (!record || record.expiresAt < Date.now() || record.projectPath !== projectPath) throw new Error('The trust review expired. Inspect the CDK project again.')
    record.reviewed = true
    const configPath = join(projectPath, 'cdk.json')
    return { reviewToken: input.reviewToken, projectPath, cdkConfigPath: configPath, appCommand: record.appCommand, contextKeys: [], files: [], scripts: [], dependencyNames: [], warnings: [], reviewed: true }
  }

  async synth(input: CdkOperationInput): Promise<CdkSynthesisResult> {
    const value = validateCdkOperationInput(input)
    const record = this.getTrust(value)
    const started = Date.now()
    const outputDir = await mkdtemp(join(tmpdir(), 'nodeterm-cdk-synth-'))
    try {
      const result = await this.run(['synth', '--quiet', '--output', outputDir, ...value.stackNames], record.projectPath, value.requestId, { profile: value.awsProfile, region: value.awsRegion })
      const names = (await readdir(outputDir))
        .filter((name) => extname(name).toLowerCase() === '.json')
        .filter((name) => !['tree.json', 'manifest.json'].includes(name) && !name.endsWith('.assets.json'))
        .slice(0, 200)
      const stackNames = names.map((name) => basename(name, extname(name))).filter(Boolean)
      return { requestId: value.requestId, projectPath: record.projectPath, stackNames, templateNames: names, stdout: result.stdout, stderr: result.stderr, durationMs: Date.now() - started }
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async diff(input: CdkOperationInput): Promise<CdkDiffResult> {
    const value = validateCdkOperationInput(input)
    const record = this.getTrust(value)
    const started = Date.now()
    const result = await this.run(['diff', '--no-color', ...value.stackNames], record.projectPath, value.requestId, { profile: value.awsProfile, region: value.awsRegion })
    const text = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.slice(0, CDK_MAX_OUTPUT_BYTES)
    const changes = parseDiffChanges(text).map((change) => ({ ...change, stackName: value.stackNames[0] || change.stackName }))
    const reviewToken = randomUUID()
    this.diffReviews.set(reviewToken, { projectPath: record.projectPath, stackNames: [...value.stackNames], awsProfile: value.awsProfile, awsRegion: value.awsRegion, expiresAt: Date.now() + REVIEW_TIMEOUT_MS })
    return { requestId: value.requestId, projectPath: record.projectPath, stackNames: value.stackNames, text, changes, requiresConfirmation: changes.some((change) => change.action === 'remove' || change.action === 'replace') || /\b(replace|replacement|destroy|destroyed)\b/i.test(text), reviewToken, durationMs: Date.now() - started }
  }

  async deploy(input: CdkOperationInput & { diffReviewToken: string }): Promise<CdkDeployResult> {
    const value = validateCdkOperationInput(input)
    const record = this.getTrust(value)
    const review = this.diffReviews.get(input.diffReviewToken)
    if (!review || review.expiresAt < Date.now() || review.projectPath !== record.projectPath || review.awsProfile !== value.awsProfile || review.awsRegion !== value.awsRegion || JSON.stringify(review.stackNames) !== JSON.stringify(value.stackNames)) {
      throw new Error('Review a fresh CDK diff for the same stacks before deploying.')
    }
    const started = Date.now()
    const outputDir = await mkdtemp(join(tmpdir(), 'nodeterm-cdk-deploy-'))
    try {
      const outputsPath = join(outputDir, 'outputs.json')
      const result = await this.run(['deploy', '--require-approval', 'never', '--outputs-file', outputsPath, ...value.stackNames], record.projectPath, value.requestId, { profile: value.awsProfile, region: value.awsRegion })
      const outputBody = await readFile(outputsPath, 'utf8').catch((error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') return null
        throw error
      })
      const outputs = outputBody === null ? {} : parseJson(outputBody, 'CDK deploy outputs')
      this.diffReviews.delete(input.diffReviewToken)
      return { requestId: value.requestId, projectPath: record.projectPath, stackNames: value.stackNames, stdout: result.stdout, stderr: result.stderr, outputs: Object.fromEntries(Object.entries(outputs).slice(0, 200).map(([stack, value]) => [stack, Object.fromEntries(Object.entries(asRecord(value)).slice(0, 200).map(([key, output]) => [key, asText(output)]))])), durationMs: Date.now() - started }
    } finally {
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async cancel(requestId: string): Promise<boolean> {
    const id = String(requestId ?? '').slice(0, 160)
    const child = this.active.get(id)
    if (!child) return false
    child.kill()
    return true
  }
}

export function registerCdkHandlers(ipcMain: IpcMain, resourcesPath: string, userDataPath: string): CdkManager {
  const manager = new CdkManager(resourcesPath, userDataPath)
  ipcMain.handle(IPC.cdkStatus, () => manager.status())
  ipcMain.handle(IPC.cdkInspectProject, (_event, input: CdkProjectInput) => manager.inspectProject(input))
  ipcMain.handle(IPC.cdkApproveTrust, (_event, input: CdkTrustInput) => manager.approveTrust(input))
  ipcMain.handle(IPC.cdkSynth, (_event, input: CdkOperationInput) => manager.synth(input))
  ipcMain.handle(IPC.cdkDiff, (_event, input: CdkOperationInput) => manager.diff(input))
  ipcMain.handle(IPC.cdkDeploy, (_event, input: CdkOperationInput & { diffReviewToken: string }) => manager.deploy(input))
  ipcMain.handle(IPC.cdkCancel, (_event, requestId: string) => manager.cancel(requestId))
  return manager
}
