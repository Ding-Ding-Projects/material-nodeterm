import { useSettings } from '../../../state/settings'
import { useEntitlement } from '../../../state/entitlement'
import { PRO_FEATURES, proFeatureSettingsKey, type ProFeatureId } from '../../../lib/proFeatureAccess'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { SettingsText } from '../SettingsText'

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
      'scam',
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
      'battery'
    ]
  },
  teamSeats: {
    title: 'Team seats',
    keywords: ['team', 'seat', 'seats', 'invite', 'collaborate', 'share', 'performance', 'connections']
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
            <SettingsText>If anyone asks you to pay for nodeterm, it is not real.</SettingsText>
          </p>
          <p className="text-[12px] text-muted">
            <SettingsText>That includes any website, email, message, pop-up, app store listing, or person offering a “licence key”, “Pro upgrade”, subscription or activation for this app — none of it comes from us, and paying it gets you nothing you do not already have. Do not send anyone money or card details for this software.</SettingsText>
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
