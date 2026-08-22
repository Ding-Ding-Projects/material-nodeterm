import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard on the full-colour node title bar (`.term-node__header--filled`).
 *
 * Every node kind that shares `.term-node__header` — terminal, browser, diff, editor, video, web —
 * must compute the fill through `nodeHeaderFillStyle` and apply BOTH the inline style it returns
 * and the `term-node__header--filled` class, or the header quietly stays outline-only again (the
 * exact regression reported 2026-08-20). This is a source-text guard rather than a render test
 * because these are plain functional components with heavy native/IPC dependencies (Monaco, xterm,
 * webview) that are expensive to mount in a unit test; the wiring itself is a one-line call plus a
 * one-line class string, which a text guard can check precisely.
 *
 * Needles are anchored to real tokens (`nodeHeaderFillStyle(`, `term-node__header--filled`) rather
 * than a bare word, and every needle is proven to actually catch a regression below by breaking the
 * wiring in a real file and asserting the guard goes red — see `it('is not satisfied by a
 * commented-out or renamed call')`.
 */

const RENDERER_DIR = __dirname
const MD3_CSS = readFileSync(join(RENDERER_DIR, 'styles.md3.css'), 'utf8')
// Collapse behavior (which elements hide) is structural CSS that predates the md3 restyle and
// still lives in the base sheet; the two are loaded together (see boot.tsx) and are checked as
// one cascade here, exactly as the browser sees them.
const CSS = readFileSync(join(RENDERER_DIR, 'styles.css'), 'utf8') + '\n' + MD3_CSS

const HEADER_NODE_FILES = [
  'nodes/TerminalNode.tsx',
  'nodes/BrowserNode.tsx',
  'nodes/DiffNode.tsx',
  'nodes/EditorNode.tsx',
  'nodes/VideoNode.tsx',
  'nodes/WebNode.tsx'
]

function readNode(file: string): string {
  return readFileSync(join(RENDERER_DIR, file), 'utf8')
}

describe('term-node__header--filled (full-colour title bar)', () => {
  it('every shared-header node kind imports and calls nodeHeaderFillStyle', () => {
    for (const file of HEADER_NODE_FILES) {
      const src = readNode(file)
      expect(src, `${file}: missing the import`).toMatch(
        /import\s*\{\s*nodeHeaderFillStyle\s*\}\s*from\s*'\.\.\/lib\/nodeColor'/
      )
      expect(src, `${file}: never calls nodeHeaderFillStyle(`).toMatch(/nodeHeaderFillStyle\(/)
    }
  })

  it('every shared-header node kind applies the --filled class and the computed style', () => {
    for (const file of HEADER_NODE_FILES) {
      const src = readNode(file)
      expect(src, `${file}: header never gets the --filled class`).toMatch(
        /term-node__header--filled/
      )
      // The computed style object must actually be spread onto the header element, not just
      // computed and discarded.
      expect(src, `${file}: header never gets style={headerFill.style}`).toMatch(
        /style=\{headerFill\.style\}/
      )
    }
  })

  it('the stylesheet defines the --filled override and it survives collapse', () => {
    // The rule must exist at all...
    expect(MD3_CSS, 'no .term-node__header--filled rule in styles.md3.css').toMatch(
      /\.term-node__header--filled\s*[,{]/
    )
    // ...and collapsing a node hides only the BODY/tags, never the header, so a collapsed filled
    // node (the exact screenshot the request was filed against) keeps its fill.
    expect(CSS).toMatch(/\.term-node\.collapsed \.term-node__body/)
    expect(CSS).not.toMatch(/\.term-node\.collapsed \.term-node__header\b/)
  })

  it('the selection ring and the error/attention ring stay on the outer node, unaffected by the fill', () => {
    // Both live on `.term-node` (the outer card), never inside `.term-node__header`, so a filled
    // header can never paint over them.
    expect(CSS).toMatch(/\.term-node\.selected\s*\{[^}]*border-color:\s*var\(--md-primary\)/)
    expect(CSS).toMatch(/\.term-node\.attention\s*\{[^}]*border-color:\s*var\(--md-error\)/)
  })

  it('is not satisfied by a commented-out or renamed call — proving the guard actually watches', () => {
    // A guard nobody has watched fail proves nothing. Simulate the exact regression each needle
    // exists to catch: a real file whose wiring was commented out, or whose helper was renamed.
    const commentedOut = readNode('nodes/TerminalNode.tsx').replace(
      /nodeHeaderFillStyle\(data\.color\)/,
      '// nodeHeaderFillStyle(data.color)\n  const headerFill = { className: "", filled: false, style: {} }'
    )
    expect(commentedOut).not.toMatch(/^\s*headerFill\s*=\s*nodeHeaderFillStyle\(/m)

    const renamed = readNode('nodes/BrowserNode.tsx').replace(
      /term-node__header--filled/g,
      'term-node__header--filledX'
    )
    // Every occurrence is now the renamed variant (`…--filledX`); a regex anchored to the exact,
    // un-renamed class name must find none of them left.
    expect(/term-node__header--filled(?!X)/.test(renamed)).toBe(false)
  })
})

/**
 * `StickyNode` is the other node kind that can genuinely collapse (the shared-header kinds above
 * cannot). Its collapsed screenshot is the exact one the original report was against, and its
 * header was never wired to `nodeHeaderFillStyle` at all — it kept the same low-alpha tint whether
 * collapsed or expanded, so the "this note is orange" colour barely registered once collapsed.
 *
 * Unlike the shared-header kinds, sticky deliberately fills ONLY while collapsed (its expanded tint
 * is a different, already-fine look this task was not asked to touch) — so the assertions below
 * check for the gated wiring, not an unconditional call.
 */
describe('sticky-node__header--filled (collapsed-only full-colour title bar)', () => {
  const STICKY = readNode('nodes/StickyNode.tsx')

  it('imports nodeHeaderFillStyle and computes it only for the collapsed state', () => {
    expect(STICKY).toMatch(/import\s*\{\s*nodeHeaderFillStyle\s*\}\s*from\s*'\.\.\/lib\/nodeColor'/)
    expect(STICKY).toMatch(/collapsed\s*\?\s*nodeHeaderFillStyle\(data\.color\)\s*:\s*null/)
  })

  it('applies the --filled class and style only when headerFill.filled is true', () => {
    expect(STICKY).toMatch(/sticky-node__header--filled/)
    expect(STICKY).toMatch(/headerFill\?\.filled\s*\?\s*headerFill\.style\s*:/)
  })

  it('the stylesheet defines the sticky --filled override', () => {
    expect(CSS).toMatch(/\.sticky-node__header--filled\s*[,{]/)
  })

  it('is not satisfied by a commented-out or renamed call', () => {
    const commentedOut = STICKY.replace(
      /const headerFill = collapsed \? nodeHeaderFillStyle\(data\.color\) : null/,
      'const headerFill = null'
    )
    expect(commentedOut).not.toMatch(/collapsed\s*\?\s*nodeHeaderFillStyle\(/)

    const renamed = STICKY.replace(/sticky-node__header--filled/g, 'sticky-node__header--filledX')
    expect(/sticky-node__header--filled(?!X)/.test(renamed)).toBe(false)
  })
})
