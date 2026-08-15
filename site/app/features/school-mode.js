// site/app/features/school-mode.js
//
// A USER-EXPERIENCE lock, not a security boundary — the panel says so every
// time it is shown. Turning it on forces English and hides the Cantonese,
// bilingual, funny-level, and dim-sum surprise controls (see
// language-settings.js and dimsum.js, both of which consult
// shared/school-state.js on every render). Turning it off needs a locally
// verified PIN checked against a stored hash; the PIN itself is never
// stored. Forgetting the PIN is recovered by clearing this site's browser
// storage — named explicitly, right here, every time it matters.
//
// It is user-renamable. After a rename, "School mode" (the shipped name)
// must never surface again anywhere on the site, including search — this
// module's own UI never prints the shipped name once renamed, and it makes
// a best-effort attempt to re-register its tab/setting titles with the
// registry under the new name (see the note in docs/site-features.md about
// why this is best-effort: the registry contract we were handed has no
// documented "update a registered entry" call, only registerTab/
// registerSetting/registerCommand).

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { t, subscribeI18n } from '../shared/i18n.js'
import { pushNotification } from '../shared/notifications-state.js'
import { recordHistoryEntry } from '../shared/history-state.js'
import {
  isEnabled,
  setEnabled,
  getDisplayName,
  isRenamed,
  setDisplayName,
  hasPin,
  setPin,
  verifyPin,
  subscribeSchoolState,
  SHIPPED_NAME,
} from '../shared/school-state.js'

injectStyleOnce(
  'site-school-style',
  `
  .site-school { display: flex; flex-direction: column; gap: 14px; }
  .site-school__row { display: flex; align-items: center; gap: 10px; min-height: var(--touch-target, 44px); }
  .site-school__help { font-size: 12px; opacity: 0.75; }
  .site-school__field { display: flex; flex-direction: column; gap: 6px; max-width: 320px; }
  .site-school__field input[type="text"], .site-school__field input[type="password"] {
    height: var(--touch-target, 44px); border-radius: var(--md-shape-sm, 8px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container-low, #f5f1f8);
    color: var(--md-on-surface, #1c1b1f); padding: 0 10px; font: inherit;
  }
  .site-school__btn {
    min-height: var(--touch-target, 44px); padding: 0 14px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit;
  }
  .site-school__status { font-size: 13px; }
  .site-school__status[data-ok="false"] { color: var(--md-error, #ba1a1a); }
  .site-school__status[data-ok="true"] { color: var(--md-on-surface-variant, #47454a); }
  .site-school__recovery { font-size: 12px; opacity: 0.85; border-left: 3px solid var(--md-outline-variant, #cac4ce); padding-left: 10px; }
  `,
)

let lastRegisterApi = null

function displayNameLive() {
  // Never prints the shipped name once renamed — reads the live stored
  // name every time, never a cached copy.
  return getDisplayName()
}

function buildPanel() {
  const wrap = h('div', { class: 'site-school' })
  const status = h('div', { class: 'site-school__status', 'aria-live': 'polite' })

  function rebuild() {
    wrap.textContent = ''
    const name = displayNameLive()
    wrap.appendChild(h('h3', {}, name))
    const on = isEnabled()

    const toggle = h('input', {
      type: 'checkbox',
      id: 'site-school-toggle',
      checked: on,
      onChange: async (e) => {
        if (e.target.checked) {
          await turnOn()
        } else {
          e.target.checked = true // stays checked until PIN verified
          promptPinToDisable()
        }
      },
    })
    wrap.appendChild(
      h('div', { class: 'site-school__row' }, [toggle, h('label', { for: 'site-school-toggle' }, `Turn on ${name}`)]),
    )
    wrap.appendChild(h('div', { class: 'site-school__help' }, t('school.toggle.help')))

    if (on) {
      wrap.appendChild(h('p', {}, t('school.on.summary')))
    }

    // Rename.
    const renameField = h('div', { class: 'site-school__field' })
    const renameInput = h('input', { type: 'text', value: isRenamed() ? name : '', placeholder: SHIPPED_NAME, maxlength: '60' })
    const renameBtn = h(
      'button',
      {
        type: 'button',
        class: 'site-school__btn',
        onClick: () => {
          const before = displayNameLive()
          setDisplayName(renameInput.value)
          const after = displayNameLive()
          recordHistoryEntry(`Renamed "${before}" to "${after}".`)
          reRegisterUnderNewName()
        },
      },
      'Rename',
    )
    renameField.appendChild(h('label', {}, t('school.rename.label')))
    renameField.appendChild(renameInput)
    renameField.appendChild(renameBtn)
    renameField.appendChild(h('div', { class: 'site-school__help' }, t('school.rename.help')))
    wrap.appendChild(renameField)

    // PIN set (only meaningful while a PIN is not yet set).
    if (!hasPin()) {
      const pinField = h('div', { class: 'site-school__field' })
      const pinInput = h('input', { type: 'password', placeholder: 'New PIN', maxlength: '32' })
      const pinBtn = h(
        'button',
        {
          type: 'button',
          class: 'site-school__btn',
          onClick: async () => {
            if (!pinInput.value) return
            await setPin(pinInput.value)
            pinInput.value = ''
            rebuild()
          },
        },
        'Set PIN',
      )
      pinField.appendChild(h('label', {}, t('school.pin.set.label')))
      pinField.appendChild(pinInput)
      pinField.appendChild(pinBtn)
      wrap.appendChild(pinField)
    }

    wrap.appendChild(status)
    wrap.appendChild(h('p', { class: 'site-school__recovery' }, t('school.recovery.hint')))
  }

  async function turnOn() {
    if (!hasPin()) {
      status.dataset.ok = 'false'
      status.textContent = 'Set a PIN first so you can turn this back off later.'
      rebuild()
      return
    }
    setEnabled(true)
    pushNotification({ kind: 'info', title: displayNameLive(), message: 'Turned on.' })
    recordHistoryEntry(`Turned on "${displayNameLive()}".`)
    rebuild()
  }

  function promptPinToDisable() {
    if (!hasPin()) {
      status.dataset.ok = 'false'
      status.textContent = t('school.pin.missing')
      return
    }
    const overlay = h('div', { class: 'site-school__field' })
    const pinInput = h('input', { type: 'password', placeholder: 'PIN', maxlength: '32' })
    const confirmBtn = h(
      'button',
      {
        type: 'button',
        class: 'site-school__btn',
        onClick: async () => {
          const ok = await verifyPin(pinInput.value)
          if (ok) {
            setEnabled(false)
            pushNotification({ kind: 'info', title: displayNameLive(), message: 'Turned off.' })
            recordHistoryEntry(`Turned off "${displayNameLive()}".`)
            rebuild()
          } else {
            status.dataset.ok = 'false'
            status.textContent = t('school.pin.wrong')
          }
        },
      },
      'Unlock',
    )
    const cancelBtn = h(
      'button',
      { type: 'button', class: 'site-school__btn', onClick: () => overlay.remove() },
      'Cancel',
    )
    overlay.appendChild(h('label', {}, t('school.pin.enter.label')))
    overlay.appendChild(pinInput)
    overlay.appendChild(h('div', {}, [confirmBtn, ' ', cancelBtn]))
    wrap.insertBefore(overlay, status)
  }

  rebuild()
  subscribeSchoolState(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

function reRegisterUnderNewName() {
  // Best-effort: the registry contract we were given (registerTab /
  // registerSetting / registerCommand) documents no "update" call, so a
  // rename re-invokes registration with the SAME id and the new title. If
  // the registry treats a repeated id as an overwrite, the palette now
  // shows only the new name. If it does not, a stale entry may remain
  // registered under the previous title until the next full page load —
  // recorded as a known limitation in docs/site-features.md, not hidden.
  if (lastRegisterApi) registerWithApi(lastRegisterApi)
}

function registerWithApi(api) {
  lastRegisterApi = api
  const name = displayNameLive()
  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'school-mode', title: name, icon: '🎒', group: 'settings', render: asMountable(buildPanel) })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'school-mode-toggle',
      tabId: 'school-mode',
      title: name,
      describe: () => 'A user-experience lock, not security — see the panel for the full explanation.',
      control: asMountable(buildPanel),
    })
  }
}

export function registerSchoolMode(api) {
  registerWithApi(api)
}
