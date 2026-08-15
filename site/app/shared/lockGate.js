// site/app/shared/lockGate.js
//
// Wraps a panel builder so it can be individually locked from the Toy
// Locks panel (features/locks.js). A locked, not-yet-unlocked surface
// stays HONEST IN SEARCH — it is still reachable (the tab/setting is still
// registered under its real title), and opening it shows a plain unlock
// prompt rather than silently doing nothing or pretending the surface does
// not exist.

import { h, injectStyleOnce } from './dom.js'
import { isLocked, isUnlocked, markUnlocked, verifyLockPassword, subscribeLocks, subscribeUnlockState } from './locks-state.js'

injectStyleOnce(
  'site-lockgate-style',
  `
  .site-lockgate { display: flex; flex-direction: column; gap: 10px; }
  .site-lockgate__badge { font-size: 12px; opacity: 0.8; }
  .site-lockgate__field { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .site-lockgate__field input {
    height: var(--touch-target, 44px); border-radius: var(--md-shape-sm, 8px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container-low, #f5f1f8);
    color: var(--md-on-surface, #1c1b1f); padding: 0 10px; font: inherit;
  }
  .site-lockgate__btn {
    min-height: var(--touch-target, 44px); padding: 0 14px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit;
  }
  .site-lockgate__error { color: var(--md-error, #ba1a1a); font-size: 13px; }
  `,
)

/**
 * @param {string} id lock/surface id
 * @param {string} label human label shown in the unlock prompt
 * @param {() => Node} buildContent the real panel content builder
 * @returns {() => Node}
 */
export function guardPanel(id, label, buildContent) {
  return function build() {
    const wrap = h('div', { class: 'site-lockgate' })

    function render() {
      wrap.textContent = ''
      if (!isLocked(id) || isUnlocked(id)) {
        try {
          wrap.appendChild(buildContent())
        } catch (err) {
          console.warn('[nodeterm-site] locked panel content failed to build', id, err)
        }
        return
      }
      wrap.appendChild(h('div', { class: 'site-lockgate__badge' }, `🔒 "${label}" is locked (just for fun — not security).`))
      const input = h('input', { type: 'password', placeholder: 'Password', 'aria-label': `Unlock ${label}` })
      const error = h('div', { class: 'site-lockgate__error' })
      const unlockBtn = h(
        'button',
        {
          type: 'button',
          class: 'site-lockgate__btn',
          onClick: async () => {
            const ok = await verifyLockPassword(id, input.value)
            if (ok) {
              markUnlocked(id)
            } else {
              error.textContent = 'That password does not match.'
            }
          },
        },
        'Unlock',
      )
      wrap.appendChild(h('div', { class: 'site-lockgate__field' }, [input, unlockBtn]))
      wrap.appendChild(error)
      wrap.appendChild(
        h(
          'div',
          { class: 'site-lockgate__badge' },
          'Forgot it? Clearing this site’s browser storage removes every lock, along with every other setting.',
        ),
      )
    }

    render()
    const unsub1 = subscribeLocks(render)
    const unsub2 = subscribeUnlockState(render)
    // No teardown hook is guaranteed by the registry contract we were
    // given, so these subscriptions intentionally leak for the life of the
    // page rather than risk detaching too early — see docs/site-features.md.
    void unsub1
    void unsub2
    return wrap
  }
}
