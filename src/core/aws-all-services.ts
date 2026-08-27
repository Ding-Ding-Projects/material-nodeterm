import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { IPC } from '../shared/ipc'
import type { CorePlatform } from './platform'
import {
  buildAwsExecutionPreview,
  normalizeAwsLocalExecutionBinding,
  normalizeAwsAllServicesCatalog,
  type AwsAllServicesCatalog,
  type AwsExecutionProgress,
  type AwsExecutionRequest,
  type AwsExecutionResult,
  type AwsLocalExecutionBinding,
  type AwsServiceModel,
  type AwsCommandModel,
  type AwsFieldModel
} from '../shared/aws-all-services'
import { writeFileAtomic } from './fs-atomic'

const execFileAsync = promisify(execFile)

const AWS_DEPENDENCY_ID = 'aws-cli-v2'
const MAX_MODEL_BYTES = 16 * 1024 * 1024
const MAX_RESULT_BYTES = 8 * 1024 * 1024
const MAX_RESULT_PREVIEW = 32 * 1024
const MAX_MODEL_FILES = 4_000
const MAX_BINDINGS = 2_000
const AWS_OPERATION_TIMEOUT_MS = 15 * 60 * 1000
const NODE_ID = /^[A-Za-z0-9_.:-]{1,240}$/

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeText(value: unknown, fallback: string, max = 64 * 1024): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function safeId(value: unknown, fallback: string): string {
  const candidate = safeText(value, fallback, 256)
  return /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(candidate) ? candidate : fallback
}

function cliOption(name: string): string {
  return `--${name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9-]/g, '-').toLowerCase()}`
}

function documentation(value: unknown, fallback: string): string {
  return safeText(value, fallback).replace(/\s+/g, ' ')
}

function riskFor(commandName: string): 'read' | 'write' | 'destructive' {
  const name = commandName.toLowerCase()
  if (/(delete|deregister|destroy|terminate|revoke|remove|purge|decommission|cancel)/.test(name)) return 'destructive'
  if (/(create|put|post|update|modify|start|stop|run|attach|detach|register|enable|disable|set|associate|disassociate)/.test(name)) return 'write'
  return 'read'
}

function shapeType(shape: JsonRecord): string {
  return safeText(shape.type, 'string', 64).toLowerCase()
}

function shapeFor(shapes: JsonRecord, name: unknown): JsonRecord | null {
  const key = safeText(name, '')
  const shape = key ? shapes[key] : undefined
  return isRecord(shape) ? shape : null
}

function fieldFromShape(
  shapes: JsonRecord,
  memberName: string,
  member: JsonRecord,
  required: boolean,
  stack: readonly string[] = []
): AwsFieldModel {
  const shapeName = safeText(member.shape, '')
  const shape = shapeFor(shapes, shapeName) ?? {}
  const kind = shapeType(shape)
  const id = safeId([...stack, memberName].join('.'), memberName)
  const base = {
    id,
    cliName: cliOption(memberName),
    label: memberName.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
    description: documentation(member.documentation, `AWS input ${memberName}.`),
    required,
    portable: kind !== 'blob' && kind !== 'stream'
  }
  if (kind === 'boolean') return { ...base, kind: 'boolean', falseCliName: safeText(shape.falseCliName, '') || undefined }
  if (kind === 'integer' || kind === 'long' || kind === 'float' || kind === 'double') {
    return { ...base, kind: 'number', minimum: typeof shape.min === 'number' ? shape.min : undefined, maximum: typeof shape.max === 'number' ? shape.max : undefined }
  }
  if (kind === 'timestamp') return { ...base, kind: 'date-time' }
  const enumValues = Array.isArray(shape.enum) ? shape.enum.filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64) : []
  if (enumValues.length) return { ...base, kind: 'enum', choices: enumValues.map((value) => ({ value, label: value })) }
  if (kind === 'blob' || kind === 'stream') return { ...base, kind: 'file', sensitive: false, portable: false }
  if (kind === 'list') {
    const member = isRecord(shape.member) ? shape.member : { shape: 'String' }
    return { ...base, kind: 'list', item: fieldFromShape(shapes, `${memberName}Item`, member, true, [...stack, memberName]) }
  }
  if (kind === 'map') {
    const value = isRecord(shape.value) ? shape.value : { shape: 'String' }
    return { ...base, kind: 'map', item: fieldFromShape(shapes, `${memberName}Value`, value, false, [...stack, memberName]) }
  }
  if (kind === 'structure') {
    const members = isRecord(shape.members) ? shape.members : {}
    const requiredMembers = new Set(Array.isArray(shape.required) ? shape.required.filter((item): item is string => typeof item === 'string') : [])
    const nested = Object.entries(members).slice(0, 2_000).map(([name, value]) =>
      fieldFromShape(shapes, name, isRecord(value) ? value : {}, requiredMembers.has(name), [...stack, memberName]))
    return { ...base, kind: 'structure', members: nested }
  }
  return { ...base, kind: 'string', pattern: typeof shape.pattern === 'string' ? shape.pattern.slice(0, 4_096) : undefined }
}

function serviceFromModel(cliName: string, model: JsonRecord, paginator: JsonRecord | null, waiter: JsonRecord | null): AwsServiceModel {
  const metadata = isRecord(model.metadata) ? model.metadata : {}
  const shapes = isRecord(model.shapes) ? model.shapes : {}
  const operations = isRecord(model.operations) ? model.operations : {}
  const commands: AwsCommandModel[] = []
  for (const [operationName, rawOperation] of Object.entries(operations).slice(0, 2_000)) {
    if (!isRecord(rawOperation)) continue
    const input = isRecord(rawOperation.input) ? rawOperation.input : null
    const inputShape = input ? shapeFor(shapes, input.shape) : null
    const required = new Set(Array.isArray(inputShape?.required) ? inputShape.required.filter((value): value is string => typeof value === 'string') : [])
    const members = isRecord(inputShape?.members) ? inputShape.members : {}
    const fields = Object.entries(members).slice(0, 2_000).map(([name, value]) => fieldFromShape(shapes, name, isRecord(value) ? value : {}, required.has(name)))
    const commandName = operationName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const servicePaginator = isRecord(paginator?.[operationName])
    const serviceWaiter = isRecord(waiter?.waiters) ? Object.entries(waiter.waiters).filter(([name]) => name.toLowerCase().includes(operationName.toLowerCase())).map(([name, value]) => ({ id: safeId(name, name), label: safeText(name, name), description: documentation(isRecord(value) ? value.description : '', `Wait for ${operationName}.`) })) : []
    commands.push({
      id: safeId(commandName, operationName.toLowerCase()),
      name: commandName,
      label: commandName,
      description: documentation(rawOperation.documentation, `Run the modeled ${operationName} operation.`),
      documentationUrl: `https://docs.aws.amazon.com/cli/latest/reference/${encodeURIComponent(cliName)}/${encodeURIComponent(commandName)}.html`,
      risk: riskFor(operationName),
      fields,
      ...(servicePaginator ? { pagination: { supported: true } } : {}),
      ...(serviceWaiter.length ? { waiters: serviceWaiter } : {})
    })
  }
  const label = safeText(metadata.serviceFullName, safeText(metadata.serviceId, cliName), 512)
  return {
    id: safeId(cliName, 'aws-service'),
    name: safeId(cliName, 'aws-service'),
    label,
    description: documentation(model.documentation, `${label} service operations from the installed AWS CLI model.`),
    documentationUrl: `https://docs.aws.amazon.com/cli/latest/reference/${encodeURIComponent(cliName)}/index.html`,
    commands
  }
}

async function readJson(file: string): Promise<JsonRecord | null> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_MODEL_BYTES) return null
    const body = await fs.readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(body)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function findModelFiles(root: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (current: string, depth: number): Promise<void> => {
    if (depth > 6 || result.length >= MAX_MODEL_FILES) return
    let entries: import('node:fs').Dirent[]
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (result.length >= MAX_MODEL_FILES) return
      const candidate = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(candidate, depth + 1)
      else if (entry.isFile() && entry.name === 'service-2.json') result.push(candidate)
    }
  }
  await visit(root, 0)
  return result
}

function sibling(file: string, name: string): string {
  return path.join(path.dirname(file), name)
}

function redactOutput(value: string): string {
  return value
    .replace(/("?(?:secret|token|password|accessKeyId|secretAccessKey|sessionToken|credential)[A-Za-z0-9_-]*"?\s*[:=]\s*")(?:[^"\\]|\\.)*(")/gi, '$1[redacted]$2')
    .slice(0, MAX_RESULT_PREVIEW)
}

function validBinding(value: unknown): value is AwsLocalExecutionBinding {
  try { normalizeAwsLocalExecutionBinding(value); return true } catch { return false }
}

export class AwsAllServicesService {
  private readonly bindingsFile: string
  private bindings: Record<string, AwsLocalExecutionBinding> | null = null
  private catalogCache: AwsAllServicesCatalog | null = null
  private readonly running = new Map<string, ReturnType<typeof spawn>>()
  private readonly cancelled = new Set<string>()

  constructor(
    private readonly platform: CorePlatform,
    private readonly resolveCli: () => Promise<string | null>
  ) {
    this.bindingsFile = path.join(platform.userDataDir, 'aws-all-services-bindings.json')
  }

  private async cliPath(): Promise<string> {
    const value = await this.resolveCli()
    if (!value) throw new Error(`The ${AWS_DEPENDENCY_ID} dependency is unavailable. Install or repair the bundled AWS CLI before refreshing models.`)
    return value
  }

  async catalog(refresh = false): Promise<AwsAllServicesCatalog> {
    if (!refresh && this.catalogCache) return this.catalogCache
    const cli = await this.cliPath()
    const root = path.dirname(cli)
    const files = await findModelFiles(root)
    const services: AwsServiceModel[] = []
    for (const file of files) {
      const model = await readJson(file)
      if (!model) continue
      const serviceDir = path.basename(path.dirname(path.dirname(file)))
      const paginator = await readJson(sibling(file, 'paginators-1.json'))
      const waiter = await readJson(sibling(file, 'waiters-2.json')) ?? await readJson(sibling(file, 'waiters-1.json'))
      services.push(serviceFromModel(serviceDir, model, paginator, waiter))
    }
    if (!services.length) throw new Error('The installed AWS CLI did not expose any readable service models.')
    const cliVersion = await this.version(cli)
    this.catalogCache = normalizeAwsAllServicesCatalog({ schemaVersion: 1, cliVersion, generatedAt: new Date().toISOString(), services })
    return this.catalogCache
  }

  private async version(cli: string): Promise<string> {
    try {
      const result = await execFileAsync(cli, ['--version'], { timeout: 10_000, windowsHide: true, encoding: 'utf8' })
      return safeText(String(result.stdout).trim(), 'unavailable', 512)
    } catch (error) {
      throw new Error(`The bundled AWS CLI version probe failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async loadBindings(): Promise<Record<string, AwsLocalExecutionBinding>> {
    if (this.bindings) return this.bindings
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.bindingsFile, 'utf8'))
      if (!isRecord(parsed)) throw new Error('invalid bindings')
      const next: Record<string, AwsLocalExecutionBinding> = {}
      for (const [nodeId, binding] of Object.entries(parsed).slice(0, MAX_BINDINGS)) if (NODE_ID.test(nodeId) && validBinding(binding)) next[nodeId] = binding
      this.bindings = next
    } catch {
      this.bindings = {}
    }
    return this.bindings
  }

  private async saveBindings(): Promise<void> {
    await fs.mkdir(path.dirname(this.bindingsFile), { recursive: true })
    await writeFileAtomic(this.bindingsFile, JSON.stringify(this.bindings ?? {}, null, 2), { mode: 0o600 })
  }

  async binding(nodeId: string): Promise<AwsLocalExecutionBinding> {
    if (!NODE_ID.test(nodeId)) throw new Error('AWS node identity is invalid.')
    return { ...(await this.loadBindings())[nodeId] }
  }

  async saveBinding(nodeId: string, binding: AwsLocalExecutionBinding): Promise<void> {
    if (!NODE_ID.test(nodeId) || !validBinding(binding)) throw new Error('AWS local binding is invalid.')
    const bindings = await this.loadBindings()
    bindings[nodeId] = normalizeAwsLocalExecutionBinding(binding)
    await this.saveBindings()
  }

  async profiles(): Promise<readonly { id: string; label: string; accountLabel?: string; roleLabel?: string }[]> {
    const cli = await this.cliPath()
    try {
      const result = await execFileAsync(cli, ['configure', 'list-profiles'], { timeout: 10_000, windowsHide: true, encoding: 'utf8' })
      const names = String(result.stdout).split(/\r?\n/).map((value) => value.trim()).filter((value) => /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/.test(value))
      return names.map((id) => ({ id, label: id }))
    } catch {
      return []
    }
  }

  async regions(): Promise<readonly { id: string; label: string }[]> {
    return []
  }

  async execute(nodeId: string, request: AwsExecutionRequest, onProgress: (progress: AwsExecutionProgress) => void): Promise<AwsExecutionResult> {
    if (!NODE_ID.test(nodeId) || !request || !Array.isArray(request.preview.argv) || request.preview.argv.length < 2) throw new Error('AWS execution request is invalid.')
    const catalog = await this.catalog()
    const service = catalog.services.find((candidate) => candidate.id === request.preview.serviceId)
    const command = service?.commands.find((candidate) => candidate.id === request.preview.commandId)
    if (!service || !command) throw new Error('The AWS service or command is no longer present in the installed model inventory. Refresh and choose it again.')
    const intent = request.intent
    if (intent.serviceId !== service.id || intent.commandId !== command.id) throw new Error('AWS execution intent does not match the selected model operation.')
    const binding = await this.binding(nodeId)
    const rebuilt = buildAwsExecutionPreview({ intent, binding, service, command })
    const argv = rebuilt.preview.argv
    const cli = await this.cliPath()
    const child = spawn(cli, argv, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.running.set(nodeId, child)
    this.cancelled.delete(nodeId)
    onProgress({ phase: 'running', message: `Running ${service.label} ${command.label}.` })
    let output = ''
    let bytes = 0
    const append = (chunk: Buffer): void => {
      bytes += chunk.byteLength
      if (bytes <= MAX_RESULT_BYTES) output += chunk.toString('utf8')
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('AWS operation timed out after 15 minutes.'))
      }, AWS_OPERATION_TIMEOUT_MS)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
    }).finally(() => this.running.delete(nodeId))
    if (this.cancelled.delete(nodeId)) {
      onProgress({ phase: 'cancelled', message: 'AWS operation was cancelled.' })
      throw new Error('AWS operation was cancelled.')
    }
    if (result.code !== 0) {
      onProgress({ phase: 'failed', message: redactOutput(output) || `AWS operation exited with code ${String(result.code)}.` })
      throw new Error(redactOutput(output) || `AWS operation exited with code ${String(result.code)}.`)
    }
    const preview = redactOutput(output)
    onProgress({ phase: 'complete', message: 'AWS operation completed.', completed: 1, total: 1 })
    return { summary: 'AWS operation completed.', resultCount: 1, outputPreview: preview || undefined }
  }

  async cancel(nodeId: string): Promise<void> {
    if (!NODE_ID.test(nodeId)) throw new Error('AWS node identity is invalid.')
    const child = this.running.get(nodeId)
    if (!child) return
    this.cancelled.add(nodeId)
    child.kill()
  }
}

export function registerAwsAllServicesIpc(platform: CorePlatform, resolveCli: () => Promise<string | null>): AwsAllServicesService {
  const service = new AwsAllServicesService(platform, resolveCli)
  platform.handle(IPC.awsAllServicesCatalog, () => service.catalog())
  platform.handle(IPC.awsAllServicesRefreshCatalog, () => service.catalog(true))
  platform.handle(IPC.awsAllServicesBinding, (nodeId: string) => service.binding(nodeId))
  platform.handle(IPC.awsAllServicesSaveBinding, (nodeId: string, binding: AwsLocalExecutionBinding) => service.saveBinding(nodeId, binding))
  platform.handle(IPC.awsAllServicesProfiles, () => service.profiles())
  platform.handle(IPC.awsAllServicesRegions, () => service.regions())
  platform.handle(IPC.awsAllServicesExecute, (nodeId: string, request: AwsExecutionRequest) => service.execute(nodeId, request, (progress) => platform.broadcast(IPC.awsAllServicesProgress, { nodeId, ...progress })))
  platform.handle(IPC.awsAllServicesCancel, (nodeId: string) => service.cancel(nodeId))
  return service
}
