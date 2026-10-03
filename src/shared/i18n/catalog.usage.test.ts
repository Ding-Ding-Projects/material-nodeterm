import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'

/**
 * Hand-written contract for every static string the usage indicator gained in the upstream usage
 * port. Each id keeps its English fallback beside it, so a catalogue row and its caller that
 * disappear together still fail here, and each id must be spelled exactly in one of the four
 * consumer files (a renamed id would silently fall back to English in every language mode).
 *
 * Values in braces are facts (provider labels, HTTP statuses, host keys, organization names,
 * ages). They must appear in both languages and never be translated.
 */
const REQUIRED_USAGE_COPY: Record<string, string> = {
  'usage.empty':
    'No usage data.',
  'usage.failure.generic':
    'Could not read usage.',
  'usage.failure.onHost':
    'Could not read usage on this host.',
  'usage.failure.rateLimited':
    'Rate limited by the usage endpoint (HTTP 429) — try again in a few minutes.',
  'usage.held.momentAgo':
    'a moment ago',
  'usage.held.failed':
    'Latest read failed — showing numbers from {ago}.',
  'usage.held.rateLimited':
    'Latest read was rate limited (HTTP 429) — showing numbers from {ago}.',
  'usage.diagnostic.view.credits':
    'Credits view',
  'usage.diagnostic.view.default':
    'Default view',
  'usage.diagnostic.timeout':
    'Usage request timed out. Try again later.',
  'usage.diagnostic.network':
    'Could not reach {provider}. Check the connection and try again.',
  'usage.diagnostic.invalidResponse':
    'Usage response could not be read. Try again later.',
  'usage.diagnostic.httpAuth':
    '{provider} authentication failed (HTTP {status}). Check the CLI authentication on the machine running this project.',
  'usage.diagnostic.httpRateLimited':
    'Usage request rate limited (HTTP 429). Try again later.',
  'usage.diagnostic.httpServer':
    '{provider} returned HTTP {status}. Try again later.',
  'usage.diagnostic.httpOther':
    'Usage request failed (HTTP {status}). Check the provider service and CLI configuration.',
  'usage.diagnostic.line':
    '{views}: {message}',
  'usage.diagnostic.viewsJoined':
    '{first} and {last}',
  'usage.organization.label':
    'Organization: {name}',
  'usage.organization.type':
    'Type: {type}',
  'usage.organization.rateLimitTier':
    'Rate limit tier: {tier}',
  'usage.organization.id':
    'Organization ID: {id}',
  'usage.claude.account':
    'Account',
  'usage.switchAccount.label':
    '⇄ Switch {agent} account…',
  'usage.switchAccount.title':
    'Opens a terminal running `claude /login` for the system account (~/.claude). Completing it switches the org/account all system sessions use. Running sessions carry on under the new one. Managed accounts keep their own logins.',
  'usage.remote.readOn':
    'Read on {host} over SSH',
  'usage.remote.notYet':
    'No usage from this host yet. It is read once the project connects.',
  'usage.pill.defaultAccount':
    'Account used for new sessions in this project',
  'usage.pill.otherAccount':
    'Account these limits belong to',
}

const CONSUMERS = [
  'src/renderer/components/UsageIndicator.tsx',
  'src/renderer/components/UsageOrganization.tsx',
  'src/renderer/lib/usageFormat.ts',
  'src/renderer/lib/usageDiagnostic.ts'
].map((file) => readFileSync(join(__dirname, '..', '..', '..', file), 'utf8').replace(/\r\n/g, '\n'))

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('usage indicator catalogue copy', () => {
  const ids = Object.keys(REQUIRED_USAGE_COPY)

  it('lists the copy it guards', () => {
    expect(ids.length).toBeGreaterThan(20)
  })

  it.each(ids)('%s ships English, Cantonese and identical fact slots', (id) => {
    const row = CATALOG[id]
    expect(row, id).toBeDefined()
    expect(row.en.length).toBeGreaterThan(0)
    expect(row.yue.length).toBe(row.en.length)
    for (const variant of row.en) expect(variant).toBe(REQUIRED_USAGE_COPY[id])
    for (const variant of row.yue) {
      expect(variant.trim().length).toBeGreaterThan(0)
      expect(placeholders(variant)).toEqual(placeholders(REQUIRED_USAGE_COPY[id]))
    }
  })

  it.each(ids)('%s is read by a usage consumer under its exact id', (id) => {
    expect(CONSUMERS.some((source) => source.includes(`'${id}'`))).toBe(true)
  })
})
