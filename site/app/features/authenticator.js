// site/app/features/authenticator.js
//
// The "Code maker" room: a built-in TOTP authenticator (RFC 6238). Pair a
// name with a base32 secret and this room computes a live six-digit code
// from it, refreshed every second, entirely inside this page — the secret
// is kept only in this browser's localStorage and is never sent anywhere.
// See app/shared/crypto.js for the HMAC-SHA1 + base32 implementation.

import { registerListRoom, totpSecondsLeft } from '../core/engine.js'
import { b32decode } from '../shared/crypto.js'
import { attr } from '../core/dom.js'

export function registerAuthenticator(store, deps, registerAction, registerBinding) {
  registerBinding('auth-add-a', (s, id, value) => store.setState({ addA: value }, { persist: false }))
  registerBinding('auth-add-b', (s, id, value) => store.setState({ addB: value }, { persist: false }))
  registerAction('auth-add-run', (s, id, el, h) => {
    const label = String(s.state.addA || '').trim()
    const secret = String(s.state.addB || '').trim()
    if (!label || !secret) {
      h.toast('✋', 'Two things needed', 'A name, and the secret it gave you.')
      return
    }
    if (b32decode(secret).length < 10) {
      h.toast('❌', 'That secret looks wrong', 'It should be letters A to Z and digits 2 to 7, at least sixteen of them.')
      return
    }
    h.save({ auth: s.state.auth.concat([{ id: 'a' + Date.now(), label, secret }]), addA: '', addB: '' }, 'Added the code “' + label + '”')
    h.notify('A new code was paired', '“' + label + '” now makes a fresh six-digit code every thirty seconds, entirely inside this page.', 'code')
    h.toast('🔐', 'Paired', 'Watch it change every thirty seconds.')
    setTimeout(h.refreshCodes, 50)
  })

  registerListRoom('auth', {
    getRows: (s) =>
      s.auth.map((a) => ({
        id: a.id,
        title: a.label,
        body: 'Changes every 30 seconds. Tap to pick it, right-click to copy or remove it.',
        tag: 'code',
        meta: totpSecondsLeft() + 's left',
        right: s.codes[a.id] || '······',
      })),
    emptyText: 'No codes yet — add one below.',
    footnote: () => 'Codes are worked out in this page from the secret you typed. The secret is kept in this browser and never sent anywhere — which also means clearing storage loses it, so keep your original backup.',
    remove: (store2, ids) => {
      const set = new Set(ids)
      store2.setState({ auth: store2.state.auth.filter((a) => !set.has(a.id)), picked: {} })
    },
    addRow: (store2) => {
      const s = store2.state
      return `<div class="add-row">
        <input data-bind-text="auth-add-a" data-id="_" data-focus-id="auth-add-a" value="${attr(s.addA)}" placeholder="What is it for? e.g. My game account" aria-label="What is it for" />
        <input data-bind-text="auth-add-b" data-id="_" data-focus-id="auth-add-b" value="${attr(s.addB)}" placeholder="The secret it gave you (letters A–Z and 2–7)" aria-label="Its secret" />
        <button type="button" class="btn-set" data-action="auth-add-run">➕ Add this code</button>
      </div>`
    },
  })
}
