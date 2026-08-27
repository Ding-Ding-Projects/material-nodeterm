import type { Link } from '@shared/types'

/** Canvas owns live-edge and persisted-link reconciliation, but React Flow instantiates node
 * components outside its prop tree. Register one commit funnel so inspectors cannot mutate the
 * project store behind Canvas's edge refs and lose their edit on autosave. */
let handler: ((projectId: string, links: Link[]) => void) | null = null

export function setLinkCommitHandler(next: ((projectId: string, links: Link[]) => void) | null): void {
  handler = next
}

/** Returns false outside a mounted Canvas, where no live edge owner is available. */
export function commitLinksThroughCanvas(projectId: string, links: Link[]): boolean {
  if (!handler) return false
  handler(projectId, links)
  return true
}
