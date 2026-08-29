import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards on the notch HUD's theming (docs/notch-hud.md), in the shape of ../styles.theme.test.ts
 * — but this file is NOT that one wearing a different path, because hud.css is not that kind of
 * stylesheet.
 *
 * styles.css is rendered inside the app shell, under a `<html data-theme>` that flips, so a raw
 * literal near-black/near-white slipped into a rule there is a bug: it silently keeps the DARK
 * value once someone switches to light. hud.css renders in its OWN standalone window, with no app
 * shell and no `<html data-theme>` to flip — the file's own top-of-file comment says so, because
 * the capsule it draws is physically fused to the notch, and the notch is black hardware
 * regardless of the system appearance. So hud.css is *supposed* to be permanently dark: every
 * `--md-*` role in here is a hand-picked DARK value, on purpose, forever. Copying styles.css's
 * "flag every near-extreme background" rule verbatim would flag that entire, correct, intentional
 * darkness as a defect.
 *
 * What actually needs guarding here is narrower and different:
 *  - every `background`/`background-color` RULE reads from a token, never a raw literal snuck in
 *    directly (the same "no un-themed literal" discipline, applied to a file that never themes at
 *    all rather than to one that themes twice) — see "every background rule reads from a token";
 *  - the one legitimate raw literal in the whole file, `--capsule-bg: #000`, still carries its
 *    documented `theme-exempt:` reason and has not drifted off pure black — see
 *    "the fused capsule stays pinned to #000, on purpose";
 *  - any OTHER raw near-extreme literal token — one that is not part of the collectively-exempted
 *    `--md-*` dark subset and not `--capsule-bg` — still needs its own stated reason, the same way
 *    styles.css requires one per line — see "every other near-extreme token literal is
 *    accounted for";
 *  - every `var(--x)` this file leans on actually resolves, either to a declaration in this file or
 *    to one of the six sprite-geometry variables main.ts sets at runtime (the mascot/cmascot
 *    width, height and sheet-size custom properties) — see "every referenced var resolves".
 *
 * This cannot be verified by loading the HUD window itself — it is macOS-only, native-notch
 * chrome with no build on this host, so this is a static-source check, not a rendered one.
 */

const CSS = readFileSync(join(__dirname, 'hud.css'), 'utf8')
const LINES = CSS.split('\n')

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Parses a `#hex` or `rgba?(...)` literal into { lum, alpha }. Mirrors ../styles.theme.test.ts. */
function parseColor(lit: string): { lum: number; alpha: number } | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(lit.trim())
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return {
      lum: luminance(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)),
      alpha: 1
    }
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(lit.trim())
  if (rgb) {
    return {
      lum: luminance(+rgb[1], +rgb[2], +rgb[3]),
      alpha: rgb[4] === undefined ? 1 : +rgb[4]
    }
  }
  return null
}

/** Extreme = would read as "basically black" or "basically white" if painted opaque. */
function isExtreme(c: { lum: number; alpha: number }): boolean {
  const SCRIM_ALPHA_MAX = 0.8 // a translucent wash (the scrim) is allowed to be black on purpose
  return (c.lum < 0.25 || c.lum > 0.85) && c.alpha > SCRIM_ALPHA_MAX
}

/** True when `theme-exempt:` appears on the line above, or the line above that (multi-line
 *  comments — this file's own `--capsule-bg` exemption is a two-line block comment). */
function hasExemptMarkerAbove(lineIndex: number): boolean {
  return /theme-exempt:/.test(LINES[lineIndex - 1] ?? '') || /theme-exempt:/.test(LINES[lineIndex - 2] ?? '')
}

interface TokenDecl {
  name: string
  value: string
  lineIndex: number // 0-based index into LINES
  exempt: boolean
}

/**
 * Every `--name: value;` custom-property declaration in the file, in source order.
 *
 * Scanned over the WHOLE text with a non-greedy `[\s\S]*?` up to the next `;`, not line by line —
 * `--hud-mono`'s value wraps onto a second line (the font stack is long), so a single-line regex
 * silently drops it from `defined`, and the "every referenced var resolves" test below then
 * reports the file's own font token as a dangling reference to itself.
 */
const TOKENS: TokenDecl[] = []
const TOKEN_DECL_RE = /^[ \t]*(--[a-z0-9-]+)[ \t]*:[ \t]*([\s\S]*?);/gm
let tokenMatch: RegExpExecArray | null
while ((tokenMatch = TOKEN_DECL_RE.exec(CSS))) {
  const lineIndex = CSS.slice(0, tokenMatch.index).split('\n').length - 1
  TOKENS.push({
    name: tokenMatch[1],
    value: tokenMatch[2].replace(/\s+/g, ' ').trim(),
    lineIndex,
    exempt: hasExemptMarkerAbove(lineIndex)
  })
}
const TOKEN_BY_NAME = new Map(TOKENS.map((t) => [t.name, t]))

describe('every background rule reads from a token', () => {
  // Same mechanic as ../styles.theme.test.ts's "every opaque surface is themed": strip every
  // var(...) out of a `background`/`background-color` declaration, then look at what literal
  // colour text is left. A rule using a token leaves nothing; a rule with a raw colour pasted in
  // (instead of, or alongside, a token) leaves that literal behind for this to catch.
  const offenders: string[] = []
  let selector = ''
  LINES.forEach((line, i) => {
    if (line.includes('{')) selector = line.split('{')[0].trim() || selector
    const decl = /^\s*background(?:-color)?:\s*([^;]+);/.exec(line)
    if (!decl) return
    if (hasExemptMarkerAbove(i)) return
    const value = decl[1].replace(/var\([^)]*\)/g, '')
    for (const lit of value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? []) {
      offenders.push(`${selector || '?'} (hud.css:${i + 1}): ${lit}`)
    }
  })

  it('has no un-themed background literal outside a token', () => {
    expect(offenders).toEqual([])
  })
})

describe('the fused capsule stays pinned to #000, on purpose', () => {
  // A generic scan cannot notice a value quietly drifting away from the one thing that makes it
  // safe (pure opaque black, seamless against the notch's own black) — it can only notice that
  // SOMETHING is declared. So this is hand-written, the same way ../styles.theme.test.ts hand-
  // writes the git-graph token inventory: the check that would catch a thing done wrongly is not
  // the same check that catches a thing quietly no longer being what it claims to be.
  it('declares --capsule-bg as exactly opaque black', () => {
    const token = TOKEN_BY_NAME.get('--capsule-bg')
    expect(token, '--capsule-bg must still be declared in hud.css').toBeTruthy()
    expect(token!.value).toBe('#000')
  })

  it('carries a theme-exempt: marker naming notch fusion as the reason', () => {
    const token = TOKEN_BY_NAME.get('--capsule-bg')
    expect(token, '--capsule-bg must still be declared in hud.css').toBeTruthy()
    expect(token!.exempt).toBe(true)
    const commentLines = [LINES[token!.lineIndex - 1] ?? '', LINES[token!.lineIndex - 2] ?? ''].join('\n')
    expect(commentLines).toMatch(/notch/i)
  })

  it('is actually used to paint the capsule, not just declared and orphaned', () => {
    expect(CSS).toMatch(/\.hud-capsule\s*\{[^}]*background:\s*var\(--capsule-bg\)/s)
  })
})

describe('every other near-extreme token literal is accounted for', () => {
  // Every `--md-*` role in this file is collectively exempt: the file's own banner comment
  // (right above the M3 subset) states, once, that the whole document is permanently dark and
  // why — no `<html data-theme>` exists here for it to flip against. That banner is itself the
  // marker; requiring a *second* per-token `theme-exempt:` comment on each of the dozen dark
  // `--md-*` roles would just be noise repeating what the file already says once. Anything
  // NOT under that umbrella (a bespoke, non-`--md-` token) gets no free pass and needs its own
  // stated reason, exactly like --capsule-bg has.
  const MD3_BANNER_RE = /M3 dark-token subset[\s\S]{0,400}no <html data-theme> to key off/
  it('the file states its collective dark-token exemption once, in the M3 subset banner', () => {
    expect(CSS).toMatch(MD3_BANNER_RE)
  })

  it('has no unexplained near-black/near-white literal outside the --md-* subset', () => {
    const offenders: string[] = []
    for (const token of TOKENS) {
      if (token.name.startsWith('--md-')) continue // collectively covered by the banner above
      if (token.exempt) continue // has its own stated reason (e.g. --capsule-bg)
      const literals = token.value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? []
      for (const lit of literals) {
        const c = parseColor(lit)
        if (c && isExtreme(c)) offenders.push(`${token.name} (hud.css:${token.lineIndex + 1}): ${lit}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('every referenced var resolves', () => {
  // `--mascot-w`/`--mascot-h`/`--cmascot-w`/`--cmascot-h`/`--cmascot-sheet-w`/`--cmascot-sheet-h`
  // have no default in hud.css at all — main.ts's quadrantMascot()/codexMascot() set them per
  // element via el.style.setProperty() before the sprite is ever painted, sized off the sprite's
  // own aspect ratio. Anything else referenced-but-undeclared is either a stale rename or a typo,
  // the same distinction ../styles.theme.test.ts's SET_FROM_JS list draws for the app shell.
  const SET_FROM_JS = new Set([
    '--mascot-w',
    '--mascot-h',
    '--cmascot-w',
    '--cmascot-h',
    '--cmascot-sheet-w',
    '--cmascot-sheet-h'
  ])

  it('references no variable that is never defined', () => {
    const defined = new Set(TOKENS.map((t) => t.name))
    const used = new Set(Array.from(CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g), (x) => x[1]))
    const dangling = [...used].filter((v) => !defined.has(v) && !SET_FROM_JS.has(v)).sort()
    expect(dangling).toEqual([])
  })

  // The inverse gap: a JS-set variable this file no longer reads at all is a stale entry in
  // SET_FROM_JS above, not a real HUD behaviour — keep the list honest in both directions.
  it('every JS-set variable is actually referenced somewhere', () => {
    const used = new Set(Array.from(CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g), (x) => x[1]))
    const unused = [...SET_FROM_JS].filter((v) => !used.has(v)).sort()
    expect(unused).toEqual([])
  })
})
