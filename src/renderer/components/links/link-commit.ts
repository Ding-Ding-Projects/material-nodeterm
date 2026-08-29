import type { Link } from '@shared/types'

/** Canvas owns live edge reconciliation, while React Flow mounts link inspectors outside its
 * prop tree. This bridge keeps inspector writes in step with the active canvas refs. */
let handler: ((projectId: string, links: Link[]) => void) | null = null

export function setLinkCommitHandler(next: ((projectId: string, links: Link[]) => void) | null): void {
  handler = next
}

/** Returns false when no Canvas is mounted, so isolated surfaces can report a local fallback. */
export function commitLinksThroughCanvas(projectId: string, links: Link[]): boolean {
  if (!handler) return false
  handler(projectId, links)
  return true
}
