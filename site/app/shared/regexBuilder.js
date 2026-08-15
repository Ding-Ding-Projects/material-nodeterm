// site/app/shared/regexBuilder.js
//
// A small anchored regex builder, attached directly beside a search field —
// this is the one implementation every search bar on this site (personal
// vocabulary list, toy-lock list, changelog search) shares, per the
// project's regex-builder contract: plain text is the default, regex is an
// explicit opt-in, and the popover stays visually attached to the field it
// belongs to rather than living in a separate page or a shared dialog.
//
// Evaluation is local only (nothing is sent anywhere) and is deliberately
// bounded: pattern and sample text are capped, and every RegExp construction
// and .test() call is wrapped in try/catch so an invalid pattern reports
// inline instead of throwing. This does NOT fully prevent catastrophic
// backtracking on an adversarial pattern (that needs a Worker with a hard
// timeout, which this static-file site does not have) — see the caveat in
// docs/site-features.md. The data sets this searches (a personal-vocabulary
// list, a lock list, twenty changelog entries) are always small and local,
// which keeps the practical risk low.

import { h, injectStyleOnce } from './dom.js'

const MAX_PATTERN_LEN = 200
const MAX_SAMPLE_LEN = 2000

injectStyleOnce(
  'site-regex-builder-style',
  `
  .site-search { position: relative; display: flex; align-items: center; gap: 6px; }
  .site-search input[type="search"], .site-search input[type="text"] {
    flex: 1 1 auto; min-width: 0; height: var(--touch-target, 44px);
    border-radius: var(--md-shape-sm, 8px); border: 1px solid var(--md-outline, #79767e);
    background: var(--md-surface-container-low, #f5f1f8); color: var(--md-on-surface, #1c1b1f);
    padding: 0 12px; font: inherit;
  }
  .site-search__toggle {
    height: var(--touch-target, 44px); min-width: var(--touch-target, 44px);
    border-radius: var(--md-shape-sm, 8px); border: 1px solid var(--md-outline, #79767e);
    background: var(--md-surface-container, #efeaf2); color: var(--md-on-surface, #1c1b1f);
    cursor: pointer; font: inherit; padding: 0 10px;
  }
  .site-search__toggle[aria-pressed="true"] { background: var(--md-primary-container, #e7ddff); color: var(--md-on-primary-container, #230a63); }
  .site-search__pop {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; width: min(360px, 90vw);
    background: var(--md-surface-container-high, #e9e4ec); color: var(--md-on-surface, #1c1b1f);
    border-radius: var(--md-shape-md, 12px); box-shadow: var(--md-elevation-2);
    padding: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .site-search__pop[hidden] { display: none; }
  .site-search__pop label { font-size: 12px; opacity: 0.8; display: block; margin-bottom: 2px; }
  .site-search__pop input, .site-search__pop textarea {
    width: 100%; box-sizing: border-box; border-radius: var(--md-shape-sm, 8px);
    border: 1px solid var(--md-outline-variant, #cac4ce); background: var(--md-surface, #fbf8fd);
    color: var(--md-on-surface, #1c1b1f); padding: 6px 8px; font: inherit; font-family: var(--md-font-mono);
  }
  .site-search__flags { display: flex; gap: 10px; flex-wrap: wrap; font-size: 13px; }
  .site-search__flags label { display: flex; align-items: center; gap: 4px; font-size: 13px; opacity: 1; margin: 0; }
  .site-search__status { font-size: 12px; }
  .site-search__status[data-ok="true"] { color: var(--md-on-surface-variant); }
  .site-search__status[data-ok="false"] { color: var(--md-error, #ba1a1a); }
  `,
)

/**
 * @param {{placeholder?: string, onChange: (predicate: (text: string) => boolean, meta: {mode: 'text'|'regex', query: string}) => void, ariaLabel?: string}} opts
 */
export function createSearchWithRegex(opts) {
  const { onChange, placeholder = 'Search…', ariaLabel = 'Search' } = opts
  let mode = 'text'
  let pattern = ''
  let flags = 'i'
  let query = ''
  let sample = ''

  const input = h('input', {
    type: 'search',
    placeholder,
    'aria-label': ariaLabel,
    onInput: (e) => {
      query = e.target.value
      emit()
    },
  })

  const patternInput = h('input', {
    type: 'text',
    placeholder: 'Regex pattern, e.g. ^foo.*bar$',
    maxlength: String(MAX_PATTERN_LEN),
    onInput: (e) => {
      pattern = e.target.value.slice(0, MAX_PATTERN_LEN)
      emit()
    },
  })

  const sampleInput = h('textarea', {
    rows: 2,
    placeholder: 'Try a sample here to see if it matches',
    maxlength: String(MAX_SAMPLE_LEN),
    onInput: (e) => {
      sample = e.target.value.slice(0, MAX_SAMPLE_LEN)
      renderStatus()
    },
  })

  const status = h('div', { class: 'site-search__status', 'aria-live': 'polite' }, '')

  const flagBoxes = {}
  const flagsRow = h(
    'div',
    { class: 'site-search__flags' },
    ['i', 'g', 'm', 's', 'u'].map((f) => {
      const box = h('input', {
        type: 'checkbox',
        checked: flags.includes(f),
        onChange: (e) => {
          flags = flagsFromBoxes()
          emit()
        },
      })
      flagBoxes[f] = box
      return h('label', {}, [box, ' ' + f])
    }),
  )
  function flagsFromBoxes() {
    return Object.entries(flagBoxes)
      .filter(([, box]) => box.checked)
      .map(([f]) => f)
      .join('')
  }

  const pop = h(
    'div',
    { class: 'site-search__pop', hidden: true, role: 'dialog', 'aria-label': 'Regex builder' },
    [
      h('label', {}, 'Pattern'),
      patternInput,
      h('label', {}, 'Flags'),
      flagsRow,
      h('label', {}, 'Sample text'),
      sampleInput,
      status,
    ],
  )

  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'site-search__toggle',
      'aria-pressed': 'false',
      'aria-label': 'Open regex builder',
      title: 'Regex builder',
      onClick: () => {
        const willOpen = pop.hidden
        pop.hidden = !willOpen
        toggle.setAttribute('aria-pressed', String(willOpen))
        mode = willOpen ? 'regex' : 'text'
        if (willOpen) patternInput.focus()
        emit()
      },
    },
    '· *',
  )

  const root = h('div', { class: 'site-search' }, [input, toggle, pop])

  function buildRegExp() {
    if (!pattern) return null
    try {
      return new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
    } catch (err) {
      return { error: String(err.message || err) }
    }
  }

  function renderStatus() {
    if (mode !== 'regex') {
      status.textContent = ''
      return
    }
    const re = buildRegExp()
    if (!re) {
      status.textContent = 'Enter a pattern above.'
      status.dataset.ok = 'true'
      return
    }
    if (re.error) {
      status.textContent = 'Invalid pattern: ' + re.error
      status.dataset.ok = 'false'
      return
    }
    if (sample) {
      let matched = false
      try {
        matched = new RegExp(re.source, re.flags.replace('g', '')).test(sample)
      } catch (_err) {
        matched = false
      }
      status.textContent = matched ? 'Matches the sample.' : 'No match in the sample.'
      status.dataset.ok = matched ? 'true' : 'false'
    } else {
      status.textContent = 'Pattern looks valid.'
      status.dataset.ok = 'true'
    }
  }

  function predicate(text) {
    if (mode === 'text') {
      if (!query) return true
      return String(text).toLowerCase().includes(query.toLowerCase())
    }
    const re = buildRegExp()
    if (!re || re.error) return false
    try {
      return new RegExp(re.source, re.flags.replace('g', '')).test(String(text))
    } catch (_err) {
      return false
    }
  }

  function emit() {
    renderStatus()
    try {
      onChange(predicate, { mode, query: mode === 'text' ? query : pattern })
    } catch (err) {
      console.warn('[nodeterm-site] regex-builder onChange threw', err)
    }
  }

  emit()
  return { root, predicate: (text) => predicate(text) }
}
