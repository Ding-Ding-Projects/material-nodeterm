/** Safe, portable identity and presentation for a GitHub issue or pull request canvas node. */
export type GitHubWorkItemKind = 'issue' | 'pull-request'
export type GitHubWorkItemState = 'open' | 'closed' | 'merged' | 'unknown'
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
  lastRefreshAt?: string
  refreshState: 'never' | 'fresh' | 'stale' | 'offline' | 'forbidden'
}
export const GITHUB_WORK_ITEM_NODE_SIZE = { width: 620, height: 470 }
export function isGitHubWorkItem(value: unknown): value is GitHubWorkItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<GitHubWorkItem>
  return item.schemaVersion === 1 && (item.kind === 'issue' || item.kind === 'pull-request') &&
    typeof item.repository === 'string' && /^[^/\\s]+\/[^/\\s]+$/.test(item.repository) &&
    Number.isInteger(item.number) && item.number > 0 && typeof item.title === 'string' &&
    typeof item.bodyMarkdown === 'string' && typeof item.htmlUrl === 'string' &&
    Array.isArray(item.labels) && Array.isArray(item.sessionIds)
}
export function normalizeGitHubWorkItem(value: unknown): GitHubWorkItem | undefined {
  if (!isGitHubWorkItem(value)) return undefined
  const item = value as GitHubWorkItem
  return { ...item, title: item.title.slice(0, 1000), bodyMarkdown: item.bodyMarkdown.slice(0, 200_000),
    labels: item.labels.slice(0, 100).map((label) => ({ name: String(label.name).slice(0, 200), ...(label.color ? { color: String(label.color).slice(0, 32) } : {}) })),
    sessionIds: item.sessionIds.filter((id) => typeof id === 'string').slice(0, 100), refreshState: item.refreshState ?? 'never' }
}
