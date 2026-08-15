import { useRef, useState } from 'react'
import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Input } from '@renderer/ui/Input'
import { Button } from '@renderer/ui/Button'
import { Select } from '@renderer/ui/Select'
import { NumberField } from '@renderer/ui/NumberField'
import { ColorField } from '@renderer/components/color/ColorField'
import { SHIPPED_APP_NAME, resolveAppDisplayName } from '@shared/appIdentity'
import { APP_LOGO_PRESETS } from '@renderer/components/appearance/BrandMark'
import { DEFAULT_CROP, processLogoFile, type LogoValidationError } from '@renderer/lib/appearance/logoProcess'
import type { AppLogoCrop } from '@shared/types'

const ROWS = {
  name: { title: 'App name', keywords: ['rename', 'name', 'title', 'brand', 'identity'] },
  logo: { title: 'App logo', keywords: ['logo', 'icon', 'brand', 'mark', 'image', 'upload'] }
}
const ENTRIES = Object.values(ROWS)

export function AppIdentitySection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const appDisplayName = useSettings((s) => s.settings.appDisplayName)
  const appLogo = useSettings((s) => s.settings.appLogo)
  const update = useSettings((s) => s.update)
  const [nameDraft, setNameDraft] = useState(appDisplayName)
  const [fit, setFit] = useState<'contain' | 'cover' | 'fill'>(appLogo.customImage?.fit ?? 'contain')
  const [bg, setBg] = useState(appLogo.customImage?.backgroundColor ?? '#00000000')
  const [crop, setCrop] = useState<AppLogoCrop>(appLogo.customImage?.crop ?? DEFAULT_CROP)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [processError, setProcessError] = useState<LogoValidationError | null>(null)
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const effectiveName = resolveAppDisplayName(appDisplayName)

  function commitName(): void {
    update({ appDisplayName: nameDraft.trim() })
  }

  async function reprocess(file: File, nextFit: typeof fit, nextBg: string, nextCrop: AppLogoCrop): Promise<void> {
    setProcessing(true)
    setProcessError(null)
    const result = await processLogoFile(file, nextFit, nextBg, nextCrop)
    setProcessing(false)
    if (!result.ok) {
      setProcessError(result.error)
      return
    }
    update({ appLogo: { selection: 'custom', customImage: result.image } })
  }

  function onSelectFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPendingFile(file)
    setFit('contain')
    setBg('#00000000')
    setCrop(DEFAULT_CROP)
    void reprocess(file, 'contain', '#00000000', DEFAULT_CROP)
  }

  const activeFile = pendingFile
  function onAdjust(patch: Partial<{ fit: typeof fit; bg: string; crop: AppLogoCrop }>): void {
    const nextFit = patch.fit ?? fit
    const nextBg = patch.bg ?? bg
    const nextCrop = patch.crop ?? crop
    setFit(nextFit)
    setBg(nextBg)
    setCrop(nextCrop)
    if (activeFile) void reprocess(activeFile, nextFit, nextBg, nextCrop)
  }

  return (
    <SettingsSection
      id="app-identity"
      title="App name & logo"
      description="Purely presentational — what the app calls itself and shows as its mark on screen. Neither one touches the app's real identity (data directory, installer, update feed): see docs/app-rename.md and docs/app-logo.md."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.name}>
        <div>
          <FieldRow
            label="App name"
            description={`Shown in the title bar, the brand mark and notifications. Reports, crash logs and GitHub issues always say "${SHIPPED_APP_NAME}" regardless, so a bug can always be found by its real name.`}
            control={
              <div className="flex items-center gap-2">
                <Input
                  value={nameDraft}
                  placeholder={SHIPPED_APP_NAME}
                  aria-label="App display name"
                  className="w-56"
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitName()
                  }}
                />
                <Button
                  disabled={!appDisplayName}
                  onClick={() => {
                    setNameDraft('')
                    update({ appDisplayName: '' })
                  }}
                >
                  Reset
                </Button>
              </div>
            }
          />
          <p className="mt-2 text-[12px] text-muted">
            Currently shown as: <strong className="text-text">{effectiveName}</strong>
          </p>
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.logo}>
        <div>
          <h4 className="text-[13px] font-medium text-text">App logo</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Changes the mark shown in the tab bar (and anywhere else it's used). This does not
            change the packaged application icon (dock/taskbar/installer) — that is generated at
            build time and re-packaging is required to change it; see docs/app-logo.md.
          </p>

          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Logo preset">
            {APP_LOGO_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={appLogo.selection === p.id}
                title={p.label}
                aria-label={`Use the ${p.label} logo`}
                onClick={() => update({ appLogo: { selection: p.id } })}
                className={`app-logo__preset${appLogo.selection === p.id ? ' is-active' : ''}`}
              >
                {p.render(28)}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={appLogo.selection === 'custom'}
              title={appLogo.customImage ? 'Custom image' : 'No custom image uploaded yet'}
              aria-label="Use the custom uploaded logo"
              disabled={!appLogo.customImage}
              onClick={() => update({ appLogo: { selection: 'custom', customImage: appLogo.customImage } })}
              className={`app-logo__preset${appLogo.selection === 'custom' ? ' is-active' : ''}`}
            >
              {appLogo.customImage ? (
                <img src={appLogo.customImage.dataUrl} width={28} height={28} alt="" style={{ objectFit: 'contain' }} />
              ) : (
                <span className="app-logo__preset-empty" aria-hidden="true">
                  +
                </span>
              )}
            </button>
          </div>

          <div className="mt-4">
            <Button onClick={() => fileInputRef.current?.click()}>
              {appLogo.customImage ? 'Replace custom image…' : 'Upload custom image…'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              className="hidden"
              onChange={onSelectFile}
            />
            {appLogo.customImage && (
              <Button
                className="ml-2"
                onClick={() => {
                  update({ appLogo: { selection: 'shipped' } })
                  setPendingFile(null)
                }}
              >
                Remove custom image
              </Button>
            )}
          </div>

          {processing && <p className="mt-2 text-[12px] text-muted">Processing…</p>}
          {processError && (
            <p className="mt-2 text-[12px] text-[color:var(--danger)]">
              {processError.message} The logo shown above is unchanged.
            </p>
          )}

          {activeFile && appLogo.customImage && (
            <div className="mt-4 space-y-3 border-l border-border pl-4">
              <p className="text-[12px] text-muted">
                Adjusting “{appLogo.customImage.sourceName}”. Crop is entered as a percentage of
                the source image (keyboard-friendly numeric equivalent of a drag crop).
              </p>
              <FieldRow
                label="Fit"
                control={
                  <Select value={fit} aria-label="Logo fit" onChange={(e) => onAdjust({ fit: e.target.value as typeof fit })}>
                    <option value="contain">Contain</option>
                    <option value="cover">Cover</option>
                    <option value="fill">Fill (stretch)</option>
                  </Select>
                }
              />
              <ColorField
                label="Background"
                value={bg}
                onChange={(v) => onAdjust({ bg: v })}
                onClear={() => onAdjust({ bg: '#00000000' })}
              />
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] as const).map((k) => {
                  function setCropField(v: number): void {
                    const pct = Math.min(1, Math.max(0, v / 100))
                    const nextCrop: AppLogoCrop = { ...crop }
                    nextCrop[k] = pct
                    onAdjust({ crop: nextCrop })
                  }
                  return (
                    <label key={k} className="flex items-center justify-between gap-2 text-[12px] text-text">
                      <span className="capitalize">{k}</span>
                      <NumberField
                        value={Math.round(crop[k] * 100)}
                        min={0}
                        max={100}
                        ariaLabel={`Crop ${k} (%)`}
                        onChange={setCropField}
                        className="w-16"
                      />
                    </label>
                  )
                })}
              </div>
              <Button onClick={() => onAdjust({ crop: DEFAULT_CROP })}>Reset crop</Button>
            </div>
          )}
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
