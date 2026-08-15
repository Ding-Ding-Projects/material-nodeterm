// site/app/features/docs-index.js
//
// The "Guide book" room: one row per feature documentation article under
// site/docs/. Rows link straight to the real article; the "Open this on
// GitHub" row action links to this fork's docs source instead.

import { registerListRoom } from '../core/engine.js'
import { DOCS, REPO_BLOB_DOCS } from '../shared/data.js'

export function registerDocs(store, deps, registerAction, registerBinding) {
  registerListRoom('docs', {
    getRows: () =>
      DOCS.map((d, i) => ({
        id: 'doc' + i,
        title: d[0],
        body: d[1] + ' — read the full article at docs/' + d[2] + '.html',
        tag: 'guide',
        meta: '',
        right: '→',
        url: REPO_BLOB_DOCS,
        docHref: './docs/' + d[2] + '.html',
      })),
    emptyText: 'No guide page matches that.',
    footnote: () => 'Click a row to pick it (for export). Right-click a row for “Open this on GitHub”, or open ./docs/index.html to actually read the articles.',
  })
}
