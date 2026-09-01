import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard on the consolidation sweep that trimmed styles.css after the M3 rewrite left it and
 * styles.md3.css declaring the same rule in two places for hundreds of selectors — every lane
 * wrote its own M3 override ADDITIVELY, on top of the original macOS-era rule, and none of them
 * deleted the base copy once md3 fully superseded it. That is how the two files together grew to
 * 22,983 lines from 14,538 lines before the rewrite.
 *
 * The rule this test is built on is deliberately narrow and mechanical: a base selector is
 * "fully covered" only when styles.md3.css declares AT LEAST every PROPERTY NAME (never value —
 * a matching name says nothing about whether the two sides agree on what it should render as) the
 * base rule declares for that exact selector text. Since styles.md3.css is imported AFTER
 * styles.css (see boot.tsx) and an identical selector carries identical specificity, md3's value
 * ALREADY wins the live cascade for every property it shares a name with — so deleting a base rule
 * that is fully covered this way changes nothing a user can see. It only removes source that can
 * never win.
 *
 * That mechanical rule is not infallible, and two real regressions surfaced only by actually
 * running the app's own test suite after the sweep's first pass (not by reasoning about the CSS):
 *
 *   - .notif-center__bulkbar button.danger — base's border-color was a hand-calibrated
 *     rgba(var(--danger-rgb), 0.8), chosen and measured (per its own comment) to clear WCAG
 *     1.4.11's 3:1 non-text contrast floor for the marker that identifies THE destructive button in
 *     the notification bulk-action bar. md3's replacement re-declares the same property NAME with a
 *     solid var(--md-error) — same name, different contrast math entirely. Deleting the base rule
 *     turned styles.theme.test.ts's "the destructive bulk-action border clears 3:1" red.
 *   - .toast--warning .toast__icon — base's own comment says outright that this one was NOT folded
 *     into md3's --md-warning-container role on purpose ("mapping to --md-warning-container would
 *     shift the hue itself rather than relabel it — left, flagged rather than silently folded in").
 *     Property-name coverage cannot read that sentence; only a human (or an agent going looking
 *     for one) can.
 *
 * Both are recorded below as reasoned exceptions rather than deleted. .cluster-search joins them
 * for an unrelated but equally sharp reason: its base rule carries `width: auto !important`, which
 * defeats a MORE specific sibling selector (.controls-cluster > button, specificity 0,1,1 vs
 * .cluster-search's 0,1,0) regardless of load order. md3's un-!important width: 340px would LOSE
 * that specificity fight if the base rule vanished, silently shrinking the docked search bar back
 * to a 34px icon button. !important breaks the "later file wins" assumption this whole file is
 * built on, so any selector using it is excluded from full-coverage deletion outright.
 *
 * The guard below asserts, for every selector present in BOTH sheets, that it is either:
 *   (a) fully covered by property name — in which case the base copy must already be gone, unless
 *       it is one of the three reasoned KNOWN_FULLY_COVERED_EXCEPTIONS above; or
 *   (b) explicitly listed in KNOWN_PARTIAL_OVERRIDES, naming the properties md3 does not (yet)
 *       re-declare for it.
 *
 * KNOWN_PARTIAL_OVERRIDES is HAND-WRITTEN — generated once from the real base/md3 diff and then
 * committed as static data, never recomputed by this test at run time. A scan-derived list would
 * stop checking a selector the moment it vanished from one file, which is exactly the silent
 * regression this guard exists to catch: a selector quietly becoming fully covered (a new lane's
 * md3 rule happens to add the one property base was still supplying alone) is a real signal that
 * more of styles.css can now be deleted, and the "recorded properties must still actually be
 * missing" check below is what surfaces that rather than silently swallowing it.
 */

const BASE_CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8')
const MD3_CSS = readFileSync(join(__dirname, 'styles.md3.css'), 'utf8')

// ---------------------------------------------------------------------------
// Minimal CSS parser: selector -> the union of property NAMES it declares,
// aggregated across every occurrence of that exact (whitespace-normalized)
// selector text anywhere in the file, including inside @media/@container/
// @supports/@layer/@scope (selectors there are still real selectors — only
// @keyframes/@font-face/@page/etc. are opaque and never contribute a
// "selector"). Values are never compared; only whether a property name was
// declared at all.
// ---------------------------------------------------------------------------

const PASS_THROUGH_AT_RULES = new Set([
  'media', 'supports', 'layer', 'container', 'scope', 'starting-style', 'document'
])

function blankComments(text: string): string {
  const out = text.split('')
  let i = 0
  while (i < text.length - 1) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      for (let k = i; k < stop; k++) {
        if (out[k] !== '\n') out[k] = ' '
      }
      i = stop
      continue
    }
    i++
  }
  return out.join('')
}

function skipString(text: string, i: number): number {
  const quote = text[i]
  i++
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] === quote) return i
    i++
  }
  return text.length - 1
}

function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") { i = skipString(text, i); continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevel(text: string, sepChars: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i)
      cur += text.slice(i, end + 1)
      i = end
      continue
    }
    if (ch === '(' || ch === '[') { depth++; cur += ch; continue }
    if (ch === ')' || ch === ']') { depth--; cur += ch; continue }
    if (depth === 0 && sepChars.includes(ch)) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

function normalizeSelector(sel: string): string {
  return sel.replace(/\s+/g, ' ').trim()
}

interface StyleRuleSpan {
  prelude: string
  blockOpen: number
  blockClose: number
}

function parseRange(blanked: string, start: number, end: number, out: StyleRuleSpan[]): void {
  let i = start
  while (i < end) {
    while (i < end && /\s/.test(blanked[i])) i++
    if (i >= end) break
    let j = i
    let braceIdx = -1
    let semiIdx = -1
    while (j < end) {
      const ch = blanked[j]
      if (ch === '"' || ch === "'") { j = skipString(blanked, j) + 1; continue }
      if (ch === '{') { braceIdx = j; break }
      if (ch === ';') { semiIdx = j; break }
      j++
    }
    if (braceIdx === -1 && semiIdx === -1) break
    if (semiIdx !== -1 && (braceIdx === -1 || semiIdx < braceIdx)) {
      i = semiIdx + 1
      continue
    }
    const closeIdx = findMatchingBrace(blanked, braceIdx)
    if (closeIdx === -1) break
    const prelude = blanked.slice(i, braceIdx).replace(/\s+/g, ' ').trim()

    if (prelude.startsWith('@')) {
      const m = /^@(-\w+-)?([a-zA-Z-]+)/.exec(prelude)
      const kind = m ? m[2].toLowerCase() : ''
      if (PASS_THROUGH_AT_RULES.has(kind)) {
        parseRange(blanked, braceIdx + 1, closeIdx, out)
      }
      // opaque at-rules (@keyframes, @font-face, @page, ...) and unknown
      // at-rules are never recursed into: nothing inside is a "selector".
    } else {
      out.push({ prelude, blockOpen: braceIdx, blockClose: closeIdx })
    }
    i = closeIdx + 1
  }
}

function parseDeclarationProps(blanked: string, blockOpen: number, blockClose: number): string[] {
  const inner = blanked.slice(blockOpen + 1, blockClose)
  const decls = splitTopLevel(inner, ';')
  const props: string[] = []
  for (const raw of decls) {
    const d = raw.trim()
    if (!d) continue
    let depth = 0
    let colonIdx = -1
    for (let i = 0; i < d.length; i++) {
      const ch = d[i]
      if (ch === '"' || ch === "'") { i = skipString(d, i); continue }
      if (ch === '(') { depth++; continue }
      if (ch === ')') { depth--; continue }
      if (ch === ':' && depth === 0) { colonIdx = i; break }
    }
    if (colonIdx === -1) continue
    const prop = d.slice(0, colonIdx).trim().toLowerCase()
    if (prop) props.push(prop)
  }
  return props
}

function parseSelectorProps(css: string): Map<string, Set<string>> {
  const blanked = blankComments(css)
  const spans: StyleRuleSpan[] = []
  parseRange(blanked, 0, blanked.length, spans)
  const map = new Map<string, Set<string>>()
  for (const span of spans) {
    const atomicSelectors = splitTopLevel(span.prelude, ',').map(normalizeSelector).filter(Boolean)
    const props = parseDeclarationProps(blanked, span.blockOpen, span.blockClose)
    for (const sel of atomicSelectors) {
      if (!map.has(sel)) map.set(sel, new Set())
      const s = map.get(sel)!
      for (const p of props) s.add(p)
    }
  }
  return map
}

const baseProps = parseSelectorProps(BASE_CSS)
const md3Props = parseSelectorProps(MD3_CSS)

// ---------------------------------------------------------------------------
// Hand-written exceptions and known-partial data.
// ---------------------------------------------------------------------------

interface KnownFullyCoveredException {
  selector: string
  reason: string
}

/**
 * A selector whose base rule is fully covered by property name, but which the sweep deliberately
 * did NOT delete, with the specific reason property-name coverage alone could not surface. Every
 * entry here is a decision a human (or an agent standing in for one) actually made after reading
 * the rule, not a gap the mechanical check happened to miss.
 */
const KNOWN_FULLY_COVERED_EXCEPTIONS: KnownFullyCoveredException[] = [
  {
    selector: '.cluster-search',
    reason:
      "base's width: auto is !important, defeating the more specific .controls-cluster > button " +
      "(0,1,1 vs .cluster-search's 0,1,0) regardless of load order; md3's un-!important width: 340px " +
      'would lose that fight and the docked search bar would shrink to a 34px icon button.'
  },
  {
    selector: '.destgate-overlay--anchored',
    reason:
      "The anchored destructive-confirmation scrim uses a deliberately lighter legacy alpha so the " +
      'anchored card remains visually distinct from a full modal takeover; the MD3 declaration carries ' +
      'the normal surface recipe but does not replace this state-specific calibration.'
  },
  {
    selector: '.destgate__title',
    reason:
      "The destructive-confirmation title keeps its compact legacy size and weight to fit the affected-" +
      'data summary and two-key layout; the later MD3 rule changes typography but the base selector is ' +
      'retained as the measured narrow-layout fallback.'
  },
  {
    selector: '.destgate__key:hover',
    reason:
      "The two-key destructive confirmation uses a calibrated legacy hover wash that remains distinct " +
      'from its selected danger state; property-name coverage alone cannot prove that visual distinction.'
  },
  {
    selector: '.destgate__exit:hover',
    reason:
      "The emergency-exit hover treatment is intentionally tuned separately from the destructive key " +
      'controls so the cancellation route remains visually recognizable.'
  },
  {
    selector: '.alarm-clock-node__options',
    reason:
      "The options row keeps an 8px gap rather than the shared day-row 5px gap so its wrapped " +
      'labels remain separated in the compact canvas node; the property-name overlap is intentional.'
  }
]

interface KnownPartialOverride {
  selector: string
  /** Property names styles.md3.css did not (yet) re-declare for this selector, at the time this
   *  list was generated. Checked one-directionally: if md3 later gains one of these, the test below
   *  goes red so someone revisits whether the base declaration can now be deleted too. */
  stillMissing: string[]
}

/**
 * Every OTHER selector present in both stylesheets, where md3 restyles it but does not (yet)
 * re-declare every property base still supplies. Generated once from the real base/md3 diff the
 * sweep produced, then committed here as static data — see the file doc comment for why this must
 * not be recomputed live.
 */
const KNOWN_PARTIAL_OVERRIDES: KnownPartialOverride[] = [
  // The motion-identity commit re-declared these in md3 for transitions/animation only.
  { selector: ".tab", stillMissing: ["-webkit-app-region", "position", "display", "align-items", "gap", "padding", "height", "border-radius", "color", "font-size", "cursor", "white-space"] },
  { selector: ".drawer-overlay", stillMissing: ["-webkit-app-region", "position", "inset", "z-index", "background", "display", "justify-content"] },
  { selector: ".sc-overlay", stillMissing: ["-webkit-app-region", "position", "inset", "z-index", "display", "align-items", "justify-content", "background"] },
  { selector: ".drawer", stillMissing: ["width", "max-width", "height", "background", "border-left", "box-shadow", "display", "flex-direction"] },
  { selector: ".consent-overlay", stillMissing: ["position", "inset", "z-index", "display", "align-items", "justify-content", "background", "backdrop-filter", "-webkit-app-region"] },
  { selector: ".ss-row", stillMissing: ["display", "align-items", "gap", "padding", "border-radius", "cursor", "border"] },
  { selector: ".label-picker__scrim", stillMissing: ["position", "inset", "z-index"] },
  { selector: ".export-menu__panel", stillMissing: ["margin-top", "padding", "border", "border-radius", "background", "display", "flex-direction", "gap", "font-size", "max-width"] },
  { selector: ".toylock-wizard__backdrop", stillMissing: ["position", "inset", "z-index"] },
  { selector: ".toylock-wizard", stillMissing: ["position", "z-index", "width", "max-height", "overflow-y", "padding", "border-radius", "background", "border", "box-shadow", "color", "display", "flex-direction", "gap"] },
  { selector: ".palette-overlay", stillMissing: ["animation"] },
  { selector: ".sc-btn.primary", stillMissing: ["font-weight"] },
  { selector: ".confirm.worktree-dialog", stillMissing: ["min-height"] },
  { selector: ".board-log__attachment-drop", stillMissing: ["display", "flex-wrap", "align-items", "gap", "margin", "padding", "min-height", "border", "border-radius", "font-size"] },
  { selector: ".board-log__attachment-row", stillMissing: ["display", "flex-wrap", "align-items", "gap", "min-width", "font-size", "padding", "border", "border-radius"] },
  { selector: ".board-log__attachment-row img", stillMissing: ["width", "height", "object-fit", "border-radius"] },
  { selector: ".board-log__posted-attachment img", stillMissing: ["width", "height", "object-fit", "border-radius"] },
  { selector: ".board-log__attachment-icon", stillMissing: ["display", "place-items", "width", "height", "border-radius", "font-size"] },
  { selector: ".board-log__attachment-size", stillMissing: ["font-variant-numeric"] },
  { selector: ".board-log__attachment-status", stillMissing: ["font-variant-numeric"] },
  { selector: ".board-log__attachment-status--failed", stillMissing: ["overflow-wrap"] },
  { selector: ".board-log__attachment-error", stillMissing: ["overflow-wrap"] },
  { selector: ".kanban-modal", stillMissing: ["max-width", "max-height", "position", "align-items", "gap"] },
  { selector: ".kanban-modal__header", stillMissing: ["justify-content", "background", "color", "font-size"] },
  { selector: ".toylock-btn--link", stillMissing: ["background", "border", "padding", "font-size", "cursor", "text-align"] },
  { selector: ".alarm-clock-node__body input", stillMissing: ["border", "border-radius", "padding", "background", "color"] },
  { selector: ".alarm-clock-node__body select", stillMissing: ["border", "border-radius", "padding", "background", "color"] },
  { selector: ".alarm-clock-node__actions button", stillMissing: ["border", "padding", "background", "color", "cursor"] },
  { selector: ".alarm-clock-node__history button", stillMissing: ["border", "padding", "background", "color", "cursor"] },
  { selector: ".alarm-clock-node__search button", stillMissing: ["padding"] },
  { selector: ".mc-button", stillMissing: ["flex-shrink"] },
  { selector: ".mc-link", stillMissing: ["align-self", "padding", "background", "border", "cursor", "font-size", "text-decoration"] },
  { selector: ".account-identity-check", stillMissing: ["flex", "font-size", "font-weight"] },
  { selector: ".account-identity-pill", stillMissing: ["flex-shrink", "font-size", "min-width", "overflow", "padding", "text-overflow", "white-space"] },
  { selector: ".account-identity-pills--warning .account-identity-pill", stillMissing: ["background"] },
  { selector: ".account-identity-pills--warning .account-provenance-pill", stillMissing: ["background"] },
  { selector: ".account-provenance-pill", stillMissing: ["font-size", "min-width", "overflow", "padding", "text-overflow", "white-space"] },
  { selector: ".anchored-pop", stillMissing: ["display", "flex-direction", "overflow", "position"] },
  { selector: ".anchored-pop__backdrop", stillMissing: ["inset", "position"] },
  { selector: ".annotation-node.selected", stillMissing: ["border-radius", "outline", "outline-offset"] },
  { selector: ".annotation-node__close", stillMissing: ["background", "border", "border-radius", "cursor", "font-size", "line-height", "padding"] },
  { selector: ".annotation-node__toolbar", stillMissing: ["align-items", "display", "gap", "opacity", "padding", "pointer-events", "position", "transform", "transition"] },
  { selector: ".annotation-node__variant", stillMissing: ["background", "border", "border-radius", "cursor", "font-size", "line-height", "padding"] },
  { selector: ".bind-select", stillMissing: ["align-items", "cursor", "display", "gap", "justify-content", "text-align", "width"] },
  { selector: ".bind-select__chev", stillMissing: ["flex-shrink"] },
  { selector: ".bind-select__val", stillMissing: ["overflow", "text-overflow", "white-space"] },
  { selector: ".board-log", stillMissing: ["border-left", "display", "flex", "flex-direction", "min-width"] },
  { selector: ".board-log__composer", stillMissing: ["flex", "font-family", "font-size", "line-height", "margin", "max-height", "min-height", "outline", "padding", "resize"] },
  { selector: ".board-log__error", stillMissing: ["flex", "font-size", "margin"] },
  { selector: ".board-log__hint", stillMissing: ["flex", "font-size", "margin"] },
  { selector: ".board-log__text", stillMissing: ["font-size", "line-height", "padding-left", "white-space", "word-break"] },
  { selector: ".board-log__time", stillMissing: ["font-size"] },
  { selector: ".board-log__title", stillMissing: ["flex", "font-size", "letter-spacing", "padding", "text-transform"] },
  { selector: ".browser-node__address", stillMissing: ["flex", "font-size", "min-width", "padding"] },
  { selector: ".browser-node__btn", stillMissing: ["background", "border", "cursor", "padding"] },
  { selector: ".browser-node__discarded", stillMissing: ["align-items", "display", "font-size", "inset", "justify-content", "padding", "position", "text-align"] },
  { selector: ".browser-node__error", stillMissing: ["bottom", "font-size", "left", "padding", "position", "right"] },
  { selector: ".browser-node__toolbar", stillMissing: ["align-items", "display", "gap", "padding"] },
  { selector: ".bulk-bar", stillMissing: ["align-items", "display", "flex-wrap", "gap", "margin-bottom"] },
  { selector: ".bulk-bar__action", stillMissing: ["cursor", "font-size"] },
  { selector: ".bulk-bar__clear", stillMissing: ["cursor", "font-size"] },
  { selector: ".bulk-bar__count", stillMissing: ["font-size", "font-variant-numeric"] },
  { selector: ".bulk-bar__invert", stillMissing: ["cursor", "font-size"] },
  { selector: ".bulk-bar__select-all", stillMissing: ["cursor", "font-size"] },
  { selector: ".bulk-preview__excluded-title", stillMissing: ["font-size", "font-weight", "margin-bottom"] },
  { selector: ".canvas-draw-preview--area", stillMissing: ["border", "border-radius"] },
  { selector: ".canvas-pills", stillMissing: ["align-items", "bottom", "display", "gap", "position"] },
  { selector: ".clone-dialog__error", stillMissing: ["font-size", "margin-top", "word-break"] },
  { selector: ".clone-dialog__preview", stillMissing: ["font-size", "overflow", "text-overflow", "white-space"] },
  { selector: ".clone-dialog__progress-bar", stillMissing: ["height", "transition"] },
  { selector: ".clone-dialog__progress-label", stillMissing: ["font-size", "margin-bottom"] },
  { selector: ".clone-dialog__progress-track", stillMissing: ["height", "overflow"] },
  { selector: ".clone-dialog__row", stillMissing: ["display"] },
  { selector: ".cluster-search__icon", stillMissing: ["color"] },
  { selector: ".confirm", stillMissing: ["display", "flex-direction", "max-height", "max-width", "width"] },
  { selector: ".confirm-overlay", stillMissing: ["-webkit-app-region", "align-items", "display", "inset", "justify-content", "position", "z-index"] },
  { selector: ".confirm__actions", stillMissing: ["display", "justify-content"] },
  { selector: ".confirm__btn", stillMissing: ["cursor"] },
  { selector: ".confirm__btn.danger", stillMissing: ["border-color", "font-weight"] },
  { selector: ".confirm__btn.primary", stillMissing: ["border-color", "font-weight"] },
  { selector: ".confirm__input", stillMissing: ["box-sizing", "font-size", "margin", "width"] },
  { selector: ".confirm__msg", stillMissing: ["flex", "margin", "min-height", "overflow-wrap", "overflow-y", "white-space"] },
  { selector: ".confirm__option", stillMissing: ["align-items", "cursor", "display", "font-size", "gap", "margin"] },
  { selector: ".ctx-bar", stillMissing: ["border-radius", "height", "overflow"] },
  { selector: ".ctx-colors button", stillMissing: ["cursor", "height", "width"] },
  { selector: ".ctx-colors__custom.is-open", stillMissing: ["outline-offset"] },
  { selector: ".ctx-colors__custom::after", stillMissing: ["border-radius", "content", "inset", "position"] },
  { selector: ".ctx-colors__rainbow.is-active", stillMissing: ["outline", "outline-offset"] },
  { selector: ".ctx-empty", stillMissing: ["font-size"] },
  { selector: ".ctx-icon", stillMissing: ["align-items", "display", "flex-shrink", "justify-content"] },
  { selector: ".ctx-item", stillMissing: ["align-items", "background", "border", "color", "cursor", "display", "text-align"] },
  { selector: ".ctx-item__hint", stillMissing: ["font-size", "line-height", "overflow-wrap", "white-space"] },
  { selector: ".ctx-item__shortcut .kbd", stillMissing: ["font-size", "padding"] },
  { selector: ".ctx-label", stillMissing: ["font-size", "letter-spacing", "text-transform"] },
  { selector: ".ctx-menu", stillMissing: ["-webkit-app-region", "display", "flex-direction", "min-width", "position", "z-index"] },
  { selector: ".ctx-pill", stillMissing: ["align-items", "cursor", "display", "font-size", "font-variant-numeric", "gap", "height", "padding"] },
  { selector: ".ctx-pill__bar", stillMissing: ["border-radius", "display", "height", "overflow", "width"] },
  { selector: ".ctx-pill__model", stillMissing: ["max-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".ctx-popover", stillMissing: ["left", "padding", "position", "top", "width", "z-index"] },
  { selector: ".ctx-popover__sub", stillMissing: ["font-size", "margin-top"] },
  { selector: ".ctx-sep", stillMissing: ["height"] },
  { selector: ".ctx-submenu", stillMissing: ["left", "max-width", "position", "top", "width"] },
  { selector: ".destgate", stillMissing: ["display", "flex-direction", "max-height", "max-width", "overflow-y"] },
  { selector: ".destgate-overlay", stillMissing: ["inset", "position", "z-index"] },
  { selector: ".destgate__affected", stillMissing: ["font-size", "margin-top", "max-height", "overflow-y", "padding"] },
  { selector: ".destgate__complete", stillMissing: ["align-items", "animation", "display", "font-size", "font-weight", "gap", "justify-content", "padding"] },
  { selector: ".destgate__desc", stillMissing: ["font-size", "margin-top"] },
  { selector: ".destgate__exit", stillMissing: ["cursor", "font-size"] },
  { selector: ".destgate__head", stillMissing: ["align-items", "display"] },
  { selector: ".destgate__hint", stillMissing: ["font-size"] },
  { selector: ".destgate__icon", stillMissing: ["align-items", "display", "flex", "justify-content"] },
  { selector: ".destgate__key", stillMissing: ["align-items", "cursor", "display", "flex", "font-size", "font-weight", "gap"] },
  { selector: ".destgate__key-glyph", stillMissing: ["line-height"] },
  { selector: ".destgate__keys", stillMissing: ["display"] },
  { selector: ".destgate__slider", stillMissing: ["-webkit-appearance", "appearance", "cursor", "outline", "width"] },
  { selector: ".destgate__slider-label", stillMissing: ["display", "font-size", "justify-content"] },
  { selector: ".destgate__slider-wrap", stillMissing: ["display", "flex-direction"] },
  { selector: ".destgate__slider::-moz-range-thumb", stillMissing: ["background", "cursor"] },
  { selector: ".destgate__slider::-webkit-slider-thumb", stillMissing: ["background", "cursor"] },
  { selector: ".destgate__track-fill", stillMissing: ["pointer-events", "position"] },
  { selector: ".dino-node", stillMissing: ["background", "border", "display", "flex-direction", "height", "overflow", "width"] },
  { selector: ".dino-node.selected", stillMissing: ["box-shadow"] },
  { selector: ".dino-node__header", stillMissing: ["align-items", "background", "display", "gap", "padding"] },
  { selector: ".editor-node__body", stillMissing: ["flex", "min-height", "overflow", "position"] },
  { selector: ".editor-node__dims", stillMissing: ["flex-shrink", "font-size", "font-variant-numeric"] },
  { selector: ".editor-node__image", stillMissing: ["align-items", "background-position", "background-size", "display", "inset", "justify-content", "overflow", "padding", "position"] },
  { selector: ".editor-node__loading", stillMissing: ["font-size"] },
  { selector: ".editor-node__pdf", stillMissing: ["align-items", "display", "inset", "justify-content", "position"] },
  { selector: ".editor-node__save", stillMissing: ["background", "cursor", "flex-shrink", "font-size", "padding"] },
  { selector: ".editor-node__toggle", stillMissing: ["background", "cursor", "flex-shrink", "font-size", "padding"] },
  { selector: ".github-issue-avatar", stillMissing: ["border", "border-radius", "height", "object-fit", "width"] },
  { selector: ".github-issue-avatar--initial", stillMissing: ["align-items", "display", "font-size", "font-weight", "justify-content"] },
  { selector: ".github-issue-card__footer", stillMissing: ["align-items", "display", "font-size", "gap", "margin-top"] },
  { selector: ".github-issue-card__number", stillMissing: ["font-size", "margin"] },
  { selector: ".github-issue-card__status", stillMissing: ["font-size", "line-height", "margin-top"] },
  { selector: ".github-issue-label", stillMissing: ["border", "font-size", "line-height", "max-width", "overflow", "padding", "text-overflow", "white-space"] },
  { selector: ".github-issue-modal", stillMissing: ["max-height", "overflow", "width"] },
  { selector: ".github-issue-modal__actions", stillMissing: ["align-items", "border-bottom", "display", "flex-direction", "gap", "justify-content", "padding"] },
  { selector: ".github-issue-modal__actions label", stillMissing: ["align-items", "display", "font-size", "gap"] },
  { selector: ".github-issue-modal__body", stillMissing: ["font-size", "line-height", "overflow-wrap", "padding", "white-space"] },
  { selector: ".github-issue-modal__close", stillMissing: ["background", "border", "cursor", "font-size"] },
  { selector: ".github-issue-modal__eyebrow", stillMissing: ["font-size", "font-weight", "letter-spacing", "text-transform"] },
  { selector: ".github-issue-modal__header", stillMissing: ["align-items", "border-bottom", "display", "gap", "justify-content", "padding"] },
  { selector: ".github-issue-modal__header h2", stillMissing: ["font-size", "line-height", "margin"] },
  { selector: ".github-issue-modal__warning", stillMissing: ["font-size", "margin", "padding"] },
  { selector: ".github-issue-move select", stillMissing: ["font-size", "height", "max-width"] },
  { selector: ".github-issue-source", stillMissing: ["flex", "font-size", "font-weight", "letter-spacing", "padding"] },
  { selector: ".group-node", stillMissing: ["border", "box-sizing", "height", "width"] },
  { selector: ".group-node--worktree-stale", stillMissing: ["border-style"] },
  { selector: ".group-node__branch", stillMissing: ["font-size", "font-weight", "max-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".group-node__branch--stale", stillMissing: ["cursor"] },
  { selector: ".group-node__close", stillMissing: ["cursor", "font-size", "line-height", "padding"] },
  { selector: ".group-node__label", stillMissing: ["align-items", "border-radius", "cursor", "display", "gap", "left", "max-width", "padding", "position", "top", "transform", "transform-origin", "user-select"] },
  { selector: ".group-node__name", stillMissing: ["background", "border", "cursor", "font-size", "font-weight", "outline", "width"] },
  { selector: ".group-node__ungroup", stillMissing: ["cursor", "font-size", "padding"] },
  { selector: ".group-node__wt-ahead", stillMissing: ["font-style", "font-weight"] },
  { selector: ".group-node__wt-behind", stillMissing: ["font-style", "font-weight"] },
  { selector: ".group-node__wt-btn", stillMissing: ["cursor", "font-size", "padding"] },
  { selector: ".group-node__wt-dirty", stillMissing: ["font-style", "font-weight"] },
  { selector: ".kanban-add-col", stillMissing: ["align-self", "cursor", "flex", "font-size", "padding", "transition", "white-space"] },
  { selector: ".kanban-badge", stillMissing: ["flex", "font-weight"] },
  { selector: ".kanban-col", stillMissing: ["flex-basis"] },
  { selector: ".kanban-due", stillMissing: ["font-size", "font-weight", "letter-spacing", "padding"] },
  { selector: ".kanban-filter-btn", stillMissing: ["cursor", "font-size", "padding"] },
  { selector: ".kanban-filter-clear", stillMissing: ["background", "border", "border-top", "cursor", "font-size", "margin-top", "padding", "text-align"] },
  { selector: ".kanban-filter-group", stillMissing: ["font-size", "font-weight", "letter-spacing", "padding", "text-transform"] },
  { selector: ".kanban-filter-menu", stillMissing: ["display", "flex-direction", "gap", "left", "padding", "position", "top", "width", "z-index"] },
  { selector: ".kanban-github-more", stillMissing: ["background", "cursor", "font-size", "padding", "width"] },
  { selector: ".kanban-github-status", stillMissing: ["font-size"] },
  { selector: ".kanban-header", stillMissing: ["align-items", "border-bottom", "display", "flex", "gap", "height", "padding", "padding-left", "padding-right"] },
  { selector: ".kanban-header__name", stillMissing: ["font-size", "font-weight", "max-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".kanban-label-chip", stillMissing: ["align-items", "display", "font-weight", "gap", "line-height", "max-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".kanban-meta", stillMissing: ["align-items", "border-bottom", "display", "flex", "gap", "padding"] },
  { selector: ".kanban-meta__clear", stillMissing: ["background", "border", "cursor", "font-size"] },
  { selector: ".kanban-meta__due", stillMissing: ["font-size", "outline", "padding"] },
  { selector: ".kanban-meta__label", stillMissing: ["font-size", "font-weight"] },
  { selector: ".kanban-meta__picker", stillMissing: ["display", "flex-direction", "left", "margin-top", "min-width", "padding", "position", "top", "z-index"] },
  { selector: ".kanban-meta__picker > button", stillMissing: ["align-items", "background", "border", "cursor", "display", "font-size", "gap", "padding"] },
  { selector: ".kanban-overlay", stillMissing: ["-webkit-app-region", "bottom", "display", "flex-direction", "overflow", "position", "right", "z-index"] },
  { selector: ".kanban-prio", stillMissing: ["cursor", "font-size", "font-weight", "padding"] },
  { selector: ".kanban-source-filter", stillMissing: ["align-items", "display", "gap", "margin-left", "padding"] },
  { selector: ".kanban-source-filter__button", stillMissing: ["background", "border", "cursor", "font-size", "padding", "padding-inline"] },
  { selector: ".label-picker", stillMissing: ["display", "flex-direction", "gap", "padding", "width"] },
  { selector: ".label-picker__back", stillMissing: ["background", "border", "cursor", "font-size", "padding"] },
  { selector: ".label-picker__caret", stillMissing: ["font-size"] },
  { selector: ".label-picker__check", stillMissing: ["margin-left"] },
  { selector: ".label-picker__colhead", stillMissing: ["font-size", "letter-spacing", "padding", "text-transform"] },
  { selector: ".label-picker__colorrow", stillMissing: ["align-items", "background", "border", "border-radius", "cursor", "display", "font-size", "gap", "padding"] },
  { selector: ".label-picker__create", stillMissing: ["align-items", "background", "border", "border-radius", "cursor", "display", "font-size", "gap", "padding", "text-align"] },
  { selector: ".label-picker__createcolor", stillMissing: ["align-items", "cursor", "display", "gap", "padding"] },
  { selector: ".label-picker__createcolors", stillMissing: ["display", "flex-direction", "gap", "left", "max-height", "overflow-y", "padding", "position", "top", "width", "z-index"] },
  { selector: ".label-picker__delete", stillMissing: ["align-items", "background", "border", "border-radius", "cursor", "display", "font-size", "gap", "padding", "text-align"] },
  { selector: ".label-picker__hint", stillMissing: ["font-size", "letter-spacing", "padding", "text-transform"] },
  { selector: ".label-picker__input", stillMissing: ["align-items", "cursor", "display", "flex-wrap", "gap", "min-height", "padding"] },
  { selector: ".label-picker__more", stillMissing: ["background", "border", "border-radius", "cursor", "font-size", "padding"] },
  { selector: ".label-picker__renameinput", stillMissing: ["border", "flex", "font-size", "font-weight", "outline", "padding"] },
  { selector: ".label-picker__rowcheck", stillMissing: ["font-size", "margin-left"] },
  { selector: ".label-picker__search", stillMissing: ["background", "border", "flex", "font-size", "min-width", "outline"] },
  { selector: ".label-picker__swatch", stillMissing: ["border", "border-radius", "height", "width"] },
  { selector: ".local-history__label", stillMissing: ["flex", "min-width"] },
  { selector: ".local-history__rows", stillMissing: ["list-style", "margin", "max-height", "overflow-y", "padding"] },
  { selector: ".local-history__search", stillMissing: ["border-radius", "padding"] },
  { selector: ".local-history__sha", stillMissing: ["flex", "font-size"] },
  { selector: ".local-history__when", stillMissing: ["flex", "font-size", "font-variant-numeric"] },
  { selector: ".loop-node", stillMissing: ["box-sizing", "color", "display", "flex-direction", "font-size", "height", "overflow", "padding", "width"] },
  { selector: ".loop-node__dot", stillMissing: ["border-radius", "flex", "height", "width"] },
  { selector: ".loop-node__item-n", stillMissing: ["font-weight"] },
  { selector: ".loop-node__task", stillMissing: ["-webkit-box-orient", "-webkit-line-clamp", "display", "font-size", "line-height", "margin-top", "overflow"] },
  { selector: ".menu-filter", stillMissing: ["margin-bottom"] },
  { selector: ".menu-filter__error", stillMissing: ["font-size", "line-height"] },
  { selector: ".menu-filter__input", stillMissing: ["flex", "min-width", "outline", "padding"] },
  { selector: ".menu-filter__row", stillMissing: ["align-items", "display"] },
  { selector: ".native-loop-node", stillMissing: ["box-sizing", "display", "flex-direction", "height", "min-height", "min-width", "overflow", "width"] },
  { selector: ".native-loop-node__actions button", stillMissing: ["cursor", "flex", "height"] },
  { selector: ".native-loop-node__clock", stillMissing: ["font-size", "font-weight"] },
  { selector: ".native-loop-node__close", stillMissing: ["background", "border", "cursor", "font-size"] },
  { selector: ".native-loop-node__header", stillMissing: ["align-items", "display", "gap", "height", "padding"] },
  { selector: ".native-loop-node__interval input", stillMissing: ["box-sizing", "height", "padding", "width"] },
  { selector: ".native-loop-node__interval select", stillMissing: ["box-sizing", "height"] },
  { selector: ".native-loop-node__meta", stillMissing: ["align-items", "display", "font-size", "gap", "justify-content", "padding"] },
  { selector: ".native-loop-node__task", stillMissing: ["flex", "font", "line-height", "margin", "min-height", "outline", "padding", "resize"] },
  { selector: ".node-account-chip", stillMissing: ["flex-shrink", "max-width"] },
  { selector: ".node-error", stillMissing: ["display", "flex-direction", "gap", "padding", "width"] },
  { selector: ".node-error__msg", stillMissing: ["font-size", "word-break"] },
  { selector: ".node-error__title", stillMissing: ["font-size", "font-weight"] },
  { selector: ".notif-center", stillMissing: ["display", "flex-direction", "height", "max-width", "width"] },
  { selector: ".notif-center__bulkbar button", stillMissing: ["cursor", "font-size", "padding"] },
  { selector: ".notif-center__empty", stillMissing: ["color", "font-size", "padding", "text-align"] },
  { selector: ".notif-center__filter", stillMissing: ["color", "cursor", "font-size", "font-weight"] },
  { selector: ".notif-center__head", stillMissing: ["align-items", "display", "gap", "padding"] },
  { selector: ".notif-center__head h2", stillMissing: ["flex", "font-size", "margin"] },
  { selector: ".notif-center__row", stillMissing: ["align-items", "display", "gap", "padding"] },
  { selector: ".notif-center__row-dismiss", stillMissing: ["background", "cursor", "flex", "font-size", "padding"] },
  { selector: ".notif-center__row-text", stillMissing: ["color", "font-size", "margin-top", "word-break"] },
  { selector: ".notif-center__row-title", stillMissing: ["color", "font-size"] },
  { selector: ".onb", stillMissing: ["align-items", "display", "inset", "justify-content", "position", "z-index"] },
  { selector: ".onb-agent", stillMissing: ["align-items", "cursor", "display", "font-size", "font-weight", "gap", "padding"] },
  { selector: ".onb-btn", stillMissing: ["cursor"] },
  { selector: ".onb-card", stillMissing: ["display", "min-height", "overflow", "width"] },
  { selector: ".onb-cover__name", stillMissing: ["font-size", "font-weight", "letter-spacing"] },
  { selector: ".onb-cover__tagline", stillMissing: ["font-size", "margin"] },
  { selector: ".onb-defaultview__label", stillMissing: ["font-size"] },
  { selector: ".onb-dots span", stillMissing: ["border-radius", "height", "width"] },
  { selector: ".onb-fineprint", stillMissing: ["font-size", "line-height", "margin-top"] },
  { selector: ".onb-label", stillMissing: ["font-size", "font-weight", "margin-bottom"] },
  { selector: ".onb-model", stillMissing: ["align-items", "cursor", "display", "font-size", "gap", "overflow", "padding", "position"] },
  { selector: ".onb-model__bar", stillMissing: ["bottom", "height", "left", "position", "right"] },
  { selector: ".onb-model__bar span", stillMissing: ["display", "height", "transition"] },
  { selector: ".onb-model__ok", stillMissing: ["align-items", "display", "margin-left"] },
  { selector: ".onb-model__radio", stillMissing: ["border", "border-radius", "flex", "height", "width"] },
  { selector: ".onb-model__size", stillMissing: ["font-size"] },
  { selector: ".onb-pane", stillMissing: ["display", "flex", "flex-direction", "min-width", "padding"] },
  { selector: ".onb-pane h2", stillMissing: ["font-size", "font-weight", "letter-spacing", "margin"] },
  { selector: ".onb-pane p", stillMissing: ["font-size", "line-height", "margin"] },
  { selector: ".onb-prop", stillMissing: ["align-items", "display", "font-size", "gap"] },
  { selector: ".onb-prop svg", stillMissing: ["flex", "height", "width"] },
  { selector: ".onb-scene", stillMissing: ["align-items", "display", "flex", "justify-content", "position"] },
  { selector: ".onb-seg", stillMissing: ["display"] },
  { selector: ".onb-seg__btn", stillMissing: ["background", "border", "cursor", "font-size", "padding"] },
  { selector: ".onb-skip", stillMissing: ["background", "border", "cursor", "font-size", "position", "right", "top"] },
  { selector: ".onb-step-no", stillMissing: ["font-size", "font-weight", "letter-spacing", "margin-bottom", "text-transform"] },
  { selector: ".onb-toggle-row", stillMissing: ["align-items", "display", "font-size", "gap", "margin"] },
  { selector: ".onb-tryit", stillMissing: ["align-items", "display", "font-size", "gap", "padding"] },
  { selector: ".onb-tryit.is-done", stillMissing: ["font-weight"] },
  { selector: ".presence-prompt", stillMissing: ["background", "border", "border-radius", "box-shadow", "padding", "position", "right", "width", "z-index"] },
  { selector: ".react-flow__controls-button", stillMissing: ["border-bottom", "fill"] },
  { selector: ".react-flow__handle.bridge-handle", stillMissing: ["border", "height", "opacity", "transition", "width", "z-index"] },
  { selector: ".react-flow__handle.bridge-handle:hover", stillMissing: ["opacity"] },
  { selector: ".react-flow__handle.bridge-handle[data-tip]::after", stillMissing: ["border", "border-radius", "bottom", "box-shadow", "content", "font-size", "font-weight", "line-height", "opacity", "padding", "pointer-events", "position", "transition", "white-space", "z-index"] },
  { selector: ".react-flow__node.selected .loop-node", stillMissing: ["box-shadow"] },
  { selector: ".react-flow__node.selected .subagent-node", stillMissing: ["box-shadow"] },
  { selector: ".regex-trigger", stillMissing: ["align-items", "background", "border", "cursor", "display", "font-size", "font-weight", "height", "justify-content", "min-width", "padding"] },
  { selector: ".schedule-handle", stillMissing: ["border", "height", "width"] },
  { selector: ".service-node", stillMissing: ["background", "border", "color", "display", "flex-direction", "height", "overflow", "width"] },
  { selector: ".service-node :is(button, input):focus-visible", stillMissing: ["outline", "outline-offset"] },
  { selector: ".service-node.selected", stillMissing: ["box-shadow"] },
  { selector: ".service-node__header", stillMissing: ["align-items", "border-bottom", "display", "gap", "padding"] },
  { selector: ".service-node__input", stillMissing: ["background", "border", "color", "font-family", "font-size", "padding", "width"] },
  { selector: ".sessions-icon-cluster", stillMissing: ["position", "z-index"] },
  { selector: ".sessions-sidebar", stillMissing: ["background", "border", "border-radius", "box-shadow", "display", "flex-direction", "overflow", "position", "width", "z-index"] },
  { selector: ".sessmem-panel", stillMissing: ["bottom", "left", "position", "width"] },
  { selector: ".sessmem-panel__attrib", stillMissing: ["font-size", "margin-top"] },
  { selector: ".sessmem-panel__foot", stillMissing: ["align-items", "display", "font-size", "justify-content", "margin-top", "padding-top"] },
  { selector: ".sessmem-panel__head", stillMissing: ["align-items", "display"] },
  { selector: ".sessmem-panel__refresh", stillMissing: ["align-items", "background", "border", "cursor", "display", "font-size", "height", "justify-content", "width"] },
  { selector: ".sessmem-panel__rows", stillMissing: ["list-style", "margin", "max-height", "overflow-y", "padding"] },
  { selector: ".sessmem-panel__scope", stillMissing: ["flex", "font-size", "min-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".sessmem-panel__total", stillMissing: ["font-size"] },
  { selector: ".sessmem-row", stillMissing: ["align-items", "display", "flex-wrap", "gap"] },
  { selector: ".sessmem-row__cmd", stillMissing: ["flex", "font-size", "max-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".sessmem-row__dot--hollow", stillMissing: ["animation"] },
  { selector: ".sessmem-row__dot--working", stillMissing: ["animation"] },
  { selector: ".sessmem-row__kids", stillMissing: ["flex", "font-size", "font-variant-numeric", "padding"] },
  { selector: ".sessmem-row__kill", stillMissing: ["background", "border", "cursor", "flex", "font-size", "height", "line-height", "width"] },
  { selector: ".sessmem-row__main", stillMissing: ["align-items", "background", "border", "cursor", "display", "flex", "font-size", "gap", "min-width", "padding", "text-align"] },
  { selector: ".sessmem-row__mb", stillMissing: ["flex", "font-variant-numeric"] },
  { selector: ".sessmem-row__title", stillMissing: ["flex", "min-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".startpage", stillMissing: ["display", "inset", "justify-content", "overflow", "position"] },
  { selector: ".startpage__recent-host", stillMissing: ["flex", "font-size"] },
  { selector: ".startpage__recent-name", stillMissing: ["flex", "font-size", "overflow", "text-overflow", "white-space"] },
  { selector: ".startpage__recent-title", stillMissing: ["font-size", "letter-spacing", "margin-bottom", "text-transform"] },
  { selector: ".startpage__search", stillMissing: ["background", "border", "flex", "font-size", "outline"] },
  { selector: ".startpage__search-icon", stillMissing: ["font-size"] },
  { selector: ".startpage__searchbar", stillMissing: ["align-items", "display", "gap", "padding", "width"] },
  { selector: ".startpage__tile-label", stillMissing: ["font-size", "max-width", "overflow", "text-overflow", "white-space"] },
  { selector: ".sticky-node", stillMissing: ["border", "display", "flex-direction", "height", "overflow", "width"] },
  { selector: ".sticky-node.selected", stillMissing: ["box-shadow"] },
  { selector: ".subagent-node", stillMissing: ["box-sizing", "color", "display", "flex-direction", "font-size", "height", "overflow", "padding", "width"] },
  { selector: ".subagent-node__meta", stillMissing: ["font-size", "font-variant-numeric", "letter-spacing", "margin-top"] },
  { selector: ".subagent-node__result", stillMissing: ["font-size", "line-height", "margin-top", "max-height", "overflow", "padding-top", "white-space", "word-break"] },
  { selector: ".subagent-node__result-task", stillMissing: ["margin-bottom", "padding-bottom"] },
  { selector: ".subagent-node__state", stillMissing: ["font-size", "font-weight", "letter-spacing", "margin-left"] },
  { selector: ".subagent-node__task", stillMissing: ["-webkit-box-orient", "-webkit-line-clamp", "display", "font-size", "line-height", "margin-top", "overflow"] },
  { selector: ".subagent-node__term", stillMissing: ["border-radius", "flex", "font-family", "font-size", "line-height", "margin-top", "min-height", "overflow", "padding", "white-space", "word-break"] },
  { selector: ".tab__board-toggle", stillMissing: ["line-height"] },
  { selector: ".tab-lock-overlay", stillMissing: ["-webkit-app-region", "align-items", "bottom", "cursor", "display", "flex-direction", "gap", "justify-content", "left", "position", "right", "top", "z-index"] },
  { selector: ".tab-lock-overlay__title", stillMissing: ["font-size", "font-weight"] },
  { selector: ".term-chat", stillMissing: ["display", "flex-direction", "inset", "position", "z-index"] },
  { selector: ".term-chat__bar", stillMissing: ["align-items", "display", "flex", "font-size", "justify-content", "padding"] },
  { selector: ".term-chat__compose", stillMissing: ["flex", "padding"] },
  { selector: ".term-chat__empty", stillMissing: ["align-items", "display", "flex-direction", "font-size", "gap", "margin", "padding", "text-align"] },
  { selector: ".term-chat__empty-detail", stillMissing: ["font-size", "line-height", "max-width"] },
  { selector: ".term-chat__input", stillMissing: ["box-sizing", "font-family", "font-size", "padding", "resize", "width"] },
  { selector: ".term-chat__input:focus", stillMissing: ["outline"] },
  { selector: ".term-chat__msg--assistant", stillMissing: ["align-self"] },
  { selector: ".term-chat__msg--user", stillMissing: ["align-self"] },
  { selector: ".term-chat__retry", stillMissing: ["cursor", "font-size", "margin-top", "padding"] },
  { selector: ".term-chat__text pre", stillMissing: ["border-radius", "overflow-x", "padding"] },
  { selector: ".term-chat__tool", stillMissing: ["border-radius", "font-size", "margin", "padding"] },
  { selector: ".term-chat__tool-name", stillMissing: ["font-weight"] },
  { selector: ".term-copy-pill", stillMissing: ["animation", "bottom", "font-size", "font-weight", "line-height", "padding", "pointer-events", "position", "right", "z-index"] },
  { selector: ".term-md", stillMissing: ["display", "flex-direction", "inset", "position", "z-index"] },
  { selector: ".term-md__bar", stillMissing: ["align-items", "display", "font-size", "justify-content", "padding"] },
  { selector: ".term-md__content", stillMissing: ["-webkit-user-select", "cursor", "flex", "font-family", "font-size", "line-height", "min-height", "overflow", "padding", "user-select"] },
  { selector: ".term-md__content blockquote", stillMissing: ["border-left", "margin", "padding-left"] },
  { selector: ".term-md__content code", stillMissing: ["border-radius", "font-family", "font-size", "padding"] },
  { selector: ".term-md__content pre", stillMissing: ["border-radius", "overflow", "padding"] },
  { selector: ".term-md__content td", stillMissing: ["border", "padding"] },
  { selector: ".term-md__content th", stillMissing: ["border", "padding"] },
  { selector: ".term-node__mascot--pulse", stillMissing: ["filter", "opacity"] },
  { selector: ".term-ssh-chip", stillMissing: ["flex-shrink", "max-width"] },
  { selector: ".tooltip", stillMissing: ["pointer-events", "position", "transform", "z-index"] },
  { selector: ".top-banners", stillMissing: ["-webkit-app-region", "align-items", "display", "flex-direction", "gap", "left", "pointer-events", "position", "transform", "z-index"] },
  { selector: ":root", stillMissing: ["--accent", "--accent-hover", "--accent-rgb", "--accent-text", "--agent-working", "--bg", "--border", "--canvas-bg", "--canvas-dot", "--card-rgb", "--caution", "--danger", "--danger-rgb", "--git-graph-base-ref", "--git-graph-lane-1", "--git-graph-lane-2", "--git-graph-lane-3", "--git-graph-lane-4", "--git-graph-lane-5", "--git-graph-ref", "--git-graph-remote-ref", "--knob", "--md-canvas-dot", "--md-error", "--md-error-container", "--md-inverse-on-surface", "--md-inverse-primary", "--md-inverse-surface", "--md-on-error", "--md-on-error-container", "--md-on-primary", "--md-on-primary-container", "--md-on-secondary", "--md-on-secondary-container", "--md-on-success-container", "--md-on-surface", "--md-on-surface-variant", "--md-on-tertiary", "--md-on-tertiary-container", "--md-on-warning-container", "--md-outline", "--md-outline-variant", "--md-primary", "--md-primary-container", "--md-scrim", "--md-secondary", "--md-secondary-container", "--md-shadow", "--md-shape-extra-large", "--md-shape-extra-small", "--md-shape-full", "--md-shape-large", "--md-shape-medium", "--md-shape-none", "--md-shape-small", "--md-success", "--md-success-container", "--md-surface", "--md-surface-bright", "--md-surface-container", "--md-surface-container-high", "--md-surface-container-highest", "--md-surface-container-low", "--md-surface-container-lowest", "--md-surface-dim", "--md-tertiary", "--md-tertiary-container", "--md-warning", "--md-warning-container", "--menu-rgb", "--minimap-mask", "--mono", "--mono-font", "--muted", "--muted-2", "--panel", "--panel-2", "--panel-header", "--popover-rgb", "--radius", "--radius-full", "--radius-lg", "--radius-none", "--radius-sm", "--radius-xl", "--radius-xs", "--radius-xxl", "--scrim-k", "--scrim-rgb", "--shadow-k", "--success", "--surface-black", "--surface-deep", "--surface-overlay", "--surface-raised", "--surface-sunken", "--term-bg", "--text", "--text-strong", "--tint-rgb", "--warn", "--warn-rgb", "-webkit-font-smoothing", "color-scheme", "font-family", "font-size"] },
]

// ---------------------------------------------------------------------------
// The guard.
// ---------------------------------------------------------------------------

describe('styles.css duplication against styles.md3.css stays accounted for', () => {
  const bothSelectors = [...baseProps.keys()].filter((s) => md3Props.has(s))

  it('every selector present in both sheets still declares at least one base property', () => {
    // Sanity check on the parser/fixture itself: an empty base property set for a
    // selector that showed up as "present" would mean a parsing bug, not a real
    // duplicate. Every selector this sweep found had real base declarations; if
    // that stops being true the fixture below is unreliable.
    const empty = bothSelectors.filter((s) => (baseProps.get(s) as Set<string>).size === 0)
    expect(empty).toEqual([])
  })

  it('no selector md3 fully re-declares still has an unexplained base copy', () => {
    const exceptionSelectors = new Set(KNOWN_FULLY_COVERED_EXCEPTIONS.map((e) => e.selector))
    const unexplained: string[] = []
    for (const sel of bothSelectors) {
      const bp = baseProps.get(sel) as Set<string>
      const mp = md3Props.get(sel) as Set<string>
      const stillMissing = [...bp].filter((p) => !mp.has(p))
      if (stillMissing.length === 0 && !exceptionSelectors.has(sel)) unexplained.push(sel)
    }
    expect(
      unexplained,
      'styles.md3.css already re-declares every property styles.css declares, by NAME, for: ' +
        unexplained.join(', ') +
        '. Delete the now-redundant rule(s) from styles.css, or — if the base value differs in a ' +
        'way a property name alone cannot show (a calibrated alpha, an !important cascade guard, a ' +
        'documented divergence) — add it to KNOWN_FULLY_COVERED_EXCEPTIONS with the reason.'
    ).toEqual([])
  })

  it('every reasoned exception still corresponds to a real duplicated selector', () => {
    // If a KNOWN_FULLY_COVERED_EXCEPTIONS entry's selector has been edited away
    // entirely (removed from styles.css, or md3 stopped covering it), the entry
    // is stale and should be deleted rather than left to document nothing.
    const stale = KNOWN_FULLY_COVERED_EXCEPTIONS.filter((e) => !bothSelectors.includes(e.selector))
    expect(stale.map((e) => e.selector)).toEqual([])
  })

  it('every remaining partial-override selector is recorded in KNOWN_PARTIAL_OVERRIDES', () => {
    const exceptionSelectors = new Set(KNOWN_FULLY_COVERED_EXCEPTIONS.map((e) => e.selector))
    const known = new Set(KNOWN_PARTIAL_OVERRIDES.map((e) => e.selector))
    const unlisted: string[] = []
    for (const sel of bothSelectors) {
      if (exceptionSelectors.has(sel)) continue
      const bp = baseProps.get(sel) as Set<string>
      const mp = md3Props.get(sel) as Set<string>
      const stillMissing = [...bp].filter((p) => !mp.has(p))
      if (stillMissing.length === 0) continue // covered by the fully-covered test above
      if (!known.has(sel)) unlisted.push(sel + ' [' + [...bp].filter((p) => !mp.has(p)).join(', ') + ']')
    }
    expect(
      unlisted,
      'these selectors are duplicated across both sheets and only partially overridden by md3, but ' +
        'are not recorded in KNOWN_PARTIAL_OVERRIDES: ' +
        unlisted.join(', ') +
        '. Add an entry naming the properties styles.md3.css does not yet re-declare for it.'
    ).toEqual([])
  })

  it('a recorded still-missing property has not silently become fully covered by md3', () => {
    // Directional on purpose: this only fires when md3 GAINS one of the recorded
    // properties (a real "more of styles.css can now be deleted" signal). It
    // tolerates styles.css or styles.md3.css gaining unrelated new properties for
    // the same selector, so it does not flake on ordinary, unrelated CSS edits.
    const drifted: string[] = []
    for (const { selector, stillMissing } of KNOWN_PARTIAL_OVERRIDES) {
      const mp = md3Props.get(selector)
      if (!mp) continue // selector no longer duplicated at all -- nothing to check
      const nowCovered = stillMissing.filter((p) => mp.has(p))
      if (nowCovered.length > 0) drifted.push(selector + ': ' + nowCovered.join(', '))
    }
    expect(
      drifted,
      'styles.md3.css now declares a property KNOWN_PARTIAL_OVERRIDES recorded as still base-only: ' +
        drifted.join(' | ') +
        '. Either delete that now-redundant property from the base rule in styles.css and drop it ' +
        'from the recorded list, or — if it is a deliberate divergence — update the recorded ' +
        'properties to say so.'
    ).toEqual([])
  })
})
