/**
 * Schema 3 import preparation and destination-computer binding plan.
 *
 * This module is deliberately platform-free. It validates and hydrates portable presentation,
 * then creates local follow-up choices. It never resolves a credential, probes a path, starts a
 * process, contacts a provider, downloads an asset, deploys a service, or adopts a resource.
 */

import type {
  CanvasNodeState,
  DestinationBindingAction,
  DestinationBindingDecision,
  DestinationBindingPlan,
  DestinationBindingRequirement,
  Project,
  ProjectIcon
} from '../shared/types'
import type { PortableProjectOmission } from './portable-project-v3'
import {
  type PortableCanvasNodeV3,
  type PortableCanvasProjectionV3,
  validatePortableCanvasProjectionV3
} from './portable-canvas-projection'

const ASSET_KINDS = new Set(['image', 'photo', 'video', 'gallery', 'audio', 'media'])
const PROVIDER_KINDS = new Set([
  'aws',
  'cloudflare',
  'docker',
  'home-assistant',
  'nextcloud',
  'open-webui',
  'service',
  'minecraft'
])
const LOCAL_RUNTIME_KINDS = new Set(['terminal', 'agent', 'editor', 'browser', 'ssh'])

function bindingActions(node: PortableCanvasNodeV3): {
  actions: DestinationBindingAction[]
  recommendedAction: DestinationBindingAction
  reason: string
} | null {
  const kind = node.kind.toLocaleLowerCase('en-US')
  if (ASSET_KINDS.has(kind)) {
    return {
      actions: ['locate-asset', 'leave-unbound'],
      recommendedAction: 'locate-asset',
      reason: 'The portable project keeps the asset intent, but no source-computer path travels with it.'
    }
  }
  if (PROVIDER_KINDS.has(kind)) {
    return {
      actions: ['configure', 'rebind', 'adopt', 'deploy', 'leave-unbound'],
      recommendedAction: 'rebind',
      reason: 'Provider credentials, sessions, host identities, and live resource identifiers stay on the source computer.'
    }
  }
  if (LOCAL_RUNTIME_KINDS.has(kind)) {
    return {
      actions: ['configure', 'rebind', 'leave-unbound'],
      recommendedAction: 'configure',
      reason: 'Executable choices, profiles, working paths, sessions, and process state are local to each computer.'
    }
  }
  return null
}

function iconFromProjection(value: PortableCanvasProjectionV3['project']['icon']): ProjectIcon | undefined {
  if (!value) return undefined
  if (value.type === 'emoji') return { type: 'emoji', emoji: value.name }
  if (value.type === 'material-symbol') return { type: 'material-symbol', name: value.name }
  return undefined
}

/** Build the explicit, side-effect-free choices the destination computer must resolve. */
export function planDestinationBindings(
  projectionInput: PortableCanvasProjectionV3,
  omissions: readonly PortableProjectOmission[] = []
): DestinationBindingPlan {
  const projection = validatePortableCanvasProjectionV3(projectionInput)
  const requirements: DestinationBindingRequirement[] = []
  for (const node of projection.nodes) {
    const binding = bindingActions(node)
    if (!binding) continue
    requirements.push({
      id: `binding:${node.id}`,
      nodeId: node.id,
      nodeTitle: node.title,
      featureId: node.kind,
      ...binding
    })
  }
  requirements.sort((a, b) => a.nodeTitle.localeCompare(b.nodeTitle) || a.nodeId.localeCompare(b.nodeId))
  return {
    schemaVersion: 1,
    projectName: projection.project.name,
    requirements,
    omissions: omissions.map((item) => ({ path: item.path, reason: item.reason, detail: item.detail })),
    sideEffects: 'none'
  }
}

/** Hydrate safe presentation only. Local authority remains represented by the binding plan. */
export function projectFromPortableCanvasV3(
  projectionInput: PortableCanvasProjectionV3,
  id: string,
  destinationBindings?: DestinationBindingDecision[],
  cwd?: string
): Project {
  const projection = validatePortableCanvasProjectionV3(projectionInput)
  const root = projection.canvases.find((canvas) => canvas.id === projection.rootCanvasId)!
  const nodes = projection.nodes.map((node): CanvasNodeState => ({
    id: node.id,
    kind: node.kind as CanvasNodeState['kind'],
    position: { ...node.position },
    size: { ...node.size },
    title: node.title,
    color: node.color,
    group: node.group,
    ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {}),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.tags ? { tags: [...node.tags] } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.url ? { url: node.url } : {}),
    ...(node.browserTabs ? { browserTabs: node.browserTabs.map((tab) => ({ ...tab })) } : {}),
    ...(node.serviceLabel ? { serviceLabel: node.serviceLabel } : {})
  }))
  const icon = iconFromProjection(projection.project.icon)
  const bridges = projection.relationships
    .filter((link) => link.kind === 'bridge')
    .map(({ id: linkId, source, target }) => ({ id: linkId, source, target }))
  const ropes = projection.relationships
    .filter((link) => link.kind === 'rope')
    .map(({ id: linkId, source, target }) => ({ id: linkId, source, target }))
  return {
    id,
    name: projection.project.name,
    color: projection.project.color,
    ...(icon ? { icon } : {}),
    viewport: root.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes,
    ...(bridges.length ? { bridges } : {}),
    ...(ropes.length ? { ropes } : {}),
    ...(destinationBindings?.length ? { destinationBindings } : {}),
    ...(cwd ? { cwd } : {})
  }
}

/** Apply wizard choices without executing them. A later guided feature owns each real action. */
export function applyDestinationBindingChoices(
  plan: DestinationBindingPlan,
  choices: Readonly<Record<string, DestinationBindingAction>>
): DestinationBindingDecision[] {
  return plan.requirements.map((requirement) => {
    const selectedAction = choices[requirement.id] ?? 'leave-unbound'
    if (!requirement.actions.includes(selectedAction)) {
      throw new Error(`Binding action ${selectedAction} is not available for ${requirement.nodeTitle}.`)
    }
    return {
      ...requirement,
      selectedAction,
      status: selectedAction === 'leave-unbound' ? 'unbound' : 'planned'
    }
  })
}
