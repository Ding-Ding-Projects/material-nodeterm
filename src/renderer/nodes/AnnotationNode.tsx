import { useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { NODE_COLORS, type CanvasNode } from '../state/workspace'
import { annotationEndpoints, type AnnotationDiagonal, type AnnotationVariant } from '../lib/annotation'

/** Line thickness and arrowhead size, both in the node's own local px space (see AnnotationNode). */
const STROKE_WIDTH = 3
const ARROW_MARKER_PX = 9
/** Fallback box when React Flow has not yet reported a measured/explicit size (never hit for a
 *  node this factory always creates with an explicit width/height — defensive only). */
const FALLBACK_SIZE = { width: 240, height: 160 }

/**
 * A standalone line/arrow annotation (issue #145): pure decoration, drawn by the canvas's
 * "Draw line" / "Draw arrow" tool (see useAnnotationDrawTool.ts) and colored from the same
 * palette every other node uses.
 *
 * CRITICAL SEPARATION FROM CONTEXT LINKS: this is a React Flow NODE, not an Edge. A context link
 * (bridge), a "spawned by" rope, and a canvas-control dependency edge are all `BridgeLink`s — they
 * carry a `source` node id and a `target` node id and are drawn through React Flow's edge layer
 * (`<ReactFlow edges={...}>`), which is what lets an agent's session actually READ across one. An
 * annotation has neither field: it renders entirely inside its own node box, has no connect
 * `Handle`s (unlike StickyNode's link-in/link-out handles), never appears in the `edges` array, and
 * cannot be dragged from one node to another the way a link is drawn — there is nothing on this
 * node a link gesture could even attach to. Visually it is also deliberately unlike every edge
 * style in the app: edges are colored per their OWN role (grey "waits for" dependency arrows,
 * orange Loop-delivery arrows) and curve between two node centers; an annotation is a straight
 * user-colored mark confined to a small draggable/resizable box with its own selection chrome, the
 * same interaction language as a sticky note or a group frame, not a connection.
 */
export function AnnotationNode({ id, data, selected, width, height }: NodeProps<CanvasNode>) {
  const { updateNodeData, deleteElements } = useReactFlow()
  const [showColors, setShowColors] = useState(false)
  const variant: AnnotationVariant = data.annotationVariant === 'arrow' ? 'arrow' : 'line'
  const dir: AnnotationDiagonal = data.annotationDir === 'tr-bl' ? 'tr-bl' : 'tl-br'
  const w = width ?? FALLBACK_SIZE.width
  const h = height ?? FALLBACK_SIZE.height
  const { from, to } = annotationEndpoints({ width: w, height: h }, dir)
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const color = (data.color as string) || NODE_COLORS[0]
  const markerId = `annotation-arrowhead-${id}`

  return (
    <div className={`annotation-node${selected ? ' selected' : ''}`}>
      <NodeResizer
        minWidth={24}
        minHeight={24}
        isVisible={selected}
        color={color}
        lineStyle={{ borderColor: 'transparent' }}
      />
      {/* viewBox is 1:1 with the rendered px size — no preserveAspectRatio skew to worry about,
          so the stroke stays the same visual thickness on a wide OR a tall box. */}
      <svg className="annotation-node__svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {variant === 'arrow' && (
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth={ARROW_MARKER_PX}
            markerHeight={ARROW_MARKER_PX}
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        )}
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          markerEnd={variant === 'arrow' ? `url(#${markerId})` : undefined}
        />
      </svg>

      {/* A small floating toolbar at the line's midpoint — same idea as GroupNode's label pill,
          scaled down since an annotation carries no name. Shown on hover/selected only (CSS). */}
      <div
        className="annotation-node__toolbar nodrag"
        style={{ left: midX, top: midY }}
      >
        <button
          className="annotation-node__dot"
          style={{ background: color }}
          title="Color"
          onClick={() => setShowColors((v) => !v)}
        />
        {showColors && (
          <div className="color-popover">
            {NODE_COLORS.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                onClick={() => {
                  updateNodeData(id, { color: c })
                  setShowColors(false)
                }}
              />
            ))}
          </div>
        )}
        <button
          className="annotation-node__variant"
          title={variant === 'arrow' ? 'Arrowhead on — click for a plain line' : 'Plain line — click to add an arrowhead'}
          onClick={() =>
            updateNodeData(id, { annotationVariant: variant === 'arrow' ? 'line' : 'arrow' })
          }
        >
          {variant === 'arrow' ? '→' : '—'}
        </button>
        <button
          className="annotation-node__close"
          title="Delete"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        >
          ×
        </button>
      </div>
    </div>
  )
}
