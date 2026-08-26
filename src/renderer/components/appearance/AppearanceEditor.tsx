import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppearanceEditorHost } from '@renderer/state/appearanceEditorHost'
import { useSettings } from '@renderer/state/settings'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'
import {
  applyPresetToElement,
  deletePreset,
  parseImportFile,
  resetElement,
  resetElementProperty,
  saveStyleAsPreset,
  setElementInheritFrom,
  setElementStyle,
  buildExportFile
} from '@renderer/state/appearance'
import { resolveEffectiveStyle, styleToReactStyle } from '@renderer/lib/appearance/apply'
import { useAnchoredPosition } from '@renderer/lib/appearance/useAnchoredPosition'
import { kindLabel } from '@renderer/lib/appearance/registry'
import { ColorField } from '../color/ColorField'
import { Select } from '@renderer/ui/Select'
import { Switch } from '@renderer/ui/Switch'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { NumberField } from '@renderer/ui/NumberField'
import {
  buildFontStack,
  createCanvasMeasurer,
  detectInstalled,
  isFontAvailable,
  primaryFamily,
  quoteFamily
} from '@renderer/lib/fontDetect'
import { UI_FONT_CATALOG } from '@renderer/lib/appearance/uiFontDetect'
import { APPEARANCE_BLEND_MODES } from '@shared/types'
import type { AppearanceBlendMode, AppearancePreset, AppearanceTextStyle, ElementAppearanceEntry } from '@shared/types'
import { saveBlobDownload } from '@renderer/lib/exportSave'
import { Slider } from '@renderer/ui/md3'

type Tab = 'font' | 'color' | 'layout' | 'presets'

/** Feature-detects `font-variation-settings` support once — this is a CSS mechanism check, not a
 *  per-font one: no API exists to ask "does THIS installed font define a wght axis?" without
 *  parsing the font binary, so the editor shows the axis controls whenever the platform can honour
 *  the property at all and explains that an individual font may still ignore some/all axes. */
function supportsFontVariations(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('font-variation-settings', "'wght' 400")
}

const WEIGHTS = [
  { v: 100, label: '100 — Thin' },
  { v: 200, label: '200 — Extra Light' },
  { v: 300, label: '300 — Light' },
  { v: 400, label: '400 — Regular' },
  { v: 500, label: '500 — Medium' },
  { v: 600, label: '600 — Semibold' },
  { v: 700, label: '700 — Bold' },
  { v: 800, label: '800 — Extra Bold' },
  { v: 900, label: '900 — Black' }
]

/**
 * The non-modal, anchored per-element appearance editor (docs/appearance.md). One instance is
 * mounted by `AppearanceEditorHost`; it opens beside whatever element `openAppearanceEditor(...)`
 * was called for, tracks that anchor, handles viewport-edge collision, and returns focus to the
 * anchor on close. It carries `data-appearance-id="app:appearance-editor"` on its own root, so the
 * theming system applies to ITSELF — proof this isn't a feature that can't theme its own dialog.
 */
export function AppearanceEditorHost(): React.JSX.Element | null {
  const vocab = useVocabularyMapper()
  const target = useAppearanceEditorHost((s) => s.target)
  const close = useAppearanceEditorHost((s) => s.close)
  const [tab, setTab] = useState<Tab>('font')
  const pos = useAnchoredPosition(target?.anchor ?? null, !!target)
  const measure = useMemo(() => createCanvasMeasurer(), [])
  const entries = useSettings((s) => s.settings.elementAppearance)
  const presets = useSettings((s) => s.settings.appearancePresets)
  const firstFocusRef = useRef<HTMLButtonElement>(null)

  // Reset to the Font tab each time a NEW element is opened (not on every re-render of the same
  // one, or switching tabs while editing would keep jumping back to Font).
  const openedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (target && target.id !== openedIdRef.current) {
      openedIdRef.current = target.id
      setTab('font')
    }
    if (!target) openedIdRef.current = null
  }, [target])

  useEffect(() => {
    if (target) firstFocusRef.current?.focus()
  }, [target])

  // Outside click (but not the anchor, which has its own toggle semantics upstream) closes it —
  // it's non-modal, so nothing else on the page is blocked while it's open.
  useEffect(() => {
    if (!target) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (pos.ref.current?.contains(t) || target.anchor.contains(t)) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [target, close, pos.ref])

  if (!target) return null

  const style = resolveEffectiveStyle(target.id, entries)
  const entry = entries[target.id]

  function patch(p: Partial<AppearanceTextStyle>): void {
    setElementStyle(target!.id, target!.label, target!.kind, p)
  }
  function clear(key: keyof AppearanceTextStyle): void {
    resetElementProperty(target!.id, key)
  }

  return createPortal(
    <div
      ref={pos.ref}
      data-appearance-id="app:appearance-editor"
      className="appearance-editor"
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label={vocab(`Edit appearance — ${target.label}`)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <div className="appearance-editor__header">
        <div className="min-w-0">
          <div className="appearance-editor__title">{target.label}</div>
          <div className="appearance-editor__kind">{vocab(kindLabel(target.kind))}</div>
        </div>
        <button
          ref={firstFocusRef}
          type="button"
          className="appearance-editor__close"
          aria-label={vocab('Close appearance editor')}
          onClick={close}
        >
          ×
        </button>
      </div>

      <div
        className="appearance-editor__preview"
        style={styleToReactStyle(style)}
      >
        {vocab('The quick brown fox — Aa Bb Cc 123')}
      </div>

      <div className="appearance-editor__tabs" role="tablist" aria-label={vocab('Appearance property group')}>
        {(
          [
            { id: 'font', label: 'Font' },
            { id: 'color', label: 'Colour & effects' },
            { id: 'layout', label: 'Layout' },
            { id: 'presets', label: 'Presets' }
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`appearance-editor__tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {vocab(t.label)}
          </button>
        ))}
      </div>

      <div className="appearance-editor__body">
        {tab === 'font' && (
          <FontTab style={style} patch={patch} clear={clear} measure={measure} />
        )}
        {tab === 'color' && <ColorTab style={style} patch={patch} clear={clear} />}
        {tab === 'layout' && <LayoutTab style={style} patch={patch} clear={clear} />}
        {tab === 'presets' && (
          <PresetsTab
            elementId={target.id}
            elementLabel={target.label}
            elementKind={target.kind}
            style={style}
            entries={entries}
            presets={presets}
            inheritFrom={entry?.inheritFrom}
          />
        )}
      </div>
    </div>,
    document.body
  )
}

function Row({
  label,
  control,
  onReset,
  hint
}: {
  label: string
  control: React.ReactNode
  onReset?: () => void
  hint?: string
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <div className="appearance-editor__row">
      <span className="appearance-editor__row-label" title={vocab(hint)}>
        {vocab(label)}
      </span>
      <div className="appearance-editor__row-control">{control}</div>
      {onReset && (
        <button
          type="button"
          className="appearance-editor__row-reset"
          title={vocab(`Reset ${label} to the platform default`)}
          aria-label={vocab(`Reset ${label}`)}
          onClick={onReset}
        >
          ↺
        </button>
      )}
    </div>
  )
}

function FontTab({
  style,
  patch,
  clear,
  measure
}: {
  style: AppearanceTextStyle
  patch: (p: Partial<AppearanceTextStyle>) => void
  clear: (k: keyof AppearanceTextStyle) => void
  measure: ReturnType<typeof createCanvasMeasurer>
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [showAxes, setShowAxes] = useState(!!style.fontAxes && Object.keys(style.fontAxes).length > 0)
  const installed = useMemo(
    () => (measure ? detectInstalled(UI_FONT_CATALOG, measure) : []),
    [measure]
  )
  const primary = style.fontFamily ? primaryFamily(style.fontFamily) : ''
  const missing = !!measure && !!primary && !isFontAvailable(primary, measure)
  const axesOk = supportsFontVariations()

  return (
    <div className="appearance-editor__fields">
      <Row
        label="Font family"
        onReset={style.fontFamily ? () => clear('fontFamily') : undefined}
        control={
          <div className="flex flex-col gap-1.5">
            <Select
              className="w-full"
              value={installed.includes(primary) ? primary : '__custom__'}
              aria-label={vocab('Font family')}
              onChange={(e) => {
                if (e.target.value !== '__custom__') patch({ fontFamily: buildFontStack(e.target.value) })
              }}
            >
              <option value="__custom__">{vocab('— Choose or type below —')}</option>
              {installed.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Input
              value={style.fontFamily ?? ''}
              placeholder={vocab('Inherits the platform default')}
              aria-label={vocab('Font family (CSS stack)')}
              onChange={(e) => patch({ fontFamily: e.target.value || undefined })}
            />
            {missing && (
              <p className="appearance-editor__note">
                “{primary}” isn’t installed on this machine — the next font in the stack renders
                instead. The value is kept, in case this same style is applied elsewhere.
              </p>
            )}
            <span
              className="appearance-editor__font-preview"
              style={style.fontFamily ? { fontFamily: style.fontFamily } : undefined}
            >
              {quoteFamily(primary || 'sans-serif')} — Live preview 0123
            </span>
          </div>
        }
      />
      <Row
        label="Size"
        onReset={style.fontSizePx != null ? () => clear('fontSizePx') : undefined}
        control={
          <div className="flex items-center gap-2">
            <Slider
              min={8}
              max={72}
              step={1}
              value={style.fontSizePx ?? 13}
              aria-label={vocab('Font size')}
              onChange={(e) => patch({ fontSizePx: Number(e.target.value) })}
            />
            <NumberField
              value={style.fontSizePx ?? 13}
              min={4}
              max={200}
              ariaLabel="Font size (px)"
              onChange={(v) => patch({ fontSizePx: v })}
              className="w-16"
            />
          </div>
        }
      />
      <Row
        label="Weight"
        onReset={style.fontWeight != null ? () => clear('fontWeight') : undefined}
        control={
          <Select
            value={String(style.fontWeight ?? '')}
            aria-label={vocab('Font weight')}
            onChange={(e) => patch({ fontWeight: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">{vocab('Inherit')}</option>
            {WEIGHTS.map((w) => (
              <option key={w.v} value={w.v}>
                {w.label}
              </option>
            ))}
          </Select>
        }
      />
      <Row
        label="Italic"
        onReset={style.italic ? () => clear('italic') : undefined}
        control={<Switch checked={!!style.italic} onChange={(v) => patch({ italic: v || undefined })} ariaLabel="Italic" />}
      />

      <div className="appearance-editor__subhead">
        <button
          type="button"
          className="appearance-editor__disclosure"
          aria-expanded={showAxes}
          onClick={() => setShowAxes((s) => !s)}
        >
          {showAxes ? '▾' : '▸'} Variable font axes (advanced)
        </button>
      </div>
      {showAxes && (
        <div className="appearance-editor__fields appearance-editor__fields--nested">
          {!axesOk && (
            <p className="appearance-editor__note appearance-editor__note--warn">
              This platform's text renderer doesn't apply CSS font-variation-settings — these
              values are kept and will take effect if that changes, but nothing changes on screen
              here right now.
            </p>
          )}
          <p className="appearance-editor__note">
            Not every installed font defines every axis below; an axis a font doesn't have is
            simply ignored, per the CSS spec — your value is kept either way.
          </p>
          {(['wght', 'wdth', 'slnt', 'ital', 'opsz'] as const).map((axis) => {
            function setAxis(v: number | undefined): void {
              const nextAxes: AppearanceTextStyle['fontAxes'] = { ...style.fontAxes }
              if (v == null) delete nextAxes[axis]
              else nextAxes[axis] = v
              patch({ fontAxes: nextAxes })
            }
            return (
              <Row
                key={axis}
                label={axis}
                onReset={style.fontAxes?.[axis] != null ? () => setAxis(undefined) : undefined}
                control={
                  <NumberField
                    value={style.fontAxes?.[axis] ?? (axis === 'wght' ? 400 : 0)}
                    min={axis === 'wght' ? 1 : -100}
                    max={axis === 'wght' ? 1000 : 1000}
                    ariaLabel={`Font axis ${axis}`}
                    onChange={(v) => setAxis(v)}
                    className="w-20"
                  />
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ColorTab({
  style,
  patch,
  clear
}: {
  style: AppearanceTextStyle
  patch: (p: Partial<AppearanceTextStyle>) => void
  clear: (k: keyof AppearanceTextStyle) => void
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <div className="appearance-editor__fields">
      <ColorField label="Text colour" value={style.color} onChange={(v) => patch({ color: v })} onClear={() => clear('color')} />
      <ColorField label="Highlight" value={style.highlightColor} onChange={(v) => patch({ highlightColor: v })} onClear={() => clear('highlightColor')} />

      <div className="appearance-editor__subhead">{vocab('Decoration')}</div>
      <p className="appearance-editor__note">
        The browser text renderer can only draw ONE style/colour for underline, overline and
        strikethrough at once — when more than one line is on, they share the underline's style
        and colour. Each choice below is still stored and reapplied individually.
      </p>
      <Row
        label="Underline"
        onReset={style.underline && style.underline !== 'none' ? () => clear('underline') : undefined}
        control={
          <Select value={style.underline ?? 'none'} aria-label={vocab('Underline style')} onChange={(e) => patch({ underline: e.target.value as AppearanceTextStyle['underline'] })}>
            <option value="none">{vocab('None')}</option>
            <option value="solid">{vocab('Solid')}</option>
            <option value="double">{vocab('Double')}</option>
            <option value="dotted">{vocab('Dotted')}</option>
            <option value="dashed">{vocab('Dashed')}</option>
            <option value="wavy">{vocab('Wavy')}</option>
          </Select>
        }
      />
      {style.underline && style.underline !== 'none' && (
        <ColorField label="Underline colour" value={style.underlineColor} onChange={(v) => patch({ underlineColor: v })} onClear={() => clear('underlineColor')} />
      )}
      <Row
        label="Overline"
        onReset={style.overline ? () => clear('overline') : undefined}
        control={<Switch checked={!!style.overline} onChange={(v) => patch({ overline: v || undefined })} ariaLabel="Overline" />}
      />
      <Row
        label="Strikethrough"
        onReset={style.strikethrough && style.strikethrough !== 'none' ? () => clear('strikethrough') : undefined}
        control={
          <Select value={style.strikethrough ?? 'none'} aria-label={vocab('Strikethrough')} onChange={(e) => patch({ strikethrough: e.target.value as AppearanceTextStyle['strikethrough'] })}>
            <option value="none">{vocab('None')}</option>
            <option value="single">{vocab('Single')}</option>
            <option value="double">{vocab('Double')}</option>
          </Select>
        }
      />

      <div className="appearance-editor__subhead">{vocab('Case & position')}</div>
      <Row
        label="Capitalization"
        onReset={style.capitalization && style.capitalization !== 'none' ? () => clear('capitalization') : undefined}
        control={
          <Select value={style.capitalization ?? 'none'} aria-label={vocab('Capitalization')} onChange={(e) => patch({ capitalization: e.target.value as AppearanceTextStyle['capitalization'] })}>
            <option value="none">{vocab('None')}</option>
            <option value="uppercase">{vocab('UPPERCASE')}</option>
            <option value="lowercase">{vocab('lowercase')}</option>
            <option value="capitalize">{vocab('Capitalize')}</option>
            <option value="small-caps">{vocab('Small caps')}</option>
          </Select>
        }
      />
      <Row
        label="Super/subscript"
        onReset={style.verticalAlign && style.verticalAlign !== 'baseline' ? () => clear('verticalAlign') : undefined}
        control={
          <Select value={style.verticalAlign ?? 'baseline'} aria-label={vocab('Vertical align')} onChange={(e) => patch({ verticalAlign: e.target.value as AppearanceTextStyle['verticalAlign'] })}>
            <option value="baseline">{vocab('Baseline')}</option>
            <option value="super">{vocab('Superscript')}</option>
            <option value="sub">{vocab('Subscript')}</option>
          </Select>
        }
      />

      <div className="appearance-editor__subhead">{vocab('Outline, shadow & glow')}</div>
      <ColorField label="Outline colour" value={style.outlineColor} onChange={(v) => patch({ outlineColor: v })} onClear={() => clear('outlineColor')} />
      <Row
        label="Outline width"
        onReset={style.outlineWidthPx != null ? () => clear('outlineWidthPx') : undefined}
        control={<NumberField value={style.outlineWidthPx ?? 0} min={0} max={12} ariaLabel="Outline width (px)" onChange={(v) => patch({ outlineWidthPx: v })} className="w-16" />}
      />
      <ColorField label="Shadow colour" value={style.shadowColor} onChange={(v) => patch({ shadowColor: v })} onClear={() => clear('shadowColor')} />
      <Row label="Shadow blur" control={<NumberField value={style.shadowBlurPx ?? 0} min={0} max={40} ariaLabel="Shadow blur (px)" onChange={(v) => patch({ shadowBlurPx: v })} className="w-16" />} />
      <Row label="Shadow offset X" control={<NumberField value={style.shadowOffsetXPx ?? 0} min={-40} max={40} ariaLabel="Shadow offset X (px)" onChange={(v) => patch({ shadowOffsetXPx: v })} className="w-16" />} />
      <Row label="Shadow offset Y" control={<NumberField value={style.shadowOffsetYPx ?? 0} min={-40} max={40} ariaLabel="Shadow offset Y (px)" onChange={(v) => patch({ shadowOffsetYPx: v })} className="w-16" />} />
      <ColorField label="Glow colour" value={style.glowColor} onChange={(v) => patch({ glowColor: v })} onClear={() => clear('glowColor')} />
      <Row label="Glow blur" control={<NumberField value={style.glowBlurPx ?? 8} min={0} max={60} ariaLabel="Glow blur (px)" onChange={(v) => patch({ glowBlurPx: v })} className="w-16" />} />

      <div className="appearance-editor__subhead">{vocab('Surface')}</div>
      <ColorField label="Background" value={style.backgroundColor} onChange={(v) => patch({ backgroundColor: v })} onClear={() => clear('backgroundColor')} />
      <ColorField label="Border" value={style.borderColor} onChange={(v) => patch({ borderColor: v })} onClear={() => clear('borderColor')} />
      <Row label="Corner radius" control={<NumberField value={style.borderRadiusPx ?? 0} min={0} max={40} ariaLabel="Border radius (px)" onChange={(v) => patch({ borderRadiusPx: v })} className="w-16" />} />

      <div className="appearance-editor__subhead">{vocab('Compositing')}</div>
      <p className="appearance-editor__note">
        Every control below is unset by default and composes with whatever the element already
        renders, so nothing here replaces the styling above it. Leaving a section untouched
        produces exactly the CSS this editor produced before these existed.
      </p>
      <Row
        label="Opacity"
        onReset={style.opacity != null ? () => clear('opacity') : undefined}
        control={
          <Slider
            aria-label="Opacity"
            min={0}
            max={1}
            step={0.01}
            value={style.opacity ?? 1}
            onChange={(e) => patch({ opacity: Number(e.target.value) })}
          />
        }
      />
      <Row
        label="Blend mode"
        hint="How this element's pixels combine with what is painted behind it."
        onReset={style.blendMode ? () => clear('blendMode') : undefined}
        control={
          <Select
            value={style.blendMode ?? 'normal'}
            aria-label="Blend mode"
            onChange={(e) => patch({ blendMode: e.target.value as AppearanceBlendMode })}
          >
            {APPEARANCE_BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        }
      />

      <div className="appearance-editor__subhead">{vocab('Filters')}</div>
      <p className="appearance-editor__note">
        These compose into one CSS filter in a fixed order, so two of them can never clobber each
        other. Blur is applied last.
      </p>
      {FILTER_ROWS.map((f) => (
        <Row
          key={f.key}
          label={f.label}
          onReset={style[f.key] != null ? () => clear(f.key) : undefined}
          control={
            <Slider
              aria-label={f.label}
              min={f.min}
              max={f.max}
              step={f.step}
              value={(style[f.key] as number | undefined) ?? f.neutral}
              onChange={(e) => patch({ [f.key]: Number(e.target.value) })}
            />
          }
        />
      ))}
      <Row
        label="Backdrop blur"
        hint="Blurs what is BEHIND this element rather than the element itself."
        onReset={style.backdropBlurPx != null ? () => clear('backdropBlurPx') : undefined}
        control={<NumberField value={style.backdropBlurPx ?? 0} min={0} max={40} ariaLabel="Backdrop blur (px)" onChange={(v) => patch({ backdropBlurPx: v })} className="w-16" />}
      />

      <div className="appearance-editor__subhead">{vocab('Transform')}</div>
      <p className="appearance-editor__note">
        Composed as translate, rotate, scale, then skew. The order is fixed so a saved entry means
        exactly one thing whichever control wrote it last.
      </p>
      <Row label="Move X" onReset={style.translateXPx != null ? () => clear('translateXPx') : undefined} control={<NumberField value={style.translateXPx ?? 0} min={-200} max={200} ariaLabel="Translate X (px)" onChange={(v) => patch({ translateXPx: v })} className="w-16" />} />
      <Row label="Move Y" onReset={style.translateYPx != null ? () => clear('translateYPx') : undefined} control={<NumberField value={style.translateYPx ?? 0} min={-200} max={200} ariaLabel="Translate Y (px)" onChange={(v) => patch({ translateYPx: v })} className="w-16" />} />
      <Row
        label="Rotate"
        onReset={style.rotateDeg != null ? () => clear('rotateDeg') : undefined}
        control={<Slider aria-label="Rotate (degrees)" min={-180} max={180} step={1} value={style.rotateDeg ?? 0} onChange={(e) => patch({ rotateDeg: Number(e.target.value) })} />}
      />
      <Row label="Scale X" onReset={style.scaleX != null ? () => clear('scaleX') : undefined} control={<Slider aria-label="Scale X" min={0} max={3} step={0.01} value={style.scaleX ?? 1} onChange={(e) => patch({ scaleX: Number(e.target.value) })} />} />
      <Row label="Scale Y" onReset={style.scaleY != null ? () => clear('scaleY') : undefined} control={<Slider aria-label="Scale Y" min={0} max={3} step={0.01} value={style.scaleY ?? 1} onChange={(e) => patch({ scaleY: Number(e.target.value) })} />} />
      <Row label="Skew X" onReset={style.skewXDeg != null ? () => clear('skewXDeg') : undefined} control={<NumberField value={style.skewXDeg ?? 0} min={-89} max={89} ariaLabel="Skew X (degrees)" onChange={(v) => patch({ skewXDeg: v })} className="w-16" />} />
      <Row label="Skew Y" onReset={style.skewYDeg != null ? () => clear('skewYDeg') : undefined} control={<NumberField value={style.skewYDeg ?? 0} min={-89} max={89} ariaLabel="Skew Y (degrees)" onChange={(v) => patch({ skewYDeg: v })} className="w-16" />} />
      <Row
        label="Origin"
        hint="The point a rotation or scale pivots around."
        onReset={style.transformOrigin ? () => clear('transformOrigin') : undefined}
        control={
          <Select value={style.transformOrigin ?? 'center'} aria-label="Transform origin" onChange={(e) => patch({ transformOrigin: e.target.value })}>
            {TRANSFORM_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        }
      />
    </div>
  )
}

const TRANSFORM_ORIGINS = [
  'center',
  'top left',
  'top',
  'top right',
  'left',
  'right',
  'bottom left',
  'bottom',
  'bottom right'
] as const

/** The filter stack rows. `neutral` is the value that means "no change", which is what an unset
 *  control shows: 1 for the multiplicative filters, 0 for the additive ones. */
const FILTER_ROWS: readonly {
  key: keyof AppearanceTextStyle
  label: string
  min: number
  max: number
  step: number
  neutral: number
}[] = [
  { key: 'filterBrightness', label: 'Brightness', min: 0, max: 3, step: 0.01, neutral: 1 },
  { key: 'filterContrast', label: 'Contrast', min: 0, max: 3, step: 0.01, neutral: 1 },
  { key: 'filterSaturate', label: 'Saturation', min: 0, max: 3, step: 0.01, neutral: 1 },
  { key: 'filterHueRotateDeg', label: 'Hue rotate', min: -180, max: 180, step: 1, neutral: 0 },
  { key: 'filterGrayscale', label: 'Grayscale', min: 0, max: 1, step: 0.01, neutral: 0 },
  { key: 'filterInvert', label: 'Invert', min: 0, max: 1, step: 0.01, neutral: 0 },
  { key: 'filterSepia', label: 'Sepia', min: 0, max: 1, step: 0.01, neutral: 0 },
  { key: 'filterBlurPx', label: 'Blur', min: 0, max: 20, step: 0.5, neutral: 0 }
]

function LayoutTab({
  style,
  patch,
  clear
}: {
  style: AppearanceTextStyle
  patch: (p: Partial<AppearanceTextStyle>) => void
  clear: (k: keyof AppearanceTextStyle) => void
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <div className="appearance-editor__fields">
      <Row label="Letter spacing" onReset={style.letterSpacingPx != null ? () => clear('letterSpacingPx') : undefined} control={<NumberField value={style.letterSpacingPx ?? 0} min={-5} max={40} step={0.1} ariaLabel="Letter spacing (px)" onChange={(v) => patch({ letterSpacingPx: v })} className="w-20" />} />
      <Row label="Word spacing" onReset={style.wordSpacingPx != null ? () => clear('wordSpacingPx') : undefined} control={<NumberField value={style.wordSpacingPx ?? 0} min={-10} max={60} step={0.5} ariaLabel="Word spacing (px)" onChange={(v) => patch({ wordSpacingPx: v })} className="w-20" />} />
      <Row label="Line height" onReset={style.lineHeight != null ? () => clear('lineHeight') : undefined} control={<NumberField value={style.lineHeight ?? 1.4} min={0.5} max={4} step={0.05} ariaLabel="Line height" onChange={(v) => patch({ lineHeight: v })} className="w-20" />} />
      <Row label="Baseline offset" onReset={style.baselineShiftPx != null ? () => clear('baselineShiftPx') : undefined} control={<NumberField value={style.baselineShiftPx ?? 0} min={-20} max={20} ariaLabel="Baseline offset (px)" onChange={(v) => patch({ baselineShiftPx: v })} className="w-20" />} />
      <Row label="Direction" onReset={style.direction ? () => clear('direction') : undefined} control={
          <Select value={style.direction ?? 'ltr'} aria-label={vocab('Text direction')} onChange={(e) => patch({ direction: e.target.value as AppearanceTextStyle['direction'] })}>
            <option value="ltr">{vocab('Left to right')}</option>
            <option value="rtl">{vocab('Right to left')}</option>
        </Select>
      } />
      <Row label="Alignment" onReset={style.textAlign ? () => clear('textAlign') : undefined} control={
          <Select value={style.textAlign ?? 'left'} aria-label={vocab('Text alignment')} onChange={(e) => patch({ textAlign: e.target.value as AppearanceTextStyle['textAlign'] })}>
            <option value="left">{vocab('Left')}</option>
            <option value="center">{vocab('Center')}</option>
            <option value="right">{vocab('Right')}</option>
            <option value="justify">{vocab('Justify')}</option>
        </Select>
      } />
    </div>
  )
}

function PresetsTab({
  elementId,
  elementLabel,
  elementKind,
  style,
  entries,
  presets,
  inheritFrom
}: {
  elementId: string
  elementLabel: string
  elementKind: string
  style: AppearanceTextStyle
  entries: Record<string, ElementAppearanceEntry>
  presets: AppearancePreset[]
  inheritFrom: string | undefined
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [name, setName] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasStyle = Object.keys(style).length > 0

  function exportPresets(): void {
    const file = buildExportFile(presets)
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    saveBlobDownload(blob, 'nodeterm-appearance-presets.json')
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const result = parseImportFile(text, presets)
      for (const p of result.imported) {
        useSettings.getState().update({
          appearancePresets: [...useSettings.getState().settings.appearancePresets, p]
        })
      }
      setImportMsg(
        vocab(`Imported ${result.imported.length}. Skipped ${result.skippedInvalid} invalid, ${result.skippedDuplicateNames} duplicate name(s).`)
      )
    }
    reader.readAsText(file)
  }

  const otherIds = Object.keys(entries).filter((id) => id !== elementId)

  return (
    <div className="appearance-editor__fields">
      <div className="appearance-editor__subhead">{vocab('Apply a saved preset')}</div>
      {presets.length === 0 && <p className="appearance-editor__note">{vocab('No presets saved yet.')}</p>}
      {presets.map((p) => (
        <div key={p.id} className="appearance-editor__preset-row">
          <span className="appearance-editor__preset-name">{p.name}</span>
          <Button onClick={() => applyPresetToElement(elementId, elementLabel, elementKind, p)}>{vocab('Apply')}</Button>
          <button
            type="button"
            className="appearance-editor__row-reset"
            aria-label={vocab(`Delete preset ${p.name}`)}
            title={vocab('Delete preset')}
            onClick={() => deletePreset(p.id)}
          >
            🗑
          </button>
        </div>
      ))}

      <div className="appearance-editor__subhead">{vocab('Save current style as a preset')}</div>
      <div className="flex items-center gap-2">
        <Input
          value={name}
          placeholder={vocab('Preset name')}
          aria-label={vocab('New preset name')}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button
          variant="primary"
          disabled={!hasStyle || !name.trim()}
          onClick={() => {
            saveStyleAsPreset(name.trim(), style)
            setName('')
          }}
        >
          {vocab('Save')}
        </Button>
      </div>
      {!hasStyle && <p className="appearance-editor__note">{vocab("Change something first — there's nothing to save yet.")}</p>}

      <div className="appearance-editor__subhead">{vocab('Inherit from another element')}</div>
      <Select
        value={inheritFrom ?? ''}
        aria-label={vocab('Inherit unset properties from')}
        onChange={(e) =>
          setElementInheritFrom(elementId, elementLabel, elementKind, e.target.value || undefined)
        }
      >
        <option value="">{vocab('None')}</option>
        {otherIds.map((id) => (
          <option key={id} value={id}>
            {entries[id]?.label ?? id}
          </option>
        ))}
      </Select>
      <p className="appearance-editor__note">
        {vocab("Any property this element hasn't set itself is taken from the chosen element instead of the platform default.")}
      </p>

      <div className="appearance-editor__subhead">{vocab('Export / import')}</div>
      <div className="flex gap-2">
        <Button onClick={exportPresets} disabled={presets.length === 0}>{vocab('Export presets…')}</Button>
        <Button onClick={() => fileInputRef.current?.click()}>{vocab('Import presets…')}</Button>
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
      </div>
      {importMsg && <p className="appearance-editor__note">{importMsg}</p>}

      <div className="appearance-editor__subhead">{vocab('Reset')}</div>
      {!confirmingReset ? (
        <Button disabled={!hasStyle && !inheritFrom} onClick={() => setConfirmingReset(true)}>
          {vocab('Reset this element')}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              resetElement(elementId)
              setConfirmingReset(false)
            }}
          >
            {vocab('Click again to confirm')}
          </Button>
          <Button onClick={() => setConfirmingReset(false)}>{vocab('Cancel')}</Button>
        </div>
      )}
    </div>
  )
}
