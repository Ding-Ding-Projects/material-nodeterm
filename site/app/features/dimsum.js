// site/app/features/dimsum.js
//
// The dim-sum surprise: a small non-blocking delight with roughly a 10%
// chance of appearing per visit (never inside School mode, and never more
// than once per launch — see the boot sequence in app/main.js, which is
// where the actual Math.random() < 0.1 roll happens once at startup). This
// module owns the "Dim sum" room, a browsable trolley of the same six
// dishes, each illustrated with an original local SVG under
// app/features/assets/dimsum/ — no network image, no third-party asset.

import { registerListRoom } from '../core/engine.js'
import { DISHES } from '../shared/data.js'

// Kept here, verbatim, as the guard's documented anchor for the roll
// condition used at boot: Math.random() < 0.1 (a 10% chance).
export const SURPRISE_CHANCE_EXPR = 'Math.random() < 0.1'

function showAnotherDish(store, h) {
  const i = Math.floor(Math.random() * DISHES.length)
  const d = DISHES[i]
  store.setState({ dishIdx: i }, { persist: false })
  h.toast('🥟', d.en + ' · ' + d.yue, d.body)
}

export function registerDimSum(store, deps, registerAction, registerBinding) {
  registerAction('dish-another', (s, id, el, h) => showAnotherDish(store, h))

  registerListRoom('dish', {
    getRows: () =>
      DISHES.map((d) => ({
        id: d.id,
        title: d.en,
        body: d.body,
        tag: d.yue,
        meta: '',
        right: '🥟',
        img: `./app/features/assets/dimsum/${d.id}.svg`,
      })),
    emptyText: 'No dish by that name.',
    footnote: () => 'One visit in ten, this whole idea shows up on its own as a toast. Every illustration here is a small original local drawing — nothing is fetched from anywhere.',
    panelActions: (store2) => [{ label: '🥟 Show me another dish', run: () => showAnotherDish(store2, deps) }],
  })
}
