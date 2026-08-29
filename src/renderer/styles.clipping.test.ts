import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(__dirname, 'styles.clipping.css'), 'utf8')

describe('new node surfaces participate in the clipping sweep', () => {
  it.each([
    'repository-graph-node',
    'veracrypt-node',
    'trigger-node',
    'unigetui-universe',
    'unigetui-universe-node'
  ])('declares an exact containment rule for %s', (surface) => {
    const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(CSS).toMatch(new RegExp(`(?:^|,)\\s*\\.${escaped}(?:\\s*,|\\s*\\{)`, 'm'))
  })

  it('keeps the graph SVG horizontally scrollable within its visual frame', () => {
    expect(CSS).toMatch(/\.repository-graph-node__visual\s*\{[^}]*overflow:\s*auto/s)
    expect(CSS).toMatch(/\.repository-graph-node__visual\s+svg\s*\{[^}]*max-width:\s*none/s)
  })

  it('keeps the trigger body shrinkable so overflow can scroll', () => {
    const md3 = readFileSync(join(__dirname, 'styles.md3.css'), 'utf8')
    expect(md3).toMatch(/\.trigger-node__body\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;/s)
  })
})
