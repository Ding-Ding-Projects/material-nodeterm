import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PortalDoorEntryRecord } from '@shared/portal-door'
import { AnchoredPopover } from '../../ui/AnchoredPopover'
import { Button, FieldLabel } from '../../ui/md3'
import { Input } from '../../ui/Input'

/**
 * The real portal-entry surface. It is intentionally not the toy-lock UnlockPrompt: this
 * popover admits navigation to a child canvas, while toy locks only decorate a user-selected
 * surface. It has no ladder or recovery game. Forgotten values take the explicit recovery route
 * supplied by the parent, normally the portal settings editor.
 */
export function PortalDoorEntryPopover({
  projectId,
  record,
  anchorRef,
  open,
  onEntered,
  onRecover,
  onClose
}: {
  projectId: string
  record: PortalDoorEntryRecord
  anchorRef: RefObject<HTMLElement>
  open: boolean
  onEntered: () => void
  onRecover: () => void
  onClose: () => void
}): React.JSX.Element | null {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [retryAfterMs, setRetryAfterMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue('')
      setError(null)
      inputRef.current?.focus()
    }
  }, [open, record.id])

  useEffect(() => {
    if (retryAfterMs <= 0) return
    const timer = window.setTimeout(() => setRetryAfterMs((current) => Math.max(0, current - 250)), 250)
    return () => window.clearTimeout(timer)
  }, [retryAfterMs])

  const numeric = record.mode === 'numeric-code'
  const submit = async (): Promise<void> => {
    if (busy || retryAfterMs > 0 || !value) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.nodeTerminal.portalDoor.verify({
        projectId,
        doorId: record.doorId,
        value
      })
      if (result.ok) {
        onEntered()
        return
      }
      setError(result.reason ?? 'That entry value did not match.')
      setRetryAfterMs(result.retryAfterMs ?? 0)
    } catch {
      setError('The portal entry service could not be reached. Try again or open portal settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      width={360}
      className="portal-door-entry-popover"
    >
      <div className="portal-door-entry__title">Enter “{record.label}”</div>
      <p className="portal-door-entry__explanation">
        This portal has its own {numeric ? 'numeric code' : 'passphrase'}. It is separate from toy locks and is checked in the local vault.
      </p>
      <FieldLabel className="portal-door-entry__field" label={numeric ? 'Numeric code' : 'Passphrase'}>
        <Input
          ref={inputRef}
          type={numeric ? 'text' : 'password'}
          inputMode={numeric ? 'numeric' : 'text'}
          autoComplete="off"
          value={value}
          maxLength={numeric ? 12 : 1024}
          onChange={(event) => setValue(numeric ? event.target.value.replace(/[^0-9]/g, '') : event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          disabled={busy || retryAfterMs > 0}
          aria-describedby="portal-door-entry-status"
        />
      </FieldLabel>
      <div id="portal-door-entry-status" className="portal-door-entry__status" aria-live="polite">
        {error}
        {retryAfterMs > 0 ? ` Try again in ${Math.ceil(retryAfterMs / 1000)}s.` : null}
      </div>
      <div className="portal-door-entry__actions">
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="filled"
          onClick={() => void submit()}
          disabled={busy || retryAfterMs > 0 || !value}
        >
          {busy ? 'Checking…' : 'Enter portal'}
        </Button>
      </div>
      <Button variant="text" className="portal-door-entry__recovery" onClick={onRecover}>
        Forgotten the entry value? Open portal settings
      </Button>
    </AnchoredPopover>
  )
}

