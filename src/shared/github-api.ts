/**
 * Guided GitHub API capabilities. The operation ids are the public contract. Callers choose one
 * of these ids and typed semantic parameters, never an endpoint, query string, shell command, or
 * GraphQL document. The host resolves the credential and the approved repository before dispatch.
 */

export type GitHubApiTransport = 'rest' | 'graphql'
export type GitHubApiScope = 'repository' | 'account' | 'organization'

export const GITHUB_API_CATEGORIES = [
  'repositories', 'branches', 'commits', 'tags', 'contents', 'issues', 'pull-requests', 'reviews',
  'discussions', 'projects', 'actions', 'releases', 'packages', 'deployments', 'organizations',
  'teams', 'users', 'notifications', 'search', 'security', 'rulesets', 'webhooks', 'apps', 'account'
] as const
export type GitHubApiCategory = (typeof GITHUB_API_CATEGORIES)[number]

export type GitHubApiOperationId =
  | 'repository.list' | 'repository.get' | 'repository.update' | 'repository.archive'
  | 'branch.list' | 'branch.get' | 'branch.create' | 'branch.delete' | 'branch.protection.get'
  | 'commit.list' | 'commit.get' | 'commit.compare'
  | 'tag.list' | 'tag.get' | 'tag.create' | 'tag.delete'
  | 'contents.list' | 'contents.get' | 'contents.create' | 'contents.update' | 'contents.delete'
  | 'issue.list' | 'issue.get' | 'issue.create' | 'issue.update' | 'issue.close' | 'issue.comment'
  | 'pull-request.list' | 'pull-request.get' | 'pull-request.create' | 'pull-request.update' | 'pull-request.merge'
  | 'review.list' | 'review.get' | 'review.create' | 'review.dismiss'
  | 'discussion.list' | 'discussion.get' | 'discussion.create' | 'discussion.comment'
  | 'project.list' | 'project.get' | 'project.create' | 'project.update'
  | 'actions.workflow.list' | 'actions.workflow.get' | 'actions.run.list' | 'actions.run.get'
  | 'actions.job.list' | 'actions.artifact.list' | 'actions.cache.list' | 'actions.environment.list'
  | 'actions.runner.list'
  | 'release.list' | 'release.get' | 'release.create' | 'release.update' | 'release.delete'
  | 'package.list' | 'package.version.list' | 'package.version.delete'
  | 'deployment.list' | 'deployment.get' | 'deployment.create' | 'deployment.status.list'
  | 'organization.list' | 'organization.get' | 'organization.repository.list' | 'organization.member.list'
  | 'team.list' | 'team.get' | 'team.member.list'
  | 'user.get' | 'user.repository.list' | 'user.follower.list'
  | 'notification.list' | 'notification.mark-read'
  | 'search.repository' | 'search.issue' | 'search.code' | 'search.commit' | 'search.user'
  | 'security.dependabot.list' | 'security.code-scanning.list' | 'security.secret-scanning.list'
  | 'ruleset.list' | 'ruleset.get' | 'ruleset.create' | 'ruleset.update' | 'ruleset.delete'
  | 'webhook.list' | 'webhook.get' | 'webhook.create' | 'webhook.update' | 'webhook.delete'
  | 'app.get' | 'app.installation.list' | 'account.profile' | 'account.rate-limit'

export interface GitHubApiOperation {
  id: GitHubApiOperationId
  category: GitHubApiCategory
  label: string
  transport: GitHubApiTransport
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  scope: GitHubApiScope
  destructive: boolean
  paginated: boolean
  requiredParams: readonly string[]
}

const operation = (
  id: GitHubApiOperationId,
  category: GitHubApiCategory,
  label: string,
  method: GitHubApiOperation['method'],
  scope: GitHubApiScope,
  requiredParams: readonly string[] = [],
  options: Partial<Pick<GitHubApiOperation, 'transport' | 'destructive' | 'paginated'>> = {}
): GitHubApiOperation => ({
  id, category, label, method, scope, requiredParams,
  transport: options.transport ?? 'rest',
  destructive: options.destructive ?? false,
  paginated: options.paginated ?? (method === 'GET')
})

/** Hand-written completeness inventory. Keep this exhaustive and stable so a missing capability
 * cannot disappear from the picker merely because the implementation forgot to register it. */
export const GITHUB_API_OPERATIONS: readonly GitHubApiOperation[] = [
  operation('repository.list', 'repositories', 'List repositories', 'GET', 'account', [], { paginated: true }),
  operation('repository.get', 'repositories', 'Read repository', 'GET', 'repository', ['repository']),
  operation('repository.update', 'repositories', 'Update repository', 'PATCH', 'repository', ['repository']),
  operation('repository.archive', 'repositories', 'Archive repository', 'PATCH', 'repository', ['repository'], { destructive: true, paginated: false }),
  operation('branch.list', 'branches', 'List branches', 'GET', 'repository', ['repository']),
  operation('branch.get', 'branches', 'Read branch', 'GET', 'repository', ['repository', 'branch']),
  operation('branch.create', 'branches', 'Create branch', 'POST', 'repository', ['repository', 'branch', 'sha'], { paginated: false }),
  operation('branch.delete', 'branches', 'Delete branch', 'DELETE', 'repository', ['repository', 'branch'], { destructive: true, paginated: false }),
  operation('branch.protection.get', 'branches', 'Read branch protection', 'GET', 'repository', ['repository', 'branch'], { paginated: false }),
  operation('commit.list', 'commits', 'List commits', 'GET', 'repository', ['repository']),
  operation('commit.get', 'commits', 'Read commit', 'GET', 'repository', ['repository', 'sha'], { paginated: false }),
  operation('commit.compare', 'commits', 'Compare commits', 'GET', 'repository', ['repository', 'base', 'head'], { paginated: false }),
  operation('tag.list', 'tags', 'List tags', 'GET', 'repository', ['repository']),
  operation('tag.get', 'tags', 'Read tag', 'GET', 'repository', ['repository', 'tag'], { paginated: false }),
  operation('tag.create', 'tags', 'Create tag', 'POST', 'repository', ['repository', 'tag', 'sha'], { paginated: false }),
  operation('tag.delete', 'tags', 'Delete tag', 'DELETE', 'repository', ['repository', 'tag'], { destructive: true, paginated: false }),
  operation('contents.list', 'contents', 'List contents', 'GET', 'repository', ['repository', 'path']),
  operation('contents.get', 'contents', 'Read content', 'GET', 'repository', ['repository', 'path'], { paginated: false }),
  operation('contents.create', 'contents', 'Create content', 'PUT', 'repository', ['repository', 'path', 'content', 'message'], { paginated: false }),
  operation('contents.update', 'contents', 'Update content', 'PUT', 'repository', ['repository', 'path', 'content', 'message', 'sha'], { paginated: false }),
  operation('contents.delete', 'contents', 'Delete content', 'DELETE', 'repository', ['repository', 'path', 'message', 'sha'], { destructive: true, paginated: false }),
  operation('issue.list', 'issues', 'List issues', 'GET', 'repository', ['repository']),
  operation('issue.get', 'issues', 'Read issue', 'GET', 'repository', ['repository', 'number'], { paginated: false }),
  operation('issue.create', 'issues', 'Create issue', 'POST', 'repository', ['repository', 'title'], { paginated: false }),
  operation('issue.update', 'issues', 'Update issue', 'PATCH', 'repository', ['repository', 'number'], { paginated: false }),
  operation('issue.close', 'issues', 'Close issue', 'PATCH', 'repository', ['repository', 'number'], { destructive: true, paginated: false }),
  operation('issue.comment', 'issues', 'Comment on issue', 'POST', 'repository', ['repository', 'number', 'body'], { paginated: false }),
  operation('pull-request.list', 'pull-requests', 'List pull requests', 'GET', 'repository', ['repository']),
  operation('pull-request.get', 'pull-requests', 'Read pull request', 'GET', 'repository', ['repository', 'number'], { paginated: false }),
  operation('pull-request.create', 'pull-requests', 'Create pull request', 'POST', 'repository', ['repository', 'title', 'head', 'base'], { paginated: false }),
  operation('pull-request.update', 'pull-requests', 'Update pull request', 'PATCH', 'repository', ['repository', 'number'], { paginated: false }),
  operation('pull-request.merge', 'pull-requests', 'Merge pull request', 'PUT', 'repository', ['repository', 'number'], { destructive: true, paginated: false }),
  operation('review.list', 'reviews', 'List reviews', 'GET', 'repository', ['repository', 'number']),
  operation('review.get', 'reviews', 'Read review', 'GET', 'repository', ['repository', 'number', 'reviewId'], { paginated: false }),
  operation('review.create', 'reviews', 'Create review', 'POST', 'repository', ['repository', 'number', 'body', 'event'], { paginated: false }),
  operation('review.dismiss', 'reviews', 'Dismiss review', 'PUT', 'repository', ['repository', 'number', 'reviewId', 'message'], { destructive: true, paginated: false }),
  operation('discussion.list', 'discussions', 'List discussions', 'GET', 'repository', ['repository']),
  operation('discussion.get', 'discussions', 'Read discussion', 'GET', 'repository', ['repository', 'number'], { paginated: false }),
  operation('discussion.create', 'discussions', 'Create discussion', 'POST', 'repository', ['repository', 'title', 'body', 'categoryId'], { paginated: false }),
  operation('discussion.comment', 'discussions', 'Comment on discussion', 'POST', 'repository', ['repository', 'number', 'body'], { paginated: false }),
  operation('project.list', 'projects', 'List projects', 'GET', 'repository', ['repository']),
  operation('project.get', 'projects', 'Read project', 'GET', 'repository', ['repository', 'projectId'], { paginated: false }),
  operation('project.create', 'projects', 'Create project', 'POST', 'repository', ['repository', 'name'], { paginated: false }),
  operation('project.update', 'projects', 'Update project', 'PATCH', 'repository', ['repository', 'projectId'], { paginated: false }),
  operation('actions.workflow.list', 'actions', 'List workflows', 'GET', 'repository', ['repository']),
  operation('actions.workflow.get', 'actions', 'Read workflow', 'GET', 'repository', ['repository', 'workflowId'], { paginated: false }),
  operation('actions.run.list', 'actions', 'List workflow runs', 'GET', 'repository', ['repository']),
  operation('actions.run.get', 'actions', 'Read workflow run', 'GET', 'repository', ['repository', 'runId'], { paginated: false }),
  operation('actions.job.list', 'actions', 'List jobs for run', 'GET', 'repository', ['repository', 'runId']),
  operation('actions.artifact.list', 'actions', 'List workflow artifacts', 'GET', 'repository', ['repository']),
  operation('actions.cache.list', 'actions', 'List Actions caches', 'GET', 'repository', ['repository']),
  operation('actions.environment.list', 'actions', 'List environments', 'GET', 'repository', ['repository']),
  operation('actions.runner.list', 'actions', 'List repository runners', 'GET', 'repository', ['repository']),
  operation('release.list', 'releases', 'List releases', 'GET', 'repository', ['repository']),
  operation('release.get', 'releases', 'Read release', 'GET', 'repository', ['repository', 'releaseId'], { paginated: false }),
  operation('release.create', 'releases', 'Create release', 'POST', 'repository', ['repository', 'tag', 'name'], { paginated: false }),
  operation('release.update', 'releases', 'Update release', 'PATCH', 'repository', ['repository', 'releaseId'], { paginated: false }),
  operation('release.delete', 'releases', 'Delete release', 'DELETE', 'repository', ['repository', 'releaseId'], { destructive: true, paginated: false }),
  operation('package.list', 'packages', 'List packages', 'GET', 'account', ['packageType']),
  operation('package.version.list', 'packages', 'List package versions', 'GET', 'account', ['packageType', 'packageName']),
  operation('package.version.delete', 'packages', 'Delete package version', 'DELETE', 'account', ['packageType', 'packageName', 'versionId'], { destructive: true, paginated: false }),
  operation('deployment.list', 'deployments', 'List deployments', 'GET', 'repository', ['repository']),
  operation('deployment.get', 'deployments', 'Read deployment', 'GET', 'repository', ['repository', 'deploymentId'], { paginated: false }),
  operation('deployment.create', 'deployments', 'Create deployment', 'POST', 'repository', ['repository', 'ref'], { paginated: false }),
  operation('deployment.status.list', 'deployments', 'List deployment statuses', 'GET', 'repository', ['repository', 'deploymentId']),
  operation('organization.list', 'organizations', 'List organizations', 'GET', 'account'),
  operation('organization.get', 'organizations', 'Read organization', 'GET', 'organization', ['organization'], { paginated: false }),
  operation('organization.repository.list', 'organizations', 'List organization repositories', 'GET', 'organization', ['organization']),
  operation('organization.member.list', 'organizations', 'List organization members', 'GET', 'organization', ['organization']),
  operation('team.list', 'teams', 'List teams', 'GET', 'organization', ['organization']),
  operation('team.get', 'teams', 'Read team', 'GET', 'organization', ['teamId'], { paginated: false }),
  operation('team.member.list', 'teams', 'List team members', 'GET', 'organization', ['teamId']),
  operation('user.get', 'users', 'Read user', 'GET', 'account', ['username'], { paginated: false }),
  operation('user.repository.list', 'users', 'List user repositories', 'GET', 'account', ['username']),
  operation('user.follower.list', 'users', 'List followers', 'GET', 'account', ['username']),
  operation('notification.list', 'notifications', 'List notifications', 'GET', 'account'),
  operation('notification.mark-read', 'notifications', 'Mark notification read', 'PATCH', 'account', ['threadId'], { paginated: false }),
  operation('search.repository', 'search', 'Search repositories', 'GET', 'account', ['query']),
  operation('search.issue', 'search', 'Search issues', 'GET', 'account', ['query']),
  operation('search.code', 'search', 'Search code', 'GET', 'account', ['query']),
  operation('search.commit', 'search', 'Search commits', 'GET', 'account', ['query']),
  operation('search.user', 'search', 'Search users', 'GET', 'account', ['query']),
  operation('security.dependabot.list', 'security', 'List Dependabot alerts', 'GET', 'repository', ['repository']),
  operation('security.code-scanning.list', 'security', 'List code scanning alerts', 'GET', 'repository', ['repository']),
  operation('security.secret-scanning.list', 'security', 'List secret scanning alerts', 'GET', 'repository', ['repository']),
  operation('ruleset.list', 'rulesets', 'List rulesets', 'GET', 'repository', ['repository']),
  operation('ruleset.get', 'rulesets', 'Read ruleset', 'GET', 'repository', ['repository', 'rulesetId'], { paginated: false }),
  operation('ruleset.create', 'rulesets', 'Create ruleset', 'POST', 'repository', ['repository', 'name', 'target', 'enforcement'], { paginated: false }),
  operation('ruleset.update', 'rulesets', 'Update ruleset', 'PUT', 'repository', ['repository', 'rulesetId'], { paginated: false }),
  operation('ruleset.delete', 'rulesets', 'Delete ruleset', 'DELETE', 'repository', ['repository', 'rulesetId'], { destructive: true, paginated: false }),
  operation('webhook.list', 'webhooks', 'List webhooks', 'GET', 'repository', ['repository']),
  operation('webhook.get', 'webhooks', 'Read webhook', 'GET', 'repository', ['repository', 'hookId'], { paginated: false }),
  operation('webhook.create', 'webhooks', 'Create webhook', 'POST', 'repository', ['repository', 'config'], { paginated: false }),
  operation('webhook.update', 'webhooks', 'Update webhook', 'PATCH', 'repository', ['repository', 'hookId'], { paginated: false }),
  operation('webhook.delete', 'webhooks', 'Delete webhook', 'DELETE', 'repository', ['repository', 'hookId'], { destructive: true, paginated: false }),
  operation('app.get', 'apps', 'Read current app', 'GET', 'account', [], { paginated: false }),
  operation('app.installation.list', 'apps', 'List app installations', 'GET', 'account'),
  operation('account.profile', 'account', 'Read account profile', 'GET', 'account', [], { transport: 'graphql', paginated: false }),
  operation('account.rate-limit', 'account', 'Read rate limit', 'GET', 'account', [], { paginated: false })
] as const

export interface GitHubApiSemanticParams {
  repository?: string
  branch?: string
  sha?: string
  base?: string
  head?: string
  tag?: string
  path?: string
  number?: number
  reviewId?: number
  projectId?: number
  runId?: number
  workflowId?: number
  releaseId?: number
  deploymentId?: number
  rulesetId?: number
  hookId?: number
  teamId?: number
  threadId?: string
  versionId?: number
  organization?: string
  username?: string
  packageType?: string
  packageName?: string
  query?: string
  title?: string
  name?: string
  body?: string
  message?: string
  content?: string
  event?: string
  headRef?: string
  baseRef?: string
  categoryId?: string
  ref?: string
  target?: string
  enforcement?: string
  config?: Record<string, string>
  input?: Record<string, string | number | boolean | null | readonly string[]>
  perPage?: number
}

export interface GitHubApiRequest {
  operation: GitHubApiOperationId
  params: GitHubApiSemanticParams
  /** Required for repository-scoped actions. The host uses it to resolve the approved repository. */
  projectId?: string
  page?: number
  cursor?: string
  /** Set only after the app's native two-key destructive confirmation completes for this exact
   * operation. It is not a credential and never carries a secret. */
  destructiveConfirmation?: { completed: true; operation: GitHubApiOperationId }
}

export interface GitHubApiItem {
  id?: string | number
  number?: number
  name?: string
  title?: string
  login?: string
  state?: string
  status?: string
  url?: string
  htmlUrl?: string
  [key: string]: unknown
}

export interface GitHubApiResult {
  operation: GitHubApiOperationId
  transport: GitHubApiTransport
  items: GitHubApiItem[]
  page: number
  nextPage?: number
  nextCursor?: string
  partial: boolean
  rateLimit?: { remaining: number | null; limit: number | null; resetAt: number | null }
}

export interface GitHubApiCapabilities {
  apiVersion: '2022-11-28'
  restBaseUrl: 'https://api.github.com'
  graphqlUrl: 'https://api.github.com/graphql'
  operations: readonly GitHubApiOperation[]
  scopes: readonly GitHubApiScope[]
  maxPageSize: 100
  maxResponseBytes: number
  rawRequests: false
  arbitraryShell: false
  rendererCredentials: false
}

export interface GitHubApiProgress {
  operationId: string
  operation: GitHubApiOperationId
  phase: 'queued' | 'requesting' | 'decoding' | 'completed' | 'cancelled' | 'failed'
  completed: number
  total: number | null
  message: string
}

export interface GitHubApiApi {
  capabilities(): Promise<GitHubApiCapabilities>
  execute(request: GitHubApiRequest): Promise<GitHubApiResult>
  cancel(operationId: string): Promise<void>
  onProgress(listener: (progress: GitHubApiProgress) => void): () => void
}
