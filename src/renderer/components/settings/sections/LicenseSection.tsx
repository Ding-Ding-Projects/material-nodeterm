import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'

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
  }
}
const ENTRIES = Object.values(ROWS)

export function LicenseSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const proFeaturesEnabled = useSettings((s) => s.settings.proFeaturesEnabled)
  const update = useSettings((s) => s.update)

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
            No payment is required to use nodeterm — ever.
          </p>
          <p className="text-[12px] text-muted">
            Every capability is available to everyone who runs the app. There is no purchase, no
            licence, no subscription, no trial that runs out, and no feature held back until you
            pay. You will never be asked for a card, and nothing here will stop working.
          </p>
          <p className="text-[13px] font-medium" style={{ color: '#ff9f0a' }}>
            If anyone asks you to pay for nodeterm, it is not real.
          </p>
          <p className="text-[12px] text-muted">
            That includes any website, email, message, pop-up, app store listing, or person
            offering a &ldquo;licence key&rdquo;, &ldquo;Pro upgrade&rdquo;, subscription or
            activation for this app — none of it comes from us, and paying it gets you nothing you
            do not already have. Do not send anyone money or card details for this software.
          </p>
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.features}>
        <FieldRow
          label="Unlock all features"
          description="Unlocked is the default and is free. The only reason to lock it is speed: a locked app runs fewer features and does less work in the background, so it lags less on an older or busy machine and uses less battery. Locking takes nothing away permanently and unlocking never costs anything — flip it whenever you like."
          control={
            <Switch
              checked={proFeaturesEnabled}
              onChange={(v) => update({ proFeaturesEnabled: v })}
              ariaLabel="Unlock all features"
            />
          }
        />
      </SearchableRow>
    </SettingsSection>
  )
}
