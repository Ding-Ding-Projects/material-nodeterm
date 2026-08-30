import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(__dirname, 'styles.clipping.css'), 'utf8').replace(/\r\n/g, '\n')
const CANVAS = readFileSync(join(__dirname, 'canvas', 'Canvas.tsx'), 'utf8')

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

  it('keeps narrow notification messages readable instead of wrapping every character vertically', () => {
    expect(CSS).toContain('  .top-banners {\n    width: calc(100vw - 16px);')
    expect(CSS).toContain('  .announce-banner {\n    width: 100%;\n    max-width: none;')
    expect(CSS).toContain('  .announce-banner__content {\n    flex: 1 1 160px;')
  })

  it('keeps narrow app bars and the sessions card within a reachable viewport', () => {
    expect(CSS).toContain('  .md3-app-bar,\n  .tabbar {\n    overflow-x: auto;')
    expect(CSS).toContain('  .sessions-sidebar {\n    left: 8px;\n    width: calc(100vw - 16px);')
  })

  it('keeps narrow toasts clear of the navigation rail and bottom dock', () => {
    expect(CSS).toContain('  .toast-stack {\n    left: calc(var(--nav-rail-w) + 8px);')
    expect(CSS).toContain('    right: 8px;\n    /* The dock is bottom:22px with a 54px shell.')
    expect(CSS).toContain('    bottom: 84px;\n    width: auto;')
    expect(CSS).toContain('    max-height: min(45vh, calc(100vh - 100px));')
  })

  it('renders one app-bar shell and no obsolete legacy tab-bar chrome', () => {
    expect(CANVAS.match(/<TopAppBar(?:\s|>)/g) ?? []).toHaveLength(1)
    expect(CANVAS.match(/<\/TopAppBar>/g) ?? []).toHaveLength(1)
    expect(CANVAS).not.toMatch(/^\s*import\s+\{\s*TabBar\s*\}\s+from\s+/m)
    expect(CANVAS).not.toMatch(/<TabBar(?:\s|>)/)
  })
})
