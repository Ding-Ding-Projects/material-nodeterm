// Reusable "Export…" control: format picker → lossy-format disclosure (shown BEFORE the export
// runs, never after) → save → an "Open in Visual Studio Code" follow-up when the save produced a
// real path (Desktop; the Server Edition's browser download has no path — see docs/exports.md).
//
// Deliberately an inline expanding panel rather than a floating popover: it renders in the flow of
// whatever section places it, so it needs none of the anchored-overlay viewport-collision handling
// a detached popup would — the panel this lives in already scrolls if it needs to.

import { useState } from 'react'
import type { BuiltExport, ExportFormat, ExportKind } from '@shared/export'
import { FORMAT_INFO, formatsForKind } from '@shared/export'
import { Select } from '@renderer/ui/Select'
import { useVocabularyMapper } from '@renderer/lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence } from '@renderer/lib/personalVocabulary/ownedCopy'

export interface ExportMenuProps {
  kind: ExportKind
  /** Build the export for the CHOSEN format on demand — cheap for these lists, and keeps the
   *  lossy-disclosure text always in sync with the format actually about to be written. */
  build: (format: ExportFormat) => BuiltExport
  /** Shown in the "Open in Visual Studio Code" follow-up and the save dialog's default name. */
  label: string
}

type SaveState = { status: 'idle' } | { status: 'saved'; path?: string } | { status: 'error'; message: string }

export function ExportMenu({ kind, build, label }: ExportMenuProps): JSX.Element {
  const vocab = useVocabularyMapper()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>(formatsForKind(kind)[0]?.id ?? 'json')
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)

  const offered = formatsForKind(kind)
  const preview = open ? build(format) : null

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveState({ status: 'idle' })
    try {
      const built = build(format)
      const bridge = window.nodeTerminal.export
      const result = await bridge.saveText(built.filename, built.content, built.mimeType)
      if (!result.ok) {
        if (result.canceled) {
          setSaveState({ status: 'idle' })
        } else {
          setSaveState({ status: 'error', message: result.error ?? 'Could not save the export.' })
        }
      } else {
        setSaveState({ status: 'saved', path: result.path })
      }
    } catch (e) {
      setSaveState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const openInVsCode = async (path: string): Promise<void> => {
    setOpening(true)
    try {
      const result = await window.nodeTerminal.vscode.open(path)
      if (!result.ok) setSaveState({ status: 'error', message: result.error })
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="export-menu md3-export-menu">
      <button
        type="button"
        className="export-menu__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {vocab('Export…')}
      </button>
      {open && (
        <div
          className="export-menu__panel"
          role="group"
          aria-label={mapOwnedSentence(vocab, [copy('Export '), fact(label)])}
        >
          <label className="export-menu__format-label">
            {vocab('Format')}
            <Select
              className="export-menu__format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as ExportFormat)
                setSaveState({ status: 'idle' })
              }}
            >
              {offered.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                  {f.writeOnly ? ` (${vocab('write-only')})` : ''}
                </option>
              ))}
            </Select>
          </label>

          {preview && preview.lossy.length > 0 && (
            <div className="export-menu__lossy" role="note">
              <div className="export-menu__lossy-title">{vocab('This format cannot carry everything faithfully:')}</div>
              <ul>
                {preview.lossy.map((n, i) => (
                  <li key={i}>
                    {n.field !== '*' && <strong>{n.field}</strong>}
                    {n.field !== '*' ? ' — ' : ''}
                    {n.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="export-menu__meta">
            {FORMAT_INFO[format].mimeType} · UTF-8 · {preview?.lineEnding === 'CRLF' ? 'CRLF' : 'LF'}{' '}
            {vocab('line endings')}
            {FORMAT_INFO[format].writeOnly && ` · ${vocab('presentation only, not re-importable')}`}
          </div>

          <div className="export-menu__buttons">
            <button type="button" className="export-menu__save" disabled={saving} onClick={() => void save()}>
              {saving ? vocab('Saving…') : vocab('Save')}
            </button>
            {saveState.status === 'saved' && saveState.path && (
              <button
                type="button"
                className="export-menu__open-vscode"
                disabled={opening}
                onClick={() => void openInVsCode(saveState.path!)}
              >
                {opening ? vocab('Opening…') : vocab('Open in Visual Studio Code')}
              </button>
            )}
          </div>

          {saveState.status === 'saved' && (
            <div className="export-menu__result" role="status">
              {saveState.path
                ? mapOwnedSentence(vocab, [copy('Saved to '), fact(saveState.path)])
                : vocab('Download started.')}
            </div>
          )}
          {saveState.status === 'error' && (
            <div className="export-menu__result export-menu__result--error" role="alert">
              {saveState.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
