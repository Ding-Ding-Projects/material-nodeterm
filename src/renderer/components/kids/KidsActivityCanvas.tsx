import { useEffect, useRef, useState } from 'react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow } from '@xyflow/react'

import { withNodeBoundary } from '@renderer/components/NodeBoundary'
import { TerminalNode } from '@renderer/nodes/TerminalNode'
import { StickyNode } from '@renderer/nodes/StickyNode'
import { createAgentNode, createStickyNode, createTerminalNode, type CanvasNode } from '@renderer/state/workspace'
import { ensureActiveAgentLaunchPlan } from '@renderer/state/permissionMode'
import { useKidsActivity, stickerThresholdMs } from '@renderer/state/kidsActivity'
import { IconBackArrow, IconBeep, IconBrush } from './icons'
import type { KidsTileKind } from './KidsHome'
import { IconTerminal } from '@renderer/components/icons'
import { narrateKidsScreen } from './narration'
import { Button, IconButton, Tablist } from '@renderer/ui/md3'

/** Fixed node ids: the whole point is that "Type things" always reattaches the SAME tmux/session
 *  host session (see PtyManager) — a fresh random id every visit would cold-start a new shell
 *  each time a kid opened the tile. */
const NODE_ID: Record<KidsTileKind, string> = {
  beep: 'kids-beep-node',
  terminal: 'kids-terminal-node',
  draw: 'kids-draw-node'
}
const NODE_X: Record<KidsTileKind, number> = { beep: 0, terminal: 900, draw: 1800 }
const TILE_TITLE: Record<KidsTileKind, string> = { beep: 'Talk to Beep', terminal: 'Type things', draw: 'Draw' }
const TILE_LOG: Record<KidsTileKind, { what: string; detail: string }> = {
  beep: { what: 'Talked to Beep', detail: 'Opened a chat with Beep' },
  terminal: { what: 'Typed things', detail: 'Opened the terminal' },
  draw: { what: 'Drew a picture', detail: 'Opened the drawing note' }
}

const nodeTypes = {
  terminal: withNodeBoundary(TerminalNode),
  sticky: withNodeBoundary(StickyNode)
}

/**
 * The kid-scoped canvas — a real, independent `<ReactFlow>` instance (its own provider, never the
 * developer canvas in `canvas/Canvas.tsx`) that hosts up to three genuine nodes: an agent node for
 * "Talk to Beep", a plain terminal node for "Type things", and a sticky note for "Draw". Every
 * node is the SAME component the developer canvas renders (`TerminalNode`/`StickyNode`, imported
 * unmodified) — real PTYs, real tmux/session-host persistence, real Claude launches. There is no
 * separate "kid-safe" terminal implementation, because the terminal genuinely is the product (see
 * KIDS_DISCLOSURE) — kids mode's job is limiting what starts it and what it can do unsupervised,
 * never faking what it is.
 *
 * "Draw" uses a `StickyNode` rather than the canvas's line/arrow `AnnotationNode`: an annotation
 * is created by dragging a rectangle on the developer canvas's own pane (`Canvas.tsx`'s pointer
 * lifecycle), and reproducing that gesture here would be real, separate engineering for a feature
 * this app does not actually have (freehand drawing/painting) — a sticky note a kid can write and
 * colour on is the honest, working stand-in the brief allows for ("AnnotationNode / StickyNode").
 *
 * Nodes are created lazily and kept for as long as this component stays mounted (i.e. for the
 * whole "away from Home" session): switching between the three via the header's quick-switch
 * strip re-centers on an already-open node instead of rebuilding it, so the underlying PTY/session
 * is never disturbed by hopping between activities.
 */
function KidsActivityCanvasInner({
  initial,
  onBack
}: {
  initial: KidsTileKind
  onBack: () => void
}): React.JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
  const instance = useReactFlow()
  const [active, setActiveState] = useState<KidsTileKind>(initial)
  const opened = useRef<Set<KidsTileKind>>(new Set())
  const visited = useRef<Set<KidsTileKind>>(new Set())
  const sessionStart = useRef<number>(Date.now())
  const logActivity = useKidsActivity((s) => s.logActivity)
  const addSticker = useKidsActivity((s) => s.addSticker)

  const centerOn = (n: CanvasNode) => {
    void instance.setCenter(n.position.x + (n.width ?? 640) / 2, n.position.y + (n.height ?? 440) / 2, {
      zoom: 0.85,
      duration: 350
    })
  }

  useEffect(() => {
    visited.current.add(active)
    logActivity(active, TILE_LOG[active].what, TILE_LOG[active].detail)
    narrateKidsScreen(`${TILE_TITLE[active]}.`)

    if (opened.current.has(active)) {
      const existing = nodes.find((n) => n.id === NODE_ID[active])
      if (existing) centerOn(existing)
      return
    }
    opened.current.add(active)
    let cancelled = false
    const id = NODE_ID[active]
    const place = { x: NODE_X[active], y: 0 }

    const add = (node: CanvasNode) => {
      if (cancelled) return
      setNodes((ns) => (ns.some((n) => n.id === node.id) ? ns : [...ns, node]))
      window.setTimeout(() => centerOn(node), 30)
    }

    if (active === 'beep') {
      // Async: the branded launch plan awaits the Claude CLI capability probe so the `auto`/kids
      // gates resolve correctly even on a cold app start — see ensureActiveAgentLaunchPlan.
      void ensureActiveAgentLaunchPlan('canvas-new-agent', 'claude').then((plan) => {
        add({ ...createAgentNode('claude', 0, undefined, place, undefined, undefined, undefined, plan), id })
      })
    } else if (active === 'terminal') {
      add({ ...createTerminalNode(1, undefined, place), id })
    } else {
      const base = createStickyNode(2, place)
      add({ ...base, id, data: { ...base.data, title: 'My drawing', text: '', color: '#bf5af2' } })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const handleBack = () => {
    if (Date.now() - sessionStart.current >= stickerThresholdMs()) {
      const titles = Array.from(visited.current).map((k) => TILE_TITLE[k])
      addSticker(`For trying ${titles.join(' and ')}`)
    }
    onBack()
  }

  return (
    <div className="md3-kids-activity">
      <div className="md3-kids-activity__bar">
        <Button variant="outlined" vocabularyMode="factual" className="md3-kids-backbtn" onClick={handleBack}>
          <IconBackArrow />
          Back to Beep
        </Button>
        <div className="md3-kids-activity__title">{TILE_TITLE[active]}</div>
        <Tablist className="md3-kids-activity__switch" ariaLabel="Switch activity">
          <IconButton size="dense" vocabularyMode="factual" aria-label="Talk to Beep" active={active === 'beep'}
            role="tab"
            aria-selected={active === 'beep'}
            className={'md3-kids-switchbtn' + (active === 'beep' ? ' md3-kids-switchbtn--active' : '')}
            onClick={() => setActiveState('beep')}
            title="Talk to Beep"
          >
            <IconBeep size={18} />
          </IconButton>
          <IconButton size="dense" vocabularyMode="factual" aria-label="Type things" active={active === 'terminal'}
            role="tab"
            aria-selected={active === 'terminal'}
            className={'md3-kids-switchbtn' + (active === 'terminal' ? ' md3-kids-switchbtn--active' : '')}
            onClick={() => setActiveState('terminal')}
            title="Type things"
          >
            <IconTerminal />
          </IconButton>
          <IconButton size="dense" vocabularyMode="factual" aria-label="Draw" active={active === 'draw'}
            role="tab"
            aria-selected={active === 'draw'}
            className={'md3-kids-switchbtn' + (active === 'draw' ? ' md3-kids-switchbtn--active' : '')}
            onClick={() => setActiveState('draw')}
            title="Draw"
          >
            <IconBrush size={18} />
          </IconButton>
        </Tablist>
      </div>
      <div className="md3-kids-activity__canvas">
        <ReactFlow
          nodes={nodes}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={1.5}
          deleteKeyCode={null}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={2} color="var(--md-canvas-dot)" />
        </ReactFlow>
      </div>
    </div>
  )
}

export function KidsActivityCanvas({
  active,
  onBack
}: {
  active: KidsTileKind | null
  onBack: () => void
}): React.JSX.Element | null {
  if (!active) return null
  return (
    <div className="md3-kids-canvas-layer md3-kids-canvas-layer--active">
      <ReactFlowProvider>
        <KidsActivityCanvasInner initial={active} onBack={onBack} />
      </ReactFlowProvider>
    </div>
  )
}
