import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  annotationDiagonalFromPoints,
  annotationRectFromPoints,
  type AnnotationDiagonal,
  type FlowPoint
} from '../lib/annotation'
import { createAnnotationNode, createGroupNode, type CanvasNode } from '../state/workspace'

/** 'area' stamps an empty group frame; 'line'/'arrow' stamp a standalone annotation node. */
export type DrawTool = 'area' | 'line' | 'arrow'

/** Live drag rectangle for the overlay, in SCREEN px (the overlay is `position: fixed`, so no
 *  pan/zoom transform is needed — it exists only for the duration of one drag). */
export interface DrawPreview {
  tool: DrawTool
  x: number
  y: number
  width: number
  height: number
  /** Which diagonal the line/arrow tools are currently tracing; ignored for 'area'. */
  dir: AnnotationDiagonal
}

export interface UseAnnotationDrawToolArgs {
  flowWrapRef: RefObject<HTMLDivElement>
  screenToFlowPosition: (p: { x: number; y: number }) => FlowPoint
  setNodes: (updater: (nodes: CanvasNode[]) => CanvasNode[]) => void
  markDirty: () => void
}

export interface UseAnnotationDrawToolResult {
  /** The armed tool, or null when the canvas is in its ordinary interaction mode. */
  tool: DrawTool | null
  /** Arm `tool` for the next drag on the canvas; calling it again with the SAME tool disarms it —
   *  a toggle, matching the app's other one-shot mode switches (e.g. the bottom-left canvas lock).
   *  Tools are exclusive: requesting a different one switches rather than stacking. */
  startTool: (tool: DrawTool) => void
  /** Live drag rectangle for the preview overlay, or null while not dragging. */
  preview: DrawPreview | null
}

/**
 * Drag-to-draw for the canvas's two annotation tools (issue #145).
 *
 * "Draw colored area" stamps an empty, resizable group frame (`createGroupNode`) at the drag
 * rect — the same coloured-area frame `groupSelectedNodes` already builds around a selection, just
 * placed directly on empty canvas instead of requiring one first. "Draw line"/"Draw arrow" stamp a
 * standalone `annotation` node (`createAnnotationNode`) — pure decoration with no relationship to
 * any other node; see the NodeKind doc comment in @shared/types and AnnotationNode.tsx for why that
 * keeps it structurally impossible to confuse with a context link. Both tools share ONE geometry
 * function (`annotationRectFromPoints`), so a too-small drag (a stray click) cancels identically
 * for every tool rather than stamping a degenerate zero-size node.
 *
 * React Flow exposes no `onPaneMouseDown`/`onPaneMouseUp` (only `onPaneClick`/`onPaneMouseMove`/
 * `onPaneContextMenu`), so this attaches plain DOM listeners directly — CAPTURE phase, and ONLY
 * while a tool is armed, so the app's ordinary box-select/pan/node-drag behaviour is completely
 * untouched when no tool is active (the effect below removes every listener the instant `tool`
 * goes back to null). Capturing on `flowWrapRef` (an ANCESTOR of React Flow's own pane) and calling
 * `stopPropagation()` is what stops React Flow's internal handlers from ever seeing the same
 * mousedown/mousemove/mouseup while a tool is drawing.
 */
export function useAnnotationDrawTool({
  flowWrapRef,
  screenToFlowPosition,
  setNodes,
  markDirty
}: UseAnnotationDrawToolArgs): UseAnnotationDrawToolResult {
  const [tool, setTool] = useState<DrawTool | null>(null)
  const [preview, setPreview] = useState<DrawPreview | null>(null)
  // Imperative drag anchor (screen px). A ref rather than state: it must be authoritative the
  // instant a mousedown handler returns (the very next mousemove reads it), and nothing outside
  // this effect ever needs it as reactive state.
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const startTool = useCallback((next: DrawTool) => {
    setTool((current) => (current === next ? null : next))
    startRef.current = null
    setPreview(null)
  }, [])

  useEffect(() => {
    if (!tool) return
    const wrap = flowWrapRef.current
    if (!wrap) return

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return // only the primary button starts a draw drag
      e.preventDefault()
      e.stopPropagation()
      startRef.current = { x: e.clientX, y: e.clientY }
      setPreview({ tool, x: e.clientX, y: e.clientY, width: 0, height: 0, dir: 'tl-br' })
    }
    const onMouseMove = (e: MouseEvent): void => {
      const start = startRef.current
      if (!start) return
      e.preventDefault()
      e.stopPropagation()
      const at = { x: e.clientX, y: e.clientY }
      setPreview({
        tool,
        x: Math.min(start.x, at.x),
        y: Math.min(start.y, at.y),
        width: Math.abs(at.x - start.x),
        height: Math.abs(at.y - start.y),
        dir: annotationDiagonalFromPoints(start, at)
      })
    }
    const onMouseUp = (e: MouseEvent): void => {
      const start = startRef.current
      startRef.current = null
      setPreview(null)
      // One shape per arm, then back to the app's ordinary interaction mode — matches every other
      // one-shot canvas action (a menu command runs once; it does not stay "loaded").
      setTool(null)
      if (!start) return
      e.preventDefault()
      e.stopPropagation()
      const from = screenToFlowPosition(start)
      const to = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const rect = annotationRectFromPoints(from, to)
      if (!rect) return // a stray click below the minimum drag — nothing is stamped
      setNodes((ns) => {
        const node: CanvasNode =
          tool === 'area'
            ? createGroupNode(rect.position, rect.size, ns.length)
            : createAnnotationNode(rect, tool, ns.length)
        return [...ns, node]
      })
      markDirty()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      startRef.current = null
      setPreview(null)
      setTool(null)
    }

    wrap.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      wrap.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [tool, flowWrapRef, screenToFlowPosition, setNodes, markDirty])

  return { tool, startTool, preview }
}
