// site/app/features/changelog.js
//
// The changelog viewer. Reads site/content/changelog.json, which is
// GENERATED from the repository's real CHANGELOG.md (see the generator
// note at the top of that JSON file) — this module never invents an entry
// or a date. Each entry links its full commit SHA. A date-range filter and
// a text search (wired to the shared anchored regex builder) COMPOSE
// rather than override each other, and export honors whichever filter is
// currently active.
//
// BASE-PATH SAFETY: the JSON is fetched via `new URL('../../content/
// changelog.json', import.meta.url)` rather than a path relative to the
// document, so it resolves correctly regardless of the site's deployed
// base path (this fork publishes under /material-nodeterm/, not at a
// domain root).
//
// Date range uses the browser's native <input type="date"> pair, which
// already provides an anchored calendar popover with month/year
// navigation, and accepts both locale-formatted and typed ISO input
// natively — this module adds range presets and composes it with the text
// search on top, rather than building a bespoke calendar widget from
// scratch. See docs/site-features.md for why this choice was made under
// the ultra-speed constraint for this pass.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { t, subscribeI18n } from '../shared/i18n.js'
import { createSearchWithRegex } from '../shared/regexBuilder.js'
import { EXPORT_FORMATS, downloadFile } from '../shared/exportFormats.js'

injectStyleOnce(
  'site-changelog-style',
  `
  .site-changelog { display: flex; flex-direction: column; gap: 14px; }
  .site-changelog__filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .site-changelog__filters input[type="date"] {
    height: var(--touch-target, 44px); border-radius: var(--md-shape-sm, 8px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container-low, #f5f1f8);
    color: var(--md-on-surface, #1c1b1f); padding: 0 8px; font: inherit;
  }
  .site-changelog__presets button, .site-changelog__export button {
    min-height: var(--touch-target, 44px); padding: 0 10px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit; margin-right: 6px;
  }
  .site-changelog__entry {
    border: 1px solid var(--md-outline-variant, #cac4ce); border-radius: var(--md-shape-md, 12px); padding: 12px;
  }
  .site-changelog__entry h4 { margin: 0 0 4px; }
  .site-changelog__entry small { opacity: 0.7; }
  .site-changelog__cat { margin: 6px 0 0; }
  .site-changelog__cat strong { font-size: 12px; text-transform: uppercase; opacity: 0.7; }
  .site-changelog__invalid { font-size: 12px; color: var(--md-error, #ba1a1a); }
  `,
)

function dataUrl() {
  return new URL('../../content/changelog.json', import.meta.url)
}

async function loadChangelog() {
  try {
    const res = await fetch(dataUrl())
    if (!res.ok) return { entries: [] }
    const json = await res.json()
    return json && Array.isArray(json.entries) ? json : { entries: [] }
  } catch (err) {
    console.warn('[nodeterm-site] could not load changelog.json', err)
    return { entries: [] }
  }
}

function inRange(entry, startStr, endStr) {
  if (!startStr && !endStr) return true
  const d = entry.date
  if (startStr && d < startStr) return false
  if (endStr && d > endStr) return false
  return true
}

function buildPanel() {
  const wrap = h('div', { class: 'site-changelog' })
  let allEntries = []
  let startInput, endInput, invalidNote
  let predicate = () => true
  let filtered = []

  function applyFilters() {
    const startVal = startInput && startInput.value
    const endVal = endInput && endInput.value
    let ok = true
    if (startVal && endVal && startVal > endVal) {
      ok = false
    }
    invalidNote.textContent = ok ? '' : 'Start date is after end date — showing no results until fixed.'
    filtered = ok
      ? allEntries.filter((e) => inRange(e, startVal, endVal) && predicate(entryText(e)))
      : []
    renderList()
  }

  function entryText(e) {
    const cats = Object.entries(e.categories || {})
      .map(([cat, items]) => cat + ' ' + items.join(' '))
      .join(' ')
    return `${e.version} ${e.date} ${e.commit} ${cats}`
  }

  const listEl = h('div', { class: 'site-changelog__list' })

  function renderList() {
    listEl.textContent = ''
    if (filtered.length === 0) {
      listEl.appendChild(h('p', {}, t('changelog.empty')))
      return
    }
    for (const entry of filtered) {
      const cats = Object.entries(entry.categories || {}).map(([cat, items]) =>
        h('div', { class: 'site-changelog__cat' }, [h('strong', {}, cat), h('ul', {}, items.map((i) => h('li', {}, i)))]),
      )
      listEl.appendChild(
        h('article', { class: 'site-changelog__entry' }, [
          h('h4', {}, `v${entry.version} — ${entry.date}`),
          h('small', {}, [
            'Commit: ',
            h('a', { href: entry.commitUrl, target: '_blank', rel: 'noopener' }, entry.commit.slice(0, 12)),
          ]),
          ...cats,
        ]),
      )
    }
  }

  const search = createSearchWithRegex({
    placeholder: 'Search changelog…',
    ariaLabel: 'Search changelog',
    onChange: (pred) => {
      predicate = pred
      applyFilters()
    },
  })

  function setRangeDaysAgo(days) {
    const end = new Date()
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
    startInput.value = start.toISOString().slice(0, 10)
    endInput.value = end.toISOString().slice(0, 10)
    applyFilters()
  }

  async function rebuildStatic() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, t('changelog.section.title')))

    startInput = h('input', { type: 'date', 'aria-label': 'From date', onChange: applyFilters })
    endInput = h('input', { type: 'date', 'aria-label': 'To date', onChange: applyFilters })
    invalidNote = h('div', { class: 'site-changelog__invalid' })

    const presets = h('div', { class: 'site-changelog__presets' }, [
      h('button', { type: 'button', onClick: () => setRangeDaysAgo(30) }, 'Last 30 days'),
      h('button', { type: 'button', onClick: () => setRangeDaysAgo(90) }, 'Last 90 days'),
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            startInput.value = ''
            endInput.value = ''
            applyFilters()
          },
        },
        'All time',
      ),
    ])

    wrap.appendChild(
      h('div', { class: 'site-changelog__filters' }, [
        h('label', {}, ['From ', startInput]),
        h('label', {}, ['To ', endInput]),
        presets,
      ]),
    )
    wrap.appendChild(invalidNote)
    wrap.appendChild(search.root)

    const exportRow = h(
      'div',
      { class: 'site-changelog__export' },
      EXPORT_FORMATS.filter((f) => !f.lossy || f.id === 'markdown' || f.id === 'html').map((fmt) =>
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              const flat = filtered.map((e) => ({
                version: e.version,
                date: e.date,
                commit: e.commit,
                commitUrl: e.commitUrl,
                changes: Object.entries(e.categories || {})
                  .map(([c, items]) => `${c}: ${items.join('; ')}`)
                  .join(' | '),
              }))
              downloadFile(`nodeterm-changelog.${fmt.ext}`, fmt.encode(flat), fmt.mime)
            },
          },
          'Export ' + fmt.label,
        ),
      ),
    )
    wrap.appendChild(exportRow)
    wrap.appendChild(listEl)

    const data = await loadChangelog()
    allEntries = data.entries
    applyFilters()
  }

  rebuildStatic()
  subscribeI18n(() => renderList())
  return wrap
}

export function registerChangelog(api) {
  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'changelog', title: 'Changelog', icon: '📝', group: 'app', render: asMountable(buildPanel) })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'changelog-viewer',
      tabId: 'changelog',
      title: 'Changelog',
      describe: () => 'Every release, generated from the real CHANGELOG.md, with a date filter and search.',
      control: asMountable(buildPanel),
    })
  }
}
