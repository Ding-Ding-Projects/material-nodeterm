// site/app/core/regexBuilder.js
//
// attachAnchoredSearch(inputEl, opts) wires ANY <input> into a full
// regex-builder popover anchored directly beside it — never a shared
// builder detached from the field, and never a reduced toggle. Plain text
// stays the default; regex is an explicit opt-in via the ".*" button this
// creates next to the field. Every search field, dropdown filter, and
// right-click menu filter on this site goes through this one function so
// they can never drift out of sync with each other.

import { compileSafe, safeTestMatches } from './regex.js'

let uid = 0

/**
 * attachAnchoredSearch(inputEl, opts)
 *
 *   opts.getSample()             optional; sample text used for live
 *                                 match-count feedback while building a
 *                                 pattern
 *   opts.onChange({query, isRegex, flags, regex})
 *                                 called whenever the effective query
 *                                 changes, in EITHER mode
 *
 * Returns { close(), getState() }.
 */
export function attachAnchoredSearch(inputEl, opts = {}) {
  const id = `rxb-${++uid}`

  const wrap = document.createElement('span')
  wrap.className = 'anchored-search'
  inputEl.insertAdjacentElement('beforebegin', wrap)
  wrap.appendChild(inputEl)
  inputEl.classList.add('anchored-search__input')
  inputEl.dataset.searchMode = 'plain'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'anchored-search__toggle'
  toggle.setAttribute('aria-haspopup', 'dialog')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', id)
  toggle.title = 'Regex builder — build and test a pattern for this field'
  toggle.textContent = '.*'
  wrap.appendChild(toggle)

  const popover = document.createElement('div')
  popover.className = 'anchored-search__popover'
  popover.id = id
  popover.hidden = true
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', 'Regex builder')
  wrap.appendChild(popover)

  const state = { mode: 'plain', pattern: '', flags: 'gi' }

  function emit() {
    inputEl.dataset.searchMode = state.mode
    if (state.mode === 'regex') {
      const { ok, regex } = compileSafe(state.pattern, state.flags)
      if (typeof opts.onChange === 'function') {
        opts.onChange({ query: state.pattern, isRegex: true, flags: state.flags, regex: ok ? regex : null })
      }
    } else if (typeof opts.onChange === 'function') {
      opts.onChange({ query: inputEl.value, isRegex: false, flags: '', regex: null })
    }
  }

  function buildPopover() {
    popover.innerHTML = ''

    const modeRow = document.createElement('div')
    modeRow.className = 'anchored-search__mode'
    modeRow.innerHTML = `
      <label><input type="radio" name="${id}-mode" value="plain" ${state.mode === 'plain' ? 'checked' : ''}/> Plain text</label>
      <label><input type="radio" name="${id}-mode" value="regex" ${state.mode === 'regex' ? 'checked' : ''}/> Regex</label>
    `
    popover.appendChild(modeRow)

    const patternInput = document.createElement('input')
    patternInput.type = 'text'
    patternInput.placeholder = 'Pattern, e.g. ^foo|bar$'
    patternInput.value = state.pattern
    patternInput.className = 'anchored-search__pattern'
    patternInput.setAttribute('aria-label', 'Regex pattern')
    popover.appendChild(patternInput)

    const flagsRow = document.createElement('div')
    flagsRow.className = 'anchored-search__flags'
    ;[
      ['i', 'ignore case'],
      ['g', 'global'],
      ['m', 'multiline'],
      ['s', 'dot-all'],
      ['u', 'unicode'],
    ].forEach(([f, label]) => {
      const l = document.createElement('label')
      l.innerHTML = `<input type="checkbox" value="${f}" ${state.flags.includes(f) ? 'checked' : ''}/> ${f} — ${label}`
      flagsRow.appendChild(l)
    })
    popover.appendChild(flagsRow)

    const feedback = document.createElement('div')
    feedback.className = 'anchored-search__feedback'
    feedback.setAttribute('aria-live', 'polite')
    popover.appendChild(feedback)

    function refresh() {
      state.flags = [...flagsRow.querySelectorAll('input:checked')].map((i) => i.value).join('')
      state.pattern = patternInput.value
      if (state.mode !== 'regex') {
        feedback.textContent = ''
        feedback.classList.remove('is-error')
        return
      }
      const { ok, regex, error } = compileSafe(state.pattern, state.flags)
      if (!ok) {
        feedback.textContent = error
        feedback.classList.add('is-error')
        return
      }
      feedback.classList.remove('is-error')
      const sample = typeof opts.getSample === 'function' ? opts.getSample() : ''
      if (sample) {
        const { matches, truncated } = safeTestMatches(regex, sample)
        feedback.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}${truncated ? ' (truncated at the evaluation limit)' : ''}`
      } else {
        feedback.textContent = 'Pattern is valid.'
      }
    }

    modeRow.addEventListener('change', () => {
      state.mode = popover.querySelector(`input[name="${id}-mode"]:checked`).value
      refresh()
      emit()
    })
    patternInput.addEventListener('input', () => {
      refresh()
      emit()
    })
    flagsRow.addEventListener('change', () => {
      refresh()
      emit()
    })

    const footer = document.createElement('div')
    footer.className = 'anchored-search__footer'
    const applyBtn = document.createElement('button')
    applyBtn.type = 'button'
    applyBtn.className = 'btn btn-secondary btn-sm'
    applyBtn.textContent = 'Apply'
    applyBtn.addEventListener('click', () => {
      if (state.mode === 'regex') inputEl.value = state.pattern
      emit()
      closePopover()
      inputEl.focus()
    })
    footer.appendChild(applyBtn)
    popover.appendChild(footer)

    refresh()
  }

  function openPopover() {
    buildPopover()
    popover.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    const first = popover.querySelector('input')
    if (first) first.focus()
    document.addEventListener('keydown', onKeydown, true)
    document.addEventListener('click', onOutsideClick, true)
  }
  function closePopover() {
    popover.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    document.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('click', onOutsideClick, true)
  }
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closePopover()
      toggle.focus()
    }
  }
  function onOutsideClick(e) {
    if (!wrap.contains(e.target)) closePopover()
  }

  toggle.addEventListener('click', () => (popover.hidden ? openPopover() : closePopover()))

  inputEl.addEventListener('input', () => {
    if (state.mode !== 'regex') emit()
  })

  return { close: closePopover, getState: () => ({ ...state }) }
}
