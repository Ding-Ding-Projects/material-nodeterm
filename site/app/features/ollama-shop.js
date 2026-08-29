// site/app/features/ollama-shop.js
//
// The "Model shop" room: a browse-only catalogue of local Ollama models
// with an honest hardware-fit verdict per model (see
// app/shared/hardware-fit.js) and a "basket" that is explicitly a shopping
// list for the user's OWN machine, never a real download — this static
// page cannot pull an Ollama model.

import { registerListRoom } from '../core/engine.js'
import { OLLAMA } from '../shared/data.js'
import { fitVerdict } from '../shared/hardware-fit.js'

export function registerOllamaShop(store, deps, registerAction, registerBinding) {
  registerListRoom('shop', {
    getRows: (s) =>
      OLLAMA.map((o) => {
        const f = fitVerdict(o.gb)
        return {
          id: o.id,
          title: o.id,
          body: f.why + (s.cart[o.id] ? '\nIn your basket.' : ''),
          tag: f.verdict,
          meta: o.gb + ' GB · ' + o.tag + ' · updated ' + o.updated,
          right: s.cart[o.id] ? '🧺' : '',
        }
      }),
    emptyText: 'No model matches that.',
    footnote: () => 'This page cannot download a model. The verdicts come from what your browser is willing to say about this computer, and it rounds memory hard, so treat “should fit” as a hint rather than a promise.',
    remove: (store2, ids) => {
      const cart = Object.assign({}, store2.state.cart)
      ids.forEach((id) => delete cart[id])
      store2.setState({ cart, picked: {} }, { persist: false })
    },
    panelActions: (store2) => [
      {
        label: '🧺 Put picked in the basket',
        run: () => {
          const pickedIds = Object.keys(store2.state.picked)
          const cart = Object.assign({}, store2.state.cart)
          pickedIds.forEach((id) => (cart[id] = true))
          store2.setState({ cart, picked: {} }, { persist: false })
          deps.toast('🧺', 'In the basket', pickedIds.length + ' model(s) noted. This page cannot pull them — it is a shopping list for your own machine.')
        },
      },
    ],
  })
}
