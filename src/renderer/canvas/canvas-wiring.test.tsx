// @vitest-environment jsdom

import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CanvasPills } from './CanvasPills'
import { chromeObstacles, FIT_VIEW_GAP } from './fit-view'
import { planNodeDeletion } from '../lib/nodeDeletion'
import {
  destroySessionForScope,
  killRemoteSessionsForScope
} from '../lib/sessionKill'
import {
  dispatchZoomActualSize,
  dispatchZoomShortcut,
  type ZoomShortcutEvent
} from '../lib/zoomShortcut'

/** jsdom lays nothing out, so give an element the measurement a real pill cluster has. */
function measured(el: Element, rect: { left: number; top: number; right: number; bottom: number }): void {
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top
    }) as DOMRect
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the rendered canvas pill cluster is fit-view chrome', () => {
  const VIEWPORT = { left: 0, top: 0, right: 1200, bottom: 800 }
  const PILLS = { left: 60, top: 740, right: 300, bottom: 766 }

  it('renders the real cluster opt-in and is measured as one obstacle', () => {
    document.body.innerHTML = renderToStaticMarkup(<CanvasPills><span>usage</span></CanvasPills>)
    const element = document.querySelector('.canvas-pills')!
    expect(element.hasAttribute('data-canvas-chrome')).toBe(true)
    measured(element, PILLS)

    expect(chromeObstacles(VIEWPORT)).toEqual([
      {
        left: PILLS.left - FIT_VIEW_GAP,
        top: PILLS.top - FIT_VIEW_GAP,
        right: PILLS.right + FIT_VIEW_GAP,
        bottom: PILLS.bottom + FIT_VIEW_GAP
      }
    ])
  })

  it('does not mistake an unregistered lookalike for fit-view chrome', () => {
    document.body.innerHTML = '<div class="canvas-pills"></div>'
    measured(document.querySelector('.canvas-pills')!, PILLS)
    expect(chromeObstacles(VIEWPORT)).toEqual([])
  })
})

describe('session termination scope', () => {
  it('fans both local and remote session-memory kills across every socket', async () => {
    const destroy = vi.fn()
    const killRemote = vi.fn(async () => {})

    destroySessionForScope('session-memory', 'local-node', destroy)
    await killRemoteSessionsForScope('session-memory', 'remote-project', ['remote-node'], killRemote)

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenLastCalledWith('local-node', { everySocket: true })
    expect(killRemote).toHaveBeenCalledTimes(1)
    expect(killRemote).toHaveBeenLastCalledWith('remote-project', ['remote-node'], {
      everySocket: true
    })
  })

  it('keeps project deletion narrow on both the local and remote dispatchers', async () => {
    const destroy = vi.fn()
    const killRemote = vi.fn(async () => {})

    destroySessionForScope('project-deletion', 'local-node', destroy)
    await killRemoteSessionsForScope('project-deletion', 'remote-project', ['remote-node'], killRemote)

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenLastCalledWith('local-node')
    expect(killRemote).toHaveBeenCalledTimes(1)
    expect(killRemote).toHaveBeenLastCalledWith('remote-project', ['remote-node'])
  })

  it('keeps an ordinary node close narrow too', () => {
    const destroy = vi.fn()
    destroySessionForScope('node', 'node-1', destroy)
    expect(destroy).toHaveBeenLastCalledWith('node-1')
  })
})

const ZOOM_100: ZoomShortcutEvent = {
  type: 'keydown',
  code: 'Digit0',
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false
}

describe('the zoom routes dispatch their guarded decisions', () => {
  it('executes and prevents the keydown only on a free canvas', () => {
    const preventDefault = vi.fn()
    const zoomTo100 = vi.fn()
    const fitAll = vi.fn()
    const effects = { preventDefault, zoomTo100, fitAll }

    expect(
      dispatchZoomShortcut(ZOOM_100, { boardOpen: false, textFocus: false }, effects)
    ).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(zoomTo100).toHaveBeenCalledTimes(1)
    expect(fitAll).not.toHaveBeenCalled()

    vi.clearAllMocks()
    expect(dispatchZoomShortcut(ZOOM_100, { boardOpen: true, textFocus: false }, effects)).toBe(
      false
    )
    expect(preventDefault).not.toHaveBeenCalled()
    expect(zoomTo100).not.toHaveBeenCalled()
  })

  it('re-applies board and text-focus refusals on the desktop-forwarded route', () => {
    const zoomTo100 = vi.fn()

    expect(dispatchZoomActualSize({ boardOpen: false, textFocus: false }, zoomTo100)).toBe(true)
    expect(zoomTo100).toHaveBeenCalledTimes(1)

    expect(dispatchZoomActualSize({ boardOpen: true, textFocus: false }, zoomTo100)).toBe(false)
    expect(dispatchZoomActualSize({ boardOpen: false, textFocus: true }, zoomTo100)).toBe(false)
    expect(zoomTo100).toHaveBeenCalledTimes(1)
  })
})

describe('the trailing gestures are handed to the dispatcher', () => {
  // The checks above read the gesture BODIES, which is one hop short: `zoomGesture` can be
  // perfectly wired internally and simply never reach `dispatchGlobalKeydown`. Deleting
  // `zoom: zoomGesture,` from the gestures object keeps every assertion in this file — and in
  // globalKeybindings.test.ts, which supplies its own fakes — green while Shift+1 and the
  // keydown ⌘0 route quietly stop moving the camera. Same shape for the other two: the project
  // jump and the file-reference copy have no other call site either.
  it('wires zoom, projectJump and copy into the dispatcher deps', () => {
    expect(CANVAS_SRC).toContain('zoom: zoomGesture')
    expect(CANVAS_SRC).toContain('projectJump: projectJumpGesture')
    expect(CANVAS_SRC).toContain('copy: copyGesture')
  })
})

describe('the end-session confirm describes both things it does', () => {
  // `closeSession` stops the tmux session AND deletes the canvas node. The wording is inherited
  // from the sessions sidebar, where deleting the node is the obvious intent — but the
  // session-memory panel reuses the same path, and there the user came to reclaim RAM. Saying only
  // "this stops its tmux session" makes the node's removal a surprise on the one surface whose
  // purpose invites it. (Keeping the node would need a SECOND destroy path; deliberately not built.)
  it('says the node goes too for an owned session', () => {
    const plan = planNodeDeletion({
      surface: 'sessions-sidebar',
      kidsModeOn: false,
      titles: ['Session']
    })
    expect(plan.message).toMatch(/canvas node will be removed/i)
  })

  it('does not claim an orphan has a canvas node', () => {
    const plan = planNodeDeletion({
      surface: 'sessions-sidebar',
      kidsModeOn: true,
      titles: ['orphan session abc'],
      removesNode: false
    })
    expect(plan.description).not.toMatch(/canvas node/i)
  })
})

// Canvas.tsx has no render harness for its own body (see agent-status-rescue.test.ts's header
// for why), so the load-bearing breadcrumb-trail rules that CLAUDE.md calls out are pinned over
// the source itself, the same discipline as the dispatch-map pins above.
const CANVAS_SRC = fs.readFileSync(path.resolve(__dirname, 'Canvas.tsx'), 'utf8')

describe('breadcrumb wiring the CLAUDE.md bullet calls load-bearing', () => {
  it('goToNode refuses to record the ephemeral subagent/loop viz nodes', () => {
    // A breadcrumb for one is an id nothing can ever resolve (they are cleared on the next turn),
    // permanently burning one of the 20 slots.
    expect(CANVAS_SRC).toContain("node.type !== 'subagent' && node.type !== 'loop'")
  })

  it('stepAndFrame never records — it frames through the shared frameNode, not goToNode', () => {
    const step = CANVAS_SRC.slice(
      CANVAS_SRC.indexOf('const stepAndFrame = useCallback'),
      CANVAS_SRC.indexOf("const goBack = useCallback")
    )
    expect(step.length).toBeGreaterThan(0)
    // Recording inside a step would turn every back-step into a new tip.
    expect(step).not.toContain('recordBreadcrumb')
    expect(step).not.toContain('goToNode(')
    // The single framing implementation — the "Go to node" origin-jump invariant has ONE copy.
    expect(step).toContain('frameNode(target)')
  })

  it('there is exactly ONE framing implementation (frameNode) shared by focus and steps', () => {
    // The measured-check-reads-the-store rule regresses through a second copy first.
    expect(CANVAS_SRC.match(/isMeasured\(internal\)/g) ?? []).toHaveLength(1)
  })

  it('the resume card slot is spent only on a card that can render', () => {
    // Once per app run, only with a live stop, and never under the opaque kanban overlay.
    expect(CANVAS_SRC).toContain(
      '!resumeCardShown.has(project.id) && hasLiveStop && !isKanbanOpen(project.id)'
    )
  })

  it('the breadcrumb cursor is reset to the tip on every project activation', () => {
    expect(CANVAS_SRC).toContain('navRef.current = { list: bc, index: bc.length - 1 }')
  })

  it('the Dock/pill enabled state derives from stepBreadcrumb, never a raw index comparison', () => {
    // A raw `navRef.current.index > 0` renders an enabled arrow that clicks into doing nothing
    // once every earlier stop has been deleted — stepBreadcrumb is the only thing that knows.
    const cluster = CANVAS_SRC.slice(
      CANVAS_SRC.indexOf('md3-canvas-actions__sep'),
      CANVAS_SRC.lastIndexOf('md3-canvas-actions__sep')
    )
    expect(cluster).toContain("stepBreadcrumb(navRef.current, 'back'")
    expect(cluster).toContain("stepBreadcrumb(navRef.current, 'forward'")
  })
})

describe('reopen-last-closed records and dispatches through the shared history stack', () => {
  it('records a project close before hiding it', () => {
    expect(CANVAS_SRC).toContain("useReopenHistory.getState().push({ kind: 'project'")
  })

  it('records a node-delete batch by default, opting the account-removal cleanups out', () => {
    expect(CANVAS_SRC).toContain("kind: 'nodes'")
    // Codex login-node cleanup (Canvas.tsx) and the Claude account teardown adapter
    // (accountRemoval.ts, asserted separately) both refuse a reopen slot.
    expect(CANVAS_SRC).toContain("deleteNodes(loginIds, undefined, 'node', { record: false })")
  })

  it('binds the chord through the configured shortcut, not a hardcoded combo', () => {
    expect(CANVAS_SRC).toContain('matchesShortcut(e, shortcuts.reopenLastClosed, isMac)')
    expect(CANVAS_SRC).toContain('reopenLastClosedCommand()')
  })

  it('never live-inserts into a non-active project -- routes through applyNodeMutation instead', () => {
    // The bug this pins: a synchronous setNodes() right after switchProject()/reopenProject()
    // races the active-project load effect and silently loses the recreated nodes.
    const start = CANVAS_SRC.indexOf("case 'insertStored':")
    const end = CANVAS_SRC.indexOf("case 'skip':", start)
    const insertStored = CANVAS_SRC.slice(start, end === -1 ? start + 2000 : end)
    expect(insertStored).toContain('.applyNodeMutation(plan.projectId,')
    expect(insertStored).toContain("op: 'upsert'")
    expect(insertStored).toContain('flowToNodeStates([node])[0]')
    expect(insertStored).not.toContain('setNodes(')
  })

  it('resolves the TARGET project permission plan, never the caller-active one', () => {
    expect(CANVAS_SRC).toContain(
      "agentLaunchPlanForProject('reopen-last-closed', project, agentId)"
    )
  })
})

describe('breadcrumb wiring the CLAUDE.md bullet calls load-bearing', () => {
  // Same discipline as the dispatch-map pins above: Canvas has no render harness, and each of
  // these rules failed silently once (or would) — a source read is the only net.

  it('goToNode refuses to record the ephemeral subagent/loop viz nodes', () => {
    // A breadcrumb for one is an id nothing can ever resolve (they are cleared on the next turn),
    // permanently burning one of the 20 slots.
    expect(CANVAS_SRC).toContain("node.type !== 'subagent' && node.type !== 'loop'")
  })

  it('stepAndFrame never records — it frames through the shared frameNode, not goToNode', () => {
    const step = CANVAS_SRC.slice(
      CANVAS_SRC.indexOf('const stepAndFrame = useCallback'),
      CANVAS_SRC.indexOf('const goBack = useCallback')
    )
    expect(step.length).toBeGreaterThan(0)
    // Recording inside a step would turn every back-step into a new tip.
    expect(step).not.toContain('recordBreadcrumb')
    expect(step).not.toContain('goToNode(')
    // The single framing implementation — the "Go to node" origin-jump invariant has ONE copy.
    expect(step).toContain('frameNode(target)')
  })

  it('there is exactly ONE framing implementation (frameNode) shared by focus and steps', () => {
    // The measured-check-reads-the-store rule regresses through a second copy first.
    expect(CANVAS_SRC.match(/isMeasured\(internal\)/g) ?? []).toHaveLength(1)
  })

  it('the resume card slot is spent only on a card that can render, and only when opted in', () => {
    // Gated on settings.showResumeCard (default off) FIRST — a disabled card must not spend the
    // one-shot slot — then once per app run, only with a live stop, and never under the opaque
    // kanban overlay.
    expect(CANVAS_SRC).toContain(
      'resumeCardEnabled &&\n        !resumeCardShown.has(project.id) &&\n        hasLiveStop &&\n        !isKanbanOpen(project.id)'
    )
    expect(CANVAS_SRC).toContain(
      'const resumeCardEnabled = useSettings.getState().settings.showResumeCard'
    )
  })
})

describe('reopen-last-closed records and dispatches through the shared history stack', () => {
  it('records a project close before hiding it', () => {
    expect(CANVAS_SRC).toContain('useReopenHistory.getState().push({ kind: \'project\'')
  })

  it('records a node-delete batch, opting the account-removal cleanup out', () => {
    expect(CANVAS_SRC).toContain("kind: 'nodes'")
    expect(CANVAS_SRC).toContain('deleteNodes(loginIds, { record: false })')
  })

  it('registers the command in the dispatch map', () => {
    expect(CANVAS_SRC).toContain("'app.reopenLastClosed': reopenLastClosedCommand")
  })

  it('never live-inserts into a non-active project — routes through applyNodeMutation instead', () => {
    // The bug this pins: a synchronous setNodes() right after switchProject()/reopenProject()
    // races the active-project load effect and silently loses the recreated nodes.
    expect(CANVAS_SRC).toContain('.applyNodeMutation(plan.projectId, {')
  })

  it('arms a cold-open command before writing a restored node into a non-active project', () => {
    // The bug this pins: flowToNodeStates alone drops initialCommand, so an agent node restored
    // into a project that isn't on screen would never launch its command on the eventual cold
    // open — armForColdOpen is what carries it through serialization.
    expect(CANVAS_SRC).toContain('node: flowToNodeStates([armForColdOpen(node)])[0]')
  })

  it('commits the live canvas to the store before every reopenProject call — never a bare switch', () => {
    // The bug this pins: useProjects.getState().reopenProject(...) is a project SWITCH, and every
    // switch/add/delete elsewhere in this file calls commitActiveToStore() first so the live
    // canvas isn't silently lost. Both reopen-a-project call sites inside reopenLastClosedCommand
    // must do the same, rather than referencing the later `reopenProject` wrapper (a TDZ hazard
    // from this callback's declaration point).
    const calls = CANVAS_SRC.match(/useProjects\.getState\(\)\.reopenProject\(/g) ?? []
    const guarded = CANVAS_SRC.match(/commitActiveToStore\(\)\n\s+useProjects\.getState\(\)\.reopenProject\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(guarded.length).toBe(calls.length)
  })

  it('resolves permission mode against the TARGET project being restored into, not the caller\'s active one', () => {
    expect(CANVAS_SRC).toContain('permissionModeFor: (agentId) => projectPermissionMode(project, agentId)')
  })

  it('extracts the reopen decision into the pure, tested planReopen', () => {
    expect(CANVAS_SRC).toContain('const plan = planReopen(')
    expect(CANVAS_SRC).toContain("case 'insertActive':")
    expect(CANVAS_SRC).toContain("case 'insertStored':")
    expect(CANVAS_SRC).toContain("case 'reopenProject':")
  })
})
