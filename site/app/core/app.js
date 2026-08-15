// site/app/core/app.js
//
// Boots the site shell: applies the theme, mounts notifications, wires
// the tab strip and the command palette, registers the built-in
// "Settings" tab and a handful of built-in commands, and wires the
// header's theme toggle to the shared theme store. This file owns
// nothing content-specific — that's site/app/features/** (see the
// registry contract in registry.js).

import { registerTab, registerCommand } from './registry.js'
import * as theme from './theme.js'
import { renderSettingsSurface } from './settings.js'
import * as tabs from './tabs.js'
import * as palette from './palette.js'
import * as notifications from './notifications.js'
import { openConfirmGate } from './confirm.js'
import { clearAll } from './storage.js'

function boot() {
  theme.applyTheme()

  registerTab({
    id: 'settings',
    title: 'Settings',
    icon: '⚙️',
    order: 100,
    render: renderSettingsSurface,
  })

  registerCommand({
    id: 'toggle-theme',
    title: 'Toggle light / dark theme',
    hint: 'Appearance',
    run: () => theme.toggleLightDark(),
  })
  registerCommand({
    id: 'open-appearance-editor',
    title: 'Open appearance editor (accent color)',
    hint: 'Appearance',
    run: () => theme.openAppearanceEditor(document.getElementById('theme-toggle')),
  })
  registerCommand({
    id: 'clear-local-data',
    title: 'Clear local site data…',
    hint: 'Destructive — Data & privacy',
    run: () => {
      tabs.showTab('settings')
      requestAnimationFrame(() => {
        const btn = document.getElementById('setting-clear-local-data')?.querySelector('button')
        if (btn) {
          openConfirmGate({
            anchor: btn,
            title: 'Clear all local site data',
            description:
              'This permanently erases every setting, the tab layout and pinned tabs, the appearance customization, the notification history, and the settings version history stored by this page — all of it, in this browser only. This cannot be undone.',
            confirmLabel: 'Erase everything',
            onConfirm: () => {
              clearAll()
              notifications.notify({ kind: 'warning', title: 'Local site data cleared', body: 'Reload the page to see the defaults.' })
            },
          })
        }
      })
    },
  })

  const railWrap = document.getElementById('tab-rail-wrap')
  const rail = document.getElementById('tab-rail')
  const search = document.getElementById('tab-rail-search')
  const panels = document.getElementById('main')
  tabs.init({ rail, panels, search })

  const notifRoot = document.getElementById('notification-root')
  if (notifRoot) notifications.mount(notifRoot)

  const paletteRoot = document.getElementById('command-palette-root')
  if (paletteRoot) palette.mount(paletteRoot)

  const themeToggle = document.getElementById('theme-toggle')
  if (themeToggle) {
    themeToggle.addEventListener('click', () => theme.toggleLightDark())
  }
  const accentBtn = document.getElementById('open-appearance')
  if (accentBtn) {
    accentBtn.addEventListener('click', () => theme.openAppearanceEditor(accentBtn))
  }

  window.addEventListener('storage', (e) => {
    // Another tab of this same site changed a stored value — re-apply the
    // theme so both tabs stay visually consistent. Everything else
    // re-reads on its own next render, which is cheap enough not to wire
    // a full cross-tab sync for a static site.
    if (e.key && e.key.includes('nodeterm-site.theme')) theme.applyTheme()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
