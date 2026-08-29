// site/app/features/coverage.js
//
// The "Checklist" room: a hand-written list of every promise this page
// makes and exactly where it lives — the same discipline this project's
// own CLAUDE.md documents elsewhere ("a checker that only looks at what
// already exists would pass happily on a page with nothing on it"). Rows
// marked "partial" say so honestly rather than being quietly dropped.

import { registerListRoom } from '../core/engine.js'
import { COVERAGE } from '../shared/data.js'

export function registerCoverage(store, deps, registerAction, registerBinding) {
  registerListRoom('coverage', {
    getRows: () =>
      COVERAGE.map((c, i) => ({
        id: 'cov' + i,
        title: c[0],
        body: 'Lives in: ' + c[1],
        tag: c[2] === 'done' ? 'done' : 'partial',
        meta: '',
        right: c[2] === 'done' ? '✅' : '⚠️',
      })),
    emptyText: 'Nothing on the checklist matches.',
    footnote: () => 'This list is written by hand on purpose. A checker that only looks at what already exists would pass happily on a page with nothing on it, so each promise is named here whether or not it is built.',
    panelActions: (store2) => [{ label: '📦 Save the checklist', run: () => deps.download('nodeterm-checklist.json', JSON.stringify(COVERAGE.map((c) => ({ promise: c[0], where: c[1], state: c[2] })), null, 2)) }],
  })
}
