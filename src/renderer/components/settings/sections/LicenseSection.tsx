import { useSettings } from '../../../state/settings'
import { useEffect, useState } from 'react'
import { useEntitlement } from '../../../state/entitlement'
import { PRO_FEATURES, proFeatureSettingsKey, type ProFeatureId } from '../../../lib/proFeatureAccess'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { SettingsText } from '../SettingsText'
import { ConfirmDialog } from '../../ConfirmDialog'
import { ProCompare } from './ProCompare'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import {
  licenseSentence,
  canReleaseDevices,
  canUseKeyElsewhere,
  releaseFailureSentence,
  activationErrorSentence
} from '@renderer/lib/licenseCopy'

/** How long the Copy button reports success before returning to its label. */
const COPIED_MS = 1600

const ROWS = {
  free: {
    title: 'Everything is free',
    keywords: [
      'free',
      'price',
      'pricing',
      'payment',
      'pay',
      'paid',
      'purchase',
      'buy',
      'billing',
      'card',
      'subscription',
      'licence',
      'license',
      'key',
      'activate',
      'upgrade',
      'pro',
      'premium',
      'trial',
'support',
'donate',
'author',
'upstream',
      'refund'
    ]
  },
  features: {
    title: 'Unlock all features',
    keywords: [
      'features',
      'performance',
      'speed',
      'fast',
      'lightweight',
      'memory',
      'resources',
      'battery',
      'enable',
      'disable',
      'pro',
      'premium'
    ]
  },
  // One SearchableRow per individual toggle, keyed by feature id, so each is independently
  // findable in Settings search (and in the command palette, which shares the same search index).
  remoteAccess: {
    title: 'Remote access hosting',
    keywords: [
      'remote',
      'remote access',
      'host',
      'hosting',
      'relay',
      'performance',
      'speed',
      'memory',
      'battery',
      'quota',
      'devices',
      'seats',
      'release',
      'copy key'
    ]
  },
  teamSeats: {
    title: 'Team seats',
    keywords: ['team', 'seat', 'seats', 'invite', 'collaborate', 'share', 'performance', 'connections']
  },
  license: {
    title: 'License',
    keywords: ['license', 'licence', 'key', 'activate', 'deactivate', 'device', 'release']
  }
}
const ENTRIES = Object.values(ROWS)

export function LicenseSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  // The store's already-resolved effective states (master AND each feature's own choice) — reused
  // here rather than re-deriving them, so this section can never disagree with what actually gates
  // `isPremium`/`seats` for RemoteSection, RemoteAccessDialog, OnboardingFlow and TeamAccessSection.
  const features = useEntitlement((s) => s.features)
  const proFeaturesEnabled = settings.proFeaturesEnabled !== false

  const ent = useEntitlement()
  const [licenseKey, setLicenseKey] = useState('')
  const [upgrading, setUpgrading] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState<'release' | 'deactivate' | null>(null)
  // The reason code of a release that did not land — NOT a boolean, and NOT merged into `detail`:
  // "offline" and "this Mac is not authorized" owe the user different sentences, and neither of
  // them is a statement about the license the panel is displaying. See `releaseFailureSentence`.
  const [releaseError, setReleaseError] = useState<string | null>(null)
  // `loadDetail` REJECTS on the Server Edition (`E_UNSUPPORTED` — there is no license layer in
  // src/server), and the store deliberately does not swallow it. Catching here is not optional:
  // uncaught, this is an unhandled rejection on every browser session. And what we show there is
  // NOTHING — a read that could not run is not "no key, 0 devices".
  const [detailUnavailable, setDetailUnavailable] = useState(false)
  useEffect(() => {
    if (!ent.isPremium) return
    void ent.loadDetail().catch(() => setDetailUnavailable(true))
    // `ent.loadDetail` is a stable zustand action; the entitlement becoming premium is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ent.isPremium])

  // The receipt yields to a clipboard FAILURE. Only the browser build can fail (the desktop
  // preload writes synchronously and cannot), and it reports that as a `nodeterm:toast` error
  // banner — a green "Copied" beside a red banner is the app contradicting itself in one glance.
  // Same rule as the terminal's copy pill (`terminal/useCopyFeedback.ts`).
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    const onToast = (e: Event): void => {
      if ((e as CustomEvent<{ kind?: string }>).detail?.kind === 'error') setCopied(false)
    }
    window.addEventListener('nodeterm:toast', onToast)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('nodeterm:toast', onToast)
    }
  }, [copied])

  const detail = detailUnavailable ? null : ent.detail
  const sentence = licenseSentence(detail)
  const releaseNote = releaseFailureSentence(releaseError)
  // Read out here, not off `detail` inside the click handler: TypeScript drops a property
  // narrowing at a closure boundary, and the key must not be re-read at click time anyway.
  const keyOnFile = detail?.key ?? null

  const runRelease = (): void => {
    setConfirming(null)
    setReleasing(true)
    setReleaseError(null)
    void ent
      .releaseOthers()
      // Resolves to null when the release landed (or was refused on terms the sentence above
      // already carries), else the reason code. Same uncaught-rejection rule as `loadDetail` —
      // plus an IPC failure here would otherwise leave the button stuck on "Releasing…". A
      // rejection is not a code, so it takes the "we do not know what happened" branch.
      .then((code) => setReleaseError(code))
      .catch(() => setReleaseError('unknown'))
      .finally(() => setReleasing(false))
  }
  return (
    <SettingsSection
      id="license"
      title="Features"
      description="Every feature is free. There is nothing to buy and nothing to activate."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.free}>
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-[13px] font-medium text-text">
            <SettingsText>No payment is required to use nodeterm — ever.</SettingsText>
          </p>
          <p className="text-[12px] text-muted">
            <SettingsText>Every capability is available to everyone who runs the app. There is no purchase, no licence, no subscription, no trial that runs out, and no feature held back until you pay. You will never be asked for a card, and nothing here will stop working.</SettingsText>
          </p>
          <p className="text-[13px] font-medium" style={{ color: '#ff9f0a' }}>
            <SettingsText>Support the author of nodeterm.</SettingsText>
          </p>
          <p className="text-[12px] text-muted">
            <SettingsText>This fork exists because the original is worth building on. It has no payment surface of any kind — no checkout, no licence key, no subscription — so nothing you pay for nodeterm reaches this fork. If you want the Pro tier, buy it from the original project; every penny of it goes to the author who wrote nodeterm, and none of it comes here. This app will never ask you for a card, so if something inside THIS window ever does, it did not come from us.</SettingsText>
          </p>
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.features}>
        <FieldRow
          label="Unlock all features"
          description="Unlocked is the default and is free. The only reason to lock it is speed: a locked app runs fewer features and does less work in the background, so it lags less on an older or busy machine and uses less battery. Turning this off locks every feature below it; turning it back on restores whatever you had chosen for each one below — nothing is reset. Want to keep just one or two and shed the rest? Leave this on and use the individual switches below instead."
          control={
            <Switch
              checked={proFeaturesEnabled}
              onChange={(v) => update({ proFeaturesEnabled: v })}
              ariaLabel="Unlock all features"
            />
          }
        />
      </SearchableRow>

      {PRO_FEATURES.map((feature) => {
        const key = proFeatureSettingsKey(feature.id)
        // The switch always reflects and edits this feature's OWN stored choice — never the
        // master-gated effective value. Binding it to the effective value would make the switch
        // look stuck (or silently do nothing) whenever a parent gate is off, which is exactly the
        // kind of control that looks usable and isn't.
        const own = settings[key] !== false
        const note = noteFor(feature.id, own, proFeaturesEnabled, features)
        return (
          <SearchableRow key={feature.id} {...ROWS[feature.id]}>
            <FieldRow
              label={feature.title}
              description={feature.description}
              note={note}
              control={
                <Switch
                  checked={own}
                  onChange={(v) => update({ [key]: v })}
                  ariaLabel={feature.title}
                  vocabularyMode="factual"
                />
              }
            />
          </SearchableRow>
        )
      })}
      <SearchableRow {...ROWS.license}>
        {ent.isPremium ? (
          <div className="space-y-3">
            <ProCompare />
            <p className="text-sm text-muted">
              Pro — active
              {ent.status.expiresAt
                ? ` until ${new Date(ent.status.expiresAt * 1000).toLocaleDateString()}`
                : ''}
              .
            </p>
            {detail ? (
              <>
                {/* No key ⇒ no field. A row reading "not available" beside a sentence saying there
                    IS no key (an App Store subscription, a failed read) contradicts itself on the
                    first screen those users ever see — "not available" means "exists, could not be
                    fetched". The sentence below is the whole story in every keyless case. */}
                {keyOnFile ? (
                  <FieldRow
                    label="License key"
                    control={
                      <div className="flex items-center gap-2">
                        <Input className="w-64" readOnly value={keyOnFile} />
                        <Button
                          onClick={() => {
                            // The app's own clipboard channel, not `navigator.clipboard`: it
                            // returns void (no unhandled rejection) and the browser bridge raises
                            // its own error banner when a copy cannot happen.
                            window.nodeTerminal.clipboard.writeText(keyOnFile)
                            setCopied(true)
                          }}
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                    }
                  />
                ) : null}
                {sentence ? <p className="text-sm text-muted">{sentence}</p> : null}
                {canUseKeyElsewhere(detail) ? (
                  <p className="text-sm text-muted">
                    To use Pro on another Mac, open Settings → License there and paste this key.
                  </p>
                ) : null}
                {canReleaseDevices(detail) ? (
                  <div className="space-y-2">
                    <Button disabled={releasing} onClick={() => setConfirming('release')}>
                      {releasing ? 'Releasing…' : 'Release other devices'}
                    </Button>
                    {releaseNote ? (
                      <p className="text-sm" style={{ color: '#ff9f0a' }}>
                        {releaseNote}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            <Button onClick={() => setConfirming('deactivate')}>Deactivate on this device</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ProCompare />
            <Button
              variant="primary"
              onClick={() => {
                setUpgrading(true)
                void ent.upgrade()
              }}
            >
              Upgrade to Pro — $10/mo
            </Button>
            <p className="text-sm text-muted">
              {upgrading
                ? 'Complete your purchase in the browser — Pro unlocks here automatically.'
                : 'Unlock remote access and Pro features.'}
            </p>
            <details>
              <summary className="cursor-pointer text-sm text-muted">Have a license key?</summary>
              <div className="mt-3 space-y-2">
                <FieldRow
                  label="License key"
                  control={
                    <Input
                      className="w-64"
                      placeholder="paste your key"
                      value={licenseKey}
                      onChange={(e) => setLicenseKey(e.target.value)}
                    />
                  }
                />
                <Button
                  onClick={() => {
                    if (licenseKey.trim()) void ent.activate(licenseKey.trim())
                  }}
                >
                  Activate
                </Button>
                {/* The server's reason code is never rendered raw. A buyer at the device cap is
                    exactly who this screen exists for, and `Could not activate (seat_limit).` is
                    a dead end: the word is unsearchable and names no way out. */}
                {ent.status.error ? (
                  <p className="text-sm" style={{ color: '#ff9f0a' }}>
                    {activationErrorSentence(ent.status.error)}
                  </p>
                ) : null}
              </div>
            </details>
          </div>
        )}
      </SearchableRow>

      {/* Both actions are destructive, one-click and hard to undo, so both are confirmed — the
          house pattern (a single phone revoke gets a ConfirmDialog; these are larger). */}
      {confirming === 'release' ? (
        <ConfirmDialog
          message="Release every other device on this license? Your other Macs and every paired phone lose Pro until they are activated again — this Mac keeps it. Devices can only be released once every 30 days."
          confirmLabel="Release others"
          onConfirm={runRelease}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === 'deactivate' ? (
        <ConfirmDialog
          // Deactivating clears the stored entitlement, and with it the only in-app copy of the
          // key: the detail read that produced it needs that entitlement to authorize. Without
          // this sentence the buyer is back in the support queue this whole screen exists to end.
          message={
            keyOnFile
              ? 'Deactivate Pro on this Mac? Copy your license key first — it is shown here only while Pro is active, and you need it to activate again.'
              : 'Deactivate Pro on this Mac? Pro features stop here until this device is activated again.'
          }
          confirmLabel="Deactivate"
          onConfirm={() => {
            setConfirming(null)
            void ent.deactivate()
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </SettingsSection>
  )
}

/** A caveat explaining why a feature you've left ON (your own stored choice) isn't actually doing
 *  anything right now — either the master switch is off, or (for `teamSeats`) `remoteAccess`,
 *  which it rides, is off. Undefined when the feature is genuinely off by your own choice, or when
 *  nothing above it is holding it back — the switch already tells that story on its own. */
function noteFor(
  id: ProFeatureId,
  ownChoiceOn: boolean,
  masterOn: boolean,
  features: Record<ProFeatureId, boolean>
): string | undefined {
  if (!ownChoiceOn) return undefined
  if (!masterOn) {
    return '"Unlock all features" above is off, so this is off right now too. Turn it back on to restore this choice.'
  }
  if (id === 'teamSeats' && !features.remoteAccess) {
    return '"Remote access hosting" above is off, so this has no effect right now.'
  }
  return undefined
}
