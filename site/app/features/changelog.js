// site/app/features/changelog.js
//
// The "What changed" room. DIVERGENCE FROM THE IMPORTED DESIGN, deliberate
// and reported: the design's own component.js embeds a tiny 5-entry
// CHANGELOG sample table. This room ignores that sample and reads the
// real, generated site/content/changelog.json instead (20 real entries
// with real commit SHAs, generated from this project's own CHANGELOG.md) —
// real project history beats a placeholder sample. Every entry's "open on
// GitHub" link is repointed to this fork's commit history.

import { registerListRoom, fmtWhen } from '../core/engine.js'
import { REPO_URL } from '../shared/data.js'

let entries = []

async function loadChangelog() {
  try {
    const res = await fetch('./content/changelog.json', { cache: 'no-cache' })
    if (!res.ok) return
    const json = await res.json()
    entries = Array.isArray(json.entries) ? json.entries : []
  } catch (_err) {
    entries = []
  }
}

function flatRows() {
  return entries.map((c) => {
    const kinds = Object.keys(c.categories || {})
    const notes = kinds.map((k) => (c.categories[k] || []).map((n) => k + ': ' + n).join('\n')).join('\n')
    const commit = String(c.commit || '').slice(0, 7)
    return {
      id: 'cl' + c.version,
      title: 'v' + c.version,
      body: notes,
      tag: kinds[0] || '',
      meta: c.date,
      right: commit,
      url: REPO_URL + '/commit/' + (c.commit || ''),
      _date: c.date,
    }
  })
}

export function registerChangelog(store, deps, registerAction, registerBinding) {
  loadChangelog().then(() => store.setState({}, { persist: false }))

  registerListRoom('changelog', {
    hasDateFilter: true,
    getRows: (s) => {
      const from = s.dateFrom ? new Date(s.dateFrom) : null
      const to = s.dateTo ? new Date(s.dateTo + 'T23:59:59') : null
      return flatRows().filter((r) => {
        const d = new Date(r._date)
        if (from && d < from) return false
        if (to && d > to) return false
        return true
      })
    },
    emptyText: 'No release in that window.',
    footnote: () => `${entries.length} releases loaded from content/changelog.json, generated from this fork's real CHANGELOG.md. Click a row to pick it. Right-click any row for “Open this on GitHub”.`,
  })
}

export { fmtWhen }
