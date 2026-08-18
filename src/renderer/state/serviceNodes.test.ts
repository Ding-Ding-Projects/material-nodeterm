import { describe, expect, it } from 'vitest'
import { SERVICE_NODE_KINDS, isServiceNodeKind } from '@shared/types'
import type { CanvasNodeState } from '@shared/types'
import { createServiceNode, flowToNodeStates, nodeStatesToFlow } from './workspace'
import {
  RAINBOW_COLOR,
  RAINBOW_SPEED_DEFAULT,
  isRainbowColor,
  nodeBorderStyle,
  nodeColorStyle,
  rainbowDurationSeconds
} from '../lib/nodeColor'

describe('service manager nodes', () => {
  it.each(SERVICE_NODE_KINDS)('%s mints an id that can never pass as a terminal session', (kind) => {
    const node = createServiceNode(kind, 0)
    expect(node.type).toBe(kind)
    expect(node.id.startsWith(`${kind}-`)).toBe(true)
    // The load-bearing half. `SAFE_NODE_ID` in core/project-node-append.ts is /^term-…/ and decides
    // whether an incoming id may register as a REAL terminal session, so a manager wearing that
    // prefix could be pushed through as a shell by a peer or the mobile append path.
    expect(node.id.startsWith('term-')).toBe(false)
  })

  it.each(SERVICE_NODE_KINDS)('%s starts at a deliberate size, not the terminal fallback', (kind) => {
    const node = createServiceNode(kind, 0)
    expect(node.width).toBeGreaterThan(0)
    expect(node.height).toBeGreaterThan(0)
    // 640x440 is TERMINAL_SIZE. Before NODE_START_SIZE became a table, a kind missing from the
    // ternary chain silently landed on it with nothing failing — that is the regression this pins.
    expect({ width: node.width, height: node.height }).not.toEqual({ width: 640, height: 440 })
  })

  it('persists a label and nothing that identifies a machine', () => {
    const node = createServiceNode('minecraft', 0)
    const [state] = flowToNodeStates([{ ...node, data: { ...node.data, serviceLabel: 'Home server' } }] as never)
    expect(state.serviceLabel).toBe('Home server')
    // The restraint IS the feature: this record travels in .nodeterm/project.json to every machine
    // that clones the repository, so a host or a credential here would be one person's environment
    // arriving in everybody else's checkout.
    const persisted = JSON.stringify(state)
    for (const forbidden of ['host', 'password', 'token', 'containerId', 'executable']) {
      expect(persisted.includes(`"${forbidden}"`)).toBe(false)
    }
  })

  it('round-trips a label and a size through both serializers', () => {
    const states: CanvasNodeState[] = [
      {
        id: 'proxmox-abc-1',
        kind: 'proxmox',
        position: { x: 10, y: 20 },
        size: { width: 700, height: 500 },
        title: 'Proxmox',
        color: '#0a84ff',
        group: null,
        serviceLabel: 'Home lab'
      } as CanvasNodeState
    ]
    const live = nodeStatesToFlow(states)
    expect(live[0]?.type).toBe('proxmox')
    expect(live[0]?.data.serviceLabel).toBe('Home lab')
    const back = flowToNodeStates(live)
    expect(back[0]?.serviceLabel).toBe('Home lab')
    expect(back[0]?.kind).toBe('proxmox')
  })

  it('recognises only real service kinds, and does not walk the prototype chain', () => {
    for (const kind of SERVICE_NODE_KINDS) expect(isServiceNodeKind(kind)).toBe(true)
    expect(isServiceNodeKind('terminal')).toBe(false)
    expect(isServiceNodeKind(undefined)).toBe(false)
    // `in` would accept both of these; a Set does not. Reachable because a node type survives a
    // hand-edited project.json as an arbitrary string.
    expect(isServiceNodeKind('constructor')).toBe(false)
    expect(isServiceNodeKind('toString')).toBe(false)
  })
})

describe('rainbow node colour', () => {
  it('is a sentinel, not a colour, and never gets alpha concatenated onto it', () => {
    expect(isRainbowColor(RAINBOW_COLOR)).toBe(true)
    expect(isRainbowColor('#ff0000')).toBe(false)
    // The failure this prevents is quiet: `rainbow33` is not a CSS error, it is an ignored
    // declaration, so the surface renders with no background and nothing says why.
    const { className, style } = nodeColorStyle(RAINBOW_COLOR, 0.2)
    expect(className).toBe('nt-rainbow')
    expect(style.background).toBeUndefined()
  })

  it('still returns a real tint for an ordinary colour, via alphaTint', () => {
    const { className, style } = nodeColorStyle('#ff0000', 0.2)
    expect(className).toBe('')
    // A parsed rgba(), not a concatenated string: `#ff000033` is only a colour because that value
    // happens to be 6-digit hex, and the picker has offered rgb() and oklch() for a while.
    // `startsWith`, not a regex: an escaped paren has been eaten by a shell four times in this
    // session alone, and a mangled pattern here would either fail on correct output or — worse —
    // match nothing and pass forever.
    expect(style.background?.startsWith('rgb')).toBe(true)
  })

  it('colours a border by class for rainbow and by value otherwise', () => {
    expect(nodeBorderStyle(RAINBOW_COLOR).className).toBe('nt-rainbow-border')
    expect(nodeBorderStyle(RAINBOW_COLOR).style.borderColor).toBeUndefined()
    expect(nodeBorderStyle('#00ff00').style.borderColor).toBe('#00ff00')
  })

  it('maps speed to a duration, and never to NaN', () => {
    expect(rainbowDurationSeconds(1)).toBeGreaterThan(rainbowDurationSeconds(5))
    expect(rainbowDurationSeconds(RAINBOW_SPEED_DEFAULT)).toBe(6)
    // settings.json is hand-editable, so every one of these is reachable. A NaN here would reach a
    // CSS duration and silently disable the animation rather than failing.
    for (const bad of [undefined, 0, 99, -1, Number.NaN]) {
      expect(Number.isFinite(rainbowDurationSeconds(bad as number))).toBe(true)
      expect(rainbowDurationSeconds(bad as number)).toBeGreaterThan(0)
    }
  })
})
