import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards on the stylesheet's theming, written after the light theme shipped with a black canvas
 * and a dark sessions sidebar.
 *
 * The bug was not any one rule — it was the AUDIT. The literals were found by listing the most
 * frequent colours, which silently skips the ones used once: `.react-flow { background: #000000 }`
 * is the entire canvas and appeared exactly once. A test doesn't get bored at entry 26.
 */

const CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8')

/**
 * Where the light block actually starts. This MUST be anchored to the selector at the start of a
 * line: a plain `indexOf(":root[data-theme='light']")` matches the *doc comment* inside the `:root`
 * block that points at it (styles.css line ~6), which is 90 lines too early. That is not a
 * cosmetic slip — it silently hollowed out two suites below. `dark` collapsed to three lines, so
 * "the light theme overrides every themeable token" passed with an EMPTY token list for every
 * token added since; and `LIGHT` resolved to the tail of the DARK block, so the contrast floors
 * were measuring the dark palette against itself. Keep the `^` anchor.
 */
const LIGHT_BLOCK_START = CSS.search(/^:root\[data-theme='light'\]\s*\{/m)

/**
 * Everything before the end of the `:root[data-theme='light']` block — where literals belong.
 *
 * Found via regex, not a literal `'\n}\n'` `indexOf`: on a Windows checkout with
 * `core.autocrlf=true` this file is CRLF (`\r\n}\r\n`), and the literal 3-byte LF sequence never
 * occurs, so `indexOf` silently returned -1 and every test below the token block was measuring
 * against an empty/garbage slice. `\r?` matches the LF-only case identically, so this is not a
 * platform branch — it is the version of the search that was correct on both platforms all along.
 */
const CLOSE_BLOCK_RE = /\r?\n\}\r?\n/
const closeMatch = CLOSE_BLOCK_RE.exec(CSS.slice(LIGHT_BLOCK_START))
if (!closeMatch) throw new Error("could not find the end of the :root[data-theme='light'] block")
const TOKEN_BLOCK_END = LIGHT_BLOCK_START + closeMatch.index + closeMatch[0].length
const RULES = CSS.slice(TOKEN_BLOCK_END)

/** The two token blocks, sliced once. */
const DARK = CSS.slice(CSS.indexOf(':root {'), LIGHT_BLOCK_START)
const LIGHT = CSS.slice(LIGHT_BLOCK_START, TOKEN_BLOCK_END)

function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

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

/**
 * Scrims: a translucent wash whose JOB is to darken whatever is under it. Black is correct in
 * both themes, so these are the one legitimate place for a literal dark background. Listed
 * explicitly, so adding one is a decision rather than an oversight.
 */
const SCRIM_ALPHA_MAX = 0.8

describe('every opaque surface is themed', () => {
  // `background: <literal>` outside the token block. An opaque near-black or near-white here is a
  // surface that will not follow the theme — exactly the canvas/dock/sidebar failure.
  const offenders: string[] = []
  let selector = ''
  const lines = RULES.split('\n')
  lines.forEach((line, i) => {
    if (line.includes('{')) selector = line.split('{')[0].trim() || selector
    const decl = /^\s*background(?:-color)?:\s*([^;]+);/.exec(line)
    if (!decl) return
    // Drop `var(--x, <fallback>)` wholesale before looking for literals: a fallback is only
    // reached when the variable is undefined, and the previous test already proves none are.
    // An explicit `theme-exempt:` comment on the line above opts a rule out — the QR quiet zone
    // is content, not chrome, and has to stay light in both themes. A marker makes that a stated
    // decision instead of an oversight, which is the whole point of this test.
    if (lines[i - 1]?.includes('theme-exempt:') || lines[i - 2]?.includes('theme-exempt:')) return
    const value = decl[1].replace(/var\([^)]*\)/g, '')
    for (const lit of value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? []) {
      const c = parseColor(lit)
      if (!c) continue
      const extreme = c.lum < 0.25 || c.lum > 0.85
      if (extreme && c.alpha > SCRIM_ALPHA_MAX) {
        offenders.push(`${selector || '?'} (line ~${i + 1}): ${lit}`)
      }
    }
  })

  it('has no un-themed near-black or near-white background', () => {
    expect(offenders).toEqual([])
  })
})

describe('every CSS variable resolves', () => {
  // `var(--label, #fff)` looked themed and was not: `--label` never existed, so every one of those
  // sites was a hardcoded white. A referenced-but-undefined variable is either that trap or a
  // typo — unless the renderer sets it at runtime.
  const SET_FROM_JS = new Set([
    '--term-bg', // App.tsx, from the terminal theme — also now carries a real :root default (see
    // the M3 foundation section), so this entry now covers only the runtime override, not a
    // dangling reference; a hardcoded fallback at each of its three call sites is still fine.
    '--nt-rainbow-duration', // App.tsx:66, from the user's rainbow-speed setting
    '--peer-color', // presence chips, per peer
    '--group-label-boost', // GroupNode, zoom-compensated label size
    '--mascot-w',
    '--mascot-h',
    '--cmascot-w',
    '--cmascot-h',
    '--cmascot-sheet-w',
    '--cmascot-sheet-h', // notch HUD sprite sheets
    '--nt-rainbow-duration' // App.tsx, from the user's rainbow-speed setting
  ])

  it('references no variable that is never defined', () => {
    const defined = new Set(Array.from(CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm), (x) => x[1]))
    const used = new Set(Array.from(CSS.matchAll(/var\(\s*(--[a-z0-9-]+)/g), (x) => x[1]))
    const dangling = [...used].filter((v) => !defined.has(v) && !SET_FROM_JS.has(v)).sort()
    expect(dangling).toEqual([])
  })
})

describe('the light theme overrides every themeable token', () => {
  // A token defined in `:root` but absent from the light block keeps its DARK value on a light
  // page. Colour-valued tokens must appear in both; geometry (radii, fonts) is theme-independent.
  it('covers every colour token', () => {
    const dark = DARK
    const light = LIGHT
    const colourish = (decl: string): boolean =>
      /#[0-9a-f]{3,8}|rgba?\(|^\s*\d+,\s*\d+,\s*\d+\s*$/i.test(decl)

    const darkTokens = Array.from(dark.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm))
      .filter(([, , v]) => colourish(v))
      .map(([, k, v]) => [k, v] as const)
    const lightTokens = new Set(
      Array.from(light.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm), (x) => x[1])
    )

    // The git-graph lane hues are branch IDENTITY, not chrome: they must stay the same colour in
    // both themes or a graph would change meaning when the theme flips.
    // (The M3-baseline re-seed removed the `--md-tone-*` tonal-palette ladder this predicate used
    // to also exempt: every `--md-*` role is now a literal restated per theme rather than a
    // lightness-scale reference, so there is no longer a class of token that is "the same ruler in
    // both themes" — only git-graph identity colours remain genuinely theme-independent.)
    const themeIndependent = (k: string): boolean => k.startsWith('--git-graph-')
    // A token mixed ONLY from `--tint-rgb` already flips with the theme by construction — that
    // triple is itself overridden in the light block, which is the whole point of routing ~280
    // overlays through it. `--muted-2: rgba(var(--tint-rgb), 0.25)` is the live example: it is
    // deliberately NOT restated in the light block (`--muted-2` there just carries a different
    // alpha to buy back the contrast warmth cost). Requiring a redundant restatement here
    // would teach the next person to copy tokens that are already correct.
    const followsTint = (v: string): boolean =>
      /^\s*rgba?\(\s*var\(--tint-rgb\)[^)]*\)\s*$/.test(v)
    // `--term-bg` is the one token that is genuinely meant to hold the SAME literal in both
    // themes — CLAUDE.md: "terminal bodies stay dark in both themes" — so there is nothing to
    // restate in light, and a `--tint-rgb`/alias exemption would be the wrong reason for the right
    // answer. Its own runtime override (App.tsx, from the user's terminal theme) still applies to
    // both themes identically, unaffected by this exemption.
    const FIXED_IN_BOTH_THEMES = new Set(['--term-bg'])
    const missing = darkTokens
      .filter(([k]) => !lightTokens.has(k) && !themeIndependent(k) && !FIXED_IN_BOTH_THEMES.has(k))
      .filter(([, v]) => !followsTint(v))
      .map(([k]) => k)
    expect(missing).toEqual([])
  })

  // Hand-written inventory of the tokens the git history graph paints with, and the ONLY guard
  // that would notice if they were deleted.
  //
  // These are invisible to every search. GitHistoryGraphSvg carries their names as bare strings
  // without the `--` prefix (`'git-graph-lane-1'`) and assembles the reference when it paints:
  //
  //     return `var(--${color})`      // GitHistoryGraphSvg.tsx
  //
  // so neither `var(--git-graph-lane-1)` nor `'--git-graph-lane-1'` appears anywhere. A dead-token
  // sweep therefore reports all eight as referenced nowhere, and removing them would take the
  // graph's colours out behind a clean diff and a green suite — this was nearly done.
  //
  // The theme-independence check above mentions `--git-graph-` but cannot protect them: it is a
  // predicate over the keys it finds, so if the keys vanish it simply stops matching and passes.
  // That is the failure this repo names by name — a rule-shaped check catches a thing done wrongly
  // and never a thing not done at all — which is why this list is written out by hand.
  it('keeps every git-graph token the runtime-built var() depends on', () => {
    const GIT_GRAPH_TOKENS = [
      '--git-graph-ref',
      '--git-graph-remote-ref',
      '--git-graph-base-ref',
      '--git-graph-lane-1',
      '--git-graph-lane-2',
      '--git-graph-lane-3',
      '--git-graph-lane-4',
      '--git-graph-lane-5'
    ]
    // Line-based rather than a regex: a declaration is a line whose first non-space text is the
    // token followed by a colon, which needs no escaping and cannot be mangled on its way here.
    const declared = new Set(
      CSS.split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes(':'))
        .map((line) => line.slice(0, line.indexOf(':')).trim())
    )
    const missing = GIT_GRAPH_TOKENS.filter((t) => !declared.has(t))
    expect(missing, 'the git history graph builds var(--<name>) at run time; nothing else names these').toEqual([])
  })
})

describe('Material 3 token foundation', () => {
  // Hand-written inventory of every --md- role token the foundation landed with
  // (src/renderer/styles.css `:root`, the "Material Design 3 — token foundation" section).
  // Hand-written on purpose, per this repo's own completeness-guard rule: a check that only
  // inspects tokens it finds by scanning the file cannot notice one that disappeared entirely —
  // it would just quietly stop checking it. This list is what makes a deleted role a failure
  // instead of a silent shrink.
  //
  // Extended (2026-08, the M3-baseline re-seed) with the eight roles the design's
  // `design/v2/md3/tokens.css` ships that the original 38-role landing did not: the bare
  // `--md-surface-container` step (the ramp used to jump straight from `-low` to `-high`), the
  // `--md-surface-bright` step, and the three roles' "text/icon on a SOLID fill" pairs the app
  // never needed until now (`--md-on-secondary`, `--md-on-tertiary`, `--md-on-error` — the app
  // only ever needed the "on a container TINT" pairs before), plus the inverse triad
  // (`--md-inverse-surface`, `--md-inverse-on-surface`, `--md-inverse-primary`).
  const M3_ROLES = [
    // surface ramp
    '--md-surface-container-lowest',
    '--md-surface-dim',
    '--md-surface-bright',
    '--md-surface-container-low',
    '--md-surface',
    '--md-surface-container',
    '--md-surface-container-high',
    '--md-surface-container-highest',
    '--md-on-surface',
    '--md-on-surface-variant',
    '--md-outline-variant',
    '--md-outline',
    // primary
    '--md-primary',
    '--md-on-primary',
    '--md-primary-container',
    '--md-on-primary-container',
    // secondary
    '--md-secondary',
    '--md-on-secondary',
    '--md-secondary-container',
    '--md-on-secondary-container',
    // tertiary
    '--md-tertiary',
    '--md-on-tertiary',
    '--md-tertiary-container',
    '--md-on-tertiary-container',
    // error
    '--md-error',
    '--md-on-error',
    '--md-error-container',
    '--md-on-error-container',
    // custom: success / warning
    '--md-success',
    '--md-success-container',
    '--md-on-success-container',
    '--md-warning',
    '--md-warning-container',
    '--md-on-warning-container',
    // inverse
    '--md-inverse-surface',
    '--md-inverse-on-surface',
    '--md-inverse-primary',
    // scrim / shadow
    '--md-scrim',
    '--md-shadow',
    // shape scale
    '--md-shape-none',
    '--md-shape-extra-small',
    '--md-shape-small',
    '--md-shape-medium',
    '--md-shape-large',
    '--md-shape-extra-large',
    '--md-shape-full'
  ]

  /** Whether `block` (a DARK or LIGHT slice) declares `name` at all — value not inspected. */
  function definedIn(block: string, name: string): boolean {
    return new RegExp(`^\\s*${name}\\s*:`, 'm').test(block)
  }

  it('every M3 role is declared in the dark (root) block', () => {
    // Catches a role dropped from :root entirely — the case a scan-and-check test can't see,
    // because it would just stop finding the name and never flag its absence.
    const missing = M3_ROLES.filter((name) => !definedIn(DARK, name))
    expect(missing).toEqual([])
  })

  it('every M3 role is DEFINED for the light theme too — restated, alias, or a pure tint mix', () => {
    // A role counts as defined for light when any of:
    //  - it has its own literal declaration in the light block (restated, same as any other
    //    literal-valued token in this sheet), or
    //  - its dark declaration is a bare alias (`var(--other-token)`) — CSS custom-property
    //    cascade already carries an undeclared property through from `:root`, so the alias
    //    flips for free whenever the token it points at flips (or is theme-independent, like a
    //    radius), or
    //  - its dark declaration is a pure `rgba(var(--tint-rgb), α)` mix, which flips by
    //    construction because `--tint-rgb` itself is overridden in light.
    // A role satisfying none of these keeps its DARK literal value on a light page — the exact
    // silent-failure shape this whole file exists to catch (see the file banner above).
    const brokenForLight: string[] = []
    for (const name of M3_ROLES) {
      if (definedIn(LIGHT, name)) continue
      const declMatch = new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm').exec(DARK)
      if (!declMatch) {
        brokenForLight.push(name) // no dark declaration either — the block-1 test also flags this
        continue
      }
      const value = declMatch[1].trim()
      const isAlias = /^var\(--[a-z0-9-]+\)$/i.test(value)
      const isTintMix = /^rgba?\(\s*var\(--tint-rgb\)[^)]*\)$/.test(value)
      if (!isAlias && !isTintMix) brokenForLight.push(name)
    }
    expect(brokenForLight).toEqual([])
  })

  // Motion and type are NOT colour roles, so they do not belong in M3_ROLES above: the light-theme
  // test right above this one requires every entry to be either restated, a bare alias, or a
  // `--tint-rgb` mix — a category that simply does not apply to a cubic-bezier duration or a font
  // stack, which have no "light theme value" to restate and are not colours to begin with. Tracked
  // here instead, as their own hand-written inventory, so a deleted one still fails loudly rather
  // than silently passing an M3_ROLES check it was never a legitimate member of.
  const M3_DARK_ONLY_ROLES = [
    '--md-motion-spatial',
    '--md-motion-effect',
    '--md-font-ui',
    '--md-font-mono'
  ]

  it('every non-colour M3 role (motion, type) is declared once, in the dark block', () => {
    const missing = M3_DARK_ONLY_ROLES.filter((name) => !definedIn(DARK, name))
    expect(missing).toEqual([])
  })
})

// `--md-primary-container` / `--md-error-container` used to be an authored TINT of the app's own
// live accent (`rgba(var(--accent-rgb), 0.16)`), so a custom accent re-tinted them for free just
// by the CSS cascade — a former "themed container roles stay derived from their theme's own RGB
// triple" suite lived here to guard exactly that wiring. The M3-baseline re-seed makes both roles
// OPAQUE LITERALS from the design instead (see styles.css's M3 foundation section), so that
// cascade relationship no longer exists: a user-selected accent now reaches `--md-primary-container`
// only because `accentTokens.ts`'s `applyAccentTokens()` sets it explicitly, inline, alongside
// every other member of the primary family. That is a stronger and more direct guarantee than a
// regex over this stylesheet could ever give, so the invariant moved to where the guarantee
// actually lives: `lib/accentTokens.test.ts`, "a custom accent republishes the whole primary
// family" — asserting `applyAccentTokens` itself sets every one of its eight custom properties,
// not that a stylesheet declaration happens to reference the right variable name.

describe('the theme selector uses this app\'s convention, not the design doc\'s literal one', () => {
  // The design file this foundation was implemented from used `data-md-theme` as its selector.
  // This app's theme switch (App.tsx / lib/appTheme.ts) has always been `data-theme`, and every
  // existing rule in this sheet — including the M3 block itself — keys off it. A stray
  // `data-md-theme` selector copied in from the design would define tokens nobody's `<html>`
  // attribute ever matches: no build error, no runtime error, just a light theme that silently
  // keeps rendering the dark M3 values forever.
  it('never references data-md-theme', () => {
    expect(CSS.includes('data-md-theme')).toBe(false)
  })

  it('keys the light override off data-theme', () => {
    expect(CSS.includes("data-theme='light'")).toBe(true)
  })
})

/**
 * Contrast floors for the LIGHT palette.
 *
 * The light theme was originally re-tuned away from pure white surfaces with pure black ink, which
 * read as glare — first toward a warm brown ink over cream surfaces, then (2026-08, the
 * M3-baseline re-seed) toward `--md-on-surface`'s own cooler violet-grey ink over the design's own
 * off-white `surface-container` scheme. Neither pure-white surfaces nor pure-black/white ink is the
 * maximum-contrast pairing they look like, so the numbers that made each re-tune safe are asserted
 * here rather than claimed in a comment. Nudging a surface a few points paler, or an ink alpha
 * down, is exactly the kind of change that looks harmless and quietly drops body text under the
 * floor.
 */
describe('light palette contrast', () => {
  /**
   * A light-palette token — falling back to the dark block when light does not restate it.
   * That fall-back is not laxity: the only tokens light omits are ones that flip for free — a
   * bare `var(--other-token)` alias (resolved by `resolve()` below), or a value mixed purely from
   * `--tint-rgb` (`--muted-2` is the live example), which reads as the LIGHT ink here because
   * `--tint-rgb` itself is overridden. And a hue that genuinely went missing would resolve to its
   * dark-field value and fail the contrast floor below — loudly, which is the point.
   */
  function token(name: string): string {
    const re = new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm')
    const m = re.exec(LIGHT) ?? re.exec(DARK)
    if (!m) throw new Error(`neither token block defines ${name}`)
    return m[1].trim()
  }

  /**
   * Follows a chain of bare `var(--x)` aliases (`--bg` → `--md-surface`, `--panel` unchanged, …)
   * to the literal declaration underneath. Bounded rather than infinite: an accidental alias
   * cycle (two tokens pointing at each other) must fail this test loudly, not hang the runner.
   */
  function resolve(name: string): string {
    let current = name
    for (let hop = 0; hop < 8; hop += 1) {
      const raw = token(current)
      const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw)
      if (!alias) return raw
      current = alias[1]
    }
    throw new Error(`alias chain resolving ${name} did not terminate within 8 hops`)
  }

  const INK = token('--tint-rgb').split(',').map((n) => +n.trim()) as [number, number, number]

  function hex(h: string): [number, number, number] {
    const s = h.replace('#', '')
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number]
  }
  /** The ink at alpha `a`, composited over an opaque surface. */
  function inkOver(a: number, bg: [number, number, number]): [number, number, number] {
    return bg.map((c, i) => INK[i] * a + c * (1 - a)) as [number, number, number]
  }
  function luminance([r, g, b]: [number, number, number]): number {
    const f = (c: number): number => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  function contrast(a: [number, number, number], b: [number, number, number]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  /**
   * The resolved colour of a role/token as it actually paints on `bg`: either a `--tint-rgb`
   * mix composited over `bg` (the pre-M3 `--text`/`--muted` shape), or — since the tonal-palette
   * pass — an opaque literal reached by following its alias chain (`--text` → `--md-on-surface`).
   * Generic on purpose: this must keep working whichever representation a role uses today, rather
   * than asserting on which one it happens to be (the house rule against pinning behaviour to
   * source text).
   */
  function resolvedColorAt(name: string, bg: [number, number, number]): [number, number, number] {
    const raw = resolve(name)
    const tint = /^rgba\(\s*var\(--tint-rgb\)\s*,\s*([\d.]+)\s*\)$/.exec(raw)
    return tint ? inkOver(+tint[1], bg) : hex(raw)
  }

  // The two surfaces body text actually sits on. `--surface-deep` is the deepest chrome (dock,
  // modal shells) and carries labels rather than prose, so it is held to the 3:1 large-text floor.
  const SURFACES: [string, [number, number, number]][] = [
    ['--bg', hex(resolve('--bg'))],
    ['--panel', hex(resolve('--panel'))],
    ['--canvas-bg', hex(resolve('--canvas-bg'))]
  ]

  it.each(SURFACES)('body text clears WCAG AA on %s', (_name, bg) => {
    expect(contrast(resolvedColorAt('--text', bg), bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SURFACES)('secondary text clears WCAG AA on %s', (_name, bg) => {
    // This is the one the warm re-tune nearly broke: the dark theme's 0.55 measured 3.2:1 here.
    expect(contrast(resolvedColorAt('--muted', bg), bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(SURFACES)('the status hues and link accent stay legible on %s', (_name, bg) => {
    // `--agent-working` is on this list because the sidebar's project badge paints its COUNT with
    // it (`.ss-group__sig--working`) — it is text, so it owes the text floor, not the 3:1 one.
    const HUES = ['--accent-text', '--danger', '--warn', '--caution', '--success', '--agent-working']
    for (const t of HUES) {
      expect(contrast(hex(resolve(t)), bg), `${t}`).toBeGreaterThanOrEqual(4.3)
    }
  })

  it('no light surface is pure white — that brightness is the glare being avoided', () => {
    for (const t of ['--bg', '--panel', '--surface-raised', '--surface-overlay', '--canvas-bg']) {
      expect(luminance(hex(resolve(t))), t).toBeLessThan(0.97)
    }
  })

  it('the canvas and the panels stay visually distinguishable, in whichever direction the theme requires', () => {
    // Was a strict "canvas is darker than the panel" floor — true for the app's pre-M3 palette in
    // BOTH themes. Under the M3 baseline scheme `--canvas-bg` now resolves to `--md-surface`
    // (#FEF7FF light) while `--bg`/`--panel` resolve to `--md-surface-container` (#F3EDF7 light),
    // and M3's own light ramp runs the other way (see this describe block's own comment): the
    // canvas is BRIGHTER than the panel in light, and stays darker in dark — both correct, in
    // opposite directions. The rejected alternative (`--canvas-bg: var(--md-surface-dim)` for
    // light) drops `--caution` to 4.06:1 against it, under this palette's 4.3 floor — that is why
    // this direction was chosen, not because "canvas below panels" survived as a rule. What still
    // has to hold, either way, is that the two are actually distinguishable — measured here rather
    // than assumed, same as every other floor in this file. Measured: dark Δ≈0.008, light Δ≈0.085.
    const delta = Math.abs(
      luminance(hex(resolve('--canvas-bg'))) - luminance(hex(resolve('--bg')))
    )
    expect(delta).toBeGreaterThan(0.005)
  })
})

/**
 * Three contrast floors that were measured and fixed, and must not silently regress.
 *
 * The ratios here are computed with real backdrop COMPOSITING — a translucent fill blended over
 * the surface beneath it — rather than by comparing two hex values, because every one of these
 * pairs involves an `rgba()` tint. Comparing the unblended colours gives an answer that is not
 * about anything a user can see.
 *
 * Each also records WHICH floor applies, because getting that wrong is how this set was
 * misdiagnosed twice: an `aria-hidden` icon was reported as failing a 4.5:1 text floor it never
 * had to meet, and the lock button's wash was measured against the panel behind it when the pair
 * that identifies the control is the glyph against its own wash.
 */
describe('measured contrast floors', () => {
  const srgb = (c: number): number => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const rel = ([r, g, b]: number[]): number => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
  const contrast = (a: number[], b: number[]): number => {
    const [hi, lo] = [rel(a), rel(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const over = (fg: number[], alpha: number, bg: number[]): number[] =>
    fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
  const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

  /** Read a token's literal value out of one theme block. */
  const token = (block: string, name: string): string => {
    const m = new RegExp(`${name}:\s*([^;]+);`).exec(block)
    if (!m) throw new Error(`${name} not found in that theme block`)
    return m[1].trim()
  }
  /** Resolve one level of `var(--other)` aliasing — the dark block's on-primary-container is an
   *  alias, the light block's is a literal, and a helper that only understood literals reported
   *  the alias as a parse failure rather than as the value it plainly is. */
  const resolved = (block: string, name: string): string => {
    const v = token(block, name)
    const alias = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(v)
    return alias ? token(block, alias[1]) : v
  }
  const rgbTriple = (block: string, name: string): number[] =>
    token(block, name).split(',').map((n) => parseInt(n.trim(), 10))

  // `--md-primary-container` was an authored TINT of the live `--accent-rgb` before the M3-baseline
  // re-seed (`rgba(var(--accent-rgb), 0.16)`), which is why the two tests below used to composite
  // an accent-tinted WASH over a panel colour before measuring it — `containerAlpha()` read that
  // tint's alpha straight out of the stylesheet. The re-seed makes `--md-primary-container` an
  // OPAQUE LITERAL from the design instead (see styles.css's M3 foundation section), so there is no
  // wash and no alpha to extract any more: both tests below now measure a plain two-flat-colour
  // pair — the glyph/text role directly against the container colour it actually paints on.

  it('the palette secondary label clears 4.5:1 — it is real clickable text', () => {
    // <span className="palette__secondary" onClick=...> in CommandPalette.tsx: interactive text,
    // so the text floor applies, not 1.4.11's 3:1.
    for (const [theme, block] of [['dark', DARK], ['light', LIGHT]] as const) {
      const onContainer = hex(resolved(block, '--md-on-primary-container'))
      const container = hex(resolved(block, '--md-primary-container'))
      expect(
        contrast(onContainer, container),
        `${theme}: on-primary-container on its container`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the canvas lock glyph clears 3:1 against its own container', () => {
    // A non-text element identifying a control (1.4.11). It must be the ON-role, not --md-primary:
    // as --md-primary it measured 2.87:1 in light under the old app-accent palette, and no
    // container tint could rescue that. Both roles are now opaque M3 literals — measured here
    // directly, not composited over a hardcoded panel hex the way the old --accent-rgb wash was.
    expect(RULES).toMatch(
      /\.canvas-lock-btn\.locked\s*\{[^}]*color:\s*var\(--md-on-primary-container\)/
    )
    for (const [theme, block] of [['dark', DARK], ['light', LIGHT]] as const) {
      const glyph = hex(resolved(block, '--md-on-primary-container'))
      const container = hex(resolved(block, '--md-primary-container'))
      expect(contrast(glyph, container), `${theme}: lock glyph on its container`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the destructive bulk-action border clears 3:1 — it is what marks the button', () => {
    const m = /\.notif-center__bulkbar button\.danger\s*\{[^}]*border-color:\s*rgba\(var\(--danger-rgb\),\s*([\d.]+)\)/.exec(RULES)
    expect(m, 'the danger border must stay a themed --danger-rgb tint').toBeTruthy()
    const alpha = +m![1]
    for (const [theme, block] of [
      ['dark', DARK],
      ['light', LIGHT]
    ] as const) {
      const menu = String(token(block, '--menu-rgb')).split(',').map((n) => parseInt(n.trim(), 10))
      const border = over(rgbTriple(block, '--danger-rgb'), alpha, menu)
      expect(contrast(border, menu), `${theme}: danger border on the panel`).toBeGreaterThanOrEqual(3)
    }
  })
})
