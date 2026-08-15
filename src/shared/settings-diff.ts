// What actually changed between two `Settings` objects, in words — the label a settings history
// revision is recorded under (see src/core/local-history.ts, wired in src/main/index.ts). Pure and
// Electron-free so it is unit-testable and importable from core/main/server/renderer alike.
//
// "Label each revision with WHAT CHANGED rather than that something did" (Deleted the GitHub
// account, not Updated) is the whole point of this file: claudeAccounts/customAgents are diffed by
// id so an add/remove reads as exactly that, and everything else falls back to a generic changed-
// keys list rather than a bare "Updated".

import type { ClaudeAccount, CustomAgent } from './types'
import type { HistoryAction } from './local-history'

export interface SettingsChangeDescription {
  label: string
  action: HistoryAction
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]))
}

function quote(label: string): string {
  return `"${label}"`
}

/** Diff two id-keyed lists (claudeAccounts, customAgents) into human phrases plus which of
 *  created/updated/deleted applies. Returns null when the two lists are equal in every entry. */
function diffNamedList<T extends { id: string; label: string }>(
  before: T[],
  after: T[],
  noun: string
): { phrases: string[]; actions: Set<HistoryAction> } | null {
  const beforeMap = byId(before)
  const afterMap = byId(after)
  const phrases: string[] = []
  const actions = new Set<HistoryAction>()

  for (const [id, item] of afterMap) {
    if (!beforeMap.has(id)) {
      phrases.push(`Added ${noun} ${quote(item.label)}`)
      actions.add('created')
    }
  }
  for (const [id, item] of beforeMap) {
    if (!afterMap.has(id)) {
      phrases.push(`Removed ${noun} ${quote(item.label)}`)
      actions.add('deleted')
    }
  }
  // Same id set, but a field (label, host, etc.) changed on one or more entries.
  const relabeled: string[] = []
  for (const [id, item] of afterMap) {
    const prior = beforeMap.get(id)
    if (prior && JSON.stringify(prior) !== JSON.stringify(item)) relabeled.push(item.label)
  }
  if (relabeled.length > 0) {
    phrases.push(`Updated ${noun}${relabeled.length > 1 ? 's' : ''} ${relabeled.map(quote).join(', ')}`)
    actions.add('updated')
  }

  return phrases.length > 0 ? { phrases, actions } : null
}

/** Fields diffed specially (by id, with add/remove/relabel phrasing) rather than folded into the
 *  generic "changed N settings" fallback below. */
const SPECIAL_ARRAY_FIELDS = ['claudeAccounts', 'customAgents'] as const

/** Describe what changed between `before` and `after`, or `null` when nothing did (the save was a
 *  no-op — the rule "an unchanged state records nothing" starts here, before local-history is even
 *  called). `T` is intentionally generic over just the two special fields (rather than importing
 *  the full `Settings` type) so this file has no dependency on shared/types.ts. The constraint
 *  itself carries NO index signature — an interface like `Settings` is not structurally assignable
 *  to `Record<string, unknown>`, a real TypeScript pitfall — so the dynamic key walk below goes
 *  through an explicit `as unknown as Record<string, unknown>` cast instead. */
export function describeSettingsChange<T extends { claudeAccounts: ClaudeAccount[]; customAgents: CustomAgent[] }>(
  before: T,
  after: T
): SettingsChangeDescription | null {
  const phrases: string[] = []
  const actions = new Set<HistoryAction>()

  const accounts = diffNamedList(before.claudeAccounts, after.claudeAccounts, 'Claude account')
  if (accounts) {
    phrases.push(...accounts.phrases)
    accounts.actions.forEach((a) => actions.add(a))
  }
  const agents = diffNamedList(before.customAgents, after.customAgents, 'agent')
  if (agents) {
    phrases.push(...agents.phrases)
    agents.actions.forEach((a) => actions.add(a))
  }

  const beforeRec = before as unknown as Record<string, unknown>
  const afterRec = after as unknown as Record<string, unknown>
  const genericKeys: string[] = []
  for (const key of Object.keys(afterRec)) {
    if ((SPECIAL_ARRAY_FIELDS as readonly string[]).includes(key)) continue
    const b = beforeRec[key]
    const a = afterRec[key]
    if (b === a) continue
    if (JSON.stringify(b) === JSON.stringify(a)) continue
    genericKeys.push(key)
  }
  if (genericKeys.length > 0) {
    const shown = genericKeys.slice(0, 6)
    const suffix = genericKeys.length > shown.length ? `, +${genericKeys.length - shown.length} more` : ''
    phrases.push(`Changed ${genericKeys.length} setting${genericKeys.length === 1 ? '' : 's'} (${shown.join(', ')}${suffix})`)
    actions.add('updated')
  }

  if (phrases.length === 0) return null

  // Priority when several kinds of change land in one save: created/deleted are the more specific
  // story, so they win over the generic 'updated' bucket for the ACTION filter's sake — the label
  // itself still lists everything.
  const action: HistoryAction = actions.has('created')
    ? 'created'
    : actions.has('deleted')
      ? 'deleted'
      : 'updated'

  return { label: phrases.join('; '), action }
}
