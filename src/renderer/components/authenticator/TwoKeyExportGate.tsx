// The one place authenticator secrets can leave the app in the clear: a real two-key
// super-confirmation gate, not a single "Are you sure?" dialog. Two independently operated
// checkboxes ("keys") must BOTH be checked before the confirmation slider even becomes
// operable; only dragging that slider all the way actually exports. An Emergency exit is always
// one click away. See docs/authenticator.md.
import { useState } from 'react'
import { MaterialSymbol } from '../MaterialSymbol'

export function TwoKeyExportGate({
  count,
  busy,
  onExport,
  onCancel
}: {
  count: number
  busy: boolean
  onExport: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [keyA, setKeyA] = useState(false)
  const [keyB, setKeyB] = useState(false)
  const [slide, setSlide] = useState(0)
  const bothKeys = keyA && keyB
  const armed = bothKeys && !busy

  const onSlideChange = (v: number): void => {
    if (!armed) return
    setSlide(v)
    if (v >= 100) onExport()
  }

  return (
    <div className="toylock-export-gate" role="group" aria-label="Confirm secrets export">
      <p className="toylock-export-gate__warning">
        <MaterialSymbol name="warning" size={18} />
        <span>
          This downloads {count} usable, unencrypted authenticator secret{count === 1 ? '' : 's'} as
          a plain-text file, to your browser or OS's default downloads location. Anyone who can read
          that file can generate codes exactly as this app does.
        </span>
      </p>
      <label className="toylock-checkbox-row">
        <input type="checkbox" checked={keyA} onChange={(e) => setKeyA(e.target.checked)} disabled={busy} />
        Key 1 — I understand this file will contain readable secrets, not codes
      </label>
      <label className="toylock-checkbox-row">
        <input type="checkbox" checked={keyB} onChange={(e) => setKeyB(e.target.checked)} disabled={busy} />
        Key 2 — I'm exporting this somewhere private, not a shared or synced location
      </label>
      <div className="toylock-export-gate__slider-row">
        <input
          type="range"
          min={0}
          max={100}
          value={slide}
          disabled={!armed}
          onChange={(e) => onSlideChange(Number(e.target.value))}
          aria-label={
            bothKeys
              ? 'Drag to the end to export secrets'
              : 'Check both keys above to enable the export slider'
          }
          className="toylock-export-gate__slider"
        />
        <span className="toylock-hint">
          {busy ? 'Exporting…' : armed ? 'Drag to the end to export' : 'Both keys required'}
        </span>
      </div>
      <div className="toylock-wizard__actions">
        <button className="toylock-btn" onClick={onCancel}>
          Emergency exit
        </button>
      </div>
    </div>
  )
}
