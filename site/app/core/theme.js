// site/app/core/theme.js
//
// Applies the persisted theme choice (light / dark / system) and hosts
// the appearance editor: an anchored popover with an INFINITE color
// picker (a continuous 2-D saturation/value field plus a hue strip and
// numeric entry — never a swatch-only chooser) and a translator that
// converts the current color bidirectionally across HEX/HEX8, RGB(A),
// HSL(A), HSV, HWB, CIELAB/LCH, OKLab/OKLCH and CMYK, with a live WCAG
// contrast readout and an out-of-gamut warning.
//
// The theme itself is applied by toggling `data-theme` on <html>, which
// is exactly the selector styles.css already keys its dark-mode token
// block off — see the file header there for why the light palette must
// stay defined only on bare :root.

import { getValue, setValue } from './settings.js'
import * as color from './color.js'

const THEME_KEY = 'theme'
const ACCENT_KEY = 'accent-hex'

export function applyTheme() {
  const pref = getValue(THEME_KEY, 'system')
  const root = document.documentElement
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref)
  else root.removeAttribute('data-theme')

  // Legacy key the head's anti-flash inline script also reads/writes
  // (see index.html) — kept in sync so a returning visitor never sees a
  // flash of the wrong palette before this module loads.
  try {
    if (pref === 'light' || pref === 'dark') localStorage.setItem('nodeterm-theme', pref)
    else localStorage.removeItem('nodeterm-theme')
  } catch (_) {
    /* private mode — theme still applies for this page load */
  }

  applyAccent()
}

export function toggleLightDark() {
  const root = document.documentElement
  const explicit = root.getAttribute('data-theme')
  const effective = explicit || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const next = effective === 'dark' ? 'light' : 'dark'
  setValue(THEME_KEY, next, { title: 'Color theme' })
  applyTheme()
}

function applyAccent() {
  const hex = getValue(ACCENT_KEY, null)
  if (!hex) return
  const rgb = color.parseHex(hex)
  if (!rgb) return
  document.documentElement.style.setProperty('--md-primary', hex)
  // Keep the "on-primary" role legible against the custom accent by
  // picking whichever of black/white wins WCAG contrast, rather than
  // hard-coding white (a light custom accent would otherwise fail
  // contrast for on-primary text/icons).
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }
  const onPrimary = color.contrastRatio(rgb, white) >= color.contrastRatio(rgb, black) ? '#ffffff' : '#000000'
  document.documentElement.style.setProperty('--md-on-primary', onPrimary)
}

export function resetAccent() {
  setValue(ACCENT_KEY, null, { title: 'Accent color', action: 'reset' })
  document.documentElement.style.removeProperty('--md-primary')
  document.documentElement.style.removeProperty('--md-on-primary')
}

// ---------------------------------------------------------------------
// Appearance editor (anchored popover, infinite color picker)
// ---------------------------------------------------------------------

let openEditorFn = null

export function openAppearanceEditor(anchor) {
  if (openEditorFn) {
    openEditorFn()
    return
  }
  buildEditor(anchor)
}

function buildEditor(anchor) {
  const scrim = document.createElement('div')
  scrim.className = 'appearance-editor__scrim'
  const panel = document.createElement('div')
  panel.className = 'appearance-editor'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Appearance editor')

  const startHex = getValue(ACCENT_KEY, '#6b4fd8')
  let rgb = color.parseHex(startHex) || { r: 107, g: 79, b: 216 }
  let hsv = color.rgbToHsv(rgb)

  panel.innerHTML = `
    <div class="appearance-editor__head">
      <h3>Accent color</h3>
      <button type="button" class="icon-btn appearance-editor__close" aria-label="Close appearance editor">×</button>
    </div>
    <div class="color-picker">
      <div class="color-picker__field" tabindex="0" role="slider" aria-label="Saturation and value" aria-valuetext="">
        <div class="color-picker__field-cursor"></div>
      </div>
      <div class="color-picker__hue" tabindex="0" role="slider" aria-label="Hue" aria-valuemin="0" aria-valuemax="360">
        <div class="color-picker__hue-cursor"></div>
      </div>
      <div class="color-picker__swatch"></div>
    </div>
    <div class="color-picker__numeric">
      <label>Hex <input type="text" class="cp-hex" /></label>
      <label>R <input type="number" min="0" max="255" class="cp-r" /></label>
      <label>G <input type="number" min="0" max="255" class="cp-g" /></label>
      <label>B <input type="number" min="0" max="255" class="cp-b" /></label>
    </div>
    <div class="color-picker__translator"></div>
    <div class="color-picker__contrast"></div>
    <div class="color-picker__gamut" hidden>⚠️ Out of the visible sRGB gamut — clamped for display.</div>
    <div class="appearance-editor__footer">
      <button type="button" class="btn btn-secondary btn-sm cp-reset">Reset to default</button>
      <button type="button" class="btn btn-primary btn-sm cp-apply">Apply</button>
    </div>
  `

  document.body.appendChild(scrim)
  document.body.appendChild(panel)
  position(panel, anchor)

  const field = panel.querySelector('.color-picker__field')
  const fieldCursor = panel.querySelector('.color-picker__field-cursor')
  const hueTrack = panel.querySelector('.color-picker__hue')
  const hueCursor = panel.querySelector('.color-picker__hue-cursor')
  const swatch = panel.querySelector('.color-picker__swatch')
  const hexInput = panel.querySelector('.cp-hex')
  const rInput = panel.querySelector('.cp-r')
  const gInput = panel.querySelector('.cp-g')
  const bInput = panel.querySelector('.cp-b')
  const translator = panel.querySelector('.color-picker__translator')
  const contrastEl = panel.querySelector('.color-picker__contrast')
  const gamutEl = panel.querySelector('.color-picker__gamut')

  function render() {
    rgb = color.hsvToRgb(hsv)
    const hex = color.toHex(rgb)
    field.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`
    fieldCursor.style.left = `${hsv.s}%`
    fieldCursor.style.top = `${100 - hsv.v}%`
    hueCursor.style.left = `${(hsv.h / 360) * 100}%`
    swatch.style.background = hex
    hexInput.value = hex
    rInput.value = rgb.r
    gInput.value = rgb.g
    bInput.value = rgb.b
    field.setAttribute('aria-valuetext', `saturation ${hsv.s.toFixed(0)}%, value ${hsv.v.toFixed(0)}%`)
    hueTrack.setAttribute('aria-valuenow', String(Math.round(hsv.h)))

    const all = color.describeAll(rgb, 1)
    translator.innerHTML = Object.entries(all)
      .map(([k, v]) => `<div class="color-picker__translator-row"><span>${k}</span><code>${v}</code></div>`)
      .join('')

    const white = { r: 255, g: 255, b: 255 }
    const black = { r: 0, g: 0, b: 0 }
    const cw = color.contrastRatio(rgb, white)
    const cb = color.contrastRatio(rgb, black)
    contrastEl.textContent = `Contrast — vs white ${cw.toFixed(2)}:1, vs black ${cb.toFixed(2)}:1 (WCAG AA text needs ≥ 4.5:1, large text/UI ≥ 3:1)`
    gamutEl.hidden = !color.isOutOfGamut(rgb)
  }

  function setFromPointer(clientX, clientY) {
    const r = field.getBoundingClientRect()
    const s = clamp01((clientX - r.left) / r.width) * 100
    const v = 100 - clamp01((clientY - r.top) / r.height) * 100
    hsv = { ...hsv, s, v }
    render()
  }
  function setHueFromPointer(clientX) {
    const r = hueTrack.getBoundingClientRect()
    const h = clamp01((clientX - r.left) / r.width) * 360
    hsv = { ...hsv, h }
    render()
  }
  function clamp01(n) {
    return Math.min(1, Math.max(0, n))
  }

  let draggingField = false
  field.addEventListener('pointerdown', (e) => {
    draggingField = true
    field.setPointerCapture(e.pointerId)
    setFromPointer(e.clientX, e.clientY)
  })
  field.addEventListener('pointermove', (e) => draggingField && setFromPointer(e.clientX, e.clientY))
  field.addEventListener('pointerup', () => (draggingField = false))
  field.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') hsv.s = Math.max(0, hsv.s - step)
    else if (e.key === 'ArrowRight') hsv.s = Math.min(100, hsv.s + step)
    else if (e.key === 'ArrowUp') hsv.v = Math.min(100, hsv.v + step)
    else if (e.key === 'ArrowDown') hsv.v = Math.max(0, hsv.v - step)
    else return
    e.preventDefault()
    render()
  })

  let draggingHue = false
  hueTrack.addEventListener('pointerdown', (e) => {
    draggingHue = true
    hueTrack.setPointerCapture(e.pointerId)
    setHueFromPointer(e.clientX)
  })
  hueTrack.addEventListener('pointermove', (e) => draggingHue && setHueFromPointer(e.clientX))
  hueTrack.addEventListener('pointerup', () => (draggingHue = false))
  hueTrack.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 3
    if (e.key === 'ArrowLeft') hsv.h = (hsv.h - step + 360) % 360
    else if (e.key === 'ArrowRight') hsv.h = (hsv.h + step) % 360
    else return
    e.preventDefault()
    render()
  })

  hexInput.addEventListener('change', () => {
    const parsed = color.parseHex(hexInput.value)
    if (parsed) {
      hsv = color.rgbToHsv(parsed)
      render()
    }
  })
  ;[rInput, gInput, bInput].forEach((inp) => {
    inp.addEventListener('change', () => {
      const next = {
        r: Number(rInput.value) || 0,
        g: Number(gInput.value) || 0,
        b: Number(bInput.value) || 0,
      }
      hsv = color.rgbToHsv(next)
      render()
    })
  })

  panel.querySelector('.cp-reset').addEventListener('click', () => {
    resetAccent()
    close()
  })
  panel.querySelector('.cp-apply').addEventListener('click', () => {
    const hex = color.toHex(rgb)
    setValue(ACCENT_KEY, hex, { title: 'Accent color' })
    applyAccent()
    close()
  })
  panel.querySelector('.appearance-editor__close').addEventListener('click', close)
  scrim.addEventListener('click', close)
  function onKeydown(e) {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKeydown, true)

  function close() {
    document.removeEventListener('keydown', onKeydown, true)
    scrim.remove()
    panel.remove()
    openEditorFn = null
    anchor && anchor.focus && anchor.focus()
  }
  openEditorFn = () => panel.focus()

  render()
}

function position(panel, anchor) {
  panel.style.position = 'fixed'
  panel.style.maxHeight = '90vh'
  panel.style.overflowY = 'auto'
  const vw = window.innerWidth
  if (anchor && vw >= 640) {
    const r = anchor.getBoundingClientRect()
    const width = Math.min(360, vw - 32)
    let left = Math.min(Math.max(16, r.left), vw - width - 16)
    panel.style.width = `${width}px`
    panel.style.left = `${left}px`
    panel.style.top = `${r.bottom + 8}px`
  } else {
    panel.style.width = 'min(360px, calc(100vw - 32px))'
    panel.style.left = '50%'
    panel.style.top = '50%'
    panel.style.transform = 'translate(-50%, -50%)'
  }
}
