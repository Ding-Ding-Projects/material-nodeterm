import { useRef, useState } from 'react'
import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import {
  buildExportFile,
  deletePreset,
  parseImportFile,
  resetAllElements,
  resetElement,
  renamePreset
} from '@renderer/state/appearance'
import { openAppearanceEditor } from '@renderer/state/appearanceEditorHost'
import { APP_CHROME_TARGETS, kindLabel } from '@renderer/lib/appearance/registry'
import { isStyleEmpty } from '@renderer/lib/appearance/apply'
import { saveBlobDownload } from '@renderer/lib/exportSave'

const ROWS = {
  chrome: { title: 'App chrome', keywords: ['appearance', 'editor', 'chrome', 'menu', 'dialog', 'tab bar'] },
  overrides: {
    title: 'Customized elements',
    keywords: ['appearance', 'overrides', 'elements', 'tabs', 'nodes', 'font', 'colour', 'color']
  },
  presets: {
    title: 'Presets',
    keywords: ['appearance', 'preset', 'theme', 'export', 'import', 'save']
  },
  reset: { title: 'Reset all appearance edits', keywords: ['reset', 'default', 'appearance', 'clear'] }
}
const ENTRIES = Object.values(ROWS)

/** A stable anchor for opening the editor from a settings ROW (rather than the element itself,
 *  which may not currently be on screen — a customized tab on another project, for instance). */
function RowAnchorButton({
  id,
  label,
  kind,
  children
}: {
  id: string
  label: string
  kind: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <Button
      ref={ref}
      onClick={() => {
        if (ref.current) openAppearanceEditor(id, label, kind, ref.current)
      }}
    >
      {children}
    </Button>
  )
}

export function AppearanceEditorSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const entries = useSettings((s) => s.settings.elementAppearance)
  const presets = useSettings((s) => s.settings.appearancePresets)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const overrideIds = Object.keys(entries).filter((id) => !isStyleEmpty(entries[id].style) || entries[id].inheritFrom)

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
      if (result.imported.length) {
        useSettings.getState().update({
          appearancePresets: [...useSettings.getState().settings.appearancePresets, ...result.imported]
        })
      }
      setImportMsg(
        `Imported ${result.imported.length} preset(s). Skipped ${result.skippedInvalid} invalid, ${result.skippedDuplicateNames} duplicate name(s).`
      )
    }
    reader.readAsText(file)
  }

  return (
    <SettingsSection
      id="appearance-editor"
      title="Appearance editor"
      description="Every rendered element can be re-typeset — right-click it and choose Edit appearance… (Shift+right-click on a tab or a terminal/agent node opens it directly; the command palette also lists Edit appearance for the open node). This page manages what's already customized, plus the app-chrome elements that don't have their own visible element to right-click."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.chrome}>
        <div>
          <h4 className="text-[13px] font-medium text-text">App chrome</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            The editor themes its own chrome too — including the dialog you'd be looking at right
            now if you opened one of these.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {APP_CHROME_TARGETS.map((t) => (
              <RowAnchorButton key={t.id} id={t.id} label={t.label} kind="app">
                {t.label}
              </RowAnchorButton>
            ))}
          </div>
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.overrides}>
        <div>
          <h4 className="text-[13px] font-medium text-text">Customized elements</h4>
          {overrideIds.length === 0 ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Nothing customized yet — right-click any tab or node title and choose "Edit
              appearance…" to start.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-border/60">
              {overrideIds.map((id) => (
                <div key={id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-text">{entries[id].label}</div>
                    <div className="text-[11px] text-muted">{kindLabel(entries[id].kind)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RowAnchorButton id={id} label={entries[id].label} kind={entries[id].kind}>
                      Edit…
                    </RowAnchorButton>
                    <Button onClick={() => resetElement(id)}>Reset</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.presets}>
        <div>
          <h4 className="text-[13px] font-medium text-text">Presets</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Saved from any element's appearance editor. Export them to a file to share or back up,
            import a file someone sent you.
          </p>
          {presets.length > 0 && (
            <div className="mt-3 divide-y divide-border/60">
              {presets.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-2">
                  {renamingId === p.id ? (
                    <Input
                      autoFocus
                      value={renameDraft}
                      className="flex-1"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => {
                        if (renameDraft.trim()) renamePreset(p.id, renameDraft.trim())
                        setRenamingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (renameDraft.trim()) renamePreset(p.id, renameDraft.trim())
                          setRenamingId(null)
                        }
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <span className="min-w-0 truncate text-[13px] text-text">{p.name}</span>
                  )}
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      onClick={() => {
                        setRenamingId(p.id)
                        setRenameDraft(p.name)
                      }}
                    >
                      Rename
                    </Button>
                    <Button onClick={() => deletePreset(p.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={exportPresets} disabled={presets.length === 0}>
              Export presets…
            </Button>
            <Button onClick={() => fileInputRef.current?.click()}>Import presets…</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={onImportFile}
            />
          </div>
          {importMsg && <p className="mt-2 text-[12px] text-muted">{importMsg}</p>}
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.reset}>
        <div>
          <h4 className="text-[13px] font-medium text-text">Reset all appearance edits</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Puts every tab, node and app-chrome element that was customized back to the platform
            default. Saved presets are kept.
          </p>
          <div className="mt-3">
            <Button
              disabled={overrideIds.length === 0}
              onClick={() => resetAllElements()}
            >
              Reset every customized element
            </Button>
          </div>
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
