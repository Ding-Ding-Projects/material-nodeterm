import type {
  GitHubApiItem,
  GitHubApiOperationId,
  GitHubApiRequest,
  GitHubApiResult,
  GitHubApiSemanticParams
} from '../../shared/github-api'
import { GITHUB_API_OPERATIONS } from '../../shared/github-api'
import { GitHubClientError } from './client-error'

const API_ORIGIN = 'https://api.github.com'
const MAX_PAGE = 100_000
const MAX_PAGE_SIZE = 100
const MAX_TEXT = 1_000_000
const MAX_PATH = 2_000
const MAX_ITEMS = 100

type RestPlan = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: string }

const operationById = new Map(GITHUB_API_OPERATIONS.map((item) => [item.id, item]))

function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
}

function segment(value: unknown, label: string): string {
  if (!text(value, 256) || value.includes('/') || value === '.' || value === '..') {
    throw new GitHubClientError('invalid-request')
  }
  return encodeURIComponent(value)
}

function raw(value: unknown, max = 256): string {
  if (!text(value, max)) throw new GitHubClientError('invalid-request')
  return value
}

function pathValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_PATH || value.includes('\u0000') ||
      value.split('/').some((part) => part === '..')) throw new GitHubClientError('invalid-request')
  return value.split('/').filter(Boolean).map((part) => segment(part, 'path')).join('/')
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_PAGE) {
    throw new GitHubClientError('invalid-request')
  }
  return Number(value)
}

function paramsForBody(params: GitHubApiSemanticParams, keys: readonly string[]): Record<string, unknown> {
  const values = params.input ?? {}
  for (const key of Object.keys(values)) if (!keys.includes(key)) throw new GitHubClientError('invalid-request')
  const body: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.length > MAX_TEXT) throw new GitHubClientError('invalid-request')
    if (Array.isArray(value) && value.length > 100) throw new GitHubClientError('invalid-request')
    body[key] = value
  }
  return body
}

function addPaging(path: string, request: GitHubApiRequest): string {
  const page = request.page === undefined ? 1 : integer(request.page)
  const perPage = request.params.perPage === undefined ? 50 : integer(request.params.perPage)
  if (perPage > MAX_PAGE_SIZE) throw new GitHubClientError('invalid-request')
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}page=${page}&per_page=${perPage}`
}

function repositoryPath(repository: string): string {
  if (!text(repository, 200) || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new GitHubClientError('invalid-request')
  }
  return `/repos/${repository}`
}

/** Build only documented, allowlisted paths. This function intentionally has no endpoint input. */
export function buildGitHubApiPlan(request: GitHubApiRequest, repository?: string): RestPlan {
  const spec = operationById.get(request.operation)
  if (!spec || spec.transport !== 'rest') throw new GitHubClientError('invalid-request')
  const params = request.params
  for (const required of spec.requiredParams) {
    if (required === 'repository') continue
    const value = params[required as keyof GitHubApiSemanticParams]
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      throw new GitHubClientError('invalid-request')
    }
  }
  const base = spec.scope === 'repository' ? repositoryPath(repository ?? params.repository ?? '') : ''
  const id = request.operation
  const bodyKeys = (keys: readonly string[]) => JSON.stringify(paramsForBody(params, keys))
  const q = (key: string): string => text(params[key as keyof GitHubApiSemanticParams], 2_000)
    ? encodeURIComponent(String(params[key as keyof GitHubApiSemanticParams])) : ''
  let plan: RestPlan
  switch (id) {
    case 'repository.list': plan = { method: 'GET', path: '/user/repos' }; break
    case 'repository.get': plan = { method: 'GET', path: base }; break
    case 'repository.update': plan = { method: 'PATCH', path: base, body: bodyKeys(['name', 'description', 'homepage', 'private', 'has_issues', 'has_projects', 'has_wiki', 'is_template']) }; break
    case 'repository.archive': plan = { method: 'PATCH', path: base, body: JSON.stringify({ archived: true }) }; break
    case 'branch.list': plan = { method: 'GET', path: `${base}/branches` }; break
    case 'branch.get': plan = { method: 'GET', path: `${base}/branches/${segment(params.branch, 'branch')}` }; break
    case 'branch.create': plan = { method: 'POST', path: `${base}/git/refs`, body: JSON.stringify({ ref: `refs/heads/${raw(params.branch)}`, sha: raw(params.sha, 128) }) }; break
    case 'branch.delete': plan = { method: 'DELETE', path: `${base}/git/refs/heads/${segment(params.branch, 'branch')}` }; break
    case 'branch.protection.get': plan = { method: 'GET', path: `${base}/branches/${segment(params.branch, 'branch')}/protection` }; break
    case 'commit.list': plan = { method: 'GET', path: `${base}/commits` }; break
    case 'commit.get': plan = { method: 'GET', path: `${base}/commits/${segment(params.sha, 'sha')}` }; break
    case 'commit.compare': plan = { method: 'GET', path: `${base}/compare/${segment(params.base, 'base')}...${segment(params.head, 'head')}` }; break
    case 'tag.list': plan = { method: 'GET', path: `${base}/tags` }; break
    case 'tag.get': plan = { method: 'GET', path: `${base}/git/ref/tags/${segment(params.tag, 'tag')}` }; break
    case 'tag.create': plan = { method: 'POST', path: `${base}/git/tags`, body: JSON.stringify({ tag: raw(params.tag), message: raw(params.message ?? params.tag, MAX_TEXT), object: raw(params.sha, 128), type: 'commit' }) }; break
    case 'tag.delete': plan = { method: 'DELETE', path: `${base}/git/refs/tags/${segment(params.tag, 'tag')}` }; break
    case 'contents.list':
    case 'contents.get': plan = { method: 'GET', path: `${base}/contents/${pathValue(params.path)}` }; break
    case 'contents.create':
    case 'contents.update': plan = { method: 'PUT', path: `${base}/contents/${pathValue(params.path)}`, body: JSON.stringify({ message: params.message, content: params.content, ...(params.sha ? { sha: params.sha } : {}), ...paramsForBody(params, ['branch', 'committer', 'author']) }) }; break
    case 'contents.delete': plan = { method: 'DELETE', path: `${base}/contents/${pathValue(params.path)}`, body: JSON.stringify({ message: params.message, sha: params.sha, ...paramsForBody(params, ['branch', 'committer', 'author']) }) }; break
    case 'issue.list': plan = { method: 'GET', path: `${base}/issues` }; break
    case 'issue.get': plan = { method: 'GET', path: `${base}/issues/${integer(params.number)}` }; break
    case 'issue.create': plan = { method: 'POST', path: `${base}/issues`, body: JSON.stringify({ title: params.title, ...(params.body ? { body: params.body } : {}), ...paramsForBody(params, ['assignees', 'milestone', 'labels']) }) }; break
    case 'issue.update': plan = { method: 'PATCH', path: `${base}/issues/${integer(params.number)}`, body: JSON.stringify({ ...(params.title ? { title: params.title } : {}), ...(params.body ? { body: params.body } : {}), ...paramsForBody(params, ['state', 'state_reason', 'labels', 'assignees', 'milestone', 'lock_reason']) }) }; break
    case 'issue.close': plan = { method: 'PATCH', path: `${base}/issues/${integer(params.number)}`, body: JSON.stringify({ state: 'closed' }) }; break
    case 'issue.comment': plan = { method: 'POST', path: `${base}/issues/${integer(params.number)}/comments`, body: JSON.stringify({ body: params.body }) }; break
    case 'pull-request.list': plan = { method: 'GET', path: `${base}/pulls` }; break
    case 'pull-request.get': plan = { method: 'GET', path: `${base}/pulls/${integer(params.number)}` }; break
    case 'pull-request.create': plan = { method: 'POST', path: `${base}/pulls`, body: JSON.stringify({ title: params.title, head: params.headRef ?? params.head, base: params.baseRef ?? params.base, ...(params.body ? { body: params.body } : {}), ...paramsForBody(params, ['maintainer_can_modify', 'draft']) }) }; break
    case 'pull-request.update': plan = { method: 'PATCH', path: `${base}/pulls/${integer(params.number)}`, body: JSON.stringify({ ...(params.title ? { title: params.title } : {}), ...(params.body ? { body: params.body } : {}), ...paramsForBody(params, ['state', 'base', 'maintainer_can_modify']) }) }; break
    case 'pull-request.merge': plan = { method: 'PUT', path: `${base}/pulls/${integer(params.number)}/merge`, body: JSON.stringify(paramsForBody(params, ['commit_title', 'commit_message', 'merge_method', 'sha'])) }; break
    case 'review.list': plan = { method: 'GET', path: `${base}/pulls/${integer(params.number)}/reviews` }; break
    case 'review.get': plan = { method: 'GET', path: `${base}/pulls/${integer(params.number)}/reviews/${integer(params.reviewId)}` }; break
    case 'review.create': plan = { method: 'POST', path: `${base}/pulls/${integer(params.number)}/reviews`, body: JSON.stringify({ body: params.body, event: params.event, ...paramsForBody(params, ['comments']) }) }; break
    case 'review.dismiss': plan = { method: 'PUT', path: `${base}/pulls/${integer(params.number)}/reviews/${integer(params.reviewId)}/dismissals`, body: JSON.stringify({ message: params.message }) }; break
    case 'discussion.list': plan = { method: 'GET', path: `${base}/discussions` }; break
    case 'discussion.get': plan = { method: 'GET', path: `${base}/discussions/${integer(params.number)}` }; break
    case 'discussion.create': plan = { method: 'POST', path: `${base}/discussions`, body: JSON.stringify({ title: params.title, body: params.body, category: params.categoryId }) }; break
    case 'discussion.comment': plan = { method: 'POST', path: `${base}/discussions/${integer(params.number)}/comments`, body: JSON.stringify({ body: params.body }) }; break
    case 'project.list': plan = { method: 'GET', path: `${base}/projects` }; break
    case 'project.get': plan = { method: 'GET', path: `${base}/projects/${integer(params.projectId)}` }; break
    case 'project.create': plan = { method: 'POST', path: `${base}/projects`, body: JSON.stringify({ name: params.name, ...(params.body ? { body: params.body } : {}) }) }; break
    case 'project.update': plan = { method: 'PATCH', path: `${base}/projects/${integer(params.projectId)}`, body: bodyKeys(['name', 'body', 'state']) }; break
    case 'actions.workflow.list': plan = { method: 'GET', path: `${base}/actions/workflows` }; break
    case 'actions.workflow.get': plan = { method: 'GET', path: `${base}/actions/workflows/${integer(params.workflowId)}` }; break
    case 'actions.run.list': plan = { method: 'GET', path: `${base}/actions/runs` }; break
    case 'actions.run.get': plan = { method: 'GET', path: `${base}/actions/runs/${integer(params.runId)}` }; break
    case 'actions.job.list': plan = { method: 'GET', path: `${base}/actions/runs/${integer(params.runId)}/jobs` }; break
    case 'actions.artifact.list': plan = { method: 'GET', path: `${base}/actions/artifacts` }; break
    case 'actions.cache.list': plan = { method: 'GET', path: `${base}/actions/caches` }; break
    case 'actions.environment.list': plan = { method: 'GET', path: `${base}/environments` }; break
    case 'actions.runner.list': plan = { method: 'GET', path: `${base}/actions/runners` }; break
    case 'release.list': plan = { method: 'GET', path: `${base}/releases` }; break
    case 'release.get': plan = { method: 'GET', path: `${base}/releases/${integer(params.releaseId)}` }; break
    case 'release.create': plan = { method: 'POST', path: `${base}/releases`, body: JSON.stringify({ tag_name: params.tag, name: params.name, ...(params.body ? { body: params.body } : {}), ...paramsForBody(params, ['draft', 'prerelease', 'generate_release_notes', 'make_latest', 'target_commitish']) }) }; break
    case 'release.update': plan = { method: 'PATCH', path: `${base}/releases/${integer(params.releaseId)}`, body: bodyKeys(['name', 'body', 'draft', 'prerelease', 'make_latest', 'target_commitish']) }; break
    case 'release.delete': plan = { method: 'DELETE', path: `${base}/releases/${integer(params.releaseId)}` }; break
    case 'package.list': plan = { method: 'GET', path: `/user/packages/${segment(params.packageType, 'packageType')}` }; break
    case 'package.version.list': plan = { method: 'GET', path: `/user/packages/${segment(params.packageType, 'packageType')}/${segment(params.packageName, 'packageName')}/versions` }; break
    case 'package.version.delete': plan = { method: 'DELETE', path: `/user/packages/${segment(params.packageType, 'packageType')}/${segment(params.packageName, 'packageName')}/versions/${integer(params.versionId)}` }; break
    case 'deployment.list': plan = { method: 'GET', path: `${base}/deployments` }; break
    case 'deployment.get': plan = { method: 'GET', path: `${base}/deployments/${integer(params.deploymentId)}` }; break
    case 'deployment.create': plan = { method: 'POST', path: `${base}/deployments`, body: JSON.stringify({ ref: params.ref, ...paramsForBody(params, ['task', 'auto_merge', 'required_contexts', 'payload', 'environment', 'description', 'transient_environment', 'production_environment']) }) }; break
    case 'deployment.status.list': plan = { method: 'GET', path: `${base}/deployments/${integer(params.deploymentId)}/statuses` }; break
    case 'organization.list': plan = { method: 'GET', path: '/user/orgs' }; break
    case 'organization.get': plan = { method: 'GET', path: `/orgs/${segment(params.organization, 'organization')}` }; break
    case 'organization.repository.list': plan = { method: 'GET', path: `/orgs/${segment(params.organization, 'organization')}/repos` }; break
    case 'organization.member.list': plan = { method: 'GET', path: `/orgs/${segment(params.organization, 'organization')}/members` }; break
    case 'team.list': plan = { method: 'GET', path: `/orgs/${segment(params.organization, 'organization')}/teams` }; break
    case 'team.get': plan = { method: 'GET', path: `/teams/${integer(params.teamId)}` }; break
    case 'team.member.list': plan = { method: 'GET', path: `/teams/${integer(params.teamId)}/members` }; break
    case 'user.get': plan = { method: 'GET', path: `/users/${segment(params.username, 'username')}` }; break
    case 'user.repository.list': plan = { method: 'GET', path: `/users/${segment(params.username, 'username')}/repos` }; break
    case 'user.follower.list': plan = { method: 'GET', path: `/users/${segment(params.username, 'username')}/followers` }; break
    case 'notification.list': plan = { method: 'GET', path: '/notifications' }; break
    case 'notification.mark-read': plan = { method: 'PATCH', path: `/notifications/threads/${segment(params.threadId, 'threadId')}` }; break
    case 'search.repository': plan = { method: 'GET', path: `/search/repositories?q=${q('query')}` }; break
    case 'search.issue': plan = { method: 'GET', path: `/search/issues?q=${q('query')}` }; break
    case 'search.code': plan = { method: 'GET', path: `/search/code?q=${q('query')}` }; break
    case 'search.commit': plan = { method: 'GET', path: `/search/commits?q=${q('query')}` }; break
    case 'search.user': plan = { method: 'GET', path: `/search/users?q=${q('query')}` }; break
    case 'security.dependabot.list': plan = { method: 'GET', path: `${base}/dependabot/alerts` }; break
    case 'security.code-scanning.list': plan = { method: 'GET', path: `${base}/code-scanning/alerts` }; break
    case 'security.secret-scanning.list': plan = { method: 'GET', path: `${base}/secret-scanning/alerts` }; break
    case 'ruleset.list': plan = { method: 'GET', path: `${base}/rulesets` }; break
    case 'ruleset.get': plan = { method: 'GET', path: `${base}/rulesets/${integer(params.rulesetId)}` }; break
    case 'ruleset.create': plan = { method: 'POST', path: `${base}/rulesets`, body: JSON.stringify({ name: params.name, target: params.target, enforcement: params.enforcement, ...paramsForBody(params, ['conditions', 'rules', 'bypass_actors']) }) }; break
    case 'ruleset.update': plan = { method: 'PUT', path: `${base}/rulesets/${integer(params.rulesetId)}`, body: bodyKeys(['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors']) }; break
    case 'ruleset.delete': plan = { method: 'DELETE', path: `${base}/rulesets/${integer(params.rulesetId)}` }; break
    case 'webhook.list': plan = { method: 'GET', path: `${base}/hooks` }; break
    case 'webhook.get': plan = { method: 'GET', path: `${base}/hooks/${integer(params.hookId)}` }; break
    case 'webhook.create': plan = { method: 'POST', path: `${base}/hooks`, body: JSON.stringify({ config: params.config, ...paramsForBody(params, ['name', 'events', 'active']) }) }; break
    case 'webhook.update': plan = { method: 'PATCH', path: `${base}/hooks/${integer(params.hookId)}`, body: JSON.stringify({ ...(params.config ? { config: params.config } : {}), ...paramsForBody(params, ['events', 'active', 'name']) }) }; break
    case 'webhook.delete': plan = { method: 'DELETE', path: `${base}/hooks/${integer(params.hookId)}` }; break
    case 'app.get': plan = { method: 'GET', path: '/app' }; break
    case 'app.installation.list': plan = { method: 'GET', path: '/user/installations' }; break
    case 'account.rate-limit': plan = { method: 'GET', path: '/rate_limit' }; break
    default: throw new GitHubClientError('invalid-request')
  }
  return spec.paginated && plan.method === 'GET' ? { ...plan, path: addPaging(plan.path, request) } : plan
}

function sanitize(value: unknown, depth = 0): GitHubApiItem | GitHubApiItem[] | string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' ? value.slice(0, 16_000) : value
  }
  if (depth >= 5) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1) as GitHubApiItem)
  if (typeof value !== 'object') return null
  const output: GitHubApiItem = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/token|secret|password|authorization|cookie|private_key/i.test(key)) continue
    output[key] = sanitize(child, depth + 1)
  }
  return output
}

export function decodeGitHubApiResponse(operation: GitHubApiOperationId, transport: 'rest' | 'graphql', value: unknown, page: number, nextPage?: number, nextCursor?: string): GitHubApiResult {
  const decoded = sanitize(value)
  let items: GitHubApiItem[]
  if (Array.isArray(decoded)) items = decoded.filter((item): item is GitHubApiItem => !!item && typeof item === 'object' && !Array.isArray(item))
  else if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const record = decoded as GitHubApiItem
    const collection = Object.values(record).find((candidate) => Array.isArray(candidate))
    items = Array.isArray(collection) ? collection.filter((item): item is GitHubApiItem => !!item && typeof item === 'object' && !Array.isArray(item)) : [record]
  } else items = []
  return { operation, transport, items, page, ...(nextPage ? { nextPage } : {}), ...(nextCursor ? { nextCursor } : {}), partial: false }
}

export function apiUrl(path: string): string {
  const url = new URL(path, API_ORIGIN)
  if (url.origin !== API_ORIGIN) throw new GitHubClientError('invalid-request')
  return url.toString()
}
