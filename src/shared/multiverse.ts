/**
 * Shared, portable state for Multiverse child canvases.
 *
 * A child canvas is content inside a project, not another project tab.  The root canvas is always
 * identified by `rootCanvasId`; every child points at its parent canvas and carries its own content
 * and viewport.  Machine-local execution, credentials, host identifiers, and process state do not
 * belong in this shape.
 */

import type { BridgeLink, CanvasNodeState, Viewport } from './types'

export const MULTIVERSE_ROOT_CANVAS_ID = 'root' as const
export const MULTIVERSE_MAX_DEPTH = 8 as const

export interface MultiverseChildCanvas {
  id: string
  rootCanvasId: typeof MULTIVERSE_ROOT_CANVAS_ID
  parentCanvasId: string
  title: string
  order: number
  depth: number
  viewport: Viewport
  nodes: CanvasNodeState[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}

export interface MultiverseState {
  rootCanvasId: typeof MULTIVERSE_ROOT_CANVAS_ID
  children: MultiverseChildCanvas[]
  activeCanvasId?: string
}

/** The portable part of one child canvas. `nodes` are validated and stripped by the core seam. */
export interface PortableMultiverseChildCanvas {
  id: string
  rootCanvasId: typeof MULTIVERSE_ROOT_CANVAS_ID
  parentCanvasId: string
  title: string
  order: number
  depth: number
  viewport: Viewport
  nodes: CanvasNodeState[]
  bridges?: BridgeLink[]
  ropes?: BridgeLink[]
}

export const EMPTY_MULTIVERSE_STATE: MultiverseState = {
  rootCanvasId: MULTIVERSE_ROOT_CANVAS_ID,
  children: []
}
