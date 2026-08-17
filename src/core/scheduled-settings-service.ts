// Orchestrates the scheduled-settings feature: on a bounded background tick, refreshes every
// enabled rule's external source (api / home-assistant), re-resolves which rule (if any) is
// active right now, and broadcasts the result to every attached UI. Runs identically on the
// Electron main process and the Server Edition (both instantiate this the same way — see
// src/main/index.ts / src/server/index.ts), because it only ever talks to the world through
// `platform()`.
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import type { ScheduledSettingsStore } from './scheduled-settings-store'
import {
  resolveActiveSchedule,
  scheduleWindowActiveAt,
  SCHEDULED_SETTINGS_REFRESH_INTERVAL_MS,
  type RuleSourceState,
  type RuleSourceStates,
  type ScheduleRule,
  type ScheduledSettingsFile,
  type ScheduledSettingsActiveState,
  type SchedulableSettingsPatch
} from '../shared/scheduled-settings'
import { fetchApiSettingsSource, fetchHomeAssistantState, type HaFetchResult } from './scheduled-settings-network'
import {
  setHomeAssistantToken,
  getHomeAssistantToken,
  homeAssistantTokenStatus,
  pruneOrphanedTokens
} from './scheduled-settings-secrets'

/** How often the background refresh sweep runs. A rule ALSO refreshes immediately the moment its
 *  window transitions from inactive to active ("refresh on activation" — see `tick`), so this
 *  interval only governs the steady re-check while a rule stays enabled with an external source. */
const TICK_MS = 30_000

export class ScheduledSettingsService {
  private readonly states: RuleSourceStates = {}
  /** Per-rule fetch generation: a fetch whose generation is no longer current when it completes —
   *  because a newer fetch started, or the rule was removed/retargeted — is discarded. This is the
   *  brief's "generation or cancellation guard": a slow, stale response can never overwrite a
   *  newer one. */
  private readonly generations = new Map<string, number>()
  private readonly windowWasActive = new Map<string, boolean>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastPushSignature: string | null = null
  private unsubscribeStore: (() => void) | null = null
  private credentialPruneInFlight: Promise<void> | null = null

  constructor(private readonly store: ScheduledSettingsStore) {}

  start(): void {
    this.unsubscribeStore = this.store.onChange((file, previous) => this.onFileChanged(file, previous))
    this.registerIpc()
    this.retryOrphanedCredentialPrune()
    this.tick() // recompute (and kick off any due refreshes) immediately — don't wait 30s at boot
    this.timer = setInterval(() => {
      this.retryOrphanedCredentialPrune()
      this.tick()
    }, TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unsubscribeStore?.()
    this.unsubscribeStore = null
  }

  private async onFileChanged(file: ScheduledSettingsFile, previous: ScheduledSettingsFile): Promise<void> {
    const liveIds = new Set(file.rules.map((r) => r.id))
    // A rule that vanished (or whose source changed away from home-assistant) must not leave a
    // stale cached "on"/value that could resurrect on a later re-add with the same id.
    for (const id of Object.keys(this.states)) {
      if (!liveIds.has(id)) {
        delete this.states[id]
        this.generations.delete(id)
        this.windowWasActive.delete(id)
      }
    }
    for (const prevRule of previous.rules) {
      const next = file.rules.find((r) => r.id === prevRule.id)
      if (next && prevRule.source.kind === 'home-assistant' && next.source.kind !== 'home-assistant') {
        delete this.states[prevRule.id]
      }
    }
    try {
      await pruneOrphanedTokens(
        new Set(file.rules.filter((r) => r.source.kind === 'home-assistant').map((r) => r.id))
      )
    } finally {
      // Recompute even when cleanup is incomplete. The store awaits and surfaces that failure,
      // while the running schedule must still reflect the file that was successfully published.
      this.tick()
    }
  }

  /** Retry startup/crash-gap residue even when no later schedule edit occurs. The awaited save
   * path reports failures inline; background retries are logged without credential paths/ids. */
  private retryOrphanedCredentialPrune(): void {
    if (this.credentialPruneInFlight) return
    const liveIds = new Set(
      this.store.get().rules
        .filter((rule) => rule.source.kind === 'home-assistant')
        .map((rule) => rule.id)
    )
    const run: Promise<void> = pruneOrphanedTokens(liveIds)
      .catch(() => {
        console.warn('[scheduled-settings] orphaned credential cleanup is incomplete; retrying')
      })
      .finally(() => {
        if (this.credentialPruneInFlight === run) this.credentialPruneInFlight = null
      })
    this.credentialPruneInFlight = run
  }

  private registerIpc(): void {
    platform().handle(IPC.scheduledSettingsSetHaToken, (ruleId: string, token: string | null) =>
      setHomeAssistantToken(ruleId, token)
    )
    // Deliberately no "get token" handler anywhere in this file — only a status boolean ever
    // crosses the IPC boundary. See scheduled-settings-secrets.ts's doc on getHomeAssistantToken.
    platform().handle(IPC.scheduledSettingsTokenStatus, () =>
      homeAssistantTokenStatus(this.store.get().rules.map((r) => r.id))
    )
    platform().handle(IPC.scheduledSettingsRefreshRule, (ruleId: string) => this.refreshRuleById(ruleId))
    platform().handle(IPC.scheduledSettingsActiveState, () => this.currentState())
  }

  /** The explicit "Retry" affordance in the Settings UI. */
  private async refreshRuleById(ruleId: string): Promise<void> {
    const rule = this.store.get().rules.find((r) => r.id === ruleId)
    if (!rule) return
    await this.refreshRule(rule)
    this.recomputeAndBroadcast()
  }

  private tick(): void {
    const file = this.store.get()
    const now = Date.now()
    const refreshes: Promise<void>[] = []
    for (const rule of file.rules) {
      if (!rule.enabled || rule.source.kind === 'local') continue
      const active = scheduleWindowActiveAt(rule.window, now, file.timezone)
      const wasActive = this.windowWasActive.get(rule.id) ?? false
      const justActivated = active && !wasActive
      this.windowWasActive.set(rule.id, active)
      const state = this.states[rule.id]
      const stale = !state?.lastAttemptMs || now - state.lastAttemptMs >= SCHEDULED_SETTINGS_REFRESH_INTERVAL_MS
      if (justActivated || stale) refreshes.push(this.refreshRule(rule))
    }
    // Recompute once now (so a currently-cached value is reflected immediately) and again once
    // any refreshes this tick land (so a completed fetch doesn't wait for the NEXT tick to show).
    this.recomputeAndBroadcast()
    if (refreshes.length) void Promise.allSettled(refreshes).then(() => this.recomputeAndBroadcast())
  }

  private async refreshRule(rule: ScheduleRule): Promise<void> {
    if (rule.source.kind === 'local') return
    const gen = (this.generations.get(rule.id) ?? 0) + 1
    this.generations.set(rule.id, gen)
    const now = Date.now()
    const result: { ok: boolean; error?: string; values?: SchedulableSettingsPatch; on?: boolean } =
      rule.source.kind === 'api'
        ? await fetchApiSettingsSource(rule.source.url, rule.source.timeoutMs)
        : await this.fetchHa(rule.id, rule.source.baseUrl, rule.source.entityId)
    // Discard a stale response: a newer fetch for this rule has started since, or a save has since
    // removed/retargeted it.
    if (this.generations.get(rule.id) !== gen) return
    const currentRule = this.store.get().rules.find((r) => r.id === rule.id)
    if (!currentRule || currentRule.source.kind !== rule.source.kind) return

    const previous = this.states[rule.id]
    const next: RuleSourceState = {
      hasValue: previous?.hasValue ?? false,
      values: previous?.values,
      on: previous?.on,
      lastSuccessMs: previous?.lastSuccessMs,
      lastAttemptOk: result.ok,
      lastAttemptMs: now,
      error: result.ok ? undefined : result.error
    }
    if (result.ok) {
      next.hasValue = true
      next.lastSuccessMs = now
      if (rule.source.kind === 'api') next.values = result.values
      else next.on = result.on
    }
    // Otherwise: leave hasValue/values/on/lastSuccessMs exactly as they were — "retain the last
    // valid state" on a transient failure, per docs/scheduled-settings.md.
    this.states[rule.id] = next
  }

  private async fetchHa(ruleId: string, baseUrl: string, entityId: string): Promise<HaFetchResult> {
    let token: string | null
    try {
      token = await getHomeAssistantToken(ruleId)
    } catch {
      return { ok: false, error: 'The stored Home Assistant token could not be read.' }
    }
    if (!token) return { ok: false, error: 'No access token saved for this rule.' }
    return fetchHomeAssistantState(baseUrl, entityId, token)
  }

  private currentState(): ScheduledSettingsActiveState {
    const file = this.store.get()
    const now = Date.now()
    const resolved = resolveActiveSchedule(file, now, this.states)
    const sources: ScheduledSettingsActiveState['sources'] = {}
    for (const rule of file.rules) {
      if (rule.source.kind === 'local') continue
      const s = this.states[rule.id]
      sources[rule.id] = {
        ok: s?.hasValue === true,
        lastAttemptMs: s?.lastAttemptMs,
        lastSuccessMs: s?.lastSuccessMs,
        error: s && s.lastAttemptOk === false ? s.error : undefined
      }
    }
    return {
      computedAtMs: now,
      active: resolved ? { ruleId: resolved.ruleId, values: resolved.values } : null,
      sources
    }
  }

  private recomputeAndBroadcast(): void {
    const state = this.currentState()
    // Cheap de-dupe: without it, every 30s tick re-broadcasts and re-triggers
    // `applyScheduleOverride` in every attached renderer even when literally nothing changed.
    const signature = JSON.stringify({ active: state.active, sources: state.sources })
    if (signature === this.lastPushSignature) return
    this.lastPushSignature = signature
    platform().broadcast(IPC.scheduledSettingsActiveChange, state)
  }
}
