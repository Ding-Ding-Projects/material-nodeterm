// site/app/features/exports.js
//
// The "Take it home" room: pick a pile of the page's own data, pick one of
// ten shapes, and download it — with an explicit warning (and a second
// confirming click) before saving into a shape that would lose a field.
// Every list room's "Take this list home" menu action also lands here.

import { registerRoom } from '../core/engine.js'
import { EXPORT_FORMATS, emit } from '../shared/exportFormats.js'
import { COVERAGE } from '../shared/data.js'
import { esc, attr } from '../core/dom.js'

export function datasetRecords(store, id) {
  const s = store.state
  if (id === 'notes') return s.notes.map((n) => ({ title: n.title, body: n.body, titleKind: n.titleKind || 'authored', bodyKind: n.bodyKind || 'authored', tag: n.tag, when: n.when }))
  if (id === 'history') return s.history.map((h) => ({ title: h.title, body: h.body, when: h.when }))
  if (id === 'coverage') return COVERAGE.map((c) => ({ promise: c[0], where: c[1], state: c[2] }))
  return [
    { setting: 'theme', value: s.theme }, { setting: 'language', value: s.lang },
    { setting: 'silliness (English)', value: s.funnyEn }, { setting: 'silliness (Cantonese)', value: s.funnyYue },
    { setting: 'emoji', value: s.emoji }, { setting: 'bigger text', value: s.bigText },
    { setting: 'sounds', value: s.sound }, { setting: 'favourite colour', value: s.accent },
    { setting: 'nickname', value: s.nick }, { setting: 'school mode', value: s.school },
    { setting: 'narrator', value: s.narrate }, { setting: 'timer', value: s.schedOn ? s.schedTime + ' → ' + s.schedTheme : 'off' },
  ]
}

export function registerExports(store, deps, registerAction, registerBinding) {
  registerAction('export-pick-dataset', (s, id, el, h) => store.setState({ dataset: id, lossPending: null, lossNote: 'Now showing this pile. Pick a shape.' }, { persist: false }))
  registerAction('export-format', (s, id, el, h) => {
    const format = EXPORT_FORMATS.find((f) => f.id === id)
    if (!format) return
    if (format.loss) {
      store.setState({ lossPending: format.id, lossNote: '⚠️ ' + format.loss, lossBad: true }, { persist: false })
    } else {
      h.download('nodeterm-' + s.state.dataset + '.' + format.id, emit(datasetRecords(store, s.state.dataset), format.id))
      store.setState({ lossPending: null, lossNote: 'Saved as ' + format.label + '. That shape carries every single field.', lossBad: false }, { persist: false })
    }
  })
  registerAction('export-loss-confirm', (s, id, el, h) => {
    const format = EXPORT_FORMATS.find((f) => f.id === s.state.lossPending)
    if (!format) return
    h.download('nodeterm-' + s.state.dataset + '.' + format.id, emit(datasetRecords(store, s.state.dataset), format.id))
    store.setState({ lossPending: null, lossNote: 'Saved as ' + format.label + ', with the loss above accepted.', lossBad: false }, { persist: false })
  })
  registerAction('export-loss-cancel', () => store.setState({ lossPending: null, lossNote: 'Nothing was saved. Pick a green shape to keep every field.', lossBad: false }, { persist: false }))

  registerRoom('export', { render: (storeArg) => renderExport(storeArg, deps) })
}

function renderExport(store, deps) {
  const s = store.state
  const datasets = [
    ['settings', 'My settings'], ['notes', 'My messages'], ['history', 'My time machine'], ['coverage', 'The big checklist'],
  ]
  const preview = (() => {
    try {
      return emit(datasetRecords(store, s.dataset), s.lossPending || 'json').slice(0, 4000)
    } catch (_err) {
      return ''
    }
  })()
  return `<div class="export-grid" style="animation:pop .2s ease">
    <div class="card">
      <h3 style="margin-bottom:10px;font-size:19px">1 · Pick your pile</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${datasets
          .map(
            ([id, label]) =>
              `<button type="button" class="dataset-btn ${s.dataset === id ? 'is-active' : ''}" data-action="export-pick-dataset" data-id="${attr(id)}"><span style="flex:1;text-align:left;font-weight:700">${esc(label)}</span><span style="font-size:12px;color:var(--ink2)">${datasetRecords(store, id).length} rows</span></button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:10px;font-size:19px">2 · Pick a shape</h3>
      <div class="format-grid">
        ${EXPORT_FORMATS.map((f) => `<button type="button" class="format-btn ${f.loss ? 'is-lossy' : ''}" title="${attr(f.loss ? 'Heads up: ' + f.loss : 'Carries every field faithfully')}" data-action="export-format" data-id="${attr(f.id)}">${esc(f.label)}</button>`).join('')}
      </div>
      <div class="note-box ${s.lossBad ? 'is-bad' : ''}">${esc(s.lossNote)}</div>
      ${
        s.lossPending
          ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn" style="background:var(--orange)" data-action="export-loss-confirm">Save it anyway</button>
        <button type="button" class="btn-plain" data-action="export-loss-cancel">Never mind</button>
      </div>`
          : ''
      }
    </div>
    <div class="card" style="grid-column:1/-1">
      <h3 style="margin-bottom:10px;font-size:19px">3 · Have a look first 👀</h3>
      <pre class="export-preview">${esc(preview)}</pre>
    </div>
  </div>`
}
