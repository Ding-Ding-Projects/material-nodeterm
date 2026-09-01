import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The motion identity layer exists because a Material surface with no entrance reads as generic
 * even when every token is correct. This guard is a hand-written inventory, not a discovery scan:
 * a surface removed from the layer must turn it red, and a rule that quietly stops matching
 * anything must too. Line endings are normalized before parsing because this checkout is CRLF and
 * a guard that splits on the wrong newline derives an empty list and vanishes while green.
 */
const css = readFileSync(join(__dirname, 'styles.md3.css'), 'utf8').replace(/\r\n/g, '\n')

/** Every selector that must carry the shared spring entrance. Hand-written; add, never trim. */
const SPRING_SURFACES = [
  '.mdx-dialog',
  '.toylock-wizard',
  '.kanban-modal',
  '.label-picker',
  '.export-menu__panel',
  '.notif-center',
  '.veracrypt-node__confirm',
  '.confirm-overlay > :first-child',
  '.sc-overlay > :first-child',
  '.consent-overlay > :first-child'
]

/** Every scrim that must fade on the effect token. */
const FADING_SCRIMS = [
  '.confirm-overlay',
  '.drawer-overlay',
  '.kanban-modal-scrim',
  '.label-picker__scrim',
  '.mdx-dialog-scrim',
  '.sc-overlay',
  '.consent-overlay',
  '.toylock-wizard__backdrop'
]

function layerSection(): string {
  const start = css.indexOf('MOTION IDENTITY LAYER')
  expect(start).toBeGreaterThan(-1)
  return css.slice(start)
}

describe('motion identity layer', () => {
  it('declares the materialize keyframe and applies it to node content, not the React Flow wrapper', () => {
    const layer = layerSection()
    expect(layer).toMatch(/@keyframes nt-node-materialize/)
    expect(layer).toMatch(/^\.react-flow__node > div \{$/m)
    // The wrapper's transform belongs to React Flow's drag/pan; animating it fights the engine.
    expect(layer).not.toMatch(/^\.react-flow__node \{$/m)
  })

  it('gives every inventoried panel the shared spring entrance', () => {
    const layer = layerSection()
    const block = layer.split('animation: md3-pop-in var(--md3-motion-spatial) backwards')[0]
    expect(SPRING_SURFACES.length).toBeGreaterThanOrEqual(10)
    for (const selector of SPRING_SURFACES) {
      const present = block.includes(selector + ',') || block.includes(selector + ' {')
      expect(present, selector + ' must be in the spring entrance group').toBe(true)
    }
  })

  it('fades every inventoried scrim on the effect token', () => {
    const layer = layerSection()
    const fadeAt = layer.indexOf('animation: md3-fade-in var(--md3-motion-effect) backwards')
    expect(fadeAt).toBeGreaterThan(-1)
    const block = layer.slice(0, fadeAt)
    expect(FADING_SCRIMS.length).toBeGreaterThanOrEqual(8)
    for (const selector of FADING_SCRIMS) {
      expect(block, selector + ' must be in the scrim fade group').toContain('\n' + selector)
    }
  })

  it('bounds the row cascade and zeroes its stagger under reduced motion', () => {
    const layer = layerSection()
    expect(layer).toMatch(/@keyframes nt-row-assemble/)
    expect(layer).toMatch(/--nt-motion-stagger: 14ms/)
    expect(layer).toMatch(/--nt-motion-stagger: 0ms/)
    // Bounded: exactly rows 2 through 8 get delays, so a long list never queues motion.
    const delays = layer.match(/nth-child\((\d)\), \.notif-center__row:nth-child/g) ?? []
    expect(delays.length).toBe(7)
    expect(layer).not.toContain(':nth-child(9)')
  })

  it('eases tab and session-row state changes without touching layout properties', () => {
    const layer = layerSection()
    const idx = layer.indexOf('.ss-row {')
    expect(idx).toBeGreaterThan(-1)
    const rule = layer.slice(idx, layer.indexOf('}', idx))
    expect(rule).toContain('background-color var(--md3-motion-effect)')
    expect(rule).not.toMatch(/transition:[^}]*(width|height|top|left|margin|padding)/)
  })
})
