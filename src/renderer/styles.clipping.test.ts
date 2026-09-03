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
    expect(CSS).toMatch(/\.top-banners \{[^}]*left: calc\(var\(--nav-rail-w\) \+ 8px\)/s)
    expect(CSS).toContain('  .announce-banner {\n    width: 100%;\n    max-width: none;')
    expect(CSS).toContain('  .announce-banner__content {\n    flex: 1 1 160px;')
  })

  it('keeps narrow app bars and the sessions card within a reachable viewport', () => {
    expect(CSS).toContain('  .md3-app-bar,\n  .tabbar {\n    overflow-x: auto;')
    expect(CSS).toMatch(/\.sessions-sidebar \{[^}]*left: calc\(var\(--nav-rail-w\) \+ 8px\)/s)
  })

  it('reserves the rail column in every narrow overlay, not just the toast stack', () => {
    // The rail is a real navigation target and the content column starts after it, so an overlay
    // sized against 100vw is wider than the space it actually has. Exactly one of these reserved
    // the rail and the others did not, which clipped the banner mid-word at the minimum viewport.
    // Written as literals rather than a built pattern: a constructed regex loses a backslash on
    // the way through a shell and would then match nothing while still reading as a check.
    expect(CSS).toMatch(/\.top-banners \{[^}]*var\(--nav-rail-w\)/s)
    expect(CSS).toMatch(/\.sessions-sidebar \{[^}]*var\(--nav-rail-w\)/s)
    expect(CSS).toMatch(/\.toast-stack \{[^}]*var\(--nav-rail-w\)/s)
    // A fixed-position editor sized on 100vw spans the rail too.
    expect(CSS).toMatch(/\.appearance-editor \{[^}]*width: calc\(100vw - var\(--nav-rail-w\)/s)
  })

  it('keeps the separated session context button at a 44px interaction target', () => {
    expect(CSS).toMatch(/\.ss-row__contextline\s*\{[^}]*min-height:\s*44px/s)
    expect(CSS).toMatch(/\.ss-row__contextline \.ctx-pill\s*\{[^}]*min-height:\s*44px/s)
  })

  it('keeps WSL frame controls touch-sized with a visible keyboard focus treatment', () => {
    expect(CSS).toMatch(/\.group-node__wsl \.group-node__wt-btn\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/s)
    expect(CSS).toMatch(/\.group-node__wsl \.group-node__wt-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--md-primary\)/s)
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
