import { useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { NODE_COLORS, type CanvasNode } from '../state/workspace'
import { annotationEndpoints, clampAnnotationThickness, type AnnotationDiagonal, type AnnotationVariant } from '../lib/annotation'
import { ColorMenu } from '../components/color/ColorMenu'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import {
  ANNOTATION_DEFAULT_THICKNESS,
  ANNOTATION_MAX_THICKNESS,
  ANNOTATION_MAX_LABEL_LENGTH,
  ANNOTATION_MIN_THICKNESS,
  normalizeAnnotationLabel,
  normalizeAnnotationThickness
} from '@shared/annotation'
import { IconButton, Slider } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

/** Arrowhead size in the node's own local px space (see AnnotationNode). */
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
  const vocab = useVocabularyMapper()
  const { updateNodeData, deleteElements } = useReactFlow()
  /** Viewport anchor for the colour surface, or null when closed — coordinates rather than a
   *  boolean because ColorMenu is a body portal. */
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
  const variant: AnnotationVariant = data.annotationVariant === 'arrow' ? 'arrow' : 'line'
  const dir: AnnotationDiagonal = data.annotationDir === 'tr-bl' ? 'tr-bl' : 'tl-br'
  const w = width ?? FALLBACK_SIZE.width
  const h = height ?? FALLBACK_SIZE.height
  const { from, to } = annotationEndpoints({ width: w, height: h }, dir)
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const color = (data.color as string) || NODE_COLORS[0]
  const label = normalizeAnnotationLabel(data.annotationLabel)
  const thickness = normalizeAnnotationThickness(data.annotationThickness ?? ANNOTATION_DEFAULT_THICKNESS)
  const markerId = `annotation-arrowhead-${id}`

  return (
    <div
      className={`annotation-node${selected ? ' selected' : ''}`}
      data-appearance-id={appearanceId('node', id)}
      role="img"
      aria-label={`${variant === 'arrow' ? 'Arrow' : 'Line'} annotation${label ? `: ${label}` : ''}`}
    >
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
          strokeWidth={thickness}
          strokeLinecap="round"
          markerEnd={variant === 'arrow' ? `url(#${markerId})` : undefined}
        />
      </svg>

      {label && (
        <div className="annotation-node__label nodrag" title={label}>
          {label}
        </div>
      )}

      {/* A small floating toolbar at the line's midpoint — same idea as GroupNode's label pill.
          It exposes the annotation's colour, optional label, stroke width, variant, and delete
          actions while remaining hidden until hover or selection. */}
      <div
        className="annotation-node__toolbar nodrag"
        style={{ left: midX, top: midY }}
      >
        <IconButton
          size="compact"
          className="annotation-node__dot"
          aria-label="Color"
          title="Color"
          aria-label="Choose annotation color"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setColorAnchor((a) => (a ? null : { x: r.left, y: r.bottom }))
          }}
        >
          <span className="mdx-icon-btn__swatch" style={{ background: color }} />
        </IconButton>
        {colorAnchor && (
          <ColorMenu
            x={colorAnchor.x}
            y={colorAnchor.y}
            value={data.color}
            onPick={(c: string) => updateNodeData(id, { color: c })}
            onClose={() => setColorAnchor(null)}
          />
        )}
        <Input
          className="annotation-node__label-input"
          type="text"
          value={(data.annotationLabel as string) ?? ''}
          maxLength={ANNOTATION_MAX_LABEL_LENGTH}
          placeholder={vocab('Label (optional)')}
          aria-label={vocab('Annotation label')}
          title={vocab('Optional annotation label')}
          onChange={(e) => updateNodeData(id, { annotationLabel: e.currentTarget.value })}
          onBlur={(e) => updateNodeData(id, { annotationLabel: normalizeAnnotationLabel(e.currentTarget.value) })}
        />
        <label className="annotation-node__thickness-control">
          <span className="sr-only">{vocab('Line thickness')}</span>
          <Slider
            min={ANNOTATION_MIN_THICKNESS}
            max={ANNOTATION_MAX_THICKNESS}
            step={1}
            value={thickness}
            aria-label={vocab('Line thickness')}
            title={vocab('Line thickness')}
            onChange={(e) => updateNodeData(id, { annotationThickness: normalizeAnnotationThickness(Number(e.currentTarget.value)) })}
          />
          <output aria-label={vocab('Line thickness value')}>{thickness}</output>
        </label>
        <IconButton
          size="compact"
          className="annotation-node__variant"
          aria-label={variant === 'arrow' ? 'Arrowhead on — click for a plain line' : 'Plain line — click to add an arrowhead'}
          title={variant === 'arrow' ? 'Arrowhead on — click for a plain line' : 'Plain line — click to add an arrowhead'}
          aria-label={variant === 'arrow' ? 'Change to line' : 'Change to arrow'}
          onClick={() =>
            updateNodeData(id, { annotationVariant: variant === 'arrow' ? 'line' : 'arrow' })
          }
        >
          {variant === 'arrow' ? '→' : '—'}
        </IconButton>
        <IconButton
          size="compact"
          className="annotation-node__close"
          icon="delete"
          aria-label="Delete"
          title="Delete"
          aria-label="Delete annotation"
          onClick={() => deleteElements({ nodes: [{ id }] })}
        />
      </div>
    </div>
  )
}
