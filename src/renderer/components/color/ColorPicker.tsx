import { useEffect, useMemo, useRef, useState } from 'react'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'
import {
  compositeOver,
  contrastLabel,
  contrastRatio,
  cmykToRgb,
  hslToRgb,
  hsvToRgb,
  hwbToRgb,
  labToRgbClamped,
  lchToRgbClamped,
  oklabToRgb,
  oklchToRgbClamped,
  parseAnyColor,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToHwb,
  rgbToLab,
  rgbToLch,
  rgbToOklab,
  rgbToOklch,
  toHex,
  toHslString,
  toHsvString,
  toHwbString,
  toLabString,
  toLchString,
  toNamedColor,
  toOklabString,
  toOklchString,
  toRgbString,
  toCmykString,
  type RGBA
} from '@renderer/lib/color/convert'
import { cn } from '@renderer/ui/cn'
import { copyColorText } from './color-clipboard'
import { Button, Chip, Tablist } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'hsv' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch' | 'cmyk'
type Format = ColorFormat

const FORMATS: { id: Format; label: string }[] = [
  { id: 'hex', label: 'HEX' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsl', label: 'HSL' },
  { id: 'hsv', label: 'HSV' },
  { id: 'hwb', label: 'HWB' },
  { id: 'lab', label: 'LAB' },
  { id: 'lch', label: 'LCH' },
  { id: 'oklab', label: 'OKLab' },
  { id: 'oklch', label: 'OKLCH' },
  { id: 'cmyk', label: 'CMYK' }
]

/** Convenience swatches from the app's own node-colour palette; a layer ON TOP of the continuous
 *  picker, never a replacement for it (docs/colour-picker.md). `#6750a4` leads as the M3-baseline
 *  seed (the shipped default, styles.css `--md-primary`); `#0a84ff` (systemBlue, the pre-M3
 *  default) stays reachable a step behind it rather than being dropped. */
const QUICK_SWATCHES = [
  '#6750a4', '#0a84ff', '#32d74b', '#ff9f0a', '#ff453a', '#bf5af2', '#ffd60a', '#64d2ff',
  '#ff375f', '#30d158', '#a2845e', '#ffffff', '#8e8e93', '#1c1c1e', '#000000'
]

/** In-memory only (not persisted to disk) — a session convenience, most recently used first. */
let recentColorsStore: string[] = []
const recentListeners = new Set<() => void>()
function pushRecent(hex: string): void {
  recentColorsStore = [hex, ...recentColorsStore.filter((c) => c !== hex)].slice(0, 12)
  recentListeners.forEach((fn) => fn())
}
function useRecentColors(): string[] {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    recentListeners.add(fn)
    return () => {
      recentListeners.delete(fn)
    }
  }, [])
  return recentColorsStore
}

function hasEyeDropper(): boolean {
  return typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper === 'function'
}

/** Resolves a CSS custom property on the document root to a concrete colour string, for the
 *  contrast readout's default "against" surface when the caller doesn't pass one explicitly. */
function resolveCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export interface ColorPickerProps {
  /** Any colour string this module can parse: hex, rgb()/rgba(), hsl()/hsla(), hsv()/hsb(),
   *  hwb(), lab(), lch(), oklab(), oklch(), a CSS named colour. Unparsable falls back to opaque
   *  black rather than throwing — a colour control must never crash the editor it sits in. */
  value: string
  onChange: (next: string) => void
  /** Accessible label prefix for the picker's controls ("Text colour saturation and brightness"). */
  label: string
  /** Colour the result will be shown against, for the contrast readout. Defaults to the app
   *  panel background. */
  against?: string
  allowAlpha?: boolean
  className?: string
}

/**
 * An INFINITE colour picker: a continuous 2-D saturation/value field + hue + alpha sliders, with
 * numeric entry in ten formats and bidirectional translation between all of them. See
 * docs/colour-picker.md. Swatches/recents/eyedropper are conveniences layered on top — the
 * continuous field is what actually lets you reach every colour, not just a curated 24.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  against,
  allowAlpha = true,
  className
}: ColorPickerProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const labelText = vocab(label)
  const lastEmitted = useRef<string | null>(null)
  const [rgba, setRgba] = useState<RGBA>(() => parseAnyColor(value) ?? { r: 0, g: 0, b: 0, a: 1 })
  const [invalid, setInvalid] = useState(false)
  const [format, setFormat] = useState<Format>('hex')
  const [clipWarning, setClipWarning] = useState(false)
  const [copied, setCopied] = useState<Format | null>(null)
  const recents = useRecentColors()

  // Re-sync from an EXTERNAL prop change (reset, preset applied, …) — never from our own echo,
  // which would fight the field the user is mid-edit on.
  useEffect(() => {
    if (value === lastEmitted.current) return
    const parsed = parseAnyColor(value)
    if (parsed) {
      setRgba(parsed)
      setInvalid(false)
    }
    // An unparsable incoming value is left displaying the last good colour — never blanked.
  }, [value])

  const hsv = useMemo(() => rgbToHsv(rgba), [rgba])
  const bgOpaque = useMemo(
    () => parseAnyColor(against ?? resolveCssVar('--panel', '#282828')) ?? { r: 40, g: 40, b: 40, a: 1 },
    [against]
  )
  const composited = useMemo(() => compositeOver(rgba, bgOpaque), [rgba, bgOpaque])
  const ratio = useMemo(() => contrastRatio(composited, bgOpaque), [composited, bgOpaque])
  const namedColor = useMemo(() => toNamedColor(rgba), [rgba])

  function commit(next: RGBA, fmt: Format = format, clipped = false): void {
    setRgba(next)
    setClipWarning(clipped)
    const text = browserCssForFormat(fmt, next)
    lastEmitted.current = text
    onChange(text)
  }

  function commitFromHsv(next: typeof hsv): void {
    commit(hsvToRgb(next))
  }

  // --- 2-D saturation/value field --------------------------------------------------------------
  const fieldRef = useRef<HTMLDivElement>(null)
  function updateFromPointer(clientX: number, clientY: number): void {
    const el = fieldRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const v = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height))
    commitFromHsv({ ...hsv, s, v })
  }
  function onFieldPointerDown(e: React.PointerEvent): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    updateFromPointer(e.clientX, e.clientY)
  }
  function onFieldPointerMove(e: React.PointerEvent): void {
    if (e.buttons !== 1) return
    updateFromPointer(e.clientX, e.clientY)
  }
  function onFieldKeyDown(e: React.KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.02
    let { s, v } = hsv
    if (e.key === 'ArrowLeft') s = Math.max(0, s - step)
    else if (e.key === 'ArrowRight') s = Math.min(1, s + step)
    else if (e.key === 'ArrowUp') v = Math.min(1, v + step)
    else if (e.key === 'ArrowDown') v = Math.max(0, v - step)
    else if (e.key === 'Home') s = 0
    else if (e.key === 'End') s = 1
    else return
    e.preventDefault()
    commitFromHsv({ ...hsv, s, v })
  }

  const hueRgb = hsvToRgb({ h: hsv.h, s: 1, v: 1, a: 1 })

  // --- numeric per-format fields ----------------------------------------------------------------
  function updateHex(text: string): void {
    const parsed = parseAnyColor(text)
    if (!parsed) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    commit(parsed, 'hex')
  }

  async function copyCurrent(): Promise<void> {
    const copiedFormat = format
    const text = formatFor(format, rgba)
    if (!(await copyColorText(text))) return
    setCopied(copiedFormat)
    window.setTimeout(() => setCopied((f) => (f === copiedFormat ? null : f)), 1200)
  }

  async function useEyeDropper(): Promise<void> {
    try {
      const EyeDropperCtor = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
      const picked = await new EyeDropperCtor().open()
      const parsed = parseAnyColor(picked.sRGBHex)
      if (parsed) {
        commit({ ...parsed, a: rgba.a }, format)
        pushRecent(toHex(parsed))
      }
    } catch {
      // User cancelled (Escape) — not an error worth surfacing.
    }
  }

  const alphaBg =
    `linear-gradient(45deg, rgba(0,0,0,.25) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.25) 75%) 0 0/10px 10px, ` +
    `linear-gradient(45deg, rgba(0,0,0,.25) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.25) 75%) 5px 5px/10px 10px, ` +
    `linear-gradient(90deg, transparent, ${toHex({ ...rgba, a: 1 })})`

  return (
    <div className={cn('color-picker', className)}>
      <div
        ref={fieldRef}
        className="color-picker__field"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${toHex(hueRgb)})` }}
        onPointerDown={onFieldPointerDown}
        onPointerMove={onFieldPointerMove}
        role="application"
        aria-label={`${labelText} — ${vocab('saturation and brightness field')}`}
      >
        <div
          className="color-picker__thumb"
          role="slider"
          tabIndex={0}
          aria-label={`${labelText} ${vocab('saturation and brightness')}`}
          aria-valuetext={`${vocab('Saturation')} ${Math.round(hsv.s * 100)}%, ${vocab('brightness')} ${Math.round(hsv.v * 100)}%`}
          onKeyDown={onFieldKeyDown}
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: toHex(rgba)
          }}
        />
      </div>

      <div className="color-picker__row">
        <div className="color-picker__preview-wrap">
          <div
            className="color-picker__preview"
            style={{
              background:
                'linear-gradient(45deg, rgba(0,0,0,.2) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.2) 75%) 0 0/8px 8px,' +
                'linear-gradient(45deg, rgba(0,0,0,.2) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.2) 75%) 4px 4px/8px 8px'
            }}
          >
            <div className="color-picker__preview-fill" style={{ background: toRgbString(rgba) }} />
          </div>
        </div>
        <div className="color-picker__sliders">
          <label className="sr-only" htmlFor={`${label}-hue`}>{labelText} {vocab('hue')}</label>
          <Input vocabularyMode="factual"
            id={`${label}-hue`}
            className="color-picker__slider color-picker__slider--hue"
            type="range"
            min={0}
            max={360}
            step={1}
            value={hsv.h}
            onChange={(e) => commitFromHsv({ ...hsv, h: Number(e.target.value) })}
          />
          {allowAlpha && (
            <>
              <label className="sr-only" htmlFor={`${label}-alpha`}>{labelText} {vocab('alpha')}</label>
              <Input vocabularyMode="factual"
                id={`${label}-alpha`}
                className="color-picker__slider color-picker__slider--alpha"
                style={{ background: alphaBg }}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={rgba.a}
                onChange={(e) => commit({ ...rgba, a: Number(e.target.value) }, format)}
              />
            </>
          )}
        </div>
        {hasEyeDropper() && (
          <Button variant="outlined" size="small" vocabularyMode="factual"
            type="button"
            className="color-picker__eyedropper"
            title={vocab('Pick a colour from the screen')}
            aria-label={vocab('Pick a colour from the screen with the eyedropper')}
            onClick={() => void useEyeDropper()}
          >
            💧
          </Button>
        )}
      </div>

      <Tablist className="color-picker__formats" ariaLabel={`${labelText} ${vocab('colour format')}`}>
        {FORMATS.map((f) => (
          <Chip vocabularyMode="factual" selected={format === f.id}
            key={f.id}
           
            role="tab"
            aria-selected={format === f.id}
            className={cn('color-picker__format-tab', format === f.id && 'is-active')}
            onClick={() => setFormat(f.id)}
          >
            {f.label}
          </Chip>
        ))}
      </Tablist>

      <div className="color-picker__entry">
        {format === 'hex' && (
          <Input vocabularyMode="factual"
            className={cn('color-picker__hex-input', invalid && 'is-invalid')}
            aria-label={`${labelText} ${vocab('hex value')}`}
            defaultValue={toHex(rgba, rgba.a < 1)}
            key={toHex(rgba, rgba.a < 1)}
            onBlur={(e) => updateHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateHex((e.target as HTMLInputElement).value)
            }}
          />
        )}
        {format !== 'hex' && (
          <ChannelFields
            format={format}
            rgba={rgba}
            allowAlpha={allowAlpha}
            onCommit={(next, clipped) => commit(next, format, clipped)}
          />
        )}
        <Button variant="outlined" size="small" vocabularyMode="factual" className="color-picker__copy" onClick={() => void copyCurrent()}>
          {vocab(copied === format ? 'Copied' : 'Copy')}
        </Button>
      </div>
      {invalid && format === 'hex' && (
        <p className="color-picker__note color-picker__note--warn">
          {vocab('Not a recognised colour — keeping the last valid value shown above.')}
        </p>
      )}
      {clipWarning && (
        <p className="color-picker__note color-picker__note--warn">
          {vocab("That value is outside sRGB (the app's display gamut) and has been clipped to the nearest colour it can actually show.")}
        </p>
      )}
      {namedColor && <p className="color-picker__note">{vocab('CSS name:')} {namedColor}</p>}

      <div className="color-picker__contrast">
        <span>
          {vocab('Contrast vs. background:')} <strong>{ratio.toFixed(2)}:1</strong> ({vocab(contrastLabel(ratio))})
        </span>
        <span
          className="color-picker__contrast-swatch"
          style={{ background: toRgbString(bgOpaque) }}
          aria-hidden="true"
        >
          <span style={{ color: toRgbString(composited) }}>Aa</span>
        </span>
      </div>

      <div className="color-picker__swatches" role="group" aria-label={vocab('Quick colours')}>
        {QUICK_SWATCHES.map((c) => (
          <Button variant="outlined" size="small" vocabularyMode="factual"
            key={c}
            type="button"
            className="color-picker__swatch"
            style={{ background: c }}
            aria-label={`${vocab('Use')} ${c}`}
            onClick={() => {
              const parsed = parseAnyColor(c)
              if (parsed) commit({ ...parsed, a: rgba.a }, format)
            }}
          />
        ))}
      </div>
      {recents.length > 0 && (
        <div className="color-picker__swatches" role="group" aria-label={vocab('Recently used colours')}>
          {recents.map((c) => (
            <Button variant="outlined" size="small" vocabularyMode="factual"
              key={c}
              type="button"
              className="color-picker__swatch"
              style={{ background: c }}
              aria-label={`${vocab('Use recently-used colour')} ${c}`}
              onClick={() => {
                const parsed = parseAnyColor(c)
                if (parsed) commit({ ...parsed, a: rgba.a }, format)
              }}
            />
          ))}
        </div>
      )}
      <Button variant="outlined" size="small" vocabularyMode="factual"
        type="button"
        className="color-picker__remember"
        onClick={() => pushRecent(toHex(rgba))}
      >
        {vocab('+ Save to recents')}
      </Button>
    </div>
  )
}

function formatFor(format: Format, rgba: RGBA): string {
  switch (format) {
    case 'hex':
      return toHex(rgba, rgba.a < 1)
    case 'rgb':
      return toRgbString(rgba)
    case 'hsl':
      return toHslString(rgba)
    case 'hsv':
      return toHsvString(rgba)
    case 'hwb':
      return toHwbString(rgba)
    case 'lab':
      return toLabString(rgba)
    case 'lch':
      return toLchString(rgba)
    case 'oklab':
      return toOklabString(rgba)
    case 'oklch':
      return toOklchString(rgba)
    case 'cmyk':
      return toCmykString(rgba)
  }
}

/**
 * Values leaving the picker are persisted and later assigned to real CSS properties. HSV and
 * CMYK are useful editing/copy representations, but neither `hsv()` nor `cmyk()` is a browser CSS
 * colour syntax. Convert just those two to RGBA at the boundary (including alpha); the selected
 * tab and its channel controls remain HSV/CMYK in the UI.
 */
export function browserCssForFormat(format: ColorFormat, rgba: RGBA): string {
  return format === 'hsv' || format === 'cmyk' ? toRgbString(rgba) : formatFor(format, rgba)
}

/** Numeric per-channel entry for every non-hex format, converting back to RGBA (with gamut
 *  clipping reported for Lab/LCH/OKLab/OKLCH) on every edit. */
function ChannelFields({
  format,
  rgba,
  allowAlpha,
  onCommit
}: {
  format: Exclude<Format, 'hex'>
  rgba: RGBA
  allowAlpha: boolean
  onCommit: (next: RGBA, clipped: boolean) => void
}): React.JSX.Element {
  function field(n: number, dp = 0): string {
    return Number.isFinite(n) ? n.toFixed(dp) : '0'
  }
  function num(fields: Record<string, number>, key: string, v: string): Record<string, number> {
    const parsed = parseFloat(v)
    return { ...fields, [key]: Number.isFinite(parsed) ? parsed : fields[key] }
  }

  if (format === 'rgb') {
    return (
      <div className="color-picker__channels">
        <NumField label="R" value={field(rgba.r)} onCommit={(v) => onCommit({ ...rgba, r: v }, false)} min={0} max={255} />
        <NumField label="G" value={field(rgba.g)} onCommit={(v) => onCommit({ ...rgba, g: v }, false)} min={0} max={255} />
        <NumField label="B" value={field(rgba.b)} onCommit={(v) => onCommit({ ...rgba, b: v }, false)} min={0} max={255} />
        {allowAlpha && (
          <NumField label="A" value={field(rgba.a, 2)} onCommit={(v) => onCommit({ ...rgba, a: v }, false)} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'hsl') {
    const c = rgbToHsl(rgba)
    return (
      <div className="color-picker__channels">
        <NumField label="H" value={field(c.h)} onCommit={(v) => onCommit(hslToRgb({ ...c, h: v }), false)} min={0} max={360} />
        <NumField label="S%" value={field(c.s * 100)} onCommit={(v) => onCommit(hslToRgb({ ...c, s: v / 100 }), false)} min={0} max={100} />
        <NumField label="L%" value={field(c.l * 100)} onCommit={(v) => onCommit(hslToRgb({ ...c, l: v / 100 }), false)} min={0} max={100} />
        {allowAlpha && (
          <NumField label="A" value={field(c.a, 2)} onCommit={(v) => onCommit(hslToRgb({ ...c, a: v }), false)} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'hsv') {
    const c = rgbToHsv(rgba)
    return (
      <div className="color-picker__channels">
        <NumField label="H" value={field(c.h)} onCommit={(v) => onCommit(hsvToRgb({ ...c, h: v }), false)} min={0} max={360} />
        <NumField label="S%" value={field(c.s * 100)} onCommit={(v) => onCommit(hsvToRgb({ ...c, s: v / 100 }), false)} min={0} max={100} />
        <NumField label="V%" value={field(c.v * 100)} onCommit={(v) => onCommit(hsvToRgb({ ...c, v: v / 100 }), false)} min={0} max={100} />
        {allowAlpha && (
          <NumField label="A" value={field(c.a, 2)} onCommit={(v) => onCommit(hsvToRgb({ ...c, a: v }), false)} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'hwb') {
    const c = rgbToHwb(rgba)
    return (
      <div className="color-picker__channels">
        <NumField label="H" value={field(c.h)} onCommit={(v) => onCommit(hwbToRgb({ ...c, h: v }), false)} min={0} max={360} />
        <NumField label="W%" value={field(c.w * 100)} onCommit={(v) => onCommit(hwbToRgb({ ...c, w: v / 100 }), false)} min={0} max={100} />
        <NumField label="B%" value={field(c.b * 100)} onCommit={(v) => onCommit(hwbToRgb({ ...c, b: v / 100 }), false)} min={0} max={100} />
        {allowAlpha && (
          <NumField label="A" value={field(c.a, 2)} onCommit={(v) => onCommit(hwbToRgb({ ...c, a: v }), false)} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'lab') {
    const c = rgbToLab(rgba)
    const apply = (patch: Partial<typeof c>) => {
      const r = labToRgbClamped({ ...c, ...patch })
      onCommit(r.value, r.clipped)
    }
    return (
      <div className="color-picker__channels">
        <NumField label="L" value={field(c.l, 1)} onCommit={(v) => apply({ l: v })} min={0} max={100} />
        <NumField label="a" value={field(c.a, 1)} onCommit={(v) => apply({ a: v })} min={-125} max={125} />
        <NumField label="b" value={field(c.b, 1)} onCommit={(v) => apply({ b: v })} min={-125} max={125} />
        {allowAlpha && (
          <NumField label="A" value={field(c.alpha, 2)} onCommit={(v) => apply({ alpha: v })} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'lch') {
    const c = rgbToLch(rgba)
    const apply = (patch: Partial<typeof c>) => {
      const r = lchToRgbClamped({ ...c, ...patch })
      onCommit(r.value, r.clipped)
    }
    return (
      <div className="color-picker__channels">
        <NumField label="L" value={field(c.l, 1)} onCommit={(v) => apply({ l: v })} min={0} max={100} />
        <NumField label="C" value={field(c.c, 1)} onCommit={(v) => apply({ c: v })} min={0} max={150} />
        <NumField label="H" value={field(c.h, 1)} onCommit={(v) => apply({ h: v })} min={0} max={360} />
        {allowAlpha && (
          <NumField label="A" value={field(c.alpha, 2)} onCommit={(v) => apply({ alpha: v })} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'oklab') {
    const c = rgbToOklab(rgba)
    const apply = (patch: Partial<typeof c>) => {
      const r = oklabToRgb({ ...c, ...patch })
      onCommit(r.value, r.clipped)
    }
    return (
      <div className="color-picker__channels">
        <NumField label="L" value={field(c.l, 3)} onCommit={(v) => apply({ l: v })} min={0} max={1} step={0.001} />
        <NumField label="a" value={field(c.a, 3)} onCommit={(v) => apply({ a: v })} min={-0.4} max={0.4} step={0.001} />
        <NumField label="b" value={field(c.b, 3)} onCommit={(v) => apply({ b: v })} min={-0.4} max={0.4} step={0.001} />
        {allowAlpha && (
          <NumField label="A" value={field(c.alpha, 2)} onCommit={(v) => apply({ alpha: v })} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  if (format === 'oklch') {
    const c = rgbToOklch(rgba)
    const apply = (patch: Partial<typeof c>) => {
      const r = oklchToRgbClamped({ ...c, ...patch })
      onCommit(r.value, r.clipped)
    }
    return (
      <div className="color-picker__channels">
        <NumField label="L" value={field(c.l, 3)} onCommit={(v) => apply({ l: v })} min={0} max={1} step={0.001} />
        <NumField label="C" value={field(c.c, 3)} onCommit={(v) => apply({ c: v })} min={0} max={0.4} step={0.001} />
        <NumField label="H" value={field(c.h, 1)} onCommit={(v) => apply({ h: v })} min={0} max={360} />
        {allowAlpha && (
          <NumField label="A" value={field(c.alpha, 2)} onCommit={(v) => apply({ alpha: v })} min={0} max={1} step={0.01} />
        )}
      </div>
    )
  }
  // cmyk
  const c = rgbToCmyk(rgba)
  return (
    <div className="color-picker__channels">
      <NumField label="C%" value={field(c.c * 100)} onCommit={(v) => onCommit(cmykToRgb({ ...c, c: v / 100 }), false)} min={0} max={100} />
      <NumField label="M%" value={field(c.m * 100)} onCommit={(v) => onCommit(cmykToRgb({ ...c, m: v / 100 }), false)} min={0} max={100} />
      <NumField label="Y%" value={field(c.y * 100)} onCommit={(v) => onCommit(cmykToRgb({ ...c, y: v / 100 }), false)} min={0} max={100} />
      <NumField label="K%" value={field(c.k * 100)} onCommit={(v) => onCommit(cmykToRgb({ ...c, k: v / 100 }), false)} min={0} max={100} />
      {allowAlpha && (
        <NumField label="A" value={field(c.a, 2)} onCommit={(v) => onCommit(cmykToRgb({ ...c, a: v }), false)} min={0} max={1} step={0.01} />
      )}
    </div>
  )
}

function NumField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1
}: {
  label: string
  value: string
  onCommit: (v: number) => void
  min: number
  max: number
  step?: number
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <label className="color-picker__channel">
      <span>{label}</span>
      <Input vocabularyMode="factual"
        type="number"
        defaultValue={value}
        key={value}
        min={min}
        max={max}
        step={step}
        aria-label={`${vocab('Colour channel')} ${label}`}
        onBlur={(e) => onCommit(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(Number((e.target as HTMLInputElement).value))
        }}
      />
    </label>
  )
}
