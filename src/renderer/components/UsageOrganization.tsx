import type { ClaudeUsageOrganization } from '@shared/types'
import { useI18n } from '../lib/i18n'

/**
 * Optional identity detail: old snapshots and unreadable metadata keep the email-only view.
 * A personal organization is named after the account's email ("<email>'s Organization"), so
 * beside that email the line only repeats it — it stays (it is the real name), just quieter.
 *
 * The organization name, type, tier and id are facts read from the account's own identity file;
 * they are interpolated after localization and never mapped by the local vocabulary.
 */
export function UsageOrganization({
  organization,
  email
}: {
  organization?: ClaudeUsageOrganization
  email?: string | null
}) {
  const { ts } = useI18n()
  if (!organization?.name) return null
  const detail = [
    organization.type && ts('usage.organization.type', 'Type: {type}', { type: organization.type }),
    organization.rateLimitTier &&
      ts('usage.organization.rateLimitTier', 'Rate limit tier: {tier}', {
        tier: organization.rateLimitTier
      }),
    organization.uuid && ts('usage.organization.id', 'Organization ID: {id}', { id: organization.uuid })
  ]
    .filter(Boolean)
    .join('\n')
  const derived = !!email && organization.name === `${email}'s Organization`
  return (
    <div
      className={`usage-account__organization${derived ? ' usage-account__organization--derived' : ''}`}
      title={detail || undefined}
    >
      {ts('usage.organization.label', 'Organization: {name}', { name: organization.name })}
    </div>
  )
}
