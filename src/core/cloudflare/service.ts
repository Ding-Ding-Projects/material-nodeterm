import { randomUUID } from 'crypto'
import type {
  CloudflareApi,
  CloudflareDestructiveMutation,
  CloudflareManagerKind,
  CloudflareManagerRecords,
  CloudflareManagerSnapshot,
  CloudflareMutation,
  CloudflareMutationConfirmation,
  CloudflareMutationPreview,
  CloudflareMutationResult,
  CloudflarePageInfo,
  CloudflarePermissionSnapshot,
  CloudflareReadState,
  CloudflareResourceTarget
} from '../../shared/cloudflare'
import { CLOUDFLARE_MANAGER_VERSION } from '../../shared/cloudflare'
import { CloudflareClient, CloudflareClientError } from './client'

const MAX_PAGES = 100
const PREVIEW_TTL_MS = 10 * 60_000
const MAX_NAME = 256
const MAX_DOMAIN = 512
const MAX_EXPRESSION = 16 * 1024
const MAX_WORKER_SOURCE = 4 * 1024 * 1024

export interface CloudflarePermissionProvider {
  /** Returns permission names, never the token or token metadata. */
  read(accountId: string): Promise<CloudflarePermissionSnapshot>
}

export interface CloudflareServiceOptions {
  client?: CloudflareClient
  permissions?: CloudflarePermissionProvider
  now?: () => number
}

function managerPermission(manager: CloudflareManagerKind, action: string): string {
  if (action.startsWith('delete-') || action.startsWith('create-') || action === 'deploy-script') {
    return `${manager}:write`
  }
  return `${manager}:read`
}

function mutationManager(mutation: CloudflareMutation): CloudflareManagerKind {
  return mutation.manager
}

function targetOf(mutation: CloudflareMutation): CloudflareResourceTarget {
  if ('target' in mutation) return mutation.target
  switch (mutation.manager) {
    case 'access': return { manager: 'access', accountId: mutation.accountId, applicationId: mutation.input.name }
    case 'zero-trust': return { manager: 'zero-trust', accountId: mutation.accountId, ruleId: mutation.input.name }
    case 'workers': return { manager: 'workers', accountId: mutation.accountId, scriptName: mutation.input.scriptName }
    case 'pages': return { manager: 'pages', accountId: mutation.accountId, projectName: mutation.input.name }
    case 'r2': return { manager: 'r2', accountId: mutation.accountId, bucketName: mutation.input.name }
    case 'd1': return { manager: 'd1', accountId: mutation.accountId, databaseId: mutation.input.name }
    case 'queues': return { manager: 'queues', accountId: mutation.accountId, queueName: mutation.input.queueName }
  }
}

function validateTarget(target: CloudflareResourceTarget): CloudflareResourceTarget {
  const account = accountId(target.accountId)
  switch (target.manager) {
    case 'access': return { manager: 'access', accountId: account, applicationId: nonEmpty(target.applicationId, 'application id', 256) }
    case 'zero-trust': return { manager: 'zero-trust', accountId: account, ruleId: nonEmpty(target.ruleId, 'rule id', 256) }
    case 'workers': return { manager: 'workers', accountId: account, scriptName: nonEmpty(target.scriptName, 'script name', 256) }
    case 'pages': return { manager: 'pages', accountId: account, projectName: nonEmpty(target.projectName, 'Pages project name', 256) }
    case 'r2': return { manager: 'r2', accountId: account, bucketName: nonEmpty(target.bucketName, 'bucket name', 256) }
    case 'd1': return { manager: 'd1', accountId: account, databaseId: nonEmpty(target.databaseId, 'database id', 256) }
    case 'queues': return { manager: 'queues', accountId: account, queueName: nonEmpty(target.queueName, 'queue name', 256) }
  }
}

function nonEmpty(value: unknown, label: string, maximum = MAX_NAME): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum || /[\u0000\r\n]/.test(value)) {
    throw new CloudflareClientError(`Invalid ${label}.`, 'invalid-request')
  }
  return value.trim()
}

function accountId(value: unknown): string {
  const text = nonEmpty(value, 'account id', 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(text)) throw new CloudflareClientError('Invalid account id.', 'invalid-request')
  return text
}

function safeDomain(value: unknown): string {
  const domain = nonEmpty(value, 'domain', MAX_DOMAIN).toLocaleLowerCase('en-US')
  if (domain.includes('/') || domain.includes('@') || domain.includes(':') || domain.includes('..')) {
    throw new CloudflareClientError('Use a hostname only, without a URL, credentials, or path.', 'invalid-request')
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.length > 253) {
    throw new CloudflareClientError('The domain is not a valid hostname.', 'invalid-request')
  }
  return domain
}

function safeExpression(value: unknown): string {
  const expression = nonEmpty(value, 'rule expression', MAX_EXPRESSION)
  if (/[\u0000]/.test(expression)) throw new CloudflareClientError('The rule expression contains an unsupported character.', 'invalid-request')
  return expression
}

function safeWorkerSource(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_WORKER_SOURCE || /[\u0000]/.test(value)) {
    throw new CloudflareClientError('The Worker source is empty or exceeds the bounded source limit.', 'invalid-request')
  }
  return value
}

function validateMutation(mutation: CloudflareMutation): CloudflareMutation {
  if (!mutation || typeof mutation !== 'object') throw new CloudflareClientError('Invalid Cloudflare mutation.', 'invalid-request')
  if ('accountId' in mutation) accountId(mutation.accountId)
  else validateTarget(mutation.target)
  switch (mutation.manager) {
    case 'access':
      if (mutation.action === 'create-application') {
        return { ...mutation, accountId: accountId(mutation.accountId), input: {
          name: nonEmpty(mutation.input.name, 'application name'), domain: safeDomain(mutation.input.domain), type: mutation.input.type
        } }
      }
      if (mutation.action === 'delete-application') return { ...mutation, target: validateTarget(mutation.target) }
      break
    case 'zero-trust':
      if (mutation.action === 'create-gateway-rule') {
        return { ...mutation, accountId: accountId(mutation.accountId), input: {
          name: nonEmpty(mutation.input.name, 'rule name'), action: mutation.input.action, expression: safeExpression(mutation.input.expression)
        } }
      }
      if (mutation.action === 'delete-gateway-rule') return { ...mutation, target: validateTarget(mutation.target) }
      break
    case 'workers':
      if (mutation.action === 'deploy-script') {
        const compatibilityDate = mutation.input.compatibilityDate
        if (compatibilityDate !== undefined && (typeof compatibilityDate !== 'string' || Number.isNaN(Date.parse(compatibilityDate)))) {
          throw new CloudflareClientError('The Worker compatibility date is invalid.', 'invalid-request')
        }
        return { ...mutation, accountId: accountId(mutation.accountId), input: {
          scriptName: nonEmpty(mutation.input.scriptName, 'script name'), source: safeWorkerSource(mutation.input.source),
          ...(compatibilityDate ? { compatibilityDate } : {})
        } }
      }
      if (mutation.action === 'delete-script') return { ...mutation, target: validateTarget(mutation.target) }
      break
    case 'pages':
      if (mutation.action === 'create-project') return { ...mutation, accountId: accountId(mutation.accountId), input: {
        name: nonEmpty(mutation.input.name, 'Pages project name'), productionBranch: nonEmpty(mutation.input.productionBranch, 'production branch')
      } }
      if (mutation.action === 'delete-project') return { ...mutation, target: validateTarget(mutation.target) }
      break
    case 'r2':
      if (mutation.action === 'create-bucket') return { ...mutation, accountId: accountId(mutation.accountId), input: {
        name: nonEmpty(mutation.input.name, 'bucket name'), ...(mutation.input.locationHint ? { locationHint: nonEmpty(mutation.input.locationHint, 'location hint', 128) } : {})
      } }
      if (mutation.action === 'delete-bucket') return { ...mutation, target: validateTarget(mutation.target) }
      break
    case 'd1':
      if (mutation.action === 'create-database') return { ...mutation, accountId: accountId(mutation.accountId), input: {
        name: nonEmpty(mutation.input.name, 'database name'), ...(mutation.input.primaryLocationHint ? { primaryLocationHint: nonEmpty(mutation.input.primaryLocationHint, 'primary location hint', 128) } : {})
      } }
      if (mutation.action === 'delete-database') return { ...mutation, target: validateTarget(mutation.target) }
      break
    case 'queues':
      if (mutation.action === 'create-queue') return { ...mutation, accountId: accountId(mutation.accountId), input: { queueName: nonEmpty(mutation.input.queueName, 'queue name') } }
      if (mutation.action === 'delete-queue') return { ...mutation, target: validateTarget(mutation.target) }
      break
  }
  throw new CloudflareClientError('The Cloudflare mutation is not registered.', 'invalid-request')
}

function emptyPage(page = 1, perPage = 100): CloudflarePageInfo {
  return { page, perPage, totalPages: null, total: null, hasMore: false }
}

/** One typed service owns all seven managers. The individual classes below are thin, named views
 * over it so callers cannot accidentally construct an untyped URL or mutation. */
export class CloudflareManagerService implements CloudflareApi {
  private readonly client: CloudflareClient
  private readonly now: () => number
  private readonly previews = new Map<string, { preview: CloudflareMutationPreview; mutation: CloudflareDestructiveMutation }>()

  constructor(private readonly options: CloudflareServiceOptions = {}) {
    this.client = options.client ?? new CloudflareClient()
    this.now = options.now ?? Date.now
  }

  secretPresence() { return this.client.secretPresence() }

  async permissions(accountIdValue: string): Promise<CloudflarePermissionSnapshot> {
    const id = accountId(accountIdValue)
    return this.options.permissions?.read(id) ?? { state: 'unknown', permissions: [], checkedAt: null, reason: 'Permission metadata has not been supplied.' }
  }

  async list<K extends CloudflareManagerKind>(manager: K, accountIdValue: string, page = 1, perPage = 100): Promise<CloudflareManagerSnapshot<K>> {
    const id = accountId(accountIdValue)
    const secret = await this.secretPresence()
    try {
      const result = await this.client.list(manager, id, page, perPage)
      return {
        version: CLOUDFLARE_MANAGER_VERSION,
        manager,
        accountId: id,
        state: 'ready',
        page: result.pageInfo,
        items: result.items,
        failures: [],
        permissions: await this.permissions(id),
        secret,
        fetchedAt: result.fetchedAt,
        error: null
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloudflare could not be read.'
      const state: CloudflareReadState = page > 1 ? 'partial' : 'error'
      return {
        version: CLOUDFLARE_MANAGER_VERSION,
        manager,
        accountId: id,
        state,
        page: emptyPage(page, perPage),
        items: [],
        failures: [{ page, message, retryable: error instanceof CloudflareClientError && ['request-failed', 'rate-limited'].includes(error.code) }],
        permissions: await this.permissions(id),
        secret,
        fetchedAt: null,
        error: message
      }
    }
  }

  async listAll<K extends CloudflareManagerKind>(manager: K, accountIdValue: string, perPage = 100): Promise<CloudflareManagerSnapshot<K>> {
    if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) throw new CloudflareClientError('Invalid Cloudflare page size.', 'invalid-request')
    const id = accountId(accountIdValue)
    const secret = await this.secretPresence()
    const permissionSnapshot = await this.permissions(id)
    const all: CloudflareManagerRecords[K][] = []
    const failures: CloudflareManagerSnapshot<K>['failures'] = []
    let info = emptyPage(1, perPage)
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.list(manager, id, page, perPage)
      if (result.state === 'error' || result.state === 'partial') {
        failures.push(...result.failures)
        break
      }
      all.push(...result.items)
      info = result.page
      if (!result.page.hasMore) break
      if (page === MAX_PAGES) failures.push({ page, message: 'Cloudflare pagination exceeded the bounded page limit.', retryable: false })
    }
    return {
      version: CLOUDFLARE_MANAGER_VERSION,
      manager,
      accountId: id,
      state: failures.length > 0 ? (all.length > 0 ? 'partial' : 'error') : 'ready',
      page: info,
      items: all,
      failures,
      permissions: permissionSnapshot,
      secret,
      fetchedAt: all.length > 0 ? this.now() : null,
      error: failures[0]?.message ?? null
    }
  }

  async graphql<T>(operation: 'account-summary' | 'workers-analytics', accountIdValue: string) {
    return this.client.graphql<T>(operation, accountId(accountIdValue))
  }

  async preview(mutationInput: CloudflareDestructiveMutation): Promise<CloudflareMutationPreview> {
    const mutation = validateMutation(mutationInput)
    if (!mutation.action.startsWith('delete-')) throw new CloudflareClientError('Only destructive mutations have previews.', 'invalid-request')
    const target = targetOf(mutation)
    const now = this.now()
    const preview: CloudflareMutationPreview = {
      id: randomUUID(),
      manager: mutation.manager,
      action: mutation.action,
      target,
      impact: [`Cloudflare ${mutation.action} will permanently remove the selected ${mutation.manager} resource.`, 'Existing unrelated resources are not changed.', 'The action cannot be undone by this manager.'],
      createdAt: now,
      expiresAt: now + PREVIEW_TTL_MS,
      requiresSuperConfirmation: true
    }
    this.previews.set(preview.id, { preview, mutation })
    return preview
  }

  async mutate(mutationInput: CloudflareMutation, confirmation?: CloudflareMutationConfirmation): Promise<CloudflareMutationResult> {
    const mutation = validateMutation(mutationInput)
    const manager = mutationManager(mutation)
    const action = mutation.action
    try {
      const permission = await this.permissions('accountId' in mutation ? mutation.accountId : mutation.target.accountId)
      const needed = managerPermission(manager, action)
      if (permission.state !== 'known') return { ok: false, manager, action, error: 'Cloudflare permissions are unknown. Refresh permissions before changing anything.', retryable: true }
      if (!permission.permissions.includes(needed)) return { ok: false, manager, action, error: `Cloudflare permission ${needed} is required for this action.`, retryable: false }
      if (action.startsWith('delete-')) {
        if (!confirmation?.confirm || !confirmation.previewId) return { ok: false, manager, action, error: 'A current destructive-action preview and confirmation are required.', retryable: false }
        const stored = this.previews.get(confirmation.previewId)
        this.previews.delete(confirmation.previewId)
        if (!stored || stored.preview.expiresAt <= this.now() || JSON.stringify(stored.mutation) !== JSON.stringify(mutation)) {
          return { ok: false, manager, action, error: 'The destructive-action preview is missing, expired, or does not match this target.', retryable: false }
        }
      }
      const id = await this.execute(mutation)
      return { ok: true, manager, action, id }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloudflare mutation failed.'
      return { ok: false, manager, action, error: message, retryable: error instanceof CloudflareClientError && ['request-failed', 'rate-limited'].includes(error.code) }
    }
  }

  private async execute(mutation: CloudflareMutation): Promise<string | null> {
    const account = 'accountId' in mutation ? accountId(mutation.accountId) : accountId(mutation.target.accountId)
    switch (mutation.manager) {
      case 'access':
        if (mutation.action === 'create-application') return (await this.client.create(`/accounts/${encodeURIComponent(account)}/access/apps`, { name: mutation.input.name, type: mutation.input.type, domain: mutation.input.domain })).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/access/apps/${encodeURIComponent(mutation.target.applicationId)}`); return null
      case 'zero-trust':
        if (mutation.action === 'create-gateway-rule') return (await this.client.create(`/accounts/${encodeURIComponent(account)}/gateway/rules`, { name: mutation.input.name, action: mutation.input.action, traffic: mutation.input.expression })).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/gateway/rules/${encodeURIComponent(mutation.target.ruleId)}`); return null
      case 'workers':
        if (mutation.action === 'deploy-script') return (await this.client.putWorkerScript(account, mutation.input.scriptName, mutation.input.source, mutation.input.compatibilityDate)).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(mutation.target.scriptName)}`); return null
      case 'pages':
        if (mutation.action === 'create-project') return (await this.client.create(`/accounts/${encodeURIComponent(account)}/pages/projects`, { name: mutation.input.name, production_branch: mutation.input.productionBranch })).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(mutation.target.projectName)}`); return null
      case 'r2':
        if (mutation.action === 'create-bucket') return (await this.client.create(`/accounts/${encodeURIComponent(account)}/r2/buckets`, { name: mutation.input.name, ...(mutation.input.locationHint ? { locationHint: mutation.input.locationHint } : {}) })).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/r2/buckets/${encodeURIComponent(mutation.target.bucketName)}`); return null
      case 'd1':
        if (mutation.action === 'create-database') return (await this.client.create(`/accounts/${encodeURIComponent(account)}/d1/database`, { name: mutation.input.name, ...(mutation.input.primaryLocationHint ? { primary_location_hint: mutation.input.primaryLocationHint } : {}) })).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(mutation.target.databaseId)}`); return null
      case 'queues':
        if (mutation.action === 'create-queue') return (await this.client.create(`/accounts/${encodeURIComponent(account)}/queues`, { queue_name: mutation.input.queueName })).id
        await this.client.remove(`/accounts/${encodeURIComponent(account)}/queues/${encodeURIComponent(mutation.target.queueName)}`); return null
    }
  }
}

export class CloudflareAccessManager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('access', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('access', accountId, perPage) }
  createApplication(accountId: string, input: Extract<CloudflareMutation, { manager: 'access'; action: 'create-application' }>['input']) { return this.service.mutate({ manager: 'access', action: 'create-application', accountId, input }) }
  deleteApplication(target: Extract<CloudflareResourceTarget, { manager: 'access' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'access', action: 'delete-application', target }, confirmation) }
}
export class CloudflareZeroTrustManager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('zero-trust', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('zero-trust', accountId, perPage) }
  createGatewayRule(accountId: string, input: Extract<CloudflareMutation, { manager: 'zero-trust'; action: 'create-gateway-rule' }>['input']) { return this.service.mutate({ manager: 'zero-trust', action: 'create-gateway-rule', accountId, input }) }
  deleteGatewayRule(target: Extract<CloudflareResourceTarget, { manager: 'zero-trust' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'zero-trust', action: 'delete-gateway-rule', target }, confirmation) }
}
export class CloudflareWorkersManager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('workers', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('workers', accountId, perPage) }
  deployScript(accountId: string, input: Extract<CloudflareMutation, { manager: 'workers'; action: 'deploy-script' }>['input']) { return this.service.mutate({ manager: 'workers', action: 'deploy-script', accountId, input }) }
  deleteScript(target: Extract<CloudflareResourceTarget, { manager: 'workers' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'workers', action: 'delete-script', target }, confirmation) }
}
export class CloudflarePagesManager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('pages', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('pages', accountId, perPage) }
  createProject(accountId: string, input: Extract<CloudflareMutation, { manager: 'pages'; action: 'create-project' }>['input']) { return this.service.mutate({ manager: 'pages', action: 'create-project', accountId, input }) }
  deleteProject(target: Extract<CloudflareResourceTarget, { manager: 'pages' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'pages', action: 'delete-project', target }, confirmation) }
}
export class CloudflareR2Manager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('r2', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('r2', accountId, perPage) }
  createBucket(accountId: string, input: Extract<CloudflareMutation, { manager: 'r2'; action: 'create-bucket' }>['input']) { return this.service.mutate({ manager: 'r2', action: 'create-bucket', accountId, input }) }
  deleteBucket(target: Extract<CloudflareResourceTarget, { manager: 'r2' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'r2', action: 'delete-bucket', target }, confirmation) }
}
export class CloudflareD1Manager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('d1', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('d1', accountId, perPage) }
  createDatabase(accountId: string, input: Extract<CloudflareMutation, { manager: 'd1'; action: 'create-database' }>['input']) { return this.service.mutate({ manager: 'd1', action: 'create-database', accountId, input }) }
  deleteDatabase(target: Extract<CloudflareResourceTarget, { manager: 'd1' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'd1', action: 'delete-database', target }, confirmation) }
}
export class CloudflareQueuesManager {
  constructor(readonly service: CloudflareManagerService) {}
  list(accountId: string, page?: number, perPage?: number) { return this.service.list('queues', accountId, page, perPage) }
  listAll(accountId: string, perPage?: number) { return this.service.listAll('queues', accountId, perPage) }
  createQueue(accountId: string, input: Extract<CloudflareMutation, { manager: 'queues'; action: 'create-queue' }>['input']) { return this.service.mutate({ manager: 'queues', action: 'create-queue', accountId, input }) }
  deleteQueue(target: Extract<CloudflareResourceTarget, { manager: 'queues' }>, confirmation?: CloudflareMutationConfirmation) { return this.service.mutate({ manager: 'queues', action: 'delete-queue', target }, confirmation) }
}
