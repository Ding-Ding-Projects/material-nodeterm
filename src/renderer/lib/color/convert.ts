/**
 * Colour conversion core for the infinite colour picker (docs/colour-picker.md).
 *
 * Everything here is PURE — no DOM, no React — so the picker component is a thin layer over it
 * and the math can be reasoned about (and reused, e.g. by the app-logo background picker) on its
 * own. The internal working representation is `RGBA` (0..255 channels, 0..1 alpha, straight
 * alpha, sRGB) — every other space is a view onto it, translated on demand.
 *
 * Gamut: sRGB is the only gamut this app can actually DISPLAY in (CSS `color()`/wide-gamut
 * support varies by platform and this UI targets one consistent behaviour everywhere), so it is
 * the reference gamut for clipping warnings. Lab/LCH/OKLab/OKLCH can express colours outside it;
 * `fromLab`/`fromOklch` etc. report `clipped: true` when the nearest representable sRGB value
 * differs from the mathematically exact one, so the UI can warn BEFORE committing to the clipped
 * value rather than silently rounding.
 */

export interface RGBA {
  r: number // 0..255
  g: number // 0..255
  b: number // 0..255
  a: number // 0..1
}

export interface ClipResult<T> {
  value: T
  /** True when the exact value was outside sRGB and had to be clamped to fit. */
  clipped: boolean
}

// ---------------------------------------------------------------------------------------------
// sRGB <-> hex
// ---------------------------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round(n: number): number {
  return Math.round(n)
}

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (case-insensitive, `#` optional). Returns null
 *  for anything else — the caller decides how to report an invalid entry. */
export function parseHex(input: string): RGBA | null {
  const s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  const expand = (c: string) => c + c
  if (s.length === 3) {
    const [r, g, b] = s.split('').map(expand)
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: 1 }
  }
  if (s.length === 4) {
    const [r, g, b, a] = s.split('').map(expand)
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: parseInt(a, 16) / 255 }
  }
  if (s.length === 6) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: 1
    }
  }
  if (s.length === 8) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
      a: parseInt(s.slice(6, 8), 16) / 255
    }
  }
  return null
}

function toHexByte(n: number): string {
  return clamp(round(n), 0, 255).toString(16).padStart(2, '0')
}

export function toHex(c: RGBA, withAlpha = false): string {
  const base = `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}`
  if (!withAlpha) return base
  return `${base}${toHexByte(c.a * 255)}`
}

// ---------------------------------------------------------------------------------------------
// RGB <-> HSL / HSV / HWB
// ---------------------------------------------------------------------------------------------

export interface HSL {
  h: number // 0..360
  s: number // 0..1
  l: number // 0..1
  a: number
}
export interface HSV {
  h: number
  s: number
  v: number
  a: number
}
export interface HWB {
  h: number
  w: number
  b: number
  a: number
}

export function rgbToHsv(c: RGBA): HSV {
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const v = max
  const s = max === 0 ? 0 : d / max
  return { h, s, v, a: c.a }
}

export function hsvToRgb(c: HSV): RGBA {
  const h = ((c.h % 360) + 360) % 360
  const s = clamp(c.s, 0, 1)
  const v = clamp(c.v, 0, 1)
  const k = (n: number) => (n + h / 60) % 6
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255, a: c.a }
}

export function rgbToHsl(c: RGBA): HSL {
  const { h, s: sv, v } = rgbToHsv(c)
  const l = v - (v * sv) / 2
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
  return { h, s, l, a: c.a }
}

export function hslToRgb(c: HSL): RGBA {
  const l = clamp(c.l, 0, 1)
  const s = clamp(c.s, 0, 1)
  const v = l + s * Math.min(l, 1 - l)
  const sv = v === 0 ? 0 : 2 * (1 - l / v)
  return hsvToRgb({ h: c.h, s: sv, v, a: c.a })
}

export function rgbToHwb(c: RGBA): HWB {
  const { h } = rgbToHsv(c)
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255
  const w = Math.min(r, g, b)
  const bl = 1 - Math.max(r, g, b)
  return { h, w, b: bl, a: c.a }
}

export function hwbToRgb(c: HWB): RGBA {
  const w = clamp(c.w, 0, 1)
  const bl = clamp(c.b, 0, 1)
  if (w + bl >= 1) {
    const gray = w / (w + bl)
    return { r: gray * 255, g: gray * 255, b: gray * 255, a: c.a }
  }
  const rgb = hsvToRgb({ h: c.h, s: 1, v: 1, a: c.a })
  const scale = (ch: number) => (ch / 255) * (1 - w - bl) + w
  return { r: scale(rgb.r) * 255, g: scale(rgb.g) * 255, b: scale(rgb.b) * 255, a: c.a }
}

// ---------------------------------------------------------------------------------------------
// sRGB <-> linear sRGB <-> XYZ (D65) <-> Lab <-> LCH
// ---------------------------------------------------------------------------------------------

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return c * 255
}

export interface XYZ {
  x: number
  y: number
  z: number
}

export function rgbToXyz(c: RGBA): XYZ {
  const r = srgbToLinear(c.r),
    g = srgbToLinear(c.g),
    b = srgbToLinear(c.b)
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    z: r * 0.0193339 + g * 0.119192 + b * 0.9503041
  }
}

export function xyzToRgb(v: XYZ, a = 1): RGBA {
  const r = v.x * 3.2404542 + v.y * -1.5371385 + v.z * -0.4985314
  const g = v.x * -0.969266 + v.y * 1.8760108 + v.z * 0.041556
  const b = v.x * 0.0556434 + v.y * -0.2040259 + v.z * 1.0572252
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), a }
}

// D65 reference white.
const WHITE = { x: 0.95047, y: 1.0, z: 1.08883 }

export interface Lab {
  l: number // 0..100
  a: number // roughly -125..125
  b: number // roughly -125..125
  alpha: number
}

function labF(t: number): number {
  const d = 6 / 29
  return t > d ** 3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29
}
function labFInv(t: number): number {
  const d = 6 / 29
  return t > d ? t ** 3 : 3 * d * d * (t - 4 / 29)
}

export function xyzToLab(v: XYZ, alpha = 1): Lab {
  const fx = labF(v.x / WHITE.x)
  const fy = labF(v.y / WHITE.y)
  const fz = labF(v.z / WHITE.z)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz), alpha }
}
export function labToXyz(c: Lab): XYZ {
  const fy = (c.l + 16) / 116
  const fx = fy + c.a / 500
  const fz = fy - c.b / 200
  return { x: labFInv(fx) * WHITE.x, y: labFInv(fy) * WHITE.y, z: labFInv(fz) * WHITE.z }
}

export function rgbToLab(c: RGBA): Lab {
  return xyzToLab(rgbToXyz(c), c.a)
}
export function labToRgbClamped(c: Lab): ClipResult<RGBA> {
  const exact = xyzToRgb(labToXyz(c), c.alpha)
  const clippedR = clamp(exact.r, 0, 255)
  const clippedG = clamp(exact.g, 0, 255)
  const clippedB = clamp(exact.b, 0, 255)
  const clipped = clippedR !== exact.r || clippedG !== exact.g || clippedB !== exact.b
  return { value: { r: clippedR, g: clippedG, b: clippedB, a: exact.a }, clipped }
}

export interface LCH {
  l: number
  c: number
  h: number // degrees
  alpha: number
}
export function labToLch(c: Lab): LCH {
  const h = (Math.atan2(c.b, c.a) * 180) / Math.PI
  return { l: c.l, c: Math.hypot(c.a, c.b), h: h < 0 ? h + 360 : h, alpha: c.alpha }
}
export function lchToLab(c: LCH): Lab {
  const hr = (c.h * Math.PI) / 180
  return { l: c.l, a: c.c * Math.cos(hr), b: c.c * Math.sin(hr), alpha: c.alpha }
}
export function rgbToLch(c: RGBA): LCH {
  return labToLch(rgbToLab(c))
}
export function lchToRgbClamped(c: LCH): ClipResult<RGBA> {
  return labToRgbClamped(lchToLab(c))
}

// ---------------------------------------------------------------------------------------------
// OKLab / OKLCH (Björn Ottosson's formulation)
// ---------------------------------------------------------------------------------------------

export interface OKLab {
  l: number // 0..1
  a: number // roughly -0.4..0.4
  b: number
  alpha: number
}
export interface OKLCH {
  l: number
  c: number
  h: number
  alpha: number
}

export function rgbToOklab(c: RGBA): OKLab {
  const r = srgbToLinear(c.r),
    g = srgbToLinear(c.g),
    b = srgbToLinear(c.b)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l),
    m_ = Math.cbrt(m),
    s_ = Math.cbrt(s)
  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    alpha: c.a
  }
}

export function oklabToRgb(c: OKLab): ClipResult<RGBA> {
  const l_ = c.l + 0.3963377774 * c.a + 0.2158037573 * c.b
  const m_ = c.l - 0.1055613458 * c.a - 0.0638541728 * c.b
  const s_ = c.l - 0.0894841775 * c.a - 1.291485548 * c.b
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const exact = { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), a: c.alpha }
  const cr = clamp(exact.r, 0, 255),
    cg = clamp(exact.g, 0, 255),
    cb = clamp(exact.b, 0, 255)
  const clipped = cr !== exact.r || cg !== exact.g || cb !== exact.b
  return { value: { r: cr, g: cg, b: cb, a: exact.a }, clipped }
}

export function oklabToOklch(c: OKLab): OKLCH {
  const h = (Math.atan2(c.b, c.a) * 180) / Math.PI
  return { l: c.l, c: Math.hypot(c.a, c.b), h: h < 0 ? h + 360 : h, alpha: c.alpha }
}
export function oklchToOklab(c: OKLCH): OKLab {
  const hr = (c.h * Math.PI) / 180
  return { l: c.l, a: c.c * Math.cos(hr), b: c.c * Math.sin(hr), alpha: c.alpha }
}
export function rgbToOklch(c: RGBA): OKLCH {
  return oklabToOklch(rgbToOklab(c))
}
export function oklchToRgbClamped(c: OKLCH): ClipResult<RGBA> {
  return oklabToRgb(oklchToOklab(c))
}

// ---------------------------------------------------------------------------------------------
// CMYK (naive device-independent conversion — there is no ICC profile involved; this is the
// same formula every CSS/print-preview tool uses for an approximate on-screen CMYK readout).
// ---------------------------------------------------------------------------------------------

export interface CMYK {
  c: number // 0..1
  m: number
  y: number
  k: number
  a: number
}

export function rgbToCmyk(c: RGBA): CMYK {
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1, a: c.a }
  return {
    c: (1 - r - k) / (1 - k),
    m: (1 - g - k) / (1 - k),
    y: (1 - b - k) / (1 - k),
    k,
    a: c.a
  }
}
export function cmykToRgb(c: CMYK): RGBA {
  const k = clamp(c.k, 0, 1)
  const cc = clamp(c.c, 0, 1),
    mm = clamp(c.m, 0, 1),
    yy = clamp(c.y, 0, 1)
  return {
    r: 255 * (1 - cc) * (1 - k),
    g: 255 * (1 - mm) * (1 - k),
    b: 255 * (1 - yy) * (1 - k),
    a: c.a
  }
}

// ---------------------------------------------------------------------------------------------
// CSS text formats
// ---------------------------------------------------------------------------------------------

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export function toRgbString(c: RGBA): string {
  const r = round(c.r),
    g = round(c.g),
    b = round(c.b)
  return c.a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${fmt(c.a, 3)})`
}
export function toHslString(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c)
  const str = `${fmt(h, 1)}, ${fmt(s * 100, 1)}%, ${fmt(l * 100, 1)}%`
  return c.a >= 1 ? `hsl(${str})` : `hsla(${str}, ${fmt(c.a, 3)})`
}
export function toHsvString(c: RGBA): string {
  const { h, s, v } = rgbToHsv(c)
  return `hsv(${fmt(h, 1)}, ${fmt(s * 100, 1)}%, ${fmt(v * 100, 1)}%${c.a < 1 ? `, ${fmt(c.a, 3)}` : ''})`
}
export function toHwbString(c: RGBA): string {
  const { h, w, b } = rgbToHwb(c)
  return `hwb(${fmt(h, 1)} ${fmt(w * 100, 1)}% ${fmt(b * 100, 1)}%${c.a < 1 ? ` / ${fmt(c.a, 3)}` : ''})`
}
export function toLabString(c: RGBA): string {
  const l = rgbToLab(c)
  return `lab(${fmt(l.l, 1)}% ${fmt(l.a, 1)} ${fmt(l.b, 1)}${c.a < 1 ? ` / ${fmt(c.a, 3)}` : ''})`
}
export function toLchString(c: RGBA): string {
  const l = rgbToLch(c)
  return `lch(${fmt(l.l, 1)}% ${fmt(l.c, 1)} ${fmt(l.h, 1)}${c.a < 1 ? ` / ${fmt(c.a, 3)}` : ''})`
}
export function toOklabString(c: RGBA): string {
  const l = rgbToOklab(c)
  return `oklab(${fmt(l.l, 3)} ${fmt(l.a, 3)} ${fmt(l.b, 3)}${c.a < 1 ? ` / ${fmt(c.a, 3)}` : ''})`
}
export function toOklchString(c: RGBA): string {
  const l = rgbToOklch(c)
  return `oklch(${fmt(l.l, 3)} ${fmt(l.c, 3)} ${fmt(l.h, 1)}${c.a < 1 ? ` / ${fmt(c.a, 3)}` : ''})`
}
export function toCmykString(c: RGBA): string {
  const k = rgbToCmyk(c)
  return `cmyk(${fmt(k.c * 100, 1)}%, ${fmt(k.m * 100, 1)}%, ${fmt(k.y * 100, 1)}%, ${fmt(k.k * 100, 1)}%)`
}

// ---------------------------------------------------------------------------------------------
// Named colours — the full CSS Color Module Level 4 extended keyword set, both directions.
// ---------------------------------------------------------------------------------------------

export const CSS_NAMED_COLORS: Readonly<Record<string, string>> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899',
  lightslategrey: '#778899', lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00',
  limegreen: '#32cd32', linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000',
  mediumaquamarine: '#66cdaa', mediumblue: '#0000cd', mediumorchid: '#ba55d3',
  mediumpurple: '#9370db', mediumseagreen: '#3cb371', mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000',
  olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee',
  palevioletred: '#db7093', papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f',
  pink: '#ffc0cb', plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080',
  rebeccapurple: '#663399', red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1',
  saddlebrown: '#8b4513', salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57',
  seashell: '#fff5ee', sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb',
  slateblue: '#6a5acd', slategray: '#708090', slategrey: '#708090', snow: '#fffafa',
  springgreen: '#00ff7f', steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080',
  thistle: '#d8bfd8', tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee',
  wheat: '#f5deb3', white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00',
  yellowgreen: '#9acd32', transparent: '#00000000'
}

const HEX_TO_NAME: Map<string, string> = new Map(
  Object.entries(CSS_NAMED_COLORS)
    .filter(([name]) => name !== 'transparent') // many aliases share a hex; keep the first name.
    .reduce<[string, string][]>((acc, [name, hex]) => {
      if (!acc.some(([, h]) => h === hex.toLowerCase())) acc.push([hex.toLowerCase(), name])
      return acc
    }, [])
)

/** The CSS named colour for an exact opaque match, else null (not every colour has one). */
export function toNamedColor(c: RGBA): string | null {
  if (c.a < 1) return null
  return HEX_TO_NAME.get(toHex(c).toLowerCase()) ?? null
}

/** Best-effort parse of ANY of the supported textual formats (hex, rgb()/rgba(), hsl()/hsla(),
 *  hsv()/hsb(), hwb(), lab(), lch(), oklab(), oklch(), a CSS named colour). Returns null for
 *  anything unrecognised — the caller decides how to surface an invalid entry (never partially
 *  applied). */
export function parseAnyColor(input: string): RGBA | null {
  const s = input.trim()
  if (!s) return null
  const lower = s.toLowerCase()
  if (lower in CSS_NAMED_COLORS) return parseHex(CSS_NAMED_COLORS[lower])
  if (/^#/.test(s) || /^[0-9a-fA-F]{3,8}$/.test(s)) return parseHex(s)
  const nums = (str: string) => str.match(/-?[\d.]+%?/g) ?? []
  const pct = (tok: string, max = 1) => (tok.endsWith('%') ? (parseFloat(tok) / 100) * max : parseFloat(tok))
  const m = /^([a-z]+)\(([^)]*)\)$/i.exec(s)
  if (!m) return null
  const fn = m[1].toLowerCase()
  const parts = nums(m[2])
  // `parts[i]` is `string | undefined` under noUncheckedIndexedAccess, and the two problems are
  // the same problem: a malformed `rgb(1,2)` would otherwise read the missing third component as
  // `undefined`, `parseFloat` it to NaN, and hand back a colour built from nonsense. `need()`
  // demands the component count each function actually takes and bails to `null` instead — a
  // colour we cannot parse is not a colour we should guess at.
  const need = (n: number): boolean => parts.length >= n
  const at = (i: number): string => parts[i] as string
  const alphaFrom = (i: number, count: number) => (parts.length > count ? pct(at(i), 1) : 1)
  try {
    if (fn === 'rgb' || fn === 'rgba') {
      if (!need(3)) return null
      return {
        r: pct(at(0), 255),
        g: pct(at(1), 255),
        b: pct(at(2), 255),
        a: alphaFrom(3, 3)
      }
    }
    if (fn === 'hsl' || fn === 'hsla') {
      if (!need(3)) return null
      return hslToRgb({
        h: parseFloat(at(0)),
        s: pct(at(1)),
        l: pct(at(2)),
        a: alphaFrom(3, 3)
      })
    }
    if (fn === 'hsv' || fn === 'hsb') {
      if (!need(3)) return null
      return hsvToRgb({
        h: parseFloat(at(0)),
        s: pct(at(1)),
        v: pct(at(2)),
        a: alphaFrom(3, 3)
      })
    }
    if (fn === 'hwb') {
      if (!need(3)) return null
      return hwbToRgb({
        h: parseFloat(at(0)),
        w: pct(at(1)),
        b: pct(at(2)),
        a: alphaFrom(3, 3)
      })
    }
    if (fn === 'lab') {
      if (!need(3)) return null
      return labToRgbClamped({
        l: parseFloat(at(0)),
        a: parseFloat(at(1)),
        b: parseFloat(at(2)),
        alpha: alphaFrom(3, 3)
      }).value
    }
    if (fn === 'lch') {
      if (!need(3)) return null
      return lchToRgbClamped({
        l: parseFloat(at(0)),
        c: parseFloat(at(1)),
        h: parseFloat(at(2)),
        alpha: alphaFrom(3, 3)
      }).value
    }
    if (fn === 'oklab') {
      if (!need(3)) return null
      return oklabToRgb({
        l: parseFloat(at(0)),
        a: parseFloat(at(1)),
        b: parseFloat(at(2)),
        alpha: alphaFrom(3, 3)
      }).value
    }
    if (fn === 'oklch') {
      if (!need(3)) return null
      return oklchToRgbClamped({
        l: parseFloat(at(0)),
        c: parseFloat(at(1)),
        h: parseFloat(at(2)),
        alpha: alphaFrom(3, 3)
      }).value
    }
    if (fn === 'cmyk') {
      if (!need(4)) return null
      return cmykToRgb({
        c: pct(at(0)),
        m: pct(at(1)),
        y: pct(at(2)),
        k: pct(at(3)),
        a: alphaFrom(4, 4)
      })
    }
  } catch {
    return null
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Contrast (WCAG 2.x relative luminance / contrast ratio)
// ---------------------------------------------------------------------------------------------

export function relativeLuminance(c: RGBA): number {
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** WCAG contrast ratio, 1..21. Ignores alpha (contrast is only meaningful once a colour is
 *  composited onto something opaque — callers pass already-flattened colours). */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Flattens `fg` (possibly translucent) over an opaque `bg`, for contrast/preview purposes. */
export function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1
  }
}

export function contrastLabel(ratio: number): 'AAA' | 'AA' | 'AA Large' | 'Fail' {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA Large'
  return 'Fail'
}
