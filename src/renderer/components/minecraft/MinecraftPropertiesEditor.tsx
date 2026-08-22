import { useEffect, useState } from 'react'
import { MANAGED_PROPERTY_FIELDS, type MinecraftPropertyFieldSpec as PropertyFieldSpec } from '@shared/minecraft'
import { useSession } from '../../session/session'

/** True while the server is running — server.properties is only read at startup, so editing it
 *  live would silently do nothing until a restart. The manager itself refuses the write for the
 *  same reason; this just explains it in the control before the user finds out the hard way. */
function isServerLive(phase: string): boolean {
  return phase === 'starting' || phase === 'running' || phase === 'stopping'
}

function FieldControl({
  spec,
  value,
  onChange,
  disabled,
  idPrefix
}: {
  spec: PropertyFieldSpec
  value: string
  onChange: (v: string) => void
  disabled: boolean
  idPrefix: string
}): React.JSX.Element {
  const id = `${idPrefix}-${spec.key}`
  if (spec.kind === 'boolean') {
    return (
      <label className="mc-checkbox nodrag">
        <input
          type="checkbox"
          id={id}
          checked={value === 'true'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        {spec.label}
      </label>
    )
  }
  if (spec.kind === 'enum') {
    return (
      <label className="service-node__field" htmlFor={id}>
        <span className="service-node__field-label">{spec.label}</span>
        <select
          id={id}
          className="service-node__input nodrag"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(spec.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    )
  }
  if (spec.kind === 'integer') {
    return (
      <label className="service-node__field" htmlFor={id}>
        <span className="service-node__field-label">{spec.label}</span>
        <input
          id={id}
          type="number"
          className="service-node__input nodrag"
          value={value}
          min={spec.min}
          max={spec.max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    )
  }
  return (
    <label className="service-node__field" htmlFor={id}>
      <span className="service-node__field-label">{spec.label}</span>
      <input
        id={id}
        type="text"
        className="service-node__input nodrag"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

/** A typed editor over the managed subset of server.properties — see
 *  core/minecraft/properties.ts's MANAGED_PROPERTY_FIELDS for exactly which keys get a control.
 *  Reads and writes the real file through the same manager the console/EULA/create flows use;
 *  nothing here is a mock of the file's contents. */
export function MinecraftPropertiesEditor({ nodeId, phase }: { nodeId: string; phase: string }): React.JSX.Element {
  const { api } = useSession()
  const [record, setRecord] = useState<Record<string, string> | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    setLoading(true)
    void api.minecraft
      .readProperties(nodeId)
      .then((r) => {
        setRecord(r)
        setDraft(r ?? {})
      })
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [nodeId])

  const live = isServerLive(phase)

  if (loading) return <p className="service-node__note">Loading server.properties…</p>
  if (record === null) {
    return <p className="service-node__note">This server hasn't been installed yet, so there is no server.properties to edit.</p>
  }

  const dirty = MANAGED_PROPERTY_FIELDS.some((f) => (draft[f.key] ?? '') !== (record[f.key] ?? ''))

  const handleFieldChange = (key: string, value: string): void => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSavedAt(null)
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const updates: Record<string, string> = {}
      for (const f of MANAGED_PROPERTY_FIELDS) {
        if ((draft[f.key] ?? '') !== (record[f.key] ?? '')) updates[f.key] = draft[f.key] ?? ''
      }
      const status = await api.minecraft.writeProperties(nodeId, updates)
      if (status.phase === 'error' && status.error) {
        setError(status.error)
      } else {
        setSavedAt(Date.now())
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mc-properties nodrag">
      {live && (
        <p className="mc-note--warn">
          server.properties is only read at startup. Changes made here take effect the next time the
          server starts, and cannot be saved while it is currently running.
        </p>
      )}
      {error && <p className="mc-note--error">{error}</p>}
      <div className="mc-properties__grid">
        {MANAGED_PROPERTY_FIELDS.map((f) => (
          <FieldControl
            key={f.key}
            spec={f}
            value={draft[f.key] ?? ''}
            onChange={(v) => handleFieldChange(f.key, v)}
            disabled={saving || live}
            idPrefix={`${nodeId}-mc-props`}
          />
        ))}
      </div>
      <div className="mc-row">
        <button
          type="button"
          className="mc-button mc-button--primary nodrag"
          disabled={!dirty || saving || live}
          onClick={() => void handleSave()}
        >
          Save server.properties
        </button>
        <button type="button" className="mc-button nodrag" disabled={saving} onClick={load}>
          Reload
        </button>
        {savedAt !== null && <span className="mc-note--saved">Saved.</span>}
      </div>
      <p className="service-node__note">
        Every other key already in the real file — not shown here — is preserved untouched.
      </p>
    </div>
  )
}
