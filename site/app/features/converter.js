// site/app/features/converter.js
//
// The "Turn-it-into" lab room: paste text in one of nine recognised
// shapes, pick an output shape, convert — entirely client-side (see
// app/shared/convert.js and app/shared/exportFormats.js). Formats that
// cannot round-trip everything still appear in the list, not hidden, with
// an honest note about what would be lost.

import { registerRoom } from '../core/engine.js'
import { CONV_IN, CONV_OUT, FORMATS } from '../shared/data.js'
import { parseRecords, detectShape } from '../shared/convert.js'
import { emit } from '../shared/exportFormats.js'
import { esc, attr } from '../core/dom.js'

export function registerConverter(store, deps, registerAction, registerBinding) {
  registerBinding('conv-from', (s, id, value) => store.setState({ convFrom: value }, { persist: false }))
  registerBinding('conv-to', (s, id, value) => store.setState({ convTo: value }, { persist: false }))
  registerBinding('conv-in', (s, id, value) => store.setState({ convIn: value }, { persist: false }))
  registerAction('conv-run', (s, id, el, h) => {
    const state = s.state
    try {
      const recs = parseRecords(state.convIn, state.convFrom)
      const out = emit(recs, state.convTo)
      const lossy = (FORMATS.find((f) => f.id === state.convTo) || {}).loss
      store.setState({ convOut: out, convBad: false, convNote: recs.length + ' row(s) converted.' + (lossy ? ' Heads up: ' + lossy : ' Nothing was lost on the way.') }, { persist: false })
      h.log('Converted ' + state.convFrom + ' → ' + state.convTo)
    } catch (err) {
      store.setState({ convBad: true, convNote: 'That did not read as ' + state.convFrom + ': ' + err.message, convOut: '' }, { persist: false })
    }
  })
  registerAction('conv-detect', (s) => {
    const guess = detectShape(s.state.convIn)
    store.setState({ convFrom: guess, convNote: 'Those bytes look like ' + guess + '. Change it if the guess is wrong.' }, { persist: false })
  })
  registerAction('conv-clear', () => store.setState({ convIn: '', convOut: '', convNote: 'Cleared. Paste something new.', convBad: false }, { persist: false }))
  registerAction('conv-copy', (s, id, el, h) => h.copy(s.state.convOut))
  registerAction('conv-download', (s, id, el, h) => h.download('converted.' + s.state.convTo, s.state.convOut || ''))

  registerRoom('convert', {
    render: (storeArg) => renderConverter(storeArg.state),
  })
}

function renderConverter(s) {
  return `<div class="two-col" style="animation:pop .2s ease">
    <div class="card">
      <div class="field-row">
        <label>Turn this…
          <select data-bind-select="conv-from" data-id="_">
            ${CONV_IN.map((o) => `<option value="${attr(o.id)}" ${o.id === s.convFrom ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>
        <label>…into this
          <select data-bind-select="conv-to" data-id="_">
            ${CONV_OUT.map((o) => `<option value="${attr(o.id)}" ${o.id === s.convTo ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <textarea class="mono-area" data-bind-text="conv-in" data-id="_" data-focus-id="conv-in" spellcheck="false" aria-label="Text to convert" placeholder="Paste something here…">${esc(s.convIn)}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn" style="background:var(--green);height:48px;font-size:16px" data-action="conv-run">✨ Convert</button>
        <button type="button" class="btn-plain" data-action="conv-detect">Guess the type</button>
        <button type="button" class="btn-plain" data-action="conv-clear">Wipe</button>
      </div>
      <div class="note-box ${s.convBad ? 'is-bad' : ''}">${esc(s.convNote)}</div>
    </div>
    <div class="card" style="display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <strong style="font-family:var(--fun);font-size:18px">Out it comes</strong>
        <div class="spacer"></div>
        <button type="button" class="btn-plain" style="background:var(--blue)" data-action="conv-copy">Copy</button>
        <button type="button" class="btn-plain" style="background:var(--yellow)" data-action="conv-download">Save</button>
      </div>
      <textarea class="mono-area" readonly aria-label="Converted result" style="flex:1">${esc(s.convOut)}</textarea>
      <p style="margin:10px 0 0;font-size:12.5px;color:var(--ink2);line-height:1.6">Everything happens right here in your browser. Nothing is sent anywhere. Formats we can't do yet still show up in the list, greyed out, so you know they exist.</p>
    </div>
  </div>`
}
