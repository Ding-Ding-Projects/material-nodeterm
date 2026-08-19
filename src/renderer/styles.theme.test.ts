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
    '--term-bg', // App.tsx, from the terminal theme
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
    // both themes or a graph would change meaning when the theme flips. `--md-tone-*` are the raw
    // M3 tonal-palette scale (styles.css "Material Design 3 — tonal palettes"): HCT's "tone" is
    // defined as the same quantity as Lab's L*, so a tonal SCALE is a fixed ladder of lightness
    // steps for one hue/chroma — it does not have a "light theme value", any more than a ruler
    // does. What changes per theme is which TONE a role picks (e.g. `--md-on-surface` reads tone
    // 90 in dark and tone 10 in light), and those role tokens each carry their own literal
    // restatement below — this predicate is only about the reference ladder itself.
    const themeIndependent = (k: string): boolean =>
      k.startsWith('--git-graph-') || k.startsWith('--md-tone-')
    // A token mixed ONLY from `--tint-rgb` already flips with the theme by construction — that
    // triple is itself overridden in the light block, which is the whole point of routing ~280
    // overlays through it. `--muted-2: rgba(var(--tint-rgb), 0.25)` is the live example: it is
    // deliberately NOT restated in the light block (`--muted-2` there just carries a different
    // alpha to buy back the contrast warmth cost). Requiring a redundant restatement here
    // would teach the next person to copy tokens that are already correct.
    const followsTint = (v: string): boolean =>
      /^\s*rgba?\(\s*var\(--tint-rgb\)[^)]*\)\s*$/.test(v)
    const missing = darkTokens
      .filter(([k]) => !lightTokens.has(k) && !themeIndependent(k))
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
  // (src/renderer/styles.css `:root`, the "Material Design 3 — colour roles" +
  // "shape scale" sections). Hand-written on purpose, per this repo's own completeness-guard
  // rule: a check that only inspects tokens it finds by scanning the file cannot notice one that
  // disappeared entirely — it would just quietly stop checking it. This list is what makes a
  // deleted role a failure instead of a silent shrink.
  const M3_ROLES = [
    // surface ramp
    '--md-surface-container-lowest',
    '--md-surface-dim',
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
    '--md-secondary-container',
    '--md-on-secondary-container',
    // tertiary
    '--md-tertiary',
    '--md-tertiary-container',
    '--md-on-tertiary-container',
    // error
    '--md-error',
    '--md-error-container',
    '--md-on-error-container',
    // custom: success / warning
    '--md-success',
    '--md-success-container',
    '--md-on-success-container',
    '--md-warning',
    '--md-warning-container',
    '--md-on-warning-container',
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
})

describe('themed container roles stay derived from their theme\'s own RGB triple', () => {
  // `--md-primary-container` / `--md-error-container` are neither a bare alias (`var(--x)` alone)
  // nor a pure `--tint-rgb` mix, so the "every M3 role is DEFINED for light" test above only
  // requires SOME declaration to exist in the light block — it would happily accept
  // `--md-primary-container: rgba(10, 132, 255, 0.16);` there, a hardcoded copy of the DARK
  // triple. That is the exact bug this M3 pass fixed at `.dock-btn.active`,
  // `.canvas-lock-btn.locked` and `.welcome__recent-del:hover`: each previously carried a literal
  // dark-tuned `rgba(10, 132, 255, …)` / `rgba(255, 69, 58, …)` background that never flipped for
  // light, so a light-mode user saw the dark theme's blue/red tint baked in. A future edit that
  // "restates" these container roles for light with a pasted-in fixed triple instead of
  // `var(--accent-rgb)` / `var(--danger-rgb)` would reintroduce that bug and pass every other test
  // in this file — this is the one check that would catch it.
  const DERIVED_CONTAINERS: [string, string][] = [
    ['--md-primary-container', '--accent-rgb'],
    ['--md-error-container', '--danger-rgb']
  ]

  it.each(DERIVED_CONTAINERS)('%s stays wired to var(%s) in both themes', (role, rgbToken) => {
    const re = new RegExp(`^\\s*${role}\\s*:\\s*([^;]+);`, 'm')
    for (const [label, block] of [['dark', DARK], ['light', LIGHT]] as const) {
      const m = re.exec(block)
      expect(m, `${role} has no declaration in the ${label} block`).toBeTruthy()
      expect(
        m![1],
        `${role} in the ${label} block should read var(${rgbToken}), not a hardcoded triple`
      ).toContain(`var(${rgbToken})`)
    }
  })
})

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
 * The light theme was re-tuned warm because pure white surfaces with pure black ink read as glare.
 * Warmth costs contrast — brown on cream is a shorter range than black on white — so the numbers
 * that made the re-tune safe are asserted here rather than claimed in a comment. Nudging a surface
 * a few points paler, or an ink alpha down, is exactly the kind of change that looks harmless and
 * quietly drops body text under the floor.
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

  it('the canvas sits below the panels, so nodes keep their edges', () => {
    expect(luminance(hex(resolve('--canvas-bg')))).toBeLessThan(luminance(hex(resolve('--bg'))))
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

  /** The container alpha, read from the stylesheet rather than hardcoded here. */
  const containerAlpha = (): number => {
    const m = /--md-primary-container:\s*rgba\(var\(--accent-rgb\),\s*([\d.]+)\)/.exec(DARK)
    if (!m) throw new Error('--md-primary-container is no longer an --accent-rgb tint')
    return +m[1]
  }

  it('the palette secondary label clears 4.5:1 — it is real clickable text', () => {
    // <span className="palette__secondary" onClick=...> in CommandPalette.tsx: interactive text,
    // so the text floor applies, not 1.4.11's 3:1.
    const a = containerAlpha()
    const cases: Array<[string, string, number[], string]> = [
      ['dark', resolved(DARK, '--md-on-primary-container'), rgbTriple(DARK, '--accent-rgb'), token(DARK, '--menu-rgb')],
      ['light', resolved(LIGHT, '--md-on-primary-container'), rgbTriple(LIGHT, '--accent-rgb'), token(LIGHT, '--menu-rgb')]
    ]
    for (const [theme, onC, accent, menu] of cases) {
      const bg = over(accent, a, String(menu).split(',').map((n) => parseInt(n.trim(), 10)))
      const ratio = contrast(hex(onC), bg)
      expect(ratio, `${theme}: on-primary-container on its container`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the canvas lock glyph clears 3:1 against its own wash', () => {
    // A non-text element identifying a control (1.4.11). It must be the ON-role, not --md-primary:
    // as --md-primary it measured 2.87:1 in light, and no container alpha can rescue that — a tint
    // of the accent over the same panel only reaches 1.52:1 against the panel even at 0.32.
    expect(RULES).toMatch(
      /\.canvas-lock-btn\.locked\s*\{[^}]*color:\s*var\(--md-on-primary-container\)/
    )
    const a = containerAlpha()
    for (const [theme, block, panelHex] of [
      ['dark', DARK, '#282828'],
      ['light', LIGHT, '#f3efe7']
    ] as const) {
      const panel = hex(panelHex)
      const wash = over(rgbTriple(block, '--accent-rgb'), a, panel)
      const glyph = hex(resolved(block, '--md-on-primary-container'))
      expect(contrast(glyph, wash), `${theme}: lock glyph on its wash`).toBeGreaterThanOrEqual(3)
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
