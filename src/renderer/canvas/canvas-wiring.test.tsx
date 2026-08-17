// @vitest-environment jsdom

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
