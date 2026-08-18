import { useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { isServiceNodeKind, type ServiceNodeKind } from '@shared/types'
import { COLLAPSED_HEIGHT, SERVICE_NODE_LABELS, type CanvasNode } from '../state/workspace'
import { ColumnPill } from '../components/kanban/ColumnPill'
import { ColorMenu } from '../components/color/ColorMenu'

/**
 * One component for the whole service family — Minecraft, Docker, Proxmox, GitLab, Home Assistant
 * and FreePBX. They differ in what they will eventually manage, not in how they behave as canvas
 * objects, so six near-identical components would be six copies of one rule waiting to drift.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, and why the emptiness is the point:
 *
 * This node is not connected to anything yet. CLAUDE.md is explicit that a control which is styled
 * as operable while being inert is a defect rather than a placeholder — "any icon, preview, mock
 * window, toolbar control, card, tab, badge, illustration, affordance ... presented as if it can be
 * used must perform its labeled action". So there is no greyed-out Connect button here, no fake
 * status lamp, and no mock console: the surface says plainly what it is and what it cannot do yet,
 * and the ONE control it draws — the label field — genuinely works and genuinely persists.
 *
 * When a lane wires a real connection, it adds real controls beside this copy. Until then the honest
 * empty state is the feature, and it is much easier to add a working button later than to explain
 * why an existing one never did anything.
 */
export function ServiceNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, setNodes } = useReactFlow()
  /** Viewport anchor for the colour surface, or null when closed — coordinates rather than a
  *  boolean because ColorMenu is a body portal. */
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
  /** The title is a plain span until clicked, matching StickyNode and TerminalNode — a permanently
   *  live input covers the whole header strip and leaves nothing to grab the node by. */
  const [editingLabel, setEditingLabel] = useState(false)
  /** The value editing started with, so Escape can put it back. */
  const [labelBefore, setLabelBefore] = useState('')
  const collapsed = !!data.collapsed

  /**
   * A node whose `type` is not a service kind cannot reach this component in production — React Flow
   * routes by the same string. It is still narrowed rather than cast, because `type` survives a
   * hand-edited project.json, and the alternative is indexing a lookup table with an arbitrary
   * string. Falling back to a neutral name keeps a mangled record rendering instead of throwing.
   */
  const kind: ServiceNodeKind | null = isServiceNodeKind(type) ? type : null
  const productName = kind ? SERVICE_NODE_LABELS[kind] : data.title || 'Service'
  const label = data.serviceLabel ?? ''

  const toggleCollapse = () =>
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n
        const next = !n.data.collapsed
        const expandedHeight =
          (n.data.expandedHeight as number) ?? n.measured?.height ?? (n.height as number) ?? 400
        const height = next ? COLLAPSED_HEIGHT : expandedHeight
        return {
          ...n,
          height,
          style: { ...n.style, height },
          data: { ...n.data, collapsed: next, expandedHeight }
        }
      })
    )

  return (
    <>
      {/* Sibling of the root, which is overflow:hidden and would clip the half-pill. */}
      <ColumnPill nodeId={id} />
      <div
        className={`service-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''}`}
        style={{ borderColor: data.color }}
        role="group"
        aria-label={label ? `${productName}: ${label}` : `${productName}, no name set`}
      >
        <NodeResizer minWidth={320} minHeight={220} isVisible={selected && !collapsed} color={data.color} />

        <div className="service-node__header" style={{ background: `${data.color}33` }}>
          <button className="term-node__collapse" title={collapsed ? 'Expand' : 'Collapse'} onClick={toggleCollapse}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            className="term-node__color"
            style={{ background: data.color }}
            title="Color"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setColorAnchor((a) => (a ? null : { x: r.left, y: r.bottom }))
            }}
          />
          {colorAnchor && (
            <ColorMenu
              x={colorAnchor.x}
              y={colorAnchor.y}
              value={data.color}
              onPick={(c) => updateNodeData(id, { color: c })}
              onClose={() => setColorAnchor(null)}
            />
          )}

          <span className="service-node__product">{productName}</span>

          {editingLabel ? (
            <input
              className="term-node__title nodrag"
              value={label}
              spellCheck={false}
              autoFocus
              aria-label={`Name for this ${productName}`}
              onChange={(e) => updateNodeData(id, { serviceLabel: e.target.value })}
              // Every exit commits what is on screen — the edits are live, so there is nothing to
              // save — except Escape, which puts back the value editing started with.
              onBlur={() => setEditingLabel(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  setEditingLabel(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  updateNodeData(id, { serviceLabel: labelBefore })
                  setEditingLabel(false)
                }
              }}
            />
          ) : (
            <button
              className="service-node__label-text nodrag"
              title="Rename"
              onClick={() => {
                setLabelBefore(label)
                setEditingLabel(true)
              }}
            >
              {label || <span className="service-node__label-empty">Name this {productName.toLowerCase()}…</span>}
            </button>
          )}
        </div>

        {!collapsed && (
          <div className="service-node__body">
            <p className="service-node__state">Not connected.</p>
            <p className="service-node__hint">
              This node can be named, moved, coloured and grouped like any other, and its name is
              saved with the canvas. Connecting it to a real {productName} is not built yet — so
              there is deliberately nothing here that looks like it would work.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
