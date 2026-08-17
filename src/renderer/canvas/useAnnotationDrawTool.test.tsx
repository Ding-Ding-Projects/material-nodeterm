// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useRef } from 'react'
import type { CanvasNode } from '../state/workspace'
import { useAnnotationDrawTool, type DrawTool } from './useAnnotationDrawTool'

// Standalone react-dom harness, no testing-library — same shape as useDiscardWhenHidden.test.tsx.
// screenToFlowPosition is the identity function throughout: screen px === flow px, so assertions
// can read the created node's position/size directly off the dispatched client coordinates.

let hookOut: ReturnType<typeof useAnnotationDrawTool> | null = null
let wrapEl: HTMLDivElement | null = null

function Harness(props: {
  setNodes: (updater: (nodes: CanvasNode[]) => CanvasNode[]) => void
  markDirty: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  hookOut = useAnnotationDrawTool({
    flowWrapRef: ref,
    screenToFlowPosition: (p) => p,
    setNodes: props.setNodes,
    markDirty: props.markDirty
  })
  return (
    <div
      ref={(el) => {
        ref.current = el
        wrapEl = el
      }}
    />
  )
}

function mount(props: Parameters<typeof Harness>[0]): Root {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<Harness {...props} />)
  })
  return root
}

function down(x: number, y: number): void {
  act(() => {
    wrapEl!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    )
  })
}
function move(x: number, y: number): void {
  act(() => {
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y })
    )
  })
}
function up(x: number, y: number): void {
  act(() => {
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    )
  })
}
function escape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
  })
}
function arm(tool: DrawTool): void {
  act(() => hookOut!.startTool(tool))
}

describe('useAnnotationDrawTool', () => {
  let root: Root | null = null
  let setNodes: ReturnType<typeof vi.fn<(updater: (ns: CanvasNode[]) => CanvasNode[]) => void>>
  let markDirty: ReturnType<typeof vi.fn<() => void>>
  let nodes: CanvasNode[]

  beforeEach(() => {
    nodes = []
    setNodes = vi.fn<(updater: (ns: CanvasNode[]) => CanvasNode[]) => void>((updater) => {
      nodes = updater(nodes)
    })
    markDirty = vi.fn<() => void>()
    root = mount({ setNodes, markDirty })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    hookOut = null
    wrapEl = null
  })

  it('starts with no tool armed', () => {
    expect(hookOut!.tool).toBeNull()
    expect(hookOut!.preview).toBeNull()
  })

  it('arms a tool, and arming the SAME tool again disarms it (toggle)', () => {
    arm('line')
    expect(hookOut!.tool).toBe('line')
    arm('line')
    expect(hookOut!.tool).toBeNull()
  })

  it('switches tools rather than stacking them', () => {
    arm('line')
    arm('arrow')
    expect(hookOut!.tool).toBe('arrow')
  })

  it('drags out a colored area and creates an empty group frame', () => {
    arm('area')
    down(100, 100)
    move(260, 220)
    up(260, 220)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('group')
    expect(nodes[0].position).toEqual({ x: 100, y: 100 })
    expect(nodes[0].width).toBe(160)
    expect(nodes[0].height).toBe(120)
    expect(markDirty).toHaveBeenCalledTimes(1)
    // One shape per arm: the tool is consumed on completion.
    expect(hookOut!.tool).toBeNull()
  })

  it('drags out a line and creates a standalone annotation node with no arrowhead', () => {
    arm('line')
    down(0, 0)
    move(100, 80)
    up(100, 80)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('annotation')
    expect(nodes[0].data.annotationVariant).toBe('line')
    expect(nodes[0].data.annotationDir).toBe('tl-br')
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(nodes[0].width).toBe(100)
    expect(nodes[0].height).toBe(80)
  })

  it('drags out an arrow and creates an annotation node with an arrowhead', () => {
    arm('arrow')
    down(100, 0)
    move(0, 80)
    up(0, 80)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('annotation')
    expect(nodes[0].data.annotationVariant).toBe('arrow')
    expect(nodes[0].data.annotationDir).toBe('tr-bl')
  })

  it('cancels a drag below the minimum threshold — no node, tool consumed', () => {
    arm('line')
    down(10, 10)
    move(12, 11)
    up(12, 11)

    expect(nodes).toHaveLength(0)
    expect(markDirty).not.toHaveBeenCalled()
    expect(hookOut!.tool).toBeNull()
  })

  it('Escape cancels an in-progress drag — no node, tool disarmed', () => {
    arm('line')
    down(10, 10)
    move(200, 180)
    escape()

    expect(hookOut!.tool).toBeNull()
    expect(hookOut!.preview).toBeNull()

    // A mouseup that arrives after the cancel must not resurrect the drag.
    up(200, 180)
    expect(nodes).toHaveLength(0)
    expect(setNodes).not.toHaveBeenCalled()
  })

  it('reports a live preview rectangle while dragging, and clears it on mouseup', () => {
    arm('area')
    down(50, 50)
    expect(hookOut!.preview).toEqual({ tool: 'area', x: 50, y: 50, width: 0, height: 0, dir: 'tl-br' })
    move(150, 90)
    expect(hookOut!.preview).toEqual({ tool: 'area', x: 50, y: 50, width: 100, height: 40, dir: 'tl-br' })
    up(150, 90)
    expect(hookOut!.preview).toBeNull()
  })

  it('does nothing on mousedown/mousemove/mouseup while no tool is armed', () => {
    down(10, 10)
    move(200, 200)
    up(200, 200)
    expect(nodes).toHaveLength(0)
    expect(hookOut!.preview).toBeNull()
  })

  it('ignores a non-primary-button mousedown (right-click) — the context menu still opens', () => {
    arm('line')
    act(() => {
      wrapEl!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 })
      )
    })
    expect(hookOut!.preview).toBeNull()
    // The tool stays armed — a stray right-click is not a draw gesture and not a cancel either.
    expect(hookOut!.tool).toBe('line')
  })
})
