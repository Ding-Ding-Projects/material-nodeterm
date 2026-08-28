/** Safe, portable identity and presentation for a GitHub issue or pull request canvas node. */
export type GitHubWorkItemKind = 'issue' | 'pull-request'
export type GitHubWorkItemState = 'open' | 'closed' | 'merged' | 'unknown'
export type GitHubWorkItemBinding = 'explicit' | 'adopted'
export interface GitHubWorkItemLabel { name: string; color?: string }
export interface GitHubWorkItemPerson { login: string; avatarUrl?: string }
export interface GitHubWorkItem {
  schemaVersion: 1
  kind: GitHubWorkItemKind
  repository: string
  number: number
  title: string
  bodyMarkdown: string
  state: GitHubWorkItemState
  author: GitHubWorkItemPerson | null
  labels: GitHubWorkItemLabel[]
  reviewState?: string
  checksState?: string
  createdAt?: string
  updatedAt?: string
  closedAt?: string
  mergedAt?: string
  htmlUrl: string
  sessionIds: string[]
  /** Exact canvas node id chosen by the user for the compact chip attachment. */
  attachedNodeId?: string
  /** Exact owning frame id, set only for an explicit attachment or verified adoption. */
  owningGroupId?: string
  /** Provider-reported head ref, kept only to evaluate exact frame adoption. */
  headRef?: string
  binding?: GitHubWorkItemBinding
  lastRefreshAt?: string
  refreshState: 'never' | 'fresh' | 'stale' | 'offline' | 'forbidden'
}
export const GITHUB_WORK_ITEM_NODE_SIZE = { width: 620, height: 470 }
export const GITHUB_WORK_ITEM_CHIP_MAX = 56

export type GitHubWorkItemDisplayState = 'running' | 'needs-you' | 'passed' | 'failed' | 'unknown'

/** Map provider facts to the small, stable status vocabulary used by chips and pills. */
export function githubWorkItemDisplayState(item: Pick<GitHubWorkItem, 'state' | 'reviewState' | 'checksState'>): GitHubWorkItemDisplayState {
  const review = String(item.reviewState ?? '').toLowerCase()
  const checks = String(item.checksState ?? '').toLowerCase()
  if (checks.includes('fail') || checks.includes('error') || review.includes('changes requested')) return 'failed'
  if (review.includes('await') || review.includes('request') || checks.includes('pending') || checks.includes('running')) return 'needs-you'
  if (item.state === 'merged' || checks.includes('pass') || checks.includes('success') || checks.includes('complete')) return 'passed'
  if (item.state === 'open') return 'running'
  return 'unknown'
}

/** A frame may adopt a pull request only when the provider head ref exactly matches its app-owned branch. */
export function canAdoptPullRequestOnFrame(
  item: Pick<GitHubWorkItem, 'kind' | 'headRef'>,
  frameBranch: string | undefined
): boolean {
  return item.kind === 'pull-request' && typeof item.headRef === 'string' && item.headRef.length > 0 && item.headRef === frameBranch
}

export function workItemAttachedToNode(item: Pick<GitHubWorkItem, 'attachedNodeId'>, nodeId: string): boolean {
  return item.attachedNodeId === nodeId
}

export function workItemVisibleOnFrame(
  item: Pick<GitHubWorkItem, 'owningGroupId' | 'binding' | 'kind' | 'headRef'>,
  frameId: string,
  frameBranch?: string
): boolean {
  if (item.owningGroupId === frameId) return true
  return item.binding === 'adopted' && canAdoptPullRequestOnFrame(item, frameBranch)
}

/** Convert one bounded typed API result into the portable work-item shape. */
export function githubPullRequestFromApiItem(
  item: Record<string, unknown>,
  repository: string
): GitHubWorkItem | undefined {
  const number = Number.isInteger(item.number) ? Number(item.number) : undefined
  const title = typeof item.title === 'string' ? item.title : undefined
  if (!number || number < 1 || !title || !repository) return undefined
  const text = (key: string): string | undefined => typeof item[key] === 'string' ? String(item[key]) : undefined
  const nested = (key: string): Record<string, unknown> | undefined =>
    item[key] && typeof item[key] === 'object' ? item[key] as Record<string, unknown> : undefined
  const state = text('state')
  const mergedAt = text('merged_at')
  const labels = Array.isArray(item.labels)
    ? item.labels.slice(0, 100).flatMap((label) => {
        if (!label || typeof label !== 'object') return []
        const record = label as Record<string, unknown>
        return typeof record.name === 'string'
          ? [{ name: record.name.slice(0, 200), ...(typeof record.color === 'string' ? { color: record.color.slice(0, 32) } : {}) }]
          : []
      })
    : []
  const head = nested('head')
  const user = nested('user')
  return normalizeGitHubWorkItem({
    schemaVersion: 1,
    kind: 'pull-request',
    repository,
    number,
    title: title.slice(0, 1000),
    bodyMarkdown: text('body') ?? '',
    state: mergedAt ? 'merged' : state === 'open' || state === 'closed' ? state : 'unknown',
    author: typeof user?.login === 'string' ? { login: user.login.slice(0, 200), ...(typeof user.avatar_url === 'string' ? { avatarUrl: user.avatar_url.slice(0, 1000) } : {}) } : null,
    labels,
    reviewState: item.draft === true ? 'draft' : text('review_state'),
    checksState: text('mergeable_state') ?? text('status'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    closedAt: text('closed_at'),
    mergedAt,
    htmlUrl: text('htmlUrl') ?? text('html_url') ?? '',
    sessionIds: [],
    headRef: typeof head?.ref === 'string' ? head.ref.slice(0, 512) : undefined,
    refreshState: 'fresh'
  })
}
export function isGitHubWorkItem(value: unknown): value is GitHubWorkItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<GitHubWorkItem>
  return item.schemaVersion === 1 && (item.kind === 'issue' || item.kind === 'pull-request') &&
    typeof item.repository === 'string' && /^[^/\\s]+\/[^/\\s]+$/.test(item.repository) &&
    typeof item.number === 'number' && Number.isInteger(item.number) && item.number > 0 && typeof item.title === 'string' &&
    typeof item.bodyMarkdown === 'string' && typeof item.htmlUrl === 'string' &&
    Array.isArray(item.labels) && Array.isArray(item.sessionIds)
}
export function normalizeGitHubWorkItem(value: unknown): GitHubWorkItem | undefined {
  if (!isGitHubWorkItem(value)) return undefined
  const item = value as GitHubWorkItem
  return { ...item, title: item.title.slice(0, 1000), bodyMarkdown: item.bodyMarkdown.slice(0, 200_000),
    labels: item.labels.slice(0, 100).map((label) => ({ name: String(label.name).slice(0, 200), ...(label.color ? { color: String(label.color).slice(0, 32) } : {}) })),
    sessionIds: item.sessionIds.filter((id) => typeof id === 'string').slice(0, 100),
    ...(typeof item.attachedNodeId === 'string' && item.attachedNodeId.length < 256 ? { attachedNodeId: item.attachedNodeId } : {}),
    ...(typeof item.owningGroupId === 'string' && item.owningGroupId.length < 256 ? { owningGroupId: item.owningGroupId } : {}),
    ...(typeof item.headRef === 'string' && item.headRef.length < 512 ? { headRef: item.headRef } : {}),
    ...(item.binding === 'explicit' || item.binding === 'adopted' ? { binding: item.binding } : {}),
    refreshState: item.refreshState ?? 'never' }
}
