// site/app/core/dom.js
//
// Tiny rendering helpers. This app deliberately does not carry a virtual
// DOM: each render() call rebuilds the relevant subtree's innerHTML from a
// template-literal string (mirroring the imported design's own
// renderVals()-drives-a-template shape) and re-delegates events. The one
// thing a naive "rebuild innerHTML on every keystroke" approach breaks is
// text-input focus — withFocusPreserved() is what fixes that: it remembers
// which element had focus (by its data-focus-id) and its selection range,
// runs the rebuild, then restores both.

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function attr(value) {
  return esc(value)
}

export function withFocusPreserved(root, rebuild) {
  const active = document.activeElement
  const focusId = active && active.dataset ? active.dataset.focusId : null
  const selStart = active && 'selectionStart' in active ? active.selectionStart : null
  const selEnd = active && 'selectionEnd' in active ? active.selectionEnd : null
  const scrollers = Array.from(root.querySelectorAll('[data-preserve-scroll]')).map((el) => [el.dataset.preserveScroll, el.scrollTop])

  rebuild()

  if (focusId) {
    const el = root.querySelector('[data-focus-id="' + CSS.escape(focusId) + '"]')
    if (el) {
      el.focus({ preventScroll: true })
      if (selStart != null && 'setSelectionRange' in el) {
        try {
          el.setSelectionRange(selStart, selEnd)
        } catch (_err) {
          /* not a text-selectable input type (e.g. type=color) */
        }
      }
    }
  }
  scrollers.forEach(([id, top]) => {
    const el = root.querySelector('[data-preserve-scroll="' + CSS.escape(id) + '"]')
    if (el) el.scrollTop = top
  })
}

// Resolve a design token colour string like "var(--yellow)" to a literal
// hex/rgb for contexts (like <input type=color>-free swatches) that need
// one — currently unused directly but kept as the one place that would do
// it if a future control needed it.
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
