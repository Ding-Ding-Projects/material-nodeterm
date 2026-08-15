import { useState } from 'react'
import { useSchoolMode } from '../../../state/schoolMode'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Input } from '@renderer/ui/Input'
import { Button } from '@renderer/ui/Button'
import { DEFAULT_SCHOOL_MODE_NAME } from '../../../lib/schoolModeName'

const ROWS = {
  toggle: {
    title: 'School mode',
    keywords: ['school mode', 'focus', 'lock', 'cantonese', 'funny', 'dim sum', 'vocabulary']
  },
  rename: { title: 'Rename School mode', keywords: ['rename', 'school mode', 'display name'] },
  pin: { title: 'School mode PIN', keywords: ['pin', 'password', 'unlock', 'school mode'] }
}
const ENTRIES = Object.values(ROWS)

/**
 * Settings surface for the shared School-mode switch. See docs/school-mode.md — this is a
 * self-imposed, user-experience lock, never a security boundary, and the copy says so plainly.
 */
export function SchoolModeSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const enabled = useSchoolMode((s) => s.enabled)
  const name = useSchoolMode((s) => s.name)
  const hasCredential = useSchoolMode((s) => s.hasCredential)
  const enable = useSchoolMode((s) => s.enable)
  const disable = useSchoolMode((s) => s.disable)
  const rename = useSchoolMode((s) => s.rename)
  const changePin = useSchoolMode((s) => s.changePin)

  const [nameDraft, setNameDraft] = useState(name)
  const [renameSaved, setRenameSaved] = useState(false)

  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [changingPin, setChangingPin] = useState(false)
  const [currentPinDraft, setCurrentPinDraft] = useState('')
  const [nextPinDraft, setNextPinDraft] = useState('')
  const [pinChangeMsg, setPinChangeMsg] = useState<string | null>(null)

  return (
    // `title={name}` (never the literal "School mode"): once renamed, no surface may reveal the
    // shipped name again — see the shared School-mode contract.
    <SettingsSection id="school-mode" title={name} isActive={isActive} searchEntries={ENTRIES}>
      <SearchableRow {...ROWS.toggle}>
        <FieldRow
          label={enabled ? `${name} is on` : `${name} is off`}
          description={`A self-imposed focus switch, not a security lock: while on, this app presents in plain English and behaves as if the Cantonese/bilingual, funny-level, and dim-sum-surprise capabilities were not installed. It affects every app that reads this machine's shared ${name} record, not just this one. Turning it OFF needs the PIN below; turning it ON never does.`}
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
                  placeholder="PIN to turn off"
                  className="w-40"
                  aria-label={`PIN to turn ${name} off`}
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
                      aria-label="Choose a PIN"
                    />
                    <Input
                      type="password"
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value)}
                      placeholder="Confirm PIN"
                      className="w-32"
                      aria-label="Confirm PIN"
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
          Forgot the PIN? There is no reset flow — delete this machine's{' '}
          <code>~/.nodeterm/shared</code> folder to turn the mode off and clear it (your other
          per-app settings are untouched, and any of your prior language/funny-level/dim-sum
          preferences return once the mode is off).
        </p>
      </SearchableRow>

      <SearchableRow {...ROWS.rename}>
        <FieldRow
          label="Display name"
          description="Every surface uses this exact name once you change it — the original shipped name is never shown again anywhere."
          control={
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => {
                  setNameDraft(e.target.value)
                  setRenameSaved(false)
                }}
                placeholder={DEFAULT_SCHOOL_MODE_NAME}
                className="w-48"
                aria-label="School mode display name"
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

      {hasCredential ? (
        <SearchableRow {...ROWS.pin}>
          <FieldRow
            label="Change PIN"
            description="Requires the current PIN."
            control={
              changingPin ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={currentPinDraft}
                    onChange={(e) => setCurrentPinDraft(e.target.value)}
                    placeholder="Current PIN"
                    className="w-32"
                    aria-label="Current PIN"
                  />
                  <Input
                    type="password"
                    value={nextPinDraft}
                    onChange={(e) => setNextPinDraft(e.target.value)}
                    placeholder="New PIN"
                    className="w-32"
                    aria-label="New PIN"
                  />
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const ok = await changePin(currentPinDraft, nextPinDraft)
                      setPinChangeMsg(ok ? 'PIN changed.' : 'Incorrect current PIN, or the new one is too short.')
                      if (ok) {
                        setCurrentPinDraft('')
                        setNextPinDraft('')
                        setChangingPin(false)
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setChangingPin(true)}>Change PIN…</Button>
              )
            }
          />
          {pinChangeMsg ? <p className="text-[12px] leading-relaxed text-muted-2">{pinChangeMsg}</p> : null}
        </SearchableRow>
      ) : null}
    </SettingsSection>
  )
}
