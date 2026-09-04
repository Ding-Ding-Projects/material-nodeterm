/** Pure planning helpers for connecting opened submodule projects on a project overview canvas. */
import type { Link } from '@shared/types'
import type { SubmoduleEntry } from '@shared/worktree'
import { dependencyLink } from './noteLink'

export interface RefGroup {
  groupId: string
  projectId: string
}

export interface OpenProjectByCwd {
  cwd: string
  projectId: string
}

export interface SubmoduleLinkPlan {
  links: Link[]
  groupsToCreate: { projectId: string; color?: string }[]
}

/** Plan idempotent dependency links without creating ghost endpoints for unopened projects. */
export function planSubmoduleLinks(
  referencing: RefGroup,
  repoRoot: string,
  submodules: readonly SubmoduleEntry[],
  openProjects: readonly OpenProjectByCwd[],
  existingGroupForProject: ReadonlyMap<string, string>,
  existingLinkIds: ReadonlySet<string>
): SubmoduleLinkPlan {
  const links: Link[] = []
  const groupsToCreate: { projectId: string; color?: string }[] = []
  const root = repoRoot.replace(/[\\/]+$/, '')
  for (const submodule of submodules) {
    const absolute = `${root}/${submodule.path.replace(/^[\\/]+/, '')}`
    const project = openProjects.find((candidate) => candidate.cwd === absolute)
    if (!project) continue
    const groupId = existingGroupForProject.get(project.projectId)
    if (!groupId) {
      if (!groupsToCreate.some((candidate) => candidate.projectId === project.projectId)) {
        groupsToCreate.push({ projectId: project.projectId })
      }
      continue
    }
    const link = dependencyLink(groupId, referencing.groupId)
    if (!existingLinkIds.has(link.id)) links.push(link)
  }
  return { links, groupsToCreate }
}

export function existingDependencyLinkKeys(links: readonly Link[] | undefined): Set<string> {
  return new Set((links ?? []).filter((link) => link.kind === 'dependency').map((link) => link.id))
}
