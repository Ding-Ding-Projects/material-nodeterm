import { useState } from 'react'

import { KIDS_DISCLOSURE, KIDS_REFUSED_PERMISSION_MODES } from '@shared/kids-mode-policy'
import { PERMISSION_MODE_LABELS } from '@shared/agents/config'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { useKidsMode } from '../../../state/kidsMode'
import { FieldRow } from '../FieldRow'
import { SearchableRow } from '../SearchableRow'
import { SettingsSection } from '../SettingsSection'

const ROWS = {
  toggle: {
    title: 'Kids mode',
    keywords: ['kids', 'child', 'children', 'safe', 'parental', 'family', 'pin', 'lock']
  },
  limits: {
    title: 'What kids mode does and does not do',
    keywords: ['kids', 'safety', 'sandbox', 'limits', 'permission', 'agent', 'delete']
  },
  rename: { title: 'Rename kids mode', keywords: ['rename', 'kids', 'display name'] },
  pin: { title: 'Kids mode PIN', keywords: ['pin', 'password', 'unlock', 'grown-up', 'kids'] }
}
const ENTRIES = Object.values(ROWS)

/**
 * Settings surface for the shared Kids-mode switch. See docs/kids-mode.md.
 *
 * The disclosure is not decoration and must not be softened: this app's core function is arbitrary
 * shell access plus agents that run commands, so the mode cannot sandbox anything. It is rendered
 * from `KIDS_DISCLOSURE` rather than retyped here, so the wording a user reads is the same string
 * a test asserts — a second copy would be one edit away from promising more than the mode does.
 */
export function KidsModeSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const enabled = useKidsMode((s) => s.enabled)
  const name = useKidsMode((s) => s.name)
  const hasCredential = useKidsMode((s) => s.hasCredential)
  const enable = useKidsMode((s) => s.enable)
  const disable = useKidsMode((s) => s.disable)
  const rename = useKidsMode((s) => s.rename)
  const changePin = useKidsMode((s) => s.changePin)

  const [nameDraft, setNameDraft] = useState(name)
  const [renameSaved, setRenameSaved] = useState(false)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [currentPinDraft, setCurrentPinDraft] = useState('')
  const [nextPinDraft, setNextPinDraft] = useState('')
  const [pinChangeMsg, setPinChangeMsg] = useState<string | null>(null)

  return (
    // `title={name}`, never the literal "Kids mode": the record is renamable and no surface may
    // reveal the shipped name once a user has changed it — the same rule School mode follows.
    <SettingsSection id="kids-mode" title={name} isActive={isActive} searchEntries={ENTRIES}>
      <SearchableRow {...ROWS.toggle}>
        <FieldRow
          label={enabled ? `${name} is on` : `${name} is off`}
          description={`Keeps everything playful — dim sum, the funny levels and the language modes all stay — and adds limits instead: agents cannot start in a mode that acts without asking, and deleting a session always asks twice. It affects every app reading this machine's shared record, not just this one. Turning it OFF needs the grown-up PIN; turning it ON never does.`}
          control={
            enabled ? (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  value={unlockPin}
                  onChange={(e) => {
                    setUnlockPin(e.target.value)
                    setError(null)
                  }}
                  placeholder="Grown-up PIN"
                  className="w-40"
                  aria-label={`Grown-up PIN to turn ${name} off`}
                />
                <Button
                  disabled={busy || unlockPin.length === 0}
                  onClick={async () => {
                    setBusy(true)
                    const result = await disable(unlockPin)
                    setBusy(false)
                    if (!result.ok) {
                      setError(result.error)
                      return
                    }
                    setUnlockPin('')
                    setError(null)
                  }}
                >
                  Turn off
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-2">
                {!hasCredential ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Choose a PIN"
                      className="w-32"
                      aria-label="Choose a grown-up PIN"
                    />
                    <Input
                      type="password"
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value)}
                      placeholder="Confirm PIN"
                      className="w-32"
                      aria-label="Confirm the grown-up PIN"
                    />
                  </div>
                ) : null}
                <Button
                  variant="primary"
                  disabled={busy || (!hasCredential && (pin.length < 4 || pin !== pinConfirm))}
                  onClick={async () => {
                    setBusy(true)
                    const result = await enable(hasCredential ? undefined : pin)
                    setBusy(false)
                    if (!result.ok) {
                      setError(result.error)
                      return
                    }
                    setError(null)
                    setPin('')
                    setPinConfirm('')
                  }}
                >
                  Turn on
                </Button>
              </div>
            )
          }
        />
        {error ? <p className="text-[12px] leading-relaxed text-[color:var(--warn)]">{error}</p> : null}
        <p className="text-[12px] leading-relaxed text-muted-2">
          Forgot the PIN? There is no reset flow — delete this machine&apos;s{' '}
          <code>~/.nodeterm/shared</code> folder to turn the mode off and clear it.
        </p>
      </SearchableRow>

      <SearchableRow {...ROWS.limits}>
        {/* The honest boundary, stated before anyone relies on the mode rather than after. */}
        <p className="rounded-md border border-[color:var(--warn)] px-3 py-2 text-[13px] leading-relaxed text-text">
          {KIDS_DISCLOSURE}
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          While it is on, an agent cannot be started in these modes:
        </p>
        <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-muted">
          {Object.entries(KIDS_REFUSED_PERMISSION_MODES).map(([mode, why]) => (
            <li key={mode}>
              <strong className="text-text">
                {PERMISSION_MODE_LABELS[mode as keyof typeof PERMISSION_MODE_LABELS] ?? mode}
              </strong>{' '}
              — {why}. It falls back to asking every time.
            </li>
          ))}
        </ul>
      </SearchableRow>

      <SearchableRow {...ROWS.rename}>
        <FieldRow
          label="Display name"
          description="What this mode is called everywhere in the app. Some families prefer the child's own name."
          control={
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => {
                  setNameDraft(e.target.value)
                  setRenameSaved(false)
                }}
                className="w-48"
                aria-label="Kids mode display name"
              />
              <Button
                disabled={nameDraft.trim() === name}
                onClick={async () => {
                  await rename(nameDraft)
                  setRenameSaved(true)
                }}
              >
                {renameSaved ? 'Saved' : 'Save'}
              </Button>
            </div>
          }
        />
      </SearchableRow>

      <SearchableRow {...ROWS.pin}>
        <FieldRow
          label="Change the grown-up PIN"
          description="Needs the current PIN. The PIN itself is never stored — only a hash of it."
          control={
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={currentPinDraft}
                onChange={(e) => {
                  setCurrentPinDraft(e.target.value)
                  setPinChangeMsg(null)
                }}
                placeholder="Current"
                className="w-32"
                aria-label="Current grown-up PIN"
              />
              <Input
                type="password"
                value={nextPinDraft}
                onChange={(e) => {
                  setNextPinDraft(e.target.value)
                  setPinChangeMsg(null)
                }}
                placeholder="New"
                className="w-32"
                aria-label="New grown-up PIN"
              />
              <Button
                disabled={!hasCredential || currentPinDraft.length === 0 || nextPinDraft.length < 4}
                onClick={async () => {
                  const ok = await changePin(currentPinDraft, nextPinDraft)
                  setPinChangeMsg(ok ? 'PIN changed.' : 'That current PIN did not match.')
                  if (ok) {
                    setCurrentPinDraft('')
                    setNextPinDraft('')
                  }
                }}
              >
                Change
              </Button>
            </div>
          }
        />
        {pinChangeMsg ? (
          <p className="text-[12px] leading-relaxed text-muted">{pinChangeMsg}</p>
        ) : null}
      </SearchableRow>
    </SettingsSection>
  )
}
