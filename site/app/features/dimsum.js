// site/app/features/dimsum.js
//
// A 10% chance at each page load of showing a randomly chosen dim sum dish,
// named in both languages, with a small original SVG illustration. It is
// non-blocking and auto-dismissing — never gates the page, never steals
// focus — and it CANNOT be opted out of: there is no setting anywhere on
// this site that turns the random draw off. While School mode is on, the
// draw is suppressed entirely (school-state.js), per that feature's "behave
// as if not installed" contract.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { DISHES, pickRandomDish } from './dimsum-data.js'
import { isEnabled as isSchoolModeEnabled, subscribeSchoolState } from '../shared/school-state.js'
import { subscribeI18n } from '../shared/i18n.js'

injectStyleOnce(
  'site-dimsum-style',
  `
  .site-dimsum-toast {
    position: fixed; right: 16px; bottom: 16px; z-index: 40;
    display: flex; align-items: center; gap: 10px; max-width: min(320px, 90vw);
    background: var(--md-surface-container-high, #e9e4ec); color: var(--md-on-surface, #1c1b1f);
    border-radius: var(--md-shape-lg, 16px); box-shadow: var(--md-elevation-2); padding: 10px 12px;
  }
  .site-dimsum-toast img { width: 56px; height: 56px; flex: 0 0 auto; }
  .site-dimsum-toast__body { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .site-dimsum-toast__names strong { display: block; }
  .site-dimsum-toast__close {
    margin-left: auto; align-self: flex-start; background: transparent; border: none; cursor: pointer;
    font-size: 16px; line-height: 1; color: var(--md-on-surface-variant, #47454a); min-width: 32px; min-height: 32px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .site-dimsum-toast { animation: site-dimsum-in 220ms ease-out; }
  }
  @keyframes site-dimsum-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .site-dimsum-panel { display: flex; flex-direction: column; gap: 12px; }
  .site-dimsum-panel__preview { display: flex; align-items: center; gap: 14px; }
  .site-dimsum-panel__preview img { width: 84px; height: 84px; }
  .site-dimsum-panel__btn {
    min-height: var(--touch-target, 44px); padding: 0 14px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit; align-self: flex-start;
  }
  `,
)

const AUTO_DISMISS_MS = 9000

function dishNode(dish, { withCloseButton, onClose } = {}) {
  const img = h('img', { src: dish.svg, alt: `${dish.en} (${dish.yue}), a dim sum dish`, width: '56', height: '56' })
  const body = h('div', { class: 'site-dimsum-toast__body' }, [
    h('span', {}, '🥟 A dim sum surprise —'),
    h('span', { class: 'site-dimsum-toast__names' }, [h('strong', {}, dish.en), ' · ' + dish.yue]),
  ])
  const children = [img, body]
  if (withCloseButton) {
    children.push(
      h('button', { type: 'button', class: 'site-dimsum-toast__close', 'aria-label': 'Dismiss', onClick: onClose }, '×'),
    )
  }
  return h('div', { class: 'site-dimsum-toast', role: 'status', 'aria-live': 'polite' }, children)
}

function showToast() {
  const dish = pickRandomDish()
  let timer = null
  const el = dishNode(dish, {
    withCloseButton: true,
    onClose: () => {
      if (timer) clearTimeout(timer)
      el.remove()
    },
  })
  document.body.appendChild(el)
  timer = setTimeout(() => el.remove(), AUTO_DISMISS_MS)
}

/** Called once, at page load, from features/index.js. Rolls the 10% chance
 * exactly once per load — never twice in one load, because this function
 * itself only ever runs once per load. */
export function maybeShowDimSumSurprise() {
  if (isSchoolModeEnabled()) return
  if (Math.random() >= 0.1) return
  // Defer slightly so it never competes with the very first paint.
  setTimeout(showToast, 400)
}

function buildPanel() {
  const wrap = h('div', { class: 'site-dimsum-panel' })

  function rebuild() {
    wrap.textContent = ''
    if (isSchoolModeEnabled()) {
      wrap.appendChild(h('p', {}, 'The dim sum surprise is not shown while School mode is on.'))
      return
    }
    wrap.appendChild(h('h3', {}, 'Dim sum surprise'))
    wrap.appendChild(
      h(
        'p',
        {},
        'A 10% chance, every time this page loads, of a small dish appearing in the corner. There is no setting to turn it off — this button just lets you peek at the full catalog whenever you like.',
      ),
    )
    const preview = h('div', { class: 'site-dimsum-panel__preview' })
    function showRandom() {
      preview.textContent = ''
      const dish = pickRandomDish()
      preview.appendChild(h('img', { src: dish.svg, alt: `${dish.en} (${dish.yue})`, width: '84', height: '84' }))
      preview.appendChild(h('div', {}, [h('strong', {}, dish.en), h('div', {}, dish.yue)]))
    }
    showRandom()
    wrap.appendChild(preview)
    wrap.appendChild(h('button', { type: 'button', class: 'site-dimsum-panel__btn', onClick: showRandom }, 'Show me another dish'))
    wrap.appendChild(h('p', {}, `${DISHES.length} dishes in the catalog, all original illustrations bundled with this site.`))
  }

  rebuild()
  subscribeSchoolState(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

export function registerDimSum(api) {
  maybeShowDimSumSurprise()

  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'dimsum', title: 'Dim sum surprise', icon: '🥟', group: 'settings', render: asMountable(buildPanel) })
  }
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      id: 'dimsum-show-another',
      title: 'Show me another dim sum dish',
      run: () => {
        if (isSchoolModeEnabled()) return
        showToast()
      },
    })
  }
}
