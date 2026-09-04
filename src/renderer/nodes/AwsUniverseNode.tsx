import { useMemo, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  awsOnlyCatalog,
  enterAwsUniverse,
  leaveAwsUniverse,
  type AwsUniverseCatalogEntry,
  type AwsUniverseMachineContext,
  type AwsUniverseNavigation
} from '../../core/aws-universe-portal'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { type CanvasNode, COLLAPSED_HEIGHT } from '../state/workspace'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { ColumnPill } from '../components/kanban/ColumnPill'
import { ColorMenu } from '../components/color/ColorMenu'
import { alphaTint } from '../components/color/tint'
import { nodeBorderStyle } from '../lib/nodeColor'
import { Button, IconButton } from '../ui/md3'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'

const CONTEXTS_KEY = 'nodeterm.aws-universe.local-contexts'

const AWS_INTERFACE_CATALOG: AwsUniverseCatalogEntry[] = [
  { id: 'aws-universe', label: 'AWS Universe canvas', category: 'aws-universe', available: true },
  { id: 'aws-shop', label: 'AWS Shop', category: 'aws-shop', available: false, disabledReason: 'AWS Shop is a later lane. This portal only exposes its typed interface.' },
  { id: 'aws-service', label: 'AWS service manager', category: 'aws-service', available: false, disabledReason: 'AWS service managers are not implemented in this portal lane.' },
  { id: 'aws-operation', label: 'AWS operation wizard', category: 'aws-operation', available: false, disabledReason: 'AWS operation wizards are not implemented in this portal lane.' }
]

function readLocalContexts(universeId: string): AwsUniverseMachineContext[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONTEXTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is AwsUniverseMachineContext => {
      if (!value || typeof value !== 'object') return false
      const item = value as Record<string, unknown>
      return item.universeId === universeId && item.contextVersion === 1
    })
  } catch {
    return []
  }
}

function storedContext(universeId: string): AwsUniverseMachineContext | undefined {
  return readLocalContexts(universeId)[0]
}

export function AwsUniverseNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, setNodes } = useReactFlow()
  // `NodeData`'s blanket index signature types every undeclared field as `unknown`, which
  // makes `unknown ?? string` widen to `{}` — cast at the read site rather than depending on
  // workspace.ts declaring these AWS-universe fields explicitly.
  const universeId = ((data as Record<string, unknown>).awsUniverseId as string | undefined) ?? id
  const entryDoorId = ((data as Record<string, unknown>).awsUniverseEntryDoorId as string | undefined) ?? `${universeId}:door-pair:entry`
  const returnDoorId = ((data as Record<string, unknown>).awsUniverseReturnDoorId as string | undefined) ?? `${universeId}:door-pair:return`
  const [entered, setEntered] = useState<AwsUniverseNavigation | null>(null)
  const [context, setContext] = useState<AwsUniverseMachineContext | undefined>(() => storedContext(universeId))
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
  const field = useRegexSearchField()
  const collapsed = !!data.collapsed
  const border = nodeBorderStyle(data.color)
  const catalog = useMemo(() => {
    const query = field.value.trim().toLocaleLowerCase()
    return awsOnlyCatalog(AWS_INTERFACE_CATALOG).filter((entry) => {
      if (!query) return true
      return field.mode === 'regex'
        ? field.test(`${entry.label} ${entry.category} ${entry.id}`)
        : `${entry.label} ${entry.category}`.toLocaleLowerCase().includes(query)
    })
  }, [field.value, field.mode, field.pattern, field.flags, field.test])
  const toggleCollapse = () => setNodes((nodes) => nodes.map((node) => {
    if (node.id !== id) return node
    const next = !node.data.collapsed
    const expandedHeight = (node.data.expandedHeight as number | undefined) ?? node.measured?.height ?? node.height ?? 560
    const height = next ? COLLAPSED_HEIGHT : expandedHeight
    return { ...node, height, style: { ...node.style, height }, data: { ...node.data, collapsed: next, expandedHeight } }
  }))
  const openThroughDoor = () => {
    if (entered) return
    const navigation = enterAwsUniverse({
      universeId,
      displayName: data.title || 'AWS Universe',
      serviceIntent: [],
      entryDoor: { id: entryDoorId, pairId: `${universeId}:door-pair`, universeId, side: 'entry' },
      returnDoor: { id: returnDoorId, pairId: `${universeId}:door-pair`, universeId, side: 'return' },
      scope: 'aws-only',
      schemaVersion: 1
    }, entryDoorId)
    setEntered(navigation)
  }
  const closeThroughDoor = () => {
    if (!entered) return
    const ok = leaveAwsUniverse({
      universeId,
      displayName: data.title || 'AWS Universe',
      serviceIntent: [],
      entryDoor: { id: entryDoorId, pairId: `${universeId}:door-pair`, universeId, side: 'entry' },
      returnDoor: { id: returnDoorId, pairId: `${universeId}:door-pair`, universeId, side: 'return' },
      scope: 'aws-only',
      schemaVersion: 1
    }, entered, returnDoorId)
    if (ok) setEntered(null)
  }
  const chooseContext = (value: string) => {
    const next = readLocalContexts(universeId).find((candidate) => candidate.profileRef === value)
    setContext(next)
  }

  return (
    <>
      <ColumnPill nodeId={id} />
      <section className={`aws-universe-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''}`} style={border.style} aria-label={`${data.title || 'AWS Universe'}, AWS-only canvas`}>
        <NodeResizer minWidth={420} minHeight={320} isVisible={selected && !collapsed} color={data.color} />
        <header className="aws-universe-node__header" style={{ background: alphaTint(data.color, 0.2) }}>
          <IconButton size="compact" className="term-node__collapse nodrag" icon={collapsed ? 'chevron_right' : 'arrow_drop_down'} title={collapsed ? 'Expand AWS Universe' : 'Collapse AWS Universe'} aria-label={collapsed ? 'Expand AWS Universe' : 'Collapse AWS Universe'} onClick={toggleCollapse} />
          <IconButton size="compact" className="term-node__color nodrag" style={{ background: data.color }} title="Choose portal color" aria-label="Choose portal color" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setColorAnchor((current) => current ? null : { x: rect.left, y: rect.bottom + 4 }) }} />
          {colorAnchor ? <ColorMenu x={colorAnchor.x} y={colorAnchor.y} value={data.color} onPick={(color) => updateNodeData(id, { color })} onClose={() => setColorAnchor(null)} /> : null}
          <EditableNodeTitle value={data.title || 'AWS Universe'} onChange={(title) => updateNodeData(id, { title })} ariaLabel="AWS Universe name" title="Rename AWS Universe" rejectEmpty={false} />
          <span className="term-node__spacer" />
          <span className="aws-universe-node__scope">AWS only</span>
        </header>
        {!collapsed ? (
          entered ? (
            <div className="aws-universe-node__body aws-universe-node__body--entered">
              <div className="aws-universe-node__doorbar"><span>Entered through matching door</span><Button variant="outlined" size="small" className="nodrag" onClick={closeThroughDoor}>Return through matching door</Button></div>
              <p className="aws-universe-node__notice">This canvas is scoped to AWS. Regular tab navigation cannot enter or bypass this door.</p>
              <div className="aws-universe-node__search-row">
                <label htmlFor={`${id}-catalog-search`}>Search AWS catalog</label>
                <div className="aws-universe-node__search-control">
                  <Input id={`${id}-catalog-search`} className="nodrag" value={field.value} placeholder="Search AWS interfaces" onChange={(event) => field.setValue(event.target.value)} />
                  <AnchoredRegexBuilder search={field} label="Open regex builder for AWS catalog search" />
                </div>
              </div>
              <p className="aws-universe-node__result-count" aria-live="polite">{catalog.length} AWS catalog entries</p>
              <ul className="aws-universe-node__catalog" aria-label="AWS catalog">
                {catalog.map((entry) => <li key={entry.id}><span><strong>{entry.label}</strong><small>{entry.category}</small></span>{entry.available ? <span className="aws-universe-node__available">Available</span> : <span className="aws-universe-node__disabled" title={entry.disabledReason}>{entry.disabledReason}</span>}</li>)}
              </ul>
            </div>
          ) : (
            <div className="aws-universe-node__body">
              <p className="aws-universe-node__eyebrow">Portable AWS Universe portal</p>
              <p>One project can hold any number of independent AWS Universe portals. Each portal has its own matching entry and return doors.</p>
              <Button variant="filled" className="aws-universe-node__enter nodrag" onClick={openThroughDoor}>Enter through matching door</Button>
              <p className="aws-universe-node__notice">No AWS request, deployment, download, or process launch happens when you enter or import. AWS Shop and service operations are interfaces only in this lane.</p>
              <label className="aws-universe-node__context-label" htmlFor={`${id}-context`}>Machine-local AWS context</label>
              <Select id={`${id}-context`} className="nodrag" value={context?.profileRef ?? ''} onChange={(event) => chooseContext(event.target.value)}>
                <option value="">Leave unbound</option>
                {readLocalContexts(universeId).map((item) => <option key={item.profileRef ?? item.accountRef ?? 'local'} value={item.profileRef ?? ''}>{item.profileRef ?? item.accountRef ?? 'Configured local context'}</option>)}
              </Select>
              <small className="aws-universe-node__context-note">Context choices are read from this computer only. Credentials, paths, sessions, and host identifiers never enter the portable project.</small>
            </div>
          )
        ) : null}
      </section>
    </>
  )
}
