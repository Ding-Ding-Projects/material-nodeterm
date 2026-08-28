import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { NodeDependencyService } from '../node-dependencies/service'
import type { AwsWizardCommandOption, AwsWizardModelSource, AwsWizardServiceOption, AwsWizardSourceMember, AwsWizardSourceShape } from '../../shared/aws-wizard'

const gunzipAsync = promisify(gunzip)
const MAX_SERVICES = 2_000
const MAX_MODEL_BYTES = 16 * 1024 * 1024
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/u

type JsonRecord = Record<string, unknown>

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as JsonRecord
}

function id(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is not a safe AWS model identifier.`)
  return value
}

function kebab(value: string): string {
  return value.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1-$2').replace(/([a-z0-9])([A-Z])/gu, '$1-$2').replace(/[_\s]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '').toLowerCase()
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 32_768 ? value : undefined
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function shapeReference(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const shape = (value as JsonRecord).shape
  return typeof shape === 'string' && SAFE_ID.test(shape) ? shape : null
}

function sourceShape(name: string, raw: JsonRecord): AwsWizardSourceShape {
  const required = new Set(Array.isArray(raw.required) ? raw.required.filter((item): item is string => typeof item === 'string') : [])
  const rawMembers = raw.members && typeof raw.members === 'object' && !Array.isArray(raw.members) ? raw.members as JsonRecord : {}
  const members: AwsWizardSourceMember[] = Object.entries(rawMembers).map(([memberName, member]) => {
    const value = record(member, `shape ${name}.members.${memberName}`)
    return {
      name: memberName,
      shape: typeof value.shape === 'string' ? value.shape : '',
      required: required.has(memberName),
      documentation: text(value.documentation),
      enumValues: Array.isArray(value.enum) ? value.enum.filter((item): item is string => typeof item === 'string') : [],
      min: numberOrNull(value.min),
      max: numberOrNull(value.max)
    }
  })
  return {
    name,
    type: typeof raw.type === 'string' ? raw.type : 'structure',
    documentation: text(raw.documentation),
    enumValues: Array.isArray(raw.enum) ? raw.enum.filter((item): item is string => typeof item === 'string') : [],
    min: numberOrNull(raw.min),
    max: numberOrNull(raw.max),
    members,
    memberShape: shapeReference(raw.member),
    keyShape: shapeReference(raw.key),
    valueShape: shapeReference(raw.value),
    ...(raw.type === 'timestamp' ? { format: 'date-time' as const } : {})
  }
}

export class AwsWizardModelService {
  constructor(private readonly dependencies: NodeDependencyService) {}

  private async modelRoot(): Promise<string> {
    const details = await this.dependencies.details('aws-cli-v2')
    if (!details.dependency.available || !details.dependency.executablePath) throw new Error(details.inventoryError ?? 'The bundled AWS CLI model inventory is unavailable.')
    return path.join(path.dirname(details.dependency.executablePath), 'awscli', 'botocore', 'data')
  }

  private async serviceModel(serviceId: string): Promise<{ model: JsonRecord; versions: string[]; versionRoot: string }> {
    id(serviceId, 'serviceId')
    const root = await this.modelRoot()
    const serviceRoot = path.join(root, serviceId)
    const versions = (await readdir(serviceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    if (!versions.length) throw new Error(`The installed AWS model has no version for service ${serviceId}.`)
    const versionRoot = path.join(serviceRoot, versions[versions.length - 1])
    const candidates = ['service-2.json', 'service-2.json.gz']
    let bytes: Buffer | null = null
    for (const filename of candidates) {
      try {
        const candidate = await readFile(path.join(versionRoot, filename))
        if (candidate.byteLength > MAX_MODEL_BYTES) throw new Error(`AWS model ${serviceId} exceeds its size bound.`)
        bytes = filename.endsWith('.gz') ? await gunzipAsync(candidate) : candidate
        if (bytes.byteLength > MAX_MODEL_BYTES) throw new Error(`AWS model ${serviceId} exceeds its decompressed size bound.`)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    if (!bytes) throw new Error(`The installed AWS model file is missing for service ${serviceId}.`)
    return { model: record(JSON.parse(bytes.toString('utf8')), `AWS model ${serviceId}`), versions, versionRoot }
  }

  async catalog(): Promise<readonly AwsWizardServiceOption[]> {
    const root = await this.modelRoot()
    const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
    if (entries.length > MAX_SERVICES) throw new Error(`AWS model inventory exceeds ${MAX_SERVICES} services.`)
    const result: AwsWizardServiceOption[] = []
    for (const entry of entries) {
      const { model, versions } = await this.serviceModel(entry.name)
      const metadata = model.metadata && typeof model.metadata === 'object' ? model.metadata as JsonRecord : {}
      const operations = model.operations && typeof model.operations === 'object' ? model.operations as JsonRecord : {}
      result.push({ id: entry.name, label: typeof metadata.serviceFullName === 'string' ? metadata.serviceFullName : entry.name, versions, commandCount: Object.keys(operations).length })
    }
    return result.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
  }

  async commands(serviceId: string): Promise<readonly AwsWizardCommandOption[]> {
    const { model, versionRoot } = await this.serviceModel(serviceId)
    const operations = model.operations && typeof model.operations === 'object' ? model.operations as JsonRecord : {}
    return Object.entries(operations).map(([apiName, raw]) => {
      const operation = record(raw, `operation ${apiName}`)
      return { name: kebab(apiName), documentation: text(operation.documentation) ?? '' }
    }).sort((left, right) => left.name.localeCompare(right.name))
  }

  async source(serviceId: string, commandName: string): Promise<AwsWizardModelSource | null> {
    id(serviceId, 'serviceId')
    id(commandName, 'commandName')
    const { model, versionRoot } = await this.serviceModel(serviceId)
    const operations = model.operations && typeof model.operations === 'object' ? model.operations as JsonRecord : {}
    const operationEntry = Object.entries(operations).find(([apiName]) => kebab(apiName) === commandName)
    if (!operationEntry) return null
    const operation = record(operationEntry[1], `operation ${operationEntry[0]}`)
    const rawShapes = model.shapes && typeof model.shapes === 'object' ? model.shapes as JsonRecord : {}
    const shapes = Object.entries(rawShapes).map(([name, raw]) => sourceShape(name, record(raw, `shape ${name}`)))
    const paginatorRaw = await readFile(path.join(versionRoot, 'paginators-1.json')).catch(() => null)
    let pagination = false
    if (paginatorRaw) {
      try {
        const paginator = record(JSON.parse(paginatorRaw.toString('utf8')), 'paginator model')
        const entries = paginator.pagination && typeof paginator.pagination === 'object' && !Array.isArray(paginator.pagination)
          ? paginator.pagination as JsonRecord
          : {}
        pagination = Object.hasOwn(entries, operationEntry[0])
      } catch {
        pagination = false
      }
    }
    return {
      serviceId,
      commandName,
      inputShape: shapeReference(operation.input),
      shapes,
      pagination
    }
  }
}
