import { useMemo, useState } from 'react'
import { useProjects } from '../../state/projects'
import { useSession } from '../../session/session'
import type { Link } from '@shared/types'
import {
  describeEndpoint,
  applyDependencyLink,
  isBranchDependencyLink,
  linksForNode,
  offCanvasLinkColor,
  removeDependencyLinkConfig,
  type ProjectLookup
} from '../../lib/link-authoring'
import { Button, IconButton } from '@renderer/ui/md3'
import { LinkTargetPicker } from './LinkTargetPicker'
import { commitLinksThroughCanvas } from './link-commit'

/** A compact inspector for all typed links involving one node. */
export function LinkInspectorPanel({ nodeId, onClose, onChanged }: { nodeId: string; onClose: () => void; onChanged?: () => void }) {
  const { api } = useSession()
  const [adding, setAdding] = useState(false)
  const [submodules, setSubmodules] = useState<{ path: string; sha: string; initialized: boolean }[] | null>(null)
  const [submoduleError, setSubmoduleError] = useState<string | null>(null)
  const [dependencyAction, setDependencyAction] = useState<string | null>(null)
  const projects = useProjects(
    (state) => state.projects.map((project) => ({ id: project.id, name: project.name, cwd: project.cwd, nodes: project.nodes, closed: project.closed, unavailable: project.unavailable })) as ProjectLookup[]
  )
  const owner = projects.find((project) => project.nodes.some((node) => node.id === nodeId))
  const links = useProjects((state) => state.projects.find((project) => project.id === owner?.id)?.links ?? [])
  const split = useMemo(() => linksForNode(links, nodeId), [links, nodeId])

  const remove = (link: Link): void => {
    if (!owner) return
    const next = links.filter((candidate) => candidate.id !== link.id)
    if (!commitLinksThroughCanvas(owner.id, next)) {
      useProjects.getState().setProjectLinks(owner.id, next)
    }
    onChanged?.()
    if (isBranchDependencyLink(link)) {
      void removeDependencyLinkConfig(api.git, link).then((result) => {
        if (!result.ok) {
          window.dispatchEvent(new CustomEvent('nodeterm:toast', {
            detail: { kind: 'error', message: `The link was removed, but its branch setting was not cleared: ${result.message}` }
          }))
        }
      })
    }
  }

  const inspectSubmodules = (): void => {
    if (!owner?.cwd) {
      setSubmoduleError('This project has no local repository directory.')
      setSubmodules(null)
      return
    }
    setSubmoduleError(null)
    void api.git.submoduleList(owner.cwd).then((result) => {
      if (!result.ok) {
        setSubmodules(null)
        setSubmoduleError('The recursive submodule read was unavailable.')
        return
      }
      setSubmodules(result.entries.map((entry) => ({ path: entry.path, sha: entry.sha, initialized: !entry.prunable })))
    }).catch(() => {
      setSubmodules(null)
      setSubmoduleError('The recursive submodule read failed.')
    })
  }

  return (
    <aside className="link-inspector" role="dialog" aria-label="Link inspector">
      <div className="link-inspector__head">
        <strong>Links</strong>
        <IconButton size="compact" icon="close" onClick={onClose} aria-label="Close link inspector" />
      </div>
      {split.outgoing.length === 0 && split.incoming.length === 0 ? (
        <p className="link-inspector__empty">No links for this node.</p>
      ) : (
        <div className="link-inspector__body">
          {[...split.outgoing.map((link) => ({ link, incoming: false })), ...split.incoming.map((link) => ({ link, incoming: true }))].map(({ link, incoming }) => {
            const endpoint = incoming ? link.source : link.target
            const description = describeEndpoint(endpoint, projects)
            return (
              <div className="link-row" key={link.id}>
                <span className="link-row__kind" style={{ color: offCanvasLinkColor(link) }}>{link.kind}</span>
                <span className={description.available ? 'link-row__target' : 'link-row__target unavailable'}>{incoming ? '← ' : '→ '}{description.label}</span>
                {isBranchDependencyLink(link) && !incoming && (
                  <span className="link-row__actions">
                    {(['sync', 'propose', 'ship'] as const).map((action) => (
                      <Button
                        variant="text"
                        size="small"
                        key={action}
                        disabled={dependencyAction === `${link.id}:${action}`}
                        onClick={() => {
                          const actionKey = `${link.id}:${action}`
                          setDependencyAction(actionKey)
                          const operation = action === 'sync'
                            ? api.git.syncBranch(link.source.repoPath, link.source.branch)
                            : action === 'propose'
                              ? api.git.proposeBranch(link.source.repoPath, link.source.branch)
                              : api.git.shipBranch(link.target.repoPath, link.source.branch, link.target.branch)
                          void operation.then((result) => {
                            window.dispatchEvent(new CustomEvent('nodeterm:toast', {
                              detail: { kind: result.ok ? 'info' : 'error', message: result.message }
                            }))
                          }).catch(() => {
                            window.dispatchEvent(new CustomEvent('nodeterm:toast', {
                              detail: { kind: 'error', message: `The ${action} operation could not be completed.` }
                            }))
                          }).finally(() => setDependencyAction(null))
                        }}
                        aria-label={`${action} branch dependency`}
                      >
                        {action}
                      </Button>
                    ))}
                  </span>
                )}
                <IconButton size="compact" icon="close" onClick={() => remove(link)} aria-label="Remove link" />
              </div>
            )
          })}
        </div>
      )}
      {owner && (
        <Button variant="outlined" size="small" className="link-inspector__add" onClick={() => setAdding(true)}>Add link</Button>
      )}
      {owner && (
        <Button variant="outlined" size="small" className="link-inspector__add" onClick={inspectSubmodules}>Inspect submodules</Button>
      )}
      {submoduleError && <p className="link-inspector__empty">{submoduleError}</p>}
      {submodules && (
        <div className="link-inspector__submodules" aria-label="Submodules">
          {submodules.length === 0 ? <p className="link-inspector__empty">No submodules were reported.</p> : submodules.map((entry) => (
            <div className="link-row" key={`${entry.path}:${entry.sha}`}>
              <span className="link-row__target">{entry.path}</span>
              <small>{entry.initialized ? entry.sha.slice(0, 8) : 'uninitialized'}</small>
            </div>
          ))}
        </div>
      )}
      {adding && owner && (
        <LinkTargetPicker
          sourceNodeId={nodeId}
          sourceProjectId={owner.id}
          onConfirm={(link) => {
            void applyDependencyLink(api.git, link).then((result) => {
              if (!result.ok) {
                window.dispatchEvent(new CustomEvent('nodeterm:toast', {
                  detail: { kind: 'error', message: `The link was not saved: ${result.message}` }
                }))
                return
              }
              const next = [...links, link]
              if (!commitLinksThroughCanvas(owner.id, next)) {
                useProjects.getState().setProjectLinks(owner.id, next)
              }
              setAdding(false)
              onChanged?.()
            })
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </aside>
  )
}
