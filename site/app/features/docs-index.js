// site/app/features/docs-index.js
//
// Registers a "Docs" tab/command that links to the per-feature
// documentation pages under site/docs/. Those are plain static HTML pages
// (not part of the single-page feature layer), so this module just points
// at them with relative links — never a root-absolute path, which would
// 404 once this fork's Pages deployment serves the site from
// /material-nodeterm/ rather than a domain root.
//
// BASE-PATH SAFETY: an href/location.href assigned from inside a JS module
// resolves against the DOCUMENT's URL, not this module's own file
// location — a bare './docs/index.html' or '../docs/index.html' string
// would be wrong depending on which document currently hosts this script.
// DOCS_INDEX_URL is resolved once, against this module's own
// `import.meta.url` (site/app/features/docs-index.js -> up to site/ ->
// down into docs/), which is correct no matter where this module is
// loaded from.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'

const DOCS_INDEX_URL = new URL('../../docs/index.html', import.meta.url).href

injectStyleOnce(
  'site-docsindex-style',
  `
  .site-docs-panel { display: flex; flex-direction: column; gap: 10px; }
  .site-docs-panel a {
    display: inline-block; min-height: var(--touch-target, 44px); line-height: var(--touch-target, 44px);
    padding: 0 14px; border-radius: var(--md-shape-full, 999px); border: 1px solid var(--md-outline, #79767e);
    background: var(--md-surface-container, #efeaf2); color: var(--md-on-surface, #1c1b1f); text-decoration: none;
    width: fit-content;
  }
  `,
)

function buildPanel() {
  return h('div', { class: 'site-docs-panel' }, [
    h('h3', {}, 'Documentation'),
    h('p', {}, 'Every feature has its own article: behaviour, configuration, failure modes, security considerations, and how it is verified.'),
    h('a', { href: DOCS_INDEX_URL }, 'Open the full documentation index →'),
  ])
}

export function registerDocs(api) {
  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'docs', title: 'Docs', icon: '📚', group: 'app', render: asMountable(buildPanel) })
  }
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      id: 'open-docs-index',
      title: 'Open documentation index',
      run: () => {
        window.location.href = DOCS_INDEX_URL
      },
    })
  }
}
