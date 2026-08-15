// site/app/core/color.js
//
// The math behind the infinite color picker's translator: bidirectional
// conversion among HEX/HEX8, RGB(A), HSL(A), HSV, HWB, CIELAB/LCH,
// OKLab/OKLCH and CMYK, all rooted in sRGB (D65). CMYK is the naive
// subtractive device-independent approximation every browser-side picker
// uses (there is no single "correct" CMYK without a real ICC profile) —
// documented here rather than silently pretended to be press-accurate.
//
// Every public function takes/returns plain numbers so this module has
// zero DOM dependency and can be sanity-checked by reading it.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ---- sRGB <-> linear RGB ----------------------------------------------
function srgbToLinear(c8) {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function linearToSrgb(cLin) {
  const c = clamp(cLin, 0, 1)
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return clamp(Math.round(v * 255), 0, 255)
}

// ---- HEX -----------------------------------------------------------
export function parseHex(hex) {
  const s = hex.trim().replace(/^#/, '')
  if (![3, 4, 6, 8].includes(s.length)) return null
  const expand = (h) => (h.length === 1 ? h + h : h)
  let r, g, b, a = 255
  if (s.length === 3 || s.length === 4) {
    r = parseInt(expand(s[0]), 16)
    g = parseInt(expand(s[1]), 16)
    b = parseInt(expand(s[2]), 16)
    if (s.length === 4) a = parseInt(expand(s[3]), 16)
  } else {
    r = parseInt(s.slice(0, 2), 16)
    g = parseInt(s.slice(2, 4), 16)
    b = parseInt(s.slice(4, 6), 16)
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16)
  }
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null
  return { r, g, b, a: a / 255 }
}
export function toHex({ r, g, b, a = 1 }, withAlpha = false) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return withAlpha ? `#${h(r)}${h(g)}${h(b)}${h(a * 255)}` : `#${h(r)}${h(g)}${h(b)}`
}

// ---- HSL -------------------------------------------------------------
export function rgbToHsl({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s: s * 100, l: l * 100 }
}
export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360
  s /= 100
  l /= 100
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    r: Math.round(hue2rgb(h + 1 / 3) * 255),
    g: Math.round(hue2rgb(h) * 255),
    b: Math.round(hue2rgb(h - 1 / 3) * 255),
  }
}

// ---- HSV ---------------------------------------------------------------
export function rgbToHsv({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  const v = max
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return { h: h * 360, s: s * 100, v: v * 100 }
}
export function hsvToRgb({ h, s, v }) {
  h = ((h % 360) + 360) % 360 / 360
  s /= 100
  v /= 100
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r, g, b
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    default: r = v; g = p; b = q
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }
}

// ---- HWB -----------------------------------------------------------------
export function rgbToHwb(rgb) {
  const { h } = rgbToHsv(rgb)
  const w = Math.min(rgb.r, rgb.g, rgb.b) / 255
  const b = 1 - Math.max(rgb.r, rgb.g, rgb.b) / 255
  return { h, w: w * 100, b: b * 100 }
}
export function hwbToRgb({ h, w, b }) {
  w /= 100
  b /= 100
  if (w + b >= 1) {
    const gray = Math.round((w / (w + b)) * 255)
    return { r: gray, g: gray, b: gray }
  }
  const rgb = hsvToRgb({ h, s: 100, v: 100 })
  const scale = (c) => Math.round(c * (1 - w - b) + w * 255)
  return { r: scale(rgb.r), g: scale(rgb.g), b: scale(rgb.b) }
}

// ---- CIE XYZ / Lab / LCH (D65) -------------------------------------------
const D65 = { x: 0.95047, y: 1.0, z: 1.08883 }

export function rgbToXyz({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  return {
    x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    y: R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    z: R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  }
}
export function xyzToRgb({ x, y, z }) {
  const R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
  const G = x * -0.969266 + y * 1.8760108 + z * 0.041556
  const B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) }
}

function labF(t) {
  const eps = 216 / 24389
  const kappa = 24389 / 27
  return t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116
}
function labFInv(t) {
  const eps = 216 / 24389
  const t3 = t * t * t
  return t3 > eps ? t3 : (116 * t - 16) / (24389 / 27)
}
export function xyzToLab({ x, y, z }) {
  const fx = labF(x / D65.x), fy = labF(y / D65.y), fz = labF(z / D65.z)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}
export function labToXyz({ l, a, b }) {
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  return { x: labFInv(fx) * D65.x, y: labFInv(fy) * D65.y, z: labFInv(fz) * D65.z }
}
export function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb))
}
export function labToRgb(lab) {
  return xyzToRgb(labToXyz(lab))
}
export function labToLch({ l, a, b }) {
  const c = Math.sqrt(a * a + b * b)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l, c, h }
}
export function lchToLab({ l, c, h }) {
  const rad = (h * Math.PI) / 180
  return { l, a: Math.cos(rad) * c, b: Math.sin(rad) * c }
}

// ---- OKLab / OKLCH (Björn Ottosson) --------------------------------------
export function rgbToOklab({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s)
  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}
export function oklabToRgb({ l, a, b }) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc = s_ * s_ * s_
  const R = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
  const G = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
  const B = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) }
}
export function oklabToOklch({ l, a, b }) {
  const c = Math.sqrt(a * a + b * b)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l, c, h }
}
export function oklchToOklab({ l, c, h }) {
  const rad = (h * Math.PI) / 180
  return { l, a: Math.cos(rad) * c, b: Math.sin(rad) * c }
}

// ---- CMYK (naive subtractive approximation — no ICC profile) -------------
export function rgbToCmyk({ r, g, b }) {
  const rf = r / 255, gf = g / 255, bf = b / 255
  const k = 1 - Math.max(rf, gf, bf)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  const c = (1 - rf - k) / (1 - k)
  const m = (1 - gf - k) / (1 - k)
  const y = (1 - bf - k) / (1 - k)
  return { c: c * 100, m: m * 100, y: y * 100, k: k * 100 }
}
export function cmykToRgb({ c, m, y, k }) {
  c /= 100
  m /= 100
  y /= 100
  k /= 100
  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k)),
  }
}

// ---- Out-of-gamut detection (editing in Lab/OKLab can produce this) -----
export function isOutOfGamut({ r, g, b }) {
  return r < -0.5 || r > 255.5 || g < -0.5 || g > 255.5 || b < -0.5 || b > 255.5
}

// ---- WCAG contrast --------------------------------------------------------
function relativeLuminance({ r, g, b }) {
  const lin = (c) => srgbToLinear(c)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export function contrastRatio(rgbA, rgbB) {
  const l1 = relativeLuminance(rgbA)
  const l2 = relativeLuminance(rgbB)
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

// ---- One-shot "give me everything" translator ---------------------------
export function describeAll(rgb, alpha = 1) {
  const withA = { ...rgb, a: alpha }
  const hsl = rgbToHsl(rgb)
  const hsv = rgbToHsv(rgb)
  const hwb = rgbToHwb(rgb)
  const lab = rgbToLab(rgb)
  const lch = labToLch(lab)
  const oklab = rgbToOklab(rgb)
  const oklch = oklabToOklch(oklab)
  const cmyk = rgbToCmyk(rgb)
  return {
    hex: toHex(rgb),
    hex8: toHex(withA, true),
    rgb: `rgb(${rgb.r} ${rgb.g} ${rgb.b})`,
    rgba: `rgba(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha.toFixed(2)})`,
    hsl: `hsl(${hsl.h.toFixed(1)}deg ${hsl.s.toFixed(1)}% ${hsl.l.toFixed(1)}%)`,
    hsla: `hsla(${hsl.h.toFixed(1)}deg ${hsl.s.toFixed(1)}% ${hsl.l.toFixed(1)}% / ${alpha.toFixed(2)})`,
    hsv: `hsv(${hsv.h.toFixed(1)}deg ${hsv.s.toFixed(1)}% ${hsv.v.toFixed(1)}%)`,
    hwb: `hwb(${hwb.h.toFixed(1)}deg ${hwb.w.toFixed(1)}% ${hwb.b.toFixed(1)}%)`,
    lab: `lab(${lab.l.toFixed(1)}% ${lab.a.toFixed(1)} ${lab.b.toFixed(1)})`,
    lch: `lch(${lch.l.toFixed(1)}% ${lch.c.toFixed(1)} ${lch.h.toFixed(1)}deg)`,
    oklab: `oklab(${oklab.l.toFixed(3)} ${oklab.a.toFixed(3)} ${oklab.b.toFixed(3)})`,
    oklch: `oklch(${oklch.l.toFixed(3)} ${oklch.c.toFixed(3)} ${oklch.h.toFixed(1)}deg)`,
    cmyk: `cmyk(${cmyk.c.toFixed(0)}% ${cmyk.m.toFixed(0)}% ${cmyk.y.toFixed(0)}% ${cmyk.k.toFixed(0)}%)`,
  }
}
